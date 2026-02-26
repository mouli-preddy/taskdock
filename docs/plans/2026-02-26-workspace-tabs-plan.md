# Workspace Tabs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Workspaces" sidebar section where users group CFV calls, DGrep searches, and ICM incidents into named investigation contexts with mixed-type subtabs.

**Architecture:** Workspace as View Orchestrator - each workspace manages a flat list of subtabs. Subtabs reuse existing view components (`CfvCallView`, `DgrepSearchView`, `IcmIncidentDetailView`). Views stay mounted on subtab switch (CSS hide/show). State persisted to `store.json` via existing `loadStoreData`/`saveStoreData` in the backend bridge.

**Tech Stack:** TypeScript, Lucide icons, existing TabBar component, WebSocket RPC bridge, CSS variables

**Design Doc:** `docs/plans/2026-02-26-workspace-tabs-design.md`

---

### Task 1: Shared Type Definitions

**Files:**
- Create: `src/shared/workspace-types.ts`

**Step 1: Create type definitions file**

```typescript
// src/shared/workspace-types.ts

export type WorkspaceSubtabType = 'cfv' | 'dgrep' | 'icm';

export interface CfvSubtabState {
  callId: string;
}

export interface DgrepSubtabState {
  searchQuery: string;
  timeRange: { start: string; end: string };
}

export interface IcmSubtabState {
  incidentId: number;
}

export type WorkspaceSubtabState = CfvSubtabState | DgrepSubtabState | IcmSubtabState;

export interface WorkspaceSubtab {
  id: string;
  type: WorkspaceSubtabType;
  label: string;
  state: WorkspaceSubtabState;
}

export interface Workspace {
  id: string;
  name: string;
  subtabs: WorkspaceSubtab[];
  activeSubtabId: string | null;
  createdAt: number;
}

export interface WorkspacesData {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
}
```

**Step 2: Commit**

```bash
git add src/shared/workspace-types.ts
git commit -m "feat(workspace): add shared type definitions"
```

---

### Task 2: Backend Persistence (RPC Handlers)

**Files:**
- Modify: `src-backend/bridge.ts` (add RPC cases near line 1192, alongside existing `dgrep:save-query` pattern)
- Modify: `src/renderer/tauri-api.ts` (add API methods near line 718, alongside existing dgrep save/load)
- Modify: `src/renderer/api.d.ts` (add type declarations)

**Step 1: Add RPC handlers to bridge.ts**

Add three new RPC cases in `src-backend/bridge.ts` inside the main switch statement, after the existing dgrep save/load/delete cases (around line 1215):

```typescript
    // Workspaces
    case 'workspaces:load': {
      const storeData = loadStoreData();
      return storeData.workspaces || { workspaces: [], activeWorkspaceId: null };
    }
    case 'workspaces:save': {
      const storeData = loadStoreData();
      storeData.workspaces = params[0];
      saveStoreData(storeData);
      return;
    }
```

**Step 2: Add API methods to tauri-api.ts**

Add after the `dgrepDeleteQuery` line (around line 723):

```typescript
  // Workspaces API
  workspacesLoad: () =>
    invoke('workspaces:load'),
  workspacesSave: (data: any) =>
    invoke('workspaces:save', data),
```

**Step 3: Add type declarations to api.d.ts**

Add to the `ElectronAPI` interface:

```typescript
  workspacesLoad(): Promise<import('../shared/workspace-types.js').WorkspacesData>;
  workspacesSave(data: import('../shared/workspace-types.js').WorkspacesData): Promise<void>;
```

**Step 4: Commit**

```bash
git add src-backend/bridge.ts src/renderer/tauri-api.ts src/renderer/api.d.ts
git commit -m "feat(workspace): add backend persistence RPC handlers"
```

---

### Task 3: Workspace Section CSS

**Files:**
- Create: `src/renderer/styles/workspace.css`
- Modify: `src/renderer/index.html` (add stylesheet link at line 25, after cfv.css)

**Step 1: Create workspace.css**

```css
/* Workspace Section */
.workspace-section {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* Workspace tab bar (top row - workspace names) */
.workspace-tab-bar {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  min-height: 36px;
  overflow-x: auto;
}

.workspace-tab-btn {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 4px 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--transition-fast);
}

.workspace-tab-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.workspace-tab-btn.active {
  background: var(--bg-active);
  color: var(--text-primary);
  border-color: var(--border-color);
}

.workspace-tab-close {
  display: none;
  margin-left: 4px;
  font-size: 14px;
  line-height: 1;
  opacity: 0.6;
  cursor: pointer;
}

.workspace-tab-btn:hover .workspace-tab-close {
  display: inline;
}

.workspace-tab-close:hover {
  opacity: 1;
}

.workspace-tab-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.workspace-tab-add:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* Subtab bar (second row - mixed-type subtabs) */
.workspace-subtab-bar {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px var(--space-2);
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-primary);
  min-height: 32px;
  overflow-x: auto;
}

.workspace-subtab-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--transition-fast);
}

.workspace-subtab-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.workspace-subtab-btn.active {
  background: var(--bg-active);
  color: var(--text-primary);
}

.workspace-subtab-icon {
  display: flex;
  align-items: center;
}

.workspace-subtab-icon svg {
  width: 14px;
  height: 14px;
}

.workspace-subtab-close {
  display: none;
  margin-left: 4px;
  font-size: 13px;
  line-height: 1;
  opacity: 0.6;
  cursor: pointer;
}

.workspace-subtab-btn:hover .workspace-subtab-close {
  display: inline;
}

.workspace-subtab-close:hover {
  opacity: 1;
}

/* Content panels container */
.workspace-panels-container {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.workspace-panel {
  position: absolute;
  inset: 0;
  overflow: auto;
  display: none;
}

.workspace-panel.active {
  display: flex;
  flex-direction: column;
}

/* Empty state */
.workspace-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-tertiary);
  gap: var(--space-2);
}

.workspace-empty svg {
  width: 48px;
  height: 48px;
  opacity: 0.3;
}

/* Context menu */
.workspace-context-menu {
  position: fixed;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 4px 0;
  min-width: 200px;
  z-index: 10000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.workspace-context-menu-item {
  padding: 6px 12px;
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.workspace-context-menu-item:hover {
  background: var(--bg-hover);
}

.workspace-context-menu-separator {
  height: 1px;
  background: var(--border-color);
  margin: 4px 0;
}

.workspace-context-menu-header {
  padding: 4px 12px;
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}

/* Rename input */
.workspace-rename-input {
  background: var(--bg-primary);
  border: 1px solid var(--accent-blue);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 12px;
  padding: 3px 8px;
  outline: none;
  width: 120px;
}
```

**Step 2: Add stylesheet link to index.html**

Add after line 25 (after cfv.css):
```html
  <link rel="stylesheet" href="./styles/workspace.css">
```

**Step 3: Commit**

```bash
git add src/renderer/styles/workspace.css src/renderer/index.html
git commit -m "feat(workspace): add CSS styles and link stylesheet"
```

---

### Task 4: Workspace Section Component

**Files:**
- Create: `src/renderer/components/workspace-section.ts`

This is the main component. It manages the workspace tab bar, subtab bar, content panels, and all CRUD operations.

**Step 1: Create the workspace section component**

```typescript
// src/renderer/components/workspace-section.ts

import { getIcon, FolderOpen, Activity, Search, AlertTriangle, Plus, Edit, Trash2 } from '../utils/icons.js';
import type { Workspace, WorkspaceSubtab, WorkspacesData, WorkspaceSubtabType, WorkspaceSubtabState, CfvSubtabState, DgrepSubtabState, IcmSubtabState } from '../../shared/workspace-types.js';
import { CfvCallView } from './cfv/cfv-call-view.js';
import { DGrepSearchView } from './dgrep-search-view.js';
import { IcmIncidentDetailView } from './icm-incident-detail-view.js';

function generateId(): string {
  return crypto.randomUUID();
}

const SUBTAB_ICONS: Record<WorkspaceSubtabType, string> = {
  cfv: getIcon(Activity, 14),
  dgrep: getIcon(Search, 14),
  icm: getIcon(AlertTriangle, 14),
};

export class WorkspaceSection {
  private container: HTMLElement;
  private workspaces: Workspace[] = [];
  private activeWorkspaceId: string | null = null;
  private viewInstances: Map<string, CfvCallView | DGrepSearchView | IcmIncidentDetailView> = new Map();
  private contextMenuEl: HTMLElement | null = null;

  // Navigation interceptor - set by app.ts to redirect cross-references
  public onNavigateCfv: ((callId: string) => void) | null = null;
  public onNavigateDgrep: ((query: string, timeRange: { start: string; end: string }) => void) | null = null;
  public onNavigateIcm: ((incidentId: number) => void) | null = null;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.render();
    this.loadWorkspaces();

    // Close context menus on click outside
    document.addEventListener('click', () => this.closeContextMenu());
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="workspace-section">
        <div class="workspace-tab-bar" id="workspaceTabBar"></div>
        <div class="workspace-subtab-bar" id="workspaceSubtabBar" style="display:none"></div>
        <div class="workspace-panels-container" id="workspacePanelsContainer">
          <div class="workspace-empty" id="workspaceEmpty">
            ${getIcon(FolderOpen, 48)}
            <div>No workspaces yet</div>
            <div style="font-size: 12px">Create a workspace to group related investigations</div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Persistence ──

  private async loadWorkspaces(): Promise<void> {
    try {
      const data: WorkspacesData = await window.electronAPI.workspacesLoad();
      this.workspaces = data.workspaces || [];
      this.activeWorkspaceId = data.activeWorkspaceId || null;
    } catch {
      this.workspaces = [];
      this.activeWorkspaceId = null;
    }
    this.renderWorkspaceTabs();
    if (this.activeWorkspaceId) {
      this.switchWorkspace(this.activeWorkspaceId);
    }
  }

  private async saveWorkspaces(): Promise<void> {
    const data: WorkspacesData = {
      workspaces: this.workspaces,
      activeWorkspaceId: this.activeWorkspaceId,
    };
    try {
      await window.electronAPI.workspacesSave(data);
    } catch (e) {
      console.error('[workspace] Failed to save:', e);
    }
  }

  // ── Workspace CRUD ──

  public createWorkspace(name?: string): Workspace {
    const ws: Workspace = {
      id: generateId(),
      name: name || `Workspace ${this.workspaces.length + 1}`,
      subtabs: [],
      activeSubtabId: null,
      createdAt: Date.now(),
    };
    this.workspaces.push(ws);
    this.activeWorkspaceId = ws.id;
    this.renderWorkspaceTabs();
    this.switchWorkspace(ws.id);
    this.saveWorkspaces();
    return ws;
  }

  public deleteWorkspace(workspaceId: string): void {
    const ws = this.workspaces.find(w => w.id === workspaceId);
    if (!ws) return;

    // Clean up view instances for all subtabs
    for (const subtab of ws.subtabs) {
      this.destroySubtabView(subtab.id);
    }

    this.workspaces = this.workspaces.filter(w => w.id !== workspaceId);

    if (this.activeWorkspaceId === workspaceId) {
      this.activeWorkspaceId = this.workspaces.length > 0 ? this.workspaces[0].id : null;
    }

    this.renderWorkspaceTabs();
    if (this.activeWorkspaceId) {
      this.switchWorkspace(this.activeWorkspaceId);
    } else {
      this.renderSubtabBar();
      this.showEmpty();
    }
    this.saveWorkspaces();
  }

  public renameWorkspace(workspaceId: string, name: string): void {
    const ws = this.workspaces.find(w => w.id === workspaceId);
    if (!ws) return;
    ws.name = name;
    this.renderWorkspaceTabs();
    this.saveWorkspaces();
  }

  private getActiveWorkspace(): Workspace | undefined {
    return this.workspaces.find(w => w.id === this.activeWorkspaceId);
  }

  // ── Subtab CRUD ──

  public addSubtab(workspaceId: string, type: WorkspaceSubtabType, label: string, state: WorkspaceSubtabState): WorkspaceSubtab {
    const ws = this.workspaces.find(w => w.id === workspaceId);
    if (!ws) throw new Error(`Workspace ${workspaceId} not found`);

    const subtab: WorkspaceSubtab = {
      id: generateId(),
      type,
      label,
      state,
    };
    ws.subtabs.push(subtab);
    ws.activeSubtabId = subtab.id;

    if (this.activeWorkspaceId === workspaceId) {
      this.renderSubtabBar();
      this.activateSubtab(subtab.id);
    }
    this.saveWorkspaces();
    return subtab;
  }

  public removeSubtab(subtabId: string): void {
    const ws = this.getActiveWorkspace();
    if (!ws) return;

    const idx = ws.subtabs.findIndex(s => s.id === subtabId);
    if (idx === -1) return;

    this.destroySubtabView(subtabId);
    ws.subtabs.splice(idx, 1);

    // Remove DOM panel
    document.getElementById(`workspacePanel-${subtabId}`)?.remove();

    if (ws.activeSubtabId === subtabId) {
      // Switch to adjacent tab
      const newIdx = Math.min(idx, ws.subtabs.length - 1);
      ws.activeSubtabId = ws.subtabs[newIdx]?.id || null;
      if (ws.activeSubtabId) {
        this.activateSubtab(ws.activeSubtabId);
      } else {
        this.showEmpty();
      }
    }
    this.renderSubtabBar();
    this.saveWorkspaces();
  }

  // ── Public API for moving tabs from other sections ──

  public getWorkspaceList(): Array<{ id: string; name: string }> {
    return this.workspaces.map(w => ({ id: w.id, name: w.name }));
  }

  public addSubtabToWorkspace(workspaceId: string, type: WorkspaceSubtabType, label: string, state: WorkspaceSubtabState): void {
    this.addSubtab(workspaceId, type, label, state);
  }

  public createWorkspaceWithSubtab(name: string, type: WorkspaceSubtabType, label: string, state: WorkspaceSubtabState): void {
    const ws = this.createWorkspace(name);
    this.addSubtab(ws.id, type, label, state);
  }

  // ── Workspace Tab Bar Rendering ──

  private renderWorkspaceTabs(): void {
    const bar = document.getElementById('workspaceTabBar');
    if (!bar) return;

    const tabsHtml = this.workspaces.map(ws => `
      <button class="workspace-tab-btn ${ws.id === this.activeWorkspaceId ? 'active' : ''}" data-ws-id="${ws.id}">
        <span>${this.escapeHtml(ws.name)}</span>
        <span class="workspace-tab-close" data-ws-id="${ws.id}">&times;</span>
      </button>
    `).join('');

    bar.innerHTML = `
      ${tabsHtml}
      <button class="workspace-tab-add" title="New workspace">${getIcon(Plus, 16)}</button>
    `;

    // Attach listeners
    bar.querySelectorAll('.workspace-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('workspace-tab-close')) {
          e.stopPropagation();
          const wsId = target.dataset.wsId!;
          this.deleteWorkspace(wsId);
          return;
        }
        const wsId = (btn as HTMLElement).dataset.wsId!;
        this.switchWorkspace(wsId);
      });
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const wsId = (btn as HTMLElement).dataset.wsId!;
        this.showWorkspaceContextMenu(e as MouseEvent, wsId);
      });
    });

    bar.querySelector('.workspace-tab-add')?.addEventListener('click', () => {
      this.createWorkspace();
    });
  }

  private switchWorkspace(workspaceId: string): void {
    this.activeWorkspaceId = workspaceId;
    const ws = this.getActiveWorkspace();
    if (!ws) return;

    // Update tab bar active state
    document.querySelectorAll('.workspace-tab-btn').forEach(btn => {
      (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.wsId === workspaceId);
    });

    this.renderSubtabBar();
    this.hideAllPanels();

    if (ws.activeSubtabId) {
      this.activateSubtab(ws.activeSubtabId);
    } else if (ws.subtabs.length > 0) {
      ws.activeSubtabId = ws.subtabs[0].id;
      this.activateSubtab(ws.activeSubtabId);
    } else {
      this.showEmpty();
    }
    this.saveWorkspaces();
  }

  // ── Subtab Bar Rendering ──

  private renderSubtabBar(): void {
    const bar = document.getElementById('workspaceSubtabBar');
    if (!bar) return;

    const ws = this.getActiveWorkspace();
    if (!ws || ws.subtabs.length === 0) {
      bar.style.display = 'none';
      return;
    }

    bar.style.display = 'flex';
    bar.innerHTML = ws.subtabs.map(st => `
      <button class="workspace-subtab-btn ${st.id === ws.activeSubtabId ? 'active' : ''}" data-st-id="${st.id}">
        <span class="workspace-subtab-icon">${SUBTAB_ICONS[st.type]}</span>
        <span>${this.escapeHtml(st.label)}</span>
        <span class="workspace-subtab-close" data-st-id="${st.id}">&times;</span>
      </button>
    `).join('');

    bar.querySelectorAll('.workspace-subtab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('workspace-subtab-close')) {
          e.stopPropagation();
          this.removeSubtab(target.dataset.stId!);
          return;
        }
        const stId = (btn as HTMLElement).dataset.stId!;
        this.activateSubtab(stId);
      });
    });
  }

  // ── Subtab Activation & View Lifecycle ──

  private activateSubtab(subtabId: string): void {
    const ws = this.getActiveWorkspace();
    if (!ws) return;

    ws.activeSubtabId = subtabId;
    this.hideAllPanels();
    this.hideEmpty();

    // Update subtab bar active state
    document.querySelectorAll('.workspace-subtab-btn').forEach(btn => {
      (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.stId === subtabId);
    });

    // Find or create panel
    let panel = document.getElementById(`workspacePanel-${subtabId}`);
    if (!panel) {
      panel = this.createSubtabPanel(subtabId);
    }
    panel.classList.add('active');
    panel.style.display = '';

    this.saveWorkspaces();
  }

  private createSubtabPanel(subtabId: string): HTMLElement {
    const ws = this.getActiveWorkspace();
    const subtab = ws?.subtabs.find(s => s.id === subtabId);
    if (!subtab) throw new Error(`Subtab ${subtabId} not found`);

    const container = document.getElementById('workspacePanelsContainer')!;
    const panel = document.createElement('div');
    panel.id = `workspacePanel-${subtabId}`;
    panel.className = 'workspace-panel';
    container.appendChild(panel);

    // Instantiate the view based on type
    this.createViewForSubtab(subtab, panel);

    return panel;
  }

  private createViewForSubtab(subtab: WorkspaceSubtab, panel: HTMLElement): void {
    switch (subtab.type) {
      case 'cfv': {
        const state = subtab.state as CfvSubtabState;
        const view = new CfvCallView(panel, state.callId);
        this.viewInstances.set(subtab.id, view);
        break;
      }
      case 'dgrep': {
        const view = new DGrepSearchView(panel.id);
        this.viewInstances.set(subtab.id, view);
        break;
      }
      case 'icm': {
        const state = subtab.state as IcmSubtabState;
        const view = new IcmIncidentDetailView(panel);
        view.setLoading(true);
        window.electronAPI.icmGetIncident(state.incidentId).then(incident => {
          view.setIncident(incident);
        }).catch(err => {
          console.error('[workspace] Failed to load incident:', err);
        });
        this.viewInstances.set(subtab.id, view);
        break;
      }
    }
  }

  private destroySubtabView(subtabId: string): void {
    const view = this.viewInstances.get(subtabId);
    if (view && 'dispose' in view && typeof (view as any).dispose === 'function') {
      (view as any).dispose();
    }
    this.viewInstances.delete(subtabId);
  }

  private hideAllPanels(): void {
    const container = document.getElementById('workspacePanelsContainer');
    if (!container) return;
    container.querySelectorAll('.workspace-panel').forEach(panel => {
      (panel as HTMLElement).classList.remove('active');
      (panel as HTMLElement).style.display = 'none';
    });
  }

  private showEmpty(): void {
    const el = document.getElementById('workspaceEmpty');
    if (el) el.style.display = '';
  }

  private hideEmpty(): void {
    const el = document.getElementById('workspaceEmpty');
    if (el) el.style.display = 'none';
  }

  // ── Context Menus ──

  private showWorkspaceContextMenu(e: MouseEvent, workspaceId: string): void {
    this.closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'workspace-context-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    menu.innerHTML = `
      <div class="workspace-context-menu-item" data-action="rename">${getIcon(Edit, 14)} Rename</div>
      <div class="workspace-context-menu-separator"></div>
      <div class="workspace-context-menu-item" data-action="delete" style="color: var(--error)">${getIcon(Trash2, 14)} Delete</div>
    `;
    menu.querySelectorAll('.workspace-context-menu-item').forEach(item => {
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const action = (item as HTMLElement).dataset.action;
        if (action === 'rename') this.startRename(workspaceId);
        if (action === 'delete') this.deleteWorkspace(workspaceId);
        this.closeContextMenu();
      });
    });
    document.body.appendChild(menu);
    this.contextMenuEl = menu;

    // Adjust if off-screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${e.clientX - rect.width}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${e.clientY - rect.height}px`;
  }

  private closeContextMenu(): void {
    if (this.contextMenuEl) {
      this.contextMenuEl.remove();
      this.contextMenuEl = null;
    }
  }

  private startRename(workspaceId: string): void {
    const ws = this.workspaces.find(w => w.id === workspaceId);
    if (!ws) return;

    const btn = document.querySelector(`.workspace-tab-btn[data-ws-id="${workspaceId}"] span:first-child`) as HTMLElement;
    if (!btn) return;

    const input = document.createElement('input');
    input.className = 'workspace-rename-input';
    input.value = ws.name;
    btn.replaceWith(input);
    input.focus();
    input.select();

    const finish = () => {
      const newName = input.value.trim() || ws.name;
      this.renameWorkspace(workspaceId, newName);
    };
    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { finish(); }
      if (e.key === 'Escape') { this.renderWorkspaceTabs(); }
    });
  }

  // ── Helpers ──

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
```

**Step 2: Commit**

```bash
git add src/renderer/components/workspace-section.ts
git commit -m "feat(workspace): add workspace section component"
```

---

### Task 5: Register Workspace Section in Sidebar and App

**Files:**
- Modify: `src/renderer/components/section-sidebar.ts` (lines 1, 3, 31-36)
- Modify: `src/renderer/index.html` (line 98, add workspace section content div)
- Modify: `src/renderer/app.ts` (add import, property, init, switchSection update)

**Step 1: Add workspace section to sidebar**

In `src/renderer/components/section-sidebar.ts`:

1. Add `FolderOpen` to the icon import on line 1:
```typescript
import { getIcon, GitPullRequest, LayoutGrid, Search, Terminal, Settings, Info, Activity, AlertTriangle, FolderOpen } from '../utils/icons.js';
```

2. Add `'workspaces'` to the SectionId type on line 3:
```typescript
export type SectionId = 'review' | 'workItems' | 'icm' | 'terminals' | 'settings' | 'about' | 'workspaces' | string;
```

3. Add workspace section entry to the SECTIONS array, after the ICM entry (after line 36):
```typescript
  {
    id: 'workspaces',
    icon: getIcon(FolderOpen, 20),
    label: 'Workspaces',
  },
```

**Step 2: Add workspace section content div to index.html**

After the CFV section content div (after line 98), add:
```html
          <!-- Workspace Section Content -->
          <div class="section-content hidden" id="workspacesSectionContent">
            <div class="tab-panel active" id="workspacesPanel"></div>
          </div>
```

**Step 3: Wire up workspace section in app.ts**

1. Add import at the top of `src/renderer/app.ts`:
```typescript
import { WorkspaceSection } from './components/workspace-section.js';
```

2. Add private property (near other section properties around line 170):
```typescript
private workspaceSection!: WorkspaceSection;
```

3. In the init method (where other sections are initialized), add:
```typescript
this.workspaceSection = new WorkspaceSection('workspacesPanel');
```

4. In `switchSection()` (around line 1339), add the workspace section visibility toggle alongside the others:
```typescript
document.getElementById('workspacesSectionContent')?.classList.toggle('hidden', section !== 'workspaces');
```

**Step 4: Commit**

```bash
git add src/renderer/components/section-sidebar.ts src/renderer/index.html src/renderer/app.ts
git commit -m "feat(workspace): register workspace section in sidebar and app"
```

---

### Task 6: Context Menu for "Move to Workspace" on CFV Tabs

**Files:**
- Modify: `src/renderer/app.ts` (cfv tab bar area, around `updateCfvTabBar` method at line 5209)

**Step 1: Add right-click handler to CFV tab buttons**

In `updateCfvTabBar()` (around line 5209), after the existing click handlers are attached to tab buttons, add a `contextmenu` listener:

```typescript
// Inside updateCfvTabBar(), after the click listener forEach block
tabBar.querySelectorAll('.cfv-tab-btn').forEach(btn => {
  const tabId = (btn as HTMLElement).dataset.tabId!;
  if (tabId === 'home') return; // Don't allow moving home tab
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    this.showMoveToWorkspaceMenu(e as MouseEvent, 'cfv', tabId);
  });
});
```

**Step 2: Add the shared "Move to Workspace" context menu method to app.ts**

Add a new method to the App class:

```typescript
private moveToWorkspaceMenuEl: HTMLElement | null = null;

private showMoveToWorkspaceMenu(e: MouseEvent, sectionType: 'cfv' | 'dgrep' | 'icm', tabId: string): void {
  // Close any existing menu
  this.closeMoveToWorkspaceMenu();

  const workspaces = this.workspaceSection.getWorkspaceList();
  const menu = document.createElement('div');
  menu.className = 'workspace-context-menu';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  const itemsHtml = [
    `<div class="workspace-context-menu-header">Move to Workspace</div>`,
    `<div class="workspace-context-menu-item" data-action="new">New Workspace...</div>`,
    ...workspaces.map(ws =>
      `<div class="workspace-context-menu-item" data-action="existing" data-ws-id="${ws.id}">${this.escapeHtml(ws.name)}</div>`
    ),
  ].join('');

  menu.innerHTML = workspaces.length > 0
    ? `${itemsHtml.split('</div>')[0]}</div>${itemsHtml.split('</div>').slice(1, 2).join('</div>')}</div><div class="workspace-context-menu-separator"></div>${itemsHtml.split('</div>').slice(2).join('</div>')}`
    : itemsHtml;

  // Simpler approach - just render all items
  menu.innerHTML = `
    <div class="workspace-context-menu-header">Move to Workspace</div>
    <div class="workspace-context-menu-item" data-action="new">New Workspace...</div>
    ${workspaces.length > 0 ? '<div class="workspace-context-menu-separator"></div>' : ''}
    ${workspaces.map(ws =>
      `<div class="workspace-context-menu-item" data-action="existing" data-ws-id="${ws.id}">${this.escapeHtml(ws.name)}</div>`
    ).join('')}
  `;

  menu.querySelectorAll('.workspace-context-menu-item').forEach(item => {
    item.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const action = (item as HTMLElement).dataset.action;
      if (action === 'new') {
        this.moveTabToNewWorkspace(sectionType, tabId);
      } else if (action === 'existing') {
        const wsId = (item as HTMLElement).dataset.wsId!;
        this.moveTabToWorkspace(sectionType, tabId, wsId);
      }
      this.closeMoveToWorkspaceMenu();
    });
  });

  document.body.appendChild(menu);
  this.moveToWorkspaceMenuEl = menu;

  // Adjust if off-screen
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${e.clientX - rect.width}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${e.clientY - rect.height}px`;

  // Close on click outside
  const closeHandler = () => {
    this.closeMoveToWorkspaceMenu();
    document.removeEventListener('click', closeHandler);
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

private closeMoveToWorkspaceMenu(): void {
  if (this.moveToWorkspaceMenuEl) {
    this.moveToWorkspaceMenuEl.remove();
    this.moveToWorkspaceMenuEl = null;
  }
}

private escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

private moveTabToNewWorkspace(sectionType: 'cfv' | 'dgrep' | 'icm', tabId: string): void {
  const { label, state } = this.extractTabState(sectionType, tabId);
  this.workspaceSection.createWorkspaceWithSubtab(`Workspace ${Date.now()}`, sectionType, label, state);
  this.closeTabInOriginalSection(sectionType, tabId);
}

private moveTabToWorkspace(sectionType: 'cfv' | 'dgrep' | 'icm', tabId: string, workspaceId: string): void {
  const { label, state } = this.extractTabState(sectionType, tabId);
  this.workspaceSection.addSubtabToWorkspace(workspaceId, sectionType, label, state);
  this.closeTabInOriginalSection(sectionType, tabId);
}

private extractTabState(sectionType: 'cfv' | 'dgrep' | 'icm', tabId: string): { label: string; state: any } {
  switch (sectionType) {
    case 'cfv': {
      const tab = this.cfvTabs.find(t => t.id === tabId);
      return {
        label: tab?.label || tabId,
        state: { callId: tab?.callId || tabId.replace('cfv-', '') },
      };
    }
    case 'icm': {
      const tab = this.icmTabs.find(t => t.id === tabId);
      return {
        label: tab?.label || tabId,
        state: { incidentId: tab?.incidentId || parseInt(tabId.replace('icm-', ''), 10) },
      };
    }
    case 'dgrep': {
      // DGrep is a single-view section, extract current search state
      return {
        label: 'Log Search',
        state: { searchQuery: '', timeRange: { start: '', end: '' } },
      };
    }
    default:
      return { label: tabId, state: {} };
  }
}

private closeTabInOriginalSection(sectionType: 'cfv' | 'dgrep' | 'icm', tabId: string): void {
  switch (sectionType) {
    case 'cfv':
      this.closeCfvTab(tabId);
      break;
    case 'icm':
      this.closeIcmTab(tabId);
      break;
    case 'dgrep':
      // DGrep is a singleton view - don't close it, just clear
      break;
  }
}
```

**Step 3: Commit**

```bash
git add src/renderer/app.ts
git commit -m "feat(workspace): add 'Move to Workspace' context menu on CFV tabs"
```

---

### Task 7: Context Menu for "Move to Workspace" on ICM Tabs

**Files:**
- Modify: `src/renderer/app.ts` (ICM tab bar area, around `updateIcmTabBar` method at line 5836)

**Step 1: Add right-click handler to ICM tab buttons**

In `updateIcmTabBar()` or the ICM tab rendering section, after click handlers are attached, add a `contextmenu` listener on each non-list tab:

```typescript
// After ICM tab button click handlers
tabBar.querySelectorAll('.icm-tab-btn').forEach(btn => {
  const tabId = (btn as HTMLElement).dataset.tabId!;
  if (tabId === 'list') return;
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    this.showMoveToWorkspaceMenu(e as MouseEvent, 'icm', tabId);
  });
});
```

**Step 2: Commit**

```bash
git add src/renderer/app.ts
git commit -m "feat(workspace): add 'Move to Workspace' context menu on ICM tabs"
```

---

### Task 8: Cross-Reference Navigation Interceptor

**Files:**
- Modify: `src/renderer/components/workspace-section.ts`
- Modify: `src/renderer/app.ts`

**Step 1: Wire navigation callbacks in workspace section**

When a workspace-hosted ICM view loads an incident that has a linked CFV, clicking that link should open a new CFV subtab in the same workspace. In `createViewForSubtab()` for ICM views, set up callbacks:

In `workspace-section.ts`, update the ICM case in `createViewForSubtab`:

```typescript
case 'icm': {
  const state = subtab.state as IcmSubtabState;
  const view = new IcmIncidentDetailView(panel);
  // Wire cross-reference navigation
  if (this.onNavigateCfv) {
    view.onOpenInBrowser?.((url: string) => window.electronAPI.openExternal(url));
  }
  view.setLoading(true);
  window.electronAPI.icmGetIncident(state.incidentId).then(incident => {
    view.setIncident(incident);
  }).catch(err => {
    console.error('[workspace] Failed to load incident:', err);
  });
  this.viewInstances.set(subtab.id, view);
  break;
}
```

**Step 2: In app.ts, set navigation interceptors**

After creating the workspace section, wire it up:

```typescript
this.workspaceSection.onNavigateCfv = (callId: string) => {
  const ws = this.workspaceSection.getWorkspaceList();
  // For now, this is called from within workspace context
  // Add a CFV subtab to the currently active workspace
};
```

**Note:** The full cross-reference interception requires knowing which ICM detail views have CFV links. This depends on the specific link patterns in the ICM detail view. The initial implementation can be kept simple - just ensure workspace subtab views work. Cross-reference interception can be refined in a follow-up since it requires deeper integration with each view's link handling.

**Step 3: Commit**

```bash
git add src/renderer/components/workspace-section.ts src/renderer/app.ts
git commit -m "feat(workspace): wire cross-reference navigation interceptor scaffolding"
```

---

### Task 9: Integration Testing & Polish

**Files:**
- All workspace files

**Step 1: Manual integration test checklist**

Run the app and verify:

1. Workspaces section appears in sidebar with FolderOpen icon
2. Clicking Workspaces section shows empty state
3. Click [+] to create a workspace - workspace tab appears
4. Right-click workspace tab → Rename works
5. Right-click workspace tab → Delete works
6. Open a CFV call in CFV section → right-click tab → "Move to Workspace" → "New Workspace" → CFV call appears in workspace
7. Open an ICM incident → right-click tab → "Move to Workspace" → select existing workspace → incident subtab appears
8. Switch between subtabs in a workspace - views stay mounted
9. Close subtab with X button
10. Close app and reopen - workspaces and subtabs are restored
11. Clicking a restored subtab lazy-loads the view

**Step 2: Fix any issues found during testing**

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat(workspace): polish and integration fixes"
```

---

## Task Dependency Graph

```
Task 1 (types) ──┬── Task 2 (backend)
                  └── Task 3 (CSS)
                         │
Task 2 + Task 3 ─── Task 4 (component)
                         │
Task 4 ──────────── Task 5 (register in app)
                         │
Task 5 ──────────── Task 6 (CFV context menu)
                         │
Task 6 ──────────── Task 7 (ICM context menu)
                         │
Task 7 ──────────── Task 8 (cross-ref navigation)
                         │
Task 8 ──────────── Task 9 (testing & polish)
```

Tasks 1-3 can be parallelized. Tasks 4-9 are sequential.
