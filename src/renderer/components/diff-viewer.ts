import { diffLines } from 'diff';
import hljs from 'highlight.js';
import type { FileChange, CommentThread } from '../../shared/types.js';
import type { AIReviewComment } from '../../shared/ai-types.js';
import { escapeHtml } from '../utils/html-utils.js';
import { renderMarkdownToElement } from '../utils/markdown-renderer.js';
import {
  iconHtml,
  Plus,
  Edit,
  Trash2,
  Upload,
  File,
  FilePlus,
  MessageSquare,
  Bot,
  Minus,
} from '../utils/icons.js';

interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk';
  oldLineNum?: number;
  newLineNum?: number;
  content: string;
  threads?: CommentThread[];
}

export class DiffViewer {
  private container: HTMLElement;
  private lines: DiffLine[] = [];
  private currentFile: FileChange | null = null;
  private commentCallback?: (filePath: string, startLine: number, endLine: number, content: string) => void;
  private commentBadgeClickCallback?: (threadIds: number[]) => void;
  private aiCommentClickCallback?: (comment: AIReviewComment) => void;
  private activeCommentBox: HTMLElement | null = null;
  private aiComments: AIReviewComment[] = [];

  // Line selection state
  private isSelecting = false;
  private selectionStartLine: number | null = null;
  private selectionEndLine: number | null = null;
  private selectionAnchorElement: HTMLElement | null = null;

  constructor() {
    this.container = document.getElementById('diffContainer')!;
    this.initGlobalListeners();
  }

  setContainer(container: HTMLElement) {
    this.container = container;
  }

  private initGlobalListeners() {
    // Global mouse move to track selection
    document.addEventListener('mousemove', (e) => {
      if (!this.isSelecting) return;

      // Find the diff line under the cursor
      const element = document.elementFromPoint(e.clientX, e.clientY);
      const lineEl = element?.closest('.diff-line[data-line]') as HTMLElement | null;

      if (lineEl) {
        const lineNum = parseInt(lineEl.dataset.line || '0');
        if (lineNum > 0) {
          this.extendLineSelection(lineNum);
        }
      }
    });

    // Global mouse up to end selection
    document.addEventListener('mouseup', () => {
      if (this.isSelecting) {
        this.isSelecting = false;
        if (this.selectionStartLine !== null && this.selectionEndLine !== null) {
          this.showSelectionActions();
        }
      }
    });

    // Click outside to clear selection
    document.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;
      // Don't clear if clicking on gutter (starts new selection), selection actions, or comment box
      if (!target.closest('.diff-gutter') &&
          !target.closest('.diff-selection-actions') &&
          !target.closest('.diff-inline-comment')) {
        this.clearSelection();
      }
    });
  }

  onAddComment(callback: (filePath: string, startLine: number, endLine: number, content: string) => void) {
    this.commentCallback = callback;
  }

  onCommentBadgeClick(callback: (threadIds: number[]) => void) {
    this.commentBadgeClickCallback = callback;
  }

  scrollToLine(line: number) {
    // In split view, prefer the "new" pane (right side) since that shows the modified file
    // In unified view, there's only one pane
    const newPane = this.container.querySelector('#diffPaneNew') as HTMLElement | null;
    const oldPane = this.container.querySelector('#diffPaneOld') as HTMLElement | null;
    let lineEl: Element | null = null;
    let scrollContainer: HTMLElement | null = null;

    // Determine if we're in split view
    const isSplitView = newPane !== null && oldPane !== null;

    if (isSplitView) {
      // Split view - try new pane first, then old pane
      lineEl = newPane.querySelector(`[data-line="${line}"]`);
      if (lineEl) {
        scrollContainer = newPane;
      } else {
        lineEl = oldPane.querySelector(`[data-line="${line}"]`);
        if (lineEl) {
          scrollContainer = oldPane;
        }
      }
    } else {
      // Unified view
      lineEl = this.container.querySelector(`[data-line="${line}"]`);
      scrollContainer = this.container.querySelector('.diff-unified') as HTMLElement | null;
    }

    if (lineEl && scrollContainer) {
      // Use getBoundingClientRect to get reliable positions
      const lineRect = lineEl.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();

      // Line's position within the scrollable content
      const linePositionInContent = (lineRect.top - containerRect.top) + scrollContainer.scrollTop;

      // Target scroll position to center the line
      const targetScroll = Math.max(0, linePositionInContent - (scrollContainer.clientHeight / 2) + (lineRect.height / 2));

      if (isSplitView) {
        // In split view, set both panes directly to avoid scroll sync interference
        // Use direct scrollTop for immediate positioning, then sync will keep them aligned
        newPane!.scrollTop = targetScroll;
        oldPane!.scrollTop = targetScroll;
      } else {
        // Unified view - use smooth scrolling
        scrollContainer.scrollTo({
          top: targetScroll,
          behavior: 'smooth'
        });
      }

      // Add highlight effect
      lineEl.classList.add('highlight');
      setTimeout(() => lineEl.classList.remove('highlight'), 2000);
    } else if (lineEl) {
      // Fallback to scrollIntoView
      lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      lineEl.classList.add('highlight');
      setTimeout(() => lineEl.classList.remove('highlight'), 2000);
    }
  }

  render(file: FileChange, mode: 'split' | 'unified' | 'preview') {
    this.currentFile = file;
    this.cancelComment();
    this.clearSelection();

    if (mode === 'preview') {
      this.renderPreview(file);
      return;
    }

    if (!file.originalContent && !file.modifiedContent) {
      this.renderBinaryOrEmpty(file);
      return;
    }

    const original = file.originalContent || '';
    const modified = file.modifiedContent || '';

    this.lines = this.computeDiff(original, modified);
    this.attachThreadsToLines(file.threads);

    if (mode === 'split') {
      this.renderSplitView(file);
    } else {
      this.renderUnifiedView(file);
    }

    this.highlightSyntax(file.path);
    this.attachEventListeners();
  }

  /**
   * Show loading indicator while file content is being fetched.
   */
  showLoading(filePath?: string): void {
    this.container.innerHTML = `
      <div class="diff-loading">
        <div class="loading-spinner"></div>
        <span>Loading ${filePath ? `"${filePath}"` : 'file'}...</span>
      </div>
    `;
  }

  /**
   * Show error message when file loading fails.
   */
  showError(message: string): void {
    this.container.innerHTML = `
      <div class="diff-error">
        <span class="error-icon">&#9888;</span>
        <span>${escapeHtml(message)}</span>
      </div>
    `;
  }

  private computeDiff(original: string, modified: string): DiffLine[] {
    const changes = diffLines(original, modified);
    const lines: DiffLine[] = [];

    let oldLineNum = 1;
    let newLineNum = 1;

    for (const change of changes) {
      const changeLines = change.value.split('\n');

      // Remove last empty line from split
      if (changeLines[changeLines.length - 1] === '') {
        changeLines.pop();
      }

      for (const line of changeLines) {
        if (change.added) {
          lines.push({
            type: 'add',
            newLineNum: newLineNum++,
            content: line,
          });
        } else if (change.removed) {
          lines.push({
            type: 'del',
            oldLineNum: oldLineNum++,
            content: line,
          });
        } else {
          lines.push({
            type: 'ctx',
            oldLineNum: oldLineNum++,
            newLineNum: newLineNum++,
            content: line,
          });
        }
      }
    }

    return lines;
  }

  private attachThreadsToLines(threads: CommentThread[]) {
    for (const thread of threads) {
      if (!thread.threadContext) continue;

      const rightStart = thread.threadContext.rightFileStart;
      if (rightStart) {
        const line = this.lines.find(l =>
          l.newLineNum === rightStart.line ||
          (l.type === 'del' && l.oldLineNum === rightStart.line)
        );
        if (line) {
          if (!line.threads) line.threads = [];
          line.threads.push(thread);
        }
      }
    }
  }

  private getChangeIcon(changeType: string): string {
    const changeIcons: Record<string, string> = {
      add: iconHtml(Plus, { size: 14 }),
      edit: iconHtml(Edit, { size: 14 }),
      delete: iconHtml(Trash2, { size: 14 }),
      rename: iconHtml(Upload, { size: 14 }),
    };
    return changeIcons[changeType] || changeIcons.edit;
  }

  private formatPath(path: string): string {
    if (!path) return '<span class="filename">(unknown)</span>';
    const parts = path.split('/');
    const filename = parts.pop() || '';
    const folder = parts.join('/');

    if (folder) {
      return `<span class="folder">${folder}/</span><span class="filename">${filename}</span>`;
    }
    return `<span class="filename">${filename}</span>`;
  }

  private renderSplitView(file: FileChange) {
    const stats = this.getStats();

    this.container.innerHTML = `
      <div class="diff-file">
        <div class="diff-file-header">
          <div class="diff-file-icon ${file.changeType}">
            ${this.getChangeIcon(file.changeType)}
          </div>
          <div class="diff-file-path">${this.formatPath(file.path)}</div>
          <div class="diff-file-stats">
            <span class="diff-stat add">+${stats.additions}</span>
            <span class="diff-stat del">−${stats.deletions}</span>
          </div>
        </div>
        <div class="diff-content-wrapper">
          <div class="diff-split show-headers">
            <div class="diff-pane">
              <div class="diff-pane-header original">Original</div>
              <div class="diff-pane-content" id="diffPaneOld">
                <div class="diff-lines"></div>
              </div>
            </div>
            <div class="diff-pane">
              <div class="diff-pane-header modified">Modified</div>
              <div class="diff-pane-content" id="diffPaneNew">
                <div class="diff-lines"></div>
              </div>
            </div>
          </div>
          <div class="diff-minimap" id="diffMinimap">
            <div class="minimap-content"></div>
            <div class="minimap-viewport"></div>
          </div>
        </div>
      </div>
    `;

    const oldContainer = this.container.querySelector('#diffPaneOld .diff-lines')!;
    const newContainer = this.container.querySelector('#diffPaneNew .diff-lines')!;

    const paired = this.pairLinesForSplit();

    for (const pair of paired) {
      oldContainer.appendChild(this.createSplitLineElement(pair.old, 'old'));
      newContainer.appendChild(this.createSplitLineElement(pair.new, 'new'));
    }

    // Sync scroll
    const oldPane = this.container.querySelector('#diffPaneOld')!;
    const newPane = this.container.querySelector('#diffPaneNew')!;
    this.syncScroll(oldPane, newPane);

    // Render minimap
    this.renderMinimap(newPane as HTMLElement);
  }

  private renderUnifiedView(file: FileChange) {
    const stats = this.getStats();

    this.container.innerHTML = `
      <div class="diff-file">
        <div class="diff-file-header">
          <div class="diff-file-icon ${file.changeType}">
            ${this.getChangeIcon(file.changeType)}
          </div>
          <div class="diff-file-path">${this.formatPath(file.path)}</div>
          <div class="diff-file-stats">
            <span class="diff-stat add">+${stats.additions}</span>
            <span class="diff-stat del">−${stats.deletions}</span>
          </div>
        </div>
        <div class="diff-content-wrapper">
          <div class="diff-unified">
            <div class="diff-lines"></div>
          </div>
          <div class="diff-minimap" id="diffMinimap">
            <div class="minimap-content"></div>
            <div class="minimap-viewport"></div>
          </div>
        </div>
      </div>
    `;

    const container = this.container.querySelector('.diff-unified .diff-lines')!;

    for (const line of this.lines) {
      container.appendChild(this.createUnifiedLineElement(line));
    }

    // Render minimap
    const scrollPane = this.container.querySelector('.diff-unified') as HTMLElement;
    this.renderMinimap(scrollPane);
  }

  private pairLinesForSplit(): { old?: DiffLine; new?: DiffLine }[] {
    const pairs: { old?: DiffLine; new?: DiffLine }[] = [];
    let i = 0;

    while (i < this.lines.length) {
      const line = this.lines[i];

      if (line.type === 'ctx') {
        pairs.push({ old: line, new: line });
        i++;
      } else if (line.type === 'del') {
        const removes: DiffLine[] = [];
        while (i < this.lines.length && this.lines[i].type === 'del') {
          removes.push(this.lines[i]);
          i++;
        }

        const adds: DiffLine[] = [];
        while (i < this.lines.length && this.lines[i].type === 'add') {
          adds.push(this.lines[i]);
          i++;
        }

        const maxLen = Math.max(removes.length, adds.length);
        for (let j = 0; j < maxLen; j++) {
          pairs.push({
            old: removes[j],
            new: adds[j],
          });
        }
      } else if (line.type === 'add') {
        pairs.push({ new: line });
        i++;
      } else {
        i++;
      }
    }

    return pairs;
  }

  private createSplitLineElement(line: DiffLine | undefined, side: 'old' | 'new'): HTMLElement {
    const el = document.createElement('div');

    if (!line) {
      el.className = 'diff-line empty';
      el.innerHTML = `
        <div class="diff-gutter">
          <div class="diff-gutter-inner">
            <span class="diff-line-num"></span>
            <span class="diff-line-marker"></span>
          </div>
        </div>
        <div class="diff-content"><span class="diff-content-inner"></span></div>
      `;
      return el;
    }

    el.className = `diff-line ${line.type}`;

    if (line.threads?.length) {
      el.classList.add('has-comment');
    }

    const lineNum = side === 'old' ? line.oldLineNum : line.newLineNum;

    el.innerHTML = `
      <div class="diff-gutter">
        <div class="diff-gutter-inner">
          <span class="diff-line-num">${lineNum || ''}</span>
          <span class="diff-line-marker"></span>
        </div>
      </div>
      <div class="diff-content">
        <span class="diff-content-inner"><code>${escapeHtml(line.content)}</code></span>
        ${line.threads?.length ? `<span class="diff-comment-badge" data-line="${lineNum}" data-thread-ids="${line.threads.map(t => t.id).join(',')}">${line.threads.length}</span>` : ''}
      </div>
    `;

    if (lineNum) {
      el.dataset.line = lineNum.toString();
      el.addEventListener('dblclick', () => this.showCommentBox(lineNum, lineNum, el));
      // Attach gutter handlers for line selection (only on the new/modified side)
      if (side === 'new') {
        this.attachGutterHandlers(el, lineNum);
      }
    }

    return el;
  }

  private createUnifiedLineElement(line: DiffLine): HTMLElement {
    const el = document.createElement('div');
    el.className = `diff-line ${line.type}`;

    if (line.threads?.length) {
      el.classList.add('has-comment');
    }

    el.innerHTML = `
      <div class="diff-gutter">
        <div class="diff-gutter-inner">
          <span class="diff-line-num">${line.oldLineNum || ''}</span>
          <span class="diff-line-num">${line.newLineNum || ''}</span>
          <span class="diff-line-marker"></span>
        </div>
      </div>
      <div class="diff-content">
        <span class="diff-content-inner"><code>${escapeHtml(line.content)}</code></span>
        ${line.threads?.length ? `<span class="diff-comment-badge" data-line="${line.newLineNum || line.oldLineNum}" data-thread-ids="${line.threads.map(t => t.id).join(',')}">${line.threads.length}</span>` : ''}
      </div>
    `;

    const lineNum = line.newLineNum || line.oldLineNum;
    if (lineNum) {
      el.dataset.line = lineNum.toString();
      el.addEventListener('dblclick', () => this.showCommentBox(lineNum, lineNum, el));
      // Attach gutter handlers for line selection
      this.attachGutterHandlers(el, lineNum);
    }

    return el;
  }

  private showCommentBox(startLine: number, endLine: number, afterElement: HTMLElement) {
    this.cancelComment();

    // Show which lines are being commented on
    const lineRange = startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}-${endLine}`;

    const box = document.createElement('div');
    box.className = 'diff-inline-comment';
    box.innerHTML = `
      <div class="diff-inline-comment-header">
        <span class="diff-inline-comment-lines">${lineRange}</span>
      </div>
      <textarea placeholder="Write a comment... (Ctrl+Enter to submit)" autofocus></textarea>
      <div class="diff-inline-comment-actions">
        <button class="btn btn-secondary">Cancel</button>
        <button class="btn btn-primary">Comment</button>
      </div>
    `;

    const textarea = box.querySelector('textarea')!;
    const [cancelBtn, submitBtn] = box.querySelectorAll('button');

    cancelBtn.addEventListener('click', () => {
      this.cancelComment();
      this.clearSelection();
    });

    submitBtn.addEventListener('click', () => {
      const content = textarea.value.trim();
      if (content && this.currentFile && this.commentCallback) {
        this.commentCallback(this.currentFile.path, startLine, endLine, content);
        this.cancelComment();
        this.clearSelection();
      }
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submitBtn.click();
      }
      if (e.key === 'Escape') {
        this.cancelComment();
        this.clearSelection();
      }
    });

    afterElement.after(box);
    this.activeCommentBox = box;
    textarea.focus();
  }

  cancelComment() {
    if (this.activeCommentBox) {
      this.activeCommentBox.remove();
      this.activeCommentBox = null;
    }
  }

  private clearSelection() {
    this.selectionStartLine = null;
    this.selectionEndLine = null;
    this.selectionAnchorElement = null;
    this.container?.querySelectorAll('.diff-line.selected').forEach(el => {
      el.classList.remove('selected');
    });
    this.removeSelectionActions();
  }

  private removeSelectionActions() {
    this.container?.querySelectorAll('.diff-selection-actions').forEach(el => el.remove());
  }

  private startLineSelection(lineNum: number, lineElement: HTMLElement) {
    this.clearSelection();
    this.isSelecting = true;
    this.selectionStartLine = lineNum;
    this.selectionEndLine = lineNum;
    this.selectionAnchorElement = lineElement;
    this.updateSelectionHighlight();
  }

  private extendLineSelection(lineNum: number) {
    if (!this.isSelecting || this.selectionStartLine === null) return;
    this.selectionEndLine = lineNum;
    this.updateSelectionHighlight();
  }

  private updateSelectionHighlight() {
    if (this.selectionStartLine === null || this.selectionEndLine === null) return;

    const minLine = Math.min(this.selectionStartLine, this.selectionEndLine);
    const maxLine = Math.max(this.selectionStartLine, this.selectionEndLine);

    // Clear previous selection
    this.container.querySelectorAll('.diff-line.selected').forEach(el => {
      el.classList.remove('selected');
    });

    // Highlight new selection
    this.container.querySelectorAll('.diff-line[data-line]').forEach(el => {
      const lineNum = parseInt((el as HTMLElement).dataset.line || '0');
      if (lineNum >= minLine && lineNum <= maxLine) {
        el.classList.add('selected');
      }
    });
  }

  private showSelectionActions() {
    if (this.selectionStartLine === null || this.selectionEndLine === null) return;

    this.removeSelectionActions();

    const minLine = Math.min(this.selectionStartLine, this.selectionEndLine);
    const maxLine = Math.max(this.selectionStartLine, this.selectionEndLine);

    // Find the first selected line element to position the button
    const firstSelectedLine = this.container.querySelector('.diff-line.selected') as HTMLElement;
    if (!firstSelectedLine) return;

    // Find the last selected line for showing the comment box
    const selectedLines = this.container.querySelectorAll('.diff-line.selected');
    const lastSelectedLine = selectedLines[selectedLines.length - 1] as HTMLElement;

    // Create floating action button
    const actionsEl = document.createElement('div');
    actionsEl.className = 'diff-selection-actions';

    const lineCount = maxLine - minLine + 1;
    const lineLabel = lineCount === 1 ? `Line ${minLine}` : `Lines ${minLine}-${maxLine}`;

    actionsEl.innerHTML = `
      <button class="diff-add-comment-btn" title="Add comment on ${lineLabel}">
        ${iconHtml(MessageSquare, { size: 16 })}
        <span class="diff-add-comment-label">${lineLabel}</span>
      </button>
    `;

    const addCommentBtn = actionsEl.querySelector('.diff-add-comment-btn')!;

    // Prevent mousedown from triggering gutter selection
    addCommentBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });

    addCommentBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.showCommentBox(minLine, maxLine, lastSelectedLine);
      this.removeSelectionActions();
    });

    // Position the button relative to the first selected line
    const gutter = firstSelectedLine.querySelector('.diff-gutter');
    if (gutter) {
      gutter.appendChild(actionsEl);
    }
  }

  private attachGutterHandlers(lineElement: HTMLElement, lineNum: number) {
    const gutter = lineElement.querySelector('.diff-gutter') as HTMLElement;
    if (!gutter) return;

    // Mark gutter as selectable
    gutter.classList.add('selectable');

    gutter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.startLineSelection(lineNum, lineElement);
    });
  }

  addCommentMarker(thread: CommentThread) {
    if (!thread.threadContext) return;

    const line = thread.threadContext.rightFileStart?.line;
    if (!line) return;

    const lineEl = this.container.querySelector(`[data-line="${line}"]`);
    if (lineEl) {
      lineEl.classList.add('has-comment');

      let badge = lineEl.querySelector('.diff-comment-badge');
      if (badge) {
        const count = parseInt(badge.textContent || '0') + 1;
        badge.textContent = count.toString();
      } else {
        const content = lineEl.querySelector('.diff-content');
        if (content) {
          const newBadge = document.createElement('span');
          newBadge.className = 'diff-comment-badge';
          newBadge.dataset.line = line.toString();
          newBadge.textContent = '1';
          content.appendChild(newBadge);
        }
      }
    }
  }

  // AI Comment methods
  onAICommentClick(callback: (comment: AIReviewComment) => void) {
    this.aiCommentClickCallback = callback;
  }

  setAIComments(comments: AIReviewComment[]) {
    this.aiComments = comments;
    this.renderAICommentMarkers();
  }

  clearAIComments() {
    this.aiComments = [];
    // Remove all AI comment badges
    this.container.querySelectorAll('.ai-comment-badge').forEach(el => el.remove());
    this.container.querySelectorAll('.diff-line.has-ai-comment').forEach(el => {
      el.classList.remove('has-ai-comment');
    });
  }

  addAICommentMarker(comment: AIReviewComment) {
    // Only add if it's for the current file
    if (!this.currentFile || comment.filePath !== this.currentFile.path) return;

    // Check if comment is already tracked
    if (!this.aiComments.find(c => c.id === comment.id)) {
      this.aiComments.push(comment);
    }

    this.renderAICommentBadge(comment);
  }

  private renderAICommentMarkers() {
    // Clear existing AI badges
    this.container.querySelectorAll('.ai-comment-badge').forEach(el => el.remove());
    this.container.querySelectorAll('.diff-line.has-ai-comment').forEach(el => {
      el.classList.remove('has-ai-comment');
    });

    // Only render comments for current file
    if (!this.currentFile) return;

    const fileComments = this.aiComments.filter(c => c.filePath === this.currentFile?.path);
    for (const comment of fileComments) {
      this.renderAICommentBadge(comment);
    }
  }

  private renderAICommentBadge(comment: AIReviewComment) {
    // Find the line element for this comment
    const lineEl = this.container.querySelector(`[data-line="${comment.startLine}"]`);
    if (!lineEl) return;

    lineEl.classList.add('has-ai-comment');

    const content = lineEl.querySelector('.diff-content');
    if (!content) return;

    // Check if there's already an AI badge for this line
    let badge = content.querySelector('.ai-comment-badge') as HTMLElement;
    if (badge) {
      // Update the badge to show multiple comments
      const count = parseInt(badge.dataset.count || '1') + 1;
      badge.dataset.count = count.toString();
      badge.title = `${count} AI comments`;
      return;
    }

    // Create new AI comment badge with robot icon
    const severityColors: Record<string, string> = {
      critical: '#d13438',
      warning: '#ffaa44',
      suggestion: '#0078d4',
      praise: '#107c10'
    };

    const color = severityColors[comment.severity] || severityColors.suggestion;

    badge = document.createElement('span');
    badge.className = `ai-comment-badge severity-${comment.severity}`;
    badge.dataset.commentId = comment.id;
    badge.dataset.count = '1';
    badge.title = comment.title;
    badge.style.cssText = `
      background: ${color}20;
      border: 1px solid ${color};
      color: ${color};
    `;
    badge.innerHTML = iconHtml(Bot, { size: 14, class: 'robot-icon' });

    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.aiCommentClickCallback) {
        this.aiCommentClickCallback(comment);
      }
    });

    content.appendChild(badge);
  }

  navigateComments(direction: number) {
    const commentLines = Array.from(this.container.querySelectorAll('.diff-line.has-comment'));
    if (commentLines.length === 0) return;

    const currentSelected = this.container.querySelector('.diff-line.selected');
    let currentIndex = currentSelected ? commentLines.indexOf(currentSelected) : -1;

    const newIndex = Math.max(0, Math.min(commentLines.length - 1, currentIndex + direction));

    if (currentSelected) {
      currentSelected.classList.remove('selected');
    }

    const newLine = commentLines[newIndex];
    newLine.classList.add('selected');
    newLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  navigateChanges(direction: number): boolean {
    // Get all diff lines to identify change groups (hunks)
    const allLines = Array.from(this.container.querySelectorAll('.diff-line'));
    if (allLines.length === 0) return false;

    // Find change groups - consecutive add/del lines form a group
    const changeGroups: HTMLElement[][] = [];
    let currentGroup: HTMLElement[] = [];

    for (const line of allLines) {
      const isChange = line.classList.contains('add') || line.classList.contains('del');
      if (isChange) {
        currentGroup.push(line as HTMLElement);
      } else if (currentGroup.length > 0) {
        changeGroups.push(currentGroup);
        currentGroup = [];
      }
    }
    // Don't forget the last group
    if (currentGroup.length > 0) {
      changeGroups.push(currentGroup);
    }

    if (changeGroups.length === 0) return false;

    // Find which group is currently highlighted
    const currentHighlighted = this.container.querySelector('.diff-line.change-highlight');
    let currentGroupIndex = -1;

    if (currentHighlighted) {
      for (let i = 0; i < changeGroups.length; i++) {
        if (changeGroups[i].includes(currentHighlighted as HTMLElement)) {
          currentGroupIndex = i;
          break;
        }
      }
    }

    // Calculate new group index
    if (currentGroupIndex === -1) {
      currentGroupIndex = direction > 0 ? -1 : changeGroups.length;
    }

    const newGroupIndex = currentGroupIndex + direction;

    // Return false if we've reached the end
    if (newGroupIndex < 0 || newGroupIndex >= changeGroups.length) {
      return false;
    }

    // Remove all previous highlights
    this.container.querySelectorAll('.diff-line.change-highlight').forEach(el => {
      el.classList.remove('change-highlight');
    });

    // Highlight all lines in the new group
    const newGroup = changeGroups[newGroupIndex];
    for (const line of newGroup) {
      line.classList.add('change-highlight');
    }

    // Scroll to the first line of the group
    newGroup[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }

  clearChangeHighlight() {
    this.container.querySelectorAll('.diff-line.change-highlight').forEach(el => {
      el.classList.remove('change-highlight');
    });
  }

  hasChanges(): boolean {
    return this.lines.some(l => l.type === 'add' || l.type === 'del');
  }

  getChangeStats(): { current: number; total: number } {
    // Count change groups instead of individual lines
    const allLines = Array.from(this.container.querySelectorAll('.diff-line'));
    let groupCount = 0;
    let inGroup = false;
    let currentGroupIndex = 0;
    const currentHighlighted = this.container.querySelector('.diff-line.change-highlight');

    for (const line of allLines) {
      const isChange = line.classList.contains('add') || line.classList.contains('del');
      if (isChange && !inGroup) {
        groupCount++;
        inGroup = true;
        if (line === currentHighlighted || line.classList.contains('change-highlight')) {
          currentGroupIndex = groupCount;
        }
      } else if (!isChange) {
        inGroup = false;
      }
    }

    return { current: currentGroupIndex, total: groupCount };
  }

  private renderBinaryOrEmpty(file: FileChange) {
    let message = 'Binary file or no preview available';
    let icon = iconHtml(File, { size: 48, strokeWidth: 1.5 });

    if (file.changeType === 'add') {
      message = 'New file added';
      icon = iconHtml(FilePlus, { size: 48, strokeWidth: 1.5 });
    } else if (file.changeType === 'delete') {
      message = 'File deleted';
      icon = iconHtml(Minus, { size: 48, strokeWidth: 1.5 });
    }

    this.container.innerHTML = `
      <div class="diff-file">
        <div class="diff-file-header">
          <div class="diff-file-icon ${file.changeType}">
            ${this.getChangeIcon(file.changeType)}
          </div>
          <div class="diff-file-path">${this.formatPath(file.path)}</div>
        </div>
        <div class="diff-placeholder">
          <div class="diff-placeholder-icon">${icon}</div>
          <div class="diff-placeholder-title">${message}</div>
          <div class="diff-placeholder-text">This file cannot be displayed in the diff viewer.</div>
        </div>
      </div>
    `;
  }

  private async renderPreview(file: FileChange) {
    const content = file.modifiedContent || file.originalContent || '';

    if (!content) {
      this.renderBinaryOrEmpty(file);
      return;
    }

    this.container.innerHTML = `
      <div class="diff-file">
        <div class="diff-file-header">
          <div class="diff-file-icon ${file.changeType}">
            ${this.getChangeIcon(file.changeType)}
          </div>
          <div class="diff-file-path">${this.formatPath(file.path)}</div>
          <span class="preview-badge">Preview</span>
        </div>
        <div class="diff-preview">
          <div class="diff-preview-content markdown-content">
            <div class="preview-loading">Rendering preview...</div>
          </div>
        </div>
      </div>
    `;

    const contentEl = this.container.querySelector('.diff-preview-content') as HTMLElement;
    try {
      await renderMarkdownToElement(content, contentEl);
    } catch (error) {
      contentEl.innerHTML = `<div class="preview-error">Failed to render markdown preview</div>`;
    }
  }

  private getStats(): { additions: number; deletions: number } {
    let additions = 0;
    let deletions = 0;

    for (const line of this.lines) {
      if (line.type === 'add') additions++;
      if (line.type === 'del') deletions++;
    }

    return { additions, deletions };
  }

  private syncScroll(el1: Element, el2: Element) {
    let syncing = false;

    const sync = (source: Element, target: Element) => {
      if (syncing) return;
      syncing = true;
      target.scrollTop = source.scrollTop;
      syncing = false;
    };

    el1.addEventListener('scroll', () => sync(el1, el2));
    el2.addEventListener('scroll', () => sync(el2, el1));
  }

  private highlightSyntax(filePath: string) {
    const ext = filePath.split('.').pop()?.toLowerCase();

    // Only highlight programming languages - skip markdown and yaml which cause display issues
    const langMap: Record<string, string> = {
      'ts': 'typescript',
      'tsx': 'typescript',
      'js': 'javascript',
      'jsx': 'javascript',
      'py': 'python',
      'rb': 'ruby',
      'java': 'java',
      'cs': 'csharp',
      'cpp': 'cpp',
      'c': 'c',
      'h': 'c',
      'go': 'go',
      'rs': 'rust',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'php': 'php',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'less': 'less',
      'json': 'json',
      'xml': 'xml',
      'sql': 'sql',
      'sh': 'bash',
      'bash': 'bash',
      // Intentionally skip: md, yaml, yml - they cause display issues with frontmatter
    };

    const lang = langMap[ext || ''];
    if (!lang) return;

    const codeElements = this.container.querySelectorAll('.diff-content code');
    codeElements.forEach(el => {
      try {
        const result = hljs.highlight(el.textContent || '', { language: lang, ignoreIllegals: true });
        el.innerHTML = result.value;
      } catch (e) {
        // Ignore highlighting errors
      }
    });
  }

  private attachEventListeners() {
    this.container.querySelectorAll('.diff-comment-badge').forEach(badge => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const reviewScreen = document.getElementById('reviewScreen');
        reviewScreen?.classList.add('comments-open');

        // Get thread IDs and notify callback
        const threadIdsStr = (badge as HTMLElement).dataset.threadIds;
        if (threadIdsStr && this.commentBadgeClickCallback) {
          const threadIds = threadIdsStr.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
          this.commentBadgeClickCallback(threadIds);
        }
      });
    });
  }

  private renderMinimap(scrollPane: HTMLElement) {
    const minimap = this.container.querySelector('.diff-minimap') as HTMLElement;
    const minimapContent = minimap?.querySelector('.minimap-content') as HTMLElement;
    const viewport = minimap?.querySelector('.minimap-viewport') as HTMLElement;

    if (!minimap || !minimapContent || !viewport) return;

    // Build minimap markers
    const totalLines = this.lines.length;
    if (totalLines === 0) {
      minimap.style.display = 'none';
      return;
    }

    // Create markers for changes and comments (consolidate consecutive changes)
    let markersHtml = '';
    let currentGroup: { type: 'add' | 'del'; startIndex: number; endIndex: number } | null = null;

    const flushGroup = () => {
      if (currentGroup) {
        const startPos = (currentGroup.startIndex / totalLines) * 100;
        const endPos = ((currentGroup.endIndex + 1) / totalLines) * 100;
        const height = Math.max(endPos - startPos, 0.5); // Min height for visibility
        markersHtml += `<div class="minimap-marker ${currentGroup.type}" style="top: ${startPos}%; height: ${height}%" data-index="${currentGroup.startIndex}"></div>`;
        currentGroup = null;
      }
    };

    this.lines.forEach((line, index) => {
      // Handle change groups
      if (line.type === 'add' || line.type === 'del') {
        if (currentGroup && currentGroup.type === line.type) {
          currentGroup.endIndex = index;
        } else {
          flushGroup();
          currentGroup = { type: line.type, startIndex: index, endIndex: index };
        }
      } else {
        flushGroup();
      }

      // Comments are always shown individually
      if (line.threads && line.threads.length > 0) {
        const position = (index / totalLines) * 100;
        markersHtml += `<div class="minimap-marker comment" style="top: ${position}%" data-index="${index}" title="${line.threads.length} comment(s)"></div>`;
      }
    });

    flushGroup(); // Don't forget the last group

    minimapContent.innerHTML = markersHtml;

    // Update viewport indicator on scroll
    const updateViewport = () => {
      const scrollHeight = scrollPane.scrollHeight;
      const clientHeight = scrollPane.clientHeight;
      const scrollTop = scrollPane.scrollTop;

      if (scrollHeight <= clientHeight) {
        viewport.style.display = 'none';
        return;
      }

      viewport.style.display = 'block';
      const viewportHeight = (clientHeight / scrollHeight) * 100;
      const viewportTop = (scrollTop / scrollHeight) * 100;

      viewport.style.height = `${Math.max(viewportHeight, 10)}%`;
      viewport.style.top = `${viewportTop}%`;
    };

    scrollPane.addEventListener('scroll', updateViewport);

    // Initial viewport update
    setTimeout(updateViewport, 50);

    // Click to navigate
    minimap.addEventListener('click', (e) => {
      const rect = minimap.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const percentage = clickY / rect.height;

      const scrollHeight = scrollPane.scrollHeight;
      const clientHeight = scrollPane.clientHeight;
      const targetScroll = percentage * (scrollHeight - clientHeight);

      scrollPane.scrollTo({
        top: targetScroll,
        behavior: 'smooth'
      });
    });

    // Click on marker to scroll to that position
    minimapContent.querySelectorAll('.minimap-marker').forEach(marker => {
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt((marker as HTMLElement).dataset.index || '0');
        const percentage = index / totalLines;

        const scrollHeight = scrollPane.scrollHeight;
        const clientHeight = scrollPane.clientHeight;
        const targetScroll = percentage * (scrollHeight - clientHeight);

        scrollPane.scrollTo({
          top: targetScroll,
          behavior: 'smooth'
        });
      });
    });

    // Drag viewport to scroll
    let isDragging = false;
    let dragStartY = 0;
    let dragStartScroll = 0;

    viewport.addEventListener('mousedown', (e) => {
      isDragging = true;
      dragStartY = e.clientY;
      dragStartScroll = scrollPane.scrollTop;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const rect = minimap.getBoundingClientRect();
      const deltaY = e.clientY - dragStartY;
      const scrollHeight = scrollPane.scrollHeight;
      const clientHeight = scrollPane.clientHeight;

      const scrollDelta = (deltaY / rect.height) * scrollHeight;
      scrollPane.scrollTop = dragStartScroll + scrollDelta;
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

}
