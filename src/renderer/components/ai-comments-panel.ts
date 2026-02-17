/**
 * AI Comments Panel
 * Displays AI-generated review comments with filtering and publishing capabilities
 */

import type { AIReviewComment } from '../../shared/ai-types.js';
import { SEVERITY_CONFIG, CATEGORY_LABELS } from '../../shared/ai-types.js';
import { escapeHtml, formatSimpleMarkdown } from '../utils/html-utils.js';
import {
  iconHtml,
  Bot,
  Save,
  X,
  Plus,
  Send,
  Check,
  File,
  AlertCircle,
  AlertTriangle,
  Lightbulb,
  Play,
  Code2,
} from '../utils/icons.js';

// State interface for saving/restoring AI panel state per PR tab
export interface AICommentsPanelState {
  comments: AIReviewComment[];
  reviewTabs: Array<{
    sessionId: string;
    displayName: string;
    status: string;
    isActive: boolean;
    isSaved: boolean;
    progressMessage: string | null;
  }>;
  activeTabId: string | null;
  savedAt: string | null;
  isFromSaved: boolean;
}

export class AICommentsPanel {
  private container: HTMLElement;
  private comments: AIReviewComment[] = [];
  private filteredComments: AIReviewComment[] = [];
  private filter: {
    severity: AIReviewComment['severity'][];
    showPublished: boolean;
  } = {
    severity: ['critical', 'major', 'minor', 'trivial'],
    showPublished: true,
  };

  // Saved state
  private savedAt: string | null = null;
  private isFromSaved = false;

  private publishCallback?: (comment: AIReviewComment) => Promise<void>;
  private publishAllCallback?: (comments: AIReviewComment[]) => Promise<void>;
  private dismissCallback?: (commentId: string) => void;
  private navigateCallback?: (filePath: string, line: number) => void;
  private saveCallback?: () => Promise<void>;
  private applyCallback?: (comment: AIReviewComment, customMessage: string) => void;
  private canApply: boolean = false;
  private expandedApplyCommentId: string | null = null;
  private applyingCommentIds: Set<string> = new Set();
  private fixedCommentIds: Set<string> = new Set();

  constructor() {
    this.container = document.getElementById('aiCommentsPanel')!;
    this.render();
  }

  setContainer(container: HTMLElement) {
    this.container = container;
    this.render();
  }

  onPublish(callback: (comment: AIReviewComment) => Promise<void>): void {
    this.publishCallback = callback;
  }

  onPublishAll(callback: (comments: AIReviewComment[]) => Promise<void>): void {
    this.publishAllCallback = callback;
  }

  onDismiss(callback: (commentId: string) => void): void {
    this.dismissCallback = callback;
  }

  onNavigate(callback: (filePath: string, line: number) => void): void {
    this.navigateCallback = callback;
  }

  onSave(callback: () => Promise<void>): void {
    this.saveCallback = callback;
  }

  onApply(callback: (comment: AIReviewComment, customMessage: string) => void): void {
    this.applyCallback = callback;
  }

  setCanApply(canApply: boolean): void {
    this.canApply = canApply;
    this.render();
  }

  setApplyingComment(commentId: string, isApplying: boolean): void {
    if (isApplying) {
      this.applyingCommentIds.add(commentId);
    } else {
      this.applyingCommentIds.delete(commentId);
    }
    this.render();
  }

  setFixedComments(fixedIds: Set<string>): void {
    this.fixedCommentIds = fixedIds;
    this.render();
  }

  markCommentFixed(commentId: string): void {
    this.fixedCommentIds.add(commentId);
    this.applyingCommentIds.delete(commentId);
    this.render();
  }

  // Tab state
  private reviewTabs: Array<{
    sessionId: string;
    displayName: string;
    status: string;
    isActive: boolean;
    isSaved: boolean;
    progressMessage: string | null;
  }> = [];
  private activeTabId: string | null = null;

  // Callbacks for tab actions
  private tabSelectCallback?: (sessionId: string, isSaved: boolean) => void;
  private tabCloseCallback?: (sessionId: string, isSaved: boolean) => void;
  private newReviewCallback?: () => void;

  onTabSelect(callback: (sessionId: string, isSaved: boolean) => void): void {
    this.tabSelectCallback = callback;
  }

  onTabClose(callback: (sessionId: string, isSaved: boolean) => void): void {
    this.tabCloseCallback = callback;
  }

  onNewReview(callback: () => void): void {
    this.newReviewCallback = callback;
  }

  setTabs(tabs: Array<{ sessionId: string; displayName: string; status: string; isSaved: boolean; progressMessage?: string | null }>): void {
    this.reviewTabs = tabs.map(t => ({ ...t, isActive: t.sessionId === this.activeTabId, progressMessage: t.progressMessage ?? null }));
    this.render();
  }

  setActiveTab(sessionId: string | null): void {
    this.activeTabId = sessionId;
    this.reviewTabs = this.reviewTabs.map(t => ({ ...t, isActive: t.sessionId === sessionId }));
    this.render();
  }

  addTab(tab: { sessionId: string; displayName: string; status: string; isSaved: boolean }): void {
    this.reviewTabs.push({ ...tab, isActive: false, progressMessage: null });
    this.setActiveTab(tab.sessionId);
  }

  updateTab(sessionId: string, updates: Partial<{ displayName: string; status: string }>): void {
    const tab = this.reviewTabs.find(t => t.sessionId === sessionId);
    if (tab) {
      Object.assign(tab, updates);
      this.render();
    }
  }

  removeTab(sessionId: string): void {
    this.reviewTabs = this.reviewTabs.filter(t => t.sessionId !== sessionId);
    if (this.activeTabId === sessionId) {
      this.activeTabId = this.reviewTabs[0]?.sessionId || null;
    }
    this.render();
  }

  setSavedInfo(savedAt: string | null): void {
    this.savedAt = savedAt;
    this.isFromSaved = savedAt !== null;
    this.render();
  }

  setComments(comments: AIReviewComment[]): void {
    this.comments = comments;
    this.applyFilter();
    this.render();
  }

  getComments(): AIReviewComment[] {
    return this.comments;
  }

  addComment(comment: AIReviewComment): void {
    this.comments.push(comment);
    this.applyFilter();
    this.render();
  }

  updateComment(commentId: string, updates: Partial<AIReviewComment>): void {
    const index = this.comments.findIndex(c => c.id === commentId);
    if (index !== -1) {
      this.comments[index] = { ...this.comments[index], ...updates };
      this.applyFilter();
      this.render();
    }
  }

  clear(): void {
    this.comments = [];
    this.filteredComments = [];
    this.savedAt = null;
    this.isFromSaved = false;
    this.applyingCommentIds.clear();
    this.fixedCommentIds.clear();
    this.render();
  }

  // Clear all state including tabs (used when switching PR tabs)
  clearAll(): void {
    this.comments = [];
    this.filteredComments = [];
    this.reviewTabs = [];
    this.activeTabId = null;
    this.savedAt = null;
    this.isFromSaved = false;
    this.applyingCommentIds.clear();
    this.fixedCommentIds.clear();
    this.render();
  }

  // Get full state for saving (used when switching away from a PR tab)
  getState(): AICommentsPanelState {
    return {
      comments: [...this.comments],
      reviewTabs: this.reviewTabs.map(t => ({ ...t })),
      activeTabId: this.activeTabId,
      savedAt: this.savedAt,
      isFromSaved: this.isFromSaved,
    };
  }

  // Restore full state (used when switching to a PR tab)
  setState(state: AICommentsPanelState): void {
    this.comments = state.comments;
    this.reviewTabs = state.reviewTabs;
    this.activeTabId = state.activeTabId;
    this.savedAt = state.savedAt;
    this.isFromSaved = state.isFromSaved;
    this.applyFilter();
    this.render();
  }

  showProgress(message: string, sessionId?: string): void {
    const targetId = sessionId ?? this.activeTabId;
    const tab = this.reviewTabs.find(t => t.sessionId === targetId);
    if (tab) {
      tab.progressMessage = message;
      this.render();
    }
  }

  hideProgress(sessionId?: string): void {
    const targetId = sessionId ?? this.activeTabId;
    const tab = this.reviewTabs.find(t => t.sessionId === targetId);
    if (tab) {
      tab.progressMessage = null;
      this.render();
    }
  }

  private applyFilter(): void {
    this.filteredComments = this.comments.filter(c => {
      if (!this.filter.severity.includes(c.severity)) return false;
      if (!this.filter.showPublished && c.published) return false;
      return true;
    });
  }

  private getActiveTabProgress(): string | null {
    const activeTab = this.reviewTabs.find(t => t.sessionId === this.activeTabId);
    return activeTab?.progressMessage ?? null;
  }

  private render(): void {
    if (!this.container) return;

    const groupedByFile = this.groupByFile(this.filteredComments);
    const stats = this.getStats();
    const progressMessage = this.getActiveTabProgress();

    const savedDateStr = this.savedAt ? new Date(this.savedAt).toLocaleDateString() : '';

    this.container.innerHTML = `
      <div class="ai-comments-header">
        <div class="ai-comments-title">
          ${iconHtml(Bot, { size: 20, class: 'robot-icon' })}
          <span>AI Review</span>
          <span class="ai-comments-count">${this.comments.length}</span>
        </div>
        <div class="ai-comments-header-actions">
          ${this.isFromSaved ? `
            <span class="saved-indicator" title="Loaded from saved review">
              ${iconHtml(Save, { size: 14 })}
              <span>Saved ${savedDateStr}</span>
            </span>
          ` : this.comments.length > 0 && !this.savedAt ? `
            <button class="btn btn-sm save-review-btn" title="Save this review">
              ${iconHtml(Save, { size: 14 })}
              <span>Save</span>
            </button>
          ` : ''}
          <button class="btn btn-icon close-ai-panel-btn" title="Close">
            ${iconHtml(X, { size: 20 })}
          </button>
        </div>
      </div>

      <div class="ai-review-tabs">
        <div class="ai-tabs-scroll">
          ${this.reviewTabs.map(tab => `
            <div class="ai-tab ${tab.isActive ? 'active' : ''} ${tab.status}"
                 data-id="${tab.sessionId}"
                 data-saved="${tab.isSaved}">
              <span class="ai-tab-status"></span>
              <span class="ai-tab-name">${escapeHtml(tab.displayName)}</span>
              <button class="ai-tab-close" data-id="${tab.sessionId}" data-saved="${tab.isSaved}">
                ${iconHtml(X, { size: 10 })}
              </button>
            </div>
          `).join('')}
        </div>
        <button class="ai-tab-new" title="Start New Review">
          ${iconHtml(Plus, { size: 14 })}
        </button>
      </div>

      <div class="ai-comments-stats">
        <div class="ai-stat critical" title="Critical issues">
          <span class="ai-stat-count">${stats.critical}</span>
          <span class="ai-stat-label">Critical</span>
        </div>
        <div class="ai-stat major" title="Major issues">
          <span class="ai-stat-count">${stats.major}</span>
          <span class="ai-stat-label">Major</span>
        </div>
        <div class="ai-stat minor" title="Minor issues">
          <span class="ai-stat-count">${stats.minor}</span>
          <span class="ai-stat-label">Minor</span>
        </div>
        <div class="ai-stat trivial" title="Trivial issues">
          <span class="ai-stat-count">${stats.trivial}</span>
          <span class="ai-stat-label">Trivial</span>
        </div>
      </div>

      <div class="ai-comments-filters">
        <div class="severity-filters">
          ${this.renderSeverityFilters()}
        </div>
        <label class="show-published-toggle">
          <input type="checkbox" ${this.filter.showPublished ? 'checked' : ''}>
          Show published
        </label>
      </div>

      ${this.getUnpublishedCount() > 0 ? `
        <div class="ai-comments-actions">
          <button class="btn btn-primary publish-all-btn">
            ${iconHtml(Send, { size: 16 })}
            Publish All (${this.getUnpublishedCount()})
          </button>
        </div>
      ` : ''}

      <div class="ai-comments-list">
        ${progressMessage ? this.renderProgressIndicator(progressMessage) : ''}
        ${this.filteredComments.length === 0 && !progressMessage
          ? this.renderEmptyState()
          : Object.entries(groupedByFile).map(([file, comments]) =>
              this.renderFileGroup(file, comments)
            ).join('')
        }
      </div>
    `;

    this.attachEventListeners();
  }

  private renderSeverityFilters(): string {
    return (['critical', 'major', 'minor', 'trivial'] as const)
      .map(severity => {
        const config = SEVERITY_CONFIG[severity];
        const isActive = this.filter.severity.includes(severity);
        return `
          <button class="severity-filter ${isActive ? 'active' : ''}"
                  data-severity="${severity}"
                  style="--filter-color: ${config.color}"
                  title="${config.label}">
            ${this.getSeverityIcon(severity)}
          </button>
        `;
      }).join('');
  }

  private renderEmptyState(): string {
    return `
      <div class="ai-comments-empty">
        ${iconHtml(Bot, { size: 48, strokeWidth: 1.5 })}
        <p>No AI comments yet</p>
        <p class="ai-comments-empty-hint">Get automated feedback on your code changes</p>
        <button class="btn btn-primary start-ai-review-btn">
          ${iconHtml(Play, { size: 16 })}
          Start AI Review
        </button>
      </div>
    `;
  }

  private renderProgressIndicator(message: string): string {
    return `
      <div class="ai-review-progress">
        <div class="ai-review-progress-spinner"></div>
        <span class="ai-review-progress-message">${escapeHtml(message)}</span>
      </div>
    `;
  }

  private renderFileGroup(filePath: string, comments: AIReviewComment[]): string {
    const fileName = filePath.split('/').pop() || filePath;
    const folder = filePath.substring(0, filePath.length - fileName.length);

    return `
      <div class="ai-file-group">
        <div class="ai-file-header">
          ${iconHtml(File, { size: 14 })}
          <span class="ai-file-path">
            ${folder ? `<span class="folder">${folder}</span>` : ''}
            <span class="filename">${fileName}</span>
          </span>
          <span class="ai-file-count">${comments.length}</span>
        </div>
        <div class="ai-file-comments">
          ${comments.map(c => this.renderComment(c)).join('')}
        </div>
      </div>
    `;
  }

  private renderComment(comment: AIReviewComment): string {
    const config = SEVERITY_CONFIG[comment.severity];
    const categoryLabel = CATEGORY_LABELS[comment.category];

    return `
      <div class="ai-comment ${comment.severity} ${comment.published ? 'published' : ''}"
           data-comment-id="${comment.id}">
        <div class="ai-comment-header">
          <div class="ai-comment-severity" style="background: ${config.bgColor}; color: ${config.color}">
            ${this.getSeverityIcon(comment.severity)}
            <span>${config.label}</span>
          </div>
          <span class="ai-comment-category">${categoryLabel}</span>
          <span class="ai-comment-location"
                data-file="${comment.filePath}"
                data-line="${comment.startLine}">
            L${comment.startLine}${comment.endLine !== comment.startLine ? `-${comment.endLine}` : ''}
          </span>
          ${comment.published ? `
            <span class="ai-comment-published-badge" title="Published to ADO">
              ${iconHtml(Check, { size: 12 })}
            </span>
          ` : ''}
          ${(this.fixedCommentIds.has(comment.id) || comment.fixedByAI) ? `
            <span class="ai-comment-fixed-badge" title="Fixed via AI${comment.fixedAt ? ` on ${new Date(comment.fixedAt).toLocaleDateString()}` : ''}">
              ${iconHtml(Check, { size: 12 })}
              Fixed
            </span>
          ` : ''}
        </div>

        <div class="ai-comment-title">${escapeHtml(comment.title)}</div>
        <div class="ai-comment-content">${formatSimpleMarkdown(comment.content)}</div>

        ${comment.suggestedFix ? `
          <div class="ai-comment-suggestion">
            <div class="ai-suggestion-header">
              ${iconHtml(Code2, { size: 14 })}
              Suggested fix
            </div>
            <pre class="ai-suggestion-code"><code>${escapeHtml(comment.suggestedFix)}</code></pre>
          </div>
        ` : ''}

        <div class="ai-comment-footer">
          <span class="ai-comment-confidence" title="Confidence: ${Math.round(comment.confidence * 100)}%">
            <div class="confidence-bar" style="width: ${comment.confidence * 100}%"></div>
          </span>
          <div class="ai-comment-actions">
            ${this.canApply ? (() => {
              const isApplying = this.applyingCommentIds.has(comment.id);
              const isFixed = this.fixedCommentIds.has(comment.id) || comment.fixedByAI;
              if (isFixed) {
                return `
                  <button class="btn btn-sm btn-ghost apply-ai-btn fixed" data-id="${comment.id}" disabled>
                    Fixed
                  </button>
                `;
              } else if (isApplying) {
                return `
                  <button class="btn btn-sm btn-ghost apply-ai-btn applying" data-id="${comment.id}" disabled>
                    Applying...
                  </button>
                `;
              } else {
                return `
                  <button class="btn btn-sm btn-ghost apply-ai-btn" data-id="${comment.id}" title="Apply this fix">
                    Apply
                  </button>
                `;
              }
            })() : ''}
            ${!comment.published ? `
              <button class="btn btn-sm btn-ghost dismiss-btn" data-id="${comment.id}" title="Dismiss">
                ${iconHtml(X, { size: 14 })}
              </button>
              <button class="btn btn-sm btn-primary publish-btn" data-id="${comment.id}">
                ${iconHtml(Send, { size: 14 })}
                Publish
              </button>
            ` : ''}
          </div>
        </div>

        ${this.canApply ? `
          <div class="apply-input-container hidden" data-comment-id="${comment.id}">
            <input type="text" class="apply-input" placeholder="Additional instructions (optional)..." />
            <button class="btn btn-sm btn-primary apply-queue-btn" data-id="${comment.id}">Queue</button>
            <button class="btn btn-sm btn-ghost apply-cancel-btn" data-id="${comment.id}">
              ${iconHtml(X, { size: 12 })}
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  private getSeverityIcon(severity: AIReviewComment['severity']): string {
    const severityIcons = {
      critical: iconHtml(AlertCircle, { size: 14 }),
      major: iconHtml(AlertTriangle, { size: 14 }),
      minor: iconHtml(Lightbulb, { size: 14 }),
      trivial: iconHtml(Lightbulb, { size: 14 }),
    };
    return severityIcons[severity];
  }

  private getStats(): Record<AIReviewComment['severity'], number> {
    const stats = { critical: 0, major: 0, minor: 0, trivial: 0 };
    for (const comment of this.comments) {
      stats[comment.severity]++;
    }
    return stats;
  }

  private getUnpublishedCount(): number {
    return this.filteredComments.filter(c => !c.published).length;
  }

  private groupByFile(comments: AIReviewComment[]): Record<string, AIReviewComment[]> {
    const grouped: Record<string, AIReviewComment[]> = {};
    for (const comment of comments) {
      if (!grouped[comment.filePath]) {
        grouped[comment.filePath] = [];
      }
      grouped[comment.filePath].push(comment);
    }

    // Sort comments within each file by line number
    for (const file of Object.keys(grouped)) {
      grouped[file].sort((a, b) => a.startLine - b.startLine);
    }

    return grouped;
  }

  private attachEventListeners(): void {
    // Close button
    this.container.querySelector('.close-ai-panel-btn')?.addEventListener('click', () => {
      document.getElementById('reviewScreen')?.classList.remove('ai-comments-open');
    });

    // Save button
    this.container.querySelector('.save-review-btn')?.addEventListener('click', async () => {
      if (this.saveCallback) {
        await this.saveCallback();
      }
    });

    // Start AI review button (in empty state)
    this.container.querySelector('.start-ai-review-btn')?.addEventListener('click', () => {
      this.newReviewCallback?.();
    });

    // Tab clicks
    this.container.querySelectorAll('.ai-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.ai-tab-close')) return;
        const id = (tab as HTMLElement).dataset.id;
        const isSaved = (tab as HTMLElement).dataset.saved === 'true';
        if (id) {
          this.setActiveTab(id);
          this.tabSelectCallback?.(id, isSaved);
        }
      });
    });

    // Tab close buttons
    this.container.querySelectorAll('.ai-tab-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id;
        const isSaved = (btn as HTMLElement).dataset.saved === 'true';
        if (id) {
          this.tabCloseCallback?.(id, isSaved);
        }
      });
    });

    // New review button
    this.container.querySelector('.ai-tab-new')?.addEventListener('click', () => {
      this.newReviewCallback?.();
    });

    // Severity filters
    this.container.querySelectorAll('.severity-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        const severity = (btn as HTMLElement).dataset.severity as AIReviewComment['severity'];
        const index = this.filter.severity.indexOf(severity);
        if (index > -1) {
          this.filter.severity.splice(index, 1);
        } else {
          this.filter.severity.push(severity);
        }
        this.applyFilter();
        this.render();
      });
    });

    // Show published toggle
    this.container.querySelector('.show-published-toggle input')?.addEventListener('change', (e) => {
      this.filter.showPublished = (e.target as HTMLInputElement).checked;
      this.applyFilter();
      this.render();
    });

    // Publish all button
    this.container.querySelector('.publish-all-btn')?.addEventListener('click', async () => {
      const unpublished = this.filteredComments.filter(c => !c.published);
      if (this.publishAllCallback && unpublished.length > 0) {
        await this.publishAllCallback(unpublished);
      }
    });

    // Individual publish buttons
    this.container.querySelectorAll('.publish-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const commentId = (btn as HTMLElement).dataset.id;
        const comment = this.comments.find(c => c.id === commentId);
        if (comment && this.publishCallback) {
          await this.publishCallback(comment);
        }
      });
    });

    // Dismiss buttons
    this.container.querySelectorAll('.dismiss-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const commentId = (btn as HTMLElement).dataset.id;
        if (commentId && this.dismissCallback) {
          this.dismissCallback(commentId);
          this.comments = this.comments.filter(c => c.id !== commentId);
          this.applyFilter();
          this.render();
        }
      });
    });

    // Navigate to code location
    this.container.querySelectorAll('.ai-comment-location').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const filePath = (el as HTMLElement).dataset.file;
        const line = parseInt((el as HTMLElement).dataset.line || '1');
        if (filePath && this.navigateCallback) {
          this.navigateCallback(filePath, line);
        }
      });
    });

    // Click on comment to navigate
    this.container.querySelectorAll('.ai-comment').forEach(el => {
      el.addEventListener('click', () => {
        const commentId = (el as HTMLElement).dataset.commentId;
        const comment = this.comments.find(c => c.id === commentId);
        if (comment && this.navigateCallback) {
          this.navigateCallback(comment.filePath, comment.startLine);
        }
      });
    });

    // Apply button click - show input
    this.container.querySelectorAll('.apply-ai-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const commentId = (btn as HTMLElement).dataset.id;
        if (commentId) {
          // Hide any other open apply inputs
          this.container.querySelectorAll('.apply-input-container').forEach(container => {
            container.classList.add('hidden');
          });
          // Show this one
          const inputContainer = this.container.querySelector(`.apply-input-container[data-comment-id="${commentId}"]`);
          if (inputContainer) {
            inputContainer.classList.remove('hidden');
            const input = inputContainer.querySelector('.apply-input') as HTMLInputElement;
            input?.focus();
          }
          this.expandedApplyCommentId = commentId;
        }
      });
    });

    // Apply queue button click - invoke callback
    this.container.querySelectorAll('.apply-input-container .apply-queue-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const commentId = (btn as HTMLElement).dataset.id;
        const comment = this.comments.find(c => c.id === commentId);
        const inputContainer = (btn as HTMLElement).closest('.apply-input-container');
        const input = inputContainer?.querySelector('.apply-input') as HTMLInputElement;
        const customMessage = input?.value || '';

        if (comment && this.applyCallback) {
          this.applyCallback(comment, customMessage);
        }

        // Hide and clear
        inputContainer?.classList.add('hidden');
        if (input) input.value = '';
        this.expandedApplyCommentId = null;
      });
    });

    // Apply cancel button click - hide and clear
    this.container.querySelectorAll('.apply-input-container .apply-cancel-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const inputContainer = (btn as HTMLElement).closest('.apply-input-container');
        const input = inputContainer?.querySelector('.apply-input') as HTMLInputElement;

        inputContainer?.classList.add('hidden');
        if (input) input.value = '';
        this.expandedApplyCommentId = null;
      });
    });

    // Apply input keydown - Enter to queue, Escape to cancel
    this.container.querySelectorAll('.apply-input-container .apply-input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        const keyEvent = e as KeyboardEvent;
        const inputEl = input as HTMLInputElement;
        const inputContainer = inputEl.closest('.apply-input-container');

        if (keyEvent.key === 'Enter') {
          e.stopPropagation();
          const queueBtn = inputContainer?.querySelector('.apply-queue-btn') as HTMLElement;
          queueBtn?.click();
        } else if (keyEvent.key === 'Escape') {
          e.stopPropagation();
          const cancelBtn = inputContainer?.querySelector('.apply-cancel-btn') as HTMLElement;
          cancelBtn?.click();
        }
      });
    });
  }
}
