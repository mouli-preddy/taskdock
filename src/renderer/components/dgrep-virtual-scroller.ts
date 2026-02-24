import type { FilterCondition } from './dgrep-results-table.js';
import { getIcon, Filter } from '../utils/icons.js';

const MAX_CELL_CHARS = 200;

export interface VScrollerOptions {
  rowHeight?: number;
  bufferRows?: number;
}

export interface VScrollerCallbacks {
  onRowClick?: (index: number, event: MouseEvent) => void;
  onRowRightClick?: (index: number, event: MouseEvent) => void;
  onCellCtrlClick?: (index: number, column: string, value: string) => void;
  onCellDoubleClick?: (index: number, column: string, value: string, event?: MouseEvent) => void;
  onScroll?: (startIndex: number, endIndex: number) => void;
  onColumnFilterClick?: (column: string, rect: DOMRect) => void;
}

// Severity level colors
const SEVERITY_COLORS: Record<string, string> = {
  'error': '#f85149',
  'critical': '#f85149',
  'fatal': '#f85149',
  'warning': '#e5a100',
  'warn': '#e5a100',
  'information': '',
  'info': '',
  'verbose': '#8b949e',
  'debug': '#8b949e',
  'trace': '#6e7681',
};

export class DGrepVirtualScroller {
  private container: HTMLElement;
  private headerEl: HTMLElement;
  private scrollEl: HTMLElement;
  private spacerEl: HTMLElement;
  private rowHeight: number;
  private bufferRows: number;

  private columns: string[] = [];
  private rows: Record<string, any>[] = [];
  private visibleColumns: Set<string> = new Set();
  private columnWidths: Map<string, number> = new Map();

  private selectedRow: number | null = null;
  private bookmarks: Set<number> = new Set();
  private anomalies: Set<number> = new Set();

  private wrapMessage = false;
  private clientFilter = '';
  private clientFilterIsRegex = false;
  private sortColumn: string | null = null;
  private sortDir: 'asc' | 'desc' = 'asc';

  // Rendered row cache: maps row index to DOM element
  private renderedRows: Map<number, HTMLElement> = new Map();
  private visibleStart = 0;
  private visibleEnd = 0;

  private rafId: number | null = null;
  private callbacks: VScrollerCallbacks = {};

  // Highlight conditions for cell coloring
  private highlightConditions: FilterCondition[] = [];

  // Active column filters (columns that currently have a filter applied)
  private activeColumnFilters: Set<string> = new Set();

  // Column resize state
  private resizingCol: string | null = null;
  private resizeStartX = 0;
  private resizeStartW = 0;

  constructor(parent: HTMLElement, options: VScrollerOptions = {}) {
    this.rowHeight = options.rowHeight ?? 24;
    this.bufferRows = options.bufferRows ?? 20;

    this.container = document.createElement('div');
    this.container.className = 'dgrep-vscroll-wrapper';
    this.container.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';

    // Sticky header (not part of scroll)
    this.headerEl = document.createElement('div');
    this.headerEl.className = 'dgrep-vscroll-header';
    this.container.appendChild(this.headerEl);

    // Scroll container
    this.scrollEl = document.createElement('div');
    this.scrollEl.className = 'dgrep-vscroll-container';
    this.container.appendChild(this.scrollEl);

    // Spacer sets total scroll height
    this.spacerEl = document.createElement('div');
    this.spacerEl.className = 'dgrep-vscroll-spacer';
    this.scrollEl.appendChild(this.spacerEl);

    parent.appendChild(this.container);

    this.scrollEl.addEventListener('scroll', this.onScrollEvent, { passive: true });
  }

  setCallbacks(cb: VScrollerCallbacks): void {
    this.callbacks = cb;
  }

  setData(
    columns: string[],
    rows: Record<string, any>[],
    visibleColumns: Set<string>,
    columnWidths: Map<string, number>,
  ): void {
    this.columns = columns;
    this.rows = rows;
    this.visibleColumns = visibleColumns;
    this.columnWidths = columnWidths;
    this.updateSpacerHeight();
    this.renderHeader();
    this.clearRenderedRows();
    this.renderVisibleRows();
  }

  setSelectedRow(index: number | null): void {
    const prev = this.selectedRow;
    this.selectedRow = index;
    // Update only affected rows
    if (prev != null) this.updateRowStyle(prev);
    if (index != null) this.updateRowStyle(index);
  }

  setBookmarks(indices: Set<number>): void {
    const prev = new Set(this.bookmarks);
    this.bookmarks = indices;
    // Update changed rows
    for (const i of prev) if (!indices.has(i)) this.updateRowStyle(i);
    for (const i of indices) if (!prev.has(i)) this.updateRowStyle(i);
  }

  setAnomalies(indices: Set<number>): void {
    const prev = new Set(this.anomalies);
    this.anomalies = indices;
    for (const i of prev) if (!indices.has(i)) this.updateRowStyle(i);
    for (const i of indices) if (!prev.has(i)) this.updateRowStyle(i);
  }

  setWrapMessage(wrap: boolean): void {
    this.wrapMessage = wrap;
    this.clearRenderedRows();
    this.renderVisibleRows();
  }

  setClientFilter(filter: string, isRegex = false): void {
    this.clientFilter = filter.trim();
    this.clientFilterIsRegex = isRegex;
    // Re-render all visible rows for highlighting
    this.clearRenderedRows();
    this.renderVisibleRows();
  }

  setSortIndicator(column: string | null, dir: 'asc' | 'desc'): void {
    this.sortColumn = column;
    this.sortDir = dir;
    this.renderHeader();
  }

  setHighlightConditions(conditions: FilterCondition[]): void {
    this.highlightConditions = conditions;
    this.clearRenderedRows();
    this.renderVisibleRows();
  }

  setActiveColumnFilters(columns: Set<string>): void {
    this.activeColumnFilters = columns;
    this.renderHeader();
  }

  /** Check if a cell matches a highlight condition */
  private cellMatchesHighlight(hc: FilterCondition, col: string, cellValue: string, row: Record<string, any>): boolean {
    // Text-based conditions match across all columns
    if (hc.column === '__text__') {
      const rowText = this.columns.map(c => String(row[c] ?? '')).join(' ').toLowerCase();
      if (hc.isRegex) {
        try { return new RegExp(hc.value, 'i').test(rowText); } catch { return false; }
      }
      return rowText.includes(hc.value.toLowerCase());
    }
    // Column-specific conditions match only the specified column
    if (hc.column !== col) return false;
    const val = String(row[col] ?? '');
    if (hc.isRegex) {
      try { return new RegExp(hc.value, 'i').test(val); } catch { return false; }
    }
    return hc.exclude ? val !== hc.value : val === hc.value;
  }

  scrollToRow(index: number): void {
    if (index < 0 || index >= this.rows.length) return;
    const targetTop = index * this.rowHeight;
    const viewportHeight = this.scrollEl.clientHeight;
    // Center the row in the viewport
    this.scrollEl.scrollTop = Math.max(0, targetTop - viewportHeight / 2 + this.rowHeight / 2);
  }

  getVisibleRange(): { start: number; end: number } {
    return { start: this.visibleStart, end: this.visibleEnd };
  }

  getScrollElement(): HTMLElement {
    return this.scrollEl;
  }

  /** Refresh all visible rows after data mutation (sort, filter change) */
  refresh(): void {
    this.updateSpacerHeight();
    this.clearRenderedRows();
    this.renderVisibleRows();
  }

  destroy(): void {
    this.scrollEl.removeEventListener('scroll', this.onScrollEvent);
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.container.remove();
  }

  // ==================== Internal ====================

  private onScrollEvent = (): void => {
    if (this.rafId != null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.renderVisibleRows();
    });
  };

  private updateSpacerHeight(): void {
    this.spacerEl.style.height = `${this.rows.length * this.rowHeight}px`;
  }

  private clearRenderedRows(): void {
    for (const el of this.renderedRows.values()) {
      el.remove();
    }
    this.renderedRows.clear();
  }

  private renderVisibleRows(): void {
    const scrollTop = this.scrollEl.scrollTop;
    const viewportHeight = this.scrollEl.clientHeight;

    const firstVisible = Math.floor(scrollTop / this.rowHeight);
    const lastVisible = Math.ceil((scrollTop + viewportHeight) / this.rowHeight);

    const start = Math.max(0, firstVisible - this.bufferRows);
    const end = Math.min(this.rows.length, lastVisible + this.bufferRows);

    this.visibleStart = firstVisible;
    this.visibleEnd = Math.min(this.rows.length, lastVisible);

    // Remove out-of-range rows
    for (const [idx, el] of this.renderedRows) {
      if (idx < start || idx >= end) {
        el.remove();
        this.renderedRows.delete(idx);
      }
    }

    // Add new rows
    const visCols = this.columns.filter(c => this.visibleColumns.has(c));
    for (let i = start; i < end; i++) {
      if (!this.renderedRows.has(i)) {
        const el = this.createRowElement(i, visCols);
        this.scrollEl.appendChild(el);
        this.renderedRows.set(i, el);
      }
    }

    this.callbacks.onScroll?.(this.visibleStart, this.visibleEnd);
  }

  private createRowElement(index: number, visCols: string[]): HTMLElement {
    const row = this.rows[index];
    const el = document.createElement('div');
    el.className = 'dgrep-vscroll-row';
    el.style.top = `${index * this.rowHeight}px`;
    el.style.height = `${this.rowHeight}px`;
    el.dataset.rowIdx = String(index);

    // Severity
    const severity = this.getSeverityLevel(row);
    if (severity.includes('error') || severity.includes('critical') || severity.includes('fatal')) {
      el.classList.add('dgrep-row-error');
    } else if (severity.includes('warn')) {
      el.classList.add('dgrep-row-warning');
    }

    // Zebra striping
    if (index % 2 === 1) el.classList.add('dgrep-row-alt');

    // Selected
    if (this.selectedRow === index) el.classList.add('dgrep-row-selected');

    // Anomaly glow
    if (this.anomalies.has(index)) el.classList.add('dgrep-row-anomaly');

    // Bookmark indicator
    if (this.bookmarks.has(index)) {
      const indicator = document.createElement('div');
      indicator.className = 'dgrep-bookmark-indicator';
      el.appendChild(indicator);
    }

    // Cells
    const sevColor = this.getSeverityColor(severity);
    for (const col of visCols) {
      const raw = row[col] ?? '';
      const str = String(raw);
      const display = str.length > MAX_CELL_CHARS ? str.slice(0, MAX_CELL_CHARS) + '\u2026' : str;
      const width = this.columnWidths.get(col) ?? 150;

      const cell = document.createElement('div');
      cell.className = 'dgrep-vscroll-cell';
      cell.style.width = `${width}px`;
      cell.style.minWidth = `${Math.min(width, 60)}px`;
      cell.dataset.col = col;
      cell.title = str.slice(0, 500);

      const isSeverityCol = col === 'Level' || col === 'severityText' || col === 'level' || col === 'Severity';
      if (isSeverityCol && sevColor) {
        cell.style.color = sevColor;
        cell.style.fontWeight = '600';
      }

      const isMessageCol = col === 'Message' || col.toLowerCase() === 'message';
      if (isMessageCol && this.wrapMessage) {
        cell.classList.add('dgrep-td-wrap');
      }

      // Set HTML content with optional highlight
      const escaped = this.escapeHtml(display);
      cell.innerHTML = this.highlightMatch(escaped);

      // Apply highlight condition coloring
      for (const hc of this.highlightConditions) {
        if (this.cellMatchesHighlight(hc, col, str, row)) {
          cell.style.backgroundColor = `color-mix(in srgb, ${hc.color} 25%, transparent)`;
          cell.style.borderBottom = `2px solid ${hc.color}`;
          break; // first match wins
        }
      }

      el.appendChild(cell);
    }

    // Event handlers
    el.addEventListener('click', (e: MouseEvent) => {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+Click on a cell
        const cellEl = (e.target as HTMLElement).closest('.dgrep-vscroll-cell') as HTMLElement | null;
        if (cellEl) {
          const col = cellEl.dataset.col!;
          const value = cellEl.title || cellEl.textContent || '';
          this.callbacks.onCellCtrlClick?.(index, col, value);
        }
        return;
      }
      this.callbacks.onRowClick?.(index, e);
    });

    el.addEventListener('contextmenu', (e: MouseEvent) => {
      this.callbacks.onRowRightClick?.(index, e);
    });

    el.addEventListener('dblclick', (e: MouseEvent) => {
      e.stopPropagation();
      const cellEl = (e.target as HTMLElement).closest('.dgrep-vscroll-cell') as HTMLElement | null;
      if (cellEl) {
        const col = cellEl.dataset.col!;
        const value = cellEl.title || cellEl.textContent || '';
        this.callbacks.onCellDoubleClick?.(index, col, value, e);
      }
    });

    return el;
  }

  private updateRowStyle(index: number): void {
    const el = this.renderedRows.get(index);
    if (!el) return;

    el.classList.toggle('dgrep-row-selected', this.selectedRow === index);
    el.classList.toggle('dgrep-row-anomaly', this.anomalies.has(index));

    // Bookmark indicator
    const existingBookmark = el.querySelector('.dgrep-bookmark-indicator');
    if (this.bookmarks.has(index) && !existingBookmark) {
      const indicator = document.createElement('div');
      indicator.className = 'dgrep-bookmark-indicator';
      el.insertBefore(indicator, el.firstChild);
    } else if (!this.bookmarks.has(index) && existingBookmark) {
      existingBookmark.remove();
    }
  }

  private renderHeader(): void {
    const visCols = this.columns.filter(c => this.visibleColumns.has(c));
    const totalWidth = visCols.reduce((sum, col) =>
      sum + (this.columnWidths.get(col) ?? 150), 0);

    this.headerEl.style.minWidth = `${totalWidth}px`;
    this.headerEl.innerHTML = '';

    for (const col of visCols) {
      const width = this.columnWidths.get(col) ?? 150;
      const isSorted = col === this.sortColumn;
      const arrow = isSorted ? (this.sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';

      const th = document.createElement('div');
      th.className = `dgrep-vscroll-th${isSorted ? ' sorted' : ''}`;
      th.style.width = `${width}px`;
      th.style.minWidth = `${Math.min(width, 60)}px`;
      th.dataset.col = col;

      const label = document.createElement('span');
      label.className = 'dgrep-th-label';
      label.textContent = col + arrow;
      label.addEventListener('click', (e) => {
        e.stopPropagation();
        // Dispatch custom event for sort
        th.dispatchEvent(new CustomEvent('sort-click', { bubbles: true, detail: { column: col } }));
      });
      th.appendChild(label);

      // Filter icon (funnel SVG)
      const filterIcon = document.createElement('span');
      filterIcon.className = 'dgrep-th-filter' + (this.activeColumnFilters.has(col) ? ' active' : '');
      filterIcon.innerHTML = getIcon(Filter, 10);
      filterIcon.title = 'Filter ' + col;
      filterIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = th.getBoundingClientRect();
        this.callbacks.onColumnFilterClick?.(col, rect);
      });
      th.appendChild(filterIcon);

      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'dgrep-resize-handle';
      resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this.startResize(col, e);
      });
      th.appendChild(resizeHandle);

      this.headerEl.appendChild(th);
    }
  }

  private startResize(col: string, e: MouseEvent): void {
    this.resizingCol = col;
    this.resizeStartX = e.clientX;
    this.resizeStartW = this.columnWidths.get(col) ?? 150;

    const onMouseMove = (ev: MouseEvent) => {
      if (!this.resizingCol) return;
      const diff = ev.clientX - this.resizeStartX;
      const newWidth = Math.max(40, this.resizeStartW + diff);
      this.columnWidths.set(this.resizingCol, newWidth);

      // Update header column width
      const thEl = this.headerEl.querySelector(`[data-col="${CSS.escape(this.resizingCol)}"]`) as HTMLElement;
      if (thEl) {
        thEl.style.width = `${newWidth}px`;
        thEl.style.minWidth = `${Math.min(newWidth, 60)}px`;
      }

      // Update all rendered cells in that column
      for (const rowEl of this.renderedRows.values()) {
        const cellEl = rowEl.querySelector(`[data-col="${CSS.escape(this.resizingCol!)}"]`) as HTMLElement;
        if (cellEl) {
          cellEl.style.width = `${newWidth}px`;
          cellEl.style.minWidth = `${Math.min(newWidth, 60)}px`;
        }
      }

      // Update header total width
      const visCols = this.columns.filter(c => this.visibleColumns.has(c));
      const totalWidth = visCols.reduce((sum, c) => sum + (this.columnWidths.get(c) ?? 150), 0);
      this.headerEl.style.minWidth = `${totalWidth}px`;
    };

    const onMouseUp = () => {
      this.resizingCol = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  private getSeverityLevel(row: Record<string, any>): string {
    // Prefer text-based severity columns over numeric Level
    const level = row['severityText'] || row['Severity'] || row['level'] || '';
    if (level) return String(level).toLowerCase().trim();
    // Fallback: map numeric Level to text (DGrep convention: 2=Error, 3=Warning, 4=Info)
    const numLevel = row['Level'];
    if (numLevel != null) {
      const n = Number(numLevel);
      if (n <= 2) return 'error';
      if (n === 3) return 'warning';
      if (n === 4) return 'information';
      if (n >= 5) return 'verbose';
    }
    return '';
  }

  private getSeverityColor(level: string): string {
    for (const [key, color] of Object.entries(SEVERITY_COLORS)) {
      if (level.includes(key)) return color;
    }
    return '';
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private highlightMatch(escapedHtml: string): string {
    if (!this.clientFilter) return escapedHtml;
    try {
      let regex: RegExp;
      if (this.clientFilterIsRegex) {
        regex = new RegExp(`(${this.clientFilter})`, 'gi');
      } else {
        const escaped = this.clientFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        regex = new RegExp(`(${escaped})`, 'gi');
      }
      return escapedHtml.replace(regex, '<mark class="dgrep-highlight">$1</mark>');
    } catch {
      return escapedHtml; // Invalid regex - don't highlight
    }
  }
}
