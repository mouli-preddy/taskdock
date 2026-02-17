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
  PluginNavigateEvent,
  HookTrigger,
} from '../../shared/plugin-types.js';

export class PluginEngine extends EventEmitter {
  private loader: PluginLoader;
  private runner: PluginScriptRunner;
  private scheduler: PluginScheduler;
  private executionLogs: Map<string, PluginExecutionLog[]> = new Map();
  private hookRegistry: Map<string, { pluginId: string; triggerId: string; workflow: string }[]> = new Map();
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
      onNavigate: (pluginId, section) => {
        this.emit('ui:navigate', { pluginId, section } as PluginNavigateEvent);
      },
      onAIClaude: async (pluginId, prompt, opts) => {
        return this.callClaude(prompt, opts);
      },
      onAICopilot: async (pluginId, prompt, opts) => {
        return this.callCopilot(prompt, opts);
      },
      onAILaunchTerminal: async (pluginId, opts) => {
        return this.launchAITerminal(pluginId, opts);
      },
    });

    this.scheduler = new PluginScheduler({
      executeTrigger: async (plugin, triggerId, input) => {
        await this.executeTrigger(plugin.id, triggerId, input);
      },
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

    // Build hook registry
    this.buildHookRegistry();

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
    this.buildHookRegistry();
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

  /** Build the hook registry from all enabled plugins' hook triggers */
  private buildHookRegistry(): void {
    this.hookRegistry.clear();
    const plugins = this.loader.getAllPlugins();
    for (const plugin of plugins) {
      if (!plugin.enabled) continue;
      for (const trigger of plugin.manifest.triggers) {
        if (trigger.type !== 'hook') continue;
        const hookTrigger = trigger as HookTrigger;
        const entries = this.hookRegistry.get(hookTrigger.event) || [];
        entries.push({ pluginId: plugin.id, triggerId: trigger.id, workflow: trigger.workflow });
        this.hookRegistry.set(hookTrigger.event, entries);
      }
    }
  }

  /** Fire an app event — runs matching hook workflows in the background (fire-and-forget) */
  emitAppEvent(event: string, data: Record<string, any>): void {
    const hooks = this.hookRegistry.get(event);
    if (!hooks || hooks.length === 0) return;

    const logger = getLogger();
    for (const hook of hooks) {
      this.executeTrigger(hook.pluginId, hook.triggerId, { event, ...data }).catch(err => {
        logger.error('PluginEngine', `Hook ${hook.triggerId} (plugin ${hook.pluginId}) failed for event ${event}`, { error: err?.message });
      });
    }
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
      this.buildHookRegistry();
      this.emit('plugin:reloaded', { pluginId: existing.id });
      logger.info('PluginEngine', `Reloaded plugin: ${existing.id}`);
    } else {
      // New plugin - reload all
      this.scheduler.stopAll();
      const allPlugins = this.loader.loadAll();
      for (const p of allPlugins) {
        if (p.enabled) this.scheduler.startPlugin(p);
      }
      this.buildHookRegistry();
      this.emit('plugins:reloaded', {});
      logger.info('PluginEngine', 'Reloaded all plugins (new plugin detected)');
    }
  }

  /** Call Claude SDK with a prompt and return the text response */
  private async callClaude(prompt: string, opts: any): Promise<string> {
    const logger = getLogger();
    logger.info('PluginEngine', 'Plugin AI call: Claude SDK', { model: opts?.model || 'sonnet' });

    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const model = opts?.model || 'sonnet';
    const response = query({ prompt, options: { model, maxTurns: 1 } });
    let result = '';
    for await (const message of response) {
      if (message.type === 'result' && (message as any).result) {
        result = (message as any).result;
      }
    }
    return result;
  }

  /** Call Copilot SDK with a prompt and return the text response */
  private async callCopilot(prompt: string, opts: any): Promise<string> {
    const logger = getLogger();
    logger.info('PluginEngine', 'Plugin AI call: Copilot SDK', { model: opts?.model || 'gpt-4o' });

    const { CopilotClient } = await import('@github/copilot-sdk');
    if (!this._copilotClient || this._copilotClient.getState() === 'error' || this._copilotClient.getState() === 'disconnected') {
      const client = new CopilotClient();
      await client.start();
      this._copilotClient = client;
    }
    const model = opts?.model || 'gpt-4o';
    const session = await this._copilotClient.createSession({ model });
    try {
      const response = await session.sendAndWait({ prompt }, 120000);
      if (!response) return '';
      // Extract text content from the assistant message
      const content = response.data?.content;
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('');
      }
      return String(content || '');
    } finally {
      await session.destroy();
    }
  }

  private _copilotClient: any = null;

  /** Launch an interactive AI terminal session via the bridge */
  private async launchAITerminal(pluginId: string, opts: { ai: 'copilot' | 'claude'; prompt: string; show?: boolean }): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.emit('ai:launch-terminal', {
        pluginId,
        ...opts,
        callback: (sessionId: string, error?: string) => {
          if (error) reject(new Error(error));
          else resolve(sessionId);
        },
      });
    });
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
    if (this._copilotClient) {
      this._copilotClient.stop().catch(() => {});
      this._copilotClient = null;
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
