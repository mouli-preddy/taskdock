/**
 * ResizablePanels - Utility for making panels resizable via drag handles
 *
 * Each panel gets its own resize handle attached to its edge.
 * Handles persist widths to localStorage and respect min/max constraints.
 */

interface PanelConfig {
  element: HTMLElement;
  minWidth: number;
  maxWidth: number;
  defaultWidth: number;
  storageKey: string;
  handlePosition: 'left' | 'right';
}

export class ResizablePanels {
  private handles: HTMLElement[] = [];
  private panelConfigs: Map<HTMLElement, PanelConfig> = new Map();
  private activePanel: PanelConfig | null = null;
  private startX: number = 0;
  private startWidth: number = 0;

  constructor() {
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
  }

  /**
   * Setup resize handle for a panel
   */
  setupPanel(config: PanelConfig): void {
    this.panelConfigs.set(config.element, config);

    // Load saved width from localStorage
    const savedWidth = localStorage.getItem(config.storageKey);
    if (savedWidth) {
      const width = parseInt(savedWidth, 10);
      if (!isNaN(width) && width >= config.minWidth && width <= config.maxWidth) {
        config.element.style.width = `${width}px`;
      }
    }

    // Create resize handle
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-handle-${config.handlePosition}`;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.dataset.panelId = config.storageKey;

    // Insert handle into the panel at the appropriate edge
    if (config.handlePosition === 'right') {
      config.element.appendChild(handle);
    } else {
      config.element.insertBefore(handle, config.element.firstChild);
    }

    this.handles.push(handle);

    handle.addEventListener('mousedown', (e) => this.onMouseDown(e, config));
    handle.addEventListener('dblclick', () => this.resetToDefault(config));
  }

  private onMouseDown(e: MouseEvent, panel: PanelConfig): void {
    e.preventDefault();
    e.stopPropagation();
    this.activePanel = panel;
    this.startX = e.clientX;
    this.startWidth = panel.element.getBoundingClientRect().width;

    document.body.classList.add('resizing-panels');
    (e.target as HTMLElement).classList.add('active');

    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.activePanel) return;

    const delta = e.clientX - this.startX;
    // For left handles (panels on the right), dragging right decreases width
    // For right handles (sidebar), dragging right increases width
    const adjustedDelta = this.activePanel.handlePosition === 'left' ? -delta : delta;

    const newWidth = Math.min(
      this.activePanel.maxWidth,
      Math.max(this.activePanel.minWidth, this.startWidth + adjustedDelta)
    );

    this.activePanel.element.style.width = `${newWidth}px`;

    // Dispatch resize event so other components (like terminals) can refit
    window.dispatchEvent(new Event('resize'));
  }

  private onMouseUp(): void {
    if (!this.activePanel) return;

    // Save width to localStorage
    const width = this.activePanel.element.getBoundingClientRect().width;
    localStorage.setItem(this.activePanel.storageKey, Math.round(width).toString());

    document.body.classList.remove('resizing-panels');
    document.querySelectorAll('.resize-handle.active').forEach(h => h.classList.remove('active'));

    this.activePanel = null;

    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
  }

  private resetToDefault(panel: PanelConfig): void {
    panel.element.style.width = `${panel.defaultWidth}px`;
    localStorage.removeItem(panel.storageKey);
    // Dispatch resize event so other components (like terminals) can refit
    window.dispatchEvent(new Event('resize'));
  }

  /**
   * Clean up all handles
   */
  destroy(): void {
    for (const handle of this.handles) {
      handle.remove();
    }
    this.handles = [];
    this.panelConfigs.clear();
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
  }
}

/**
 * Setup resizable panels for a review screen
 */
export function setupResizablePanels(tabId: string): ResizablePanels {
  const resizer = new ResizablePanels();

  const sidebar = document.getElementById(`sidebar-${tabId}`) as HTMLElement;
  const commentsPanel = document.getElementById(`commentsPanel-${tabId}`) as HTMLElement;
  const aiCommentsPanel = document.getElementById(`aiCommentsPanel-${tabId}`) as HTMLElement;
  const walkthroughsPanel = document.getElementById(`walkthroughsPanel-${tabId}`) as HTMLElement;

  // Sidebar - handle on right edge
  if (sidebar) {
    resizer.setupPanel({
      element: sidebar,
      minWidth: 150,
      maxWidth: 400,
      defaultWidth: 240,
      storageKey: 'panel-width-sidebar',
      handlePosition: 'right',
    });
  }

  // Comments panel - handle on left edge
  if (commentsPanel) {
    resizer.setupPanel({
      element: commentsPanel,
      minWidth: 250,
      maxWidth: 600,
      defaultWidth: 320,
      storageKey: 'panel-width-comments',
      handlePosition: 'left',
    });
  }

  // AI Comments panel - handle on left edge
  if (aiCommentsPanel) {
    resizer.setupPanel({
      element: aiCommentsPanel,
      minWidth: 280,
      maxWidth: 700,
      defaultWidth: 380,
      storageKey: 'panel-width-ai-comments',
      handlePosition: 'left',
    });
  }

  // Walkthroughs panel - handle on left edge
  if (walkthroughsPanel) {
    resizer.setupPanel({
      element: walkthroughsPanel,
      minWidth: 250,
      maxWidth: 600,
      defaultWidth: 320,
      storageKey: 'panel-width-walkthroughs',
      handlePosition: 'left',
    });
  }

  // Apply Changes panel - handle on left edge
  const applyChangesPanel = document.getElementById(`applyChangesPanel-${tabId}`) as HTMLElement;
  if (applyChangesPanel) {
    resizer.setupPanel({
      element: applyChangesPanel,
      minWidth: 280,
      maxWidth: 600,
      defaultWidth: 350,
      storageKey: 'panel-width-apply-changes',
      handlePosition: 'left',
    });
  }

  return resizer;
}
