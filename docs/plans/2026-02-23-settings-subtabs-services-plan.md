# Settings Sub-tabs & Services Tab Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Organize settings into 4 sub-tabs (Connection, Review, AI, Services) and add a Services registry where users can register services with name, description, local repo path, and cross-links to other services.

**Architecture:** Add a horizontal tab bar inside the existing SettingsView header. Wrap existing settings card sections into tab container divs toggled by CSS. Add a new Services tab with CRUD UI. Persist services via new Tauri commands reading/writing to `store.json`.

**Tech Stack:** TypeScript (renderer), Rust (Tauri commands), CSS

---

### Task 1: Add Rust data model and Tauri commands for services

**Files:**
- Modify: `src-tauri/src/commands/storage.rs:334` (end of file - add structs and commands)
- Modify: `src-tauri/src/lib.rs:166-167` (register new commands in invoke_handler)

**Step 1: Add ServiceEntry struct and get/set commands to storage.rs**

Add after the last `set_notification_settings` command (line ~333):

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ServiceEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub repo_path: String,
    pub linked_service_ids: Vec<String>,
}

#[tauri::command]
pub fn get_services() -> Result<Vec<ServiceEntry>, String> {
    let data = load_store_data()?;
    let services_value = get_nested_value(&data, "services")
        .unwrap_or(serde_json::Value::Array(vec![]));

    let services: Vec<ServiceEntry> = serde_json::from_value(services_value)
        .map_err(|e| format!("Failed to parse services: {}", e))?;

    Ok(services)
}

#[tauri::command]
pub fn set_services(services: Vec<ServiceEntry>) -> Result<(), String> {
    let mut data = load_store_data()?;
    let services_value = serde_json::to_value(services)
        .map_err(|e| format!("Failed to serialize services: {}", e))?;
    set_nested_value(&mut data, "services", services_value)?;
    save_store_data(&data)?;
    Ok(())
}
```

**Step 2: Register commands in lib.rs**

In `src-tauri/src/lib.rs`, inside the `generate_handler![]` macro (after line 167 `commands::storage::set_notification_settings,`), add:

```rust
            commands::storage::get_services,
            commands::storage::set_services,
```

**Step 3: Build to verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors.

**Step 4: Commit**

```bash
git add src-tauri/src/commands/storage.rs src-tauri/src/lib.rs
git commit -m "feat(settings): add Rust data model and Tauri commands for services"
```

---

### Task 2: Add TypeScript API bindings for services

**Files:**
- Modify: `src/renderer/api.d.ts:364` (after setNotificationSettings declaration)
- Modify: `src/renderer/tauri-api.ts:501` (after setNotificationSettings implementation)

**Step 1: Add type declarations to api.d.ts**

After the `setNotificationSettings` declaration (around line 364), add:

```typescript
  // Services
  getServices: () => Promise<{
    id: string;
    name: string;
    description: string;
    repoPath: string;
    linkedServiceIds: string[];
  }[]>;
  setServices: (services: {
    id: string;
    name: string;
    description: string;
    repoPath: string;
    linkedServiceIds: string[];
  }[]) => Promise<void>;
```

**Step 2: Add Tauri API implementation to tauri-api.ts**

After `setNotificationSettings` (around line 501), add:

```typescript
  // Services
  getServices: async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_services');
  },
  setServices: async (services: any) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('set_services', { services });
  },
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 4: Commit**

```bash
git add src/renderer/api.d.ts src/renderer/tauri-api.ts
git commit -m "feat(settings): add TypeScript API bindings for services"
```

---

### Task 3: Add CSS styles for settings sub-tabs

**Files:**
- Modify: `src/renderer/styles/settings-view.css:532` (end of file - add sub-tab styles)

**Step 1: Add sub-tab CSS to settings-view.css**

Append to the end of the file:

```css
/* Settings Sub-tabs */
.settings-tabs {
  display: flex;
  gap: var(--space-1);
  padding: 0 var(--space-6);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.settings-tab-btn {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
  white-space: nowrap;
}

.settings-tab-btn:hover {
  color: var(--text-primary);
}

.settings-tab-btn.active {
  color: var(--accent-blue);
  border-bottom-color: var(--accent-blue);
}

.settings-tab-content {
  display: none;
}

.settings-tab-content.active {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-4);
}

@media (min-width: 768px) {
  .settings-tab-content.active {
    grid-template-columns: repeat(2, 1fr);
  }

  .settings-tab-content .settings-section.full-width {
    grid-column: 1 / -1;
  }
}

/* Service list styles */
.service-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.service-card {
  padding: var(--space-4);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.service-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.service-card-name {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-primary);
}

.service-card-description {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.service-card-repo {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.service-card-links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: var(--space-1);
}

.service-link-badge {
  font-size: var(--text-xs);
  padding: 2px 8px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-full);
  color: var(--text-secondary);
}

.service-empty {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
  font-style: italic;
  padding: var(--space-4);
  background: var(--bg-primary);
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
  text-align: center;
}

/* Add service form */
.service-add-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
}

.service-add-form .form-row {
  display: flex;
  gap: var(--space-2);
  align-items: flex-end;
}

.service-add-form .form-row .form-group {
  flex: 1;
}
```

**Step 2: Commit**

```bash
git add src/renderer/styles/settings-view.css
git commit -m "feat(settings): add CSS styles for sub-tabs and services"
```

---

### Task 4: Refactor SettingsView render() to use sub-tabs

**Files:**
- Modify: `src/renderer/components/settings-view.ts`

This is the largest task. The `render()` method (starting ~line 215) generates all the HTML. We need to:

1. Add a tab bar after the header
2. Wrap existing sections in tab content containers
3. Add the Services tab content
4. Add tab switching logic
5. Add services state, load/save/render methods

**Step 1: Add services state and imports**

At the top of the file (line 8), add `Server` to the icon imports:

```typescript
import { getIcon, Eye, Plus, X, Globe, MessageSquare, Wand2, Search, Server } from '../utils/icons.js';
```

Add a `ServiceEntry` interface after the existing `ReviewSettings` interface (~line 14):

```typescript
export interface ServiceEntry {
  id: string;
  name: string;
  description: string;
  repoPath: string;
  linkedServiceIds: string[];
}
```

Add a `services` field and `activeSettingsTab` field to the class (after the existing private fields, ~line 26):

```typescript
  private services: ServiceEntry[] = [];
  private activeSettingsTab: string = 'connection';
```

**Step 2: Update constructor to load services**

In the constructor (line 28-36), add `this.loadServices();` after `this.loadPlugins();`:

```typescript
  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.render();
    this.loadConsoleReviewSettings();
    this.loadPollingSettings();
    this.loadNotificationSettings();
    this.loadPlugins();
    this.loadServices();
    this.attachReloadAllHandler();
  }
```

**Step 3: Rewrite the render() method**

Replace the entire `render()` method body. The structure is:
- Header with save button (unchanged)
- New: Tab bar row with 4 tabs
- `.settings-content` now contains 4 `.settings-tab-content` divs
- Connection tab: ADO connection + auth help + monitored repos sections
- Review tab: Console review + polling sections
- AI tab: AI providers + notifications + plugins sections
- Services tab: services list + add form

The render method (line 215-548) should become:

```typescript
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
        </div>
        <div class="settings-content">

          <!-- Connection Tab -->
          <div class="settings-tab-content active" data-tab-content="connection">
            <div class="settings-section">
              <h2 class="settings-section-title">Azure DevOps Connection</h2>
              <p class="settings-section-description">Configure your Azure DevOps connection to browse and review pull requests.</p>

              <form class="settings-form" id="settingsForm">
                <div class="form-group">
                  <label for="settingsOrganization">Organization</label>
                  <input type="text" id="settingsOrganization" placeholder="e.g., mycompany" required>
                  <span class="form-hint">Your Azure DevOps organization name</span>
                </div>

                <div class="form-group">
                  <label for="settingsProject">Project</label>
                  <input type="text" id="settingsProject" placeholder="e.g., myproject" required>
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
                  <div class="service-add-form form-row">
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

        </div>
      </div>
    `;

    this.attachEventListeners();
    this.attachSettingsTabListeners();
  }
```

**Step 4: Add tab switching method**

Add after the `render()` method:

```typescript
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
```

**Step 5: Add services load/save/render methods**

Add these methods to the class:

```typescript
  private async loadServices(): Promise<void> {
    try {
      this.services = await window.electronAPI.getServices();
      this.renderServicesList();
    } catch (error) {
      console.error('Failed to load services:', error);
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
```

**Step 6: Add service event listeners to attachEventListeners()**

Inside the existing `attachEventListeners()` method, add after the test notification button handler (~after line 620):

```typescript
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
```

**Step 7: Verify the app builds**

Run: `npm run build` (or equivalent)
Expected: Builds successfully.

**Step 8: Commit**

```bash
git add src/renderer/components/settings-view.ts
git commit -m "feat(settings): add sub-tabs and services tab with CRUD"
```

---

### Task 5: Verify Server icon is available in icons utility

**Files:**
- Check: `src/renderer/utils/icons.ts`

**Step 1: Check if `Server` icon exists in the icons utility**

Search for `Server` in `src/renderer/utils/icons.ts`. If it's not exported, add it. Lucide icons include a `Server` icon. If it doesn't exist in the project's icon set, use `Globe` as a fallback or add the Server SVG path.

**Step 2: If needed, export the Server icon**

If `Server` is not already exported, add it to the exports in `icons.ts` following the same pattern as existing icons.

**Step 3: Commit if changes were needed**

```bash
git add src/renderer/utils/icons.ts
git commit -m "feat(icons): export Server icon for services tab"
```

---

### Task 6: Manual smoke test

**Step 1: Run the app**

Run: `npm run dev` (or equivalent dev command)

**Step 2: Verify sub-tabs**

1. Navigate to Settings in the sidebar
2. Verify 4 sub-tabs appear: Connection, Review, AI, Services
3. Click each tab - verify correct sections show/hide
4. Verify Connection tab shows ADO settings, auth help, monitored repos
5. Verify Review tab shows console review settings, polling
6. Verify AI tab shows AI provider cards, notifications, plugins
7. Verify Services tab shows empty state

**Step 3: Test service CRUD**

1. On Services tab, fill in name "Backend API", description "Main API service"
2. Click Browse, select a local git repo folder
3. Click "Add Service" - verify it appears in the list
4. Add a second service "Frontend" and check "Backend API" as linked
5. Verify the "Backend API" badge shows under "Frontend"
6. Click remove on "Backend API" - verify it's removed and the linked reference on "Frontend" is cleaned up

**Step 4: Test persistence**

1. Add a service, close and reopen the app
2. Navigate to Settings > Services - verify the service persists

**Step 5: Test Save All still works**

1. Go to Connection tab, modify a field
2. Click "Save All Settings" - verify all settings (including services) are saved
