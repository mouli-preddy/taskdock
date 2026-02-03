# Vertical Tab Sections UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure TaskDock from screen-based navigation to a section-based tabbed interface with vertical section sidebar and horizontal tab bars.

**Architecture:** Replace the current screen toggle system (connectionScreen, prListScreen, reviewScreen) with a two-level navigation: vertical section sidebar (Review, Settings) + horizontal tab bars per section. Each PR opens in its own tab within the Review section.

**Tech Stack:** TypeScript, vanilla DOM manipulation, CSS (no frameworks)

---

## Task 1: Create Section Sidebar Component

**Files:**
- Create: `src/renderer/components/section-sidebar.ts`
- Create: `src/renderer/styles/section-sidebar.css`

**Step 1: Create the section sidebar component**

```typescript
// src/renderer/components/section-sidebar.ts
export type SectionId = 'review' | 'settings';

export interface SectionDef {
  id: SectionId;
  icon: string;
  label: string;
}

const SECTIONS: SectionDef[] = [
  {
    id: 'review',
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
    </svg>`,
    label: 'Review',
  },
  {
    id: 'settings',
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>`,
    label: 'Settings',
  },
];

export class SectionSidebar {
  private container: HTMLElement;
  private activeSection: SectionId = 'review';
  private expanded = false;
  private selectCallback: ((section: SectionId) => void) | null = null;

  constructor() {
    this.container = document.getElementById('sectionSidebar')!;
    this.render();
    this.attachEventListeners();
  }

  onSelect(callback: (section: SectionId) => void) {
    this.selectCallback = callback;
  }

  setActive(section: SectionId) {
    this.activeSection = section;
    this.updateActiveState();
  }

  getActive(): SectionId {
    return this.activeSection;
  }

  private render() {
    this.container.innerHTML = `
      <div class="section-sidebar-items">
        ${SECTIONS.map(s => `
          <button class="section-sidebar-item ${s.id === this.activeSection ? 'active' : ''}" data-section="${s.id}" title="${s.label}">
            <span class="section-icon">${s.icon}</span>
            <span class="section-label">${s.label}</span>
          </button>
        `).join('')}
      </div>
    `;
  }

  private attachEventListeners() {
    // Section click
    this.container.querySelectorAll('.section-sidebar-item').forEach(item => {
      item.addEventListener('click', () => {
        const section = (item as HTMLElement).dataset.section as SectionId;
        this.setActive(section);
        this.selectCallback?.(section);
      });
    });

    // Expand on hover
    this.container.addEventListener('mouseenter', () => {
      this.expanded = true;
      this.container.classList.add('expanded');
    });

    this.container.addEventListener('mouseleave', () => {
      this.expanded = false;
      this.container.classList.remove('expanded');
    });
  }

  private updateActiveState() {
    this.container.querySelectorAll('.section-sidebar-item').forEach(item => {
      const section = (item as HTMLElement).dataset.section;
      item.classList.toggle('active', section === this.activeSection);
    });
  }
}
```

**Step 2: Create section sidebar styles**

```css
/* src/renderer/styles/section-sidebar.css */
.section-sidebar {
  width: 48px;
  min-width: 48px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  transition: width var(--transition-normal);
  overflow: hidden;
  z-index: 10;
}

.section-sidebar.expanded {
  width: 180px;
}

.section-sidebar-items {
  display: flex;
  flex-direction: column;
  padding: var(--space-2) 0;
  gap: var(--space-1);
}

.section-sidebar-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-3);
  margin: 0 var(--space-2);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
  white-space: nowrap;
  overflow: hidden;
}

.section-sidebar-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.section-sidebar-item.active {
  background: var(--bg-active);
  color: var(--text-primary);
}

.section-sidebar-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 24px;
  background: var(--accent-blue);
  border-radius: 0 2px 2px 0;
}

.section-sidebar-item {
  position: relative;
}

.section-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.section-icon svg {
  width: 20px;
  height: 20px;
}

.section-label {
  font-size: var(--text-sm);
  font-weight: 500;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.section-sidebar.expanded .section-label {
  opacity: 1;
}
```

**Step 3: Commit**

```bash
git add src/renderer/components/section-sidebar.ts src/renderer/styles/section-sidebar.css
git commit -m "feat: add section sidebar component

Collapsible vertical sidebar for section navigation (Review, Settings).
Expands on hover to show labels."
```

---

## Task 2: Create Tab Bar Component

**Files:**
- Create: `src/renderer/components/tab-bar.ts`
- Create: `src/renderer/styles/tab-bar.css`

**Step 1: Create the tab bar component**

```typescript
// src/renderer/components/tab-bar.ts
export interface Tab {
  id: string;
  label: string;
  icon?: string;
  closeable: boolean;
}

export class TabBar {
  private container: HTMLElement;
  private tabs: Tab[] = [];
  private activeTabId: string | null = null;
  private selectCallback: ((tabId: string) => void) | null = null;
  private closeCallback: ((tabId: string) => void) | null = null;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.render();
  }

  onSelect(callback: (tabId: string) => void) {
    this.selectCallback = callback;
  }

  onClose(callback: (tabId: string) => void) {
    this.closeCallback = callback;
  }

  setTabs(tabs: Tab[]) {
    this.tabs = tabs;
    this.render();
  }

  addTab(tab: Tab) {
    // Don't add duplicate
    if (this.tabs.find(t => t.id === tab.id)) {
      this.setActive(tab.id);
      return;
    }
    this.tabs.push(tab);
    this.render();
  }

  removeTab(tabId: string) {
    const index = this.tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    const tab = this.tabs[index];
    if (!tab.closeable) return;

    this.tabs.splice(index, 1);

    // If removing active tab, activate adjacent
    if (this.activeTabId === tabId) {
      const newIndex = Math.min(index, this.tabs.length - 1);
      this.activeTabId = this.tabs[newIndex]?.id || null;
      if (this.activeTabId) {
        this.selectCallback?.(this.activeTabId);
      }
    }

    this.render();
  }

  setActive(tabId: string) {
    if (!this.tabs.find(t => t.id === tabId)) return;
    this.activeTabId = tabId;
    this.updateActiveState();
  }

  getActive(): string | null {
    return this.activeTabId;
  }

  getTabs(): Tab[] {
    return [...this.tabs];
  }

  private render() {
    this.container.innerHTML = `
      <div class="tab-bar-tabs">
        ${this.tabs.map(tab => `
          <div class="tab-bar-tab ${tab.id === this.activeTabId ? 'active' : ''}" data-tab-id="${tab.id}">
            ${tab.icon ? `<span class="tab-icon">${tab.icon}</span>` : ''}
            <span class="tab-label">${this.escapeHtml(tab.label)}</span>
            ${tab.closeable ? `
              <button class="tab-close" data-tab-id="${tab.id}" title="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            ` : ''}
          </div>
        `).join('')}
      </div>
    `;

    this.attachEventListeners();
  }

  private attachEventListeners() {
    // Tab click
    this.container.querySelectorAll('.tab-bar-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        // Don't trigger if clicking close button
        if ((e.target as HTMLElement).closest('.tab-close')) return;

        const tabId = (tab as HTMLElement).dataset.tabId!;
        this.setActive(tabId);
        this.selectCallback?.(tabId);
      });

      // Middle click to close
      tab.addEventListener('auxclick', (e) => {
        if ((e as MouseEvent).button === 1) {
          const tabId = (tab as HTMLElement).dataset.tabId!;
          const tabData = this.tabs.find(t => t.id === tabId);
          if (tabData?.closeable) {
            this.closeCallback?.(tabId);
          }
        }
      });
    });

    // Close button click
    this.container.querySelectorAll('.tab-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tabId = (btn as HTMLElement).dataset.tabId!;
        this.closeCallback?.(tabId);
      });
    });
  }

  private updateActiveState() {
    this.container.querySelectorAll('.tab-bar-tab').forEach(tab => {
      const tabId = (tab as HTMLElement).dataset.tabId;
      tab.classList.toggle('active', tabId === this.activeTabId);
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
```

**Step 2: Create tab bar styles**

```css
/* src/renderer/styles/tab-bar.css */
.tab-bar {
  height: 36px;
  min-height: 36px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: stretch;
}

.tab-bar-tabs {
  display: flex;
  align-items: stretch;
  overflow-x: auto;
  overflow-y: hidden;
  flex: 1;
}

.tab-bar-tabs::-webkit-scrollbar {
  height: 0;
}

.tab-bar-tab {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  min-width: 120px;
  max-width: 200px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-right: 1px solid var(--border-color);
  transition: all var(--transition-fast);
  user-select: none;
  position: relative;
}

.tab-bar-tab:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tab-bar-tab.active {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.tab-bar-tab.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--accent-blue);
}

.tab-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.tab-icon svg {
  width: 14px;
  height: 14px;
}

.tab-label {
  font-size: var(--text-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  opacity: 0;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.tab-bar-tab:hover .tab-close {
  opacity: 1;
}

.tab-close:hover {
  background: var(--bg-active);
  color: var(--text-primary);
}
```

**Step 3: Commit**

```bash
git add src/renderer/components/tab-bar.ts src/renderer/styles/tab-bar.css
git commit -m "feat: add tab bar component

Horizontal tab bar with close buttons, middle-click support,
and active state indicator."
```

---

## Task 3: Create Settings View Component

**Files:**
- Create: `src/renderer/components/settings-view.ts`
- Create: `src/renderer/styles/settings-view.css`

**Step 1: Create the settings view component**

```typescript
// src/renderer/components/settings-view.ts
import { Toast } from './toast.js';

export interface ReviewSettings {
  organization: string;
  project: string;
  pat: string;
}

export class SettingsView {
  private container: HTMLElement;
  private settings: ReviewSettings = { organization: '', project: '', pat: '' };
  private saveCallback: ((settings: ReviewSettings) => Promise<void>) | null = null;
  private testCallback: ((settings: ReviewSettings) => Promise<boolean>) | null = null;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.render();
  }

  onSave(callback: (settings: ReviewSettings) => Promise<void>) {
    this.saveCallback = callback;
  }

  onTest(callback: (settings: ReviewSettings) => Promise<boolean>) {
    this.testCallback = callback;
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
        <div class="settings-content">
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
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
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
                <button type="submit" class="btn btn-primary" id="saveSettingsBtn">
                  <span class="btn-text">Save Settings</span>
                  <span class="btn-loading">
                    <span class="spinner"></span>
                    Saving...
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
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  private attachEventListeners() {
    const form = this.container.querySelector('#settingsForm') as HTMLFormElement;
    const testBtn = this.container.querySelector('#testConnectionBtn') as HTMLButtonElement;
    const toggleBtn = this.container.querySelector('#togglePatVisibility') as HTMLButtonElement;
    const patInput = this.container.querySelector('#settingsPat') as HTMLInputElement;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleSave();
    });

    testBtn.addEventListener('click', async () => {
      await this.handleTest();
    });

    toggleBtn.addEventListener('click', () => {
      patInput.type = patInput.type === 'password' ? 'text' : 'password';
    });

    // Update settings on input change
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
  }

  private updateFormValues() {
    (this.container.querySelector('#settingsOrganization') as HTMLInputElement).value = this.settings.organization;
    (this.container.querySelector('#settingsProject') as HTMLInputElement).value = this.settings.project;
    (this.container.querySelector('#settingsPat') as HTMLInputElement).value = this.settings.pat;
  }

  private async handleSave() {
    const saveBtn = this.container.querySelector('#saveSettingsBtn') as HTMLButtonElement;
    saveBtn.classList.add('loading');

    try {
      await this.saveCallback?.(this.settings);
      Toast.success('Settings saved');
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
}
```

**Step 2: Create settings view styles**

```css
/* src/renderer/styles/settings-view.css */
.settings-view {
  height: 100%;
  overflow-y: auto;
  padding: var(--space-8);
  background: var(--bg-primary);
}

.settings-content {
  max-width: 600px;
  margin: 0 auto;
}

.settings-section {
  margin-bottom: var(--space-8);
  padding: var(--space-6);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
}

.settings-section-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--space-2);
}

.settings-section-description {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-bottom: var(--space-5);
}

.settings-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.settings-form .form-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.settings-form label {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
}

.settings-form input {
  padding: var(--space-2) var(--space-3);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--text-base);
}

.settings-form input:focus {
  outline: none;
  border-color: var(--accent-blue);
  box-shadow: 0 0 0 3px rgba(31, 111, 235, 0.2);
}

.form-hint {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.form-hint code {
  background: var(--bg-tertiary);
  padding: 1px 4px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
}

.input-with-toggle {
  display: flex;
  gap: var(--space-2);
}

.input-with-toggle input {
  flex: 1;
}

.form-actions {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.connection-status {
  margin-top: var(--space-4);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  display: none;
}

.connection-status.visible {
  display: block;
}

.connection-status.connected {
  background: var(--success-bg);
  color: var(--success);
}

.connection-status.error {
  background: var(--error-bg);
  color: var(--error);
}

.connection-status.testing {
  background: var(--info-bg);
  color: var(--info);
}

.settings-help {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: var(--leading-relaxed);
}

.settings-help ol {
  margin-top: var(--space-2);
  padding-left: var(--space-5);
}

.settings-help li {
  margin-bottom: var(--space-2);
}

.settings-help code {
  background: var(--bg-tertiary);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}
```

**Step 3: Commit**

```bash
git add src/renderer/components/settings-view.ts src/renderer/styles/settings-view.css
git commit -m "feat: add settings view component

Settings form for ADO configuration with organization, project,
and optional PAT fields. Includes test connection functionality."
```

---

## Task 4: Add Config Service to Main Process

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts` (will need to check actual filename)
- Modify: `src/renderer/electron.d.ts`

**Step 1: Add config IPC handlers to main.ts**

Add after the existing store definition (~line 21):

```typescript
// In main.ts, add a new store for app config
import fs from 'fs';

const CONFIG_DIR = path.join(app.getPath('userData'), 'taskdock');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

interface AppConfig {
  ado: {
    organization: string;
    project: string;
    pat: string;
  };
}

function loadConfig(): AppConfig | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load config:', error);
  }
  return null;
}

function saveConfig(config: AppConfig): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Failed to save config:', error);
    throw error;
  }
}

function isConfigured(): boolean {
  const config = loadConfig();
  return !!(config?.ado?.organization && config?.ado?.project);
}
```

Add IPC handlers in setupIpcHandlers():

```typescript
  // Config handlers
  ipcMain.handle('config:load', async () => {
    return loadConfig();
  });

  ipcMain.handle('config:save', async (_, config: AppConfig) => {
    saveConfig(config);
  });

  ipcMain.handle('config:is-configured', async () => {
    return isConfigured();
  });

  ipcMain.handle('config:test-connection', async (_, org: string, project: string, pat?: string) => {
    try {
      // Try to fetch PRs to test connection
      if (pat) {
        adoClient.setPAT(pat);
      }
      await adoClient.getPullRequestsForReviewer(org, project);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
```

**Step 2: Update preload.ts with config API**

Add to the contextBridge.exposeInMainWorld call:

```typescript
  // Config API
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config: any) => ipcRenderer.invoke('config:save', config),
  isConfigured: () => ipcRenderer.invoke('config:is-configured'),
  testConnection: (org: string, project: string, pat?: string) =>
    ipcRenderer.invoke('config:test-connection', org, project, pat),
```

**Step 3: Update electron.d.ts types**

Add to the ElectronAPI interface:

```typescript
  // Config
  loadConfig: () => Promise<{
    ado: {
      organization: string;
      project: string;
      pat: string;
    };
  } | null>;
  saveConfig: (config: {
    ado: {
      organization: string;
      project: string;
      pat: string;
    };
  }) => Promise<void>;
  isConfigured: () => Promise<boolean>;
  testConnection: (org: string, project: string, pat?: string) => Promise<{ success: boolean; error?: string }>;
```

**Step 4: Commit**

```bash
git add src/main/main.ts src/main/preload.ts src/renderer/electron.d.ts
git commit -m "feat: add config service for ADO settings

Store config in %APPDATA%/taskdock/config.json.
Add IPC handlers for load, save, test connection."
```

---

## Task 5: Create PR Home View Component

**Files:**
- Create: `src/renderer/components/pr-home-view.ts`

**Step 1: Create PR home view component**

This extracts the PR list functionality from app.ts into a reusable component.

```typescript
// src/renderer/components/pr-home-view.ts
import type { PullRequest } from '../../shared/types.js';

export class PRHomeView {
  private container: HTMLElement;
  private myPRs: PullRequest[] = [];
  private createdPRs: PullRequest[] = [];
  private activeTab: 'review' | 'created' = 'review';
  private openPRCallback: ((pr: PullRequest) => void) | null = null;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.render();
  }

  onOpenPR(callback: (pr: PullRequest) => void) {
    this.openPRCallback = callback;
  }

  setPRs(myPRs: PullRequest[], createdPRs: PullRequest[]) {
    this.myPRs = myPRs;
    this.createdPRs = createdPRs;
    this.renderPRLists();
  }

  setSubtitle(text: string) {
    const el = this.container.querySelector('.pr-home-subtitle');
    if (el) el.textContent = text;
  }

  private render() {
    this.container.innerHTML = `
      <div class="pr-home-view">
        <header class="pr-home-header">
          <div class="pr-home-title">
            <h1>Pull Requests</h1>
            <span class="pr-home-subtitle">Loading...</span>
          </div>
          <button class="btn btn-secondary" id="refreshPRsBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10"/>
              <polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            Refresh
          </button>
        </header>

        <div class="pr-home-tabs">
          <button class="pr-tab active" data-tab="review">
            <span>For Review</span>
            <span class="tab-count" id="reviewCount">0</span>
          </button>
          <button class="pr-tab" data-tab="created">
            <span>Created by Me</span>
            <span class="tab-count" id="createdCount">0</span>
          </button>
        </div>

        <div class="pr-home-lists">
          <div class="pr-list" id="prListReview"></div>
          <div class="pr-list hidden" id="prListCreated"></div>
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  private attachEventListeners() {
    // Tab switching
    this.container.querySelectorAll('.pr-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = (tab as HTMLElement).dataset.tab as 'review' | 'created';
        this.switchTab(tabName);
      });
    });
  }

  private switchTab(tab: 'review' | 'created') {
    this.activeTab = tab;

    this.container.querySelectorAll('.pr-tab').forEach(t => {
      t.classList.toggle('active', (t as HTMLElement).dataset.tab === tab);
    });

    this.container.querySelector('#prListReview')!.classList.toggle('hidden', tab !== 'review');
    this.container.querySelector('#prListCreated')!.classList.toggle('hidden', tab !== 'created');
  }

  private renderPRLists() {
    this.renderPRList('review', this.myPRs);
    this.renderPRList('created', this.createdPRs);

    this.container.querySelector('#reviewCount')!.textContent = this.myPRs.length.toString();
    this.container.querySelector('#createdCount')!.textContent = this.createdPRs.length.toString();
  }

  private renderPRList(type: 'review' | 'created', prs: PullRequest[]) {
    const container = this.container.querySelector(type === 'review' ? '#prListReview' : '#prListCreated')!;

    if (prs.length === 0) {
      container.innerHTML = `
        <div class="pr-list-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
          </svg>
          <p>No pull requests found</p>
        </div>
      `;
      return;
    }

    container.innerHTML = prs.map(pr => this.renderPRCard(pr)).join('');

    // Add click handlers
    container.querySelectorAll('.pr-card').forEach(card => {
      card.addEventListener('click', () => {
        const prId = parseInt((card as HTMLElement).dataset.prId || '0');
        const pr = prs.find(p => p.pullRequestId === prId);
        if (pr) {
          this.openPRCallback?.(pr);
        }
      });
    });
  }

  private renderPRCard(pr: PullRequest): string {
    const sourceBranch = pr.sourceRefName.replace('refs/heads/', '');
    const targetBranch = pr.targetRefName.replace('refs/heads/', '');
    const date = new Date(pr.creationDate);
    const timeAgo = this.formatTimeAgo(date);

    const reviewers = (pr.reviewers || []).slice(0, 5).map(r => {
      const voteClass = this.getVoteClass(r.vote);
      const initials = this.getInitials(r.displayName);
      const hasImage = r.imageUrl && r.imageUrl.trim();
      return `
        <div class="reviewer-wrapper">
          ${hasImage
            ? `<img class="pr-card-reviewer" src="${r.imageUrl}" alt="${initials}" title="${r.displayName}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
            : ''}
          <span class="pr-card-reviewer-placeholder" ${hasImage ? 'style="display:none"' : ''} title="${r.displayName}">${initials}</span>
          ${r.vote !== 0 ? `<span class="pr-card-vote ${voteClass}"></span>` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="pr-card" data-pr-id="${pr.pullRequestId}">
        <div class="pr-card-header">
          <span class="pr-card-id">#${pr.pullRequestId}</span>
          <span class="pr-card-title">${this.escapeHtml(pr.title)}</span>
        </div>
        <div class="pr-card-meta">
          <span class="pr-card-meta-item">
            <span class="pr-card-repo">${pr.repository.name}</span>
          </span>
          <span class="pr-card-meta-item">
            ${sourceBranch} → ${targetBranch}
          </span>
          <span class="pr-card-meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            ${timeAgo}
          </span>
          <span class="pr-card-meta-item">
            by ${pr.createdBy.displayName}
          </span>
          ${reviewers ? `<div class="pr-card-reviewers">${reviewers}</div>` : ''}
        </div>
      </div>
    `;
  }

  private formatTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  private getVoteClass(vote: number): string {
    if (vote === 10) return 'approved';
    if (vote === 5) return 'approved-suggestions';
    if (vote === -5) return 'waiting';
    if (vote === -10) return 'rejected';
    return 'no-vote';
  }

  private getInitials(name: string): string {
    const parts = name.split(/[\s\\]+/).filter(p => p.length > 0);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
```

**Step 2: Commit**

```bash
git add src/renderer/components/pr-home-view.ts
git commit -m "feat: extract PR home view component

Reusable PR list component with For Review / Created by Me tabs.
Will be used as the Home tab in Review section."
```

---

## Task 6: Update HTML Structure

**Files:**
- Modify: `src/renderer/index.html`

**Step 1: Replace the HTML structure with new layout**

Replace the body content with:

```html
<body>
  <div id="app">
    <!-- Title Bar (for macOS) -->
    <header class="title-bar" id="titleBar">
      <div class="title-bar-drag-region"></div>
      <div class="title-bar-content">
        <span class="app-title">TaskDock</span>
      </div>
    </header>

    <!-- Main App Container -->
    <div class="app-container">
      <!-- Section Sidebar -->
      <nav class="section-sidebar" id="sectionSidebar"></nav>

      <!-- Content Area -->
      <div class="content-area">
        <!-- Tab Bar -->
        <div class="tab-bar" id="tabBar"></div>

        <!-- Tab Content Panels -->
        <div class="tab-content" id="tabContent">
          <!-- Review Section Content -->
          <div class="section-content" id="reviewSectionContent">
            <!-- Home Tab Content (PR List) -->
            <div class="tab-panel" id="homeTabPanel"></div>

            <!-- PR Review Tab Panels (dynamically created) -->
          </div>

          <!-- Settings Section Content -->
          <div class="section-content hidden" id="settingsSectionContent">
            <!-- Settings Tab Content -->
            <div class="tab-panel" id="settingsTabPanel"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Setup Modal -->
    <div class="modal-backdrop hidden" id="setupModalBackdrop">
      <div class="setup-modal" id="setupModal">
        <div class="setup-modal-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
          </svg>
        </div>
        <h2>Welcome to TaskDock</h2>
        <p>Please configure your Azure DevOps connection to get started.</p>
        <button class="btn btn-primary" id="goToSettingsBtn">Go to Settings</button>
      </div>
    </div>

    <!-- Loading Overlay -->
    <div class="loading-overlay hidden" id="loadingOverlay">
      <div class="loading-content">
        <div class="loading-spinner"></div>
        <p class="loading-text">Loading...</p>
      </div>
    </div>

    <!-- Toast Container -->
    <div class="toast-container" id="toastContainer"></div>
  </div>

  <script type="module" src="./app.ts"></script>
</body>
```

**Step 2: Update CSS imports in head**

```html
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://dev.azure.com https://vssps.dev.azure.com">
  <title>TaskDock</title>
  <link rel="stylesheet" href="./styles/main.css">
  <link rel="stylesheet" href="./styles/section-sidebar.css">
  <link rel="stylesheet" href="./styles/tab-bar.css">
  <link rel="stylesheet" href="./styles/settings-view.css">
  <link rel="stylesheet" href="./styles/diff.css">
  <link rel="stylesheet" href="./styles/components.css">
  <link rel="stylesheet" href="./styles/hljs-theme.css">
  <link rel="stylesheet" href="./styles/ai-review.css">
</head>
```

**Step 3: Commit**

```bash
git add src/renderer/index.html
git commit -m "refactor: update HTML structure for tabbed UI

Replace screen-based layout with section sidebar + tab bar + content area.
Add setup modal for first-time configuration."
```

---

## Task 7: Update Main CSS for New Layout

**Files:**
- Modify: `src/renderer/styles/main.css`

**Step 1: Add new layout styles**

Add to main.css after the existing layout section:

```css
/* ========================================
   App Container Layout
   ======================================== */
.app-container {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tab-content {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.section-content {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
}

.section-content.hidden {
  display: none;
}

.tab-panel {
  flex: 1;
  overflow: hidden;
  display: none;
}

.tab-panel.active {
  display: flex;
  flex-direction: column;
}

/* ========================================
   Setup Modal
   ======================================== */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: var(--bg-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-backdrop.hidden {
  display: none;
}

.setup-modal {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: var(--space-8);
  max-width: 400px;
  text-align: center;
  box-shadow: var(--shadow-lg);
}

.setup-modal-icon {
  margin-bottom: var(--space-4);
  color: var(--text-secondary);
}

.setup-modal h2 {
  font-size: var(--text-xl);
  font-weight: 600;
  margin-bottom: var(--space-2);
}

.setup-modal p {
  color: var(--text-secondary);
  margin-bottom: var(--space-6);
}

/* PR Home View Styles */
.pr-home-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pr-home-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-6);
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.pr-home-title h1 {
  font-size: var(--text-lg);
  font-weight: 600;
}

.pr-home-subtitle {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.pr-home-tabs {
  display: flex;
  padding: 0 var(--space-6);
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.pr-home-lists {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-4) var(--space-6);
}
```

**Step 2: Commit**

```bash
git add src/renderer/styles/main.css
git commit -m "style: add layout styles for tabbed UI

App container with flex layout, setup modal styles,
and PR home view styles."
```

---

## Task 8: Rewrite App.ts for Tabbed Architecture

**Files:**
- Modify: `src/renderer/app.ts`

**Step 1: Rewrite the app to use the new architecture**

This is a significant rewrite. The new app.ts will:
1. Initialize section sidebar, tab bars
2. Manage tab state for each section
3. Handle section/tab switching
4. Create PR review panels dynamically

Due to the size of this change, implement it incrementally:

1. First, create the basic shell with section switching
2. Then add the PR Home tab
3. Then add PR review tab creation
4. Finally, port over the existing PR review functionality

The full implementation will preserve all existing functionality but reorganize it into the tabbed architecture.

Key changes:
- Replace `showConnectionScreen()`, `showPRListScreen()`, `showReviewScreen()` with section/tab navigation
- Keep a Map of PR tab states for restoration
- Move PR list rendering into PRHomeView component
- Create PR review content dynamically when opening a new tab

**Step 2: Commit incrementally**

```bash
git add src/renderer/app.ts
git commit -m "refactor: rewrite app.ts for tabbed architecture

Implement section-based navigation with tab management.
Each PR opens in its own tab with preserved state."
```

---

## Task 9: Integration Testing

**Files:**
- All modified files

**Step 1: Test the application**

Run: `npm run dev`

Test checklist:
- [ ] App starts and shows setup modal (first launch)
- [ ] Clicking "Go to Settings" shows settings section
- [ ] Saving settings works and persists to config.json
- [ ] Review section shows Home tab with PR list
- [ ] Clicking a PR opens it in a new tab
- [ ] Tab label shows `repo/#123` format
- [ ] Switching between tabs preserves state
- [ ] Middle-click closes PR tabs
- [ ] Home tab cannot be closed
- [ ] Section switching works correctly
- [ ] Existing PR review features work (diff, comments, AI review)

**Step 2: Fix any issues found during testing**

**Step 3: Final commit**

```bash
git add .
git commit -m "feat: complete vertical tab sections UI

Implemented:
- Collapsible section sidebar (Review, Settings)
- Horizontal tab bars per section
- Multi-PR tab support with state preservation
- Config storage in %APPDATA%/taskdock
- First-launch setup modal"
```

---

## Summary

| Task | Description | Est. Complexity |
|------|-------------|-----------------|
| 1 | Section Sidebar Component | Medium |
| 2 | Tab Bar Component | Medium |
| 3 | Settings View Component | Medium |
| 4 | Config Service (Main Process) | Low |
| 5 | PR Home View Component | Medium |
| 6 | Update HTML Structure | Low |
| 7 | Update CSS Layout | Low |
| 8 | Rewrite App.ts | High |
| 9 | Integration Testing | Medium |

Total: 9 tasks
