import { DGrepColumnFilter } from './dgrep-column-filter.js';
import { DGrepJsonViewer } from './dgrep-json-viewer.js';
import { DGrepContextViewer } from './dgrep-context-viewer.js';
import { DGrepVirtualScroller } from './dgrep-virtual-scroller.js';
import { DGrepBookmarkManager } from './dgrep-bookmark-manager.js';
import { DGrepLiveTail } from './dgrep-live-tail.js';

const MAX_CELL_CHARS = 200;

type SortDir = 'asc' | 'desc';
type DetailView = 'table' | 'json';

// Pattern-based column hiding: hide columns matching these prefixes/patterns by default
const HIDDEN_PREFIXES = ['env_', '__', 'env_dt_'];
const HIDDEN_EXACT = new Set([
  'GenevaPodName',
  'severityNumber',
  'Tenant',
  'Tid',
  'Pid',
  'TIMESTAMP',
]);

function shouldHideByDefault(col: string): boolean {
  if (HIDDEN_EXACT.has(col)) return true;
  for (const prefix of HIDDEN_PREFIXES) {
    if (col.startsWith(prefix)) return true;
  }
  return false;
}

// Columns considered "essential" — always shown in "Essential" preset
const ESSENTIAL_COLUMNS = [
  'PreciseTimeStamp',
  'Message',
  'Level',
  'severityText',
  'Name',
  'ActivityId',
  'Role',
  'RoleInstance',
];

// Severity level colors for visual distinction
const SEVERITY_COLORS: Record<string, string> = {
  'error': '#f85149',
  'critical': '#f85149',
  'fatal': '#f85149',
  'warning': '#e5a100',
  'warn': '#e5a100',
  'information': '',  // default color
  'info': '',
  'verbose': '#8b949e',
  'debug': '#8b949e',
  'trace': '#6e7681',
};

// Column width hints based on expected content
const COLUMN_WIDTHS: Record<string, number> = {
  'PreciseTimeStamp': 190,
  'TIMESTAMP': 190,
  'Message': 500,
  'Level': 60,
  'severityText': 80,
  'severityNumber': 50,
  'Name': 160,
  'ActivityId': 200,
  'Role': 120,
  'RoleInstance': 140,
  'Tid': 50,
  'Pid': 50,
  'Tenant': 100,
  'env_time': 190,
  'env_name': 120,
  'env_ver': 60,
  '__SourceEvent__': 120,
  '__SourceMoniker__': 120,
  '__SearchWorker__': 100,
  'GenevaPodName': 120,
};

const DEFAULT_COL_WIDTH = 150;

// Sparkline block characters for frequency visualization
const SPARK_BLOCKS = ['\u2581', '\u2582', '\u2583', '\u2584', '\u2585', '\u2586', '\u2587', '\u2588'];

export interface DetectedPattern {
  normalized: string;
  displayText: string;
  count: number;
  rowIndices: number[];
  sparkline: string;
}

interface ActiveFilter {
  column: string;
  value: string;
}

export interface FilterCondition {
  id: string;
  column: string;       // column name (or '__text__' for text filter)
  value: string;        // value to match
  isRegex: boolean;     // whether value is a regex pattern
  mode: 'filter' | 'highlight';
  exclude?: boolean;    // true for != filters
  color: string;        // highlight color (from palette)
}

const HIGHLIGHT_COLORS = [
  '#e5a100', // yellow/amber
  '#58a6ff', // blue
  '#3fb950', // green
  '#f78166', // orange
  '#d2a8ff', // purple
  '#ff7b72', // red
  '#79c0ff', // light blue
  '#7ee787', // light green
];

export class DGrepResultsTable {
  private container: HTMLElement;
  private columns: string[] = [];
  private rows: Record<string, any>[] = [];
  private visibleColumns: Set<string> = new Set();
  private columnWidths: Map<string, number> = new Map();
  private sortColumn: string | null = null;
  private sortDir: SortDir = 'asc';
  private clientFilter = '';
  private clientFilterIsRegex = false;
  private clientFilterRegex: RegExp | null = null; // Compiled regex (cached for performance)
  private filteredRows: Record<string, any>[] = [];
  private columnDropdownOpen = false;
  private columnSearchText = '';
  private selectedRowIndex: number | null = null; // For detail panel
  private gotoRowOpen = false;

  // Column preset tracking
  private activePreset: 'essential' | 'all' | 'custom' = 'essential';

  // Pattern detection state
  private patterns: DetectedPattern[] = [];
  private patternsDropdownOpen = false;
  private activePatternFilter: DetectedPattern | null = null;

  // Quick value filters (Ctrl+Click)
  private activeFilters: ActiveFilter[] = [];

  // Unified filter/highlight conditions
  private conditions: FilterCondition[] = [];
  private highlightColorIndex = 0;

  // Context menu state
  private contextMenuEl: HTMLElement | null = null;

  // Time range filter from histogram
  private timeRangeStart: Date | null = null;
  private timeRangeEnd: Date | null = null;

  // Column filters (per-column checkbox filters)
  private columnFilters: Map<string, Set<string>> = new Map();
  private activeColumnFilter: DGrepColumnFilter | null = null;

  // Detail panel view mode
  private detailView: DetailView = 'table';
  private detailDock: 'bottom' | 'right' = 'bottom';
  private detailHeight = 250;
  private detailWidth = 350;
  private detailResizing = false;
  private jsonViewer: DGrepJsonViewer | null = null;
  private contextViewer: DGrepContextViewer | null = null;

  // Context viewer callback
  onFetchContext: ((sessionId: string, rowIndex: number, count: number) => void) | null = null;

  // Callback when column visibility changes (used for preset persistence)
  onColumnVisibilityChange: ((visibleColumns: string[]) => void) | null = null;

  // Callback for summary panel data
  private onDataChangeCallback: ((columns: string[], rows: Record<string, any>[], filteredRows: Record<string, any>[]) => void) | null = null;
  private onRowExpandCallback: ((rowIndex: number) => void) | null = null;

  // Bound handlers for document-level listeners (to allow cleanup)
  private boundDocMouseDown: ((e: MouseEvent) => void) | null = null;

  // Virtual scroller and sub-components
  private scroller!: DGrepVirtualScroller;
  private bookmarkManager!: DGrepBookmarkManager;
  private liveTail!: DGrepLiveTail;

  // DOM refs for layout areas
  private toolbarEl!: HTMLElement;
  private filtersBarEl!: HTMLElement;
  private scrollerWrapper!: HTMLElement;
  private scrollerArea!: HTMLElement;
  private detailArea!: HTMLElement;
  private minimapSlot!: HTMLElement;
  private contentArea!: HTMLElement; // flex container for scroller + detail (changes direction based on dock)

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'dgrep-results-table-container';
    this.container.setAttribute('tabindex', '0');
    parent.appendChild(this.container);

    // Single document-level mousedown handler (added ONCE, not per render)
    this.boundDocMouseDown = (e: MouseEvent) => {
      if (this.columnDropdownOpen && !this.container.querySelector('.dgrep-column-picker')?.contains(e.target as Node)) {
        this.columnDropdownOpen = false;
        this.columnSearchText = '';
        this.renderToolbar();
      }
      if (this.patternsDropdownOpen && !this.container.querySelector('.dgrep-pattern-picker')?.contains(e.target as Node)) {
        this.patternsDropdownOpen = false;
        this.renderToolbar();
      }
      // Close context menu on outside click
      if (this.contextMenuEl && !this.contextMenuEl.contains(e.target as Node)) {
        this.closeContextMenu();
      }
    };
    document.addEventListener('mousedown', this.boundDocMouseDown);

    // Close context menu on Escape
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.contextMenuEl) {
        this.closeContextMenu();
      }
    });

    this.buildLayout();
    this.renderToolbar();
    this.renderFiltersBar();
  }

  /** Register a callback for when data changes (used by AI summary panel) */
  onDataChange(cb: (columns: string[], rows: Record<string, any>[], filteredRows: Record<string, any>[]) => void): void {
    this.onDataChangeCallback = cb;
  }

  /** Register a callback for when a row is expanded (detail panel opened). */
  onRowExpand(cb: (rowIndex: number) => void): void {
    this.onRowExpandCallback = cb;
  }

  setData(columns: string[], rows: Record<string, any>[]): void {
    const isNewQuery = this.columns.length === 0 ||
      columns.join(',') !== this.columns.join(',');

    this.columns = columns;
    this.rows = rows;

    if (isNewQuery) {
      // Smart defaults: hide internal/metadata columns using pattern matching
      this.visibleColumns = new Set(
        columns.filter(c => !shouldHideByDefault(c))
      );
      // Initialize column widths from presets
      this.columnWidths.clear();
      for (const col of columns) {
        this.columnWidths.set(col, COLUMN_WIDTHS[col] ?? this.guessColumnWidth(col));
      }
      // Default sort by timestamp column when available
      const timeCol = columns.find(c => c === 'PreciseTimeStamp')
        || columns.find(c => c === 'TIMESTAMP')
        || columns.find(c => c.toLowerCase().includes('timestamp'));
      this.sortColumn = timeCol ?? null;
      this.sortDir = 'asc';
      this.selectedRowIndex = null;
      this.activePatternFilter = null;
      this.activeFilters = [];
      this.conditions = [];
      this.highlightColorIndex = 0;
    }

    // Detect patterns whenever data changes
    this.detectPatterns();
    this.applyFilter();
  }

  setClientFilter(text: string, isRegex = false): void {
    this.clientFilter = text.trim();
    this.clientFilterIsRegex = isRegex;
    // Pre-compile regex for performance (avoid creating RegExp per row)
    if (isRegex && this.clientFilter) {
      try { this.clientFilterRegex = new RegExp(this.clientFilter, 'i'); } catch { this.clientFilterRegex = null; }
    } else {
      this.clientFilterRegex = null;
    }
    this.applyFilter();
  }

  setTimeRangeFilter(start: Date, end: Date): void {
    // If the range covers the full data, remove the filter
    const allTimestamps = this.rows.map(r => {
      const col = this.findTimeColumn();
      if (!col) return 0;
      const d = new Date(String(r[col] ?? ''));
      return isNaN(d.getTime()) ? 0 : d.getTime();
    }).filter(t => t > 0);
    let dataMin = 0, dataMax = 0;
    if (allTimestamps.length > 0) {
      dataMin = allTimestamps[0]; dataMax = allTimestamps[0];
      for (let i = 1; i < allTimestamps.length; i++) {
        if (allTimestamps[i] < dataMin) dataMin = allTimestamps[i];
        if (allTimestamps[i] > dataMax) dataMax = allTimestamps[i];
      }
    }

    if (start.getTime() <= dataMin && end.getTime() >= dataMax) {
      this.timeRangeStart = null;
      this.timeRangeEnd = null;
    } else {
      this.timeRangeStart = start;
      this.timeRangeEnd = end;
    }
    this.applyFilter();
  }

  private findTimeColumn(): string | null {
    return this.columns.find(c => c === 'PreciseTimeStamp')
      || this.columns.find(c => c === 'TIMESTAMP')
      || this.columns.find(c => c.toLowerCase().includes('timestamp'))
      || null;
  }

  /** Scroll to the first row at or after the given time */
  scrollToTime(time: Date): void {
    const col = this.findTimeColumn();
    if (!col || this.filteredRows.length === 0) return;
    const target = time.getTime();
    // Binary search for first row >= target (rows are sorted by timestamp)
    let lo = 0, hi = this.filteredRows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const d = new Date(String(this.filteredRows[mid][col] ?? ''));
      if (!isNaN(d.getTime()) && d.getTime() < target) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const bestIndex = Math.min(lo, this.filteredRows.length - 1);
    this.selectedRowIndex = bestIndex;
    this.scroller.setSelectedRow(bestIndex);
    this.scroller.scrollToRow(bestIndex);
    this.renderDetailPanel();
  }

  getRowCount(): number {
    return this.filteredRows.length;
  }

  /** Get all rows (unfiltered) for external analysis */
  getAllRows(): Record<string, any>[] {
    return this.rows;
  }

  /** Get all columns for external analysis */
  getColumns(): string[] {
    return this.columns;
  }

  /** Get filtered rows for external analysis */
  getFilteredRows(): Record<string, any>[] {
    return this.filteredRows;
  }

  /** Get detected patterns for external analysis */
  getPatterns(): DetectedPattern[] {
    return this.patterns;
  }

  /** Get the names of currently visible columns (in column order) */
  getVisibleColumnNames(): string[] {
    return this.columns.filter(c => this.visibleColumns.has(c));
  }

  /** Set visible columns from a saved list of names */
  setVisibleColumnNames(names: string[]): void {
    const nameSet = new Set(names);
    this.visibleColumns = new Set(this.columns.filter(c => nameSet.has(c)));
    this.updateScroller();
    this.renderToolbar();
  }

  /** Set column filters from external components (e.g., column filter dropdown) */
  setColumnFilters(filters: Map<string, Set<string>>): void {
    this.columnFilters = filters;
    this.applyFilter();
  }

  /** Get current column filters */
  getColumnFilters(): Map<string, Set<string>> {
    return this.columnFilters;
  }

  getMinimapSlot(): HTMLElement | null {
    return this.minimapSlot;
  }

  getScrollContainer(): HTMLElement | null {
    return this.scroller?.getScrollElement() ?? null;
  }

  /** Clear all data, filters, and patterns — reset to empty state */
  clearData(): void {
    this.rows = [];
    this.filteredRows = [];
    this.columns = [];
    this.patterns = [];
    this.activePatternFilter = null;
    this.activeFilters = [];
    this.conditions = [];
    this.highlightColorIndex = 0;
    this.columnFilters.clear();
    if (this.activeColumnFilter) {
      this.activeColumnFilter.destroy();
      this.activeColumnFilter = null;
    }
    this.timeRangeStart = null;
    this.timeRangeEnd = null;
    this.selectedRowIndex = null;
    this.sortColumn = null;
    this.sortDir = 'asc';
    this.clientFilter = '';
    this.activePreset = 'essential';
    // Don't clear visibleColumns/columnWidths - they'll be re-initialized by setData()
    // Clearing them here would save an empty column preset via onColumnVisibilityChange
    this.onDataChangeCallback?.(this.columns, this.rows, this.filteredRows);
    this.updateScroller();
    this.renderToolbar();
    this.renderFiltersBar();
    this.renderDetailPanel();
  }

  /** Get the live tail component for external control */
  getLiveTail(): DGrepLiveTail {
    return this.liveTail;
  }

  /** Append rows from live tail */
  appendRows(newRows: Record<string, any>[]): void {
    this.rows = this.rows.concat(newRows);
    this.applyFilter();
    this.liveTail.onNewRows(newRows.length);
  }

  exportCsv(): void {
    if (this.columns.length === 0) return;

    const visibleCols = this.columns.filter(c => this.visibleColumns.has(c));
    const lines: string[] = [];

    // Header
    lines.push(visibleCols.map(c => this.csvEscape(c)).join(','));

    // Rows
    for (const row of this.filteredRows) {
      const values = visibleCols.map(c => this.csvEscape(String(row[c] ?? '')));
      lines.push(values.join(','));
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dgrep-results-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ==================== Pattern Detection ====================

  private detectPatterns(): void {
    this.patterns = [];
    if (this.rows.length === 0) return;

    // Find the message column
    const msgCol = this.columns.find(c =>
      c === 'Message' || c === 'message' || c.toLowerCase() === 'msg'
    );
    if (!msgCol) return;

    // Find the timestamp column for sparklines
    const timeCol = this.columns.find(c =>
      c === 'PreciseTimeStamp' || c === 'TIMESTAMP' || c.toLowerCase().includes('timestamp')
    );

    // Normalize and group messages
    const groups = new Map<string, { display: string; indices: number[] }>();

    for (let i = 0; i < this.rows.length; i++) {
      const raw = String(this.rows[i][msgCol] ?? '');
      const prefix = raw.slice(0, 80);
      const normalized = this.normalizeMessage(prefix);

      const existing = groups.get(normalized);
      if (existing) {
        existing.indices.push(i);
      } else {
        groups.set(normalized, {
          display: prefix.length < raw.length ? prefix + '...' : prefix,
          indices: [i],
        });
      }
    }

    // Parse timestamps for sparkline computation
    let timestamps: number[] = [];
    if (timeCol) {
      timestamps = this.rows.map(r => {
        const t = r[timeCol];
        if (!t) return 0;
        const d = new Date(String(t));
        return isNaN(d.getTime()) ? 0 : d.getTime();
      });
    }

    const validTimestamps = timestamps.filter(t => t > 0);
    let minTime = 0, maxTime = 0;
    if (validTimestamps.length > 0) {
      minTime = validTimestamps[0]; maxTime = validTimestamps[0];
      for (let i = 1; i < validTimestamps.length; i++) {
        if (validTimestamps[i] < minTime) minTime = validTimestamps[i];
        if (validTimestamps[i] > maxTime) maxTime = validTimestamps[i];
      }
    }

    // Convert to sorted array of patterns (count desc)
    const patternList: DetectedPattern[] = [];
    for (const [norm, group] of groups) {
      if (group.indices.length < 2) continue; // Only show patterns with 2+ occurrences
      patternList.push({
        normalized: norm,
        displayText: group.display,
        count: group.indices.length,
        rowIndices: group.indices,
        sparkline: this.computeSparkline(group.indices, timestamps, minTime, maxTime),
      });
    }

    patternList.sort((a, b) => b.count - a.count);
    this.patterns = patternList.slice(0, 50); // Top 50 patterns
  }

  private normalizeMessage(text: string): string {
    return text
      // Replace GUIDs
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{GUID}')
      // Replace long hex strings (>8 chars)
      .replace(/\b[0-9a-f]{9,}\b/gi, '{HEX}')
      // Replace numbers
      .replace(/\b\d+\.?\d*\b/g, '{N}')
      // Replace IP addresses (after number replacement would be {N}.{N}.{N}.{N})
      .replace(/\{N\}\.\{N\}\.\{N\}\.\{N\}/g, '{IP}')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  private computeSparkline(indices: number[], timestamps: number[], minTime: number, maxTime: number): string {
    if (timestamps.length === 0 || minTime === maxTime) return '';

    const buckets = 20;
    const range = maxTime - minTime;
    const bucketSize = range / buckets;
    const counts = new Array(buckets).fill(0);

    for (const idx of indices) {
      const t = timestamps[idx];
      if (t > 0) {
        const bucket = Math.min(buckets - 1, Math.floor((t - minTime) / bucketSize));
        counts[bucket]++;
      }
    }

    const maxCount = Math.max(...counts);
    if (maxCount === 0) return '';

    return counts.map(c => {
      if (c === 0) return SPARK_BLOCKS[0];
      const level = Math.round((c / maxCount) * (SPARK_BLOCKS.length - 1));
      return SPARK_BLOCKS[level];
    }).join('');
  }

  // ==================== Filtering ====================

  private applyFilter(): void {
    let result = [...this.rows];

    // Apply pattern filter
    if (this.activePatternFilter) {
      const allowedSet = new Set(this.activePatternFilter.rowIndices);
      result = result.filter((_, i) => allowedSet.has(i));
    }

    // Apply time range filter from histogram
    if (this.timeRangeStart && this.timeRangeEnd) {
      const timeCol = this.findTimeColumn();
      if (timeCol) {
        const startMs = this.timeRangeStart.getTime();
        const endMs = this.timeRangeEnd.getTime();
        result = result.filter(row => {
          const t = row[timeCol];
          if (!t) return false;
          const d = new Date(String(t));
          const ms = d.getTime();
          return !isNaN(ms) && ms >= startMs && ms <= endMs;
        });
      }
    }

    // Apply column filters (per-column checkbox filters)
    for (const [col, values] of this.columnFilters) {
      result = result.filter(row => values.has(String(row[col] ?? '')));
    }

    // Apply quick value filters (AND logic)
    for (const f of this.activeFilters) {
      result = result.filter(row => String(row[f.column] ?? '') === f.value);
    }

    // Apply filter-mode conditions
    for (const cond of this.conditions) {
      if (cond.mode !== 'filter') continue;
      result = result.filter(row => {
        const matches = this.conditionMatchesRow(cond, row);
        return cond.exclude ? !matches : matches;
      });
    }

    // Apply text filter (supports both plain text and regex)
    if (this.clientFilter) {
      if (this.clientFilterIsRegex && this.clientFilterRegex) {
        const re = this.clientFilterRegex;
        result = result.filter(row =>
          this.columns.some(col => {
            const val = row[col];
            return val != null && re.test(String(val));
          })
        );
      } else {
        const lower = this.clientFilter.toLowerCase();
        result = result.filter(row =>
          this.columns.some(col => {
            const val = row[col];
            return val != null && String(val).toLowerCase().includes(lower);
          })
        );
      }
    }

    this.filteredRows = result;

    if (this.sortColumn) {
      this.sortRows();
    }

    this.onDataChangeCallback?.(this.columns, this.rows, this.filteredRows);
    this.updateScroller();
    this.renderToolbar();
    this.renderFiltersBar();
    this.renderDetailPanel();
  }

  private sortRows(): void {
    if (!this.sortColumn) return;
    const col = this.sortColumn;
    const dir = this.sortDir === 'asc' ? 1 : -1;

    this.filteredRows.sort((a, b) => {
      const va = a[col] ?? '';
      const vb = b[col] ?? '';
      if (typeof va === 'number' && typeof vb === 'number') {
        return (va - vb) * dir;
      }
      return String(va).localeCompare(String(vb)) * dir;
    });
  }

  // ==================== Layout ====================

  private buildLayout(): void {
    this.filtersBarEl = document.createElement('div');
    this.filtersBarEl.className = 'dgrep-filters-bar-area';
    this.container.appendChild(this.filtersBarEl);

    this.toolbarEl = document.createElement('div');
    this.toolbarEl.className = 'dgrep-toolbar-area';
    this.container.appendChild(this.toolbarEl);

    // Content area wraps scroller + detail, direction depends on dock mode
    this.contentArea = document.createElement('div');
    this.contentArea.style.cssText = 'flex:1;display:flex;min-height:0;overflow:hidden;';
    this.applyContentAreaDirection();
    this.container.appendChild(this.contentArea);

    // Scroller area with minimap
    this.scrollerWrapper = document.createElement('div');
    this.scrollerWrapper.className = 'dgrep-table-scroll';
    this.scrollerWrapper.style.cssText = 'position:relative;flex:1;display:flex;flex-direction:row;align-items:stretch;min-height:0;overflow:hidden;';
    this.contentArea.appendChild(this.scrollerWrapper);

    this.scrollerArea = document.createElement('div');
    this.scrollerArea.style.cssText = 'flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;';
    this.scrollerWrapper.appendChild(this.scrollerArea);

    this.minimapSlot = document.createElement('div');
    this.minimapSlot.className = 'dgrep-minimap-container';
    this.minimapSlot.id = 'dgrepMinimapSlot';
    this.minimapSlot.style.cssText = 'width:20px;flex-shrink:0;position:absolute;right:0;top:0;bottom:0;overflow:hidden;';
    this.scrollerWrapper.appendChild(this.minimapSlot);

    // Give the scroller area right padding so it doesn't overlap the minimap
    this.scrollerArea.style.paddingRight = '20px';

    this.detailArea = document.createElement('div');
    this.detailArea.className = 'dgrep-detail-area';
    this.contentArea.appendChild(this.detailArea);

    // Create the virtual scroller
    this.scroller = new DGrepVirtualScroller(this.scrollerArea, { rowHeight: 24, bufferRows: 20 });
    this.scroller.setCallbacks({
      onRowClick: (index, _event) => {
        if (this.selectedRowIndex === index) {
          this.selectedRowIndex = null;
        } else {
          this.selectedRowIndex = index;
          this.onRowExpandCallback?.(index);
        }
        this.scroller.setSelectedRow(this.selectedRowIndex);
        this.renderDetailPanel();
        this.initDetailViewComponents();
      },
      onCellCtrlClick: (_index, column, value) => {
        if (!column || !value) return;
        const alreadyExists = this.activeFilters.some(f => f.column === column && f.value === value);
        if (alreadyExists) return;
        this.activeFilters.push({ column, value });
        this.applyFilter();
      },
      onCellDoubleClick: (_index, _column, value, event) => {
        navigator.clipboard.writeText(value).then(() => {
          if (event) this.showCopiedHint(event);
        });
      },
      onRowRightClick: (index, event) => {
        event.preventDefault();
        // Find the cell that was right-clicked
        const cellEl = (event.target as HTMLElement).closest('.dgrep-vscroll-cell') as HTMLElement | null;
        const column = cellEl?.dataset.col || '';
        const row = this.filteredRows[index];
        const value = row ? String(row[column] ?? '') : '';
        this.showContextMenu(event.clientX, event.clientY, column, value);
      },
      onColumnFilterClick: (column, rect) => {
        this.showColumnFilterDropdown(column, rect);
      },
    });

    // Listen for sort clicks from header
    this.scrollerArea.addEventListener('sort-click', ((e: CustomEvent) => {
      const col = e.detail.column;
      if (this.sortColumn === col) {
        this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortColumn = col;
        this.sortDir = 'asc';
      }
      this.sortRows();
      this.scroller.setSortIndicator(this.sortColumn, this.sortDir);
      this.updateScroller();
    }) as EventListener);

    // Create bookmark manager
    this.bookmarkManager = new DGrepBookmarkManager(document.createElement('div'));
    this.bookmarkManager.setGetRowInfo((index) => {
      const row = this.filteredRows[index];
      if (!row) return { timestamp: '', message: '' };
      const ts = row['PreciseTimeStamp'] || row['TIMESTAMP'] || '';
      const msg = row['Message'] || row['message'] || '';
      return { timestamp: String(ts), message: String(msg) };
    });
    this.bookmarkManager.onChange((bookmarks) => {
      this.scroller.setBookmarks(bookmarks);
    });
    this.bookmarkManager.onJump((index) => {
      this.selectedRowIndex = index;
      this.scroller.setSelectedRow(index);
      this.scroller.scrollToRow(index);
      this.renderDetailPanel();
      this.initDetailViewComponents();
    });

    // Bookmark keyboard shortcuts
    this.container.addEventListener('bookmark-toggle-current', () => {
      if (this.selectedRowIndex != null) this.bookmarkManager.toggle(this.selectedRowIndex);
    });
    this.container.addEventListener('bookmark-next', () => {
      const next = this.bookmarkManager.next(this.selectedRowIndex ?? -1);
      if (next != null) {
        this.selectedRowIndex = next;
        this.scroller.setSelectedRow(next);
        this.scroller.scrollToRow(next);
        this.renderDetailPanel();
        this.initDetailViewComponents();
      }
    });
    this.container.addEventListener('bookmark-prev', () => {
      const prev = this.bookmarkManager.prev(this.selectedRowIndex ?? this.filteredRows.length);
      if (prev != null) {
        this.selectedRowIndex = prev;
        this.scroller.setSelectedRow(prev);
        this.scroller.scrollToRow(prev);
        this.renderDetailPanel();
        this.initDetailViewComponents();
      }
    });

    // Create live tail
    this.liveTail = new DGrepLiveTail(document.createElement('div'));
    this.liveTail.setScrollTarget(this.scroller.getScrollElement());

    // Keyboard navigation
    this.container.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'ArrowDown' || ke.key === 'ArrowUp') {
        ke.preventDefault();
        if (this.selectedRowIndex == null) {
          this.selectedRowIndex = 0;
        } else {
          const delta = ke.key === 'ArrowDown' ? 1 : -1;
          this.selectedRowIndex = Math.max(0, Math.min(this.filteredRows.length - 1, this.selectedRowIndex + delta));
        }
        this.scroller.setSelectedRow(this.selectedRowIndex);
        this.scroller.scrollToRow(this.selectedRowIndex);
        this.renderDetailPanel();
        this.initDetailViewComponents();
      } else if (ke.key === 'Escape') {
        if (this.gotoRowOpen) {
          this.closeGotoRow();
        } else {
          this.selectedRowIndex = null;
          this.scroller.setSelectedRow(null);
          this.contextViewer?.hide();
          this.renderDetailPanel();
        }
      } else if (ke.key === 'g' && ke.ctrlKey && !ke.shiftKey) {
        ke.preventDefault();
        this.openGotoRow();
      }
    });
  }

  /** Set flex-direction on contentArea based on current dock mode */
  private applyContentAreaDirection(): void {
    if (!this.contentArea) return;
    if (this.detailDock === 'right') {
      this.contentArea.style.flexDirection = 'row';
    } else {
      this.contentArea.style.flexDirection = 'column';
    }
  }

  /** Toggle between bottom and right dock for detail panel */
  private toggleDetailDock(): void {
    this.detailDock = this.detailDock === 'bottom' ? 'right' : 'bottom';
    this.applyContentAreaDirection();
    this.renderDetailPanel();
    this.initDetailViewComponents();
  }

  /** Start resizing the detail panel (bottom=vertical, right=horizontal) */
  private startDetailResize(e: MouseEvent): void {
    e.preventDefault();
    this.detailResizing = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const startHeight = this.detailHeight;
    const startWidth = this.detailWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!this.detailResizing) return;
      if (this.detailDock === 'bottom') {
        const parentHeight = this.contentArea.getBoundingClientRect().height;
        const delta = startY - ev.clientY;
        let newHeight = startHeight + delta;
        newHeight = Math.max(100, Math.min(newHeight, parentHeight * 0.8));
        this.detailHeight = newHeight;
        const panel = this.detailArea.querySelector('.dgrep-detail-panel') as HTMLElement;
        if (panel) panel.style.height = `${newHeight}px`;
      } else {
        const parentWidth = this.contentArea.getBoundingClientRect().width;
        const delta = startX - ev.clientX;
        let newWidth = startWidth + delta;
        newWidth = Math.max(200, Math.min(newWidth, parentWidth * 0.8));
        this.detailWidth = newWidth;
        const panel = this.detailArea.querySelector('.dgrep-detail-panel') as HTMLElement;
        if (panel) panel.style.width = `${newWidth}px`;
      }
    };

    const onMouseUp = () => {
      this.detailResizing = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = this.detailDock === 'bottom' ? 'ns-resize' : 'ew-resize';
    document.body.style.userSelect = 'none';
  }

  private updateScroller(): void {
    this.scroller.setData(this.columns, this.filteredRows, this.visibleColumns, this.columnWidths);
    this.scroller.setClientFilter(this.clientFilter, this.clientFilterIsRegex);
    // Pass highlight conditions to the scroller for cell coloring
    const highlights = this.conditions.filter(c => c.mode === 'highlight');
    this.scroller.setHighlightConditions(highlights);
    // Sync active column filter icons in header
    this.scroller.setActiveColumnFilters(new Set(this.columnFilters.keys()));
    // Sync sort indicator
    this.scroller.setSortIndicator(this.sortColumn, this.sortDir);
  }

  // ==================== Toolbar Rendering ====================

  private renderToolbar(): void {
    const hasActiveFilters = this.activeFilters.length > 0 || this.activePatternFilter != null || this.columnFilters.size > 0;

    this.toolbarEl.innerHTML = `
      <div class="dgrep-results-toolbar">
        <div class="dgrep-results-info">
          ${this.filteredRows.length.toLocaleString()} row${this.filteredRows.length !== 1 ? 's' : ''}${this.clientFilter || hasActiveFilters ? ' (filtered)' : ''}
          <button class="btn btn-xs btn-ghost dgrep-goto-row-btn" title="Go to row (Ctrl+G)" style="margin-left:6px;font-size:10px;padding:1px 5px;opacity:0.7;">Go to</button>
        </div>
        <div class="dgrep-results-actions">
          <div class="dgrep-live-tail-slot"></div>
          <div class="dgrep-bookmark-slot"></div>
          ${this.patterns.length > 0 ? `
            <div class="dgrep-pattern-picker">
              <button class="btn btn-xs btn-secondary dgrep-patterns-btn${this.activePatternFilter ? ' active' : ''}" title="Detect message patterns">
                Patterns (${this.patterns.length})
              </button>
              <div class="dgrep-pattern-dropdown ${this.patternsDropdownOpen ? '' : 'hidden'}">
                <div class="dgrep-pattern-header">
                  <span>Message Patterns</span>
                  ${this.activePatternFilter ? '<button class="btn btn-xs btn-ghost dgrep-pattern-clear">Clear filter</button>' : ''}
                </div>
                <div class="dgrep-pattern-list">
                  ${this.patterns.map((p, i) => `
                    <div class="dgrep-pattern-item${this.activePatternFilter === p ? ' active' : ''}" data-pattern-idx="${i}">
                      <span class="dgrep-pattern-count">[${p.count}x]</span>
                      <span class="dgrep-pattern-text" title="${this.escapeAttr(p.displayText)}">${this.escapeHtml(p.displayText)}</span>
                      ${p.sparkline ? `<span class="dgrep-pattern-sparkline" title="Frequency over time">${p.sparkline}</span>` : ''}
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          ` : ''}
          <button class="btn btn-xs btn-secondary dgrep-preset-btn${this.activePreset === 'essential' ? ' active' : ''}" data-preset="essential" title="Show only essential columns">Essential</button>
          <button class="btn btn-xs btn-secondary dgrep-preset-btn${this.activePreset === 'all' ? ' active' : ''}" data-preset="all" title="Show all columns">All</button>
          <div class="dgrep-column-picker">
            <button class="btn btn-sm btn-secondary dgrep-column-btn" title="Column visibility">Columns</button>
            <div class="dgrep-column-dropdown ${this.columnDropdownOpen ? '' : 'hidden'}">
              <div class="dgrep-column-search-row">
                <input type="text" class="dgrep-input dgrep-column-search" placeholder="Filter columns..." value="${this.escapeAttr(this.columnSearchText)}">
              </div>
              <div class="dgrep-column-bulk-actions">
                <button class="btn btn-xs btn-ghost dgrep-col-select-all">Select All</button>
                <button class="btn btn-xs btn-ghost dgrep-col-deselect-all">Deselect All</button>
              </div>
              <div class="dgrep-column-list">
                ${this.columns
                  .filter(col => !this.columnSearchText || col.toLowerCase().includes(this.columnSearchText.toLowerCase()))
                  .map(col => `
                  <label class="dgrep-column-option">
                    <input type="checkbox" ${this.visibleColumns.has(col) ? 'checked' : ''} data-col="${this.escapeAttr(col)}">
                    <span>${this.escapeHtml(col)}</span>
                  </label>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Move bookmark manager into its slot
    const bookmarkSlot = this.toolbarEl.querySelector('.dgrep-bookmark-slot');
    if (bookmarkSlot) bookmarkSlot.appendChild(this.bookmarkManager['container']);

    // Move live tail into its slot
    const liveTailSlot = this.toolbarEl.querySelector('.dgrep-live-tail-slot');
    if (liveTailSlot) liveTailSlot.appendChild(this.liveTail['container']);

    this.attachToolbarEvents();
  }

  private renderFiltersBar(): void {
    if (this.activeFilters.length === 0 && !this.activePatternFilter && this.columnFilters.size === 0 && this.conditions.length === 0) {
      this.filtersBarEl.innerHTML = '';
      return;
    }

    const chips: string[] = [];

    if (this.activePatternFilter) {
      const txt = this.activePatternFilter.displayText;
      const displayTxt = txt.length > 40 ? txt.slice(0, 40) + '...' : txt;
      chips.push(`
        <span class="dgrep-filter-chip dgrep-filter-chip-pattern" data-filter-type="pattern">
          Pattern: "${this.escapeHtml(displayTxt)}"
          <button class="dgrep-filter-chip-remove" data-filter-type="pattern">&times;</button>
        </span>
      `);
    }

    for (const [col, values] of this.columnFilters) {
      const count = values.size;
      chips.push(`
        <span class="dgrep-filter-chip" data-filter-type="column" data-filter-col="${this.escapeAttr(col)}">
          ${this.escapeHtml(col)}: ${count} value${count !== 1 ? 's' : ''}
          <button class="dgrep-filter-chip-remove" data-filter-type="column" data-filter-col="${this.escapeAttr(col)}">&times;</button>
        </span>
      `);
    }

    for (let i = 0; i < this.activeFilters.length; i++) {
      const f = this.activeFilters[i];
      const displayVal = f.value.length > 30 ? f.value.slice(0, 30) + '...' : f.value;
      chips.push(`
        <span class="dgrep-filter-chip" data-filter-idx="${i}">
          ${this.escapeHtml(f.column)} = "${this.escapeHtml(displayVal)}"
          <button class="dgrep-filter-chip-remove" data-filter-idx="${i}">&times;</button>
        </span>
      `);
    }

    // Condition chips (unified filter/highlight)
    for (const cond of this.conditions) {
      const displayVal = cond.value.length > 30 ? cond.value.slice(0, 30) + '...' : cond.value;
      const colLabel = cond.column === '__text__' ? 'text' : this.escapeHtml(cond.column);
      const op = cond.exclude ? '!=' : '=';
      const isHighlight = cond.mode === 'highlight';
      const chipStyle = isHighlight ? `background:color-mix(in srgb, ${cond.color} 20%, transparent);border-color:color-mix(in srgb, ${cond.color} 40%, transparent);` : '';
      // Funnel for filter, paint brush for highlight
      const modeIcon = isHighlight ? '\u270E' : '\u25BD';
      const modeTitle = isHighlight ? 'Highlight mode - click to switch to filter' : 'Filter mode - click to switch to highlight';
      const colorDot = isHighlight ? `<span class="dgrep-context-menu-color" style="background:${cond.color}"></span>` : '';
      const regexBadge = cond.isRegex ? '<span class="dgrep-condition-regex-badge">.*</span>' : '';

      chips.push(`
        <span class="dgrep-filter-chip dgrep-condition-chip" data-cond-id="${cond.id}" style="${chipStyle}">
          ${colorDot}
          <span class="dgrep-condition-mode-toggle" data-cond-id="${cond.id}" title="${modeTitle}">${modeIcon}</span>
          ${regexBadge}
          ${colLabel} ${op} "${this.escapeHtml(displayVal)}"
          <button class="dgrep-filter-chip-remove dgrep-condition-remove" data-cond-id="${cond.id}">&times;</button>
        </span>
      `);
    }

    this.filtersBarEl.innerHTML = `
      <div class="dgrep-active-filters-bar">
        <span class="dgrep-active-filters-label">Filters:</span>
        ${chips.join('')}
        <button class="btn btn-xs btn-ghost dgrep-clear-all-filters">Clear all</button>
      </div>
    `;

    this.attachFilterBarEvents();
  }

  private renderDetailPanel(): void {
    if (this.selectedRowIndex == null || this.selectedRowIndex >= this.filteredRows.length) {
      this.detailArea.innerHTML = '';
      return;
    }
    const row = this.filteredRows[this.selectedRowIndex];
    const allCols = this.columns;
    const isRight = this.detailDock === 'right';

    // Dock toggle button: icon changes based on current mode
    const dockIcon = isRight
      ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="14" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="1" y1="10" x2="15" y2="10" stroke="currentColor" stroke-width="1.5"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="14" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="10" y1="1" x2="10" y2="15" stroke="currentColor" stroke-width="1.5"/></svg>';
    const dockTitle = isRight ? 'Dock to bottom' : 'Dock to right';

    // Resize handle
    const resizeHandle = isRight
      ? '<div class="dgrep-detail-resize-handle-v"></div>'
      : '<div class="dgrep-detail-resize-handle-h"></div>';

    // Content depends on dock mode and view type
    let detailContent: string;
    if (this.detailView === 'json') {
      detailContent = '<div class="dgrep-detail-json-slot"></div>';
    } else if (isRight) {
      // Right dock: vertical label/value fields
      detailContent = allCols.map(col => {
        const val = String(row[col] ?? '');
        const isEmpty = !val || val === 'undefined' || val === 'null';
        if (isEmpty) return '';
        return `<div class="dgrep-detail-field">
          <div class="dgrep-detail-field-label">${this.escapeHtml(col)}</div>
          <div class="dgrep-detail-field-value">${this.escapeHtml(val)}</div>
        </div>`;
      }).join('');
    } else {
      // Bottom dock: table layout (original)
      detailContent = `
        <table class="dgrep-detail-table">
          ${allCols.map(col => {
            const val = String(row[col] ?? '');
            const isEmpty = !val || val === 'undefined' || val === 'null';
            if (isEmpty) return '';
            return `<tr class="dgrep-detail-row">
              <td class="dgrep-detail-key">${this.escapeHtml(col)}</td>
              <td class="dgrep-detail-value">${this.escapeHtml(val)}</td>
            </tr>`;
          }).join('')}
        </table>
      `;
    }

    // Panel sizing
    const panelSizeStyle = isRight
      ? `width:${this.detailWidth}px;height:100%;`
      : `height:${this.detailHeight}px;`;

    const panelClass = isRight ? 'dgrep-detail-panel docked-right' : 'dgrep-detail-panel';

    // For right dock, resize handle comes BEFORE the panel content (left edge)
    // For bottom dock, resize handle comes BEFORE the panel content (top edge)
    this.detailArea.innerHTML = `
      ${resizeHandle}
      <div class="${panelClass}" style="${panelSizeStyle}">
        <div class="dgrep-detail-header">
          <span class="dgrep-detail-title">Row ${this.selectedRowIndex + 1} Details</span>
          <div class="dgrep-detail-view-toggle">
            <button class="btn btn-xs btn-ghost dgrep-detail-view-btn${this.detailView === 'table' ? ' active' : ''}" data-view="table">Table</button>
            <button class="btn btn-xs btn-ghost dgrep-detail-view-btn${this.detailView === 'json' ? ' active' : ''}" data-view="json">JSON</button>
          </div>
          ${DGrepContextViewer.renderButton()}
          <button class="btn btn-xs btn-ghost dgrep-detail-dock-btn" title="${dockTitle}">${dockIcon}</button>
          <button class="btn btn-xs btn-ghost dgrep-detail-close" title="Close">&times;</button>
        </div>
        <div class="dgrep-detail-content">
          ${detailContent}
        </div>
        <div class="dgrep-detail-context-slot"></div>
      </div>
    `;

    // Make the detail area itself a flex container so resize handle + panel lay out correctly
    if (isRight) {
      this.detailArea.style.cssText = 'display:flex;flex-direction:row;flex-shrink:0;';
    } else {
      this.detailArea.style.cssText = 'display:flex;flex-direction:column;flex-shrink:0;';
    }

    this.attachDetailEvents();
    this.initDetailViewComponents();
  }

  private guessColumnWidth(col: string): number {
    const lower = col.toLowerCase();
    if (lower.includes('message') || lower.includes('description') || lower.includes('stacktrace')) return 500;
    if (lower.includes('timestamp') || lower.includes('time')) return 190;
    if (lower.includes('activityid') || lower.includes('correlationid') || lower.includes('requestid')) return 220;
    if (lower.includes('level') || lower.includes('severity')) return 80;
    if (lower === 'tid' || lower === 'pid') return 50;
    if (lower.includes('role') || lower.includes('instance')) return 130;
    if (lower.includes('name')) return 160;
    return DEFAULT_COL_WIDTH;
  }

  private attachDetailEvents(): void {
    // Detail panel close button
    this.detailArea.querySelector('.dgrep-detail-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectedRowIndex = null;
      this.scroller.setSelectedRow(null);
      this.contextViewer?.hide();
      this.renderDetailPanel();
    });

    // Dock toggle button
    this.detailArea.querySelector('.dgrep-detail-dock-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDetailDock();
    });

    // Resize handle
    const resizeHandleH = this.detailArea.querySelector('.dgrep-detail-resize-handle-h');
    const resizeHandleV = this.detailArea.querySelector('.dgrep-detail-resize-handle-v');
    (resizeHandleH || resizeHandleV)?.addEventListener('mousedown', (e) => {
      this.startDetailResize(e as MouseEvent);
    });

    // Detail panel Table/JSON view toggle
    this.detailArea.querySelectorAll('.dgrep-detail-view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const view = (btn as HTMLElement).dataset.view as DetailView;
        if (view && view !== this.detailView) {
          this.detailView = view;
          this.renderDetailPanel();
        }
      });
    });

    // Show Context button - uses local data (no backend call needed)
    this.detailArea.querySelector('.dgrep-context-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.selectedRowIndex == null) return;

      const contextCount = 10;
      const idx = this.selectedRowIndex;
      const targetRow = this.filteredRows[idx];
      if (!targetRow) return;

      const beforeRows = this.filteredRows.slice(Math.max(0, idx - contextCount), idx);
      const afterRows = this.filteredRows.slice(idx + 1, idx + 1 + contextCount);

      const ctxSlot = this.detailArea.querySelector('.dgrep-detail-context-slot') as HTMLElement;
      if (!ctxSlot) return;

      if (!this.contextViewer) {
        this.contextViewer = new DGrepContextViewer(ctxSlot);
        this.contextViewer.onRowSelect = (ctxIdx) => {
          this.selectedRowIndex = ctxIdx;
          this.scroller.setSelectedRow(ctxIdx);
          this.scroller.scrollToRow(ctxIdx);
          this.renderDetailPanel();
        };
      }

      this.contextViewer.setContextData(beforeRows, targetRow, afterRows, idx, this.columns);
    });

    // Copy value from detail panel on click (table view)
    this.detailArea.querySelectorAll('.dgrep-detail-value').forEach(val => {
      val.addEventListener('click', (e) => {
        const text = (val as HTMLElement).textContent || '';
        navigator.clipboard.writeText(text).then(() => this.showCopiedHint(val as HTMLElement));
      });
    });

    // Copy value from detail panel on click (right-dock field values)
    this.detailArea.querySelectorAll('.dgrep-detail-field-value').forEach(val => {
      val.addEventListener('click', (e) => {
        const text = (val as HTMLElement).textContent || '';
        navigator.clipboard.writeText(text).then(() => this.showCopiedHint(val as HTMLElement));
      });
    });

    // Re-attach context viewer if it was visible
    if (this.contextViewer?.isVisible()) {
      const ctxSlot = this.detailArea.querySelector('.dgrep-detail-context-slot') as HTMLElement;
      if (ctxSlot) {
        ctxSlot.appendChild(this.contextViewer['container']);
      }
    }
  }

  /** Initialize JSON viewer or context viewer when detail panel is open */
  private initDetailViewComponents(): void {
    if (this.selectedRowIndex == null || this.selectedRowIndex >= this.filteredRows.length) return;
    const row = this.filteredRows[this.selectedRowIndex];

    if (this.detailView === 'json') {
      const jsonSlot = this.detailArea.querySelector('.dgrep-detail-json-slot') as HTMLElement;
      if (jsonSlot) {
        this.jsonViewer?.destroy();
        this.jsonViewer = new DGrepJsonViewer(jsonSlot);
        this.jsonViewer.setData(row);
      }
    }

    // Re-attach context viewer if it was visible
    if (this.contextViewer?.isVisible()) {
      const ctxSlot = this.detailArea.querySelector('.dgrep-detail-context-slot') as HTMLElement;
      if (ctxSlot) {
        ctxSlot.appendChild(this.contextViewer['container']);
      }
    }
  }

  /** Set context data from external source (called after onFetchContext returns) */
  setContextData(
    beforeRows: Record<string, any>[],
    targetRow: Record<string, any>,
    afterRows: Record<string, any>[],
    targetIndex: number,
  ): void {
    const ctxSlot = this.detailArea.querySelector('.dgrep-detail-context-slot') as HTMLElement;
    if (!ctxSlot) return;

    if (!this.contextViewer) {
      this.contextViewer = new DGrepContextViewer(ctxSlot);
      this.contextViewer.onRowSelect = (idx) => {
        this.selectedRowIndex = idx;
        this.scroller.setSelectedRow(idx);
        this.scroller.scrollToRow(idx);
        this.renderDetailPanel();
      };
    }

    this.contextViewer.setContextData(beforeRows, targetRow, afterRows, targetIndex, this.columns);
  }

  // ==================== Toolbar Events ====================

  private attachToolbarEvents(): void {
    // Column presets
    this.toolbarEl.querySelectorAll('.dgrep-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = (btn as HTMLElement).dataset.preset;
        if (preset === 'essential') {
          this.visibleColumns = new Set(
            this.columns.filter(c => ESSENTIAL_COLUMNS.some(e =>
              c.toLowerCase() === e.toLowerCase()
            ))
          );
          for (const col of this.columns) {
            if (col === 'PreciseTimeStamp' || col === 'Message') {
              this.visibleColumns.add(col);
            }
          }
          this.activePreset = 'essential';
        } else if (preset === 'all') {
          this.visibleColumns = new Set(this.columns);
          this.activePreset = 'all';
        }
        this.updateScroller();
        this.renderToolbar();
        this.onColumnVisibilityChange?.(this.getVisibleColumnNames());
      });
    });

    // Go to Row button
    this.toolbarEl.querySelector('.dgrep-goto-row-btn')?.addEventListener('click', () => {
      this.openGotoRow();
    });

    // Column visibility toggle
    const colBtn = this.toolbarEl.querySelector('.dgrep-column-btn');
    const colDropdown = this.toolbarEl.querySelector('.dgrep-column-dropdown');
    if (colBtn && colDropdown) {
      colBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.columnDropdownOpen = !this.columnDropdownOpen;
        colDropdown.classList.toggle('hidden', !this.columnDropdownOpen);
      });

      const searchInput = colDropdown.querySelector('.dgrep-column-search') as HTMLInputElement;
      searchInput?.addEventListener('input', () => {
        this.columnSearchText = searchInput.value;
        this.renderToolbar();
        this.columnDropdownOpen = true;
        this.toolbarEl.querySelector('.dgrep-column-dropdown')?.classList.remove('hidden');
        const newInput = this.toolbarEl.querySelector('.dgrep-column-search') as HTMLInputElement;
        if (newInput) {
          newInput.focus();
          newInput.selectionStart = newInput.selectionEnd = newInput.value.length;
        }
      });

      colDropdown.querySelector('.dgrep-col-select-all')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.visibleColumns = new Set(this.columns);
        this.activePreset = 'custom';
        this.updateScroller();
        this.renderToolbar();
        this.columnDropdownOpen = true;
        this.toolbarEl.querySelector('.dgrep-column-dropdown')?.classList.remove('hidden');
        this.onColumnVisibilityChange?.(this.getVisibleColumnNames());
      });
      colDropdown.querySelector('.dgrep-col-deselect-all')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.visibleColumns.clear();
        this.activePreset = 'custom';
        this.updateScroller();
        this.renderToolbar();
        this.columnDropdownOpen = true;
        this.toolbarEl.querySelector('.dgrep-column-dropdown')?.classList.remove('hidden');
        this.onColumnVisibilityChange?.(this.getVisibleColumnNames());
      });

      colDropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', (e) => {
          e.stopPropagation();
          const col = (cb as HTMLInputElement).dataset.col!;
          if ((cb as HTMLInputElement).checked) {
            this.visibleColumns.add(col);
          } else {
            this.visibleColumns.delete(col);
          }
          this.activePreset = 'custom';
          this.updateScroller();
          this.renderToolbar();
          this.columnDropdownOpen = true;
          this.toolbarEl.querySelector('.dgrep-column-dropdown')?.classList.remove('hidden');
          this.onColumnVisibilityChange?.(this.getVisibleColumnNames());
        });
      });
    }

    // Pattern detection dropdown
    this.attachPatternEvents();
  }

  private attachPatternEvents(): void {
    const patternsBtn = this.toolbarEl.querySelector('.dgrep-patterns-btn');
    const patternDropdown = this.toolbarEl.querySelector('.dgrep-pattern-dropdown');

    if (patternsBtn && patternDropdown) {
      patternsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.patternsDropdownOpen = !this.patternsDropdownOpen;
        patternDropdown.classList.toggle('hidden', !this.patternsDropdownOpen);
      });

      patternDropdown.querySelectorAll('.dgrep-pattern-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt((item as HTMLElement).dataset.patternIdx!, 10);
          const pattern = this.patterns[idx];
          if (this.activePatternFilter === pattern) {
            this.activePatternFilter = null;
          } else {
            this.activePatternFilter = pattern;
          }
          this.patternsDropdownOpen = false;
          this.applyFilter();
        });
      });

      patternDropdown.querySelector('.dgrep-pattern-clear')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activePatternFilter = null;
        this.patternsDropdownOpen = false;
        this.applyFilter();
      });
    }
  }

  private attachFilterBarEvents(): void {
    this.filtersBarEl.querySelectorAll('.dgrep-filter-chip-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const el = btn as HTMLElement;
        const filterType = el.dataset.filterType;
        const filterIdx = el.dataset.filterIdx;

        if (filterType === 'pattern') {
          this.activePatternFilter = null;
        } else if (filterType === 'column') {
          const col = el.dataset.filterCol;
          if (col) this.columnFilters.delete(col);
        } else if (filterIdx != null) {
          this.activeFilters.splice(parseInt(filterIdx, 10), 1);
        }
        this.applyFilter();
      });
    });

    // Condition remove buttons
    this.filtersBarEl.querySelectorAll('.dgrep-condition-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.condId;
        if (id) this.removeCondition(id);
      });
    });

    // Condition mode toggle buttons
    this.filtersBarEl.querySelectorAll('.dgrep-condition-mode-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.condId;
        if (id) this.toggleConditionMode(id);
      });
    });

    this.filtersBarEl.querySelector('.dgrep-clear-all-filters')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.activePatternFilter = null;
      this.activeFilters = [];
      this.conditions = [];
      this.highlightColorIndex = 0;
      this.columnFilters.clear();
      this.applyFilter();
    });
  }

  // ==================== Column Filter Dropdown ====================

  private showColumnFilterDropdown(column: string, headerRect: DOMRect): void {
    // Close any existing column filter dropdown
    if (this.activeColumnFilter) {
      this.activeColumnFilter.destroy();
      this.activeColumnFilter = null;
    }

    const filter = new DGrepColumnFilter(document.body, column, headerRect);
    this.activeColumnFilter = filter;

    // Pre-set selected values if a filter already exists for this column
    const existing = this.columnFilters.get(column);
    if (existing) {
      filter.setSelectedValues(existing);
    }

    // Compute distinct values from the UNFILTERED rows (so user sees all possible values)
    filter.computeValues(this.rows);

    filter.onColumnFilterApply = (col, selectedValues) => {
      // If all values are selected, remove the filter; otherwise set it
      const allDistinct = new Set<string>();
      for (const row of this.rows) {
        allDistinct.add(String(row[col] ?? ''));
      }
      if (selectedValues.size >= allDistinct.size) {
        this.columnFilters.delete(col);
      } else {
        this.columnFilters.set(col, selectedValues);
      }
      this.activeColumnFilter = null;
      this.syncActiveColumnFiltersToScroller();
      this.applyFilter();
    };
  }

  private syncActiveColumnFiltersToScroller(): void {
    this.scroller.setActiveColumnFilters(new Set(this.columnFilters.keys()));
  }

  // ==================== Context Menu ====================

  private showContextMenu(x: number, y: number, column: string, value: string): void {
    this.closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'dgrep-context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    const dv = value.length > 40 ? value.slice(0, 40) + '...' : value;
    const dc = column.length > 20 ? column.slice(0, 20) + '...' : column;
    const nc = HIGHLIGHT_COLORS[this.highlightColorIndex % HIGHLIGHT_COLORS.length];
    menu.innerHTML = `<div class="dgrep-context-menu-item" data-action="filter"><span>\u25BD</span> Filter: ${this.escapeHtml(dc)} = "${this.escapeHtml(dv)}"</div><div class="dgrep-context-menu-item" data-action="highlight"><span class="dgrep-context-menu-color" style="background:${nc}"></span> Highlight: ${this.escapeHtml(dc)} = "${this.escapeHtml(dv)}"</div><div class="dgrep-context-menu-item" data-action="exclude"><span>\u2717</span> Exclude: ${this.escapeHtml(dc)} != "${this.escapeHtml(dv)}"</div><div class="dgrep-context-menu-separator"></div><div class="dgrep-context-menu-item" data-action="copy"><span>\u2398</span> Copy value</div>`;
    menu.querySelectorAll('.dgrep-context-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = (item as HTMLElement).dataset.action;
        if (action === 'filter') this.addCondition({ id: this.generateConditionId(), column, value, isRegex: false, mode: 'filter', color: '' });
        else if (action === 'highlight') this.addCondition({ id: this.generateConditionId(), column, value, isRegex: false, mode: 'highlight', color: this.nextHighlightColor() });
        else if (action === 'exclude') this.addCondition({ id: this.generateConditionId(), column, value, isRegex: false, mode: 'filter', exclude: true, color: '' });
        else if (action === 'copy') navigator.clipboard.writeText(value).then(() => this.showCopiedHint(e as MouseEvent));
        this.closeContextMenu();
      });
    });
    document.body.appendChild(menu);
    this.contextMenuEl = menu;
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
  }

  private closeContextMenu(): void {
    if (this.contextMenuEl) { this.contextMenuEl.remove(); this.contextMenuEl = null; }
  }

  // ==================== Condition Management ====================

  addCondition(condition: FilterCondition): void { this.conditions.push(condition); this.applyFilter(); }
  removeCondition(id: string): void { this.conditions = this.conditions.filter(c => c.id !== id); this.applyFilter(); }

  toggleConditionMode(id: string): void {
    const cond = this.conditions.find(c => c.id === id);
    if (!cond) return;
    cond.mode = cond.mode === 'filter' ? 'highlight' : 'filter';
    if (cond.mode === 'highlight' && !cond.color) cond.color = this.nextHighlightColor();
    this.applyFilter();
  }

  generateConditionId(): string { return 'cond_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6); }

  nextHighlightColor(): string {
    const color = HIGHLIGHT_COLORS[this.highlightColorIndex % HIGHLIGHT_COLORS.length];
    this.highlightColorIndex++;
    return color;
  }

  private conditionMatchesRow(cond: FilterCondition, row: Record<string, any>): boolean {
    if (cond.column === '__text__') {
      return this.columns.some(col => { const v = row[col]; return v != null && this.valueMatchesCondition(String(v), cond); });
    }
    return this.valueMatchesCondition(String(row[cond.column] ?? ''), cond);
  }

  private valueMatchesCondition(cellValue: string, cond: FilterCondition): boolean {
    if (cond.isRegex) { try { return new RegExp(cond.value, 'i').test(cellValue); } catch { return false; } }
    if (cond.column === '__text__') return cellValue.toLowerCase().includes(cond.value.toLowerCase());
    return cellValue === cond.value;
  }

  // ==================== Helpers ====================

  private csvEscape(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
  }

  /** Show a transient "Copied!" hint near the mouse/element */
  private showCopiedHint(e?: MouseEvent | HTMLElement): void {
    const hint = document.createElement('div');
    hint.className = 'dgrep-copied-hint';
    hint.textContent = 'Copied!';
    if (e instanceof MouseEvent) {
      hint.style.left = `${e.clientX + 8}px`;
      hint.style.top = `${e.clientY - 12}px`;
    } else if (e instanceof HTMLElement) {
      const rect = e.getBoundingClientRect();
      hint.style.left = `${rect.right + 4}px`;
      hint.style.top = `${rect.top}px`;
    }
    document.body.appendChild(hint);
    setTimeout(() => hint.remove(), 1000);
  }

  // ==================== Go to Row ====================

  private openGotoRow(): void {
    if (this.gotoRowOpen || this.filteredRows.length === 0) return;
    this.gotoRowOpen = true;

    const overlay = document.createElement('div');
    overlay.className = 'dgrep-goto-overlay';
    overlay.innerHTML = `
      <div class="dgrep-goto-dialog">
        <label>Go to row (1-${this.filteredRows.length.toLocaleString()}):</label>
        <input type="number" class="dgrep-input dgrep-goto-input" min="1" max="${this.filteredRows.length}" placeholder="Row number" autofocus>
      </div>
    `;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeGotoRow();
    });

    const input = overlay.querySelector('.dgrep-goto-input') as HTMLInputElement;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = parseInt(input.value, 10);
        if (val >= 1 && val <= this.filteredRows.length) {
          this.gotoRow(val - 1); // 0-indexed internally
        }
        this.closeGotoRow();
      } else if (e.key === 'Escape') {
        this.closeGotoRow();
      }
    });

    this.container.appendChild(overlay);
    input.focus();
  }

  private closeGotoRow(): void {
    this.gotoRowOpen = false;
    this.container.querySelector('.dgrep-goto-overlay')?.remove();
  }

  private gotoRow(index: number): void {
    if (index < 0 || index >= this.filteredRows.length) return;
    this.selectedRowIndex = index;
    this.scroller.setSelectedRow(index);
    this.scroller.scrollToRow(index);
    this.renderDetailPanel();
    this.initDetailViewComponents();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private escapeAttr(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
  }

  /** Wrap matching substrings in <mark> tags. Operates on already-escaped HTML. */
  private highlightMatch(escapedHtml: string): string {
    if (!this.clientFilter) return escapedHtml;
    // Escape the filter for use in a regex, then search case-insensitively
    const escaped = this.clientFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // The clientFilter is lowercase; we need to match against the escaped HTML case-insensitively
    const regex = new RegExp(`(${escaped})`, 'gi');
    return escapedHtml.replace(regex, '<mark class="dgrep-highlight">$1</mark>');
  }
}
