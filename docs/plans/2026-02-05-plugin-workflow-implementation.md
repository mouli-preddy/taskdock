# Plugin & Workflow System - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a plugin engine to TaskDock that lets users (and LLMs) create file-based plugins with declarative UI, TypeScript workflows, and hooks into built-in tabs.

**Architecture:** Plugins live in `~/.taskdock/plugins/`. A new backend `PluginEngine` service loads manifests, runs TypeScript workflows via `tsx`, and manages scheduling. The renderer gets a `PluginTabRenderer` that turns `ui.json` into DOM using a component catalog. Communication uses the existing WebSocket RPC bridge pattern.

**Tech Stack:** TypeScript, `tsx` (already a dependency), `node-cron` (new), `chokidar` (new for file watching), existing WebSocket bridge, existing service patterns.

---

## Task 1: Define Plugin Shared Types

**Files:**
- Create: `src/shared/plugin-types.ts`

**Step 1: Create the plugin type definitions**

```ts
// src/shared/plugin-types.ts

// ---- Manifest types ----

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  config?: Record<string, PluginConfigField>;
  triggers: PluginTrigger[];
  hooks?: PluginHooks;
}

export interface PluginConfigField {
  type: 'string' | 'number' | 'boolean';
  label: string;
  required?: boolean;
  default?: string | number | boolean;
  secret?: boolean;
}

export type PluginTrigger = ManualTrigger | PollingTrigger | ScheduledTrigger;

export interface ManualTrigger {
  type: 'manual';
  id: string;
  workflow: string;
  label: string;
  timeout?: number;
}

export interface PollingTrigger {
  type: 'polling';
  id: string;
  workflow: string;
  interval: string; // e.g., "30s", "{{config.pollInterval}}s"
  timeout?: number;
}

export interface ScheduledTrigger {
  type: 'scheduled';
  id: string;
  workflow: string;
  cron: string;
  timeout?: number;
}

export interface PluginHooks {
  'pr-review'?: PluginHookSet;
  'pr-home'?: PluginHookSet;
  'workitems'?: PluginHookSet;
  'terminals'?: PluginHookSet;
}

export interface PluginHookSet {
  toolbar?: PluginHookButton[];
  'row-actions'?: PluginHookButton[];
  'file-context-menu'?: PluginHookButton[];
  'comments-toolbar'?: PluginHookButton[];
  'bottom-panel'?: PluginHookButton[];
}

export interface PluginHookButton {
  label: string;
  icon: string;
  trigger: string;
  position?: 'left' | 'right';
}

// ---- UI types ----

export interface PluginUI {
  tab: {
    id: string;
    label: string;
    icon: string;
  };
  layout: PluginComponent;
}

export type PluginComponent =
  | TableComponent
  | DetailPanelComponent
  | CardComponent
  | SplitPanelComponent
  | ButtonGroupComponent
  | StatusBadgeComponent
  | KeyValueComponent
  | TimelineComponent
  | TabsComponent
  | FormComponent
  | MarkdownComponent
  | EmptyStateComponent
  | HeaderComponent;

export interface TableComponent {
  type: 'table';
  id: string;
  dataSource?: string;
  columns: TableColumn[];
  onRowClick?: string;
  polling?: { interval: number };
  sortable?: boolean;
  filterable?: boolean;
}

export interface TableColumn {
  key: string;
  label: string;
  width?: number;
  component?: string;
  colorMap?: Record<string, string>;
}

export interface DetailPanelComponent {
  type: 'detail-panel';
  id: string;
  dataSource?: string;
  sections: PluginComponent[];
}

export interface CardComponent {
  type: 'card';
  id?: string;
  label: string;
  content: string;
  renderAs?: 'text' | 'markdown' | 'code';
}

export interface SplitPanelComponent {
  type: 'split-panel';
  id?: string;
  sizes: [number, number];
  direction?: 'horizontal' | 'vertical';
  children: [PluginComponent, PluginComponent];
}

export interface ButtonGroupComponent {
  type: 'button-group';
  id?: string;
  buttons: { label: string; icon?: string; action: string; variant?: string }[];
}

export interface StatusBadgeComponent {
  type: 'status-badge';
  id?: string;
  value: string;
  colorMap?: Record<string, string>;
}

export interface KeyValueComponent {
  type: 'key-value';
  id?: string;
  dataSource?: string;
  fields?: { key: string; label: string }[];
}

export interface TimelineComponent {
  type: 'timeline';
  id?: string;
  dataSource?: string;
  fields?: { time: string; title: string; description: string };
}

export interface TabsComponent {
  type: 'tabs';
  id?: string;
  items: { label: string; content: PluginComponent }[];
}

export interface FormComponent {
  type: 'form';
  id?: string;
  fields: { key: string; label: string; type: string; required?: boolean }[];
  onSubmit?: string;
}

export interface MarkdownComponent {
  type: 'markdown';
  id?: string;
  content: string;
}

export interface EmptyStateComponent {
  type: 'empty-state';
  id?: string;
  icon?: string;
  title: string;
  description: string;
  action?: { label: string; trigger: string };
}

export interface HeaderComponent {
  type: 'header';
  id?: string;
  title: string;
  subtitle?: string;
}

// ---- Runtime types ----

export interface LoadedPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  path: string;           // Absolute path to plugin directory
  manifest: PluginManifest;
  ui: PluginUI | null;    // null if no ui.json
  config: Record<string, any>; // User-configured values
  enabled: boolean;
}

export interface PluginExecutionLog {
  pluginId: string;
  triggerId: string;
  timestamp: string;
  status: 'running' | 'success' | 'error';
  duration?: number;
  error?: string;
  logs: { level: string; message: string; timestamp: string }[];
}

export interface PluginUIUpdateEvent {
  pluginId: string;
  componentId: string;
  data: any;
}

export interface PluginUIInjectEvent {
  pluginId: string;
  tab: string;
  location: string;
  component: PluginComponent;
}

export interface PluginToastEvent {
  pluginId: string;
  message: string;
  level: 'success' | 'error' | 'warning' | 'info';
}
```

**Step 2: Commit**

```bash
git add src/shared/plugin-types.ts
git commit -m "feat(plugins): add shared type definitions for plugin system"
```

---

## Task 2: Create Plugin Loader Service

**Files:**
- Create: `src/main/plugins/plugin-loader.ts`

**Step 1: Implement the plugin loader**

This service scans `~/.taskdock/plugins/`, reads and validates `manifest.json` and `ui.json`, and manages the registry of loaded plugins.

```ts
// src/main/plugins/plugin-loader.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getLogger } from '../services/logger-service.js';
import type { PluginManifest, PluginUI, LoadedPlugin } from '../../shared/plugin-types.js';

const PLUGINS_DIR = path.join(os.homedir(), '.taskdock', 'plugins');
const STORE_FILE = path.join(os.homedir(), '.taskdock', 'plugin-config.json');

export class PluginLoader {
  private plugins: Map<string, LoadedPlugin> = new Map();

  constructor() {}

  /** Scan plugins directory and load all valid plugins */
  loadAll(): LoadedPlugin[] {
    const logger = getLogger();
    this.plugins.clear();

    if (!fs.existsSync(PLUGINS_DIR)) {
      fs.mkdirSync(PLUGINS_DIR, { recursive: true });
      logger.info('PluginLoader', 'Created plugins directory', { path: PLUGINS_DIR });
      return [];
    }

    const savedConfig = this.loadSavedConfig();
    const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;

      const pluginDir = path.join(PLUGINS_DIR, entry.name);
      try {
        const plugin = this.loadPlugin(pluginDir, savedConfig);
        if (plugin) {
          this.plugins.set(plugin.id, plugin);
          logger.info('PluginLoader', `Loaded plugin: ${plugin.name}`, { id: plugin.id, version: plugin.version });
        }
      } catch (err: any) {
        logger.error('PluginLoader', `Failed to load plugin from ${entry.name}`, { error: err.message });
      }
    }

    return Array.from(this.plugins.values());
  }

  /** Load a single plugin from a directory */
  private loadPlugin(pluginDir: string, savedConfig: Record<string, any>): LoadedPlugin | null {
    const manifestPath = path.join(pluginDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;

    const manifestRaw = fs.readFileSync(manifestPath, 'utf-8');
    const manifest: PluginManifest = JSON.parse(manifestRaw);

    // Validate required fields
    if (!manifest.id || !manifest.name || !manifest.version) {
      throw new Error(`Invalid manifest: missing id, name, or version`);
    }
    if (!manifest.triggers || !Array.isArray(manifest.triggers)) {
      throw new Error(`Invalid manifest: triggers must be an array`);
    }

    // Load ui.json if present
    let ui: PluginUI | null = null;
    const uiPath = path.join(pluginDir, 'ui.json');
    if (fs.existsSync(uiPath)) {
      const uiRaw = fs.readFileSync(uiPath, 'utf-8');
      ui = JSON.parse(uiRaw);
    }

    // Load saved config for this plugin
    const pluginSavedConfig = savedConfig[manifest.id] || {};
    const config: Record<string, any> = {};
    if (manifest.config) {
      for (const [key, field] of Object.entries(manifest.config)) {
        config[key] = pluginSavedConfig[key] ?? field.default ?? undefined;
      }
    }

    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description || '',
      path: pluginDir,
      manifest,
      ui,
      config,
      enabled: pluginSavedConfig._enabled !== false,
    };
  }

  /** Reload a single plugin by ID */
  reloadPlugin(pluginId: string): LoadedPlugin | null {
    const existing = this.plugins.get(pluginId);
    if (!existing) return null;

    const savedConfig = this.loadSavedConfig();
    const plugin = this.loadPlugin(existing.path, savedConfig);
    if (plugin) {
      this.plugins.set(plugin.id, plugin);
    }
    return plugin;
  }

  getPlugin(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  getAllPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  /** Save plugin config (user-set values + enabled state) */
  savePluginConfig(pluginId: string, config: Record<string, any>): void {
    const allConfig = this.loadSavedConfig();
    allConfig[pluginId] = { ...allConfig[pluginId], ...config };
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(allConfig, null, 2));

    // Update in-memory state
    const plugin = this.plugins.get(pluginId);
    if (plugin) {
      for (const [key, value] of Object.entries(config)) {
        if (key === '_enabled') {
          plugin.enabled = value !== false;
        } else {
          plugin.config[key] = value;
        }
      }
    }
  }

  private loadSavedConfig(): Record<string, any> {
    try {
      if (fs.existsSync(STORE_FILE)) {
        return JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
      }
    } catch { /* ignore */ }
    return {};
  }

  getPluginsDir(): string {
    return PLUGINS_DIR;
  }
}

let loaderInstance: PluginLoader | null = null;

export function getPluginLoader(): PluginLoader {
  if (!loaderInstance) {
    loaderInstance = new PluginLoader();
  }
  return loaderInstance;
}
```

**Step 2: Commit**

```bash
git add src/main/plugins/plugin-loader.ts
git commit -m "feat(plugins): add plugin loader service"
```

---

## Task 3: Create Plugin Script Runner

**Files:**
- Create: `src/main/plugins/plugin-script-runner.ts`

**Step 1: Implement the script runner**

Executes `.ts` workflow files using `tsx` as a child process. Builds the `ctx` object and passes it to the script via a wrapper.

```ts
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
```

**Step 2: Commit**

```bash
git add src/main/plugins/plugin-script-runner.ts
git commit -m "feat(plugins): add script runner for executing TypeScript workflows"
```

---

## Task 4: Create Plugin Scheduler

**Files:**
- Create: `src/main/plugins/plugin-scheduler.ts`

**Step 1: Install node-cron dependency**

Run: `npm install cron-parser`

We use `cron-parser` (lightweight, no extra dependencies) instead of `node-cron` to keep things simple. We'll implement our own scheduling loop.

**Step 2: Implement the scheduler**

```ts
// src/main/plugins/plugin-scheduler.ts
import { getLogger } from '../services/logger-service.js';
import type { LoadedPlugin, PollingTrigger, ScheduledTrigger } from '../../shared/plugin-types.js';

export interface SchedulerCallbacks {
  executeTrigger: (plugin: LoadedPlugin, triggerId: string, input?: any) => Promise<void>;
}

interface ActiveTimer {
  pluginId: string;
  triggerId: string;
  timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>;
  type: 'polling' | 'scheduled';
}

export class PluginScheduler {
  private activeTimers: Map<string, ActiveTimer> = new Map();
  private callbacks: SchedulerCallbacks;

  constructor(callbacks: SchedulerCallbacks) {
    this.callbacks = callbacks;
  }

  /** Start all polling and scheduled triggers for a plugin */
  startPlugin(plugin: LoadedPlugin): void {
    if (!plugin.enabled) return;

    for (const trigger of plugin.manifest.triggers) {
      if (trigger.type === 'polling') {
        this.startPolling(plugin, trigger);
      } else if (trigger.type === 'scheduled') {
        this.startScheduled(plugin, trigger);
      }
    }
  }

  /** Stop all triggers for a plugin */
  stopPlugin(pluginId: string): void {
    for (const [key, timer] of this.activeTimers) {
      if (timer.pluginId === pluginId) {
        clearInterval(timer.timer as any);
        clearTimeout(timer.timer as any);
        this.activeTimers.delete(key);
      }
    }
  }

  /** Stop all triggers */
  stopAll(): void {
    for (const [key, timer] of this.activeTimers) {
      clearInterval(timer.timer as any);
      clearTimeout(timer.timer as any);
    }
    this.activeTimers.clear();
  }

  private startPolling(plugin: LoadedPlugin, trigger: PollingTrigger): void {
    const logger = getLogger();
    const intervalMs = this.parseInterval(trigger.interval, plugin.config);
    if (intervalMs <= 0) {
      logger.warn('PluginScheduler', `Invalid polling interval for ${plugin.id}:${trigger.id}`);
      return;
    }

    const key = `${plugin.id}:${trigger.id}`;
    const timer = setInterval(async () => {
      try {
        await this.callbacks.executeTrigger(plugin, trigger.id);
      } catch (err: any) {
        logger.error('PluginScheduler', `Polling trigger failed: ${key}`, { error: err.message });
      }
    }, intervalMs);

    this.activeTimers.set(key, { pluginId: plugin.id, triggerId: trigger.id, timer, type: 'polling' });
    logger.info('PluginScheduler', `Started polling: ${key} every ${intervalMs}ms`);
  }

  private startScheduled(plugin: LoadedPlugin, trigger: ScheduledTrigger): void {
    const logger = getLogger();
    const key = `${plugin.id}:${trigger.id}`;

    // Simple cron implementation: check every minute if the cron matches
    const timer = setInterval(() => {
      if (this.cronMatches(trigger.cron)) {
        this.callbacks.executeTrigger(plugin, trigger.id).catch(err => {
          logger.error('PluginScheduler', `Scheduled trigger failed: ${key}`, { error: err.message });
        });
      }
    }, 60_000);

    this.activeTimers.set(key, { pluginId: plugin.id, triggerId: trigger.id, timer, type: 'scheduled' });
    logger.info('PluginScheduler', `Started scheduled: ${key} with cron "${trigger.cron}"`);
  }

  /** Parse interval string like "30s" or "{{config.pollInterval}}s" */
  private parseInterval(interval: string, config: Record<string, any>): number {
    // Replace config references
    let resolved = interval.replace(/\{\{config\.(\w+)\}\}/g, (_, key) => String(config[key] || '30'));

    // Parse number + unit
    const match = resolved.match(/^(\d+)(s|m|ms)?$/);
    if (!match) return 30_000; // Default 30 seconds
    const value = parseInt(match[1], 10);
    const unit = match[2] || 's';
    if (unit === 'ms') return value;
    if (unit === 'm') return value * 60_000;
    return value * 1000; // seconds
  }

  /** Simple cron matching (minute hour day month weekday) */
  private cronMatches(cron: string): boolean {
    const now = new Date();
    const parts = cron.split(/\s+/);
    if (parts.length < 5) return false;

    const [minute, hour, day, month, weekday] = parts;
    return (
      this.fieldMatches(minute, now.getMinutes()) &&
      this.fieldMatches(hour, now.getHours()) &&
      this.fieldMatches(day, now.getDate()) &&
      this.fieldMatches(month, now.getMonth() + 1) &&
      this.fieldMatchesWeekday(weekday, now.getDay())
    );
  }

  private fieldMatches(field: string, value: number): boolean {
    if (field === '*') return true;
    // Handle ranges like "1-5"
    if (field.includes('-')) {
      const [min, max] = field.split('-').map(Number);
      return value >= min && value <= max;
    }
    // Handle lists like "1,3,5"
    if (field.includes(',')) {
      return field.split(',').map(Number).includes(value);
    }
    // Handle step like "*/5"
    if (field.startsWith('*/')) {
      const step = parseInt(field.substring(2), 10);
      return value % step === 0;
    }
    return parseInt(field, 10) === value;
  }

  private fieldMatchesWeekday(field: string, value: number): boolean {
    // Sunday = 0 in JS, but some cron formats use 7
    if (field === '*') return true;
    if (field.includes('-')) {
      const [min, max] = field.split('-').map(Number);
      return value >= min && value <= max;
    }
    if (field.includes(',')) {
      return field.split(',').map(Number).includes(value);
    }
    const target = parseInt(field, 10);
    return target === value || (target === 7 && value === 0);
  }
}
```

**Step 3: Commit**

```bash
git add src/main/plugins/plugin-scheduler.ts
git commit -m "feat(plugins): add scheduler for polling and cron triggers"
```

---

## Task 5: Create Plugin Engine (Orchestrator)

**Files:**
- Create: `src/main/plugins/plugin-engine.ts`

**Step 1: Implement the plugin engine**

This is the main orchestrator that ties together the loader, script runner, and scheduler, and exposes the API to the bridge.

```ts
// src/main/plugins/plugin-engine.ts
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../services/logger-service.js';
import { PluginLoader, getPluginLoader } from './plugin-loader.js';
import { PluginScriptRunner } from './plugin-script-runner.js';
import { PluginScheduler } from './plugin-scheduler.js';
import type {
  LoadedPlugin,
  PluginExecutionLog,
  PluginUIUpdateEvent,
  PluginUIInjectEvent,
  PluginToastEvent,
} from '../../shared/plugin-types.js';

export class PluginEngine extends EventEmitter {
  private loader: PluginLoader;
  private runner: PluginScriptRunner;
  private scheduler: PluginScheduler;
  private executionLogs: Map<string, PluginExecutionLog[]> = new Map();
  private fileWatcher: fs.FSWatcher | null = null;

  constructor() {
    super();

    this.loader = getPluginLoader();

    this.runner = new PluginScriptRunner({
      onUIUpdate: (pluginId, componentId, data) => {
        this.emit('ui:update', { pluginId, componentId, data } as PluginUIUpdateEvent);
      },
      onUIInject: (pluginId, tab, location, component) => {
        this.emit('ui:inject', { pluginId, tab, location, component } as PluginUIInjectEvent);
      },
      onToast: (pluginId, message, level) => {
        this.emit('ui:toast', { pluginId, message, level } as PluginToastEvent);
      },
      onLog: (pluginId, level, message) => {
        this.emit('plugin:log', { pluginId, level, message });
      },
    });

    this.scheduler = new PluginScheduler({
      executeTrigger: (plugin, triggerId, input) => this.executeTrigger(plugin.id, triggerId, input),
    });
  }

  /** Initialize the plugin engine: load all plugins and start schedulers */
  initialize(): void {
    const logger = getLogger();
    logger.info('PluginEngine', 'Initializing plugin engine');

    const plugins = this.loader.loadAll();
    logger.info('PluginEngine', `Loaded ${plugins.length} plugin(s)`);

    // Start schedulers for enabled plugins
    for (const plugin of plugins) {
      if (plugin.enabled) {
        this.scheduler.startPlugin(plugin);
      }
    }

    // Start file watcher for hot-reload
    this.startFileWatcher();
  }

  /** Execute a trigger (manual, or called by scheduler) */
  async executeTrigger(pluginId: string, triggerId: string, input?: any): Promise<PluginExecutionLog> {
    const plugin = this.loader.getPlugin(pluginId);
    if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
    if (!plugin.enabled) throw new Error(`Plugin is disabled: ${pluginId}`);

    const trigger = plugin.manifest.triggers.find(t => t.id === triggerId);
    if (!trigger) throw new Error(`Trigger not found: ${triggerId} in plugin ${pluginId}`);

    const log = await this.runner.runWorkflow(plugin, triggerId, trigger.workflow, input);

    // Store execution log
    if (!this.executionLogs.has(pluginId)) {
      this.executionLogs.set(pluginId, []);
    }
    const logs = this.executionLogs.get(pluginId)!;
    logs.push(log);
    // Keep only last 50 logs per plugin
    if (logs.length > 50) logs.splice(0, logs.length - 50);

    this.emit('execution:complete', log);
    return log;
  }

  /** Get all loaded plugins */
  getPlugins(): LoadedPlugin[] {
    return this.loader.getAllPlugins();
  }

  /** Get a single plugin */
  getPlugin(pluginId: string): LoadedPlugin | undefined {
    return this.loader.getPlugin(pluginId);
  }

  /** Enable/disable a plugin */
  setPluginEnabled(pluginId: string, enabled: boolean): void {
    this.loader.savePluginConfig(pluginId, { _enabled: enabled });
    if (enabled) {
      const plugin = this.loader.getPlugin(pluginId);
      if (plugin) this.scheduler.startPlugin(plugin);
    } else {
      this.scheduler.stopPlugin(pluginId);
    }
    this.emit('plugin:state-changed', { pluginId, enabled });
  }

  /** Save plugin config values */
  savePluginConfig(pluginId: string, config: Record<string, any>): void {
    this.loader.savePluginConfig(pluginId, config);
    // Restart scheduler with new config
    this.scheduler.stopPlugin(pluginId);
    const plugin = this.loader.getPlugin(pluginId);
    if (plugin?.enabled) {
      this.scheduler.startPlugin(plugin);
    }
  }

  /** Get execution logs for a plugin */
  getExecutionLogs(pluginId: string): PluginExecutionLog[] {
    return this.executionLogs.get(pluginId) || [];
  }

  /** Hot-reload: watch plugins directory for changes */
  private startFileWatcher(): void {
    const pluginsDir = this.loader.getPluginsDir();
    try {
      this.fileWatcher = fs.watch(pluginsDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        // Debounce: wait 500ms before reloading
        if (this._reloadTimeout) clearTimeout(this._reloadTimeout);
        this._reloadTimeout = setTimeout(() => {
          this.handleFileChange(filename);
        }, 500);
      });
    } catch (err: any) {
      getLogger().warn('PluginEngine', 'Could not start file watcher', { error: err.message });
    }
  }

  private _reloadTimeout: ReturnType<typeof setTimeout> | null = null;

  private handleFileChange(filename: string): void {
    const logger = getLogger();
    // Extract plugin folder name from the path
    const parts = filename.split(path.sep);
    if (parts.length === 0 || parts[0].startsWith('_')) return;

    const pluginDirName = parts[0];
    logger.info('PluginEngine', `File change detected in plugin: ${pluginDirName}`);

    // Find the plugin by directory name
    const plugins = this.loader.getAllPlugins();
    const existing = plugins.find(p => path.basename(p.path) === pluginDirName);

    if (existing) {
      // Reload existing plugin
      this.scheduler.stopPlugin(existing.id);
      const reloaded = this.loader.reloadPlugin(existing.id);
      if (reloaded?.enabled) {
        this.scheduler.startPlugin(reloaded);
      }
      this.emit('plugin:reloaded', { pluginId: existing.id });
      logger.info('PluginEngine', `Reloaded plugin: ${existing.id}`);
    } else {
      // New plugin - reload all
      this.scheduler.stopAll();
      const allPlugins = this.loader.loadAll();
      for (const p of allPlugins) {
        if (p.enabled) this.scheduler.startPlugin(p);
      }
      this.emit('plugins:reloaded', {});
      logger.info('PluginEngine', 'Reloaded all plugins (new plugin detected)');
    }
  }

  dispose(): void {
    this.scheduler.stopAll();
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
    if (this._reloadTimeout) {
      clearTimeout(this._reloadTimeout);
    }
  }
}

let engineInstance: PluginEngine | null = null;

export function getPluginEngine(): PluginEngine {
  if (!engineInstance) {
    engineInstance = new PluginEngine();
  }
  return engineInstance;
}

export function disposePluginEngine(): void {
  engineInstance?.dispose();
  engineInstance = null;
}
```

**Step 2: Commit**

```bash
git add src/main/plugins/plugin-engine.ts
git commit -m "feat(plugins): add plugin engine orchestrator"
```

---

## Task 6: Wire Plugin Engine into Backend Bridge

**Files:**
- Modify: `src-backend/bridge.ts`

**Step 1: Add imports (after line 28)**

Add these imports near the top of bridge.ts, after the existing service imports:

```ts
import { getPluginEngine, disposePluginEngine } from '../src/main/plugins/plugin-engine.js';
```

**Step 2: Initialize plugin engine (after line 152)**

After `const applyChangesService = getApplyChangesService();` (line 152), add:

```ts
// Initialize plugin engine
const pluginEngine = getPluginEngine();
pluginEngine.initialize();
```

**Step 3: Add event forwarding (after line 179)**

After `commentAnalysisService.onProgress(...)` (line 179), add:

```ts
// Plugin engine events
pluginEngine.on('ui:update', (event) => broadcast('plugin:ui-update', event));
pluginEngine.on('ui:inject', (event) => broadcast('plugin:ui-inject', event));
pluginEngine.on('ui:toast', (event) => broadcast('plugin:ui-toast', event));
pluginEngine.on('plugin:log', (event) => broadcast('plugin:log', event));
pluginEngine.on('execution:complete', (event) => broadcast('plugin:execution-complete', event));
pluginEngine.on('plugin:reloaded', (event) => broadcast('plugin:reloaded', event));
pluginEngine.on('plugins:reloaded', () => broadcast('plugin:plugins-reloaded', {}));
pluginEngine.on('plugin:state-changed', (event) => broadcast('plugin:state-changed', event));
```

**Step 4: Add RPC handlers (before `default:` at line 734)**

Insert before the `default:` case:

```ts
    // Plugin Engine API
    case 'plugin:get-plugins':
      return pluginEngine.getPlugins();
    case 'plugin:get-plugin':
      return pluginEngine.getPlugin(params[0]);
    case 'plugin:execute-trigger':
      return pluginEngine.executeTrigger(params[0], params[1], params[2]);
    case 'plugin:set-enabled':
      pluginEngine.setPluginEnabled(params[0], params[1]);
      return;
    case 'plugin:save-config':
      pluginEngine.savePluginConfig(params[0], params[1]);
      return;
    case 'plugin:get-logs':
      return pluginEngine.getExecutionLogs(params[0]);
```

**Step 5: Add disposal (in SIGINT/SIGTERM handlers)**

In both signal handlers (lines 788-810), add `disposePluginEngine();` before `wss.close();`.

**Step 6: Commit**

```bash
git add src-backend/bridge.ts
git commit -m "feat(plugins): wire plugin engine into backend bridge"
```

---

## Task 7: Add Plugin RPC Methods to Frontend API

**Files:**
- Modify: `src/renderer/tauri-api.ts`

**Step 1: Add plugin API methods to tauriAPI object**

Insert before the closing `};` of the tauriAPI object (before line 544):

```ts
  // Plugin API
  pluginGetPlugins: () => invoke('plugin:get-plugins'),
  pluginGetPlugin: (pluginId: string) => invoke('plugin:get-plugin', pluginId),
  pluginExecuteTrigger: (pluginId: string, triggerId: string, input?: any) =>
    invoke('plugin:execute-trigger', pluginId, triggerId, input),
  pluginSetEnabled: (pluginId: string, enabled: boolean) =>
    invoke('plugin:set-enabled', pluginId, enabled),
  pluginSaveConfig: (pluginId: string, config: Record<string, any>) =>
    invoke('plugin:save-config', pluginId, config),
  pluginGetLogs: (pluginId: string) =>
    invoke('plugin:get-logs', pluginId),

  // Plugin event listeners
  onPluginUIUpdate: (callback: (event: any) => void) => subscribe('plugin:ui-update', callback),
  onPluginUIInject: (callback: (event: any) => void) => subscribe('plugin:ui-inject', callback),
  onPluginUIToast: (callback: (event: any) => void) => subscribe('plugin:ui-toast', callback),
  onPluginLog: (callback: (event: any) => void) => subscribe('plugin:log', callback),
  onPluginExecutionComplete: (callback: (event: any) => void) => subscribe('plugin:execution-complete', callback),
  onPluginReloaded: (callback: (event: any) => void) => subscribe('plugin:reloaded', callback),
  onPluginsReloaded: (callback: () => void) => subscribe('plugin:plugins-reloaded', callback),
  onPluginStateChanged: (callback: (event: any) => void) => subscribe('plugin:state-changed', callback),
```

**Step 2: Commit**

```bash
git add src/renderer/tauri-api.ts
git commit -m "feat(plugins): add plugin RPC methods to frontend API"
```

---

## Task 8: Create Plugin Tab Renderer (Component Catalog)

**Files:**
- Create: `src/renderer/components/plugin-tab-renderer.ts`

**Step 1: Implement the component catalog renderer**

This takes a `PluginUI` definition and renders it to HTML, handling data binding and action wiring.

```ts
// src/renderer/components/plugin-tab-renderer.ts
import { Toast } from './toast.js';
import { getIcon } from '../utils/icons.js';
import type {
  PluginUI,
  PluginComponent,
  LoadedPlugin,
  TableColumn,
} from '../../shared/plugin-types.js';

export class PluginTabRenderer {
  private container: HTMLElement;
  private plugin: LoadedPlugin;
  private componentData: Map<string, any> = new Map();
  private selectedRows: Map<string, any> = new Map(); // tableId -> selected row
  private triggerCallback: ((triggerId: string, input?: any) => void) | null = null;

  constructor(container: HTMLElement, plugin: LoadedPlugin) {
    this.container = container;
    this.plugin = plugin;
  }

  onTrigger(callback: (triggerId: string, input?: any) => void) {
    this.triggerCallback = callback;
  }

  /** Render the full plugin UI */
  render(): void {
    if (!this.plugin.ui) {
      this.container.innerHTML = `<div class="plugin-empty">
        <p>This plugin has no UI definition.</p>
      </div>`;
      return;
    }
    this.container.innerHTML = '';
    const el = this.renderComponent(this.plugin.ui.layout);
    this.container.appendChild(el);
  }

  /** Update a component's data by ID */
  updateComponent(componentId: string, data: any): void {
    this.componentData.set(componentId, data);
    const el = this.container.querySelector(`[data-plugin-component-id="${componentId}"]`);
    if (el) {
      const component = this.findComponentDef(this.plugin.ui?.layout, componentId);
      if (component) {
        const newEl = this.renderComponent(component);
        el.replaceWith(newEl);
      }
    }
  }

  private renderComponent(def: PluginComponent): HTMLElement {
    switch (def.type) {
      case 'table': return this.renderTable(def);
      case 'detail-panel': return this.renderDetailPanel(def);
      case 'card': return this.renderCard(def);
      case 'split-panel': return this.renderSplitPanel(def);
      case 'button-group': return this.renderButtonGroup(def);
      case 'status-badge': return this.renderStatusBadge(def);
      case 'key-value': return this.renderKeyValue(def);
      case 'timeline': return this.renderTimeline(def);
      case 'tabs': return this.renderTabs(def);
      case 'form': return this.renderForm(def);
      case 'markdown': return this.renderMarkdown(def);
      case 'empty-state': return this.renderEmptyState(def);
      case 'header': return this.renderHeader(def);
      default:
        const el = document.createElement('div');
        el.textContent = `Unknown component: ${(def as any).type}`;
        return el;
    }
  }

  private renderTable(def: any): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'plugin-table-wrapper';
    if (def.id) wrapper.dataset.pluginComponentId = def.id;

    const data = (def.id ? this.componentData.get(def.id) : null) || [];
    const rows = Array.isArray(data) ? data : [];

    if (rows.length === 0) {
      wrapper.innerHTML = `<div class="plugin-table-empty">No data</div>`;
      return wrapper;
    }

    const table = document.createElement('table');
    table.className = 'plugin-table';

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const col of def.columns) {
      const th = document.createElement('th');
      th.textContent = col.label || col.key;
      if (col.width) th.style.width = `${col.width}px`;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.className = 'plugin-table-row';
      if (def.onRowClick) {
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => {
          this.selectedRows.set(def.id, row);
          // Highlight selected row
          tbody.querySelectorAll('.selected').forEach(r => r.classList.remove('selected'));
          tr.classList.add('selected');
          this.triggerCallback?.(def.onRowClick, { selectedRow: row });
        });
      }

      for (const col of def.columns) {
        const td = document.createElement('td');
        const value = row[col.key];

        if (col.component === 'status-badge' && col.colorMap) {
          const badge = document.createElement('span');
          badge.className = 'plugin-status-badge';
          badge.textContent = String(value ?? '');
          badge.style.backgroundColor = col.colorMap[String(value)] || 'var(--text-secondary)';
          td.appendChild(badge);
        } else {
          td.textContent = String(value ?? '');
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);
    return wrapper;
  }

  private renderDetailPanel(def: any): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'plugin-detail-panel';
    if (def.id) panel.dataset.pluginComponentId = def.id;

    const data = def.id ? this.componentData.get(def.id) : null;

    for (const section of def.sections || []) {
      const sectionEl = this.renderComponent(this.resolveTemplates(section, data));
      panel.appendChild(sectionEl);
    }
    return panel;
  }

  private renderCard(def: any): HTMLElement {
    const card = document.createElement('div');
    card.className = 'plugin-card';
    if (def.id) card.dataset.pluginComponentId = def.id;

    if (def.label) {
      const label = document.createElement('div');
      label.className = 'plugin-card-label';
      label.textContent = def.label;
      card.appendChild(label);
    }

    const content = document.createElement('div');
    content.className = 'plugin-card-content';
    if (def.renderAs === 'markdown') {
      // Use marked if available, else plain text
      content.innerHTML = this.escapeHtml(def.content || '');
    } else {
      content.textContent = def.content || '';
    }
    card.appendChild(content);
    return card;
  }

  private renderSplitPanel(def: any): HTMLElement {
    const split = document.createElement('div');
    split.className = 'plugin-split-panel';
    if (def.id) split.dataset.pluginComponentId = def.id;

    const direction = def.direction || 'horizontal';
    split.style.display = 'flex';
    split.style.flexDirection = direction === 'vertical' ? 'column' : 'row';
    split.style.height = '100%';

    const [leftSize, rightSize] = def.sizes || [50, 50];

    const left = document.createElement('div');
    left.className = 'plugin-split-left';
    left.style.flex = `0 0 ${leftSize}%`;
    left.style.overflow = 'auto';
    if (def.children[0]) left.appendChild(this.renderComponent(def.children[0]));

    const right = document.createElement('div');
    right.className = 'plugin-split-right';
    right.style.flex = `0 0 ${rightSize}%`;
    right.style.overflow = 'auto';
    if (def.children[1]) right.appendChild(this.renderComponent(def.children[1]));

    split.appendChild(left);
    split.appendChild(right);
    return split;
  }

  private renderButtonGroup(def: any): HTMLElement {
    const group = document.createElement('div');
    group.className = 'plugin-button-group';
    if (def.id) group.dataset.pluginComponentId = def.id;

    for (const btn of def.buttons || []) {
      const button = document.createElement('button');
      button.className = `plugin-btn ${btn.variant ? `plugin-btn-${btn.variant}` : ''}`;
      button.innerHTML = `${btn.icon ? `<span class="plugin-btn-icon">${this.escapeHtml(btn.icon)}</span>` : ''}${this.escapeHtml(btn.label)}`;
      button.addEventListener('click', () => {
        this.triggerCallback?.(btn.action);
      });
      group.appendChild(button);
    }
    return group;
  }

  private renderStatusBadge(def: any): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'plugin-status-badge';
    if (def.id) badge.dataset.pluginComponentId = def.id;
    badge.textContent = def.value || '';
    if (def.colorMap?.[def.value]) {
      badge.style.backgroundColor = def.colorMap[def.value];
    }
    return badge;
  }

  private renderKeyValue(def: any): HTMLElement {
    const kv = document.createElement('div');
    kv.className = 'plugin-key-value';
    if (def.id) kv.dataset.pluginComponentId = def.id;

    const data = def.id ? this.componentData.get(def.id) : null;
    if (data && typeof data === 'object') {
      for (const [key, value] of Object.entries(data)) {
        const row = document.createElement('div');
        row.className = 'plugin-kv-row';
        row.innerHTML = `<span class="plugin-kv-key">${this.escapeHtml(key)}</span><span class="plugin-kv-value">${this.escapeHtml(String(value))}</span>`;
        kv.appendChild(row);
      }
    }
    return kv;
  }

  private renderTimeline(def: any): HTMLElement {
    const tl = document.createElement('div');
    tl.className = 'plugin-timeline';
    if (def.id) tl.dataset.pluginComponentId = def.id;

    const data = def.id ? this.componentData.get(def.id) : null;
    const items = Array.isArray(data) ? data : [];

    for (const item of items) {
      const entry = document.createElement('div');
      entry.className = 'plugin-timeline-entry';
      entry.innerHTML = `
        <div class="plugin-timeline-dot"></div>
        <div class="plugin-timeline-content">
          <div class="plugin-timeline-time">${this.escapeHtml(String(item.time || item.timestamp || ''))}</div>
          <div class="plugin-timeline-title">${this.escapeHtml(String(item.title || ''))}</div>
          <div class="plugin-timeline-desc">${this.escapeHtml(String(item.description || ''))}</div>
        </div>`;
      tl.appendChild(entry);
    }
    return tl;
  }

  private renderTabs(def: any): HTMLElement {
    const tabs = document.createElement('div');
    tabs.className = 'plugin-tabs';
    if (def.id) tabs.dataset.pluginComponentId = def.id;

    const tabBar = document.createElement('div');
    tabBar.className = 'plugin-tabs-bar';

    const contentArea = document.createElement('div');
    contentArea.className = 'plugin-tabs-content';

    (def.items || []).forEach((item: any, i: number) => {
      const tab = document.createElement('button');
      tab.className = `plugin-tab-btn ${i === 0 ? 'active' : ''}`;
      tab.textContent = item.label;
      tab.addEventListener('click', () => {
        tabBar.querySelectorAll('.plugin-tab-btn').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        contentArea.innerHTML = '';
        if (item.content) contentArea.appendChild(this.renderComponent(item.content));
      });
      tabBar.appendChild(tab);
    });

    // Render first tab content
    if (def.items?.[0]?.content) {
      contentArea.appendChild(this.renderComponent(def.items[0].content));
    }

    tabs.appendChild(tabBar);
    tabs.appendChild(contentArea);
    return tabs;
  }

  private renderForm(def: any): HTMLElement {
    const form = document.createElement('div');
    form.className = 'plugin-form';
    if (def.id) form.dataset.pluginComponentId = def.id;

    for (const field of def.fields || []) {
      const group = document.createElement('div');
      group.className = 'plugin-form-group';
      group.innerHTML = `
        <label class="plugin-form-label">${this.escapeHtml(field.label)}</label>
        <input class="plugin-form-input" type="${field.type || 'text'}" data-key="${this.escapeHtml(field.key)}" ${field.required ? 'required' : ''} />`;
      form.appendChild(group);
    }

    if (def.onSubmit) {
      const btn = document.createElement('button');
      btn.className = 'plugin-btn';
      btn.textContent = 'Submit';
      btn.addEventListener('click', () => {
        const values: Record<string, any> = {};
        form.querySelectorAll('.plugin-form-input').forEach((input: any) => {
          values[input.dataset.key] = input.value;
        });
        this.triggerCallback?.(def.onSubmit, values);
      });
      form.appendChild(btn);
    }
    return form;
  }

  private renderMarkdown(def: any): HTMLElement {
    const md = document.createElement('div');
    md.className = 'plugin-markdown';
    if (def.id) md.dataset.pluginComponentId = def.id;
    md.textContent = def.content || '';
    return md;
  }

  private renderEmptyState(def: any): HTMLElement {
    const empty = document.createElement('div');
    empty.className = 'plugin-empty-state';
    if (def.id) empty.dataset.pluginComponentId = def.id;
    empty.innerHTML = `
      <div class="plugin-empty-title">${this.escapeHtml(def.title)}</div>
      <div class="plugin-empty-desc">${this.escapeHtml(def.description || '')}</div>
      ${def.action ? `<button class="plugin-btn plugin-empty-action">${this.escapeHtml(def.action.label)}</button>` : ''}`;
    if (def.action) {
      empty.querySelector('.plugin-empty-action')?.addEventListener('click', () => {
        this.triggerCallback?.(def.action.trigger);
      });
    }
    return empty;
  }

  private renderHeader(def: any): HTMLElement {
    const header = document.createElement('div');
    header.className = 'plugin-header';
    if (def.id) header.dataset.pluginComponentId = def.id;
    header.innerHTML = `
      <h2 class="plugin-header-title">${this.escapeHtml(def.title || '')}</h2>
      ${def.subtitle ? `<div class="plugin-header-subtitle">${this.escapeHtml(def.subtitle)}</div>` : ''}`;
    return header;
  }

  /** Replace {{property}} templates with data values */
  private resolveTemplates(component: any, data: any): any {
    if (!data) return component;
    const str = JSON.stringify(component);
    const resolved = str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = data[key];
      return val !== undefined ? String(val) : '';
    });
    return JSON.parse(resolved);
  }

  /** Find a component definition by ID (recursive) */
  private findComponentDef(component: PluginComponent | undefined, id: string): PluginComponent | null {
    if (!component) return null;
    if ((component as any).id === id) return component;
    // Check children recursively
    if ('children' in component && Array.isArray((component as any).children)) {
      for (const child of (component as any).children) {
        const found = this.findComponentDef(child, id);
        if (found) return found;
      }
    }
    if ('sections' in component && Array.isArray((component as any).sections)) {
      for (const section of (component as any).sections) {
        const found = this.findComponentDef(section, id);
        if (found) return found;
      }
    }
    if ('items' in component && Array.isArray((component as any).items)) {
      for (const item of (component as any).items) {
        if (item.content) {
          const found = this.findComponentDef(item.content, id);
          if (found) return found;
        }
      }
    }
    return null;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
```

**Step 2: Commit**

```bash
git add src/renderer/components/plugin-tab-renderer.ts
git commit -m "feat(plugins): add plugin tab renderer with component catalog"
```

---

## Task 9: Add Plugin CSS Styles

**Files:**
- Create: `src/renderer/styles/plugins.css`

**Step 1: Create plugin component styles**

Create a CSS file with styles for all plugin components. These should use existing CSS variables so plugins match the native theme.

Key classes to style:
- `.plugin-table`, `.plugin-table-row`, `.plugin-table-empty`
- `.plugin-detail-panel`
- `.plugin-card`, `.plugin-card-label`, `.plugin-card-content`
- `.plugin-split-panel`
- `.plugin-button-group`, `.plugin-btn`
- `.plugin-status-badge`
- `.plugin-key-value`, `.plugin-kv-row`, `.plugin-kv-key`, `.plugin-kv-value`
- `.plugin-timeline`, `.plugin-timeline-entry`, `.plugin-timeline-dot`
- `.plugin-tabs`, `.plugin-tabs-bar`, `.plugin-tab-btn`
- `.plugin-form`, `.plugin-form-group`, `.plugin-form-label`, `.plugin-form-input`
- `.plugin-markdown`
- `.plugin-empty-state`
- `.plugin-header`
- `.plugin-log-panel`

All colors should reference CSS variables like `var(--bg-primary)`, `var(--text-primary)`, `var(--border-color)`, `var(--accent-color)` etc. that already exist in the app's theme.

**Step 2: Import the CSS in index.html**

Add `<link rel="stylesheet" href="./styles/plugins.css">` in the `<head>` of `src/renderer/index.html`.

**Step 3: Commit**

```bash
git add src/renderer/styles/plugins.css src/renderer/index.html
git commit -m "feat(plugins): add CSS styles for plugin component catalog"
```

---

## Task 10: Integrate Plugins into Renderer App

**Files:**
- Modify: `src/renderer/components/section-sidebar.ts`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/app.ts`

**Step 1: Make SectionSidebar support dynamic sections**

In `src/renderer/components/section-sidebar.ts`:

1. Change `SectionId` type to accept strings: `export type SectionId = 'review' | 'workItems' | 'terminals' | 'settings' | 'about' | string;`
2. Add a public method `addSection(section: SectionDef)` that appends to the `SECTIONS` array equivalent and re-renders.
3. Add a public method `removeSection(sectionId: string)` that removes a dynamic section.

Store dynamic sections in an instance array (separate from the static `SECTIONS` const) and render both in `render()`.

**Step 2: Add plugin container to index.html**

In `src/renderer/index.html`, after the about section content div (around line 77), add:

```html
          <!-- Plugin Section Contents (dynamically populated) -->
          <div id="pluginSectionContents"></div>
```

**Step 3: Add plugin initialization to app.ts**

In `src/renderer/app.ts`:

1. Import `PluginTabRenderer` and plugin types
2. Add a `pluginRenderers: Map<string, PluginTabRenderer>` property
3. In `constructor()`, after existing init calls, add `this.initPlugins()`
4. Implement `initPlugins()`:
   - Call `tauriAPI.pluginGetPlugins()` to get loaded plugins
   - For each enabled plugin with a `ui` definition:
     - Add a section to the sidebar via `sectionSidebar.addSection()`
     - Create a `<div class="section-content hidden" id="pluginSection-{pluginId}">` inside `#pluginSectionContents`
     - Create a `PluginTabRenderer` for that container
     - Render the plugin UI
     - Wire up trigger callbacks to call `tauriAPI.pluginExecuteTrigger()`
5. In `switchSection()`, handle plugin sections by toggling the correct `pluginSection-{id}` div
6. Subscribe to plugin events:
   - `tauriAPI.onPluginUIUpdate()` → call `renderer.updateComponent()`
   - `tauriAPI.onPluginUIToast()` → call `Toast.success/error/info()`
   - `tauriAPI.onPluginsReloaded()` → re-initialize plugins

**Step 4: Commit**

```bash
git add src/renderer/components/section-sidebar.ts src/renderer/index.html src/renderer/app.ts
git commit -m "feat(plugins): integrate plugin tabs into renderer app"
```

---

## Task 11: Add Plugin Settings UI

**Files:**
- Modify: `src/renderer/components/settings-view.ts`

**Step 1: Add a "Plugins" section to the settings view**

In the settings view's `render()` method, add a new section after existing settings sections:

- Section header: "Plugins"
- For each loaded plugin:
  - Plugin name + version + description
  - Enable/disable toggle
  - Config fields (rendered from `manifest.config`)
  - Save button per plugin
- Wire save button to call `tauriAPI.pluginSaveConfig()`
- Wire toggle to call `tauriAPI.pluginSetEnabled()`

**Step 2: Commit**

```bash
git add src/renderer/components/settings-view.ts
git commit -m "feat(plugins): add plugin configuration section to settings"
```

---

## Task 12: Create SDK Type Definitions and Schema Files

**Files:**
- Create: `src/main/plugins/schema/plugin-sdk.d.ts`
- Create: `src/main/plugins/schema/plugin-schema.json`
- Create: `src/main/plugins/schema/README.md`

**Step 1: Create SDK type definitions for LLMs**

`plugin-sdk.d.ts` should export a clean `PluginContext` interface that LLMs can reference:

```ts
export interface PluginContext {
  input: Record<string, any>;
  config: Record<string, any>;

  http: {
    get(url: string, opts?: { headers?: Record<string, string> }): Promise<any>;
    post(url: string, body: any, opts?: { headers?: Record<string, string> }): Promise<any>;
    put(url: string, body: any, opts?: { headers?: Record<string, string> }): Promise<any>;
    delete(url: string, opts?: { headers?: Record<string, string> }): Promise<any>;
  };

  shell: {
    run(command: string, opts?: { cwd?: string; timeout?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  };

  ai: {
    claude(prompt: string): Promise<string>;
    copilot(prompt: string): Promise<string>;
  };

  ui: {
    update(componentId: string, data: any): Promise<void>;
    toast(message: string, level?: 'success' | 'error' | 'warning' | 'info'): Promise<void>;
    inject(tab: string, location: string, component: any): Promise<void>;
  };

  store: {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<void>;
    delete(key: string): Promise<void>;
  };

  log: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
  };

  run(triggerId: string, input?: any): Promise<void>;
}
```

**Step 2: Create JSON Schema for manifest and UI validation**

`plugin-schema.json` should define the valid structure of `manifest.json` and `ui.json` as a JSON Schema document.

**Step 3: Create README for LLM context**

`README.md` should explain the plugin format, available components, triggers, hooks, and link to the schema and type definitions. This is what an LLM reads to understand how to generate plugins.

**Step 4: Add a copy step**

Add logic in `plugin-engine.ts` `initialize()` to copy the schema files to `~/.taskdock/plugins/_schema/` so they're accessible to external AI tools.

**Step 5: Commit**

```bash
git add src/main/plugins/schema/
git commit -m "feat(plugins): add SDK types, JSON schema, and LLM reference docs"
```

---

## Task 13: Create Example Plugins

**Files:**
- Create: `src/main/plugins/examples/incident-manager/manifest.json`
- Create: `src/main/plugins/examples/incident-manager/ui.json`
- Create: `src/main/plugins/examples/incident-manager/workflows/poll-incidents.ts`
- Create: `src/main/plugins/examples/incident-manager/workflows/run-analysis.ts`
- Create: `src/main/plugins/examples/pr-build-watcher/manifest.json`
- Create: `src/main/plugins/examples/pr-build-watcher/ui.json`
- Create: `src/main/plugins/examples/pr-build-watcher/workflows/build-and-review.ts`

**Step 1: Create the incident-manager example plugin**

Use the examples from the design doc. This serves both as documentation and as a test fixture.

**Step 2: Create the pr-build-watcher example plugin**

A simple plugin that hooks a button into PR Review toolbar, waits for a build, then triggers AI review.

**Step 3: Add copy logic**

In `plugin-engine.ts` `initialize()`, copy examples to `~/.taskdock/plugins/_examples/` if they don't already exist.

**Step 4: Commit**

```bash
git add src/main/plugins/examples/
git commit -m "feat(plugins): add example plugins for LLM reference"
```

---

## Task 14: Add Hook Points to Built-in Tab Components

**Files:**
- Modify: `src/renderer/app.ts`

**Step 1: Add hook rendering logic**

In `app.ts`, after plugins are loaded:

1. Collect all hook definitions from all enabled plugins
2. For `pr-review` toolbar hooks: insert plugin buttons into the PR review toolbar
3. For `pr-home` row-action hooks: add action buttons to PR list rows
4. When a hooked button is clicked, call `tauriAPI.pluginExecuteTrigger()` with the appropriate context (PR data, selected file, etc.)
5. Subscribe to `plugin:ui-inject` events to render injected components into core tabs

**Step 2: Commit**

```bash
git add src/renderer/app.ts
git commit -m "feat(plugins): add hook points in built-in PR and work item tabs"
```

---

## Task 15: End-to-End Test with Example Plugin

**Step 1: Create a test plugin**

Create `~/.taskdock/plugins/hello-world/` with:

- `manifest.json`: One manual trigger
- `ui.json`: Simple card + button
- `workflows/greet.ts`: Calls `ctx.ui.update` and `ctx.ui.toast`

**Step 2: Run the app in dev mode**

Run: `npm run dev`

**Step 3: Verify**

- Plugin appears in sidebar
- Plugin tab renders the UI
- Clicking the button triggers the workflow
- Toast notification appears
- Plugin appears in Settings with enable/disable toggle

**Step 4: Commit test plugin as an example**

```bash
git add src/main/plugins/examples/hello-world/
git commit -m "feat(plugins): add hello-world example plugin for testing"
```

---

## Dependency Summary

| Task | Depends On |
|------|-----------|
| Task 1: Shared Types | None |
| Task 2: Plugin Loader | Task 1 |
| Task 3: Script Runner | Task 1 |
| Task 4: Scheduler | Task 1 |
| Task 5: Plugin Engine | Tasks 2, 3, 4 |
| Task 6: Bridge Wiring | Task 5 |
| Task 7: Frontend API | Task 6 |
| Task 8: Tab Renderer | Task 1 |
| Task 9: CSS Styles | None |
| Task 10: App Integration | Tasks 7, 8, 9 |
| Task 11: Settings UI | Task 7 |
| Task 12: Schema Files | Task 1 |
| Task 13: Example Plugins | Task 12 |
| Task 14: Hook Points | Task 10 |
| Task 15: E2E Test | All previous |

Tasks 1-4 can be parallelized. Tasks 8, 9, 12 can be parallelized with Tasks 5-7.
