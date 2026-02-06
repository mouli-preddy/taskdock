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
