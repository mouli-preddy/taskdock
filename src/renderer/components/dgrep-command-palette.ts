import { getIcon, Search, Sparkles, Download, Filter, Eye, Columns, Save } from '../utils/icons.js';

export interface PaletteCommand {
  id: string;
  title: string;
  category: string;
  icon: string;
  shortcut?: string;
  handler: () => void;
}

export class DGrepCommandPalette {
  private static instance: DGrepCommandPalette | null = null;

  private overlay: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;
  private commands: PaletteCommand[] = [];
  private filtered: PaletteCommand[] = [];
  private selectedIndex = 0;
  private visible = false;
  private onExecuteCallback: ((commandId: string) => void) | null = null;

  private constructor() {
    this.registerKeyboardShortcut();
  }

  static getInstance(): DGrepCommandPalette {
    if (!DGrepCommandPalette.instance) {
      DGrepCommandPalette.instance = new DGrepCommandPalette();
    }
    return DGrepCommandPalette.instance;
  }

  registerCommand(id: string, title: string, category: string, icon: string, shortcut: string | undefined, handler: () => void): void {
    // Replace existing command with same id
    const existing = this.commands.findIndex(c => c.id === id);
    const cmd: PaletteCommand = { id, title, category, icon, shortcut, handler };
    if (existing >= 0) {
      this.commands[existing] = cmd;
    } else {
      this.commands.push(cmd);
    }
  }

  onExecute(cb: (commandId: string) => void): void {
    this.onExecuteCallback = cb;
  }

  open(): void {
    if (this.visible) return;
    this.visible = true;
    this.selectedIndex = 0;
    this.filtered = [...this.commands];
    this.renderOverlay();
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
      this.input = null;
      this.listEl = null;
    }
  }

  isOpen(): boolean {
    return this.visible;
  }

  private registerKeyboardShortcut(): void {
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (this.visible) {
          this.close();
        } else {
          this.open();
        }
      }
    });
  }

  private renderOverlay(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'dgrep-palette-overlay';
    this.overlay.addEventListener('mousedown', (e) => {
      if (e.target === this.overlay) this.close();
    });

    const modal = document.createElement('div');
    modal.className = 'dgrep-palette-modal';

    // Search input
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'dgrep-palette-input-wrapper';
    const searchIcon = document.createElement('span');
    searchIcon.className = 'dgrep-palette-search-icon';
    searchIcon.innerHTML = getIcon(Search, 16);

    this.input = document.createElement('input');
    this.input.className = 'dgrep-palette-input';
    this.input.type = 'text';
    this.input.placeholder = 'Type a command...';
    this.input.autocomplete = 'off';
    this.input.addEventListener('input', () => this.onFilter());
    this.input.addEventListener('keydown', (e) => this.onKeyDown(e));

    inputWrapper.appendChild(searchIcon);
    inputWrapper.appendChild(this.input);

    // Command list
    this.listEl = document.createElement('div');
    this.listEl.className = 'dgrep-palette-list';

    modal.appendChild(inputWrapper);
    modal.appendChild(this.listEl);
    this.overlay.appendChild(modal);
    document.body.appendChild(this.overlay);

    this.renderList();
    this.input.focus();
  }

  private onFilter(): void {
    const query = this.input?.value.toLowerCase().trim() || '';
    if (!query) {
      this.filtered = [...this.commands];
    } else {
      this.filtered = this.commands.filter(cmd =>
        cmd.title.toLowerCase().includes(query) ||
        cmd.category.toLowerCase().includes(query) ||
        cmd.id.toLowerCase().includes(query)
      );
    }
    this.selectedIndex = 0;
    this.renderList();
  }

  private onKeyDown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.filtered.length - 1);
        this.renderList();
        this.scrollSelectedIntoView();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.renderList();
        this.scrollSelectedIntoView();
        break;
      case 'Enter':
        e.preventDefault();
        if (this.filtered[this.selectedIndex]) {
          this.executeCommand(this.filtered[this.selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        this.close();
        break;
    }
  }

  private renderList(): void {
    if (!this.listEl) return;

    if (this.filtered.length === 0) {
      this.listEl.innerHTML = '<div class="dgrep-palette-empty">No matching commands</div>';
      return;
    }

    let currentCategory = '';
    let html = '';

    for (let i = 0; i < this.filtered.length; i++) {
      const cmd = this.filtered[i];
      const isSelected = i === this.selectedIndex;

      // Category separator
      if (cmd.category !== currentCategory) {
        currentCategory = cmd.category;
        html += `<div class="dgrep-palette-category-header">${this.escapeHtml(currentCategory)}</div>`;
      }

      html += `<div class="dgrep-palette-item${isSelected ? ' selected' : ''}" data-index="${i}">
        <span class="dgrep-palette-icon">${cmd.icon}</span>
        <span class="dgrep-palette-title">${this.escapeHtml(cmd.title)}</span>
        ${cmd.shortcut ? `<span class="dgrep-palette-shortcut">${this.escapeHtml(cmd.shortcut)}</span>` : ''}
      </div>`;
    }

    this.listEl.innerHTML = html;

    // Attach click handlers
    this.listEl.querySelectorAll('.dgrep-palette-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const idx = parseInt((el as HTMLElement).dataset.index!, 10);
        if (this.filtered[idx]) {
          this.executeCommand(this.filtered[idx]);
        }
      });
      el.addEventListener('mouseenter', () => {
        const idx = parseInt((el as HTMLElement).dataset.index!, 10);
        this.selectedIndex = idx;
        this.renderList();
      });
    });
  }

  private scrollSelectedIntoView(): void {
    if (!this.listEl) return;
    const selected = this.listEl.querySelector('.dgrep-palette-item.selected');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }

  private executeCommand(cmd: PaletteCommand): void {
    this.close();
    cmd.handler();
    this.onExecuteCallback?.(cmd.id);
  }

  registerDefaultCommands(handlers: Record<string, () => void>): void {
    const defaults: Array<[string, string, string, string, string | undefined]> = [
      ['search-new', 'New Search', 'Search', getIcon(Search, 14), 'Enter'],
      ['search-cancel', 'Cancel Search', 'Search', getIcon(Search, 14), undefined],
      ['search-clear', 'Clear Results', 'Search', getIcon(Search, 14), undefined],
      ['view-toggle-columns', 'Toggle Columns', 'View', getIcon(Columns, 14), undefined],
      ['view-essential-columns', 'Essential Columns', 'View', getIcon(Eye, 14), undefined],
      ['view-all-columns', 'All Columns', 'View', getIcon(Eye, 14), undefined],
      ['view-toggle-wrap', 'Toggle Wrap', 'View', getIcon(Eye, 14), undefined],
      ['view-toggle-histogram', 'Toggle Histogram', 'View', getIcon(Eye, 14), undefined],
      ['view-toggle-facets', 'Toggle Facets', 'View', getIcon(Eye, 14), undefined],
      ['filter-errors', 'Show Errors Only', 'Filter', getIcon(Filter, 14), undefined],
      ['filter-warnings', 'Show Warnings', 'Filter', getIcon(Filter, 14), undefined],
      ['filter-clear', 'Clear All Filters', 'Filter', getIcon(Filter, 14), undefined],
      ['ai-summarize', 'Summarize Logs', 'AI', getIcon(Sparkles, 14), undefined],
      ['ai-chat', 'Open AI Chat', 'AI', getIcon(Sparkles, 14), undefined],
      ['ai-nl-to-kql', 'NL-to-KQL', 'AI', getIcon(Sparkles, 14), undefined],
      ['ai-anomalies', 'Detect Anomalies', 'AI', getIcon(Sparkles, 14), undefined],
      ['export-csv', 'Download CSV', 'Export', getIcon(Download, 14), undefined],
      ['export-geneva', 'Open in Geneva', 'Export', getIcon(Download, 14), undefined],
      ['export-copy-query-id', 'Copy Query ID', 'Export', getIcon(Download, 14), undefined],
    ];

    for (const [id, title, category, icon, shortcut] of defaults) {
      const handler = handlers[id];
      if (handler) {
        this.registerCommand(id, title, category, icon, shortcut, handler);
      }
    }
  }

  /** Add saved query commands dynamically */
  addSavedQueryCommands(queries: Array<{ name: string }>, onLoad: (name: string) => void): void {
    // Remove old saved query commands
    this.commands = this.commands.filter(c => c.category !== 'Queries');
    for (const q of queries) {
      this.registerCommand(
        `query-${q.name}`,
        q.name,
        'Queries',
        getIcon(Save, 14),
        undefined,
        () => onLoad(q.name),
      );
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
