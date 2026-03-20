import { escapeHtml, formatTimeAgo } from '../utils/html-utils.js';
import { getIcon, Plus, Trash2, Clock, Zap, Loader, Bot, CalendarClock, CalendarX, ChevronDown, ChevronRight, Play, FileText } from '../utils/icons.js';

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

export class TasksView {
  private container: HTMLElement;
  private tasks: ScheduledTask[] = [];
  private parsing = false;
  private togglingAi = new Set<string>();
  private expandedHistory = new Set<string>();

  private onAddCallback: ((raw: string) => Promise<ScheduledTask>) | null = null;
  private onDeleteCallback: ((id: string) => void) | null = null;
  private onToggleAiCallback: ((id: string, enabled: boolean) => Promise<{ cronExpression: string; nextRun: string }>) | null = null;
  private onUpdateCallback: ((task: ScheduledTask) => void) | null = null;
  private onTestCallback: ((id: string) => void) | null = null;
  private testingIds = new Set<string>();

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.render();
  }

  onAdd(callback: (raw: string) => Promise<ScheduledTask>) { this.onAddCallback = callback; }
  onDelete(callback: (id: string) => void) { this.onDeleteCallback = callback; }
  onToggleAi(callback: (id: string, enabled: boolean) => Promise<{ cronExpression: string; nextRun: string }>) { this.onToggleAiCallback = callback; }
  onUpdate(callback: (task: ScheduledTask) => void) { this.onUpdateCallback = callback; }
  onTest(callback: (id: string) => void) { this.onTestCallback = callback; }

  setTasks(tasks: ScheduledTask[]) {
    this.tasks = tasks;
    this.renderList();
    this.updateSubtitle();
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
            <span class="tasks-subtitle">0 scheduled tasks</span>
          </div>
        </header>
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
        this.updateSubtitle();
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

  private renderList() {
    const container = this.container.querySelector('#tasksList')!;
    if (!container) return;

    if (this.tasks.length === 0) {
      container.innerHTML = `
        <div class="tasks-empty">
          ${getIcon(Zap, 48)}
          <p>No scheduled tasks yet.</p>
          <p class="tasks-empty-hint">Use the input above to add one.</p>
        </div>`;
      return;
    }

    container.innerHTML = this.tasks.map(task => {
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

      return `
        <div class="task-card ${aiOn ? 'task-card-ai' : ''} ${!enabled ? 'task-card-disabled' : ''}"
             data-id="${escapeHtml(task.id)}">

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
              <span class="task-field-label">${getIcon(Zap, 13)} What to do</span>
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
        this.updateSubtitle();
        this.onDeleteCallback?.(id);
      });
    });
  }

  private updateSubtitle() {
    const el = this.container.querySelector('.tasks-subtitle');
    if (el) {
      const n = this.tasks.length;
      el.textContent = `${n} scheduled task${n === 1 ? '' : 's'}`;
    }
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
