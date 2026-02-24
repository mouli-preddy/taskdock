import { getIcon, Save, Trash2, ChevronDown } from '../utils/icons.js';
import type { DGrepFormState } from '../../shared/dgrep-ui-types.js';

export interface SavedQuery {
  name: string;
  formState: DGrepFormState;
  serverQuery: string;
  clientQuery: string;
  timestamp: number;
}

export interface DGrepSavedQueriesCallbacks {
  onSaveQuery: (name: string, formState: DGrepFormState) => void;
  onLoadQuery: (formState: DGrepFormState) => void;
  onDeleteQuery: (name: string) => void;
}

export class DGrepSavedQueries {
  private container: HTMLElement;
  private dropdownEl: HTMLElement | null = null;
  private badgeEl!: HTMLElement;
  private callbacks: DGrepSavedQueriesCallbacks;
  private queries: SavedQuery[] = [];
  private open = false;
  private saving = false;

  constructor(parent: HTMLElement, callbacks: DGrepSavedQueriesCallbacks) {
    this.callbacks = callbacks;
    this.container = document.createElement('div');
    this.container.className = 'dgrep-saved-queries';
    this.render();
    parent.appendChild(this.container);

    // Close on outside click
    document.addEventListener('mousedown', (e) => {
      if (this.open && !this.container.contains(e.target as Node)) {
        this.closeDropdown();
      }
    });
  }

  private render(): void {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-secondary dgrep-saved-btn';
    btn.innerHTML = `${getIcon(Save, 12)} Saved ${getIcon(ChevronDown, 10)}`;
    btn.addEventListener('click', () => {
      if (this.open) {
        this.closeDropdown();
      } else {
        this.openDropdown();
      }
    });

    this.badgeEl = document.createElement('span');
    this.badgeEl.className = 'dgrep-saved-badge hidden';
    btn.appendChild(this.badgeEl);

    this.container.appendChild(btn);
  }

  setQueries(queries: SavedQuery[]): void {
    this.queries = queries.sort((a, b) => b.timestamp - a.timestamp);
    this.updateBadge();
    if (this.open) {
      this.renderDropdownContent();
    }
  }

  getQueries(): SavedQuery[] {
    return this.queries;
  }

  private updateBadge(): void {
    if (this.queries.length > 0) {
      this.badgeEl.textContent = String(this.queries.length);
      this.badgeEl.classList.remove('hidden');
    } else {
      this.badgeEl.classList.add('hidden');
    }
  }

  private openDropdown(): void {
    this.open = true;
    this.saving = false;

    this.dropdownEl = document.createElement('div');
    this.dropdownEl.className = 'dgrep-saved-dropdown';
    this.renderDropdownContent();
    this.container.appendChild(this.dropdownEl);
  }

  private closeDropdown(): void {
    this.open = false;
    this.saving = false;
    if (this.dropdownEl) {
      this.dropdownEl.remove();
      this.dropdownEl = null;
    }
  }

  private renderDropdownContent(): void {
    if (!this.dropdownEl) return;

    let html = '';

    // Save current query section
    if (this.saving) {
      html += `
        <div class="dgrep-saved-save-row">
          <input type="text" class="dgrep-input dgrep-input-sm dgrep-saved-name-input" placeholder="Query name..." autofocus>
          <button class="btn btn-xs btn-primary dgrep-saved-confirm-btn">Save</button>
        </div>`;
    } else {
      html += `
        <div class="dgrep-saved-save-row">
          <button class="btn btn-sm btn-secondary dgrep-saved-save-btn" style="width:100%">${getIcon(Save, 12)} Save Current Query</button>
        </div>`;
    }

    // Divider
    if (this.queries.length > 0) {
      html += '<div class="dgrep-saved-divider"></div>';
    }

    // Query list
    if (this.queries.length === 0) {
      html += '<div class="dgrep-saved-empty">No saved queries</div>';
    } else {
      for (const q of this.queries) {
        const timeStr = this.formatTimestamp(q.timestamp);
        html += `
          <div class="dgrep-saved-item" data-name="${this.escapeAttr(q.name)}">
            <span class="dgrep-saved-name" title="${this.escapeAttr(q.name)}">${this.escapeHtml(q.name)}</span>
            <span class="dgrep-saved-time">${timeStr}</span>
            <button class="btn btn-xs btn-ghost dgrep-saved-delete" title="Delete">${getIcon(Trash2, 12)}</button>
          </div>`;
      }
    }

    this.dropdownEl.innerHTML = html;
    this.attachDropdownEvents();
  }

  private attachDropdownEvents(): void {
    if (!this.dropdownEl) return;

    // Save button
    const saveBtn = this.dropdownEl.querySelector('.dgrep-saved-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        this.saving = true;
        this.renderDropdownContent();
        const nameInput = this.dropdownEl?.querySelector('.dgrep-saved-name-input') as HTMLInputElement;
        nameInput?.focus();
      });
    }

    // Confirm save
    const confirmBtn = this.dropdownEl.querySelector('.dgrep-saved-confirm-btn');
    const nameInput = this.dropdownEl.querySelector('.dgrep-saved-name-input') as HTMLInputElement;
    if (confirmBtn && nameInput) {
      const doSave = () => {
        const name = nameInput.value.trim();
        if (name) {
          this.callbacks.onSaveQuery(name, {} as DGrepFormState);
          this.saving = false;
          this.renderDropdownContent();
        }
      };
      confirmBtn.addEventListener('click', doSave);
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doSave();
        if (e.key === 'Escape') {
          this.saving = false;
          this.renderDropdownContent();
        }
      });
    }

    // Click to load
    this.dropdownEl.querySelectorAll('.dgrep-saved-item').forEach(el => {
      el.addEventListener('click', (e) => {
        // Ignore clicks on delete button
        if ((e.target as HTMLElement).closest('.dgrep-saved-delete')) return;
        const name = (el as HTMLElement).dataset.name!;
        const query = this.queries.find(q => q.name === name);
        if (query) {
          this.callbacks.onLoadQuery(query.formState);
          this.closeDropdown();
        }
      });
    });

    // Delete buttons
    this.dropdownEl.querySelectorAll('.dgrep-saved-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = (btn as HTMLElement).closest('.dgrep-saved-item') as HTMLElement;
        const name = item?.dataset.name;
        if (name) {
          this.callbacks.onDeleteQuery(name);
        }
      });
    });
  }

  private formatTimestamp(ts: number): string {
    const d = new Date(ts);
    const now = Date.now();
    const diffMs = now - ts;

    if (diffMs < 60_000) return 'just now';
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private escapeAttr(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
  }

  getElement(): HTMLElement {
    return this.container;
  }
}
