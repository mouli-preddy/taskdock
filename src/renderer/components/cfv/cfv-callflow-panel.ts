import type { CallFlowMessage } from '../../../main/cfv/cfv-types.js';
import type { CallFilterState, FilterRule, FilterPreset } from '../../../shared/cfv-filter-types.js';
import { createEmptyFilterState, createDefaultFilterRule, generateFilterId, FILTER_COLORS } from '../../../shared/cfv-filter-types.js';
import { evaluateFilters, type FilterResult } from './cfv-filter-engine.js';
import { CfvFilterToolbar, type FilterToolbarCallbacks } from './cfv-filter-toolbar.js';
import { CfvFilterBuilder } from './cfv-filter-builder.js';
import { SERVICE_COLUMNS } from '../../../shared/cfv-types.js';
import { escapeHtml } from '../../utils/html-utils.js';
import { getIcon, ChevronLeft, ChevronRight, X } from '../../utils/icons.js';

const PAGE_SIZE = 50;

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export class CfvCallFlowPanel {
  private container: HTMLElement;
  private messages: CallFlowMessage[] = [];
  private currentPage = 0;
  private totalPages = 0;

  private callId: string = '';
  private filterState: CallFilterState = createEmptyFilterState();
  private filterResults: Map<number, FilterResult> = new Map();
  private visibleMessages: CallFlowMessage[] = [];
  private toolbar: CfvFilterToolbar | null = null;
  private builder: CfvFilterBuilder | null = null;
  private builderContainer: HTMLElement | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  setData(messages: CallFlowMessage[], callId?: string) {
    this.messages = messages;
    this.callId = callId || '';
    this.currentPage = 0;
    // Load persisted filters
    if (this.callId) {
      (window as any).electronAPI.cfvLoadCallFilters(this.callId).then((saved: CallFilterState | null) => {
        if (saved) {
          this.filterState = saved;
        }
        this.applyFilters();
        this.render();
      }).catch(() => {
        this.applyFilters();
        this.render();
      });
    } else {
      this.applyFilters();
      this.render();
    }
  }

  private render() {
    if (this.messages.length === 0) {
      this.container.innerHTML = '<div class="cfv-no-data"><p>No call flow data available</p></div>';
      return;
    }

    const activeFilters = this.filterState.rules.filter(r => r.enabled).length;
    const filterInfo = activeFilters > 0
      ? ` &middot; ${this.visibleMessages.length} of ${this.messages.length} shown (${activeFilters} filter${activeFilters !== 1 ? 's' : ''})`
      : '';

    this.container.innerHTML = `
      <div class="cfv-sequence">
        <div class="cfv-sequence-header">
          <div class="cfv-hdr-num">#</div>
          <div class="cfv-hdr-time">Time</div>
          <div class="cfv-hdr-grid">
            ${SERVICE_COLUMNS.map(col => `<div class="cfv-col-header" title="${escapeHtml(col)}">${escapeHtml(col)}</div>`).join('')}
          </div>
          <div class="cfv-hdr-latency">Latency</div>
          <div class="cfv-hdr-desc"></div>
        </div>
        <div class="cfv-filter-toolbar-container" id="cfvFilterToolbar"></div>
        <div class="cfv-filter-builder-container" id="cfvFilterBuilder" style="position:relative"></div>
        <div class="cfv-sequence-body" id="cfvSeqBody"></div>
        <div class="cfv-pagination" id="cfvPagination">
          <button class="btn btn-secondary btn-small" id="cfvPrevPage" ${this.currentPage === 0 ? 'disabled' : ''}>
            ${getIcon(ChevronLeft, 14)} Prev
          </button>
          <span id="cfvPaginationText">Page ${this.currentPage + 1} of ${this.totalPages} (${this.visibleMessages.length} messages)${filterInfo}</span>
          <button class="btn btn-secondary btn-small" id="cfvNextPage" ${this.currentPage >= this.totalPages - 1 ? 'disabled' : ''}>
            Next ${getIcon(ChevronRight, 14)}
          </button>
        </div>
      </div>
    `;

    // Set up toolbar
    const toolbarContainer = this.container.querySelector('#cfvFilterToolbar') as HTMLElement;
    this.builderContainer = this.container.querySelector('#cfvFilterBuilder') as HTMLElement;
    if (toolbarContainer) {
      this.toolbar = new CfvFilterToolbar(toolbarContainer, this.createToolbarCallbacks());
      this.toolbar.setState(this.filterState);
    }

    this.renderPage();
    this.attachEventListeners();
  }

  private renderPage() {
    const body = this.container.querySelector('#cfvSeqBody');
    if (!body) return;

    if (this.visibleMessages.length === 0 && this.filterState.rules.some(r => r.enabled)) {
      body.innerHTML = `
        <div class="cfv-filter-no-results">
          <p>No messages match current filters</p>
          <button id="cfvClearFilters">Clear all filters</button>
        </div>
      `;
      body.querySelector('#cfvClearFilters')?.addEventListener('click', () => {
        this.filterState.rules = [];
        this.filterState.showMatchedOnly = false;
        this.applyFilters();
        this.render();
        this.persistFilters();
      });
      return;
    }

    const start = this.currentPage * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, this.visibleMessages.length);
    const pageMessages = this.visibleMessages.slice(start, end);

    body.innerHTML = pageMessages.map(msg => {
      const time = (msg.reqTime || '').slice(11, 23); // HH:MM:SS.mmm
      const fromIdx = this.getColumnIndex(msg.from);
      const toIdx = this.getColumnIndex(msg.to);
      const rawLabel = msg.label || '';
      const gotMatch = rawLabel.match(/^Got\s+(\d{3})\s+/);
      const statusNum = gotMatch
        ? parseInt(gotMatch[1], 10)
        : parseInt(msg.status, 10);
      const isHttpError = !isNaN(statusNum) && statusNum >= 400;
      const isFailure = msg.isFailure || isHttpError;
      const failClass = isFailure ? ' failure' : '';
      const label = gotMatch
        ? `[HTTP: ${gotMatch[1]}] ${rawLabel.slice(gotMatch[0].length)}`
        : rawLabel;

      // Filter mark highlighting
      const result = this.filterResults.get(msg.index);
      const marks = result?.marks || [];
      const markBordersHtml = marks.map(m =>
        `<span class="cfv-mark-border" style="background:${m.color}"></span>`
      ).join('');
      const markClass = marks.length > 0 ? ' marked' : '';
      const markBg = marks.length > 0 ? ` style="background:${hexToRgba(marks[0].color, 0.08)}"` : '';

      return `
        <div class="cfv-seq-row${failClass}${markClass}" data-seq="${msg.index}"${markBg}>
          ${markBordersHtml ? `<div class="cfv-mark-borders">${markBordersHtml}</div>` : ''}
          <div class="cfv-seq-num">${msg.index}</div>
          <div class="cfv-seq-time" title="${escapeHtml(msg.reqTime || '')}">${escapeHtml(time)}</div>
          <div class="cfv-seq-grid">
            ${this.renderGridCells()}
            ${this.renderArrow(fromIdx, toIdx, isFailure)}
          </div>
          <div class="cfv-seq-latency">${escapeHtml(msg.latency || '')}</div>
          <div class="cfv-seq-desc" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
        </div>
      `;
    }).join('');

    // Attach row click handlers
    body.querySelectorAll('.cfv-seq-row').forEach(row => {
      row.addEventListener('click', () => {
        const seq = parseInt((row as HTMLElement).dataset.seq || '0');
        const msg = this.messages.find(m => m.index === seq);
        if (msg) this.showMessageModal(msg);
      });
    });
  }

  private renderGridCells(): string {
    return SERVICE_COLUMNS.map(() => '<div class="cfv-grid-cell"></div>').join('');
  }

  private renderArrow(fromIdx: number, toIdx: number, isFailure: boolean): string {
    if (fromIdx === -1 || toIdx === -1) return '';

    const failClass = isFailure ? ' failure' : '';

    // Self-message: loopback arrow at the column
    if (fromIdx === toIdx) {
      const colWidth = 100 / 12;
      const left = (fromIdx + 0.5) * colWidth;
      return `
        <div class="cfv-arrow-container">
          <div class="cfv-arrow cfv-arrow-self${failClass}" style="left:${left}%">
            <div class="cfv-arrow-self-loop"></div>
          </div>
        </div>
      `;
    }

    const minIdx = Math.min(fromIdx, toIdx);
    const maxIdx = Math.max(fromIdx, toIdx);
    const isRight = toIdx > fromIdx;
    const dirClass = isRight ? 'arrow-right' : 'arrow-left';

    // Calculate position as percentage of the 12-column grid area
    const colWidth = 100 / 12;
    const left = (minIdx + 0.5) * colWidth;
    const right = 100 - (maxIdx + 0.5) * colWidth;

    return `
      <div class="cfv-arrow-container">
        <div class="cfv-arrow ${dirClass}${failClass}" style="left:${left}%;right:${right}%">
          ${isRight ? '' : '<div class="cfv-arrow-head"></div>'}
          <div class="cfv-arrow-line"></div>
          ${isRight ? '<div class="cfv-arrow-head"></div>' : ''}
        </div>
      </div>
    `;
  }

  private getColumnIndex(serviceName: string): number {
    if (!serviceName) return -1;
    const lower = serviceName.toLowerCase();
    // Find the most specific (longest) column name that matches
    let bestIdx = -1;
    let bestLen = 0;
    for (let i = 0; i < SERVICE_COLUMNS.length; i++) {
      const col = SERVICE_COLUMNS[i].toLowerCase();
      if (lower.includes(col) && col.length > bestLen) {
        bestIdx = i;
        bestLen = col.length;
      }
    }
    if (bestIdx !== -1) return bestIdx;

    // Fuzzy match: try partial matches
    if (lower.includes('orig') || lower.includes('caller')) return 0;
    if (lower.includes('conv')) return 1;
    if (lower.includes('cc') || lower.includes('call controller')) return 2;
    if (lower.includes('target') || lower.includes('callee')) return 3;
    if (lower.includes('mc') || lower.includes('media controller')) return 4;
    if (lower.includes('mpaas') && lower.includes('ivr')) return 6;
    if (lower.includes('mpaas')) return 5;
    if (lower.includes('pnh')) return 7;
    if (lower.includes('pma')) return 8;
    if (lower.includes('agent')) return 9;
    if (lower.includes('runtime')) return 10;
    return 11; // External/Other
  }

  private showMessageModal(msg: CallFlowMessage) {
    // Remove existing modal if any
    document.querySelector('.cfv-modal-backdrop')?.remove();

    // Build filter match dots for the modal header
    const result = this.filterResults.get(msg.index);
    const marks = result?.marks || [];
    const matchDotsHtml = marks.length > 0
      ? `<div class="cfv-modal-filter-dots">${marks.map(m => {
          const rule = this.filterState.rules.find(r => r.id === m.ruleId);
          const ruleName = rule?.name || 'Filter';
          return `<span class="cfv-modal-filter-dot" style="background:${m.color}" title="${escapeHtml(ruleName)}"></span>`;
        }).join('')}</div>`
      : '';

    const backdrop = document.createElement('div');
    backdrop.className = 'cfv-modal-backdrop';
    backdrop.innerHTML = `
      <div class="cfv-modal">
        <div class="cfv-modal-header">
          ${matchDotsHtml}
          <h3>Message #${msg.index}: ${escapeHtml(msg.label || 'Unknown')}</h3>
          <button class="btn btn-icon" id="cfvModalClose">${getIcon(X, 16)}</button>
        </div>
        <div class="cfv-modal-body">
          <div class="cfv-modal-section">
            <div class="cfv-modal-meta">
              <div class="cfv-modal-field">
                <div class="cfv-modal-field-label">From</div>
                <div class="cfv-modal-field-value">${escapeHtml(msg.from || 'N/A')}</div>
              </div>
              <div class="cfv-modal-field">
                <div class="cfv-modal-field-label">To</div>
                <div class="cfv-modal-field-value">${escapeHtml(msg.to || 'N/A')}</div>
              </div>
              <div class="cfv-modal-field">
                <div class="cfv-modal-field-label">Request Time</div>
                <div class="cfv-modal-field-value">${escapeHtml(msg.reqTime || 'N/A')}</div>
              </div>
              <div class="cfv-modal-field">
                <div class="cfv-modal-field-label">Response Time</div>
                <div class="cfv-modal-field-value">${escapeHtml(msg.respTime || 'N/A')}</div>
              </div>
              <div class="cfv-modal-field">
                <div class="cfv-modal-field-label">Latency</div>
                <div class="cfv-modal-field-value">${escapeHtml(msg.latency || 'N/A')}</div>
              </div>
              <div class="cfv-modal-field">
                <div class="cfv-modal-field-label">Status</div>
                <div class="cfv-modal-field-value">${escapeHtml(msg.status || 'N/A')}${msg.isFailure ? ' (FAILURE)' : ''}</div>
              </div>
              <div class="cfv-modal-field">
                <div class="cfv-modal-field-label">Protocol</div>
                <div class="cfv-modal-field-value">${escapeHtml(msg.protocol || 'N/A')}</div>
              </div>
              <div class="cfv-modal-field">
                <div class="cfv-modal-field-label">Message ID</div>
                <div class="cfv-modal-field-value">${escapeHtml(msg.messageId || 'N/A')}</div>
              </div>
            </div>
          </div>
          ${msg.req ? `
          <div class="cfv-modal-section">
            <h4>Request</h4>
            <div class="cfv-modal-pre">${escapeHtml(msg.req)}</div>
          </div>
          ` : ''}
          ${msg.resp ? `
          <div class="cfv-modal-section">
            <h4>Response</h4>
            <div class="cfv-modal-pre">${escapeHtml(msg.resp)}</div>
          </div>
          ` : ''}
          ${msg.error ? `
          <div class="cfv-modal-section">
            <h4>Error</h4>
            <div class="cfv-modal-pre" style="color:var(--error)">${escapeHtml(msg.error)}</div>
          </div>
          ` : ''}
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    // Close handlers
    backdrop.querySelector('#cfvModalClose')?.addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        backdrop.remove();
        document.removeEventListener('keydown', onEsc);
      }
    };
    document.addEventListener('keydown', onEsc);
  }

  private attachEventListeners() {
    this.container.querySelector('#cfvPrevPage')?.addEventListener('click', () => {
      if (this.currentPage > 0) {
        this.currentPage--;
        this.render();
      }
    });

    this.container.querySelector('#cfvNextPage')?.addEventListener('click', () => {
      if (this.currentPage < this.totalPages - 1) {
        this.currentPage++;
        this.render();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Filter application
  // ---------------------------------------------------------------------------

  private applyFilters() {
    this.filterResults = evaluateFilters(this.messages, this.filterState);
    this.visibleMessages = this.messages.filter(msg => {
      const result = this.filterResults.get(msg.index);
      return result ? result.visible : true;
    });
    this.totalPages = Math.max(1, Math.ceil(this.visibleMessages.length / PAGE_SIZE));
    if (this.currentPage >= this.totalPages) {
      this.currentPage = Math.max(0, this.totalPages - 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Pagination update helper
  // ---------------------------------------------------------------------------

  private updatePagination() {
    const paginationText = this.container.querySelector('#cfvPaginationText');
    const prevBtn = this.container.querySelector('#cfvPrevPage') as HTMLButtonElement | null;
    const nextBtn = this.container.querySelector('#cfvNextPage') as HTMLButtonElement | null;

    if (paginationText) {
      const activeFilters = this.filterState.rules.filter(r => r.enabled).length;
      const filterInfo = activeFilters > 0
        ? ` \u00b7 ${this.visibleMessages.length} of ${this.messages.length} shown (${activeFilters} filter${activeFilters !== 1 ? 's' : ''})`
        : '';
      paginationText.textContent = `Page ${this.currentPage + 1} of ${this.totalPages} (${this.visibleMessages.length} messages)${filterInfo}`;
    }

    if (prevBtn) {
      prevBtn.disabled = this.currentPage === 0;
    }
    if (nextBtn) {
      nextBtn.disabled = this.currentPage >= this.totalPages - 1;
    }
  }

  // ---------------------------------------------------------------------------
  // Toolbar callbacks
  // ---------------------------------------------------------------------------

  private createToolbarCallbacks(): FilterToolbarCallbacks {
    return {
      onAddRule: () => { this.addRule(); },
      onEditRule: (ruleId) => { this.editRule(ruleId); },
      onRemoveRule: (ruleId) => { this.removeRule(ruleId); },
      onToggleRule: (ruleId, enabled) => { this.toggleRule(ruleId, enabled); },
      onToggleShowMatchedOnly: (value) => { this.toggleShowMatchedOnly(value); },
      onOpenPresets: () => { this.loadPresets(); },
      onApplyPreset: (preset) => { this.applyPreset(preset); },
      onSavePreset: (name) => { this.savePreset(name); },
      onDeletePreset: (presetId) => { this.deletePreset(presetId); },
    };
  }

  // ---------------------------------------------------------------------------
  // Filter action methods
  // ---------------------------------------------------------------------------

  private addRule() {
    const colorIndex = this.filterState.rules.length;
    const rule = createDefaultFilterRule(colorIndex);
    this.openBuilder(rule);
  }

  private editRule(ruleId: string) {
    const rule = this.filterState.rules.find(r => r.id === ruleId);
    if (rule) this.openBuilder(rule);
  }

  private removeRule(ruleId: string) {
    this.filterState.rules = this.filterState.rules.filter(r => r.id !== ruleId);
    this.applyFilters();
    this.render();
    this.persistFilters();
  }

  private toggleRule(ruleId: string, enabled: boolean) {
    const rule = this.filterState.rules.find(r => r.id === ruleId);
    if (rule) {
      rule.enabled = enabled;
      this.applyFilters();
      this.renderPage();
      this.updatePagination();
      this.toolbar?.setState(this.filterState);
      this.persistFilters();
    }
  }

  private toggleShowMatchedOnly(value: boolean) {
    this.filterState.showMatchedOnly = value;
    this.applyFilters();
    this.renderPage();
    this.updatePagination();
    this.persistFilters();
  }

  private openBuilder(rule: FilterRule) {
    this.closeBuilder();
    if (!this.builderContainer) return;
    this.builder = new CfvFilterBuilder(this.builderContainer, rule, {
      onApply: (updatedRule) => {
        const idx = this.filterState.rules.findIndex(r => r.id === updatedRule.id);
        if (idx >= 0) {
          this.filterState.rules[idx] = updatedRule;
        } else {
          this.filterState.rules.push(updatedRule);
        }
        this.closeBuilder();
        this.applyFilters();
        this.render();
        this.persistFilters();
      },
      onCancel: () => {
        this.closeBuilder();
      },
    });
  }

  private closeBuilder() {
    this.builder?.dispose();
    this.builder = null;
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private persistFilters() {
    if (!this.callId) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      (window as any).electronAPI.cfvSaveCallFilters(this.callId, this.filterState).catch(console.error);
    }, 500);
  }

  // ---------------------------------------------------------------------------
  // Preset methods
  // ---------------------------------------------------------------------------

  private async loadPresets() {
    try {
      const presets = await (window as any).electronAPI.cfvListFilterPresets();
      this.toolbar?.setPresets(presets || []);
    } catch { /* ignore */ }
  }

  private applyPreset(preset: FilterPreset) {
    // Deep clone rules and assign new IDs
    this.filterState.rules = preset.rules.map(r => ({
      ...JSON.parse(JSON.stringify(r)),
      id: generateFilterId(),
    }));
    this.applyFilters();
    this.render();
    this.persistFilters();
  }

  private async savePreset(name: string) {
    const preset: FilterPreset = {
      id: generateFilterId(),
      name,
      rules: JSON.parse(JSON.stringify(this.filterState.rules)),
    };
    try {
      await (window as any).electronAPI.cfvSaveFilterPreset(preset);
    } catch { /* ignore */ }
  }

  private async deletePreset(presetId: string) {
    try {
      await (window as any).electronAPI.cfvDeleteFilterPreset(presetId);
      await this.loadPresets();
    } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  dispose() {
    document.querySelector('.cfv-modal-backdrop')?.remove();
    this.closeBuilder();
    this.toolbar?.dispose();
    this.toolbar = null;
    if (this.saveTimer) clearTimeout(this.saveTimer);
  }
}
