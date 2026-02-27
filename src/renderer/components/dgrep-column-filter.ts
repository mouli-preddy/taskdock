const MAX_FILTER_VALUES = 50;

export class DGrepColumnFilter {
  private container: HTMLElement;
  private column: string;
  private allValues: { value: string; count: number }[] = [];
  private filteredValues: { value: string; count: number }[] = [];
  private selectedValues: Set<string>;
  private searchText = '';
  private cached = false;

  onColumnFilterApply: ((column: string, selectedValues: Set<string>) => void) | null = null;

  private boundDocClick: ((e: MouseEvent) => void) | null = null;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;

  constructor(parent: HTMLElement, column: string, anchorRect: DOMRect) {
    this.column = column;
    this.selectedValues = new Set();

    this.container = document.createElement('div');
    this.container.className = 'dgrep-colfilter-dropdown';

    // Position below the header, clamped to viewport
    this.container.style.position = 'fixed';
    const left = Math.min(anchorRect.left, window.innerWidth - 270);
    this.container.style.left = `${Math.max(0, left)}px`;
    this.container.style.top = `${anchorRect.bottom + 2}px`;
    this.container.style.zIndex = '500';

    parent.appendChild(this.container);

    // Close when clicking outside
    this.boundDocClick = (e: MouseEvent) => {
      if (!this.container.contains(e.target as Node)) {
        this.destroy();
      }
    };
    // Close on Escape
    this.boundKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.destroy();
      }
    };
    // Defer so the opening click doesn't immediately close
    setTimeout(() => {
      document.addEventListener('mousedown', this.boundDocClick!);
      document.addEventListener('keydown', this.boundKeyDown!);
    }, 0);
  }

  /** Compute distinct values from the data set. Call once, results are cached. */
  computeValues(rows: Record<string, any>[]): void {
    if (this.cached) return;
    this.cached = true;

    const counts = new Map<string, number>();
    for (const row of rows) {
      const val = String(row[this.column] ?? '');
      counts.set(val, (counts.get(val) ?? 0) + 1);
    }

    // Sort by count descending
    this.allValues = Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_FILTER_VALUES);

    // Select all by default
    this.selectedValues = new Set(this.allValues.map(v => v.value));
    this.filteredValues = this.allValues;

    this.render();
  }

  /** Pre-set selected values (e.g., from existing filter state) */
  setSelectedValues(values: Set<string>): void {
    this.selectedValues = new Set(values);
  }

  destroy(): void {
    if (this.boundDocClick) {
      document.removeEventListener('mousedown', this.boundDocClick);
      this.boundDocClick = null;
    }
    if (this.boundKeyDown) {
      document.removeEventListener('keydown', this.boundKeyDown);
      this.boundKeyDown = null;
    }
    this.container.remove();
  }

  private render(): void {
    const values = this.filteredValues;

    this.container.innerHTML = `
      <div class="dgrep-colfilter-header">
        <span>Filter: ${this.escapeHtml(this.column)}</span>
      </div>
      <div class="dgrep-colfilter-search">
        <input type="text" class="dgrep-input dgrep-colfilter-search-input" placeholder="Search values..." value="${this.escapeAttr(this.searchText)}">
      </div>
      <div class="dgrep-colfilter-bulk">
        <button class="btn btn-xs btn-ghost dgrep-colfilter-select-all">Select All</button>
        <button class="btn btn-xs btn-ghost dgrep-colfilter-deselect-all">Deselect All</button>
      </div>
      <div class="dgrep-colfilter-list">
        ${values.map(v => `
          <label class="dgrep-colfilter-item">
            <input type="checkbox" ${this.selectedValues.has(v.value) ? 'checked' : ''} data-val="${this.escapeAttr(v.value)}">
            <span class="dgrep-colfilter-val">${this.escapeHtml(v.value || '(empty)')}</span>
            <span class="dgrep-colfilter-count">${v.count}</span>
          </label>
        `).join('')}
        ${values.length === 0 ? '<div class="dgrep-colfilter-empty">No matching values</div>' : ''}
      </div>
      <div class="dgrep-colfilter-actions">
        <button class="btn btn-xs btn-secondary dgrep-colfilter-cancel">Cancel</button>
        <button class="btn btn-xs btn-primary dgrep-colfilter-apply">Apply</button>
      </div>
    `;

    this.attachEvents();
  }

  private attachEvents(): void {
    // Search input
    const searchInput = this.container.querySelector('.dgrep-colfilter-search-input') as HTMLInputElement;
    searchInput?.addEventListener('input', () => {
      this.searchText = searchInput.value.toLowerCase();
      this.filteredValues = this.searchText
        ? this.allValues.filter(v => v.value.toLowerCase().includes(this.searchText))
        : this.allValues;
      this.render();
      // Re-focus search input
      const newInput = this.container.querySelector('.dgrep-colfilter-search-input') as HTMLInputElement;
      if (newInput) {
        newInput.focus();
        newInput.selectionStart = newInput.selectionEnd = newInput.value.length;
      }
    });

    // Select all / deselect all
    this.container.querySelector('.dgrep-colfilter-select-all')?.addEventListener('click', () => {
      for (const v of this.filteredValues) {
        this.selectedValues.add(v.value);
      }
      this.render();
    });

    this.container.querySelector('.dgrep-colfilter-deselect-all')?.addEventListener('click', () => {
      for (const v of this.filteredValues) {
        this.selectedValues.delete(v.value);
      }
      this.render();
    });

    // Checkboxes
    this.container.querySelectorAll('.dgrep-colfilter-item input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const val = (cb as HTMLInputElement).dataset.val!;
        if ((cb as HTMLInputElement).checked) {
          this.selectedValues.add(val);
        } else {
          this.selectedValues.delete(val);
        }
      });
    });

    // Cancel
    this.container.querySelector('.dgrep-colfilter-cancel')?.addEventListener('click', () => {
      this.destroy();
    });

    // Apply
    this.container.querySelector('.dgrep-colfilter-apply')?.addEventListener('click', () => {
      this.onColumnFilterApply?.(this.column, new Set(this.selectedValues));
      this.destroy();
    });
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
