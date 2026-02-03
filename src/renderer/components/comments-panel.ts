import type { CommentThread, Comment, ThreadStatus, CommentAnalysis } from '../../shared/types.js';
import { escapeHtml, formatTimeAgo, formatSimpleMarkdown } from '../utils/html-utils.js';
import { iconHtml, MessageSquare, File, X, Check, RefreshCw } from '../utils/icons.js';

export class CommentsPanel {
  private container: HTMLElement;
  private listContainer: HTMLElement;
  private threads: CommentThread[] = [];
  private fileThreads: CommentThread[] = [];
  private showAllComments: boolean = false;

  private replyCallback?: (threadId: number, content: string) => void;
  private statusCallback?: (threadId: number, status: string) => void;
  private scrollToLineCallback?: (filePath: string, line: number) => void;
  private applyCallback?: (threadId: number, content: string, filePath: string, line: number, customMessage: string) => void;
  private canApply: boolean = false;
  private expandedApplyThreadId: number | null = null;
  private applyingThreadIds: Set<number> = new Set();
  private fixedThreadIds: Set<string> = new Set();
  private analyses: Map<number, CommentAnalysis> = new Map();
  private isAnalyzing: boolean = false;
  private analyzeCallback?: (threadIds: number[]) => void;
  private reanalyzeCallback?: (threadId: number) => void;
  private applyAnalysisFixCallback?: (threadId: number, analysis: CommentAnalysis, customMessage: string) => void;
  private postAnalysisReplyCallback?: (threadId: number, content: string) => void;
  private editingReplyThreadId: number | null = null;
  private autoAnalyze: boolean = false;
  private autoFix: boolean = false;
  private knownThreadIds: Set<number> = new Set();

  constructor() {
    this.container = document.getElementById('commentsPanel')!;
    this.listContainer = document.getElementById('commentsList')!;
    this.loadAutoSettings();
  }

  private loadAutoSettings(): void {
    const savedAnalyze = localStorage.getItem('ado-comments-auto-analyze');
    this.autoAnalyze = savedAnalyze === 'true';
    const savedFix = localStorage.getItem('ado-comments-auto-fix');
    this.autoFix = savedFix === 'true';
  }

  private saveAutoAnalyzeSetting(): void {
    localStorage.setItem('ado-comments-auto-analyze', this.autoAnalyze.toString());
  }

  private saveAutoFixSetting(): void {
    localStorage.setItem('ado-comments-auto-fix', this.autoFix.toString());
  }

  isAutoAnalyzeEnabled(): boolean {
    return this.autoAnalyze;
  }

  setAutoAnalyze(enabled: boolean): void {
    this.autoAnalyze = enabled;
    this.saveAutoAnalyzeSetting();
    this.render();
  }

  isAutoFixEnabled(): boolean {
    return this.autoFix;
  }

  setAutoFix(enabled: boolean): void {
    this.autoFix = enabled;
    this.saveAutoFixSetting();
    this.render();
  }

  /**
   * Get analyses that have 'fix' recommendation and haven't been applied yet.
   */
  getFixAnalyses(): CommentAnalysis[] {
    const fixAnalyses: CommentAnalysis[] = [];
    for (const [threadId, analysis] of this.analyses.entries()) {
      if (analysis.recommendation === 'fix' &&
          !this.applyingThreadIds.has(threadId) &&
          !this.fixedThreadIds.has(threadId.toString())) {
        fixAnalyses.push(analysis);
      }
    }
    return fixAnalyses;
  }

  /**
   * Get IDs of threads that are new (not previously known).
   * Call this before setThreads to detect new threads.
   */
  getNewThreadIds(threads: CommentThread[]): number[] {
    const newIds: number[] = [];
    for (const thread of threads) {
      if (!this.knownThreadIds.has(thread.id)) {
        // Only consider active threads that haven't been analyzed or fixed
        if (thread.status === 'active' &&
            !this.analyses.has(thread.id) &&
            !this.fixedThreadIds.has(thread.id.toString())) {
          newIds.push(thread.id);
        }
      }
    }
    return newIds;
  }

  setContainer(container: HTMLElement, listContainer: HTMLElement) {
    this.container = container;
    this.listContainer = listContainer;
    this.render();
  }

  onReply(callback: (threadId: number, content: string) => void) {
    this.replyCallback = callback;
  }

  onStatusChange(callback: (threadId: number, status: string) => void) {
    this.statusCallback = callback;
  }

  onScrollToLine(callback: (filePath: string, line: number) => void) {
    this.scrollToLineCallback = callback;
  }

  onApply(callback: (threadId: number, content: string, filePath: string, line: number, customMessage: string) => void) {
    this.applyCallback = callback;
  }

  onAnalyze(callback: (threadIds: number[]) => void) {
    this.analyzeCallback = callback;
  }

  onReanalyze(callback: (threadId: number) => void) {
    this.reanalyzeCallback = callback;
  }

  onApplyAnalysisFix(callback: (threadId: number, analysis: CommentAnalysis, customMessage: string) => void) {
    this.applyAnalysisFixCallback = callback;
  }

  onPostAnalysisReply(callback: (threadId: number, content: string) => void) {
    this.postAnalysisReplyCallback = callback;
  }

  setAnalyses(analyses: CommentAnalysis[]) {
    this.analyses = new Map(analyses.map(a => [a.threadId, a]));
    this.render();
  }

  setAnalyzing(analyzing: boolean) {
    this.isAnalyzing = analyzing;
    this.render();
  }

  updateAnalysis(analysis: CommentAnalysis) {
    this.analyses.set(analysis.threadId, analysis);
    this.render();
  }

  markAnalysisPosted(threadId: number) {
    this.analyses.delete(threadId);
    this.render();
  }

  setCanApply(canApply: boolean) {
    this.canApply = canApply;
    this.render();
  }

  setApplyingThread(threadId: number, isApplying: boolean): void {
    if (isApplying) {
      this.applyingThreadIds.add(threadId);
    } else {
      this.applyingThreadIds.delete(threadId);
    }
    this.render();
  }

  setFixedThreads(fixedIds: Set<string>): void {
    this.fixedThreadIds = fixedIds;
    this.render();
  }

  markThreadFixed(threadId: number): void {
    this.fixedThreadIds.add(threadId.toString());
    this.applyingThreadIds.delete(threadId);
    this.render();
  }

  private getUnanalyzedActiveThreads(): CommentThread[] {
    const threadsToShow = this.showAllComments
      ? this.threads
      : (this.fileThreads.length > 0 ? this.fileThreads : this.threads);

    return threadsToShow.filter(t =>
      t.status === 'active' &&
      !this.analyses.has(t.id) &&
      !this.fixedThreadIds.has(t.id.toString())
    );
  }

  setShowAllComments(showAll: boolean) {
    this.showAllComments = showAll;
    this.render();
  }

  getShowAllComments(): boolean {
    return this.showAllComments;
  }

  scrollToThread(threadId: number) {
    const threadEl = this.listContainer.querySelector(`[data-thread-id="${threadId}"]`);
    if (threadEl) {
      threadEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      threadEl.classList.add('highlight');
      setTimeout(() => threadEl.classList.remove('highlight'), 2000);
    }
  }

  setThreads(threads: CommentThread[]) {
    this.fileThreads = []; // Clear file-specific threads to show all PR comments
    this.applyingThreadIds.clear();
    // Filter out deleted threads and threads with only system comments
    this.threads = threads.filter(t =>
      !t.isDeleted && t.comments.some(c => c.commentType !== 'system' && !c.isDeleted)
    );
    // Update known thread IDs for auto-analyze detection
    this.knownThreadIds = new Set(this.threads.map(t => t.id));
    this.render();
  }

  setFileThreads(threads: CommentThread[]) {
    // Filter out deleted threads and threads with only system comments
    this.fileThreads = threads.filter(t =>
      !t.isDeleted && t.comments.some(c => c.commentType !== 'system' && !c.isDeleted)
    );
    this.render();
  }

  addThread(thread: CommentThread) {
    this.threads.push(thread);
    if (thread.threadContext?.filePath) {
      this.fileThreads.push(thread);
    }
    this.render();
  }

  updateThread(thread: CommentThread) {
    const index = this.threads.findIndex(t => t.id === thread.id);
    if (index !== -1) {
      this.threads[index] = thread;
    }

    const fileIndex = this.fileThreads.findIndex(t => t.id === thread.id);
    if (fileIndex !== -1) {
      this.fileThreads[fileIndex] = thread;
    }

    this.render();
  }

  private render() {
    // Show all PR comments if toggled, otherwise show file-specific (if available)
    const threadsToShow = this.showAllComments
      ? this.threads
      : (this.fileThreads.length > 0 ? this.fileThreads : this.threads);

    if (threadsToShow.length === 0) {
      this.listContainer.innerHTML = `
        <div class="empty-state">
          ${iconHtml(MessageSquare, { size: 48, strokeWidth: 1.5 })}
          <p>No comments yet</p>
        </div>
      `;
      return;
    }

    // Sort by date, newest first
    const sorted = [...threadsToShow].sort((a, b) =>
      new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime()
    );

    this.listContainer.innerHTML = `
      <div class="comments-panel-header">
        ${this.renderAnalyzeButton()}
      </div>
      ${sorted.map(thread => this.renderThread(thread)).join('')}
    `;
    this.attachEventListeners();
  }

  private renderThread(thread: CommentThread): string {
    const userComments = thread.comments.filter(c => c.commentType !== 'system' && !c.isDeleted);
    const location = this.getThreadLocation(thread);
    const filePath = thread.threadContext?.filePath || '';
    const line = thread.threadContext?.rightFileStart?.line || thread.threadContext?.leftFileStart?.line || 0;
    const isClickable = filePath && line;

    return `
      <div class="comment-thread" data-thread-id="${thread.id}">
        <div class="thread-header ${isClickable ? 'clickable' : ''}"
             ${isClickable ? `data-file="${filePath}" data-line="${line}"` : ''}>
          <span class="thread-location">
            ${location.icon}
            ${location.text}
          </span>
          <span class="thread-status ${thread.status}">${this.formatStatus(thread.status)}</span>
          ${this.fixedThreadIds.has(thread.id.toString()) ? `
            <span class="thread-fixed-badge" title="Fixed via AI">
              ${iconHtml(Check, { size: 12 })}
              Fixed
            </span>
          ` : ''}
        </div>

        <div class="thread-comments">
          ${userComments.map(comment => this.renderComment(comment)).join('')}
        </div>

        <div class="thread-actions">
          <select class="status-select" data-thread-id="${thread.id}">
            <option value="active" ${thread.status === 'active' ? 'selected' : ''}>Active</option>
            <option value="fixed" ${thread.status === 'fixed' ? 'selected' : ''}>Resolved</option>
            <option value="wontFix" ${thread.status === 'wontFix' ? 'selected' : ''}>Won't fix</option>
            <option value="closed" ${thread.status === 'closed' ? 'selected' : ''}>Closed</option>
            <option value="pending" ${thread.status === 'pending' ? 'selected' : ''}>Pending</option>
          </select>
          <button class="btn btn-sm btn-ghost reply-toggle" data-thread-id="${thread.id}">Reply</button>
          ${this.canApply && thread.threadContext?.filePath ? (() => {
            const isApplying = this.applyingThreadIds.has(thread.id);
            const isFixed = this.fixedThreadIds.has(thread.id.toString());
            if (isFixed) {
              return `
                <button class="btn btn-sm btn-ghost apply-btn fixed" data-thread-id="${thread.id}" disabled>
                  Fixed
                </button>
              `;
            } else if (isApplying) {
              return `
                <button class="btn btn-sm btn-ghost apply-btn applying" data-thread-id="${thread.id}" disabled>
                  Applying...
                </button>
              `;
            } else {
              return `
                <button class="btn btn-sm btn-ghost apply-btn" data-thread-id="${thread.id}">Apply</button>
              `;
            }
          })() : ''}
        </div>

        ${this.renderAnalysis(thread.id)}

        ${this.canApply && thread.threadContext?.filePath ? `
          <div class="apply-input-container hidden" data-thread-id="${thread.id}">
            <input type="text" class="apply-input" placeholder="Additional instructions (optional)..." />
            <button class="btn btn-sm btn-primary apply-queue-btn" data-thread-id="${thread.id}">Queue</button>
            <button class="btn btn-sm btn-ghost apply-cancel-btn" data-thread-id="${thread.id}">
              ${iconHtml(X, { size: 12 })}
            </button>
          </div>
        ` : ''}

        <div class="thread-reply-form hidden" data-thread-id="${thread.id}">
          <textarea placeholder="Write a reply..." rows="3"></textarea>
          <div class="thread-reply-actions">
            <button class="btn btn-sm btn-secondary cancel-reply" data-thread-id="${thread.id}">Cancel</button>
            <button class="btn btn-sm btn-primary submit-reply" data-thread-id="${thread.id}">Reply</button>
          </div>
        </div>
      </div>
    `;
  }

  private renderComment(comment: Comment): string {
    const date = new Date(comment.publishedDate);
    const timeAgo = formatTimeAgo(date);
    const initials = this.getInitials(comment.author.displayName);
    const hasImage = comment.author.imageUrl && comment.author.imageUrl.trim();

    const avatarHtml = hasImage
      ? `<img class="comment-avatar" src="${comment.author.imageUrl}" alt="${initials}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="comment-avatar-placeholder" style="display:none">${initials}</span>`
      : `<span class="comment-avatar-placeholder">${initials}</span>`;

    return `
      <div class="comment">
        <div class="comment-header">
          ${avatarHtml}
          <span class="comment-author">${comment.author.displayName}</span>
          <span class="comment-time" title="${date.toLocaleString()}">${timeAgo}</span>
        </div>
        <div class="comment-content">${formatSimpleMarkdown(comment.content, { includeItalic: true })}</div>
      </div>
    `;
  }

  private getInitials(name: string): string {
    const parts = name.split(/[\s\\]+/).filter(p => p.length > 0);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  private getThreadLocation(thread: CommentThread): { icon: string; text: string } {
    if (!thread.threadContext?.filePath) {
      return {
        icon: iconHtml(MessageSquare, { size: 14 }),
        text: 'General',
      };
    }

    const fileName = thread.threadContext.filePath.split('/').pop() || thread.threadContext.filePath;
    const rightStart = thread.threadContext.rightFileStart;
    const rightEnd = thread.threadContext.rightFileEnd;

    let lineInfo = '';
    if (rightStart) {
      lineInfo = rightEnd && rightEnd.line !== rightStart.line
        ? `:${rightStart.line}-${rightEnd.line}`
        : `:${rightStart.line}`;
    }

    return {
      icon: iconHtml(File, { size: 14 }),
      text: `${fileName}${lineInfo}`,
    };
  }

  private formatStatus(status: ThreadStatus): string {
    const statusMap: Record<string, string> = {
      active: 'Active',
      fixed: 'Resolved',
      wontFix: "Won't Fix",
      closed: 'Closed',
      byDesign: 'By Design',
      pending: 'Pending',
      unknown: 'Unknown',
    };
    return statusMap[status] || status;
  }

  private renderAnalyzeButton(): string {
    const unanalyzed = this.getUnanalyzedActiveThreads();
    const count = unanalyzed.length;

    const autoAnalyzeToggle = `
      <label class="auto-analyze-toggle" title="Auto-analyze new comments">
        <input type="checkbox" class="auto-analyze-checkbox" ${this.autoAnalyze ? 'checked' : ''} />
        <span class="auto-analyze-label">Auto</span>
      </label>
    `;

    const autoFixToggle = `
      <label class="auto-analyze-toggle" title="Auto-fix comments with 'fix' recommendation">
        <input type="checkbox" class="auto-fix-checkbox" ${this.autoFix ? 'checked' : ''} />
        <span class="auto-analyze-label">Auto Fix</span>
      </label>
    `;

    if (this.isAnalyzing) {
      return `
        ${autoAnalyzeToggle}
        ${autoFixToggle}
        <button class="btn btn-sm btn-primary analyze-btn analyzing" disabled>
          <span class="spinner"></span>
          Analyzing...
        </button>
      `;
    }

    return `
      ${autoAnalyzeToggle}
      ${autoFixToggle}
      <button class="btn btn-sm btn-primary analyze-btn" ${count === 0 ? 'disabled' : ''}>
        Analyze${count > 0 ? ` <span class="analyze-count">${count}</span>` : ''}
      </button>
    `;
  }

  private renderAnalysis(threadId: number): string {
    const analysis = this.analyses.get(threadId);
    if (!analysis) return '';

    const isEditing = this.editingReplyThreadId === threadId;
    const recommendationLabel = {
      fix: 'FIX',
      reply: 'REPLY',
      clarify: 'CLARIFY',
    }[analysis.recommendation];

    const icon = {
      fix: '💡',
      reply: '💬',
      clarify: '❓',
    }[analysis.recommendation];

    let content = '';

    if (analysis.recommendation === 'fix') {
      content = `
        <div class="analysis-fix-description">${analysis.fixDescription || ''}</div>
        ${analysis.suggestedCode ? `
          <div class="analysis-suggested-code">${escapeHtml(analysis.suggestedCode)}</div>
        ` : ''}
        <div class="analysis-fix-actions">
          <input type="text" class="analysis-fix-input" placeholder="Additional instructions (optional)..." data-thread-id="${threadId}" />
          <button class="btn btn-sm btn-primary analysis-apply-fix-btn" data-thread-id="${threadId}">Apply Fix</button>
        </div>
      `;
    } else {
      // reply or clarify
      content = `
        <div class="analysis-message-container">
          <textarea class="analysis-message" data-thread-id="${threadId}" ${isEditing ? '' : 'readonly'}>${analysis.suggestedMessage || ''}</textarea>
          <div class="analysis-message-actions">
            ${isEditing ? `
              <button class="btn btn-sm btn-ghost analysis-cancel-edit-btn" data-thread-id="${threadId}">Cancel</button>
              <button class="btn btn-sm btn-primary analysis-post-btn" data-thread-id="${threadId}">Post to ADO</button>
            ` : `
              <button class="btn btn-sm btn-ghost analysis-edit-btn" data-thread-id="${threadId}">Edit</button>
              <button class="btn btn-sm btn-primary analysis-post-btn" data-thread-id="${threadId}">Post to ADO</button>
            `}
          </div>
        </div>
      `;
    }

    return `
      <div class="comment-analysis ${analysis.recommendation}" data-thread-id="${threadId}">
        <div class="analysis-header">
          <span class="analysis-recommendation ${analysis.recommendation}">
            ${icon} Recommendation: ${recommendationLabel}
          </span>
          <button class="analysis-refresh-btn" data-thread-id="${threadId}" title="Re-analyze">
            ${iconHtml(RefreshCw, { size: 14 })}
          </button>
        </div>
        <div class="analysis-reasoning">${analysis.reasoning}</div>
        ${content}
      </div>
    `;
  }

  private attachEventListeners() {
    // Thread header click - scroll to code
    this.listContainer.querySelectorAll('.thread-header.clickable').forEach(header => {
      header.addEventListener('click', (e) => {
        const filePath = (header as HTMLElement).dataset.file;
        const line = parseInt((header as HTMLElement).dataset.line || '0');
        if (filePath && line && this.scrollToLineCallback) {
          this.scrollToLineCallback(filePath, line);
        }
      });
    });

    // Reply toggles
    this.listContainer.querySelectorAll('.reply-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const threadId = (e.currentTarget as HTMLElement).dataset.threadId;
        const form = this.listContainer.querySelector(`.thread-reply-form[data-thread-id="${threadId}"]`);
        form?.classList.toggle('hidden');
        form?.querySelector('textarea')?.focus();
      });
    });

    // Cancel reply
    this.listContainer.querySelectorAll('.cancel-reply').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const threadId = (e.currentTarget as HTMLElement).dataset.threadId;
        const form = this.listContainer.querySelector(`.thread-reply-form[data-thread-id="${threadId}"]`);
        form?.classList.add('hidden');
        const textarea = form?.querySelector('textarea');
        if (textarea) textarea.value = '';
      });
    });

    // Submit reply
    this.listContainer.querySelectorAll('.submit-reply').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const threadId = parseInt((e.currentTarget as HTMLElement).dataset.threadId || '0');
        const form = this.listContainer.querySelector(`.thread-reply-form[data-thread-id="${threadId}"]`);
        const textarea = form?.querySelector('textarea') as HTMLTextAreaElement;
        const content = textarea?.value.trim();

        if (content && this.replyCallback) {
          this.replyCallback(threadId, content);
          textarea.value = '';
          form?.classList.add('hidden');
        }
      });
    });

    // Status change
    this.listContainer.querySelectorAll('.status-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const threadId = parseInt((e.target as HTMLSelectElement).dataset.threadId || '0');
        const status = (e.target as HTMLSelectElement).value;

        if (this.statusCallback) {
          this.statusCallback(threadId, status);
        }
      });
    });

    // Ctrl+Enter to submit reply
    this.listContainer.querySelectorAll('.thread-reply-form textarea').forEach(textarea => {
      textarea.addEventListener('keydown', (e: Event) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Enter' && (ke.ctrlKey || ke.metaKey)) {
          e.preventDefault();
          const form = (e.target as HTMLElement).closest('.thread-reply-form');
          const submitBtn = form?.querySelector('.submit-reply') as HTMLButtonElement;
          submitBtn?.click();
        }
      });
    });

    // Apply button click - show input
    this.listContainer.querySelectorAll('.apply-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const threadId = (e.currentTarget as HTMLElement).dataset.threadId;
        const container = this.listContainer.querySelector(`.apply-input-container[data-thread-id="${threadId}"]`);
        container?.classList.remove('hidden');
        container?.querySelector('input')?.focus();
      });
    });

    // Apply queue button - invoke callback with thread data
    this.listContainer.querySelectorAll('.apply-queue-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const threadId = parseInt((e.currentTarget as HTMLElement).dataset.threadId || '0');
        const thread = this.threads.find(t => t.id === threadId) || this.fileThreads.find(t => t.id === threadId);
        if (!thread) return;

        const container = this.listContainer.querySelector(`.apply-input-container[data-thread-id="${threadId}"]`);
        const input = container?.querySelector('input') as HTMLInputElement;
        const customMessage = input?.value.trim() || '';

        const filePath = thread.threadContext?.filePath || '';
        const line = thread.threadContext?.rightFileStart?.line || thread.threadContext?.leftFileStart?.line || 0;
        const userComments = thread.comments.filter(c => c.commentType !== 'system' && !c.isDeleted);
        const content = userComments.map(c => c.content).join('\n\n');

        if (this.applyCallback && filePath) {
          this.applyCallback(threadId, content, filePath, line, customMessage);
          if (input) input.value = '';
          container?.classList.add('hidden');
        }
      });
    });

    // Apply cancel button - hide input
    this.listContainer.querySelectorAll('.apply-cancel-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const threadId = (e.currentTarget as HTMLElement).dataset.threadId;
        const container = this.listContainer.querySelector(`.apply-input-container[data-thread-id="${threadId}"]`);
        const input = container?.querySelector('input') as HTMLInputElement;
        if (input) input.value = '';
        container?.classList.add('hidden');
      });
    });

    // Apply input keydown - Enter to queue, Escape to cancel
    this.listContainer.querySelectorAll('.apply-input').forEach(input => {
      input.addEventListener('keydown', (e: Event) => {
        const ke = e as KeyboardEvent;
        const container = (e.target as HTMLElement).closest('.apply-input-container');
        if (ke.key === 'Enter') {
          e.preventDefault();
          const queueBtn = container?.querySelector('.apply-queue-btn') as HTMLButtonElement;
          queueBtn?.click();
        } else if (ke.key === 'Escape') {
          e.preventDefault();
          const cancelBtn = container?.querySelector('.apply-cancel-btn') as HTMLButtonElement;
          cancelBtn?.click();
        }
      });
    });

    // Analyze button click
    this.listContainer.querySelectorAll('.analyze-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const unanalyzed = this.getUnanalyzedActiveThreads();
        const threadIds = unanalyzed.map(t => t.id);
        if (threadIds.length > 0 && this.analyzeCallback) {
          this.analyzeCallback(threadIds);
        }
      });
    });

    // Auto-analyze toggle
    this.listContainer.querySelectorAll('.auto-analyze-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const checked = (e.target as HTMLInputElement).checked;
        this.setAutoAnalyze(checked);
      });
    });

    // Auto-fix toggle
    this.listContainer.querySelectorAll('.auto-fix-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const checked = (e.target as HTMLInputElement).checked;
        this.setAutoFix(checked);
      });
    });

    // Analysis refresh button - re-analyze single thread
    this.listContainer.querySelectorAll('.analysis-refresh-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const threadId = parseInt((e.currentTarget as HTMLElement).dataset.threadId || '0');
        if (threadId && this.reanalyzeCallback) {
          this.reanalyzeCallback(threadId);
        }
      });
    });

    // Analysis apply fix button
    this.listContainer.querySelectorAll('.analysis-apply-fix-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const threadId = parseInt((e.currentTarget as HTMLElement).dataset.threadId || '0');
        const analysis = this.analyses.get(threadId);
        if (!analysis) return;

        const container = this.listContainer.querySelector(`.comment-analysis[data-thread-id="${threadId}"]`);
        const input = container?.querySelector('.analysis-fix-input') as HTMLInputElement;
        const customMessage = input?.value.trim() || '';

        if (this.applyAnalysisFixCallback) {
          this.applyAnalysisFixCallback(threadId, analysis, customMessage);
        }
      });
    });

    // Analysis edit button - enable editing
    this.listContainer.querySelectorAll('.analysis-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const threadId = parseInt((e.currentTarget as HTMLElement).dataset.threadId || '0');
        this.editingReplyThreadId = threadId;
        this.render();
      });
    });

    // Analysis cancel edit button
    this.listContainer.querySelectorAll('.analysis-cancel-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.editingReplyThreadId = null;
        this.render();
      });
    });

    // Analysis post button - post reply to ADO
    this.listContainer.querySelectorAll('.analysis-post-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const threadId = parseInt((e.currentTarget as HTMLElement).dataset.threadId || '0');
        const container = this.listContainer.querySelector(`.comment-analysis[data-thread-id="${threadId}"]`);
        const textarea = container?.querySelector('.analysis-message') as HTMLTextAreaElement;
        const content = textarea?.value.trim();

        if (content && this.postAnalysisReplyCallback) {
          this.postAnalysisReplyCallback(threadId, content);
        }
      });
    });
  }
}
