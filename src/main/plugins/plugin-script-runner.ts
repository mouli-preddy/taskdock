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

        proc.stdout?.on('data', (data) => {
          const text = data.toString();
          stdout += text;
          // Parse structured messages from the script
          for (const line of text.split('\n')) {
            this.handleScriptMessage(plugin.id, line.trim(), log);
          }
        });

        proc.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('close', (code) => {
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
        case 'log':
          log.logs.push({ level: msg.level, message: msg.message, timestamp: new Date().toISOString() });
          this.callbacks.onLog(pluginId, msg.level, msg.message);
          break;
      }
    } catch { /* not a plugin message, ignore */ }
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
import { execSync, exec } from 'child_process';

const contextFile = process.argv[2];
const responseFile = process.argv[3];

const ctxData = JSON.parse(fs.readFileSync(contextFile, 'utf-8'));
const actions: any[] = [];

function sendMessage(msg: any) {
  console.log('__PLUGIN_MSG__:' + JSON.stringify(msg));
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
    async claude(prompt: string) {
      sendMessage({ type: 'log', level: 'info', message: 'AI claude call - delegating to host (not yet implemented)' });
      // TODO: Implement via IPC back to host process
      return '[AI response placeholder - ctx.ai.claude not yet connected]';
    },
    async copilot(prompt: string) {
      sendMessage({ type: 'log', level: 'info', message: 'AI copilot call - delegating to host (not yet implemented)' });
      return '[AI response placeholder - ctx.ai.copilot not yet connected]';
    },
  },

  ui: {
    async update(componentId: string, data: any) {
      sendMessage({ type: 'ui:update', componentId, data });
      actions.push({ type: 'ui:update', componentId, data });
    },
    async toast(message: string, level: string = 'info') {
      sendMessage({ type: 'ui:toast', message, level });
      actions.push({ type: 'ui:toast', message, level });
    },
    async inject(tab: string, location: string, component: any) {
      sendMessage({ type: 'ui:inject', tab, location, component });
      actions.push({ type: 'ui:inject', tab, location, component });
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
    const mod = await import(ctxData.workflowPath);
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
