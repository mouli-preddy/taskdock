/**
 * Walkthrough UI
 * Floating overlay for AI-guided code navigation
 */

import type { CodeWalkthrough, WalkthroughStep, WalkthroughPreset } from '../../shared/ai-types.js';
import { initializeMermaid } from '../utils/markdown-renderer.js';
import { escapeHtml } from '../utils/html-utils.js';
import {
  iconHtml,
  Bot,
  X,
  Maximize2,
  Minus,
  GripVertical,
  Clock,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from '../utils/icons.js';
import { renderStepHtml, renderSummaryHtml, renderMarkdownInContainer } from './walkthrough-renderer.js';

/**
 * Extended walkthrough with display metadata
 */
export interface ExtendedWalkthrough extends CodeWalkthrough {
  displayName?: string;
  preset?: WalkthroughPreset;
  customPrompt?: string;
}

export class WalkthroughUI {
  private overlay: HTMLElement | null = null;
  private walkthrough: CodeWalkthrough | null = null;
  private currentStep = 0;
  private isMinimized = false;
  private position = { x: 20, y: 100 };
  private size = { width: 420, height: 500 };
  private isDragging = false;
  private dragStart = { mouseX: 0, mouseY: 0, posX: 0, posY: 0 };
  private isResizing = false;
  private resizeDirection = '';
  private resizeStart = { x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0 };

  // Display metadata for walkthrough name and source
  private displayName?: string;
  private preset?: WalkthroughPreset;
  private customPrompt?: string;

  // Track which tab this walkthrough belongs to
  private tabId: string | null = null;

  // Popout state
  private isPopoutActive = false;
  private popoutWindow: any = null; // WebviewWindow reference
  private popoutUnlisteners: Array<() => void> = [];

  private navigateCallback?: (filePath: string, line: number) => void;
  private closeCallback?: () => void;

  // Bound handlers for cleanup
  private boundMouseMove: ((e: MouseEvent) => void) | null = null;
  private boundMouseUp: (() => void) | null = null;

  onNavigate(callback: (filePath: string, line: number) => void): void {
    this.navigateCallback = callback;
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  show(walkthrough: ExtendedWalkthrough, tabId?: string): void {
    // Close any existing popout before showing new walkthrough
    if (this.isPopoutActive) {
      this.closePopoutWindow();
      this.cleanupPopout();
      this.isPopoutActive = false;
    }

    initializeMermaid();
    this.walkthrough = walkthrough;
    this.currentStep = 0;
    this.isMinimized = false;

    // Store display metadata
    this.displayName = walkthrough.displayName;
    this.preset = walkthrough.preset;
    this.customPrompt = walkthrough.customPrompt;

    // Track which tab this walkthrough belongs to
    this.tabId = tabId || null;

    this.createOverlay();
    this.render();
    this.attachKeyboardListeners();
  }

  hide(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    if (this.isPopoutActive) {
      this.closePopoutWindow();
      this.cleanupPopout();
      this.isPopoutActive = false;
    }
    this.tabId = null;
    this.removeKeyboardListeners();
    this.removeMouseListeners();
    this.closeCallback?.();
  }

  /**
   * Get the tab ID this walkthrough belongs to
   */
  getTabId(): string | null {
    return this.tabId;
  }

  /**
   * Check if the walkthrough is currently visible
   */
  isVisible(): boolean {
    return this.overlay !== null || this.isPopoutActive;
  }

  /**
   * Hide the walkthrough if it doesn't belong to the specified tab
   */
  hideIfNotOnTab(currentTabId: string): void {
    if (this.tabId && this.tabId !== currentTabId) {
      if (this.overlay) {
        this.overlay.remove();
        this.overlay = null;
      }
      if (this.isPopoutActive) {
        this.closePopoutWindow();
        this.cleanupPopout();
        this.isPopoutActive = false;
      }
      this.tabId = null;
      this.removeKeyboardListeners();
      this.removeMouseListeners();
      this.closeCallback?.();
    }
  }

  private removeMouseListeners(): void {
    if (this.boundMouseMove) {
      document.removeEventListener('mousemove', this.boundMouseMove);
      this.boundMouseMove = null;
    }
    if (this.boundMouseUp) {
      document.removeEventListener('mouseup', this.boundMouseUp);
      this.boundMouseUp = null;
    }
  }

  /**
   * Get total number of pages (1 for summary + number of steps)
   */
  private getTotalPages(): number {
    return 1 + (this.walkthrough?.steps.length || 0);
  }

  /**
   * Check if currently showing the summary page (page 0)
   */
  private isOnSummaryPage(): boolean {
    return this.currentStep === 0;
  }

  /**
   * Get the current step object (null if on summary page)
   */
  private getCurrentStep(): WalkthroughStep | null {
    if (!this.walkthrough || this.currentStep === 0) return null;
    return this.walkthrough.steps[this.currentStep - 1] || null;
  }

  nextStep(): void {
    if (!this.walkthrough) return;
    const totalPages = this.getTotalPages();
    if (this.currentStep < totalPages - 1) {
      this.currentStep++;
      this.render();
      this.navigateToCurrentStep();
    }
  }

  previousStep(): void {
    if (this.currentStep > 0) {
      this.currentStep--;
      this.render();
      // Only navigate to file if we're on a step page (not summary)
      if (this.currentStep > 0) {
        this.navigateToCurrentStep();
      }
    }
  }

  goToStep(pageNumber: number): void {
    if (!this.walkthrough) return;
    const totalPages = this.getTotalPages();
    if (pageNumber >= 0 && pageNumber < totalPages) {
      this.currentStep = pageNumber;
      this.render();
      // Only navigate to file if we're on a step page (not summary)
      if (this.currentStep > 0) {
        this.navigateToCurrentStep();
      }
    }
  }

  private createOverlay(): void {
    if (this.overlay) {
      this.overlay.remove();
    }

    this.overlay = document.createElement('div');
    this.overlay.id = 'walkthroughOverlay';
    this.overlay.className = 'walkthrough-overlay';
    document.body.appendChild(this.overlay);

    this.updatePosition();
    this.updateSize();
    this.attachGlobalMouseListeners();
  }

  private attachGlobalMouseListeners(): void {
    // Only attach global listeners once
    if (!this.boundMouseMove) {
      this.boundMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
      this.boundMouseUp = () => this.handleMouseUp();
      document.addEventListener('mousemove', this.boundMouseMove);
      document.addEventListener('mouseup', this.boundMouseUp);
    }
  }

  private updatePosition(): void {
    if (!this.overlay) return;
    this.overlay.style.right = `${this.position.x}px`;
    this.overlay.style.bottom = `${this.position.y}px`;
  }

  private updateSize(): void {
    if (!this.overlay || this.isMinimized) return;
    this.overlay.style.width = `${this.size.width}px`;
    this.overlay.style.height = `${this.size.height}px`;
  }

  private render(): void {
    if (!this.overlay || !this.walkthrough) return;

    const totalPages = this.getTotalPages();
    const step = this.getCurrentStep();
    const progress = totalPages > 0
      ? ((this.currentStep + 1) / totalPages) * 100
      : 0;

    // Display text for step indicator
    const stepIndicatorText = this.isOnSummaryPage()
      ? 'Overview'
      : `Step ${this.currentStep} of ${this.walkthrough.steps.length}`;

    // Toggle minimized class on overlay
    this.overlay.classList.toggle('minimized', this.isMinimized);

    if (this.isMinimized) {
      // Get current file and step title for display
      const currentFile = step?.filePath?.split('/').pop() || '';
      const lineInfo = step ? `:${step.startLine}` : '';
      const stepTitle = step?.title || 'Overview';

      this.overlay.innerHTML = `
        <div class="walkthrough-minimized">
          <div class="walkthrough-mini-header">
            ${iconHtml(Bot, { size: 16, class: 'robot-icon' })}
            <span class="walkthrough-mini-title">${escapeHtml(this.displayName || 'Walkthrough')}</span>
            <span class="walkthrough-mini-divider">•</span>
            <span class="walkthrough-mini-step-title">${escapeHtml(stepTitle)}</span>
            ${currentFile ? `
              <span class="walkthrough-mini-divider">•</span>
              <span class="walkthrough-mini-file" title="${step?.filePath || ''}">${currentFile}${lineInfo}</span>
            ` : ''}
          </div>
          <div class="walkthrough-mini-nav">
            <button class="btn btn-icon walkthrough-prev-btn" title="Previous" ${this.currentStep === 0 ? 'disabled' : ''}>
              ${iconHtml(ChevronLeft, { size: 14 })}
            </button>
            <span class="walkthrough-mini-progress">${this.currentStep + 1}/${totalPages}</span>
            <button class="btn btn-icon walkthrough-next-btn" title="Next" ${this.currentStep >= totalPages - 1 ? 'disabled' : ''}>
              ${iconHtml(ChevronRight, { size: 14 })}
            </button>
          </div>
          <div class="walkthrough-mini-actions">
            <button class="btn btn-icon walkthrough-expand-btn" title="Expand">
              ${iconHtml(Maximize2, { size: 16 })}
            </button>
            <button class="btn btn-icon walkthrough-close-btn" title="Close">
              ${iconHtml(X, { size: 16 })}
            </button>
          </div>
        </div>
      `;
    } else {
      this.overlay.innerHTML = `
        <div class="walkthrough-header">
          <div class="walkthrough-drag-handle">
            ${iconHtml(GripVertical, { size: 16 })}
          </div>
          <div class="walkthrough-title-section">
            <div class="walkthrough-title">
              ${iconHtml(Bot, { size: 18, class: 'robot-icon' })}
              <span>${escapeHtml(this.displayName || 'Code Walkthrough')}</span>
            </div>
            ${this.preset ? `
              <span class="walkthrough-source">From preset: ${escapeHtml(this.preset.name)}</span>
            ` : this.customPrompt ? `
              <span class="walkthrough-source">Custom request</span>
            ` : ''}
          </div>
          <div class="walkthrough-header-actions">
            <button class="btn btn-icon walkthrough-popout-btn" title="Open in separate window">
              ${iconHtml(ExternalLink, { size: 16 })}
            </button>
            <button class="btn btn-icon walkthrough-minimize-btn" title="Minimize">
              ${iconHtml(Minus, { size: 16 })}
            </button>
            <button class="btn btn-icon walkthrough-close-btn" title="Close">
              ${iconHtml(X, { size: 16 })}
            </button>
          </div>
        </div>

        <div class="walkthrough-progress">
          <div class="walkthrough-progress-bar" style="width: ${progress}%"></div>
        </div>

        <div class="walkthrough-meta">
          <span class="walkthrough-step-indicator">${stepIndicatorText}</span>
          <span class="walkthrough-time">
            ${iconHtml(Clock, { size: 12 })}
            ~${this.walkthrough.estimatedReadTime || Math.max(1, Math.ceil(this.walkthrough.steps.length * 0.5))} min read
          </span>
        </div>

        <div class="walkthrough-content">
          ${step ? this.renderStepSync(step) : this.renderSummarySync()}
        </div>

        <div class="walkthrough-nav">
          <button class="btn btn-secondary walkthrough-prev-btn" ${this.currentStep === 0 ? 'disabled' : ''}>
            ${iconHtml(ChevronLeft, { size: 16 })}
            Previous
          </button>
          <div class="walkthrough-step-dots">
            <button class="step-dot ${this.currentStep === 0 ? 'active' : ''}"
                    data-step="0"
                    title="Overview">
            </button>
            ${this.walkthrough.steps.map((_, i) => `
              <button class="step-dot ${(i + 1) === this.currentStep ? 'active' : ''}"
                      data-step="${i + 1}"
                      title="Step ${i + 1}">
              </button>
            `).join('')}
          </div>
          <button class="btn btn-primary walkthrough-next-btn" ${this.currentStep >= totalPages - 1 ? 'disabled' : ''}>
            Next
            ${iconHtml(ChevronRight, { size: 16 })}
          </button>
        </div>

        <div class="walkthrough-keyboard-hint">
          <kbd>←</kbd> <kbd>→</kbd> or <kbd>n</kbd> <kbd>p</kbd> to navigate
        </div>

        <!-- Resize handles -->
        <div class="walkthrough-resize-handle walkthrough-resize-n" data-direction="n"></div>
        <div class="walkthrough-resize-handle walkthrough-resize-s" data-direction="s"></div>
        <div class="walkthrough-resize-handle walkthrough-resize-e" data-direction="e"></div>
        <div class="walkthrough-resize-handle walkthrough-resize-w" data-direction="w"></div>
        <div class="walkthrough-resize-handle walkthrough-resize-nw" data-direction="nw"></div>
        <div class="walkthrough-resize-handle walkthrough-resize-ne" data-direction="ne"></div>
        <div class="walkthrough-resize-handle walkthrough-resize-sw" data-direction="sw"></div>
        <div class="walkthrough-resize-handle walkthrough-resize-se" data-direction="se"></div>
      `;
    }

    this.attachEventListeners();
    this.attachDragListeners();
    this.attachResizeListeners();
    this.updateSize();

    // Async render markdown content after initial render
    this.renderMarkdownContent();
  }

  private renderStepSync(step: WalkthroughStep): string {
    return renderStepHtml(step);
  }

  private renderSummarySync(): string {
    if (!this.walkthrough) return '';
    return renderSummaryHtml(this.walkthrough);
  }

  /**
   * Async render markdown and mermaid content after initial HTML render
   */
  private async renderMarkdownContent(): Promise<void> {
    if (!this.overlay) return;
    await renderMarkdownInContainer(this.overlay);
  }

  private navigateToCurrentStep(): void {
    if (!this.walkthrough || !this.navigateCallback) return;
    const step = this.getCurrentStep();
    if (step) {
      this.navigateCallback(step.filePath, step.startLine);
    }
  }

  private attachEventListeners(): void {
    if (!this.overlay) return;

    // Close button
    this.overlay.querySelectorAll('.walkthrough-close-btn').forEach(btn => {
      btn.addEventListener('click', () => this.hide());
    });

    // Minimize button
    this.overlay.querySelector('.walkthrough-minimize-btn')?.addEventListener('click', () => {
      this.isMinimized = true;
      this.render();
    });

    // Popout button
    this.overlay.querySelector('.walkthrough-popout-btn')?.addEventListener('click', () => {
      this.popout();
    });

    // Expand button
    this.overlay.querySelector('.walkthrough-expand-btn')?.addEventListener('click', () => {
      this.isMinimized = false;
      this.render();
    });

    // Navigation buttons (in both expanded and minimized states)
    this.overlay.querySelectorAll('.walkthrough-prev-btn').forEach(btn => {
      btn.addEventListener('click', () => this.previousStep());
    });

    this.overlay.querySelectorAll('.walkthrough-next-btn').forEach(btn => {
      btn.addEventListener('click', () => this.nextStep());
    });

    // Step dots
    this.overlay.querySelectorAll('.step-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        const step = parseInt((dot as HTMLElement).dataset.step || '0');
        this.goToStep(step);
      });
    });

    // Location click (expanded view)
    this.overlay.querySelector('.walkthrough-step-location')?.addEventListener('click', () => {
      this.navigateToCurrentStep();
    });

    // Mini file click (minimized view) - navigate to current step
    this.overlay.querySelector('.walkthrough-mini-file')?.addEventListener('click', (e) => {
      e.stopPropagation(); // Don't trigger drag
      this.navigateToCurrentStep();
    });

    // Related file clicks
    this.overlay.querySelectorAll('.walkthrough-related-file').forEach(el => {
      el.addEventListener('click', () => {
        const file = (el as HTMLElement).dataset.file;
        if (file && this.navigateCallback) {
          this.navigateCallback(file, 1);
        }
      });
    });
  }

  private attachDragListeners(): void {
    if (!this.overlay) return;

    const header = this.overlay.querySelector('.walkthrough-header, .walkthrough-minimized');
    if (!header) return;

    header.addEventListener('mousedown', (e: Event) => {
      const mouseEvent = e as MouseEvent;
      if ((mouseEvent.target as HTMLElement).closest('button')) return;
      // Don't allow dragging when minimized (pinned to bottom)
      if (this.isMinimized) return;

      this.isDragging = true;

      // Store starting positions
      this.dragStart = {
        mouseX: mouseEvent.clientX,
        mouseY: mouseEvent.clientY,
        posX: this.position.x,
        posY: this.position.y,
      };

      this.overlay!.classList.add('dragging');
    });
  }

  private handleMouseMove(e: MouseEvent): void {
    if (this.isDragging && this.overlay) {
      // Calculate how much the mouse has moved
      const deltaX = e.clientX - this.dragStart.mouseX;
      const deltaY = e.clientY - this.dragStart.mouseY;

      // Since we use right/bottom positioning:
      // - Moving mouse right (positive deltaX) should decrease 'right' value
      // - Moving mouse down (positive deltaY) should decrease 'bottom' value
      this.position = {
        x: this.dragStart.posX - deltaX,
        y: this.dragStart.posY - deltaY,
      };

      // Constrain to viewport
      this.position.x = Math.max(10, Math.min(this.position.x, window.innerWidth - 50));
      this.position.y = Math.max(10, Math.min(this.position.y, window.innerHeight - 50));

      this.updatePosition();
    }

    if (this.isResizing && this.overlay) {
      this.handleResize(e);
    }
  }

  private handleMouseUp(): void {
    if (this.isDragging) {
      this.isDragging = false;
      this.overlay?.classList.remove('dragging');
    }
    if (this.isResizing) {
      this.isResizing = false;
      this.resizeDirection = '';
      this.overlay?.classList.remove('resizing');
      document.body.style.cursor = '';
    }
  }

  private attachResizeListeners(): void {
    if (!this.overlay) return;

    this.overlay.querySelectorAll('.walkthrough-resize-handle').forEach(handle => {
      handle.addEventListener('mousedown', (e: Event) => {
        const mouseEvent = e as MouseEvent;
        mouseEvent.preventDefault();
        mouseEvent.stopPropagation();

        this.isResizing = true;
        this.resizeDirection = (handle as HTMLElement).dataset.direction || '';

        const rect = this.overlay!.getBoundingClientRect();
        this.resizeStart = {
          x: mouseEvent.clientX,
          y: mouseEvent.clientY,
          width: rect.width,
          height: rect.height,
          right: window.innerWidth - rect.right,
          bottom: window.innerHeight - rect.bottom,
        };

        this.overlay!.classList.add('resizing');
        document.body.style.cursor = this.getCursorForDirection(this.resizeDirection);
      });
    });
  }

  private getCursorForDirection(direction: string): string {
    const cursors: Record<string, string> = {
      'n': 'ns-resize',
      's': 'ns-resize',
      'e': 'ew-resize',
      'w': 'ew-resize',
      'nw': 'nwse-resize',
      'se': 'nwse-resize',
      'ne': 'nesw-resize',
      'sw': 'nesw-resize',
    };
    return cursors[direction] || 'default';
  }

  private handleResize(e: MouseEvent): void {
    if (!this.overlay) return;

    const dx = e.clientX - this.resizeStart.x;
    const dy = e.clientY - this.resizeStart.y;
    const dir = this.resizeDirection;

    let newWidth = this.resizeStart.width;
    let newHeight = this.resizeStart.height;
    let newRight = this.resizeStart.right;
    let newBottom = this.resizeStart.bottom;

    const minWidth = 300;
    const minHeight = 200;
    const maxWidth = window.innerWidth - 40;
    const maxHeight = window.innerHeight - 40;

    // Handle horizontal resizing
    if (dir.includes('e')) {
      // East: shrink from right (since we use right positioning)
      newWidth = Math.max(minWidth, Math.min(maxWidth, this.resizeStart.width + dx));
      newRight = this.resizeStart.right - dx;
    }
    if (dir.includes('w')) {
      // West: grow/shrink width, position stays
      newWidth = Math.max(minWidth, Math.min(maxWidth, this.resizeStart.width - dx));
    }

    // Handle vertical resizing
    if (dir.includes('s')) {
      // South: shrink from bottom (since we use bottom positioning)
      newHeight = Math.max(minHeight, Math.min(maxHeight, this.resizeStart.height + dy));
      newBottom = this.resizeStart.bottom - dy;
    }
    if (dir.includes('n')) {
      // North: grow/shrink height, position stays
      newHeight = Math.max(minHeight, Math.min(maxHeight, this.resizeStart.height - dy));
    }

    // Apply size
    this.size.width = newWidth;
    this.size.height = newHeight;

    // Apply position changes for e/s directions
    if (dir.includes('e')) {
      this.position.x = Math.max(10, newRight);
    }
    if (dir.includes('s')) {
      this.position.y = Math.max(10, newBottom);
    }

    this.updateSize();
    this.updatePosition();
  }

  /**
   * Pop the walkthrough out into a separate Tauri window.
   * Hides the in-app overlay and sends walkthrough data to the new window.
   */
  async popout(): Promise<void> {
    if (this.isPopoutActive || !this.walkthrough) return;

    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const { emit, listen } = await import('@tauri-apps/api/event');

      // Create the popout window
      const popoutLabel = `walkthrough-popout-${Date.now()}`;
      const popoutWindow = new WebviewWindow(popoutLabel, {
        url: 'walkthrough-popout.html',
        title: this.displayName || 'Code Walkthrough',
        width: 450,
        height: 550,
        minWidth: 350,
        minHeight: 400,
        resizable: true,
        decorations: true,
        center: true,
      });

      this.popoutWindow = popoutWindow;
      this.isPopoutActive = true;

      // Listen for creation errors
      popoutWindow.once('tauri://error', (e) => {
        console.error('Failed to create popout webview:', e);
        this.isPopoutActive = false;
        this.popoutWindow = null;
        // Restore in-app overlay on error
        if (this.walkthrough) {
          this.createOverlay();
          this.render();
          this.attachKeyboardListeners();
        }
      });

      // Wait for the popout window's JS to initialize and signal ready
      const unlistenReady = await listen('walkthrough:popout-ready', async () => {
        await emit('walkthrough:popout-data', {
          walkthrough: this.walkthrough,
          currentStep: this.currentStep,
          displayName: this.displayName,
          preset: this.preset,
          customPrompt: this.customPrompt,
        });
        unlistenReady();
      });

      // Listen for navigation events from the popout
      const unlistenNavigate = await listen<{ filePath: string; line: number }>('walkthrough:navigate', (event) => {
        if (this.navigateCallback) {
          this.navigateCallback(event.payload.filePath, event.payload.line);
        }
      });

      // Listen for pop-back events
      const unlistenPopBack = await listen<{ currentStep: number }>('walkthrough:pop-back', (event) => {
        this.handlePopBack(event.payload.currentStep);
      });

      // Listen for the popout window being closed by the user (OS close button)
      const unlistenDestroyed = await popoutWindow.once('tauri://destroyed', () => {
        this.cleanupPopout();
        // If the walkthrough tab is still active, re-show the overlay
        if (this.walkthrough && this.tabId) {
          this.isPopoutActive = false;
          this.createOverlay();
          this.render();
          this.attachKeyboardListeners();
        }
      });

      // Store unlisteners for cleanup
      this.popoutUnlisteners = [unlistenNavigate, unlistenPopBack, unlistenReady, unlistenDestroyed];

      // Hide the in-app overlay (but don't clear walkthrough data)
      if (this.overlay) {
        this.overlay.remove();
        this.overlay = null;
      }
      this.removeKeyboardListeners();
      this.removeMouseListeners();

    } catch (error) {
      console.error('Failed to create popout window:', error);
      this.isPopoutActive = false;
      this.popoutWindow = null;
      // Restore in-app overlay on error
      if (this.walkthrough) {
        this.createOverlay();
        this.render();
        this.attachKeyboardListeners();
      }
    }
  }

  /**
   * Handle the user clicking "pop back in" from the popout window.
   * Restores the in-app overlay and closes the popout.
   */
  private handlePopBack(currentStep: number): void {
    this.currentStep = currentStep;
    this.closePopoutWindow();
    this.cleanupPopout();
    this.isPopoutActive = false;

    // Re-show the in-app overlay
    if (this.walkthrough) {
      this.createOverlay();
      this.render();
      this.attachKeyboardListeners();
    }
  }

  /**
   * Close the popout window (if open).
   * Uses direct window.close() instead of async event emit so it works
   * from synchronous callers like hide().
   */
  private closePopoutWindow(): void {
    if (this.popoutWindow) {
      try {
        this.popoutWindow.close();
      } catch {
        // Window may already be closed
      }
      this.popoutWindow = null;
    }
  }

  /**
   * Clean up popout event listeners.
   */
  private cleanupPopout(): void {
    for (const unlisten of this.popoutUnlisteners) {
      unlisten();
    }
    this.popoutUnlisteners = [];
    this.popoutWindow = null;
  }

  /**
   * Whether the walkthrough is currently in a popout window
   */
  isInPopout(): boolean {
    return this.isPopoutActive;
  }

  /**
   * Get the current walkthrough state for saving/restoring across tab switches
   */
  getPopoutState(): {
    walkthrough: CodeWalkthrough;
    currentStep: number;
    displayName?: string;
    preset?: WalkthroughPreset;
    customPrompt?: string;
  } | null {
    if (!this.walkthrough) return null;
    return {
      walkthrough: this.walkthrough,
      currentStep: this.currentStep,
      displayName: this.displayName,
      preset: this.preset,
      customPrompt: this.customPrompt,
    };
  }

  /**
   * Restore a popout window from saved state (used when switching back to a PR tab)
   */
  async restorePopout(state: {
    walkthrough: CodeWalkthrough;
    currentStep: number;
    displayName?: string;
    preset?: WalkthroughPreset;
    customPrompt?: string;
  }, tabId: string): Promise<void> {
    this.walkthrough = state.walkthrough;
    this.currentStep = state.currentStep;
    this.displayName = state.displayName;
    this.preset = state.preset;
    this.customPrompt = state.customPrompt;
    this.tabId = tabId;
    await this.popout();
  }

  private keyboardHandler = (e: KeyboardEvent): void => {
    // Skip if typing in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'n') {
      this.nextStep();
    } else if (e.key === 'ArrowLeft' || e.key === 'p') {
      this.previousStep();
    } else if (e.key === 'Escape') {
      this.hide();
    }
  };

  private attachKeyboardListeners(): void {
    document.addEventListener('keydown', this.keyboardHandler);
  }

  private removeKeyboardListeners(): void {
    document.removeEventListener('keydown', this.keyboardHandler);
  }
}
