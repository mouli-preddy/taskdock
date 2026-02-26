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

  // View wiring callbacks - set by app.ts to wire up callbacks on newly created views
  public onWireDgrepView: ((view: DGrepSearchView) => void) | null = null;
  public onWireIcmView: ((view: IcmIncidentDetailView) => void) | null = null;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.render();
    this.loadWorkspaces();
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

  public getActiveWorkspaceId(): string | null {
    return this.activeWorkspaceId;
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
        if (this.onWireDgrepView) {
          this.onWireDgrepView(view);
        }
        this.viewInstances.set(subtab.id, view);
        break;
      }
      case 'icm': {
        const state = subtab.state as IcmSubtabState;
        const view = new IcmIncidentDetailView(panel);
        if (this.onWireIcmView) {
          this.onWireIcmView(view);
        }
        view.setLoading(true);
        window.electronAPI.icmGetIncident(state.incidentId).then(incident => {
          view.setIncident(incident);
        }).catch(err => {
          console.error('[workspace] Failed to load incident:', err);
          view.setLoading(false);
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

    // Close on click outside
    const closeHandler = () => {
      this.closeContextMenu();
      document.removeEventListener('click', closeHandler);
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);

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

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
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
