export interface BookmarkInfo {
  index: number;
  timestamp: string;
  messagePreview: string;
}

export class DGrepBookmarkManager {
  private bookmarks: Set<number> = new Set();
  private container: HTMLElement;
  private dropdownOpen = false;

  // Callback to get row info for display
  private getRowInfo: ((index: number) => { timestamp: string; message: string }) | null = null;
  // Callback when bookmarks change
  private onChangeCallback: ((bookmarks: Set<number>) => void) | null = null;
  // Callback for jumping to a row
  private onJumpCallback: ((index: number) => void) | null = null;

  private boundKeyHandler: (e: KeyboardEvent) => void;
  private boundDocClick: (e: MouseEvent) => void;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'dgrep-bookmark-picker';
    parent.appendChild(this.container);

    this.boundKeyHandler = this.handleKeydown.bind(this);
    this.boundDocClick = (e: MouseEvent) => {
      if (this.dropdownOpen && !this.container.contains(e.target as Node)) {
        this.dropdownOpen = false;
        this.render();
      }
    };

    document.addEventListener('keydown', this.boundKeyHandler);
    document.addEventListener('mousedown', this.boundDocClick);
    this.render();
  }

  setGetRowInfo(cb: (index: number) => { timestamp: string; message: string }): void {
    this.getRowInfo = cb;
  }

  onChange(cb: (bookmarks: Set<number>) => void): void {
    this.onChangeCallback = cb;
  }

  onJump(cb: (index: number) => void): void {
    this.onJumpCallback = cb;
  }

  toggle(index: number): void {
    if (this.bookmarks.has(index)) {
      this.bookmarks.delete(index);
    } else {
      this.bookmarks.add(index);
    }
    this.onChangeCallback?.(this.bookmarks);
    this.render();
  }

  next(currentIndex: number): number | null {
    const sorted = this.getAll();
    for (const idx of sorted) {
      if (idx > currentIndex) return idx;
    }
    return sorted.length > 0 ? sorted[0] : null; // Wrap around
  }

  prev(currentIndex: number): number | null {
    const sorted = this.getAll();
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i] < currentIndex) return sorted[i];
    }
    return sorted.length > 0 ? sorted[sorted.length - 1] : null; // Wrap around
  }

  clear(): void {
    this.bookmarks.clear();
    this.onChangeCallback?.(this.bookmarks);
    this.render();
  }

  getAll(): number[] {
    return Array.from(this.bookmarks).sort((a, b) => a - b);
  }

  getSet(): Set<number> {
    return new Set(this.bookmarks);
  }

  destroy(): void {
    document.removeEventListener('keydown', this.boundKeyHandler);
    document.removeEventListener('mousedown', this.boundDocClick);
    this.container.remove();
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (!e.ctrlKey && !e.metaKey) return;

    if (e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      // Toggle bookmark on current selection - dispatched via custom event
      this.container.dispatchEvent(new CustomEvent('bookmark-toggle-current', { bubbles: true }));
    } else if (e.key === ']') {
      e.preventDefault();
      this.container.dispatchEvent(new CustomEvent('bookmark-next', { bubbles: true }));
    } else if (e.key === '[') {
      e.preventDefault();
      this.container.dispatchEvent(new CustomEvent('bookmark-prev', { bubbles: true }));
    }
  }

  private render(): void {
    const count = this.bookmarks.size;
    const items = this.getAll();

    this.container.innerHTML = `
      <button class="btn btn-xs btn-secondary dgrep-bookmark-btn${count > 0 ? ' active' : ''}" title="Bookmarks (Ctrl+B to toggle)">
        Bookmarks${count > 0 ? ` (${count})` : ''}
      </button>
      <div class="dgrep-bookmark-dropdown ${this.dropdownOpen ? '' : 'hidden'}">
        <div class="dgrep-bookmark-header">
          <span>Bookmarks (${count})</span>
          ${count > 0 ? '<button class="btn btn-xs btn-ghost dgrep-bookmark-clear">Clear all</button>' : ''}
        </div>
        <div class="dgrep-bookmark-list">
          ${items.length === 0 ? '<div class="dgrep-bookmark-empty">No bookmarks. Click a row, then press Ctrl+B.</div>' :
            items.map(idx => {
              const info = this.getRowInfo?.(idx);
              const ts = info?.timestamp ?? '';
              const msg = info?.message ?? '';
              const preview = msg.length > 60 ? msg.slice(0, 60) + '...' : msg;
              return `<div class="dgrep-bookmark-item" data-bookmark-idx="${idx}">
                <span class="dgrep-bookmark-row-num">Row ${idx + 1}</span>
                ${ts ? `<span class="dgrep-bookmark-ts">${this.escapeHtml(ts)}</span>` : ''}
                <span class="dgrep-bookmark-msg" title="${this.escapeAttr(msg)}">${this.escapeHtml(preview)}</span>
              </div>`;
            }).join('')
          }
        </div>
      </div>
    `;

    this.attachEvents();
  }

  private attachEvents(): void {
    this.container.querySelector('.dgrep-bookmark-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dropdownOpen = !this.dropdownOpen;
      this.render();
    });

    this.container.querySelector('.dgrep-bookmark-clear')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.clear();
    });

    this.container.querySelectorAll('.dgrep-bookmark-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt((item as HTMLElement).dataset.bookmarkIdx!, 10);
        this.onJumpCallback?.(idx);
        this.dropdownOpen = false;
        this.render();
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
