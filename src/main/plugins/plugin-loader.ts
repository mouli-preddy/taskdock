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

  /** Reload a single plugin by ID. Removes the plugin from the map if its directory no longer exists. */
  reloadPlugin(pluginId: string): LoadedPlugin | null {
    const existing = this.plugins.get(pluginId);
    if (!existing) return null;

    const savedConfig = this.loadSavedConfig();
    const plugin = this.loadPlugin(existing.path, savedConfig);
    if (plugin) {
      this.plugins.set(plugin.id, plugin);
      // If the plugin ID changed (manifest edited), remove the old entry
      if (plugin.id !== pluginId) {
        this.plugins.delete(pluginId);
      }
    } else {
      this.plugins.delete(pluginId);
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
