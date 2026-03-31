import { Toast } from './toast.js';
import type { ConsoleReviewSettings, MonitoredRepository } from '../../shared/terminal-types.js';
import { DEFAULT_CONSOLE_REVIEW_SETTINGS } from '../../shared/terminal-types.js';
import type { PollingSettings, NotificationSettings } from '../../shared/types.js';
import { DEFAULT_POLLING_SETTINGS, DEFAULT_NOTIFICATION_SETTINGS } from '../../shared/types.js';
import { escapeHtml } from '../utils/html-utils.js';
import { notificationService } from '../services/notification-service.js';
import { getIcon, Eye, Plus, X, Globe, MessageSquare, Wand2, Search, Server } from '../utils/icons.js';

export interface ReviewSettings {
  organization: string;
  project: string;
  pat: string;
  anthropicApiKey?: string;
}

export interface ServiceEntry {
  id: string;
  name: string;
  description: string;
  repoPath: string;
  linkedServiceIds: string[];
}

export class SettingsView {
  private container: HTMLElement;
  private settings: ReviewSettings = { organization: 'domoreexp', project: 'MSTeams', pat: '', anthropicApiKey: '' };
  private consoleReviewSettings: ConsoleReviewSettings = { ...DEFAULT_CONSOLE_REVIEW_SETTINGS };
  private pollingSettings: PollingSettings = { ...DEFAULT_POLLING_SETTINGS };
  private notificationSettings: NotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS };
  private autostartEnabled: boolean = false;
  private saveCallback: ((settings: ReviewSettings) => Promise<void>) | null = null;
  private testCallback: ((settings: ReviewSettings) => Promise<boolean>) | null = null;
  private consoleSettingsSavedCallback: ((settings: ConsoleReviewSettings) => void) | null = null;
  private pollingSettingsSavedCallback: ((settings: PollingSettings) => void) | null = null;
  private notificationSettingsSavedCallback: ((settings: NotificationSettings) => void) | null = null;
  private services: ServiceEntry[] = [];
  private scrubPatterns: Array<{ name: string; letter: string; regex: string; enabled: boolean; isDefault: boolean }> = [];
  private activeSettingsTab: string = 'connection';

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.render();
    this.loadConsoleReviewSettings();
    this.loadPollingSettings();
    this.loadNotificationSettings();
    this.loadAutostartSetting();
    this.loadPlugins();
    this.loadServices();
    this.loadScrubPatterns();
    this.attachReloadAllHandler();
  }

  async loadPlugins(): Promise<void> {
    try {
      const plugins = await window.electronAPI.pluginGetPlugins();
      const container = this.container.querySelector('#pluginSettingsList');
      if (!container) return;

      if (plugins.length === 0) {
        container.innerHTML = '<p class="text-muted">No plugins installed. Add plugins to ~/.taskdock/plugins/</p>';
        return;
      }

      container.innerHTML = plugins.map((plugin: any) => `
        <div class="plugin-settings-item" data-plugin-id="${plugin.id}">
          <div class="plugin-settings-header">
            <div class="plugin-settings-info">
              <span class="plugin-settings-name">${escapeHtml(plugin.name)}</span>
              <span class="plugin-settings-version">v${escapeHtml(plugin.version)}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <button class="btn btn-secondary btn-sm plugin-reload-btn" data-plugin-id="${plugin.id}" title="Reload plugin">Reload</button>
              <label class="toggle-switch">
                <input type="checkbox" class="plugin-toggle" data-plugin-id="${plugin.id}" ${plugin.enabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
          ${plugin.description ? `<p class="plugin-settings-desc">${escapeHtml(plugin.description)}</p>` : ''}
          ${plugin.manifest?.config ? this.renderPluginConfigFields(plugin) : ''}
        </div>
      `).join('');

      // Attach toggle handlers
      container.querySelectorAll('.plugin-toggle').forEach(toggle => {
        toggle.addEventListener('change', async (e) => {
          const el = e.target as HTMLInputElement;
          const pluginId = el.dataset.pluginId!;
          await window.electronAPI.pluginSetEnabled(pluginId, el.checked);
        });
      });

      // Attach config save handlers
      container.querySelectorAll('.plugin-config-save').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const el = e.currentTarget as HTMLElement;
          const pluginId = el.dataset.pluginId!;
          const item = container.querySelector(`.plugin-settings-item[data-plugin-id="${pluginId}"]`);
          if (!item) return;

          const config: Record<string, any> = {};
          item.querySelectorAll('.plugin-config-input').forEach(input => {
            const inp = input as HTMLInputElement;
            const key = inp.dataset.configKey!;
            const type = inp.dataset.configType!;
            if (type === 'boolean') {
              config[key] = inp.checked;
            } else if (type === 'number') {
              config[key] = Number(inp.value);
            } else {
              config[key] = inp.value;
            }
          });

          try {
            await window.electronAPI.pluginSaveConfig(pluginId, config);
            Toast.success(`Plugin "${pluginId}" configuration saved`);
          } catch (err: any) {
            Toast.error(err.message || 'Failed to save plugin config');
          }
        });
      });
      // Attach per-plugin reload handlers
      container.querySelectorAll('.plugin-reload-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const el = e.currentTarget as HTMLButtonElement;
          const pluginId = el.dataset.pluginId!;
          el.disabled = true;
          el.textContent = 'Reloading...';
          try {
            await window.electronAPI.pluginReload(pluginId);
            // Toast is shown by onPluginReloaded event handler in app.ts
            await this.loadPlugins(); // Refresh the settings list
          } catch (err: any) {
            Toast.error(err.message || `Failed to reload plugin "${pluginId}"`);
          } finally {
            el.disabled = false;
            el.textContent = 'Reload';
          }
        });
      });
    } catch (err: any) {
      console.error('Failed to load plugins:', err);
      Toast.error(err?.message || 'Failed to load plugins');
    }
  }

  /** One-time handler for the static "Reload All" button (not inside the dynamic plugin list) */
  private attachReloadAllHandler(): void {
    const reloadAllBtn = this.container.querySelector('#reloadAllPluginsBtn') as HTMLButtonElement | null;
    if (reloadAllBtn) {
      reloadAllBtn.addEventListener('click', async () => {
        reloadAllBtn.disabled = true;
        reloadAllBtn.textContent = 'Reloading...';
        try {
          await window.electronAPI.pluginReloadAll();
          // Toast is shown by onPluginsReloaded event handler in app.ts
          await this.loadPlugins(); // Refresh the settings list
        } catch (err: any) {
          Toast.error(err.message || 'Failed to reload plugins');
        } finally {
          reloadAllBtn.disabled = false;
          reloadAllBtn.textContent = 'Reload All';
        }
      });
    }
  }

  private renderPluginConfigFields(plugin: any): string {
    const fields = Object.entries(plugin.manifest.config || {});
    if (fields.length === 0) return '';

    return `
      <div class="plugin-config-fields">
        ${fields.map(([key, field]: [string, any]) => {
          const value = plugin.config?.[key] ?? field.default ?? '';
          if (field.type === 'boolean') {
            return `
              <div class="form-group plugin-config-group">
                <label>
                  <input type="checkbox" class="plugin-config-input" data-config-key="${key}" data-config-type="boolean" ${value ? 'checked' : ''}>
                  ${escapeHtml(field.label)}
                </label>
              </div>
            `;
          }
          return `
            <div class="form-group plugin-config-group">
              <label>${escapeHtml(field.label)}${field.required ? ' *' : ''}</label>
              <input type="${field.secret ? 'password' : field.type === 'number' ? 'number' : 'text'}"
                class="plugin-config-input" data-config-key="${key}" data-config-type="${field.type}"
                value="${escapeHtml(String(value))}"
                placeholder="${escapeHtml(field.label)}">
            </div>
          `;
        }).join('')}
        <button class="btn btn-secondary plugin-config-save" data-plugin-id="${plugin.id}">Save Plugin Config</button>
      </div>
    `;
  }

  onSave(callback: (settings: ReviewSettings) => Promise<void>) {
    this.saveCallback = callback;
  }

  onTest(callback: (settings: ReviewSettings) => Promise<boolean>) {
    this.testCallback = callback;
  }

  onConsoleSettingsSaved(callback: (settings: ConsoleReviewSettings) => void) {
    this.consoleSettingsSavedCallback = callback;
  }

  onPollingSettingsSaved(callback: (settings: PollingSettings) => void) {
    this.pollingSettingsSavedCallback = callback;
  }

  onNotificationSettingsSaved(callback: (settings: NotificationSettings) => void) {
    this.notificationSettingsSavedCallback = callback;
  }

  setSettings(settings: Partial<ReviewSettings>) {
    this.settings = { ...this.settings, ...settings };
    this.updateFormValues();
  }

  getSettings(): ReviewSettings {
    return { ...this.settings };
  }

  private render() {
    this.container.innerHTML = `
      <div class="settings-view">
        <div class="settings-header">
          <h1 class="settings-page-title">Settings</h1>
          <button type="button" class="btn btn-primary" id="saveAllSettingsBtn">
            <span class="btn-text">Save All Settings</span>
            <span class="btn-loading">
              <span class="spinner"></span>
              Saving...
            </span>
          </button>
        </div>
        <div class="settings-tabs">
          <button class="settings-tab-btn active" data-settings-tab="connection">Connection</button>
          <button class="settings-tab-btn" data-settings-tab="review">Review</button>
          <button class="settings-tab-btn" data-settings-tab="ai">AI</button>
          <button class="settings-tab-btn" data-settings-tab="services">Services</button>
          <button class="settings-tab-btn" data-settings-tab="privacy">Privacy</button>
          <button class="settings-tab-btn" data-settings-tab="ui">UI</button>
        </div>
        <div class="settings-content">

          <!-- UI Tab -->
          <div class="settings-tab-content" data-tab-content="ui">
            <div class="settings-section">
              <h2 class="settings-section-title">Appearance</h2>
              <p class="settings-section-description">Choose how TaskDock looks on your device.</p>
              <div class="theme-selector" id="themeSelector">
                <button type="button" class="theme-option" data-theme-value="dark" title="Dark">
                  <span class="theme-option-icon">🌙</span>
                  <span class="theme-option-label">Dark</span>
                </button>
                <button type="button" class="theme-option" data-theme-value="light" title="Light">
                  <span class="theme-option-icon">☀️</span>
                  <span class="theme-option-label">Light</span>
                </button>
                <button type="button" class="theme-option" data-theme-value="auto" title="Use device setting">
                  <span class="theme-option-icon">💻</span>
                  <span class="theme-option-label">Auto</span>
                </button>
              </div>
            </div>
            <div class="settings-section">
              <h2 class="settings-section-title">Diagnostics</h2>
              <p class="settings-section-description">Open the application log file to diagnose issues.</p>
              <button type="button" class="btn btn-secondary" id="openLogFileBtn">Open Log File</button>
            </div>
          </div>

          <!-- Connection Tab -->
          <div class="settings-tab-content active" data-tab-content="connection">

            <div class="settings-section">
              <h2 class="settings-section-title">Azure DevOps Connection</h2>
              <p class="settings-section-description">Configure your Azure DevOps connection to browse and review pull requests.</p>

              <form class="settings-form" id="settingsForm">
                <div class="form-group">
                  <label for="settingsAdoUrl">Quick Setup from URL</label>
                  <input type="text" id="settingsAdoUrl" placeholder="https://org.visualstudio.com/Project/_workitems/edit/123" autocomplete="off" spellcheck="false">
                  <span class="form-hint" id="settingsAdoUrlHint">Paste any work item or repo URL to auto-fill organization and project.</span>
                </div>

                <div class="form-group">
                  <label for="settingsOrganization">Organization</label>
                  <input type="text" id="settingsOrganization" placeholder="e.g., domoreexp" required>
                  <span class="form-hint">Your Azure DevOps organization name</span>
                </div>

                <div class="form-group">
                  <label for="settingsProject">Project</label>
                  <input type="text" id="settingsProject" placeholder="e.g., MSTeams" required>
                  <span class="form-hint">The project containing your repositories</span>
                </div>

                <div class="form-group">
                  <label for="settingsPat">Personal Access Token (Optional)</label>
                  <div class="input-with-toggle">
                    <input type="password" id="settingsPat" placeholder="Leave empty to use Azure CLI auth">
                    <button type="button" class="btn btn-icon toggle-visibility" id="togglePatVisibility" title="Show/hide">
                      ${getIcon(Eye, 16)}
                    </button>
                  </div>
                  <span class="form-hint">Optional: Provide a PAT if not using <code>az login</code></span>
                </div>

                <div class="form-actions">
                  <button type="button" class="btn btn-secondary" id="testConnectionBtn">
                    <span class="btn-text">Test Connection</span>
                    <span class="btn-loading">
                      <span class="spinner"></span>
                      Testing...
                    </span>
                  </button>
                </div>
              </form>

              <div class="connection-status" id="connectionStatus"></div>
            </div>

            <div class="settings-section">
              <h3 class="settings-section-title">Authentication Help</h3>
              <div class="settings-help">
                <p>You can authenticate using either:</p>
                <ol>
                  <li><strong>Azure CLI (Recommended):</strong> Run <code>az login</code> in your terminal</li>
                  <li><strong>Personal Access Token:</strong> Create a PAT with "Code (Read)" scope</li>
                </ol>
              </div>
            </div>

            <div class="settings-section full-width">
              <h2 class="settings-section-title">Monitored Repositories</h2>
              <p class="settings-section-description">Add Azure DevOps repositories to monitor. Pull requests from these repositories will appear in a separate tab on the home page.</p>

              <div class="form-group">
                <label>Repository URLs</label>
                <div class="repo-list" id="monitoredReposList"></div>
                <div class="monitored-repo-add-form">
                  <input type="text" id="monitoredRepoUrl" placeholder="https://dev.azure.com/org/project/_git/repo" class="monitored-repo-input">
                  <button type="button" class="btn btn-secondary btn-sm" id="addMonitoredRepoBtn">
                    ${getIcon(Plus, 14)}
                    Add
                  </button>
                </div>
                <span class="form-hint">Enter Azure DevOps repository URLs (dev.azure.com or visualstudio.com). PRs from these repos will show in the "Monitored" tab.</span>
              </div>
            </div>
          </div>

          <!-- Review Tab -->
          <div class="settings-tab-content" data-tab-content="review">
            <div class="settings-section full-width">
              <h2 class="settings-section-title">Console Review (Deep Review)</h2>
              <p class="settings-section-description">Configure how console-based AI reviews work with your local repositories.</p>

              <div class="form-group">
                <label>Linked Repositories</label>
                <div class="repo-list" id="linkedReposList"></div>
                <button type="button" class="btn btn-secondary btn-sm" id="addRepoBtn">
                  ${getIcon(Plus, 14)}
                  Add Repository
                </button>
                <span class="form-hint">Git repositories to link with ADO PRs (matched by remote origin URL)</span>
              </div>

              <div class="form-group">
                <label for="whenRepoFound">When Local Repository Found</label>
                <select id="whenRepoFound">
                  <option value="worktree">Use git worktree (Recommended)</option>
                  <option value="ask">Ask me each time</option>
                  <option value="tempOnly">Always use temp folder only</option>
                </select>
                <span class="form-hint">What to do when a matching local repository is found</span>
              </div>

              <div class="form-group">
                <label for="whenRepoNotFound">When No Local Repository</label>
                <select id="whenRepoNotFound">
                  <option value="immediate">Proceed without repo context</option>
                  <option value="ask">Ask me each time</option>
                  <option value="clone">Clone repository first</option>
                </select>
                <span class="form-hint">What to do when no matching local repository is found</span>
              </div>

              <div class="form-group">
                <label for="worktreeCleanup">Worktree Cleanup</label>
                <select id="worktreeCleanup">
                  <option value="auto">Auto-cleanup after review</option>
                  <option value="ask">Ask me each time</option>
                  <option value="never">Keep worktrees</option>
                </select>
                <span class="form-hint">How to handle git worktrees after review completes</span>
              </div>

              <div class="form-group checkbox-group">
                <label>
                  <input type="checkbox" id="autoCloseTerminal">
                  <span>Auto-close terminal when review completes</span>
                </label>
              </div>

              <div class="form-group checkbox-group">
                <label>
                  <input type="checkbox" id="showNotification">
                  <span>Show notification when review completes</span>
                </label>
              </div>

              <div class="form-group">
                <label for="generatedFilePatterns">Generated File Patterns</label>
                <textarea id="generatedFilePatterns" rows="3" placeholder="*.g.cs&#10;*.generated.ts&#10;*.json"></textarea>
                <span class="form-hint">Glob patterns for generated files (one per line). These files will be hidden by default in PRs and marked as generated for AI review.</span>
              </div>

              <div class="form-group checkbox-group">
                <label>
                  <input type="checkbox" id="enableWorkIQ">
                  <span>Enable WorkIQ context gathering</span>
                </label>
                <span class="form-hint">When enabled, AI will use WorkIQ to gather context from your recent meetings related to this PR.</span>
              </div>
            </div>

            <div class="settings-section">
              <h2 class="settings-section-title">PR Polling</h2>
              <p class="settings-section-description">Configure automatic polling for PR updates (new commits, comments).</p>

              <div class="form-group checkbox-group">
                <label>
                  <input type="checkbox" id="pollingEnabled">
                  <span>Enable automatic polling for open PR tabs</span>
                </label>
              </div>

              <div class="form-group">
                <label for="pollingInterval">Polling Interval (seconds)</label>
                <input type="number" id="pollingInterval" min="10" max="300" step="5" value="30">
                <span class="form-hint">How often to check for updates (10-300 seconds)</span>
              </div>
            </div>
          </div>

          <!-- AI Tab -->
          <div class="settings-tab-content" data-tab-content="ai">
            <div class="settings-section">
              <h2 class="settings-section-title">Anthropic API Key</h2>
              <p class="settings-section-description">Used for AI-Automated task execution in the Tasks section.</p>
              <div class="form-group">
                <label class="form-label" for="settingsAnthropicApiKey">API Key</label>
                <div class="pat-input-wrapper">
                  <input type="password" id="settingsAnthropicApiKey" class="form-input"
                    placeholder="sk-ant-..." autocomplete="off" />
                  <button type="button" class="btn btn-icon" id="toggleAnthropicKeyVisibility" title="Show/hide">
                    ${getIcon(Eye, 16)}
                  </button>
                </div>
                <span class="form-hint">Get your API key from <a href="https://console.anthropic.com/" target="_blank">console.anthropic.com</a></span>
              </div>
            </div>

            <div class="settings-section">
              <h2 class="settings-section-title">AI Providers</h2>
              <p class="settings-section-description">Configure AI providers for comment analysis and applying fixes.</p>

              <div class="ai-provider-cards">
                <div class="ai-provider-card">
                  <div class="ai-provider-header">
                    <div class="ai-provider-title-group">
                      <span class="ai-provider-icon">${getIcon(MessageSquare, 16)}</span>
                      <span class="ai-provider-title">Analyze Comments</span>
                    </div>
                  </div>
                  <div class="ai-provider-settings">
                    <div class="ai-provider-row">
                      <select id="analyzeCommentsProvider" class="ai-provider-select">
                        <option value="claude-sdk">Claude SDK</option>
                        <option value="claude-terminal">Claude Terminal</option>
                        <option value="copilot-sdk">Copilot SDK</option>
                        <option value="copilot-terminal">Copilot Terminal</option>
                      </select>
                      <label class="ai-provider-checkbox">
                        <input type="checkbox" id="analyzeCommentsShowTerminal">
                        <span>Show terminal</span>
                      </label>
                      <div class="ai-provider-timeout">
                        <input type="number" id="analyzeCommentsTimeout" min="1" max="30" value="5">
                        <span>min</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="ai-provider-card">
                  <div class="ai-provider-header">
                    <div class="ai-provider-title-group">
                      <span class="ai-provider-icon">${getIcon(Wand2, 16)}</span>
                      <span class="ai-provider-title">Apply Changes</span>
                    </div>
                  </div>
                  <div class="ai-provider-settings">
                    <div class="ai-provider-row">
                      <select id="applyChangesProvider" class="ai-provider-select">
                        <option value="claude-sdk">Claude SDK</option>
                        <option value="claude-terminal">Claude Terminal</option>
                        <option value="copilot-sdk">Copilot SDK</option>
                        <option value="copilot-terminal">Copilot Terminal</option>
                      </select>
                      <label class="ai-provider-checkbox">
                        <input type="checkbox" id="applyChangesShowTerminal">
                        <span>Show terminal</span>
                      </label>
                      <div class="ai-provider-timeout">
                        <input type="number" id="applyChangesTimeout" min="1" max="30" value="5">
                        <span>min</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="ai-provider-card">
                  <div class="ai-provider-header">
                    <div class="ai-provider-title-group">
                      <span class="ai-provider-icon">${getIcon(MessageSquare, 16)}</span>
                      <span class="ai-provider-title">Chat Panel Default</span>
                    </div>
                  </div>
                  <div class="ai-provider-settings">
                    <div class="ai-provider-row">
                      <select id="defaultChatAI" class="ai-provider-select">
                        <option value="copilot">Copilot</option>
                        <option value="claude">Claude</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div class="ai-provider-card">
                  <div class="ai-provider-header">
                    <div class="ai-provider-title-group">
                      <span class="ai-provider-icon">${getIcon(Search, 16)}</span>
                      <span class="ai-provider-title">DGrep Log Analysis</span>
                    </div>
                  </div>
                  <div class="ai-provider-settings">
                    <div class="ai-provider-row">
                      <select id="dgrepAnalysisProvider" class="ai-provider-select">
                        <option value="claude-sdk">Claude SDK</option>
                        <option value="copilot-sdk">Copilot SDK</option>
                      </select>
                    </div>
                    <div class="ai-provider-row" style="margin-top: 6px;">
                      <label style="font-size: 12px; color: var(--text-secondary); margin-right: 8px;">Source repo</label>
                      <select id="dgrepAnalysisSourceRepo" class="ai-provider-select" style="flex: 1;">
                        <option value="">None</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="settings-section">
              <h2 class="settings-section-title">Startup</h2>
              <p class="settings-section-description">Control whether TaskDock launches automatically when Windows starts.</p>

              <div class="form-group checkbox-group">
                <label>
                  <input type="checkbox" id="autostartEnabled">
                  <span>Launch TaskDock automatically at Windows startup</span>
                </label>
              </div>
            </div>


            <div class="settings-section">
              <h2 class="settings-section-title">Notifications</h2>
              <p class="settings-section-description">Configure native Windows toast notifications for background events.</p>

              <div class="form-group checkbox-group">
                <label>
                  <input type="checkbox" id="notificationsEnabled" checked>
                  <span>Enable Windows notifications</span>
                </label>
              </div>

              <div id="notificationEventToggles" class="form-group" style="margin-left: 24px;">
                <div class="checkbox-group">
                  <label>
                    <input type="checkbox" id="notifyAiReviewComplete" checked>
                    <span>AI PR Review completed</span>
                  </label>
                </div>
                <div class="checkbox-group">
                  <label>
                    <input type="checkbox" id="notifyAiAnalysisComplete" checked>
                    <span>AI Comment Analysis completed</span>
                  </label>
                </div>
                <div class="checkbox-group">
                  <label>
                    <input type="checkbox" id="notifyNewComments" checked>
                    <span>New comments detected</span>
                  </label>
                </div>
                <div class="checkbox-group">
                  <label>
                    <input type="checkbox" id="notifyNewIterations" checked>
                    <span>New iterations (commits) detected</span>
                  </label>
                </div>
                <div class="checkbox-group">
                  <label>
                    <input type="checkbox" id="notifyTaskComplete" checked>
                    <span>Task completed</span>
                  </label>
                </div>
              </div>

              <div class="form-group" style="margin-top: 12px;">
                <button type="button" class="btn btn-secondary" id="testNotificationBtn">Test Notification</button>
              </div>
            </div>

            <div class="settings-section" id="pluginSettingsSection">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <h2 class="settings-section-title" style="margin: 0;">Plugins</h2>
                <button type="button" class="btn btn-secondary btn-sm" id="reloadAllPluginsBtn">Reload All</button>
              </div>
              <p class="settings-section-description">Manage installed plugins. Plugins are loaded from ~/.taskdock/plugins/</p>
              <div id="pluginSettingsList" class="plugin-settings-list">
                <p class="text-muted">Loading plugins...</p>
              </div>
            </div>
          </div>

          <!-- Services Tab -->
          <div class="settings-tab-content" data-tab-content="services">
            <div class="settings-section full-width">
              <h2 class="settings-section-title">Services</h2>
              <p class="settings-section-description">Register your services with their repositories and link related services together.</p>

              <div class="service-list" id="servicesList"></div>

              <div class="service-add-form" id="serviceAddForm" style="margin-top: var(--space-4);">
                <h3 class="settings-subsection-title" style="margin: 0; padding: 0; border: none;">Add Service</h3>
                <div class="form-group">
                  <label for="serviceNameInput">Name</label>
                  <input type="text" id="serviceNameInput" placeholder="e.g., Backend API">
                </div>
                <div class="form-group">
                  <label for="serviceDescInput">Description</label>
                  <input type="text" id="serviceDescInput" placeholder="Short description of this service">
                </div>
                <div class="form-group">
                  <label>Repository Path</label>
                  <div style="display: flex; gap: var(--space-2);">
                    <input type="text" id="serviceRepoPathInput" placeholder="Browse to select local repo folder" readonly style="flex: 1;">
                    <button type="button" class="btn btn-secondary btn-sm" id="browseServiceRepoBtn">Browse</button>
                  </div>
                </div>
                <div class="form-group" id="serviceLinkedGroup" style="display: none;">
                  <label>Linked Services</label>
                  <div id="serviceLinkedCheckboxes"></div>
                </div>
                <div class="form-actions" style="margin-top: 0;">
                  <button type="button" class="btn btn-primary btn-sm" id="addServiceBtn">
                    ${getIcon(Plus, 14)}
                    Add Service
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Privacy Tab -->
          <div class="settings-tab-content" data-tab-content="privacy">
            <div class="settings-section full-width">
              <h2 class="settings-section-title">Scrub Patterns</h2>
              <p class="settings-section-description">Configure regex patterns for scrubbing sensitive data before it reaches AI agents. Matched values are replaced with tokens like scrub_g1, scrub_e1.</p>

              <table class="settings-table" id="scrubPatternsTable">
                <thead>
                  <tr>
                    <th style="width: 60px;">Enabled</th>
                    <th>Name</th>
                    <th style="width: 60px;">Letter</th>
                    <th>Regex</th>
                    <th style="width: 80px;">Actions</th>
                  </tr>
                </thead>
                <tbody id="scrubPatternsBody"></tbody>
              </table>

              <div style="margin-top: var(--space-4);">
                <h3 class="settings-subsection-title" style="margin: 0; padding: 0; border: none;">Add Pattern</h3>
                <div style="display: flex; gap: var(--space-2); align-items: end; flex-wrap: wrap;">
                  <div class="form-group" style="flex: 1; min-width: 120px;">
                    <label for="scrubPatternName">Name</label>
                    <input type="text" id="scrubPatternName" placeholder="e.g., Phone Number">
                  </div>
                  <div class="form-group" style="width: 80px;">
                    <label for="scrubPatternLetter">Letter</label>
                    <input type="text" id="scrubPatternLetter" maxlength="1" placeholder="p" style="text-align: center;">
                  </div>
                  <div class="form-group" style="flex: 2; min-width: 200px;">
                    <label for="scrubPatternRegex">Regex</label>
                    <input type="text" id="scrubPatternRegex" placeholder="\\d{3}-\\d{3}-\\d{4}">
                  </div>
                  <button type="button" class="btn btn-primary btn-sm" id="addScrubPatternBtn">Add</button>
                </div>
                <div id="scrubPatternError" class="error-text" style="display: none; color: var(--danger); margin-top: var(--space-1); font-size: 0.85em;"></div>
              </div>

              <div style="margin-top: var(--space-6);">
                <h3 class="settings-subsection-title" style="margin: 0; padding: 0; border: none;">Regex Tester</h3>
                <p class="settings-section-description">Paste sample text to see which values would be scrubbed by enabled patterns.</p>
                <div class="form-group">
                  <label for="scrubTesterInput">Sample Text</label>
                  <textarea id="scrubTesterInput" rows="4" placeholder="Paste log text with GUIDs, emails, IPs, etc." style="width: 100%; font-family: var(--font-mono); font-size: 0.85em;"></textarea>
                </div>
                <button type="button" class="btn btn-secondary btn-sm" id="testScrubBtn">Test Scrub</button>
                <div id="scrubTesterOutput" style="margin-top: var(--space-2); display: none;">
                  <label>Scrubbed Output</label>
                  <pre id="scrubTesterResult" style="background: var(--bg-secondary); padding: var(--space-3); border-radius: var(--radius); font-family: var(--font-mono); font-size: 0.85em; white-space: pre-wrap; max-height: 200px; overflow: auto; border: 1px solid var(--border);"></pre>
                  <div id="scrubTesterMatches" style="margin-top: var(--space-2); font-size: 0.85em;"></div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    `;

    this.attachEventListeners();
    this.attachSettingsTabListeners();
    this.attachScrubPatternListeners();
    this.attachThemeHandlers();
  }

  private attachThemeHandlers(): void {
    const saved = (localStorage.getItem('taskdock-theme-preference') ?? 'auto') as string;
    this.updateThemeButtons(saved);

    this.container.querySelector('#themeSelector')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-theme-value]') as HTMLElement | null;
      if (!btn) return;
      const pref = btn.dataset.themeValue!;
      localStorage.setItem('taskdock-theme-preference', pref);
      this.updateThemeButtons(pref);
      window.dispatchEvent(new CustomEvent('taskdock-theme-change', { detail: pref }));
    });

    const openLogBtn = this.container.querySelector('#openLogFileBtn') as HTMLButtonElement | null;
    openLogBtn?.addEventListener('click', async () => {
      try {
        await window.electronAPI.loggerOpenLogFolder();
      } catch (err: any) {
        Toast.error(err?.message || 'Failed to open log folder');
      }
    });
  }

  private updateThemeButtons(active: string): void {
    this.container.querySelectorAll('[data-theme-value]').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.themeValue === active);
    });
  }

  private attachSettingsTabListeners(): void {
    this.container.querySelectorAll('.settings-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = (btn as HTMLElement).dataset.settingsTab!;
        this.switchSettingsTab(tab);
      });
    });
  }

  private switchSettingsTab(tabId: string): void {
    this.activeSettingsTab = tabId;

    // Update tab buttons
    this.container.querySelectorAll('.settings-tab-btn').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.settingsTab === tabId);
    });

    // Update tab content
    this.container.querySelectorAll('.settings-tab-content').forEach(content => {
      content.classList.toggle('active', (content as HTMLElement).dataset.tabContent === tabId);
    });
  }

  private attachEventListeners() {
    const form = this.container.querySelector('#settingsForm') as HTMLFormElement;
    const testBtn = this.container.querySelector('#testConnectionBtn') as HTMLButtonElement;
    const toggleBtn = this.container.querySelector('#togglePatVisibility') as HTMLButtonElement;
    const patInput = this.container.querySelector('#settingsPat') as HTMLInputElement;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleSaveAll();
    });

    testBtn.addEventListener('click', async () => {
      await this.handleTest();
    });

    toggleBtn.addEventListener('click', () => {
      patInput.type = patInput.type === 'password' ? 'text' : 'password';
    });

    const anthropicKeyInput = this.container.querySelector('#settingsAnthropicApiKey') as HTMLInputElement;
    const toggleAnthropicBtn = this.container.querySelector('#toggleAnthropicKeyVisibility') as HTMLButtonElement;
    toggleAnthropicBtn?.addEventListener('click', () => {
      anthropicKeyInput.type = anthropicKeyInput.type === 'password' ? 'text' : 'password';
    });
    anthropicKeyInput?.addEventListener('input', () => {
      this.settings = { ...this.settings, anthropicApiKey: anthropicKeyInput.value.trim() };
    });

    // Quick Setup from URL
    const adoUrlInput = this.container.querySelector('#settingsAdoUrl') as HTMLInputElement;
    const adoUrlHint = this.container.querySelector('#settingsAdoUrlHint') as HTMLElement;
    adoUrlInput?.addEventListener('input', () => {
      const url = adoUrlInput.value.trim();
      if (!url) {
        adoUrlHint.textContent = 'Paste any work item or repo URL to auto-fill organization and project.';
        adoUrlHint.style.color = '';
        return;
      }
      const parsed = this.parseAdoUrl(url);
      if (parsed) {
        (this.container.querySelector('#settingsOrganization') as HTMLInputElement).value = parsed.organization;
        (this.container.querySelector('#settingsProject') as HTMLInputElement).value = parsed.project;
        this.settings = { ...this.settings, organization: parsed.organization, project: parsed.project };
        adoUrlHint.textContent = `Detected: ${parsed.organization} / ${parsed.project}`;
        adoUrlHint.style.color = 'var(--color-success, #22c55e)';
      } else {
        adoUrlHint.textContent = 'Could not parse org and project from that URL.';
        adoUrlHint.style.color = 'var(--color-error, #ef4444)';
      }
    });

    ['settingsOrganization', 'settingsProject', 'settingsPat'].forEach(id => {
      const input = this.container.querySelector(`#${id}`) as HTMLInputElement;
      input.addEventListener('input', () => {
        this.settings = {
          organization: (this.container.querySelector('#settingsOrganization') as HTMLInputElement).value.trim(),
          project: (this.container.querySelector('#settingsProject') as HTMLInputElement).value.trim(),
          pat: (this.container.querySelector('#settingsPat') as HTMLInputElement).value.trim(),
        };
      });
    });

    // Monitored repositories
    const addMonitoredRepoBtn = this.container.querySelector('#addMonitoredRepoBtn');
    addMonitoredRepoBtn?.addEventListener('click', () => this.handleAddMonitoredRepo());

    const monitoredRepoInput = this.container.querySelector('#monitoredRepoUrl') as HTMLInputElement;
    monitoredRepoInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.handleAddMonitoredRepo();
      }
    });

    // Console review settings
    const addRepoBtn = this.container.querySelector('#addRepoBtn');
    addRepoBtn?.addEventListener('click', () => this.handleAddRepo());

    // Global save button
    const saveAllBtn = this.container.querySelector('#saveAllSettingsBtn');
    saveAllBtn?.addEventListener('click', () => this.handleSaveAll());

    // Notification master toggle
    const notificationsEnabled = this.container.querySelector('#notificationsEnabled') as HTMLInputElement;
    notificationsEnabled?.addEventListener('change', () => {
      const toggles = this.container.querySelector('#notificationEventToggles') as HTMLElement;
      if (toggles) {
        toggles.style.opacity = notificationsEnabled.checked ? '1' : '0.5';
        toggles.querySelectorAll('input[type="checkbox"]').forEach(cb => {
          (cb as HTMLInputElement).disabled = !notificationsEnabled.checked;
        });
      }
    });

    // Test notification button
    const testNotifBtn = this.container.querySelector('#testNotificationBtn');
    testNotifBtn?.addEventListener('click', async () => {
      await notificationService.sendTest();
      Toast.info('Test notification sent');
    });

    // Services
    const browseServiceRepoBtn = this.container.querySelector('#browseServiceRepoBtn');
    browseServiceRepoBtn?.addEventListener('click', async () => {
      const folder = await window.electronAPI.browseFolder();
      if (folder) {
        (this.container.querySelector('#serviceRepoPathInput') as HTMLInputElement).value = folder;
      }
    });

    const addServiceBtn = this.container.querySelector('#addServiceBtn');
    addServiceBtn?.addEventListener('click', async () => {
      const name = (this.container.querySelector('#serviceNameInput') as HTMLInputElement).value.trim();
      const description = (this.container.querySelector('#serviceDescInput') as HTMLInputElement).value.trim();
      const repoPath = (this.container.querySelector('#serviceRepoPathInput') as HTMLInputElement).value.trim();

      if (!name) {
        Toast.error('Service name is required');
        return;
      }
      if (!repoPath) {
        Toast.error('Repository path is required');
        return;
      }

      // Check for duplicate name
      if (this.services.some(s => s.name.toLowerCase() === name.toLowerCase())) {
        Toast.error('A service with this name already exists');
        return;
      }

      // Gather linked service IDs
      const linkedServiceIds: string[] = [];
      this.container.querySelectorAll('.service-linked-cb:checked').forEach(cb => {
        linkedServiceIds.push((cb as HTMLInputElement).dataset.serviceId!);
      });

      const newService: ServiceEntry = {
        id: crypto.randomUUID(),
        name,
        description,
        repoPath,
        linkedServiceIds,
      };

      this.services.push(newService);
      await this.saveServices();
      this.renderServicesList();

      // Clear form
      (this.container.querySelector('#serviceNameInput') as HTMLInputElement).value = '';
      (this.container.querySelector('#serviceDescInput') as HTMLInputElement).value = '';
      (this.container.querySelector('#serviceRepoPathInput') as HTMLInputElement).value = '';
      this.container.querySelectorAll('.service-linked-cb').forEach(cb => {
        (cb as HTMLInputElement).checked = false;
      });

      Toast.success(`Service "${name}" added`);
    });
  }

  private updateFormValues() {
    (this.container.querySelector('#settingsOrganization') as HTMLInputElement).value = this.settings.organization;
    (this.container.querySelector('#settingsProject') as HTMLInputElement).value = this.settings.project;
    (this.container.querySelector('#settingsPat') as HTMLInputElement).value = this.settings.pat;
    (this.container.querySelector('#settingsAnthropicApiKey') as HTMLInputElement).value = this.settings.anthropicApiKey || '';
    // Reset the quick-setup URL field so it doesn't show a stale value
    const adoUrlInput = this.container.querySelector('#settingsAdoUrl') as HTMLInputElement;
    if (adoUrlInput) adoUrlInput.value = '';
    const adoUrlHint = this.container.querySelector('#settingsAdoUrlHint') as HTMLElement;
    if (adoUrlHint) {
      adoUrlHint.textContent = 'Paste any work item or repo URL to auto-fill organization and project.';
      adoUrlHint.style.color = '';
    }
  }

  private async handleSaveAll() {
    const saveBtn = this.container.querySelector('#saveAllSettingsBtn') as HTMLButtonElement;
    saveBtn.classList.add('loading');

    try {
      // 1. Save ADO connection settings
      await this.saveCallback?.(this.settings);

      // 2. Gather and save Console Review settings
      const whenRepoFound = (this.container.querySelector('#whenRepoFound') as HTMLSelectElement).value as ConsoleReviewSettings['whenRepoFound'];
      const whenRepoNotFound = (this.container.querySelector('#whenRepoNotFound') as HTMLSelectElement).value as ConsoleReviewSettings['whenRepoNotFound'];
      const worktreeCleanup = (this.container.querySelector('#worktreeCleanup') as HTMLSelectElement).value as ConsoleReviewSettings['worktreeCleanup'];
      const autoCloseTerminal = (this.container.querySelector('#autoCloseTerminal') as HTMLInputElement).checked;
      const showNotification = (this.container.querySelector('#showNotification') as HTMLInputElement).checked;
      const generatedFilePatternsText = (this.container.querySelector('#generatedFilePatterns') as HTMLTextAreaElement).value;
      const generatedFilePatterns = generatedFilePatternsText
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0);
      const enableWorkIQ = (this.container.querySelector('#enableWorkIQ') as HTMLInputElement).checked;

      // 3. Gather AI Provider settings
      const analyzeCommentsProvider = (this.container.querySelector('#analyzeCommentsProvider') as HTMLSelectElement).value as ConsoleReviewSettings['analyzeComments']['provider'];
      const analyzeCommentsShowTerminal = (this.container.querySelector('#analyzeCommentsShowTerminal') as HTMLInputElement).checked;
      let analyzeCommentsTimeoutMinutes = parseInt((this.container.querySelector('#analyzeCommentsTimeout') as HTMLInputElement).value, 10);
      analyzeCommentsTimeoutMinutes = Math.max(1, Math.min(30, analyzeCommentsTimeoutMinutes || 5));

      const applyChangesProvider = (this.container.querySelector('#applyChangesProvider') as HTMLSelectElement).value as ConsoleReviewSettings['applyChanges']['provider'];
      const applyChangesShowTerminal = (this.container.querySelector('#applyChangesShowTerminal') as HTMLInputElement).checked;
      let applyChangesTimeoutMinutes = parseInt((this.container.querySelector('#applyChangesTimeout') as HTMLInputElement).value, 10);
      applyChangesTimeoutMinutes = Math.max(1, Math.min(30, applyChangesTimeoutMinutes || 5));

      const defaultChatAI = (this.container.querySelector('#defaultChatAI') as HTMLSelectElement).value as 'copilot' | 'claude';

      const dgrepAnalysisProvider = (this.container.querySelector('#dgrepAnalysisProvider') as HTMLSelectElement).value as 'claude-sdk' | 'copilot-sdk';
      const dgrepAnalysisSourceRepo = (this.container.querySelector('#dgrepAnalysisSourceRepo') as HTMLSelectElement).value;

      // 4. Gather Polling settings
      const pollingEnabled = (this.container.querySelector('#pollingEnabled') as HTMLInputElement).checked;
      let pollingIntervalSeconds = parseInt((this.container.querySelector('#pollingInterval') as HTMLInputElement).value, 10);
      pollingIntervalSeconds = Math.max(10, Math.min(300, pollingIntervalSeconds || 30));

      // Update and save Console Review settings (includes AI providers)
      this.consoleReviewSettings = {
        ...this.consoleReviewSettings,
        whenRepoFound,
        whenRepoNotFound,
        worktreeCleanup,
        autoCloseTerminal,
        showNotification,
        generatedFilePatterns,
        enableWorkIQ,
        defaultChatAI,
        analyzeComments: {
          provider: analyzeCommentsProvider,
          showTerminal: analyzeCommentsShowTerminal,
          timeoutMinutes: analyzeCommentsTimeoutMinutes,
        },
        applyChanges: {
          provider: applyChangesProvider,
          showTerminal: applyChangesShowTerminal,
          timeoutMinutes: applyChangesTimeoutMinutes,
        },
        dgrepAnalysis: {
          provider: dgrepAnalysisProvider,
          sourceRepository: dgrepAnalysisSourceRepo,
        },
      };
      await window.electronAPI.setConsoleReviewSettings(this.consoleReviewSettings);
      this.consoleSettingsSavedCallback?.(this.consoleReviewSettings);

      // Update and save Polling settings
      this.pollingSettings = {
        enabled: pollingEnabled,
        intervalSeconds: pollingIntervalSeconds,
      };
      await window.electronAPI.setPollingSettings(this.pollingSettings);
      this.pollingSettingsSavedCallback?.(this.pollingSettings);

      // Update and save Notification settings
      this.notificationSettings = {
        enabled: (this.container.querySelector('#notificationsEnabled') as HTMLInputElement).checked,
        aiReviewComplete: (this.container.querySelector('#notifyAiReviewComplete') as HTMLInputElement).checked,
        aiAnalysisComplete: (this.container.querySelector('#notifyAiAnalysisComplete') as HTMLInputElement).checked,
        newComments: (this.container.querySelector('#notifyNewComments') as HTMLInputElement).checked,
        newIterations: (this.container.querySelector('#notifyNewIterations') as HTMLInputElement).checked,
        taskComplete: (this.container.querySelector('#notifyTaskComplete') as HTMLInputElement).checked,
      };
      await window.electronAPI.setNotificationSettings(this.notificationSettings);
      this.notificationSettingsSavedCallback?.(this.notificationSettings);

      // Save autostart setting
      this.autostartEnabled = (this.container.querySelector('#autostartEnabled') as HTMLInputElement).checked;
      try { await window.electronAPI.setAutostartEnabled(this.autostartEnabled); } catch { /* not yet implemented */ }

      Toast.success('All settings saved');
      this.showStatus('connected', 'Settings saved successfully');
    } catch (error: any) {
      Toast.error(error.message || 'Failed to save settings');
      this.showStatus('error', error.message || 'Failed to save settings');
    } finally {
      saveBtn.classList.remove('loading');
    }
  }

  private async handleTest() {
    const testBtn = this.container.querySelector('#testConnectionBtn') as HTMLButtonElement;
    testBtn.classList.add('loading');
    this.showStatus('testing', 'Testing connection...');

    try {
      const success = await this.testCallback?.(this.settings);
      if (success) {
        Toast.success('Connection successful');
        this.showStatus('connected', 'Connection successful');
      } else {
        throw new Error('Connection failed');
      }
    } catch (error: any) {
      Toast.error(error.message || 'Connection failed');
      this.showStatus('error', error.message || 'Connection failed');
    } finally {
      testBtn.classList.remove('loading');
    }
  }

  private showStatus(type: 'connected' | 'error' | 'testing', message: string) {
    const statusEl = this.container.querySelector('#connectionStatus') as HTMLElement;
    statusEl.className = `connection-status ${type}`;
    statusEl.textContent = message;
    statusEl.classList.add('visible');
  }

  // Console Review Settings Methods

  private async loadConsoleReviewSettings(): Promise<void> {
    try {
      const loaded = await window.electronAPI.getConsoleReviewSettings();
      // Merge with defaults to handle new fields added in updates
      const merged = { ...DEFAULT_CONSOLE_REVIEW_SETTINGS, ...loaded };
      // Ensure default monitored repos are always present (even for existing users)
      const existingUrls = new Set(merged.monitoredRepositories.map(r => r.url));
      for (const repo of DEFAULT_CONSOLE_REVIEW_SETTINGS.monitoredRepositories) {
        if (!existingUrls.has(repo.url)) {
          merged.monitoredRepositories = [repo, ...merged.monitoredRepositories];
        }
      }
      this.consoleReviewSettings = merged;
      this.updateConsoleReviewFormValues();
    } catch (error: any) {
      console.error('Failed to load console review settings:', error);
      Toast.error(error?.message || 'Failed to load review settings');
    }
  }

  private async renderLinkedReposList(): Promise<void> {
    const container = this.container.querySelector('#linkedReposList') as HTMLElement;
    if (!container) return;

    if (this.consoleReviewSettings.linkedRepositories.length === 0) {
      container.innerHTML = '<div class="folder-empty">No repositories linked</div>';
      return;
    }

    // Fetch normalized URLs for all repos
    const reposWithNormalized = await Promise.all(
      this.consoleReviewSettings.linkedRepositories.map(async (repo) => {
        const normalized = await window.electronAPI.gitNormalizeAdoUrl(repo.originUrl);
        return { ...repo, normalized };
      })
    );

    container.innerHTML = reposWithNormalized.map((repo, index) => `
      <div class="repo-item" data-index="${index}">
        <div class="repo-info">
          <span class="repo-path">${escapeHtml(repo.path)}</span>
          <span class="repo-normalized">${escapeHtml(repo.normalized)}</span>
          <span class="repo-origin">${escapeHtml(repo.originUrl)}</span>
          <input type="text" class="repo-description-input" data-index="${index}"
            placeholder="Description (e.g., Backend API service, Frontend SPA...)"
            value="${escapeHtml(repo.description || '')}">
        </div>
        <button type="button" class="btn btn-icon btn-danger-subtle remove-repo-btn" data-index="${index}" title="Remove">
          ${getIcon(X, 14)}
        </button>
      </div>
    `).join('');

    // Attach remove listeners
    container.querySelectorAll('.remove-repo-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt((e.currentTarget as HTMLElement).dataset.index || '0');
        this.consoleReviewSettings.linkedRepositories.splice(index, 1);
        this.renderLinkedReposList();
      });
    });

    // Attach description change listeners
    container.querySelectorAll('.repo-description-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const el = e.target as HTMLInputElement;
        const index = parseInt(el.dataset.index || '0');
        this.consoleReviewSettings.linkedRepositories[index].description = el.value.trim() || undefined;
      });
    });
  }

  private async handleAddRepo(): Promise<void> {
    const folder = await window.electronAPI.browseFolder();
    if (!folder) return;

    // Check if it's a git repository
    const isRepo = await window.electronAPI.gitIsRepo(folder);
    if (!isRepo) {
      Toast.error('Selected folder is not a git repository');
      return;
    }

    // Get the origin URL
    const originUrl = await window.electronAPI.gitGetOriginUrl(folder);
    if (!originUrl) {
      Toast.error('Could not get git remote origin URL');
      return;
    }

    // Check if already linked
    const alreadyLinked = this.consoleReviewSettings.linkedRepositories.some(
      r => r.path === folder || r.originUrl === originUrl
    );
    if (alreadyLinked) {
      Toast.error('This repository is already linked');
      return;
    }

    this.consoleReviewSettings.linkedRepositories.push({ path: folder, originUrl });
    this.renderLinkedReposList();
  }

  private updateConsoleReviewFormValues(): void {
    const whenRepoFound = this.container.querySelector('#whenRepoFound') as HTMLSelectElement;
    const whenRepoNotFound = this.container.querySelector('#whenRepoNotFound') as HTMLSelectElement;
    const worktreeCleanup = this.container.querySelector('#worktreeCleanup') as HTMLSelectElement;
    const autoCloseTerminal = this.container.querySelector('#autoCloseTerminal') as HTMLInputElement;
    const showNotification = this.container.querySelector('#showNotification') as HTMLInputElement;
    const generatedFilePatterns = this.container.querySelector('#generatedFilePatterns') as HTMLTextAreaElement;
    const enableWorkIQ = this.container.querySelector('#enableWorkIQ') as HTMLInputElement;

    // Analyze Comments settings
    const analyzeCommentsProvider = this.container.querySelector('#analyzeCommentsProvider') as HTMLSelectElement;
    const analyzeCommentsShowTerminal = this.container.querySelector('#analyzeCommentsShowTerminal') as HTMLInputElement;
    const analyzeCommentsTimeout = this.container.querySelector('#analyzeCommentsTimeout') as HTMLInputElement;

    // Apply Changes settings
    const applyChangesProvider = this.container.querySelector('#applyChangesProvider') as HTMLSelectElement;
    const applyChangesShowTerminal = this.container.querySelector('#applyChangesShowTerminal') as HTMLInputElement;
    const applyChangesTimeout = this.container.querySelector('#applyChangesTimeout') as HTMLInputElement;

    if (whenRepoFound) whenRepoFound.value = this.consoleReviewSettings.whenRepoFound;
    if (whenRepoNotFound) whenRepoNotFound.value = this.consoleReviewSettings.whenRepoNotFound;
    if (worktreeCleanup) worktreeCleanup.value = this.consoleReviewSettings.worktreeCleanup;
    if (autoCloseTerminal) autoCloseTerminal.checked = this.consoleReviewSettings.autoCloseTerminal;
    if (showNotification) showNotification.checked = this.consoleReviewSettings.showNotification;
    if (generatedFilePatterns) generatedFilePatterns.value = (this.consoleReviewSettings.generatedFilePatterns || []).join('\n');
    if (enableWorkIQ) enableWorkIQ.checked = this.consoleReviewSettings.enableWorkIQ ?? true;

    // Analyze Comments form values
    const analyzeComments = this.consoleReviewSettings.analyzeComments || { provider: 'copilot-sdk', showTerminal: false, timeoutMinutes: 5 };
    if (analyzeCommentsProvider) analyzeCommentsProvider.value = analyzeComments.provider;
    if (analyzeCommentsShowTerminal) analyzeCommentsShowTerminal.checked = analyzeComments.showTerminal;
    if (analyzeCommentsTimeout) analyzeCommentsTimeout.value = String(analyzeComments.timeoutMinutes);

    // Apply Changes form values
    const applyChanges = this.consoleReviewSettings.applyChanges || { provider: 'copilot-sdk', showTerminal: false, timeoutMinutes: 5 };
    if (applyChangesProvider) applyChangesProvider.value = applyChanges.provider;
    if (applyChangesShowTerminal) applyChangesShowTerminal.checked = applyChanges.showTerminal;
    if (applyChangesTimeout) applyChangesTimeout.value = String(applyChanges.timeoutMinutes);

    // Default Chat AI form value
    const defaultChatAI = this.container.querySelector('#defaultChatAI') as HTMLSelectElement;
    if (defaultChatAI) defaultChatAI.value = this.consoleReviewSettings.defaultChatAI || 'copilot';

    // DGrep Analysis settings
    const dgrepAnalysis = this.consoleReviewSettings.dgrepAnalysis || { provider: 'copilot-sdk', sourceRepository: '' };
    const dgrepAnalysisProvider = this.container.querySelector('#dgrepAnalysisProvider') as HTMLSelectElement;
    if (dgrepAnalysisProvider) dgrepAnalysisProvider.value = dgrepAnalysis.provider;

    const dgrepAnalysisSourceRepo = this.container.querySelector('#dgrepAnalysisSourceRepo') as HTMLSelectElement;
    if (dgrepAnalysisSourceRepo) {
      // Populate with linked repos
      dgrepAnalysisSourceRepo.innerHTML = '<option value="">None</option>';
      for (const repo of this.consoleReviewSettings.linkedRepositories || []) {
        const label = repo.description || repo.path.split(/[\\/]/).pop() || repo.path;
        const opt = document.createElement('option');
        opt.value = repo.path;
        opt.textContent = label;
        dgrepAnalysisSourceRepo.appendChild(opt);
      }
      dgrepAnalysisSourceRepo.value = dgrepAnalysis.sourceRepository;
    }

    this.renderLinkedReposList();
    this.renderMonitoredReposList();
  }

  // Monitored Repositories Methods

  private renderMonitoredReposList(): void {
    const container = this.container.querySelector('#monitoredReposList') as HTMLElement;
    if (!container) return;

    const repos = this.consoleReviewSettings.monitoredRepositories || [];

    if (repos.length === 0) {
      container.innerHTML = '<div class="folder-empty">No repositories monitored</div>';
      return;
    }

    container.innerHTML = repos.map((repo, index) => `
      <div class="repo-item" data-index="${index}">
        <div class="repo-info">
          <span class="repo-path">${escapeHtml(repo.name)}</span>
          <span class="repo-origin">${escapeHtml(repo.organization)}/${escapeHtml(repo.project)}/${escapeHtml(repo.repository)}</span>
        </div>
        <button type="button" class="btn btn-icon btn-danger-subtle remove-monitored-repo-btn" data-index="${index}" title="Remove">
          ${getIcon(X, 14)}
        </button>
      </div>
    `).join('');

    // Attach remove listeners
    container.querySelectorAll('.remove-monitored-repo-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const index = parseInt((e.currentTarget as HTMLElement).dataset.index || '0');
        this.consoleReviewSettings.monitoredRepositories.splice(index, 1);
        this.renderMonitoredReposList();
        // Auto-save when removing
        await this.saveMonitoredReposSettings();
      });
    });
  }

  private parseAdoUrl(url: string): { organization: string; project: string } | null {
    // https://dev.azure.com/{org}/{project}/...
    const devAzureMatch = url.match(/https?:\/\/dev\.azure\.com\/([^/?#]+)\/([^/?#_][^/?#]*?)(?:\/|$)/);
    if (devAzureMatch) return { organization: devAzureMatch[1], project: devAzureMatch[2] };

    // https://{org}.visualstudio.com/DefaultCollection/{project}/...
    const vsDefaultMatch = url.match(/https?:\/\/([^./?#]+)\.visualstudio\.com\/DefaultCollection\/([^/?#_][^/?#]*?)(?:\/|$)/i);
    if (vsDefaultMatch) return { organization: vsDefaultMatch[1], project: vsDefaultMatch[2] };

    // https://{org}.visualstudio.com/{project}/...
    const vsMatch = url.match(/https?:\/\/([^./?#]+)\.visualstudio\.com\/([^/?#_][^/?#]*?)(?:\/|$)/i);
    if (vsMatch) return { organization: vsMatch[1], project: vsMatch[2] };

    return null;
  }

  private parseAdoRepoUrl(url: string): { organization: string; project: string; repository: string } | null {
    // Handle supported formats:
    // https://dev.azure.com/{org}/{project}/_git/{repo}
    // https://{org}.visualstudio.com/{project}/_git/{repo}
    // https://{org}.visualstudio.com/DefaultCollection/{project}/_git/{repo}
    const devAzureMatch = url.match(/https:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)/);
    if (devAzureMatch) {
      return {
        organization: devAzureMatch[1],
        project: devAzureMatch[2],
        repository: devAzureMatch[3],
      };
    }

    // Check DefaultCollection format first (more specific pattern)
    const vsDefaultCollectionMatch = url.match(/https:\/\/([^.]+)\.visualstudio\.com\/DefaultCollection\/([^/]+)\/_git\/([^/]+)/i);
    if (vsDefaultCollectionMatch) {
      return {
        organization: vsDefaultCollectionMatch[1],
        project: vsDefaultCollectionMatch[2],
        repository: vsDefaultCollectionMatch[3],
      };
    }

    const vsMatch = url.match(/https:\/\/([^.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/]+)/);
    if (vsMatch) {
      return {
        organization: vsMatch[1],
        project: vsMatch[2],
        repository: vsMatch[3],
      };
    }

    return null;
  }

  private async handleAddMonitoredRepo(): Promise<void> {
    const input = this.container.querySelector('#monitoredRepoUrl') as HTMLInputElement;
    const url = input.value.trim();

    if (!url) {
      Toast.error('Please enter a repository URL');
      return;
    }

    const parsed = this.parseAdoRepoUrl(url);
    if (!parsed) {
      Toast.error('Invalid Azure DevOps repository URL. Expected format: https://dev.azure.com/org/project/_git/repo');
      return;
    }

    // Initialize array if not present
    if (!this.consoleReviewSettings.monitoredRepositories) {
      this.consoleReviewSettings.monitoredRepositories = [];
    }

    // Check if already monitored
    const alreadyMonitored = this.consoleReviewSettings.monitoredRepositories.some(
      r => r.organization === parsed.organization &&
           r.project === parsed.project &&
           r.repository === parsed.repository
    );
    if (alreadyMonitored) {
      Toast.error('This repository is already being monitored');
      return;
    }

    const newRepo: MonitoredRepository = {
      url,
      name: parsed.repository,
      organization: parsed.organization,
      project: parsed.project,
      repository: parsed.repository,
    };

    this.consoleReviewSettings.monitoredRepositories.push(newRepo);
    input.value = '';
    this.renderMonitoredReposList();

    // Auto-save when adding
    await this.saveMonitoredReposSettings();
    Toast.success(`Added ${parsed.repository} to monitored repositories`);
  }

  private async saveMonitoredReposSettings(): Promise<void> {
    try {
      await window.electronAPI.setConsoleReviewSettings(this.consoleReviewSettings);
      this.consoleSettingsSavedCallback?.(this.consoleReviewSettings);
    } catch (error: any) {
      Toast.error(error.message || 'Failed to save settings');
    }
  }

  // Polling Settings Methods

  private async loadPollingSettings(): Promise<void> {
    try {
      this.pollingSettings = await window.electronAPI.getPollingSettings();
      this.updatePollingFormValues();
    } catch (error: any) {
      console.error('Failed to load polling settings:', error);
      Toast.error(error?.message || 'Failed to load polling settings');
    }
  }

  private updatePollingFormValues(): void {
    const pollingEnabled = this.container.querySelector('#pollingEnabled') as HTMLInputElement;
    const pollingInterval = this.container.querySelector('#pollingInterval') as HTMLInputElement;

    if (pollingEnabled) pollingEnabled.checked = this.pollingSettings.enabled;
    if (pollingInterval) pollingInterval.value = String(this.pollingSettings.intervalSeconds);
  }

  // Notification Settings Methods

  private async loadNotificationSettings(): Promise<void> {
    try {
      this.notificationSettings = await window.electronAPI.getNotificationSettings();
      this.updateNotificationFormValues();
    } catch (error: any) {
      console.error('Failed to load notification settings:', error);
      Toast.error(error?.message || 'Failed to load notification settings');
    }
  }

  private updateNotificationFormValues(): void {
    const enabled = this.container.querySelector('#notificationsEnabled') as HTMLInputElement;
    const aiReview = this.container.querySelector('#notifyAiReviewComplete') as HTMLInputElement;
    const aiAnalysis = this.container.querySelector('#notifyAiAnalysisComplete') as HTMLInputElement;
    const newComments = this.container.querySelector('#notifyNewComments') as HTMLInputElement;
    const newIterations = this.container.querySelector('#notifyNewIterations') as HTMLInputElement;
    const taskComplete = this.container.querySelector('#notifyTaskComplete') as HTMLInputElement;

    if (enabled) enabled.checked = this.notificationSettings.enabled;
    if (aiReview) aiReview.checked = this.notificationSettings.aiReviewComplete;
    if (aiAnalysis) aiAnalysis.checked = this.notificationSettings.aiAnalysisComplete;
    if (newComments) newComments.checked = this.notificationSettings.newComments;
    if (newIterations) newIterations.checked = this.notificationSettings.newIterations;
    if (taskComplete) taskComplete.checked = this.notificationSettings.taskComplete ?? true;

    // Set initial disabled state
    const toggles = this.container.querySelector('#notificationEventToggles') as HTMLElement;
    if (toggles && !this.notificationSettings.enabled) {
      toggles.style.opacity = '0.5';
      toggles.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        (cb as HTMLInputElement).disabled = true;
      });
    }
  }

  // Autostart Setting Methods

  private async loadAutostartSetting(): Promise<void> {
    try {
      this.autostartEnabled = await window.electronAPI.getAutostartEnabled();
      this.updateAutostartFormValue();
    } catch (error: any) {
      console.error('Failed to load autostart setting:', error);
      Toast.error(error?.message || 'Failed to load autostart setting');
    }
  }

  private updateAutostartFormValue(): void {
    const checkbox = this.container.querySelector('#autostartEnabled') as HTMLInputElement;
    if (checkbox) checkbox.checked = this.autostartEnabled;
  }

  private async loadServices(): Promise<void> {
    try {
      this.services = await window.electronAPI.getServices();
      this.renderServicesList();
    } catch (error: any) {
      console.error('Failed to load services:', error);
      Toast.error(error?.message || 'Failed to load services');
      this.services = [];
      this.renderServicesList();
    }
  }

  private async saveServices(): Promise<void> {
    try {
      await window.electronAPI.setServices(this.services);
    } catch (error: any) {
      Toast.error(error.message || 'Failed to save services');
    }
  }

  private renderServicesList(): void {
    const container = this.container.querySelector('#servicesList') as HTMLElement;
    if (!container) return;

    if (this.services.length === 0) {
      container.innerHTML = '<div class="service-empty">No services registered yet</div>';
      this.updateLinkedServicesCheckboxes();
      return;
    }

    container.innerHTML = this.services.map((service, index) => {
      const linkedNames = service.linkedServiceIds
        .map(id => this.services.find(s => s.id === id)?.name)
        .filter(Boolean);

      return `
        <div class="service-card" data-index="${index}">
          <div class="service-card-header">
            <span class="service-card-name">${escapeHtml(service.name)}</span>
            <button type="button" class="btn btn-icon btn-danger-subtle remove-service-btn" data-index="${index}" title="Remove">
              ${getIcon(X, 14)}
            </button>
          </div>
          ${service.description ? `<span class="service-card-description">${escapeHtml(service.description)}</span>` : ''}
          <span class="service-card-repo">${escapeHtml(service.repoPath)}</span>
          ${linkedNames.length > 0 ? `
            <div class="service-card-links">
              ${linkedNames.map(name => `<span class="service-link-badge">${escapeHtml(name!)}</span>`).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    // Attach remove listeners
    container.querySelectorAll('.remove-service-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const index = parseInt((e.currentTarget as HTMLElement).dataset.index || '0');
        const removedId = this.services[index].id;
        this.services.splice(index, 1);
        // Remove references to deleted service from linked lists
        for (const s of this.services) {
          s.linkedServiceIds = s.linkedServiceIds.filter(id => id !== removedId);
        }
        await this.saveServices();
        this.renderServicesList();
      });
    });

    this.updateLinkedServicesCheckboxes();
  }

  private updateLinkedServicesCheckboxes(): void {
    const group = this.container.querySelector('#serviceLinkedGroup') as HTMLElement;
    const checkboxes = this.container.querySelector('#serviceLinkedCheckboxes') as HTMLElement;
    if (!group || !checkboxes) return;

    if (this.services.length === 0) {
      group.style.display = 'none';
      checkboxes.innerHTML = '';
      return;
    }

    group.style.display = '';
    checkboxes.innerHTML = this.services.map(s => `
      <div class="checkbox-group">
        <label>
          <input type="checkbox" class="service-linked-cb" data-service-id="${s.id}">
          <span>${escapeHtml(s.name)}</span>
        </label>
      </div>
    `).join('');
  }

  // Scrub Patterns (Privacy Tab) Methods

  private async loadScrubPatterns(): Promise<void> {
    try {
      this.scrubPatterns = await window.electronAPI.getScrubPatterns();
    } catch (error: any) {
      console.error('Failed to load scrub patterns:', error);
      Toast.error(error?.message || 'Failed to load privacy settings');
      this.scrubPatterns = [];
    }
    this.renderScrubPatterns();
  }

  private renderScrubPatterns(): void {
    const tbody = this.container.querySelector('#scrubPatternsBody') as HTMLElement;
    if (!tbody) return;
    tbody.innerHTML = this.scrubPatterns.map((p, i) => `
      <tr>
        <td style="text-align: center;"><input type="checkbox" class="scrub-pattern-toggle" data-index="${i}" ${p.enabled ? 'checked' : ''}></td>
        <td>${escapeHtml(p.name)}</td>
        <td style="text-align: center;"><code>${escapeHtml(p.letter)}</code></td>
        <td><code style="font-size: 0.85em; word-break: break-all;">${escapeHtml(p.regex)}</code></td>
        <td style="text-align: center;">${p.isDefault
          ? '<span style="color: var(--text-muted); font-size: 0.8em;">Default</span>'
          : `<button class="btn btn-danger btn-xs scrub-pattern-delete" data-index="${i}" style="font-size: 0.75em; padding: 2px 6px;">Delete</button>`
        }</td>
      </tr>
    `).join('');
  }

  private attachScrubPatternListeners(): void {
    // Toggle enable/disable
    this.container.addEventListener('change', async (e) => {
      const target = e.target as HTMLInputElement;
      if (target.classList.contains('scrub-pattern-toggle')) {
        const index = parseInt(target.dataset.index || '0', 10);
        if (this.scrubPatterns[index]) {
          this.scrubPatterns[index].enabled = target.checked;
          await window.electronAPI.setScrubPatterns(this.scrubPatterns);
        }
      }
    });

    // Delete pattern
    this.container.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('scrub-pattern-delete')) {
        const index = parseInt(target.dataset.index || '0', 10);
        if (this.scrubPatterns[index] && !this.scrubPatterns[index].isDefault) {
          this.scrubPatterns.splice(index, 1);
          await window.electronAPI.setScrubPatterns(this.scrubPatterns);
          this.renderScrubPatterns();
        }
      }
    });

    // Add pattern
    const addBtn = this.container.querySelector('#addScrubPatternBtn');
    addBtn?.addEventListener('click', async () => {
      const nameInput = this.container.querySelector('#scrubPatternName') as HTMLInputElement;
      const letterInput = this.container.querySelector('#scrubPatternLetter') as HTMLInputElement;
      const regexInput = this.container.querySelector('#scrubPatternRegex') as HTMLInputElement;
      const errorDiv = this.container.querySelector('#scrubPatternError') as HTMLElement;

      const name = nameInput?.value.trim() || '';
      const letter = letterInput?.value.trim().toLowerCase() || '';
      const regex = regexInput?.value.trim() || '';

      // Validation
      if (!name || !letter || !regex) {
        if (errorDiv) { errorDiv.textContent = 'All fields are required.'; errorDiv.style.display = 'block'; }
        return;
      }
      if (!/^[a-z]$/.test(letter)) {
        if (errorDiv) { errorDiv.textContent = 'Letter must be a single lowercase a-z character.'; errorDiv.style.display = 'block'; }
        return;
      }
      if (this.scrubPatterns.some(p => p.letter === letter)) {
        if (errorDiv) { errorDiv.textContent = `Letter "${letter}" is already used by "${this.scrubPatterns.find(p => p.letter === letter)?.name}".`; errorDiv.style.display = 'block'; }
        return;
      }
      try {
        new RegExp(regex);
      } catch {
        if (errorDiv) { errorDiv.textContent = 'Invalid regex pattern.'; errorDiv.style.display = 'block'; }
        return;
      }

      if (errorDiv) errorDiv.style.display = 'none';

      this.scrubPatterns.push({ name, letter, regex, enabled: true, isDefault: false });
      await window.electronAPI.setScrubPatterns(this.scrubPatterns);
      this.renderScrubPatterns();

      // Clear inputs
      if (nameInput) nameInput.value = '';
      if (letterInput) letterInput.value = '';
      if (regexInput) regexInput.value = '';
    });

    // Test scrub
    const testBtn = this.container.querySelector('#testScrubBtn');
    testBtn?.addEventListener('click', () => {
      const input = (this.container.querySelector('#scrubTesterInput') as HTMLTextAreaElement)?.value || '';
      const outputDiv = this.container.querySelector('#scrubTesterOutput') as HTMLElement;
      const resultPre = this.container.querySelector('#scrubTesterResult') as HTMLElement;
      const matchesDiv = this.container.querySelector('#scrubTesterMatches') as HTMLElement;

      if (!input.trim()) return;

      // Build combined regex from enabled patterns and apply scrubbing
      const enabledPatterns = this.scrubPatterns.filter(p => p.enabled);
      let scrubbed = input;
      const matches: Array<{ pattern: string; value: string; token: string }> = [];
      const counters = new Map<string, number>();
      const seen = new Map<string, string>();

      for (const p of enabledPatterns) {
        try {
          const regex = new RegExp(p.regex, 'gi');
          scrubbed = scrubbed.replace(regex, (match) => {
            const normalized = match.toLowerCase();
            if (seen.has(normalized)) return seen.get(normalized)!;
            const count = (counters.get(p.letter) ?? 0) + 1;
            counters.set(p.letter, count);
            const token = `scrub_${p.letter}${count}`;
            seen.set(normalized, token);
            matches.push({ pattern: p.name, value: match, token });
            return token;
          });
        } catch { /* skip bad regex */ }
      }

      if (outputDiv) outputDiv.style.display = 'block';
      if (resultPre) resultPre.textContent = scrubbed;
      if (matchesDiv) {
        if (matches.length === 0) {
          matchesDiv.innerHTML = '<span style="color: var(--text-muted);">No matches found.</span>';
        } else {
          matchesDiv.innerHTML = `<strong>${matches.length} value(s) scrubbed:</strong><br>` +
            matches.map(m => `<code>${escapeHtml(m.token)}</code> \u2190 <code>${escapeHtml(m.value)}</code> (${escapeHtml(m.pattern)})`).join('<br>');
        }
      }
    });
  }
}
