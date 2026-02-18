const PAGE_SIZE = 100;
const MAX_CELL_CHARS = 200;

type SortDir = 'asc' | 'desc';

export class DGrepResultsTable {
  private container: HTMLElement;
  private columns: string[] = [];
  private rows: Record<string, any>[] = [];
  private visibleColumns: Set<string> = new Set();
  private sortColumn: string | null = null;
  private sortDir: SortDir = 'asc';
  private clientFilter = '';
  private filteredRows: Record<string, any>[] = [];
  private currentPage = 0;
  private expandedCells: Set<string> = new Set(); // "row:col"
  private columnDropdownOpen = false;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'dgrep-results-table-container';
    parent.appendChild(this.container);
    this.render();
  }

  setData(columns: string[], rows: Record<string, any>[]): void {
    this.columns = columns;
    this.rows = rows;
    this.visibleColumns = new Set(columns);
    this.sortColumn = null;
    this.sortDir = 'asc';
    this.currentPage = 0;
    this.expandedCells.clear();
    this.applyFilter();
  }

  setClientFilter(text: string): void {
    this.clientFilter = text.toLowerCase().trim();
    this.currentPage = 0;
    this.applyFilter();
  }

  getRowCount(): number {
    return this.filteredRows.length;
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

  private applyFilter(): void {
    if (!this.clientFilter) {
      this.filteredRows = [...this.rows];
    } else {
      this.filteredRows = this.rows.filter(row =>
        this.columns.some(col => {
          const val = row[col];
          return val != null && String(val).toLowerCase().includes(this.clientFilter);
        })
      );
    }

    if (this.sortColumn) {
      this.sortRows();
    }

    this.render();
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

  private render(): void {
    const totalPages = Math.max(1, Math.ceil(this.filteredRows.length / PAGE_SIZE));
    if (this.currentPage >= totalPages) this.currentPage = totalPages - 1;

    const startIdx = this.currentPage * PAGE_SIZE;
    const pageRows = this.filteredRows.slice(startIdx, startIdx + PAGE_SIZE);
    const visibleCols = this.columns.filter(c => this.visibleColumns.has(c));

    this.container.innerHTML = `
      <div class="dgrep-results-toolbar">
        <div class="dgrep-results-info">
          ${this.filteredRows.length.toLocaleString()} row${this.filteredRows.length !== 1 ? 's' : ''}${this.clientFilter ? ' (filtered)' : ''}
        </div>
        <div class="dgrep-results-actions">
          <div class="dgrep-column-picker">
            <button class="btn btn-sm btn-secondary dgrep-column-btn" title="Column visibility">Columns</button>
            <div class="dgrep-column-dropdown ${this.columnDropdownOpen ? '' : 'hidden'}">
              ${this.columns.map(col => `
                <label class="dgrep-column-option">
                  <input type="checkbox" ${this.visibleColumns.has(col) ? 'checked' : ''} data-col="${this.escapeAttr(col)}">
                  <span>${this.escapeHtml(col)}</span>
                </label>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
      <div class="dgrep-table-scroll">
        <table class="dgrep-table">
          <thead>
            <tr>
              ${visibleCols.map(col => {
                const isSorted = col === this.sortColumn;
                const arrow = isSorted ? (this.sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';
                return `<th class="dgrep-th${isSorted ? ' sorted' : ''}" data-col="${this.escapeAttr(col)}">${this.escapeHtml(col)}${arrow}</th>`;
              }).join('')}
            </tr>
          </thead>
          <tbody>
            ${pageRows.length === 0 ? `<tr><td colspan="${visibleCols.length}" class="dgrep-empty-row">No results</td></tr>` :
              pageRows.map((row, ri) => {
                const rowIdx = startIdx + ri;
                return `<tr>${visibleCols.map(col => {
                  const raw = row[col] ?? '';
                  const str = String(raw);
                  const cellKey = `${rowIdx}:${col}`;
                  const isExpanded = this.expandedCells.has(cellKey);
                  const needsTruncate = str.length > MAX_CELL_CHARS && !isExpanded;
                  const display = needsTruncate ? str.slice(0, MAX_CELL_CHARS) + '\u2026' : str;
                  const clickable = str.length > MAX_CELL_CHARS ? ' dgrep-cell-clickable' : '';
                  return `<td class="dgrep-td${clickable}" data-cell="${this.escapeAttr(cellKey)}">${this.escapeHtml(display)}</td>`;
                }).join('')}</tr>`;
              }).join('')
            }
          </tbody>
        </table>
      </div>
      ${totalPages > 1 ? `
        <div class="dgrep-pagination">
          <button class="btn btn-sm btn-secondary" data-page="first" ${this.currentPage === 0 ? 'disabled' : ''}>First</button>
          <button class="btn btn-sm btn-secondary" data-page="prev" ${this.currentPage === 0 ? 'disabled' : ''}>Prev</button>
          <span class="dgrep-page-info">Page ${this.currentPage + 1} of ${totalPages}</span>
          <button class="btn btn-sm btn-secondary" data-page="next" ${this.currentPage >= totalPages - 1 ? 'disabled' : ''}>Next</button>
          <button class="btn btn-sm btn-secondary" data-page="last" ${this.currentPage >= totalPages - 1 ? 'disabled' : ''}>Last</button>
        </div>
      ` : ''}
    `;

    this.attachEvents();
  }

  private attachEvents(): void {
    // Column sort
    this.container.querySelectorAll('.dgrep-th').forEach(th => {
      th.addEventListener('click', () => {
        const col = (th as HTMLElement).dataset.col!;
        if (this.sortColumn === col) {
          this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortColumn = col;
          this.sortDir = 'asc';
        }
        this.sortRows();
        this.render();
      });
    });

    // Pagination
    this.container.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.page;
        const totalPages = Math.ceil(this.filteredRows.length / PAGE_SIZE);
        switch (action) {
          case 'first': this.currentPage = 0; break;
          case 'prev': this.currentPage = Math.max(0, this.currentPage - 1); break;
          case 'next': this.currentPage = Math.min(totalPages - 1, this.currentPage + 1); break;
          case 'last': this.currentPage = totalPages - 1; break;
        }
        this.render();
      });
    });

    // Cell expand
    this.container.querySelectorAll('.dgrep-cell-clickable').forEach(td => {
      td.addEventListener('click', () => {
        const cellKey = (td as HTMLElement).dataset.cell!;
        if (this.expandedCells.has(cellKey)) {
          this.expandedCells.delete(cellKey);
        } else {
          this.expandedCells.add(cellKey);
        }
        this.render();
      });
    });

    // Column visibility toggle
    const colBtn = this.container.querySelector('.dgrep-column-btn');
    const colDropdown = this.container.querySelector('.dgrep-column-dropdown');
    if (colBtn && colDropdown) {
      colBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.columnDropdownOpen = !this.columnDropdownOpen;
        colDropdown.classList.toggle('hidden', !this.columnDropdownOpen);
      });

      colDropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
          const col = (cb as HTMLInputElement).dataset.col!;
          if ((cb as HTMLInputElement).checked) {
            this.visibleColumns.add(col);
          } else {
            this.visibleColumns.delete(col);
          }
          this.render();
        });
      });

      // Close dropdown when clicking outside
      document.addEventListener('mousedown', (e) => {
        if (this.columnDropdownOpen && !this.container.querySelector('.dgrep-column-picker')?.contains(e.target as Node)) {
          this.columnDropdownOpen = false;
          this.render();
        }
      }, { once: true });
    }
  }

  private csvEscape(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private escapeAttr(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
  }
}
