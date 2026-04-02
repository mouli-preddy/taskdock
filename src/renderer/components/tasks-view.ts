import { escapeHtml, formatTimeAgo } from '../utils/html-utils.js';
import { getIcon, Plus, Trash2, Clock, Zap, Loader, Bot, CalendarClock, CalendarX, ChevronDown, ChevronRight, Play, FileText, ArrowUp, ArrowDown, Terminal } from '../utils/icons.js';
import { renderMarkdown } from '../utils/markdown.js';

export interface TaskApprovalRequest {
  taskId: string;
  approvalId: string;
  question: string;
  context: string;
  options: string[];
  summary?: string;
  isPhaseGate?: boolean;
  phase1ResultsPreview?: string;
  phase1ResultsFile?: string;
}

export interface TaskRun {
  timestamp: string;
  result?: string;
  logFile?: string;
}

export interface ScheduledTask {
  id: string;
  title: string;
  schedule: string;
  action: string;
  raw: string;
  createdAt: string;
  enabled?: boolean;
  endTime?: string;
  aiAutomated?: boolean;
  cronExpression?: string;
  nextRun?: string;
  lastRun?: string;
  lastResult?: string;
  runCount?: number;
  runHistory?: TaskRun[];
  twoPhase?: boolean;
  phase2Prompt?: string;
  workingDir?: string;
}

type TaskTab = 'all' | 'inactive' | 'needs-approval';

export class TasksView {
  private container: HTMLElement;
  private tasks: ScheduledTask[] = [];
  private activeTab: TaskTab = 'all';
  private parsing = false;
  private togglingAi = new Set<string>();
  private approvalRequests: TaskApprovalRequest[] = [];
  private selectedTaskId: string | null = null;

  private onAddCallback: ((raw: string) => Promise<ScheduledTask>) | null = null;
  private onDeleteCallback: ((id: string) => void) | null = null;
  private onToggleAiCallback: ((id: string, enabled: boolean) => Promise<{ cronExpression: string; nextRun: string }>) | null = null;
  private onUpdateCallback: ((task: ScheduledTask) => void) | null = null;
  private onTestCallback: ((id: string) => void) | null = null;
  private testingIds = new Set<string>();
  private selectionMode = false;
  private selectedIds = new Set<string>();
  private taskPhaseStates = new Map<string, 'phase1-running' | 'awaiting-gate' | 'phase2-running'>();
  private detailPanelWidth = parseInt(localStorage.getItem('tasks-detail-width') || '480', 10);
  private onExportCallback: ((ids: string[]) => Promise<{ filePath: string; count: number }>) | null = null;
  private onImportCallback: ((json: string) => Promise<{ imported: number; skipped: number; tasks: any[] }>) | null = null;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.render();
  }

  onAdd(callback: (raw: string) => Promise<ScheduledTask>) { this.onAddCallback = callback; }
  onDelete(callback: (id: string) => void) { this.onDeleteCallback = callback; }
  onToggleAi(callback: (id: string, enabled: boolean) => Promise<{ cronExpression: string; nextRun: string }>) { this.onToggleAiCallback = callback; }
  onUpdate(callback: (task: ScheduledTask) => void) { this.onUpdateCallback = callback; }
  onTest(callback: (id: string) => void) { this.onTestCallback = callback; }
  onExport(callback: (ids: string[]) => Promise<{ filePath: string; count: number }>) { this.onExportCallback = callback; }
  onImport(callback: (json: string) => Promise<{ imported: number; skipped: number; tasks: any[] }>) { this.onImportCallback = callback; }

  setTasks(tasks: ScheduledTask[]) {
    this.tasks = tasks;
    this.renderList();
  }

  markTaskRan(id: string, lastRun: string, nextRun: string) {
    const task = this.tasks.find(t => t.id === id);
    if (task) { task.lastRun = lastRun; task.nextRun = nextRun; this.renderList(); }
  }

  showLatestLog(taskId: string): void {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return;
    const latestWithLog = [...(task.runHistory || [])].reverse().find(r => r.logFile);
    if (latestWithLog?.logFile) {
      window.electronAPI.tasksReadLog(latestWithLog.logFile)
        .then(content => this.showLogModal(content))
        .catch(() => {});
    }
  }

  highlightTask(id: string) {
    const el = this.container.querySelector(`.task-card[data-id="${id}"]`) as HTMLElement;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('task-highlight');
    setTimeout(() => el.classList.remove('task-highlight'), 2500);
  }

  closeDetailPanel() {
    if (this.selectedTaskId) {
      this.selectedTaskId = null;
      this.renderDetailPanel();
    }
  }

  addApprovalRequest(request: TaskApprovalRequest) {
    if (!this.approvalRequests.find(r => r.approvalId === request.approvalId)) {
      this.approvalRequests.push(request);
      this.renderApprovalRequests();
    }
  }

  removeApprovalRequest(approvalId: string) {
    this.approvalRequests = this.approvalRequests.filter(r => r.approvalId !== approvalId);
    this.renderApprovalRequests();
  }

  setTaskPhaseState(id: string, state: 'phase1-running' | 'awaiting-gate' | 'phase2-running' | null) {
    if (state === null) this.taskPhaseStates.delete(id);
    else this.taskPhaseStates.set(id, state);
    this.renderList();
  }

  switchToApprovalsTab() {
    this.activeTab = 'needs-approval';
    this.container.querySelectorAll('.tasks-tab-btn').forEach(b => {
      b.classList.toggle('active', (b as HTMLElement).dataset.tab === 'needs-approval');
    });
    this.renderList();
    this.renderApprovalRequests();
  }

  getApprovalCount(): number {
    return this.approvalRequests.length;
  }

  updateTaskResult(id: string, result: string, runCount: number, runHistory: TaskRun[]) {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      task.lastResult = result;
      task.runCount = runCount;
      task.runHistory = runHistory;
      this.renderList();
    }
  }

  private render() {
    this.container.innerHTML = `
      <div class="tasks-view">
        <header class="tasks-header">
          <div class="tasks-title">
            <h1>Tasks</h1>
          </div>
          <div class="tasks-header-actions">
            <button class="btn btn-secondary tasks-select-btn${this.selectionMode ? ' active' : ''}" id="tasksSelectBtn">
              ${this.selectionMode ? 'Cancel' : 'Select'}
            </button>
            <input type="file" id="tasksImportFile" accept=".json" style="display:none" />
            <button class="btn btn-secondary tasks-import-btn" id="tasksImportBtn">
              ${getIcon(ArrowDown, 14)} Import
            </button>
            ${this.selectionMode && this.selectedIds.size > 0 ? `
            <button class="btn btn-primary tasks-export-btn" id="tasksExportBtn">
              ${getIcon(ArrowUp, 14)} Export (${this.selectedIds.size})
            </button>` : ''}
          </div>
        </header>
        <div class="tasks-selection-bar" id="tasksSelectionBar" style="${this.selectionMode ? '' : 'display:none'}">
          <label class="tasks-select-all">
            <input type="checkbox" id="tasksSelectAll"
              ${this.selectedIds.size > 0 && this.selectedIds.size === this.getFilteredTasks().length ? 'checked' : ''} />
            Select all
          </label>
          <span class="tasks-selection-count">${this.selectedIds.size} selected</span>
        </div>
        <div class="tasks-input-section">
          <div class="tasks-input-bar">
            <input type="text" id="tasksInput" class="tasks-input"
              placeholder="Describe a task… e.g. 'Check my open PRs every morning at 9am'"
              autocomplete="off" />
            <button class="btn btn-primary tasks-add-btn" id="tasksAddBtn">
              ${getIcon(Plus, 16)} Add
            </button>
          </div>
          <p class="tasks-input-hint">The AI will extract the schedule and action from your description.</p>
        </div>
        <div class="tasks-tabs">
          <button class="tasks-tab-btn ${this.activeTab === 'all' ? 'active' : ''}" data-tab="all">All <span class="tasks-tab-count" data-tab-count="all">0</span></button>
          <button class="tasks-tab-btn ${this.activeTab === 'inactive' ? 'active' : ''}" data-tab="inactive">Inactive <span class="tasks-tab-count" data-tab-count="inactive">0</span></button>
          <button class="tasks-tab-btn ${this.activeTab === 'needs-approval' ? 'active' : ''}" data-tab="needs-approval">Need Approvals <span class="tasks-tab-count" data-tab-count="needs-approval">0</span></button>
        </div>
        <div class="tasks-approvals" id="tasksApprovals"></div>
        <div class="tasks-pane" id="tasksPane">
          <div class="tasks-list-container">
            <div class="tasks-list" id="tasksList"></div>
          </div>
          <div class="task-detail-panel" id="taskDetailPanel"></div>
        </div>
      </div>
    `;
    this.attachEventListeners();
    this.renderList();
  }

  private attachEventListeners() {
    const input = this.container.querySelector('#tasksInput') as HTMLInputElement;
    const addBtn = this.container.querySelector('#tasksAddBtn') as HTMLButtonElement;

    const submit = async () => {
      const raw = input.value.trim();
      if (!raw) { this.showError('Please enter a task description'); return; }
      if (this.parsing) return;
      if (!this.onAddCallback) { this.showError('Not ready yet — please try again'); return; }

      this.setParsing(true);
      input.value = '';

      try {
        const task = await this.onAddCallback(raw);
        // Auto-enable AI automation for new tasks
        if (!task.aiAutomated && this.onToggleAiCallback) {
          try {
            const result = await this.onToggleAiCallback(task.id, true);
            task.aiAutomated = true;
            task.cronExpression = result.cronExpression;
            task.nextRun = result.nextRun;
          } catch { /* task created fine, AI toggle failed */ }
        }
        this.tasks.unshift(task);
        this.renderList();
      } catch (err: any) {
        console.error('[TasksView] onAdd error:', err);
        input.value = raw;
        this.showError(err?.message || 'Failed to add task');
      } finally {
        this.setParsing(false);
        input.focus();
      }
    };

    addBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

    this.container.querySelectorAll('.tasks-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = (btn as HTMLElement).dataset.tab as TaskTab;
        this.container.querySelectorAll('.tasks-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderList();
      });
    });

    const selectBtn = this.container.querySelector('#tasksSelectBtn') as HTMLButtonElement;
    selectBtn?.addEventListener('click', () => {
      this.selectionMode = !this.selectionMode;
      if (!this.selectionMode) {
        this.selectedIds.clear();
      } else {
        this.getFilteredTasks().forEach(t => this.selectedIds.add(t.id));
      }
      this.render();
    });

    const selectAllCb = this.container.querySelector('#tasksSelectAll') as HTMLInputElement;
    selectAllCb?.addEventListener('change', () => {
      const filtered = this.getFilteredTasks();
      if (selectAllCb.checked) filtered.forEach(t => this.selectedIds.add(t.id));
      else this.selectedIds.clear();
      this.renderList();
    });

    const importBtn = this.container.querySelector('#tasksImportBtn') as HTMLButtonElement;
    const importFile = this.container.querySelector('#tasksImportFile') as HTMLInputElement;
    importBtn?.addEventListener('click', () => importFile?.click());
    importFile?.addEventListener('change', async () => {
      const file = importFile.files?.[0];
      if (!file || !this.onImportCallback) return;
      importBtn.disabled = true;
      try {
        const text = await file.text();
        importFile.value = '';
        const result = await this.onImportCallback(text);
        this.tasks = result.tasks;
        this.renderList();
      } catch (err: any) {
        this.showError(err?.message || 'Import failed');
        importFile.value = '';
      } finally {
        importBtn.disabled = false;
      }
    });

    const exportBtn = this.container.querySelector('#tasksExportBtn') as HTMLButtonElement | null;
    exportBtn?.addEventListener('click', () => this.handleExport());
  }

  private setParsing(parsing: boolean) {
    this.parsing = parsing;
    const addBtn = this.container.querySelector('#tasksAddBtn') as HTMLButtonElement;
    const input = this.container.querySelector('#tasksInput') as HTMLInputElement;
    if (addBtn) {
      addBtn.disabled = parsing;
      addBtn.innerHTML = parsing ? `${getIcon(Loader, 16)} Parsing…` : `${getIcon(Plus, 16)} Add`;
    }
    if (input) input.disabled = parsing;
  }

  private showError(message: string) {
    const hint = this.container.querySelector('.tasks-input-hint') as HTMLElement;
    if (!hint) return;
    const original = hint.textContent;
    hint.textContent = `Error: ${message}`;
    hint.style.color = 'var(--error)';
    setTimeout(() => { hint.textContent = original; hint.style.color = ''; }, 5000);
  }

  private formatNextRun(nextRun: string): string {
    const d = new Date(nextRun);
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    if (diff < 0) return 'overdue';
    if (diff < 60_000) return 'in < 1 min';
    if (diff < 3_600_000) return `in ${Math.round(diff / 60_000)}m`;
    if (diff < 86_400_000) {
      const h = Math.floor(diff / 3_600_000);
      const m = Math.round((diff % 3_600_000) / 60_000);
      return `in ${h}h${m > 0 ? ` ${m}m` : ''}`;
    }
    return d.toLocaleDateString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }

  private getFilteredTasks(): ScheduledTask[] {
    switch (this.activeTab) {
      case 'inactive': return this.tasks.filter(t => t.enabled === false);
      case 'needs-approval': return this.tasks.filter(t => !t.aiAutomated);
      default: return this.tasks;
    }
  }

  private updateTabCounts() {
    const approvalCount = this.approvalRequests.length;
    const counts: Record<TaskTab, number> = {
      all: this.tasks.length,
      inactive: this.tasks.filter(t => t.enabled === false).length,
      'needs-approval': approvalCount,
    };
    for (const [tab, count] of Object.entries(counts)) {
      const el = this.container.querySelector(`[data-tab-count="${tab}"]`);
      if (el) el.textContent = String(count);
    }
    // Colour the needs-approval tab red when there are pending approvals
    const approvalTab = this.container.querySelector('.tasks-tab-btn[data-tab="needs-approval"]') as HTMLElement;
    if (approvalTab) {
      approvalTab.style.color = approvalCount > 0 ? 'var(--error, #c42b1c)' : '';
      const badge = approvalTab.querySelector('.tasks-tab-count') as HTMLElement;
      if (badge) {
        badge.style.background = approvalCount > 0 ? 'color-mix(in srgb, var(--error, #c42b1c) 15%, transparent)' : '';
        badge.style.color = approvalCount > 0 ? 'var(--error, #c42b1c)' : '';
      }
    }
    // Emit approval count for the sidebar badge
    this.container.dispatchEvent(new CustomEvent('approval-count-changed', { bubbles: true, detail: { count: approvalCount } }));
  }

  private updateSelectionUI() {
    const bar = this.container.querySelector('#tasksSelectionBar') as HTMLElement;
    const countEl = this.container.querySelector('.tasks-selection-count') as HTMLElement;
    const selectAllEl = this.container.querySelector('#tasksSelectAll') as HTMLInputElement;
    const headerActions = this.container.querySelector('.tasks-header-actions') as HTMLElement;

    if (bar) bar.style.display = this.selectionMode ? '' : 'none';
    if (countEl) countEl.textContent = `${this.selectedIds.size} selected`;
    if (selectAllEl) {
      const filtered = this.getFilteredTasks();
      selectAllEl.checked = filtered.length > 0 && this.selectedIds.size === filtered.length;
    }

    const existing = headerActions?.querySelector('.tasks-export-btn') as HTMLElement | null;
    if (this.selectionMode && this.selectedIds.size > 0) {
      if (existing) {
        existing.innerHTML = `${getIcon(ArrowUp, 14)} Export (${this.selectedIds.size})`;
      } else if (headerActions) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary tasks-export-btn';
        btn.id = 'tasksExportBtn';
        btn.innerHTML = `${getIcon(ArrowUp, 14)} Export (${this.selectedIds.size})`;
        btn.addEventListener('click', () => this.handleExport());
        headerActions.appendChild(btn);
      }
    } else if (existing) {
      existing.remove();
    }
  }

  private async handleExport() {
    if (!this.onExportCallback || this.selectedIds.size === 0) return;
    const ids = Array.from(this.selectedIds);
    await this.onExportCallback(ids);
    this.selectionMode = false;
    this.selectedIds.clear();
    this.render();
  }

  private renderList() {
    const container = this.container.querySelector('#tasksList')!;
    if (!container) return;

    this.updateTabCounts();
    this.renderApprovalRequests();

    const filtered = this.getFilteredTasks();

    const emptyMessages: Record<TaskTab, [string, string]> = {
      all: ['No scheduled tasks yet.', 'Use the input above to add one.'],
      inactive: ['No inactive tasks.', 'Paused tasks will appear here.'],
      'needs-approval': ['No approvals pending.', 'Tasks needing approval will appear here.'],
    };

    if (filtered.length === 0) {
      // On needs-approval tab, if there are approval cards, don't show the empty state
      if (this.activeTab === 'needs-approval' && this.approvalRequests.length > 0) {
        container.innerHTML = '';
        this.renderDetailPanel();
        return;
      }
      container.innerHTML = `
        <div class="tasks-empty">
          ${getIcon(Zap, 48)}
          <p>${emptyMessages[this.activeTab][0]}</p>
          <p class="tasks-empty-hint">${emptyMessages[this.activeTab][1]}</p>
        </div>`;
      this.renderDetailPanel();
      return;
    }

    container.innerHTML = filtered.map(task => {
      const aiOn = !!task.aiAutomated;
      const enabled = task.enabled !== false;
      const isActive = this.selectedTaskId === task.id;
      const selected = this.selectedIds.has(task.id);
      const phaseState = this.taskPhaseStates.get(task.id);

      const nextRunHtml = aiOn && task.nextRun
        ? `<span class="task-next-badge">Next: ${this.formatNextRun(task.nextRun)}</span>` : '';
      const lastRunHtml = task.lastRun
        ? `<span class="task-card-last-run">Last: ${formatTimeAgo(new Date(task.lastRun))}</span>` : '';
      const runCountHtml = task.runCount
        ? `<span class="task-run-count">${task.runCount}×</span>` : '';

      const phaseBadgeHtml = phaseState === 'phase1-running'
        ? `<span class="task-phase-badge task-phase1-badge">${getIcon(Loader, 10)} Researching…</span>`
        : phaseState === 'phase2-running'
        ? `<span class="task-phase-badge task-phase2-badge">${getIcon(Loader, 10)} Executing…</span>`
        : '';

      return `
        <div class="task-card ${aiOn ? 'task-card-ai' : ''} ${!enabled ? 'task-card-disabled' : ''} ${selected ? 'task-card-selected' : ''} ${isActive ? 'task-card-active' : ''}"
             data-id="${escapeHtml(task.id)}">

          ${this.selectionMode ? `
          <label class="task-select-checkbox-wrap" title="Select task">
            <input type="checkbox" class="task-select-checkbox" data-id="${escapeHtml(task.id)}"
              ${selected ? 'checked' : ''} />
          </label>` : ''}

          <div class="task-card-content">
            <div class="task-card-info">
              <span class="task-card-title">${escapeHtml(task.title || task.action)}</span>
              <div class="task-card-tags">
                <span class="task-badge-schedule">${getIcon(Clock, 11)} ${escapeHtml(task.schedule)}</span>
                ${aiOn ? `<span class="task-badge-ai">${getIcon(Bot, 11)} AI</span>` : ''}
                ${phaseBadgeHtml}
                ${lastRunHtml}
                ${runCountHtml}
              </div>
            </div>
            <div class="task-card-right">
              ${nextRunHtml}
              <label class="task-toggle-switch" title="${enabled ? 'Enabled — click to pause' : 'Paused — click to enable'}">
                <input type="checkbox" class="task-enabled-checkbox" data-id="${escapeHtml(task.id)}"
                  ${enabled ? 'checked' : ''} />
                <span class="task-toggle-track"></span>
              </label>
            </div>
          </div>
        </div>`;
    }).join('');

    if (this.selectionMode) container.classList.add('tasks-selection-active');
    else container.classList.remove('tasks-selection-active');

    this.updateSelectionUI();

    // Card click → open detail panel (clicking the info area, not the right controls)
    container.querySelectorAll('.task-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.task-card-right, .task-select-checkbox-wrap')) return;
        const id = (card as HTMLElement).dataset.id;
        if (!id) return;
        this.selectedTaskId = this.selectedTaskId === id ? null : id;
        this.renderList();
      });
    });

    // Task selection checkboxes
    container.querySelectorAll('.task-select-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = (cb as HTMLElement).dataset.id!;
        if ((cb as HTMLInputElement).checked) this.selectedIds.add(id);
        else this.selectedIds.delete(id);
        const card = container.querySelector(`.task-card[data-id="${id}"]`) as HTMLElement;
        if (card) {
          if ((cb as HTMLInputElement).checked) card.classList.add('task-card-selected');
          else card.classList.remove('task-card-selected');
        }
        this.updateSelectionUI();
      });
    });

    // Enabled toggle
    container.querySelectorAll('.task-enabled-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = (cb as HTMLElement).dataset.id!;
        const task = this.tasks.find(t => t.id === id);
        if (!task) return;
        task.enabled = (cb as HTMLInputElement).checked;
        this.onUpdateCallback?.(task);
        this.renderList();
      });
    });

    // Delete
    container.querySelectorAll('.task-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id!;
        if (this.selectedTaskId === id) this.selectedTaskId = null;
        this.tasks = this.tasks.filter(t => t.id !== id);
        this.renderList();
        this.onDeleteCallback?.(id);
      });
    });

    this.renderDetailPanel();
  }

  private renderDetailPanel() {
    const panel = this.container.querySelector('#taskDetailPanel') as HTMLElement;
    const pane = this.container.querySelector('#tasksPane') as HTMLElement;
    if (!panel) return;

    if (!this.selectedTaskId) {
      panel.innerHTML = '';
      panel.classList.remove('task-detail-open');
      pane?.classList.remove('tasks-pane-split');
      return;
    }

    const task = this.tasks.find(t => t.id === this.selectedTaskId);
    if (!task) {
      this.selectedTaskId = null;
      this.renderDetailPanel();
      return;
    }

    panel.classList.add('task-detail-open');
    panel.style.width = this.detailPanelWidth + 'px';
    panel.style.transition = 'none';
    pane?.classList.add('tasks-pane-split');

    const aiOn = !!task.aiAutomated;
    const enabled = task.enabled !== false;
    const toggling = this.togglingAi.has(task.id);
    const history = [...(task.runHistory || [])].reverse();

    const nextRunHtml = aiOn && task.nextRun
      ? `<span class="task-next-run">${getIcon(Clock, 12)} Next: ${this.formatNextRun(task.nextRun)}</span>` : '';
    const lastRunHtml = task.lastRun
      ? `<span class="task-last-run">Last: ${formatTimeAgo(new Date(task.lastRun))}</span>` : '';

    const endTimeSection = task.endTime ? `
      <div class="task-detail-field">
        <span class="task-detail-label">${getIcon(CalendarClock, 13)} End Time</span>
        <div class="task-detail-endtime-row">
          <input type="datetime-local" class="task-detail-endtime-input"
            value="${task.endTime.slice(0, 16)}" />
          <button class="btn btn-icon task-detail-endtime-clear" title="Remove end time">
            ${getIcon(CalendarX, 13)}
          </button>
        </div>
      </div>` : `
      <div class="task-detail-field">
        <span class="task-detail-label">${getIcon(CalendarClock, 13)} End Time</span>
        <button class="btn btn-ghost task-detail-endtime-add" style="font-size:var(--text-xs);padding:2px 0;color:var(--text-tertiary);">Set end time…</button>
        <input type="datetime-local" class="task-detail-endtime-input-hidden" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0" />
      </div>`;

    const historyHtml = history.length > 0 ? `
      <div class="task-detail-section">
        <div class="task-detail-section-title">Run History</div>
        <div class="task-detail-history-list">
          ${history.map((run, i) => `
            <div class="task-detail-history-item ${i === 0 ? 'task-detail-history-latest' : ''}">
              <div class="task-detail-history-meta">
                <span class="task-history-time">${formatTimeAgo(new Date(run.timestamp))}</span>
                ${run.logFile ? `<button class="task-log-btn" data-log="${escapeHtml(run.logFile)}">${getIcon(FileText, 12)} View log</button>` : ''}
              </div>
              ${run.result ? `<p class="task-history-result">${escapeHtml(run.result)}</p>` : ''}
            </div>`).join('')}
        </div>
      </div>` : '';

    panel.innerHTML = `
      <div class="task-detail">
        <div class="task-detail-header">
          <input class="task-detail-title-input" value="${escapeHtml(task.title || task.action)}"
            maxlength="60" placeholder="Task title…" />
          <button class="btn btn-icon task-detail-close" title="Close">✕</button>
        </div>

        <div class="task-detail-body">
          <div class="task-detail-section">
            <div class="task-detail-field">
              <span class="task-detail-label">${getIcon(Clock, 13)} Schedule</span>
              <span class="task-detail-value">${escapeHtml(task.schedule)}</span>
            </div>
            <div class="task-detail-field">
              <span class="task-detail-label">Original description</span>
              <span class="task-detail-value task-detail-raw">${escapeHtml(task.raw)}</span>
            </div>
            <div class="task-detail-field">
              <span class="task-detail-label">Created</span>
              <span class="task-detail-value">${formatTimeAgo(new Date(task.createdAt))}</span>
            </div>
          </div>

          <div class="task-detail-section">
            <div class="task-detail-field">
              <span class="task-detail-label">${getIcon(FileText, 13)} Working Directory</span>
              <div class="task-detail-workdir-row">
                <input type="text" class="task-detail-workdir-input"
                  placeholder="Default (app config dir)"
                  value="${escapeHtml(task.workingDir || '')}" />
                <button class="btn btn-secondary task-detail-workdir-browse" title="Browse folder">
                  ${getIcon(FileText, 13)} Browse
                </button>
              </div>
            </div>
          </div>

          <div class="task-detail-section">
            <div class="task-detail-field">
              <span class="task-detail-label">${getIcon(Zap, 13)} ${task.twoPhase ? 'Phase 1 — Research Prompt' : 'AI Prompt'}</span>
              <textarea class="task-detail-action-input" rows="4"
                placeholder="${task.twoPhase ? 'What to research/gather before executing…' : 'Describe the action…'}">${escapeHtml(task.action)}</textarea>
            </div>
            <div class="task-detail-field">
              <label class="task-ai-toggle">
                <input type="checkbox" class="task-detail-twophase-checkbox"
                  ${task.twoPhase ? 'checked' : ''} />
                ${getIcon(Bot, 14)} Two-Phase (Research then Execute)
              </label>
            </div>
            ${task.twoPhase ? `
            <div class="task-detail-field task-phase1-prompt-field">
              <span class="task-detail-label">${getIcon(Play, 13)} Phase 2 — Execution Prompt</span>
              <textarea class="task-detail-phase2-input task-detail-action-input" rows="3"
                placeholder="What to execute after the research is approved…">${escapeHtml(task.phase2Prompt || '')}</textarea>
            </div>
            <p class="task-detail-phase-hint">Phase 1 researches, you approve, then Phase 2 executes.</p>
            ` : ''}
          </div>

          <div class="task-detail-section">
            ${endTimeSection}
          </div>

          <div class="task-detail-section task-detail-controls-section">
            <div class="task-detail-toggles">
              <label class="task-ai-toggle ${toggling ? 'task-ai-toggling' : ''}">
                <input type="checkbox" class="task-detail-ai-checkbox"
                  ${aiOn ? 'checked' : ''} ${toggling ? 'disabled' : ''} />
                ${toggling ? getIcon(Loader, 14) : getIcon(Bot, 14)}
                <span>${toggling ? 'Enabling…' : 'AI-Automated'}</span>
              </label>
              <label class="task-ai-toggle">
                <input type="checkbox" class="task-detail-enabled-checkbox"
                  ${enabled ? 'checked' : ''} />
                <span>Enabled</span>
              </label>
            </div>
            ${nextRunHtml || lastRunHtml ? `
            <div class="task-detail-run-info">
              ${nextRunHtml}
              ${lastRunHtml}
              ${task.runCount ? `<span class="task-run-count">${task.runCount}×</span>` : ''}
            </div>` : ''}
            <div class="task-detail-actions">
              <button class="btn task-detail-delete-btn">
                ${getIcon(Trash2, 14)} Delete
              </button>
              <button class="btn btn-secondary task-detail-debug-btn" title="Show the exact command that will be run">
                ${getIcon(Terminal, 14)} Debug
              </button>
              <button class="btn btn-secondary task-detail-test-btn"
                ${this.testingIds.has(task.id) ? 'disabled' : ''}>
                ${this.testingIds.has(task.id) ? getIcon(Loader, 14) : getIcon(Play, 14)}
                ${this.testingIds.has(task.id) ? 'Running…' : 'Run Now'}
              </button>
            </div>
          </div>

          ${historyHtml}
        </div>
      </div>
    `;

    this.setupResizeHandle(panel);

    // Close
    panel.querySelector('.task-detail-close')?.addEventListener('click', () => {
      this.selectedTaskId = null;
      this.renderList();
    });

    // Title editing (on blur/enter)
    const titleInput = panel.querySelector('.task-detail-title-input') as HTMLInputElement;
    const saveTitle = () => {
      const words = titleInput.value.trim().split(/\s+/).filter(Boolean);
      const title = words.join(' ') || task.title;
      task.title = title;
      titleInput.value = title;
      this.onUpdateCallback?.(task);
      // Update the card title without full re-render
      const cardTitle = this.container.querySelector(`.task-card[data-id="${task.id}"] .task-card-title`);
      if (cardTitle) cardTitle.textContent = task.title || task.action;
    };
    titleInput?.addEventListener('blur', saveTitle);
    titleInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') titleInput.blur(); });

    // Action editing
    const actionInput = panel.querySelector('.task-detail-action-input') as HTMLTextAreaElement;
    actionInput?.addEventListener('blur', () => {
      const action = actionInput.value.trim();
      if (action) { task.action = action; this.onUpdateCallback?.(task); }
    });

    // Working directory
    const workdirInput = panel.querySelector('.task-detail-workdir-input') as HTMLInputElement;
    workdirInput?.addEventListener('blur', () => {
      task.workingDir = workdirInput.value.trim() || undefined;
      this.onUpdateCallback?.(task);
    });
    panel.querySelector('.task-detail-workdir-browse')?.addEventListener('click', async () => {
      const folder = await window.electronAPI.browseFolder();
      if (folder) {
        task.workingDir = folder as string;
        workdirInput.value = folder as string;
        this.onUpdateCallback?.(task);
      }
    });

    // Two-phase toggle
    const twoPhaseCb = panel.querySelector('.task-detail-twophase-checkbox') as HTMLInputElement;
    twoPhaseCb?.addEventListener('change', () => {
      task.twoPhase = twoPhaseCb.checked;
      this.onUpdateCallback?.(task);
      this.renderDetailPanel();
    });

    // Phase 2 prompt editing
    const phase2Input = panel.querySelector('.task-detail-phase2-input') as HTMLTextAreaElement;
    phase2Input?.addEventListener('blur', () => {
      task.phase2Prompt = phase2Input.value.trim();
      this.onUpdateCallback?.(task);
    });

    // AI toggle
    const aiCb = panel.querySelector('.task-detail-ai-checkbox') as HTMLInputElement;
    aiCb?.addEventListener('change', async () => {
      const enabledVal = aiCb.checked;
      if (!this.onToggleAiCallback) return;
      this.togglingAi.add(task.id);
      this.renderList();
      try {
        const result = await this.onToggleAiCallback(task.id, enabledVal);
        task.aiAutomated = enabledVal;
        if (enabledVal) { task.cronExpression = result.cronExpression; task.nextRun = result.nextRun; }
        else { task.nextRun = undefined; }
      } catch {
        task.aiAutomated = !enabledVal;
      } finally {
        this.togglingAi.delete(task.id);
        this.renderList();
      }
    });

    // Enabled toggle
    const enabledCb = panel.querySelector('.task-detail-enabled-checkbox') as HTMLInputElement;
    enabledCb?.addEventListener('change', () => {
      task.enabled = enabledCb.checked;
      this.onUpdateCallback?.(task);
      this.renderList();
    });

    // End time
    const endTimeInput = panel.querySelector('.task-detail-endtime-input') as HTMLInputElement;
    endTimeInput?.addEventListener('change', () => {
      task.endTime = endTimeInput.value ? new Date(endTimeInput.value).toISOString() : undefined;
      this.onUpdateCallback?.(task);
      this.renderDetailPanel();
    });
    const endTimeAddBtn = panel.querySelector('.task-detail-endtime-add') as HTMLButtonElement;
    const endTimeHidden = panel.querySelector('.task-detail-endtime-input-hidden') as HTMLInputElement;
    if (endTimeAddBtn && endTimeHidden) {
      endTimeAddBtn.addEventListener('click', () => endTimeHidden.showPicker?.());
      endTimeHidden.addEventListener('change', () => {
        task.endTime = endTimeHidden.value ? new Date(endTimeHidden.value).toISOString() : undefined;
        this.onUpdateCallback?.(task);
        this.renderDetailPanel();
      });
    }
    panel.querySelector('.task-detail-endtime-clear')?.addEventListener('click', () => {
      task.endTime = undefined;
      this.onUpdateCallback?.(task);
      this.renderDetailPanel();
    });

    // Debug command button
    panel.querySelector('.task-detail-debug-btn')?.addEventListener('click', async () => {
      try {
        const info = await (window.electronAPI as any).tasksGetDebugCommand(task.id) as { command: string; workingDir: string; prompt: string; promptFile: string };
        this.showDebugModal(info);
      } catch (err: any) {
        this.showLogModal(`Could not get debug info:\n${err.message}`);
      }
    });

    // Test button
    const testBtn = panel.querySelector('.task-detail-test-btn') as HTMLButtonElement;
    testBtn?.addEventListener('click', () => {
      if (this.testingIds.has(task.id)) return;
      this.testingIds.add(task.id);
      this.renderList();
      this.onTestCallback?.(task.id);
      setTimeout(() => { this.testingIds.delete(task.id); this.renderList(); }, 3000);
    });

    // Delete — confirmation popup
    panel.querySelector('.task-detail-delete-btn')?.addEventListener('click', () => {
      this.showConfirmModal(
        'Delete Task',
        `Are you sure you want to delete "${task.title || task.action}"? This cannot be undone.`,
        'Delete',
        () => {
          this.selectedTaskId = null;
          this.tasks = this.tasks.filter(t => t.id !== task.id);
          this.renderList();
          this.onDeleteCallback?.(task.id);
        }
      );
    });

    // View log buttons
    panel.querySelectorAll('.task-log-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const logFile = (btn as HTMLElement).dataset.log!;
        try {
          const content = await window.electronAPI.tasksReadLog(logFile);
          this.showLogModal(content);
        } catch (err: any) {
          this.showLogModal(`Could not read log file:\n${err.message}`);
        }
      });
    });
  }

  private renderApprovalRequests() {
    const container = this.container.querySelector('#tasksApprovals') as HTMLElement;
    if (!container) return;

    if (this.approvalRequests.length === 0 || this.activeTab !== 'needs-approval') {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = this.approvalRequests.map(req => {
      const task = this.tasks.find(t => t.id === req.taskId);
      const taskTitle = task?.title || 'Task';

      if (req.isPhaseGate) {
        const renderedPreview = req.phase1ResultsPreview ? renderMarkdown(req.phase1ResultsPreview) : '';
        return `
          <div class="task-approval-card task-phase-gate-card" data-approval-id="${escapeHtml(req.approvalId)}">
            <div class="task-approval-header">
              ${getIcon(Bot, 15)}
              <span class="task-approval-task-name">${escapeHtml(taskTitle)}</span>
              <span class="task-approval-badge task-phase-gate-badge">Phase 1 Complete</span>
            </div>
            ${req.summary ? `<p class="task-approval-summary">${escapeHtml(req.summary)}</p>` : ''}
            ${renderedPreview ? `
            <details class="task-phase1-results" open>
              <summary class="task-phase1-results-toggle">
                ${getIcon(FileText, 12)} Research Findings
                <button class="btn btn-ghost task-phase1-zoom-btn" style="margin-left:auto;font-size:var(--text-xs);padding:1px 6px;" title="Zoom">⤢ Zoom</button>
              </summary>
              <div class="task-phase1-results-content">${renderedPreview}</div>
            </details>` : ''}
            <p class="task-approval-question">${escapeHtml(req.question)}</p>
            <div class="task-approval-options">
              ${req.options.map(opt => `
                <button class="btn task-approval-btn" data-choice="${escapeHtml(opt)}">${escapeHtml(opt)}</button>
              `).join('')}
            </div>
            <div class="task-approval-input-row">
              <input type="text" class="task-approval-instructions" placeholder="Add modifications or instructions (optional)…" />
              ${req.phase1ResultsFile ? `<button class="btn btn-ghost task-log-btn" data-log="${escapeHtml(req.phase1ResultsFile)}">${getIcon(FileText, 12)} Full log</button>` : ''}
            </div>
          </div>`;
      }

      return `
        <div class="task-approval-card" data-approval-id="${escapeHtml(req.approvalId)}">
          <div class="task-approval-header">
            ${getIcon(Bot, 15)}
            <span class="task-approval-task-name">${escapeHtml(taskTitle)}</span>
            <span class="task-approval-badge">Needs Approval</span>
          </div>
          ${req.summary ? `<p class="task-approval-summary">${escapeHtml(req.summary)}</p>` : ''}
          <p class="task-approval-question">${escapeHtml(req.question)}</p>
          ${req.context ? `<p class="task-approval-context">${escapeHtml(req.context)}</p>` : ''}
          <div class="task-approval-options">
            ${req.options.map(opt => `
              <button class="btn task-approval-btn" data-choice="${escapeHtml(opt)}">${escapeHtml(opt)}</button>
            `).join('')}
          </div>
          <div class="task-approval-input-row">
            <input type="text" class="task-approval-instructions" placeholder="Add instructions (optional)…" />
          </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.task-approval-card').forEach(card => {
      const approvalId = (card as HTMLElement).dataset.approvalId!;
      const instructionsInput = card.querySelector('.task-approval-instructions') as HTMLInputElement;
      card.querySelectorAll('.task-approval-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const choice = (btn as HTMLElement).dataset.choice!;
          const instructions = instructionsInput?.value.trim() || '';
          window.electronAPI.tasksRespondApproval(approvalId, choice, instructions);
          this.removeApprovalRequest(approvalId);
        });
      });
      card.querySelectorAll('.task-log-btn[data-log]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const logFile = (btn as HTMLElement).dataset.log!;
          try {
            const content = await window.electronAPI.tasksReadLog(logFile);
            this.showLogModal(content);
          } catch (err: any) {
            this.showLogModal(`Could not read log file:\n${err.message}`);
          }
        });
      });
      // Zoom button — show full markdown in a large modal
      card.querySelector('.task-phase1-zoom-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const approvalId = (card as HTMLElement).dataset.approvalId!;
        const req = this.approvalRequests.find(r => r.approvalId === approvalId);
        if (req?.phase1ResultsPreview) this.showMarkdownModal('Research Findings', req.phase1ResultsPreview);
      });
    });
  }

  private setupResizeHandle(panel: HTMLElement) {
    const handle = document.createElement('div');
    handle.className = 'task-detail-resize-handle';
    panel.prepend(handle);

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      handle.classList.add('dragging');
      const startX = e.clientX;
      const startWidth = panel.offsetWidth;

      const onMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX;
        const newWidth = Math.min(800, Math.max(300, startWidth + delta));
        panel.style.width = newWidth + 'px';
        this.detailPanelWidth = newWidth;
      };

      const onUp = () => {
        handle.classList.remove('dragging');
        localStorage.setItem('tasks-detail-width', String(this.detailPanelWidth));
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  private showMarkdownModal(title: string, markdown: string) {
    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;display:flex;align-items:center;justify-content:center;';
    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:var(--radius-lg);width:780px;max-width:92vw;height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.5);';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border-color);flex-shrink:0;';
    header.innerHTML = `<span style="font-weight:600;font-size:var(--text-base);">${escapeHtml(title)}</span><button class="btn btn-icon" style="padding:4px;">✕</button>`;
    const body = document.createElement('div');
    body.style.cssText = 'flex:1;overflow-y:auto;padding:20px 24px;font-size:var(--text-sm);line-height:1.7;';
    body.innerHTML = renderMarkdown(markdown);
    modal.appendChild(header);
    modal.appendChild(body);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    header.querySelector('button')!.addEventListener('click', close);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  }

  private showConfirmModal(title: string, message: string, confirmLabel: string, onConfirm: () => void) {
    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:var(--radius-lg);width:360px;padding:24px;display:flex;flex-direction:column;gap:16px;box-shadow:0 8px 32px rgba(0,0,0,.4);';
    modal.innerHTML = `
      <div style="font-size:var(--text-base);font-weight:600;color:var(--text-primary);">${escapeHtml(title)}</div>
      <div style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.5;">${escapeHtml(message)}</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button class="btn btn-secondary confirm-cancel-btn">Cancel</button>
        <button class="btn confirm-ok-btn" style="background:var(--error,#c42b1c);color:#fff;border-color:var(--error,#c42b1c);">${escapeHtml(confirmLabel)}</button>
      </div>
    `;

    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    modal.querySelector('.confirm-cancel-btn')!.addEventListener('click', close);
    modal.querySelector('.confirm-ok-btn')!.addEventListener('click', () => { close(); onConfirm(); });

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    (modal.querySelector('.confirm-ok-btn') as HTMLButtonElement).focus();
  }

  private showDebugModal(info: { command: string; workingDir: string; prompt: string; promptFile: string }) {
    const backdrop = document.createElement('div');
    backdrop.className = 'task-log-modal-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;';

    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--bg-secondary,#1e1e1e);border:1px solid var(--border-color,#333);border-radius:8px;width:760px;max-width:92vw;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;';
    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border-color,#333);">
        <span style="font-weight:600;">Debug — Exact Run Command</span>
        <button class="btn btn-icon" style="padding:4px;">✕</button>
      </div>
      <div style="flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:14px;">
        <div>
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-tertiary);margin-bottom:4px;">Command</div>
          <pre style="margin:0;padding:10px 12px;background:var(--bg-primary,#141414);border:1px solid var(--border-color,#333);border-radius:6px;font-size:12px;white-space:pre-wrap;word-break:break-all;">${esc(info.command)}</pre>
        </div>
        <div>
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-tertiary);margin-bottom:4px;">Working Directory</div>
          <pre style="margin:0;padding:10px 12px;background:var(--bg-primary,#141414);border:1px solid var(--border-color,#333);border-radius:6px;font-size:12px;">${esc(info.workingDir)}</pre>
        </div>
        <div>
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-tertiary);margin-bottom:4px;">Prompt File</div>
          <pre style="margin:0;padding:10px 12px;background:var(--bg-primary,#141414);border:1px solid var(--border-color,#333);border-radius:6px;font-size:12px;white-space:pre-wrap;word-break:break-all;">${esc(info.promptFile)}</pre>
        </div>
        <div>
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-tertiary);margin-bottom:4px;">Prompt Content</div>
          <pre style="margin:0;padding:10px 12px;background:var(--bg-primary,#141414);border:1px solid var(--border-color,#333);border-radius:6px;font-size:12px;line-height:1.5;white-space:pre-wrap;">${esc(info.prompt)}</pre>
        </div>
      </div>
    `;

    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    modal.querySelector('button')!.addEventListener('click', close);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  }

  private showLogModal(rawContent: string) {
    const content = rawContent
      .replace(/\x1b\[[0-9;?<>]*[A-Za-z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const backdrop = document.createElement('div');
    backdrop.className = 'task-log-modal-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--bg-secondary,#1e1e1e);border:1px solid var(--border-color,#333);border-radius:8px;width:700px;max-width:90vw;height:80vh;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;';
    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border-color,#333);">
        <span style="font-weight:600;">Task Run Log</span>
        <button class="btn btn-icon" style="padding:4px;">✕</button>
      </div>
      <pre style="flex:1;overflow:auto;padding:16px;margin:0;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;">${content.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre>
    `;

    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    modal.querySelector('button')!.addEventListener('click', close);

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  }
}
