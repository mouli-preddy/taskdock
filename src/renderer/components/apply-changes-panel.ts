/**
 * Apply Changes Panel
 * Displays queue of comment-based fixes with status and controls
 */

import type { ApplyChangeItem, ApplyChangesQueueState } from '../../shared/types.js';
import { escapeHtml } from '../utils/html-utils.js';
import {
  iconHtml,
  X,
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  Trash2,
  Check,
  AlertCircle,
  Clock,
  Loader,
  GitCommit,
} from '../utils/icons.js';

export interface ApplyChangesPanelState {
  queueState: ApplyChangesQueueState | null;
  canApply: boolean;
}

export class ApplyChangesPanel {
  private container: HTMLElement;
  private queueState: ApplyChangesQueueState | null = null;
  private canApply: boolean = false;

  // Callbacks
  private closeCallback?: () => void;
  private pauseCallback?: () => void;
  private resumeCallback?: () => void;
  private retryCallback?: (itemId: string) => void;
  private skipCallback?: (itemId: string) => void;
  private removeCallback?: (itemId: string) => void;
  private clearCompletedCallback?: () => void;
  private navigateCallback?: (filePath: string, line: number) => void;

  constructor() {
    this.container = document.getElementById('applyChangesPanel')!;
    this.render();
  }

  setContainer(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  onPause(callback: () => void): void {
    this.pauseCallback = callback;
  }

  onResume(callback: () => void): void {
    this.resumeCallback = callback;
  }

  onRetry(callback: (itemId: string) => void): void {
    this.retryCallback = callback;
  }

  onSkip(callback: (itemId: string) => void): void {
    this.skipCallback = callback;
  }

  onRemove(callback: (itemId: string) => void): void {
    this.removeCallback = callback;
  }

  onClearCompleted(callback: () => void): void {
    this.clearCompletedCallback = callback;
  }

  onNavigate(callback: (filePath: string, line: number) => void): void {
    this.navigateCallback = callback;
  }

  setState(state: ApplyChangesPanelState): void {
    this.queueState = state.queueState;
    this.canApply = state.canApply;
    this.render();
  }

  getState(): ApplyChangesPanelState {
    return {
      queueState: this.queueState,
      canApply: this.canApply,
    };
  }

  updateItem(itemId: string, updates: Partial<ApplyChangeItem>): void {
    if (!this.queueState) return;
    const item = this.queueState.items.find(i => i.id === itemId);
    if (item) {
      Object.assign(item, updates);
      this.render();
    }
  }

  clear(): void {
    this.queueState = null;
    this.render();
  }

  private render(): void {
    if (!this.container) return;

    const items = this.queueState?.items || [];
    const isPaused = this.queueState?.isPaused || false;
    const isProcessing = this.queueState?.isProcessing || false;

    const pendingCount = items.filter(i => i.status === 'pending').length;
    const runningCount = items.filter(i => i.status === 'running').length;
    const completedCount = items.filter(i => i.status === 'success' || i.status === 'skipped').length;
    const failedCount = items.filter(i => i.status === 'failed').length;

    const statusText = isPaused && failedCount > 0
      ? 'Paused - fix failed'
      : isProcessing
        ? `Processing ${runningCount + completedCount} of ${items.length}`
        : pendingCount > 0
          ? `${pendingCount} pending`
          : 'Queue empty';

    this.container.innerHTML = `
      <div class="apply-changes-header">
        <div class="apply-changes-title">
          ${iconHtml(GitCommit, { size: 20 })}
          <span>Apply Changes</span>
          <span class="apply-changes-count">${items.length}</span>
        </div>
        <div class="apply-changes-header-actions">
          ${items.length > 0 ? `
            ${isPaused ? `
              <button class="btn btn-sm btn-ghost resume-btn" title="Resume">
                ${iconHtml(Play, { size: 14 })}
              </button>
            ` : `
              <button class="btn btn-sm btn-ghost pause-btn" title="Pause">
                ${iconHtml(Pause, { size: 14 })}
              </button>
            `}
            ${completedCount > 0 ? `
              <button class="btn btn-sm btn-ghost clear-completed-btn" title="Clear completed">
                ${iconHtml(Trash2, { size: 14 })}
              </button>
            ` : ''}
          ` : ''}
          <button class="btn btn-icon close-apply-panel-btn" title="Close">
            ${iconHtml(X, { size: 20 })}
          </button>
        </div>
      </div>

      <div class="apply-changes-status">
        <span class="status-text">${statusText}</span>
        ${isProcessing ? '<div class="status-spinner"></div>' : ''}
      </div>

      <div class="apply-changes-list">
        ${items.length === 0
          ? this.renderEmptyState()
          : items.map(item => this.renderItem(item)).join('')
        }
      </div>
    `;

    this.attachEventListeners();
  }

  private renderEmptyState(): string {
    return `
      <div class="apply-changes-empty">
        ${iconHtml(GitCommit, { size: 48, strokeWidth: 1.5 })}
        <p>No changes queued</p>
        <p class="apply-changes-empty-hint">Click "Apply" on any comment to get started</p>
      </div>
    `;
  }

  private renderItem(item: ApplyChangeItem): string {
    const fileName = item.filePath.split('/').pop() || item.filePath;
    const truncatedComment = item.commentContent.substring(0, 50).replace(/\n/g, ' ');

    const statusIcon = this.getStatusIcon(item.status);
    const statusClass = item.status;

    return `
      <div class="apply-change-item ${statusClass}" data-item-id="${item.id}">
        <div class="apply-change-item-header">
          <span class="apply-change-status-icon">${statusIcon}</span>
          <span class="apply-change-location"
                data-file="${item.filePath}"
                data-line="${item.lineNumber}">
            ${escapeHtml(fileName)}:${item.lineNumber}
          </span>
          ${item.status === 'pending' ? `
            <button class="btn btn-xs btn-ghost remove-item-btn" data-id="${item.id}" title="Remove">
              ${iconHtml(X, { size: 12 })}
            </button>
          ` : ''}
        </div>

        <div class="apply-change-preview" title="${escapeHtml(item.commentContent)}">
          ${escapeHtml(truncatedComment)}${item.commentContent.length > 50 ? '...' : ''}
        </div>

        ${item.customMessage ? `
          <div class="apply-change-custom-message">
            <em>${escapeHtml(item.customMessage)}</em>
          </div>
        ` : ''}

        ${item.summary && (item.status === 'success' || item.status === 'failed') ? `
          <div class="apply-change-summary">
            ${escapeHtml(item.summary)}
          </div>
        ` : ''}

        ${item.status === 'success' && item.commitSha ? `
          <div class="apply-change-commit">
            ${iconHtml(Check, { size: 12 })}
            <span class="commit-sha">${item.commitSha.substring(0, 7)}</span>
          </div>
        ` : ''}

        ${item.status === 'failed' ? `
          <div class="apply-change-error">
            ${escapeHtml(item.errorMessage || 'Unknown error')}
          </div>
          <div class="apply-change-actions">
            <button class="btn btn-sm btn-ghost retry-btn" data-id="${item.id}">
              ${iconHtml(RotateCcw, { size: 14 })}
              Retry
            </button>
            <button class="btn btn-sm btn-ghost skip-btn" data-id="${item.id}">
              ${iconHtml(SkipForward, { size: 14 })}
              Skip
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  private getStatusIcon(status: ApplyChangeItem['status']): string {
    switch (status) {
      case 'pending':
        return iconHtml(Clock, { size: 14, class: 'status-pending' });
      case 'running':
        return iconHtml(Loader, { size: 14, class: 'status-running spinning' });
      case 'success':
        return iconHtml(Check, { size: 14, class: 'status-success' });
      case 'failed':
        return iconHtml(AlertCircle, { size: 14, class: 'status-failed' });
      case 'skipped':
        return iconHtml(SkipForward, { size: 14, class: 'status-skipped' });
      default:
        return '';
    }
  }

  private attachEventListeners(): void {
    // Close button
    this.container.querySelector('.close-apply-panel-btn')?.addEventListener('click', () => {
      this.closeCallback?.();
    });

    // Pause button
    this.container.querySelector('.pause-btn')?.addEventListener('click', () => {
      this.pauseCallback?.();
    });

    // Resume button
    this.container.querySelector('.resume-btn')?.addEventListener('click', () => {
      this.resumeCallback?.();
    });

    // Clear completed button
    this.container.querySelector('.clear-completed-btn')?.addEventListener('click', () => {
      this.clearCompletedCallback?.();
    });

    // Remove item buttons
    this.container.querySelectorAll('.remove-item-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const itemId = (btn as HTMLElement).dataset.id;
        if (itemId) this.removeCallback?.(itemId);
      });
    });

    // Retry buttons
    this.container.querySelectorAll('.retry-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.id;
        if (itemId) this.retryCallback?.(itemId);
      });
    });

    // Skip buttons
    this.container.querySelectorAll('.skip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.id;
        if (itemId) this.skipCallback?.(itemId);
      });
    });

    // Navigate to file location
    this.container.querySelectorAll('.apply-change-location').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const filePath = (el as HTMLElement).dataset.file;
        const line = parseInt((el as HTMLElement).dataset.line || '1');
        if (filePath) this.navigateCallback?.(filePath, line);
      });
    });
  }
}
