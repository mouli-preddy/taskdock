const MAX_FACET_COLUMNS = 8;
const MAX_FACET_VALUES = 10;
const DEBOUNCE_MS = 300;

// Columns to prioritize for facets (severity-like first, then low-cardinality)
const PRIORITY_COLUMNS = [
  'Level', 'severityText', 'Severity', 'level',
  'Role', 'RoleInstance', 'Name',
];

interface FacetEntry {
  value: string;
  count: number;
}

interface FacetColumn {
  column: string;
  entries: FacetEntry[];
  maxCount: number;
  collapsed: boolean;
}

export class DGrepFacetedSidebar {
  private container: HTMLElement;
  private facets: FacetColumn[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private visible = false;

  onFilterAdd: ((column: string, value: string) => void) | null = null;
  onFilterExclude: ((column: string, value: string) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'dgrep-faceted-sidebar hidden';
    parent.appendChild(this.container);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.container.classList.toggle('hidden', !this.visible);
  }

  isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.container.classList.remove('hidden');
  }

  hide(): void {
    this.visible = false;
    this.container.classList.add('hidden');
  }

  setData(columns: string[], rows: Record<string, any>[]): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.computeFacets(columns, rows);
      this.render();
    }, DEBOUNCE_MS);
  }

  destroy(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.container.remove();
  }

  private computeFacets(columns: string[], rows: Record<string, any>[]): void {
    if (rows.length === 0 || columns.length === 0) {
      this.facets = [];
      return;
    }

    // Score columns by cardinality usefulness
    const columnScores: { col: string; distinctCount: number; priority: number }[] = [];

    for (const col of columns) {
      const distinct = new Set<string>();
      for (const row of rows) {
        distinct.add(String(row[col] ?? ''));
        if (distinct.size > 200) break; // Stop counting if too many
      }

      const dCount = distinct.size;
      // Skip columns with only 1 distinct value or very high cardinality
      if (dCount <= 1 || dCount > 100) continue;

      const priorityIdx = PRIORITY_COLUMNS.indexOf(col);
      const priority = priorityIdx >= 0 ? priorityIdx : 100;

      columnScores.push({ col, distinctCount: dCount, priority });
    }

    // Sort: priority columns first, then by lower cardinality
    columnScores.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.distinctCount - b.distinctCount;
    });

    const selectedCols = columnScores.slice(0, MAX_FACET_COLUMNS);

    // Compute facet entries for each selected column
    // Preserve collapsed state from previous facets
    const prevCollapsed = new Map<string, boolean>();
    for (const f of this.facets) {
      prevCollapsed.set(f.column, f.collapsed);
    }

    this.facets = selectedCols.map(({ col }) => {
      const counts = new Map<string, number>();
      for (const row of rows) {
        const val = String(row[col] ?? '');
        counts.set(val, (counts.get(val) ?? 0) + 1);
      }

      const entries = Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_FACET_VALUES);

      const maxCount = entries.length > 0 ? entries[0].count : 0;

      return {
        column: col,
        entries,
        maxCount,
        collapsed: prevCollapsed.get(col) ?? false,
      };
    });
  }

  private render(): void {
    if (this.facets.length === 0) {
      this.container.innerHTML = '<div class="dgrep-facet-empty">No facets available</div>';
      return;
    }

    this.container.innerHTML = `
      <div class="dgrep-facet-header">
        <span class="dgrep-facet-title">Facets</span>
        <button class="btn btn-xs btn-ghost dgrep-facet-close-btn" title="Close facets">&times;</button>
      </div>
      <div class="dgrep-facet-sections">
        ${this.facets.map((facet, fi) => `
          <div class="dgrep-facet-section" data-facet-idx="${fi}">
            <div class="dgrep-facet-section-header">
              <span class="dgrep-facet-toggle">${facet.collapsed ? '\u25B6' : '\u25BC'}</span>
              <span class="dgrep-facet-col-name">${this.escapeHtml(facet.column)}</span>
              <span class="dgrep-facet-col-count">(${facet.entries.length})</span>
            </div>
            <div class="dgrep-facet-entries${facet.collapsed ? ' collapsed' : ''}">
              ${facet.entries.map(entry => {
                const pct = facet.maxCount > 0 ? (entry.count / facet.maxCount) * 100 : 0;
                return `
                  <div class="dgrep-facet-entry" data-col="${this.escapeAttr(facet.column)}" data-val="${this.escapeAttr(entry.value)}">
                    <div class="dgrep-facet-bar-bg">
                      <div class="dgrep-facet-bar" style="width:${pct}%"></div>
                    </div>
                    <span class="dgrep-facet-val" title="${this.escapeAttr(entry.value)}">${this.escapeHtml(entry.value || '(empty)')}</span>
                    <span class="dgrep-facet-cnt">${entry.count}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;

    this.attachEvents();
  }

  private attachEvents(): void {
    // Close button
    this.container.querySelector('.dgrep-facet-close-btn')?.addEventListener('click', () => {
      this.hide();
    });

    // Toggle collapse per section
    this.container.querySelectorAll('.dgrep-facet-section-header').forEach(header => {
      header.addEventListener('click', () => {
        const section = header.closest('.dgrep-facet-section') as HTMLElement;
        const idx = parseInt(section.dataset.facetIdx!, 10);
        this.facets[idx].collapsed = !this.facets[idx].collapsed;
        const entries = section.querySelector('.dgrep-facet-entries')!;
        entries.classList.toggle('collapsed');
        const toggle = header.querySelector('.dgrep-facet-toggle')!;
        toggle.textContent = this.facets[idx].collapsed ? '\u25B6' : '\u25BC';
      });
    });

    // Click on facet entry to filter, Ctrl+Click to exclude
    this.container.querySelectorAll('.dgrep-facet-entry').forEach(entry => {
      entry.addEventListener('click', (e) => {
        const el = entry as HTMLElement;
        const col = el.dataset.col!;
        const val = el.dataset.val!;
        if ((e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey) {
          this.onFilterExclude?.(col, val);
        } else {
          this.onFilterAdd?.(col, val);
        }
      });
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
