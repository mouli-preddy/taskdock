import { escapeHtml, formatTimeAgo } from '../utils/html-utils.js';
import { getIcon, Plus, Trash2, Clock, Zap, Loader, Bot, CalendarClock, CalendarX, ChevronDown, ChevronRight, Play, FileText, Download, Upload } from '../utils/icons.js';

export interface TaskApprovalRequest {
  taskId: string;
  approvalId: string;
  question: string;
  context: string;
  options: string[];
  summary?: string;
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
}

type TaskTab = 'all' | 'inactive' | 'needs-approval';

export class TasksView {
  private container: HTMLElement;
  private tasks: ScheduledTask[] = [];
  private activeTab: TaskTab = 'all';
  private parsing = false;
  private togglingAi = new Set<string>();
  private expandedHistory = new Set<string>();
  private approvalRequests: TaskApprovalRequest[] = [];

  private onAddCallback: ((raw: string) => Promise<ScheduledTask>) | null = null;
  private onDeleteCallback: ((id: string) => void) | null = null;
  private onToggleAiCallback: ((id: string, enabled: boolean) => Promise<{ cronExpression: string; nextRun: string }>) | null = null;
  private onUpdateCallback: ((task: ScheduledTask) => void) | null = null;
  private onTestCallback: ((id: string) => void) | null = null;
  private testingIds = new Set<string>();
  private selectionMode = false;
  private selectedIds = new Set<string>();
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

  highlightTask(id: string) {
    const el = this.container.querySelector(`[data-id="${id}"]`) as HTMLElement;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('task-highlight');
    setTimeout(() => el.classList.remove('task-highlight'), 2500);
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
              ${getIcon(Upload, 14)} Import
            </button>
            ${this.selectionMode && this.selectedIds.size > 0 ? `
            <button class="btn btn-primary tasks-export-btn" id="tasksExportBtn">
              ${getIcon(Download, 14)} Export (${this.selectedIds.size})
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
        <div class="tasks-tabs">
          <button class="tasks-tab-btn ${this.activeTab === 'all' ? 'active' : ''}" data-tab="all">All <span class="tasks-tab-count" data-tab-count="all">0</span></button>
          <button class="tasks-tab-btn ${this.activeTab === 'inactive' ? 'active' : ''}" data-tab="inactive">Inactive <span class="tasks-tab-count" data-tab-count="inactive">0</span></button>
          <button class="tasks-tab-btn ${this.activeTab === 'needs-approval' ? 'active' : ''}" data-tab="needs-approval">Need Approvals <span class="tasks-tab-count" data-tab-count="needs-approval">0</span></button>
        </div>
        <div class="tasks-approvals" id="tasksApprovals"></div>
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
        <div class="tasks-list-container">
          <div class="tasks-list" id="tasksList"></div>
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
      console.log('[TasksView] submit', { raw, parsing: this.parsing, hasCallback: !!this.onAddCallback });
      if (!raw) { this.showError('Please enter a task description'); return; }
      if (this.parsing) return;
      if (!this.onAddCallback) { this.showError('Not ready yet — please try again'); return; }

      this.setParsing(true);
      input.value = '';

      try {
        const task = await this.onAddCallback(raw);
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

    // Select mode toggle
    const selectBtn = this.container.querySelector('#tasksSelectBtn') as HTMLButtonElement;
    selectBtn?.addEventListener('click', () => {
      this.selectionMode = !this.selectionMode;
      if (!this.selectionMode) this.selectedIds.clear();
      this.render();
    });

    // Select all
    const selectAllCb = this.container.querySelector('#tasksSelectAll') as HTMLInputElement;
    selectAllCb?.addEventListener('change', () => {
      const filtered = this.getFilteredTasks();
      if (selectAllCb.checked) filtered.forEach(t => this.selectedIds.add(t.id));
      else this.selectedIds.clear();
      this.renderList();
    });

    // Import file picker
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

    // Export button (conditionally rendered — wired via updateSelectionUI)
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
    const counts: Record<TaskTab, number> = {
      all: this.tasks.length,
      inactive: this.tasks.filter(t => t.enabled === false).length,
      'needs-approval': this.tasks.filter(t => !t.aiAutomated).length,
    };
    for (const [tab, count] of Object.entries(counts)) {
      const el = this.container.querySelector(`[data-tab-count="${tab}"]`);
      if (el) el.textContent = String(count);
    }
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

    // Update export button in header
    const existing = headerActions?.querySelector('.tasks-export-btn') as HTMLElement | null;
    if (this.selectionMode && this.selectedIds.size > 0) {
      if (existing) {
        existing.innerHTML = `${getIcon(Download, 14)} Export (${this.selectedIds.size})`;
      } else if (headerActions) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary tasks-export-btn';
        btn.id = 'tasksExportBtn';
        btn.innerHTML = `${getIcon(Download, 14)} Export (${this.selectedIds.size})`;
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

    const filtered = this.getFilteredTasks();

    const emptyMessages: Record<TaskTab, [string, string]> = {
      all: ['No scheduled tasks yet.', 'Use the input above to add one.'],
      inactive: ['No inactive tasks.', 'Paused tasks will appear here.'],
      'needs-approval': ['All tasks are AI-automated.', 'Tasks without AI automation will appear here.'],
    };

    if (filtered.length === 0) {
      const [msg, hint] = emptyMessages[this.activeTab];
      container.innerHTML = `
        <div class="tasks-empty">
          ${getIcon(Zap, 48)}
          <p>${msg}</p>
          <p class="tasks-empty-hint">${hint}</p>
        </div>`;
      return;
    }

    container.innerHTML = filtered.map(task => {
      const aiOn = !!task.aiAutomated;
      const enabled = task.enabled !== false;
      const toggling = this.togglingAi.has(task.id);
      const historyExpanded = this.expandedHistory.has(task.id);
      const history = task.runHistory || [];

      const nextRunHtml = aiOn && task.nextRun
        ? `<span class="task-next-run">Next: ${this.formatNextRun(task.nextRun)}</span>` : '';
      const lastRunHtml = task.lastRun
        ? `<span class="task-last-run">Last: ${formatTimeAgo(new Date(task.lastRun))}</span>` : '';

      const runCountHtml = task.runCount
        ? `<span class="task-run-count" title="Total executions">${task.runCount}×</span>` : '';

      const endTimeHtml = task.endTime ? `
        <span class="task-endtime-set">
          ${getIcon(CalendarClock, 13)}
          <input type="datetime-local" class="task-endtime-input task-endtime-input-set"
            data-id="${escapeHtml(task.id)}" value="${task.endTime.slice(0, 16)}" title="End time" />
          <button class="task-endtime-clear" data-id="${escapeHtml(task.id)}" title="Remove end time">
            ${getIcon(CalendarX, 13)}
          </button>
        </span>` : `
        <button class="task-endtime-add" data-id="${escapeHtml(task.id)}" title="Set end time">
          ${getIcon(CalendarClock, 13)}
          <input type="datetime-local" class="task-endtime-input task-endtime-input-hidden"
            data-id="${escapeHtml(task.id)}" value="" />
        </button>`;

      const historyHtml = history.length > 0 ? (() => {
        const sorted = [...history].reverse(); // newest first
        const latest = sorted[0];
        const hasMore = sorted.length > 1;

        const renderLogBtn = (run: typeof latest) => run.logFile
          ? `<button class="task-log-btn" data-log="${escapeHtml(run.logFile)}" title="Open session log">${getIcon(FileText, 12)} View log</button>`
          : '';

        const latestItemHtml = `
          <div class="task-history-item task-history-item-latest">
            <span class="task-history-time">${formatTimeAgo(new Date(latest.timestamp))}</span>
            ${renderLogBtn(latest)}
            ${latest.result ? `<p class="task-history-result">${escapeHtml(latest.result)}</p>` : ''}
          </div>`;

        const olderItemsHtml = historyExpanded ? sorted.slice(1).map(run => `
          <div class="task-history-item">
            <span class="task-history-time">${formatTimeAgo(new Date(run.timestamp))}</span>
            ${renderLogBtn(run)}
            ${run.result ? `<p class="task-history-result">${escapeHtml(run.result)}</p>` : ''}
          </div>`).join('') : '';

        const toggleHtml = hasMore ? `
          <button class="task-history-toggle" data-id="${escapeHtml(task.id)}">
            ${historyExpanded ? getIcon(ChevronDown, 13) : getIcon(ChevronRight, 13)}
            ${historyExpanded ? 'Hide history' : `Show all ${history.length} runs`}
          </button>` : '';

        return `
          <div class="task-history">
            <div class="task-history-latest-label">${getIcon(Bot, 13)} Latest run</div>
            <div class="task-history-list">
              ${latestItemHtml}
              ${olderItemsHtml}
            </div>
            ${toggleHtml}
          </div>`;
      })() : '';

      const selected = this.selectedIds.has(task.id);
      return `
        <div class="task-card ${aiOn ? 'task-card-ai' : ''} ${!enabled ? 'task-card-disabled' : ''} ${selected ? 'task-card-selected' : ''}"
             data-id="${escapeHtml(task.id)}">

          ${this.selectionMode ? `
          <label class="task-select-checkbox-label" title="Select task">
            <input type="checkbox" class="task-select-checkbox" data-id="${escapeHtml(task.id)}"
              ${selected ? 'checked' : ''} />
          </label>` : ''}

          <!-- Enabled toggle in top-right -->
          <div class="task-enabled-toggle" title="${enabled ? 'Enabled — click to pause' : 'Paused — click to enable'}">
            <label class="task-toggle-switch">
              <input type="checkbox" class="task-enabled-checkbox" data-id="${escapeHtml(task.id)}"
                ${enabled ? 'checked' : ''} />
              <span class="task-toggle-track"></span>
            </label>
          </div>

          <div class="task-card-title-row">
            <span class="task-card-title task-title-display" data-id="${escapeHtml(task.id)}"
              title="Click to edit">${escapeHtml(task.title || task.action)}</span>
            <input class="task-title-input" data-id="${escapeHtml(task.id)}"
              value="${escapeHtml(task.title || task.action)}" maxlength="60"
              placeholder="Short title…" style="display:none" />
          </div>

          <div class="task-card-body">
            <div class="task-field">
              <span class="task-field-label">${getIcon(Clock, 13)} Schedule</span>
              <span class="task-field-value">${escapeHtml(task.schedule)}</span>
              ${runCountHtml}
            </div>
            <div class="task-field">
              <span class="task-field-label">${getIcon(Zap, 13)} AI Prompt</span>
              <span class="task-field-value task-action-display" data-id="${escapeHtml(task.id)}"
                title="Click to edit">${escapeHtml(task.action)}</span>
              <textarea class="task-action-input" data-id="${escapeHtml(task.id)}"
                rows="2" placeholder="Describe the action…"
                style="display:none">${escapeHtml(task.action)}</textarea>
            </div>
          </div>

          <div class="task-card-meta">
            <span class="task-raw" title="Original: ${escapeHtml(task.raw)}">${escapeHtml(task.raw)}</span>
            <span class="task-age">${formatTimeAgo(new Date(task.createdAt))}</span>
            ${endTimeHtml}
          </div>

          <div class="task-card-footer">
            <label class="task-ai-toggle ${toggling ? 'task-ai-toggling' : ''}">
              <input type="checkbox" class="task-ai-checkbox" data-id="${escapeHtml(task.id)}"
                ${aiOn ? 'checked' : ''} ${toggling ? 'disabled' : ''} />
              ${toggling ? getIcon(Loader, 14) : getIcon(Bot, 14)}
              <span>${toggling ? 'Enabling…' : 'AI-Automated'}</span>
            </label>
            <div class="task-run-info">
              ${nextRunHtml}
              ${lastRunHtml}
            </div>
            <button class="btn btn-secondary task-test-btn" data-id="${escapeHtml(task.id)}"
              title="Run this task now (ignores schedule)"
              ${this.testingIds.has(task.id) ? 'disabled' : ''}>
              ${this.testingIds.has(task.id) ? getIcon(Loader, 13) : getIcon(Play, 13)}
              ${this.testingIds.has(task.id) ? 'Running…' : 'Test'}
            </button>
          </div>


          ${historyHtml}

          <button class="btn btn-icon btn-danger task-delete-btn" data-id="${escapeHtml(task.id)}" title="Delete task">
            ${getIcon(Trash2, 14)}
          </button>
        </div>`;
    }).join('');

    if (this.selectionMode) {
      container.classList.add('tasks-selection-active');
    } else {
      container.classList.remove('tasks-selection-active');
    }

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

    // AI toggle
    container.querySelectorAll('.task-ai-checkbox').forEach(cb => {
      cb.addEventListener('change', async () => {
        const id = (cb as HTMLElement).dataset.id!;
        const enabled = (cb as HTMLInputElement).checked;
        if (!this.onToggleAiCallback) return;
        this.togglingAi.add(id);
        this.renderList();
        try {
          const result = await this.onToggleAiCallback(id, enabled);
          const task = this.tasks.find(t => t.id === id);
          if (task) {
            task.aiAutomated = enabled;
            if (enabled) { task.cronExpression = result.cronExpression; task.nextRun = result.nextRun; }
            else { task.nextRun = undefined; }
          }
        } catch {
          const task = this.tasks.find(t => t.id === id);
          if (task) task.aiAutomated = !enabled;
        } finally {
          this.togglingAi.delete(id);
          this.renderList();
        }
      });
    });

    // Inline title editing
    container.querySelectorAll('.task-title-display').forEach(span => {
      span.addEventListener('click', () => {
        const id = (span as HTMLElement).dataset.id!;
        const input = container.querySelector(`.task-title-input[data-id="${id}"]`) as HTMLInputElement;
        (span as HTMLElement).style.display = 'none';
        input.style.display = '';
        input.focus();
        input.select();
      });
    });

    container.querySelectorAll('.task-title-input').forEach(input => {
      const save = () => {
        const id = (input as HTMLElement).dataset.id!;
        const task = this.tasks.find(t => t.id === id);
        if (!task) return;
        const raw = (input as HTMLInputElement).value.trim();
        // Enforce < 5 words
        const words = raw.split(/\s+/).filter(Boolean);
        const title = words.slice(0, 4).join(' ') || task.title;
        task.title = title;
        this.onUpdateCallback?.(task);
        this.renderList();
      };
      input.addEventListener('blur', save);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { (input as HTMLInputElement).blur(); }
        if (e.key === 'Escape') { this.renderList(); } // cancel
      });
    });

    // Inline action editing
    container.querySelectorAll('.task-action-display').forEach(span => {
      span.addEventListener('click', () => {
        const id = (span as HTMLElement).dataset.id!;
        const ta = container.querySelector(`.task-action-input[data-id="${id}"]`) as HTMLTextAreaElement;
        (span as HTMLElement).style.display = 'none';
        ta.style.display = '';
        ta.focus();
        ta.select();
      });
    });

    container.querySelectorAll('.task-action-input').forEach(ta => {
      const save = () => {
        const id = (ta as HTMLElement).dataset.id!;
        const task = this.tasks.find(t => t.id === id);
        if (!task) return;
        const action = (ta as HTMLTextAreaElement).value.trim();
        if (action) task.action = action;
        this.onUpdateCallback?.(task);
        this.renderList();
      };
      ta.addEventListener('blur', save);
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (ta as HTMLTextAreaElement).blur(); }
        if (e.key === 'Escape') { this.renderList(); }
      });
    });

    // Test button — run immediately
    container.querySelectorAll('.task-test-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id!;
        this.testingIds.add(id);
        this.renderList();
        this.onTestCallback?.(id);
        // Clear testing state after 3s (terminal will open)
        setTimeout(() => {
          this.testingIds.delete(id);
          this.renderList();
        }, 3000);
      });
    });

    // History toggle
    container.querySelectorAll('.task-history-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id!;
        if (this.expandedHistory.has(id)) this.expandedHistory.delete(id);
        else this.expandedHistory.add(id);
        this.renderList();
      });
    });

    // View session log
    container.querySelectorAll('.task-log-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const logFile = (btn as HTMLElement).dataset.log!;
        try {
          const content = await window.electronAPI.tasksReadLog(logFile);
          this.showLogModal(content);
        } catch (err: any) {
          this.showLogModal(`Could not read log file:\n${err.message}`);
        }
      });
    });

    // EndTime: icon button opens picker
    container.querySelectorAll('.task-endtime-add').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = btn.querySelector('.task-endtime-input-hidden') as HTMLInputElement;
        input?.showPicker?.();
      });
    });

    container.querySelectorAll('.task-endtime-input').forEach(input => {
      input.addEventListener('change', () => {
        const id = (input as HTMLElement).dataset.id!;
        const task = this.tasks.find(t => t.id === id);
        if (!task) return;
        const val = (input as HTMLInputElement).value;
        task.endTime = val ? new Date(val).toISOString() : undefined;
        this.onUpdateCallback?.(task);
        this.renderList();
      });
    });

    container.querySelectorAll('.task-endtime-clear').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id!;
        const task = this.tasks.find(t => t.id === id);
        if (!task) return;
        task.endTime = undefined;
        this.onUpdateCallback?.(task);
        this.renderList();
      });
    });

    // Delete
    container.querySelectorAll('.task-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id!;
        this.tasks = this.tasks.filter(t => t.id !== id);
        this.expandedHistory.delete(id);
        this.renderList();
        this.onDeleteCallback?.(id);
      });
    });
  }

  private renderApprovalRequests() {
    const container = this.container.querySelector('#tasksApprovals') as HTMLElement;
    if (!container) return;

    if (this.approvalRequests.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = this.approvalRequests.map(req => {
      const task = this.tasks.find(t => t.id === req.taskId);
      const taskTitle = task?.title || 'Task';
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
    });
  }

  private showLogModal(rawContent: string) {
    // Strip residual ANSI sequences (private DEC, OSC) and collapse blank lines
    // eslint-disable-next-line no-control-regex
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
