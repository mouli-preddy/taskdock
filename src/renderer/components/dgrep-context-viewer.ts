const DEFAULT_CONTEXT_COUNT = 10;

const CONTEXT_SEVERITY_COLORS: Record<string, string> = {
  'error': '#f85149',
  'critical': '#f85149',
  'fatal': '#f85149',
  'warning': '#e5a100',
  'warn': '#e5a100',
  'info': '#58a6ff',
  'information': '#58a6ff',
  'verbose': '#8b949e',
  'debug': '#8b949e',
  'trace': '#6e7681',
};

interface ContextRow {
  [key: string]: any;
}

export class DGrepContextViewer {
  private container: HTMLElement;
  private visible = false;

  onFetchContext: ((sessionId: string, rowIndex: number, count: number) => void) | null = null;
  onRowSelect: ((rowIndex: number) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'dgrep-context-viewer';
    parent.appendChild(this.container);
  }

  /** Render the context button in the detail panel header. Returns HTML string. */
  static renderButton(): string {
    return `<button class="btn btn-xs btn-secondary dgrep-context-btn" title="Show surrounding log lines">Show Context</button>`;
  }

  setContextData(
    beforeRows: ContextRow[],
    targetRow: ContextRow,
    afterRows: ContextRow[],
    targetIndex: number,
    columns: string[],
  ): void {
    this.visible = true;
    this.render(beforeRows, targetRow, afterRows, targetIndex, columns);
  }

  hide(): void {
    this.visible = false;
    this.container.innerHTML = '';
  }

  isVisible(): boolean {
    return this.visible;
  }

  getDefaultCount(): number {
    return DEFAULT_CONTEXT_COUNT;
  }

  destroy(): void {
    this.container.remove();
  }

  private render(
    beforeRows: ContextRow[],
    targetRow: ContextRow,
    afterRows: ContextRow[],
    targetIndex: number,
    columns: string[],
  ): void {
    const timeCol = columns.find(c =>
      c === 'PreciseTimeStamp' || c === 'TIMESTAMP' || c.toLowerCase().includes('timestamp')
    );
    const msgCol = columns.find(c =>
      c === 'Message' || c === 'message' || c.toLowerCase() === 'msg'
    );
    const sevCol = columns.find(c =>
      c === 'Level' || c === 'severityText' || c === 'level' || c === 'Severity'
    );

    const renderRow = (row: ContextRow, idx: number, isTarget: boolean): string => {
      const time = timeCol ? this.formatTime(String(row[timeCol] ?? '')) : '';
      const msg = msgCol ? String(row[msgCol] ?? '') : '';
      const sev = sevCol ? String(row[sevCol] ?? '').toLowerCase() : '';
      const sevColor = CONTEXT_SEVERITY_COLORS[sev] || '';
      const truncMsg = msg.length > 200 ? msg.slice(0, 200) + '\u2026' : msg;

      return `
        <div class="dgrep-context-row${isTarget ? ' dgrep-context-target' : ''}" data-ctx-idx="${idx}">
          <span class="dgrep-context-time">${this.escapeHtml(time)}</span>
          ${sevColor
            ? `<span class="dgrep-context-sev" style="color:${sevColor}">${this.escapeHtml(sev)}</span>`
            : `<span class="dgrep-context-sev">${this.escapeHtml(sev)}</span>`
          }
          <span class="dgrep-context-msg">${this.escapeHtml(truncMsg)}</span>
        </div>
      `;
    };

    const beforeHtml = beforeRows.map((r, i) =>
      renderRow(r, targetIndex - beforeRows.length + i, false)
    ).join('');
    const targetHtml = renderRow(targetRow, targetIndex, true);
    const afterHtml = afterRows.map((r, i) =>
      renderRow(r, targetIndex + 1 + i, false)
    ).join('');

    this.container.innerHTML = `
      <div class="dgrep-context-header">
        <span class="dgrep-context-title">Context (${beforeRows.length} before, ${afterRows.length} after)</span>
        <button class="btn btn-xs btn-ghost dgrep-context-close" title="Close">&times;</button>
      </div>
      <div class="dgrep-context-timeline">
        ${beforeHtml}
        ${targetHtml}
        ${afterHtml}
      </div>
    `;

    // Scroll target row into view
    const target = this.container.querySelector('.dgrep-context-target');
    target?.scrollIntoView({ block: 'center' });

    // Close button
    this.container.querySelector('.dgrep-context-close')?.addEventListener('click', () => {
      this.hide();
    });

    // Click context rows to select in main table
    this.container.querySelectorAll('.dgrep-context-row').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt((el as HTMLElement).dataset.ctxIdx!, 10);
        if (!isNaN(idx)) {
          this.onRowSelect?.(idx);
        }
      });
    });
  }

  private formatTime(val: string): string {
    if (!val) return '';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return val;
      return d.toISOString().slice(11, 23); // HH:mm:ss.sss
    } catch {
      return val;
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
