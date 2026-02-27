const SEVERITY_COLORS_MAP: Record<string, string> = {
  error: '#f85149', critical: '#f85149', fatal: '#f85149',
  warning: '#e5a100', warn: '#e5a100',
  information: '#1f6feb', info: '#1f6feb',
  verbose: '#6e7681', debug: '#6e7681', trace: '#484f58',
};
const DEFAULT_ROW_COLOR = '#30363d';

export class DGrepSeverityMinimap {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private viewportEl: HTMLElement;

  private rowCount = 0;
  private severities: string[] = [];
  private bookmarks: Set<number> = new Set();
  private anomalies: Set<number> = new Set();

  // Viewport state
  private vpStart = 0;
  private vpEnd = 0;

  // Drag state
  private isDragging = false;
  private dragOffsetY = 0;

  // Callbacks
  private scrollToCallback: ((rowIndex: number) => void) | null = null;

  private resizeObserver: ResizeObserver;
  private rafId = 0;
  private destroyed = false;

  constructor(parent: HTMLElement) {
    this.container = parent; // Use the parent directly as the container

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'dgrep-minimap-canvas';
    this.container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d')!;

    this.viewportEl = document.createElement('div');
    this.viewportEl.className = 'dgrep-minimap-viewport';
    this.container.appendChild(this.viewportEl);

    // Observe the parent's parent (scrollerWrapper) which has the guaranteed height
    const observeTarget = parent.parentElement ?? parent;
    this.resizeObserver = new ResizeObserver(() => this.scheduleRender());
    this.resizeObserver.observe(observeTarget);

    this.attachInteractions();
  }

  onScrollTo(cb: (rowIndex: number) => void): void {
    this.scrollToCallback = cb;
  }

  setData(rows: Record<string, any>[], severityColumn: string): void {
    this.rowCount = rows.length;
    this.severities = rows.map(r => {
      const val = String(r[severityColumn] ?? '').toLowerCase().trim();
      // If the value is text-based, use it directly
      if (val && isNaN(Number(val))) return val;
      // Fallback: map numeric Level to text (DGrep: 2=Error, 3=Warning, 4=Info, 5+=Verbose)
      const n = Number(val);
      if (n <= 2) return 'error';
      if (n === 3) return 'warning';
      if (n === 4) return 'information';
      return 'verbose';
    });
    this.scheduleRender();
  }

  setViewportRange(startRow: number, endRow: number): void {
    this.vpStart = startRow;
    this.vpEnd = endRow;
    this.updateViewportIndicator();
  }

  setBookmarks(indices: Set<number>): void {
    this.bookmarks = indices;
    this.scheduleRender();
  }

  setAnomalies(indices: Set<number>): void {
    this.anomalies = indices;
    this.scheduleRender();
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver.disconnect();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.container.remove();
  }

  // ==================== Rendering ====================

  private scheduleRender(): void {
    if (this.destroyed) return;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(() => this.renderCanvas());
  }

  private renderCanvas(): void {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = rect.height;

    if (w === 0 || h === 0 || this.rowCount === 0) return;

    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    // If more rows than pixels, bucket them
    const pixelHeight = h;
    const rowsPerPixel = this.rowCount / pixelHeight;

    if (rowsPerPixel <= 1) {
      // Each row gets >= 1 pixel
      const rowH = pixelHeight / this.rowCount;
      for (let i = 0; i < this.rowCount; i++) {
        const color = SEVERITY_COLORS_MAP[this.severities[i]] || DEFAULT_ROW_COLOR;
        ctx.fillStyle = color;
        ctx.fillRect(0, i * rowH, w, Math.max(1, rowH));
      }
    } else {
      // Multiple rows per pixel - use dominant severity per pixel bucket
      for (let py = 0; py < pixelHeight; py++) {
        const startRow = Math.floor(py * rowsPerPixel);
        const endRow = Math.min(this.rowCount, Math.floor((py + 1) * rowsPerPixel));

        // Count severities in this pixel's bucket
        const counts: Record<string, number> = {};
        let maxCount = 0;
        let dominant = '';

        for (let r = startRow; r < endRow; r++) {
          const sev = this.severities[r];
          counts[sev] = (counts[sev] || 0) + 1;
          // Prioritize errors/warnings even if not numerically dominant
          const weight = (sev === 'error' || sev === 'critical' || sev === 'fatal') ? 3 :
                         (sev === 'warning' || sev === 'warn') ? 2 : 1;
          const weighted = counts[sev] * weight;
          if (weighted > maxCount) {
            maxCount = weighted;
            dominant = sev;
          }
        }

        ctx.fillStyle = SEVERITY_COLORS_MAP[dominant] || DEFAULT_ROW_COLOR;
        ctx.fillRect(0, py, w, 1);
      }
    }

    // Draw bookmark tick marks
    if (this.bookmarks.size > 0) {
      ctx.fillStyle = '#f0e040';
      for (const idx of this.bookmarks) {
        const y = (idx / this.rowCount) * pixelHeight;
        ctx.fillRect(0, y - 0.5, w, 2);
      }
    }

    // Draw anomaly tick marks
    if (this.anomalies.size > 0) {
      ctx.fillStyle = '#f0883e';
      for (const idx of this.anomalies) {
        const y = (idx / this.rowCount) * pixelHeight;
        ctx.fillRect(0, y - 0.5, w, 2);
      }
    }

    this.updateViewportIndicator();
  }

  private updateViewportIndicator(): void {
    if (this.rowCount === 0) {
      this.viewportEl.style.display = 'none';
      return;
    }

    const h = this.container.getBoundingClientRect().height;
    const top = (this.vpStart / this.rowCount) * h;
    const bottom = (this.vpEnd / this.rowCount) * h;
    const vpH = Math.max(4, bottom - top);

    this.viewportEl.style.display = '';
    this.viewportEl.style.top = `${top}px`;
    this.viewportEl.style.height = `${vpH}px`;
  }

  // ==================== Interactions ====================

  private attachInteractions(): void {
    this.canvas.addEventListener('click', (e) => {
      if (this.isDragging) return;
      this.handleClick(e);
    });

    this.viewportEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.isDragging = true;
      const rect = this.viewportEl.getBoundingClientRect();
      this.dragOffsetY = e.clientY - rect.top;

      const onMouseMove = (ev: MouseEvent) => {
        if (!this.isDragging) return;
        const containerRect = this.container.getBoundingClientRect();
        const y = ev.clientY - containerRect.top - this.dragOffsetY;
        const frac = Math.max(0, Math.min(1, y / containerRect.height));
        const row = Math.floor(frac * this.rowCount);
        this.scrollToCallback?.(row);
      };

      const onMouseUp = () => {
        this.isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  private handleClick(e: MouseEvent): void {
    const rect = this.container.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const frac = y / rect.height;
    const rowIndex = Math.floor(frac * this.rowCount);
    this.scrollToCallback?.(Math.max(0, Math.min(this.rowCount - 1, rowIndex)));
  }
}
