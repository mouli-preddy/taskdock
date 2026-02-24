const SEVERITY_COLORS_CANVAS: Record<string, string> = {
  error: '#f85149', critical: '#f85149', fatal: '#f85149',
  warning: '#e5a100', warn: '#e5a100',
  information: '#1f6feb', info: '#1f6feb',
  verbose: '#6e7681', debug: '#6e7681', trace: '#484f58',
};
const DEFAULT_BAR_COLOR = '#30363d';

const SEVERITY_ORDER = ['error', 'critical', 'fatal', 'warning', 'warn', 'information', 'info', 'verbose', 'debug', 'trace'];

interface Bucket {
  startTime: number;
  endTime: number;
  counts: Record<string, number>;
  total: number;
}

interface TooltipData {
  x: number;
  y: number;
  bucket: Bucket;
}

export class DGrepTimeHistogram {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tooltipEl: HTMLElement;
  private selectionEl: HTMLElement;

  private rows: Record<string, any>[] = [];
  private timeColumn = '';
  private severityColumn = '';
  private buckets: Bucket[] = [];
  private minTime = 0;
  private maxTime = 0;

  // View range (for zoom)
  private viewStart = 0;
  private viewEnd = 0;

  // Interaction state
  private dragStart: number | null = null;
  private dragEnd: number | null = null;
  private isDragging = false;
  private hoveredBucket: number | null = null;

  // Callbacks
  private timeRangeSelectCallback: ((start: Date, end: Date) => void) | null = null;

  private resizeObserver: ResizeObserver;
  private rafId = 0;
  private destroyed = false;

  // Layout constants
  private readonly PADDING_TOP = 4;
  private readonly PADDING_BOTTOM = 18;
  private readonly PADDING_LEFT = 36;
  private readonly PADDING_RIGHT = 8;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'dgrep-histogram-container';
    parent.appendChild(this.container);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'dgrep-histogram-canvas';
    this.container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d')!;

    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'dgrep-histogram-tooltip';
    this.tooltipEl.style.display = 'none';
    this.container.appendChild(this.tooltipEl);

    this.selectionEl = document.createElement('div');
    this.selectionEl.className = 'dgrep-histogram-selection';
    this.selectionEl.style.display = 'none';
    this.container.appendChild(this.selectionEl);

    this.resizeObserver = new ResizeObserver(() => this.scheduleRender());
    this.resizeObserver.observe(this.container);

    this.attachInteractions();
  }

  onTimeRangeSelect(cb: (start: Date, end: Date) => void): void {
    this.timeRangeSelectCallback = cb;
  }

  setData(rows: Record<string, any>[], timeColumn: string, severityColumn: string): void {
    this.rows = rows;
    this.timeColumn = timeColumn;
    this.severityColumn = severityColumn;

    if (rows.length === 0) {
      this.buckets = [];
      this.showEmpty();
      return;
    }

    // Parse timestamps
    const times: number[] = [];
    for (const row of rows) {
      const t = row[timeColumn];
      if (!t) continue;
      const d = new Date(String(t));
      if (!isNaN(d.getTime())) times.push(d.getTime());
    }

    if (times.length === 0) {
      this.buckets = [];
      this.showEmpty();
      return;
    }

    // Use loop instead of Math.min/max(...) to avoid stack overflow on large arrays
    let minT = times[0], maxT = times[0];
    for (let i = 1; i < times.length; i++) {
      if (times[i] < minT) minT = times[i];
      if (times[i] > maxT) maxT = times[i];
    }
    this.minTime = minT;
    this.maxTime = maxT;
    this.viewStart = this.minTime;
    this.viewEnd = this.maxTime;

    this.computeBuckets();
    this.hideEmpty();
    this.scheduleRender();
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver.disconnect();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.container.remove();
  }

  // ==================== Bucket computation ====================

  private computeBuckets(): void {
    const chartWidth = this.canvas.clientWidth - this.PADDING_LEFT - this.PADDING_RIGHT;
    const numBuckets = Math.max(10, Math.min(120, Math.floor(chartWidth / 4)));
    const range = this.viewEnd - this.viewStart;
    if (range <= 0) {
      this.buckets = [];
      return;
    }
    const bucketSize = range / numBuckets;

    const buckets: Bucket[] = [];
    for (let i = 0; i < numBuckets; i++) {
      buckets.push({
        startTime: this.viewStart + i * bucketSize,
        endTime: this.viewStart + (i + 1) * bucketSize,
        counts: {},
        total: 0,
      });
    }

    for (const row of this.rows) {
      const t = row[this.timeColumn];
      if (!t) continue;
      const d = new Date(String(t));
      const ms = d.getTime();
      if (isNaN(ms) || ms < this.viewStart || ms > this.viewEnd) continue;

      const idx = Math.min(numBuckets - 1, Math.floor((ms - this.viewStart) / bucketSize));
      const sev = String(row[this.severityColumn] ?? '').toLowerCase().trim();
      buckets[idx].counts[sev] = (buckets[idx].counts[sev] || 0) + 1;
      buckets[idx].total++;
    }

    this.buckets = buckets;
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

    if (w === 0 || h === 0) return;

    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    if (this.buckets.length === 0) return;

    const chartX = this.PADDING_LEFT;
    const chartY = this.PADDING_TOP;
    const chartW = w - this.PADDING_LEFT - this.PADDING_RIGHT;
    const chartH = h - this.PADDING_TOP - this.PADDING_BOTTOM;

    if (chartW <= 0 || chartH <= 0) return;

    // Find max total for scaling
    const maxCount = Math.max(1, ...this.buckets.map(b => b.total));
    const barWidth = chartW / this.buckets.length;
    const barGap = Math.max(0.5, barWidth * 0.1);

    // Draw bars
    for (let i = 0; i < this.buckets.length; i++) {
      const bucket = this.buckets[i];
      const x = chartX + i * barWidth;
      const bw = barWidth - barGap;

      if (bucket.total === 0) continue;

      // Stack severities in order
      let yOffset = 0;
      const sortedKeys = this.sortSeverityKeys(Object.keys(bucket.counts));

      for (const sev of sortedKeys) {
        const count = bucket.counts[sev];
        const barH = (count / maxCount) * chartH;
        const y = chartY + chartH - yOffset - barH;

        ctx.fillStyle = SEVERITY_COLORS_CANVAS[sev] || DEFAULT_BAR_COLOR;
        ctx.fillRect(x + barGap / 2, y, bw, barH);
        yOffset += barH;
      }

      // Hover highlight
      if (this.hoveredBucket === i) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fillRect(x + barGap / 2, chartY, bw, chartH);
      }
    }

    // Draw axes
    this.renderXAxis(ctx, chartX, chartY + chartH, chartW);
    this.renderYAxis(ctx, chartX, chartY, chartH, maxCount);

    // Draw selection overlay
    if (this.isDragging && this.dragStart != null && this.dragEnd != null) {
      const sx = Math.min(this.dragStart, this.dragEnd);
      const ex = Math.max(this.dragStart, this.dragEnd);
      ctx.fillStyle = 'rgba(31, 111, 235, 0.2)';
      ctx.fillRect(sx, chartY, ex - sx, chartH);
      ctx.strokeStyle = 'rgba(31, 111, 235, 0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx, chartY, ex - sx, chartH);
    }
  }

  private renderXAxis(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
    const range = this.viewEnd - this.viewStart;
    if (range <= 0) return;

    ctx.fillStyle = '#8b949e';
    ctx.font = '10px "Cascadia Code", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // Determine label format
    const formatTime = (ms: number): string => {
      const d = new Date(ms);
      if (range < 60 * 1000) {
        return `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}:${d.getUTCSeconds().toString().padStart(2, '0')}`;
      } else if (range < 24 * 60 * 60 * 1000) {
        return `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}`;
      } else {
        return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}`;
      }
    };

    // Draw 4-6 labels
    const numLabels = Math.min(6, Math.max(2, Math.floor(w / 90)));
    for (let i = 0; i <= numLabels; i++) {
      const t = this.viewStart + (range * i) / numLabels;
      const lx = x + (w * i) / numLabels;
      ctx.fillText(formatTime(t), lx, y + 3);
    }
  }

  private renderYAxis(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, maxCount: number): void {
    ctx.fillStyle = '#8b949e';
    ctx.font = '10px "Cascadia Code", Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    // Draw 3 labels: 0, mid, max
    const labels = [0, Math.round(maxCount / 2), maxCount];
    for (const val of labels) {
      const ly = y + h - (val / maxCount) * h;
      const label = val >= 1000 ? `${(val / 1000).toFixed(1)}k` : String(val);
      ctx.fillText(label, x - 4, ly);
    }
  }

  private sortSeverityKeys(keys: string[]): string[] {
    return keys.sort((a, b) => {
      const ai = SEVERITY_ORDER.indexOf(a);
      const bi = SEVERITY_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }

  private showEmpty(): void {
    let emptyEl = this.container.querySelector('.dgrep-histogram-empty') as HTMLElement;
    if (!emptyEl) {
      emptyEl = document.createElement('div');
      emptyEl.className = 'dgrep-histogram-empty';
      emptyEl.textContent = 'No time data available';
      this.container.appendChild(emptyEl);
    }
    emptyEl.style.display = '';
    this.canvas.style.display = 'none';
  }

  private hideEmpty(): void {
    const emptyEl = this.container.querySelector('.dgrep-histogram-empty') as HTMLElement;
    if (emptyEl) emptyEl.style.display = 'none';
    this.canvas.style.display = '';
  }

  // ==================== Interactions ====================

  private attachInteractions(): void {
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('mouseleave', () => this.handleMouseLeave());
    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    this.canvas.addEventListener('dblclick', () => this.handleDoubleClick());
    this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });

    document.addEventListener('mousemove', (e) => {
      if (this.isDragging) this.handleDragMove(e);
    });
    document.addEventListener('mouseup', () => {
      if (this.isDragging) this.handleDragEnd();
    });
  }

  private getBucketAtX(clientX: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left - this.PADDING_LEFT;
    const chartW = rect.width - this.PADDING_LEFT - this.PADDING_RIGHT;
    if (x < 0 || x >= chartW || this.buckets.length === 0) return null;
    return Math.min(this.buckets.length - 1, Math.floor((x / chartW) * this.buckets.length));
  }

  private handleMouseMove(e: MouseEvent): void {
    if (this.isDragging) return;
    const idx = this.getBucketAtX(e.clientX);
    this.hoveredBucket = idx;
    this.scheduleRender();

    if (idx != null && this.buckets[idx]) {
      this.showTooltip(e, this.buckets[idx]);
    } else {
      this.hideTooltip();
    }
  }

  private handleMouseLeave(): void {
    if (!this.isDragging) {
      this.hoveredBucket = null;
      this.hideTooltip();
      this.scheduleRender();
    }
  }

  private handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    const rect = this.canvas.getBoundingClientRect();
    this.dragStart = e.clientX - rect.left;
    this.dragEnd = this.dragStart;
    this.isDragging = true;
    this.hideTooltip();
  }

  private handleDragMove(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dragEnd = e.clientX - rect.left;
    this.scheduleRender();
  }

  private handleDragEnd(): void {
    if (!this.isDragging || this.dragStart == null || this.dragEnd == null) {
      this.isDragging = false;
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const chartW = rect.width - this.PADDING_LEFT - this.PADDING_RIGHT;
    const range = this.viewEnd - this.viewStart;

    const startFrac = Math.max(0, Math.min(1, (Math.min(this.dragStart, this.dragEnd) - this.PADDING_LEFT) / chartW));
    const endFrac = Math.max(0, Math.min(1, (Math.max(this.dragStart, this.dragEnd) - this.PADDING_LEFT) / chartW));

    this.isDragging = false;
    this.dragStart = null;
    this.dragEnd = null;

    // Only trigger if drag was meaningful (at least 5px)
    if (Math.abs(endFrac - startFrac) * chartW < 5) {
      this.scheduleRender();
      return;
    }

    const newStart = new Date(this.viewStart + range * startFrac);
    const newEnd = new Date(this.viewStart + range * endFrac);

    this.timeRangeSelectCallback?.(newStart, newEnd);

    // Zoom to selection
    this.viewStart = newStart.getTime();
    this.viewEnd = newEnd.getTime();
    this.computeBuckets();
    this.scheduleRender();
  }

  private handleDoubleClick(): void {
    // Reset to full range
    this.viewStart = this.minTime;
    this.viewEnd = this.maxTime;
    this.computeBuckets();
    this.scheduleRender();

    // Emit full range
    this.timeRangeSelectCallback?.(new Date(this.minTime), new Date(this.maxTime));
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();

    const rect = this.canvas.getBoundingClientRect();
    const chartW = rect.width - this.PADDING_LEFT - this.PADDING_RIGHT;
    const mouseX = e.clientX - rect.left - this.PADDING_LEFT;
    const frac = Math.max(0, Math.min(1, mouseX / chartW));

    const range = this.viewEnd - this.viewStart;
    const zoomFactor = e.deltaY > 0 ? 1.2 : 0.8;
    const newRange = Math.max(1000, Math.min(this.maxTime - this.minTime, range * zoomFactor));

    const pivot = this.viewStart + range * frac;
    this.viewStart = Math.max(this.minTime, pivot - newRange * frac);
    this.viewEnd = Math.min(this.maxTime, pivot + newRange * (1 - frac));

    this.computeBuckets();
    this.scheduleRender();
  }

  // ==================== Tooltip ====================

  private showTooltip(e: MouseEvent, bucket: Bucket): void {
    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const startStr = this.formatTooltipTime(bucket.startTime);
    const endStr = this.formatTooltipTime(bucket.endTime);

    const sortedKeys = this.sortSeverityKeys(Object.keys(bucket.counts));
    const lines = sortedKeys.map(sev => {
      const color = SEVERITY_COLORS_CANVAS[sev] || DEFAULT_BAR_COLOR;
      return `<span style="color:${color}">${sev}: ${bucket.counts[sev]}</span>`;
    });

    this.tooltipEl.innerHTML = `
      <div style="margin-bottom:2px;font-weight:600">${startStr} - ${endStr}</div>
      <div>Total: ${bucket.total}</div>
      ${lines.join('<br>')}
    `;

    // Position tooltip
    const tw = this.tooltipEl.offsetWidth || 150;
    let tx = x + 12;
    if (tx + tw > rect.width) tx = x - tw - 12;

    this.tooltipEl.style.left = `${tx}px`;
    this.tooltipEl.style.top = `${Math.max(0, y - 10)}px`;
    this.tooltipEl.style.display = 'block';
  }

  private hideTooltip(): void {
    this.tooltipEl.style.display = 'none';
  }

  private formatTooltipTime(ms: number): string {
    const d = new Date(ms);
    return `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}:${d.getUTCSeconds().toString().padStart(2, '0')}`;
  }
}
