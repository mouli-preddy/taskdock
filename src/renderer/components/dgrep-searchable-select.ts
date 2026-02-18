const MAX_VISIBLE = 50;
const DEBOUNCE_MS = 150;

export class DGrepSearchableSelect {
  private container: HTMLElement;
  private input: HTMLInputElement;
  private dropdown: HTMLElement;
  private items: string[] = [];
  private filteredItems: string[] = [];
  private selectedValue = '';
  private highlightIndex = -1;
  private open = false;
  private debounceTimer: number | null = null;
  private changeCallback: ((value: string) => void) | null = null;
  private placeholder: string;

  constructor(parent: HTMLElement, placeholder = 'Select...') {
    this.placeholder = placeholder;
    this.container = document.createElement('div');
    this.container.className = 'dgrep-searchable-select';

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'dgrep-searchable-input';
    this.input.placeholder = placeholder;
    this.input.autocomplete = 'off';

    const arrow = document.createElement('span');
    arrow.className = 'dgrep-searchable-arrow';
    arrow.innerHTML = '&#9662;';

    this.dropdown = document.createElement('div');
    this.dropdown.className = 'dgrep-searchable-dropdown hidden';

    this.container.appendChild(this.input);
    this.container.appendChild(arrow);
    this.container.appendChild(this.dropdown);
    parent.appendChild(this.container);

    this.attachEvents();
  }

  setItems(items: string[]): void {
    this.items = items;
    this.filteredItems = items;
    if (this.open) {
      this.renderDropdown();
    }
  }

  getValue(): string {
    return this.selectedValue;
  }

  setValue(value: string): void {
    this.selectedValue = value;
    this.input.value = value;
  }

  onChange(callback: (value: string) => void): void {
    this.changeCallback = callback;
  }

  setDisabled(disabled: boolean): void {
    this.input.disabled = disabled;
    this.container.classList.toggle('disabled', disabled);
  }

  getElement(): HTMLElement {
    return this.container;
  }

  private attachEvents(): void {
    this.input.addEventListener('focus', () => {
      this.openDropdown();
    });

    this.input.addEventListener('input', () => {
      if (this.debounceTimer !== null) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = window.setTimeout(() => {
        this.filterItems();
      }, DEBOUNCE_MS);
    });

    this.input.addEventListener('keydown', (e) => {
      if (!this.open) {
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
          this.openDropdown();
          e.preventDefault();
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          this.moveHighlight(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.moveHighlight(-1);
          break;
        case 'Enter':
          e.preventDefault();
          if (this.highlightIndex >= 0 && this.highlightIndex < this.filteredItems.length) {
            this.selectItem(this.filteredItems[this.highlightIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          this.closeDropdown();
          break;
      }
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.container.contains(e.target as Node)) {
        this.closeDropdown();
      }
    });
  }

  private openDropdown(): void {
    this.open = true;
    this.highlightIndex = -1;
    this.filterItems();
    this.dropdown.classList.remove('hidden');
  }

  private closeDropdown(): void {
    this.open = false;
    this.dropdown.classList.add('hidden');
    // Restore value if user didn't select
    if (this.selectedValue && this.input.value !== this.selectedValue) {
      this.input.value = this.selectedValue;
    }
  }

  private filterItems(): void {
    const query = this.input.value.toLowerCase().trim();
    if (!query) {
      this.filteredItems = this.items;
    } else {
      this.filteredItems = this.items.filter(item =>
        item.toLowerCase().includes(query)
      );
    }
    this.highlightIndex = -1;
    this.renderDropdown();
  }

  private renderDropdown(): void {
    const visible = this.filteredItems.slice(0, MAX_VISIBLE);
    const remaining = this.filteredItems.length - visible.length;

    if (this.filteredItems.length === 0) {
      this.dropdown.innerHTML = '<div class="dgrep-searchable-empty">No matches</div>';
      return;
    }

    let html = '';
    for (let i = 0; i < visible.length; i++) {
      const item = visible[i];
      const isHighlighted = i === this.highlightIndex;
      const isSelected = item === this.selectedValue;
      html += `<div class="dgrep-searchable-option${isHighlighted ? ' highlighted' : ''}${isSelected ? ' selected' : ''}" data-index="${i}">${this.escapeHtml(item)}</div>`;
    }

    if (remaining > 0) {
      html += `<div class="dgrep-searchable-more">${remaining.toLocaleString()} more\u2026 type to filter</div>`;
    }

    this.dropdown.innerHTML = html;

    // Attach click handlers
    this.dropdown.querySelectorAll('.dgrep-searchable-option').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const idx = parseInt((el as HTMLElement).dataset.index!, 10);
        if (idx >= 0 && idx < this.filteredItems.length) {
          this.selectItem(this.filteredItems[idx]);
        }
      });
    });
  }

  private selectItem(value: string): void {
    this.selectedValue = value;
    this.input.value = value;
    this.closeDropdown();
    this.changeCallback?.(value);
  }

  private moveHighlight(delta: number): void {
    const max = Math.min(this.filteredItems.length, MAX_VISIBLE);
    if (max === 0) return;

    this.highlightIndex += delta;
    if (this.highlightIndex < 0) this.highlightIndex = max - 1;
    if (this.highlightIndex >= max) this.highlightIndex = 0;

    this.renderDropdown();

    // Scroll highlighted item into view
    const highlighted = this.dropdown.querySelector('.highlighted');
    if (highlighted) {
      highlighted.scrollIntoView({ block: 'nearest' });
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
