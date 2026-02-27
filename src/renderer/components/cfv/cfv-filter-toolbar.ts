import type { FilterRule, CallFilterState, FilterPreset } from '../../../shared/cfv-filter-types.js';
import { summarizeRule } from '../../../shared/cfv-filter-types.js';
import { escapeHtml } from '../../utils/html-utils.js';

export interface FilterToolbarCallbacks {
  onAddRule: () => void;
  onEditRule: (ruleId: string) => void;
  onRemoveRule: (ruleId: string) => void;
  onToggleRule: (ruleId: string, enabled: boolean) => void;
  onToggleShowMatchedOnly: (value: boolean) => void;
  onOpenPresets: () => void;
  onApplyPreset: (preset: FilterPreset) => void;
  onSavePreset: (name: string) => void;
  onDeletePreset: (presetId: string) => void;
}

export class CfvFilterToolbar {
  private container: HTMLElement;
  private callbacks: FilterToolbarCallbacks;
  private state: CallFilterState = { rules: [], showMatchedOnly: false };
  private presets: FilterPreset[] = [];
  private presetsOpen = false;
  private presetNameInput = false;

  constructor(container: HTMLElement, callbacks: FilterToolbarCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  setState(state: CallFilterState) {
    this.state = state;
    this.render();
  }

  setPresets(presets: FilterPreset[]) {
    this.presets = presets;
    if (this.presetsOpen) this.render();
  }

  render() {
    const rules = this.state.rules;
    const activeCount = rules.filter(r => r.enabled).length;

    this.container.innerHTML = `
      <div class="cfv-filter-toolbar">
        <div class="cfv-filter-toolbar-left">
          <button class="cfv-filter-add-btn" title="Add filter rule">+ Filter</button>
          <div class="cfv-filter-chips">
            ${rules.length === 0 ? '<span class="cfv-filter-no-filters">No filters</span>' : ''}
            ${rules.map(rule => this.renderChip(rule)).join('')}
          </div>
        </div>
        <div class="cfv-filter-toolbar-right">
          <label class="cfv-filter-matched-toggle" title="Only show rows matching a filter or mark">
            <input type="checkbox" ${this.state.showMatchedOnly ? 'checked' : ''} />
            <span>Matched only</span>
          </label>
          <div class="cfv-filter-presets-wrapper">
            <button class="cfv-filter-presets-btn">Presets</button>
            ${this.presetsOpen ? this.renderPresetsDropdown() : ''}
          </div>
        </div>
      </div>
    `;

    this.attachEvents();
  }

  private renderChip(rule: FilterRule): string {
    const summary = escapeHtml(summarizeRule(rule));
    const modeIcon = rule.mode === 'filter' ? '&#x1F50D;' : '&#x1F3A8;'; // magnifying glass / palette
    const modeTitle = rule.mode === 'filter' ? 'Filter (hides non-matching)' : 'Mark (highlights matching)';
    const enabledClass = rule.enabled ? '' : ' disabled';

    return `
      <div class="cfv-filter-chip${enabledClass}" data-rule-id="${rule.id}">
        <span class="cfv-filter-chip-dot" style="background:${rule.color}"></span>
        <span class="cfv-filter-chip-text" title="${summary}">${summary}</span>
        <span class="cfv-filter-chip-mode" title="${modeTitle}">${modeIcon}</span>
        <input type="checkbox" class="cfv-filter-chip-toggle" ${rule.enabled ? 'checked' : ''} title="Enable/disable" />
        <button class="cfv-filter-chip-remove" title="Remove">&times;</button>
      </div>
    `;
  }

  private renderPresetsDropdown(): string {
    return `
      <div class="cfv-filter-presets-dropdown">
        ${this.presets.length === 0 ? '<div class="cfv-filter-preset-empty">No saved presets</div>' : ''}
        ${this.presets.map(p => `
          <div class="cfv-filter-preset-item" data-preset-id="${p.id}">
            <div class="cfv-filter-preset-info">
              <span class="cfv-filter-preset-name">${escapeHtml(p.name)}</span>
              <span class="cfv-filter-preset-count">${p.rules.length} rule${p.rules.length !== 1 ? 's' : ''}</span>
            </div>
            <div class="cfv-filter-preset-actions">
              <button class="cfv-filter-preset-apply">Apply</button>
              <button class="cfv-filter-preset-delete" title="Delete">&times;</button>
            </div>
          </div>
        `).join('')}
        <div class="cfv-filter-preset-separator"></div>
        ${this.presetNameInput ? `
          <div class="cfv-filter-preset-save-row">
            <input type="text" class="cfv-filter-preset-name-input" placeholder="Preset name..." autofocus />
            <button class="cfv-filter-preset-save-confirm">Save</button>
            <button class="cfv-filter-preset-save-cancel">&times;</button>
          </div>
        ` : `
          <button class="cfv-filter-preset-save-btn" ${this.state.rules.length === 0 ? 'disabled' : ''}>
            Save current as preset
          </button>
        `}
      </div>
    `;
  }

  private attachEvents() {
    // Add filter button
    this.container.querySelector('.cfv-filter-add-btn')?.addEventListener('click', () => {
      this.callbacks.onAddRule();
    });

    // Chip clicks (edit)
    this.container.querySelectorAll('.cfv-filter-chip').forEach(chip => {
      const chipEl = chip as HTMLElement;
      const ruleId = chipEl.dataset.ruleId!;

      chipEl.querySelector('.cfv-filter-chip-text')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onEditRule(ruleId);
      });

      chipEl.querySelector('.cfv-filter-chip-dot')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onEditRule(ruleId);
      });

      chipEl.querySelector('.cfv-filter-chip-toggle')?.addEventListener('change', (e) => {
        e.stopPropagation();
        const checked = (e.target as HTMLInputElement).checked;
        this.callbacks.onToggleRule(ruleId, checked);
      });

      chipEl.querySelector('.cfv-filter-chip-remove')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onRemoveRule(ruleId);
      });
    });

    // Show matched only toggle
    this.container.querySelector('.cfv-filter-matched-toggle input')?.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      this.callbacks.onToggleShowMatchedOnly(checked);
    });

    // Presets button
    this.container.querySelector('.cfv-filter-presets-btn')?.addEventListener('click', () => {
      this.presetsOpen = !this.presetsOpen;
      if (this.presetsOpen) {
        this.callbacks.onOpenPresets(); // triggers loading presets
      }
      this.presetNameInput = false;
      this.render();
    });

    // Preset actions
    if (this.presetsOpen) {
      this.container.querySelectorAll('.cfv-filter-preset-apply').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const item = (e.target as HTMLElement).closest('.cfv-filter-preset-item') as HTMLElement;
          const preset = this.presets.find(p => p.id === item?.dataset.presetId);
          if (preset) {
            this.callbacks.onApplyPreset(preset);
            this.presetsOpen = false;
            this.render();
          }
        });
      });

      this.container.querySelectorAll('.cfv-filter-preset-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const item = (e.target as HTMLElement).closest('.cfv-filter-preset-item') as HTMLElement;
          const presetId = item?.dataset.presetId;
          if (presetId) this.callbacks.onDeletePreset(presetId);
        });
      });

      this.container.querySelector('.cfv-filter-preset-save-btn')?.addEventListener('click', () => {
        this.presetNameInput = true;
        this.render();
        // Focus the input after re-render
        setTimeout(() => {
          (this.container.querySelector('.cfv-filter-preset-name-input') as HTMLInputElement)?.focus();
        }, 0);
      });

      this.container.querySelector('.cfv-filter-preset-save-confirm')?.addEventListener('click', () => {
        const input = this.container.querySelector('.cfv-filter-preset-name-input') as HTMLInputElement;
        const name = input?.value.trim();
        if (name) {
          this.callbacks.onSavePreset(name);
          this.presetNameInput = false;
          this.presetsOpen = false;
          this.render();
        }
      });

      this.container.querySelector('.cfv-filter-preset-save-cancel')?.addEventListener('click', () => {
        this.presetNameInput = false;
        this.render();
      });

      // Enter key on name input
      this.container.querySelector('.cfv-filter-preset-name-input')?.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') {
          (this.container.querySelector('.cfv-filter-preset-save-confirm') as HTMLElement)?.click();
        } else if ((e as KeyboardEvent).key === 'Escape') {
          this.presetNameInput = false;
          this.presetsOpen = false;
          this.render();
        }
      });

      // Click outside presets dropdown to close
      document.addEventListener('click', this.handleOutsideClick);
    }
  }

  private handleOutsideClick = (e: MouseEvent) => {
    if (!this.presetsOpen) return;
    const wrapper = this.container.querySelector('.cfv-filter-presets-wrapper');
    if (wrapper && !wrapper.contains(e.target as Node)) {
      this.presetsOpen = false;
      this.presetNameInput = false;
      this.render();
      document.removeEventListener('click', this.handleOutsideClick);
    }
  };

  dispose() {
    document.removeEventListener('click', this.handleOutsideClick);
    this.container.innerHTML = '';
  }
}
