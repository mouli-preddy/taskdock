// src/main/plugins/plugin-script-runner.ts
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getLogger } from '../services/logger-service.js';
import type { LoadedPlugin, PluginExecutionLog } from '../../shared/plugin-types.js';

const WRAPPER_DIR = path.join(os.homedir(), '.taskdock', 'plugins', '_runtime');

export interface ScriptRunnerCallbacks {
  onUIUpdate: (pluginId: string, componentId: string, data: any) => void;
  onUIInject: (pluginId: string, tab: string, location: string, component: any) => void;
  onToast: (pluginId: string, message: string, level: string) => void;
  onLog: (pluginId: string, level: string, message: string) => void;
  onNavigate: (pluginId: string, section: string) => void;
  onAIClaude: (pluginId: string, prompt: string, opts: any) => Promise<string>;
  onAICopilot: (pluginId: string, prompt: string, opts: any) => Promise<string>;
  onAILaunchTerminal: (pluginId: string, opts: { ai: 'copilot' | 'claude'; prompt: string; show?: boolean }) => Promise<string>;
}

export class PluginScriptRunner {
  private callbacks: ScriptRunnerCallbacks;
  private runningProcesses: Map<string, { abort: AbortController }> = new Map();

  constructor(callbacks: ScriptRunnerCallbacks) {
    this.callbacks = callbacks;
    this.ensureWrapperScript();
  }

  /**
   * Run a workflow script for a plugin.
   * Returns the execution log.
   */
  async runWorkflow(
    plugin: LoadedPlugin,
    triggerId: string,
    workflowPath: string,
    input: any
  ): Promise<PluginExecutionLog> {
    const logger = getLogger();
    const absoluteWorkflowPath = path.resolve(plugin.path, workflowPath);
    const executionId = `${plugin.id}:${triggerId}:${Date.now()}`;

    const log: PluginExecutionLog = {
      pluginId: plugin.id,
      triggerId,
      timestamp: new Date().toISOString(),
      status: 'running',
      logs: [],
    };

    if (!fs.existsSync(absoluteWorkflowPath)) {
      log.status = 'error';
      log.error = `Workflow file not found: ${workflowPath}`;
      return log;
    }

    const startTime = Date.now();

    // Write context file for the script to read
    const contextFile = path.join(WRAPPER_DIR, `ctx-${Date.now()}.json`);
    const contextData = {
      pluginId: plugin.id,
      pluginPath: plugin.path,
      config: plugin.config,
      input: input || {},
      workflowPath: absoluteWorkflowPath,
    };
    fs.writeFileSync(contextFile, JSON.stringify(contextData));

    // Write response file path for the script to write results
    const responseFile = path.join(WRAPPER_DIR, `resp-${Date.now()}.json`);

    try {
      const wrapperPath = path.join(WRAPPER_DIR, 'run-workflow.ts');
      const abortController = new AbortController();
      this.runningProcesses.set(executionId, { abort: abortController });

      const timeout = this.getTriggerTimeout(plugin, triggerId);

      await new Promise<void>((resolve, reject) => {
        const proc = spawn('npx', ['tsx', wrapperPath, contextFile, responseFile], {
          cwd: plugin.path,
          shell: true,
          signal: abortController.signal,
          env: { ...process.env, NODE_NO_WARNINGS: '1' },
          timeout: timeout * 1000,
        });

        let stdout = '';
        let stderr = '';
        let stdoutBuffer = ''; // Buffer for incomplete lines

        proc.stdout?.on('data', (data) => {
          const text = data.toString();
          stdout += text;
          // Buffer lines — data events don't guarantee line-aligned chunks
          stdoutBuffer += text;
          const lines = stdoutBuffer.split('\n');
          // Keep the last (possibly incomplete) line in the buffer
          stdoutBuffer = lines.pop() || '';
          for (const line of lines) {
            this.handleScriptMessage(plugin.id, line.trim(), log);
          }
        });

        proc.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('close', (code) => {
          // Flush any remaining buffered stdout
          if (stdoutBuffer.trim()) {
            this.handleScriptMessage(plugin.id, stdoutBuffer.trim(), log);
          }
          if (code === 0) resolve();
          else reject(new Error(stderr || `Process exited with code ${code}`));
        });

        proc.on('error', (err) => {
          reject(err);
        });
      });

      // Read response file if it exists
      if (fs.existsSync(responseFile)) {
        const response = JSON.parse(fs.readFileSync(responseFile, 'utf-8'));
        // Process UI updates, toasts, etc. from the response
        for (const action of response.actions || []) {
          this.processAction(plugin.id, action);
        }
      }

      log.status = 'success';
      log.duration = Date.now() - startTime;
      logger.info('PluginScriptRunner', `Workflow completed: ${triggerId}`, {
        pluginId: plugin.id, duration: log.duration,
      });

    } catch (err: any) {
      log.status = 'error';
      log.error = err.message;
      log.duration = Date.now() - startTime;
      logger.error('PluginScriptRunner', `Workflow failed: ${triggerId}`, {
        pluginId: plugin.id, error: err.message,
      });
    } finally {
      this.runningProcesses.delete(executionId);
      // Cleanup temp files
      try { fs.unlinkSync(contextFile); } catch { /* ignore */ }
      try { fs.unlinkSync(responseFile); } catch { /* ignore */ }
    }

    return log;
  }

  cancelExecution(executionId: string): void {
    const proc = this.runningProcesses.get(executionId);
    if (proc) {
      proc.abort.abort();
      this.runningProcesses.delete(executionId);
    }
  }

  /** Cancel all running workflows for a specific plugin */
  cancelPlugin(pluginId: string): void {
    for (const [execId, proc] of this.runningProcesses) {
      if (execId.startsWith(pluginId + ':')) {
        proc.abort.abort();
        this.runningProcesses.delete(execId);
      }
    }
  }

  /** Cancel all running workflows */
  cancelAll(): void {
    for (const [, proc] of this.runningProcesses) {
      proc.abort.abort();
    }
    this.runningProcesses.clear();
  }

  private handleScriptMessage(pluginId: string, line: string, log: PluginExecutionLog): void {
    if (!line.startsWith('__PLUGIN_MSG__:')) return;
    try {
      const msg = JSON.parse(line.substring('__PLUGIN_MSG__:'.length));
      switch (msg.type) {
        case 'ui:update':
          this.callbacks.onUIUpdate(pluginId, msg.componentId, msg.data);
          break;
        case 'ui:inject':
          this.callbacks.onUIInject(pluginId, msg.tab, msg.location, msg.component);
          break;
        case 'ui:toast':
          this.callbacks.onToast(pluginId, msg.message, msg.level);
          break;
        case 'ui:navigate':
          this.callbacks.onNavigate(pluginId, msg.section);
          break;
        case 'log':
          log.logs.push({ level: msg.level, message: msg.message, timestamp: new Date().toISOString() });
          this.callbacks.onLog(pluginId, msg.level, msg.message);
          break;
        case 'host:request': {
          const { reqFile, resFile } = msg;
          this.handleHostRequest(pluginId, reqFile, resFile).catch(err => {
            try {
              fs.writeFileSync(resFile, JSON.stringify({ error: err.message }));
            } catch { /* ignore */ }
          });
          break;
        }
      }
    } catch { /* not a plugin message, ignore */ }
  }

  private async handleHostRequest(pluginId: string, reqFile: string, resFile: string): Promise<void> {
    const logger = getLogger();
    const req = JSON.parse(fs.readFileSync(reqFile, 'utf-8'));
    let result: any;

    logger.info('PluginScriptRunner', `Host request: ${req.type}`, { pluginId });

    switch (req.type) {
      case 'ai:claude':
        result = await this.callbacks.onAIClaude(pluginId, req.prompt, req.opts || {});
        break;
      case 'ai:copilot':
        result = await this.callbacks.onAICopilot(pluginId, req.prompt, req.opts || {});
        break;
      case 'ai:terminal':
        result = await this.callbacks.onAILaunchTerminal(pluginId, req.opts);
        break;
      default:
        throw new Error(`Unknown host request type: ${req.type}`);
    }

    fs.writeFileSync(resFile, JSON.stringify({ result }));
  }

  private processAction(pluginId: string, action: any): void {
    switch (action.type) {
      case 'ui:update':
        this.callbacks.onUIUpdate(pluginId, action.componentId, action.data);
        break;
      case 'ui:inject':
        this.callbacks.onUIInject(pluginId, action.tab, action.location, action.component);
        break;
      case 'ui:toast':
        this.callbacks.onToast(pluginId, action.message, action.level);
        break;
    }
  }

  private getTriggerTimeout(plugin: LoadedPlugin, triggerId: string): number {
    const trigger = plugin.manifest.triggers.find(t => t.id === triggerId);
    return trigger?.timeout || 60;
  }

  /** Create the wrapper script that sets up ctx and runs the workflow */
  private ensureWrapperScript(): void {
    fs.mkdirSync(WRAPPER_DIR, { recursive: true });
    const wrapperPath = path.join(WRAPPER_DIR, 'run-workflow.ts');

    const wrapperCode = `
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { execSync, exec } from 'child_process';

const contextFile = process.argv[2];
const responseFile = process.argv[3];

const ctxData = JSON.parse(fs.readFileSync(contextFile, 'utf-8'));
const actions: any[] = [];

function sendMessage(msg: any) {
  console.log('__PLUGIN_MSG__:' + JSON.stringify(msg));
}

// Request/response protocol for async host calls (AI, terminals, etc.)
async function requestFromHost(type: string, payload: any): Promise<any> {
  const reqId = 'r' + Date.now() + Math.random().toString(36).slice(2, 6);
  const runtimeDir = path.dirname(contextFile);
  const reqFile = path.join(runtimeDir, 'req-' + reqId + '.json');
  const resFile = path.join(runtimeDir, 'res-' + reqId + '.json');
  fs.writeFileSync(reqFile, JSON.stringify({ type, ...payload }));
  sendMessage({ type: 'host:request', reqId, reqFile, resFile });
  // Poll for response (100ms interval, up to 120s)
  for (let i = 0; i < 1200; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (fs.existsSync(resFile)) {
      const raw = fs.readFileSync(resFile, 'utf-8');
      const res = JSON.parse(raw);
      try { fs.unlinkSync(reqFile); } catch {}
      try { fs.unlinkSync(resFile); } catch {}
      if (res.error) throw new Error(res.error);
      return res.result;
    }
  }
  try { fs.unlinkSync(reqFile); } catch {}
  throw new Error('Host request timed out after 120s');
}

// Build the store (file-backed per-plugin)
const storeFile = path.join(ctxData.pluginPath, '.store.json');
function loadStore(): Record<string, any> {
  try {
    if (fs.existsSync(storeFile)) return JSON.parse(fs.readFileSync(storeFile, 'utf-8'));
  } catch {}
  return {};
}
function saveStore(data: Record<string, any>) {
  fs.writeFileSync(storeFile, JSON.stringify(data, null, 2));
}

const ctx = {
  input: ctxData.input,
  config: ctxData.config,

  http: {
    async get(url: string, opts?: any) {
      const res = await fetch(url, { method: 'GET', headers: opts?.headers });
      if (!res.ok) throw new Error(\`HTTP GET \${url} failed: \${res.status}\`);
      return res.json();
    },
    async post(url: string, body: any, opts?: any) {
      const res = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...opts?.headers } });
      if (!res.ok) throw new Error(\`HTTP POST \${url} failed: \${res.status}\`);
      return res.json();
    },
    async put(url: string, body: any, opts?: any) {
      const res = await fetch(url, { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...opts?.headers } });
      if (!res.ok) throw new Error(\`HTTP PUT \${url} failed: \${res.status}\`);
      return res.json();
    },
    async delete(url: string, opts?: any) {
      const res = await fetch(url, { method: 'DELETE', headers: opts?.headers });
      if (!res.ok) throw new Error(\`HTTP DELETE \${url} failed: \${res.status}\`);
      return res.json();
    },
  },

  shell: {
    async run(command: string, opts?: { cwd?: string; timeout?: number }) {
      return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
        exec(command, { cwd: opts?.cwd, timeout: opts?.timeout || 30000 }, (err, stdout, stderr) => {
          resolve({ stdout: stdout || '', stderr: stderr || '', exitCode: err?.code || 0 });
        });
      });
    },
  },

  ai: {
    async claude(prompt: string, opts?: any) {
      return requestFromHost('ai:claude', { prompt, opts });
    },
    async copilot(prompt: string, opts?: any) {
      return requestFromHost('ai:copilot', { prompt, opts });
    },
    async launchTerminal(opts: any) {
      return requestFromHost('ai:terminal', { opts });
    },
  },

  ui: {
    async update(componentId: string, data: any) {
      sendMessage({ type: 'ui:update', componentId, data });
    },
    async toast(message: string, level: string = 'info') {
      sendMessage({ type: 'ui:toast', message, level });
    },
    async inject(tab: string, location: string, component: any) {
      sendMessage({ type: 'ui:inject', tab, location, component });
    },
    async navigate(section: string) {
      sendMessage({ type: 'ui:navigate', section });
    },
  },

  store: {
    async get(key: string) {
      const store = loadStore();
      return store[key] ?? null;
    },
    async set(key: string, value: any) {
      const store = loadStore();
      store[key] = value;
      saveStore(store);
    },
    async delete(key: string) {
      const store = loadStore();
      delete store[key];
      saveStore(store);
    },
  },

  log: {
    info(msg: string) { sendMessage({ type: 'log', level: 'info', message: msg }); },
    warn(msg: string) { sendMessage({ type: 'log', level: 'warn', message: msg }); },
    error(msg: string) { sendMessage({ type: 'log', level: 'error', message: msg }); },
    debug(msg: string) { sendMessage({ type: 'log', level: 'debug', message: msg }); },
  },

  async run(triggerId: string, input: any) {
    sendMessage({ type: 'log', level: 'info', message: \`ctx.run('\${triggerId}') - delegating to host (not yet implemented)\` });
    // TODO: Implement via IPC back to host process
  },
};

async function main() {
  try {
    const mod = await import(pathToFileURL(ctxData.workflowPath).href);
    const fn = mod.default || mod;
    await fn(ctx);
  } catch (err: any) {
    sendMessage({ type: 'log', level: 'error', message: err.message || String(err) });
    process.exitCode = 1;
  }
  // Write response
  fs.writeFileSync(responseFile, JSON.stringify({ actions }));
}

main();
`;

    fs.writeFileSync(wrapperPath, wrapperCode);
  }
}
