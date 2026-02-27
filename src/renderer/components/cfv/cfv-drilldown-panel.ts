import type { CallDetailsData } from '../../../main/cfv/cfv-types.js';
import { escapeHtml } from '../../utils/html-utils.js';
import { getIcon, ChevronRight } from '../../utils/icons.js';

type FilterMode = 'all' | 'errors' | 'bots';

export class CfvDrillDownPanel {
  private container: HTMLElement;
  private legs: Array<Record<string, unknown>> = [];
  private filter: FilterMode = 'all';
  private searchQuery = '';

  constructor(container: HTMLElement) {
    this.container = container;
  }

  setData(details: CallDetailsData | null) {
    this.legs = (details?.callDetails?.legs ?? []) as Array<Record<string, unknown>>;
    this.render();
  }

  private render() {
    if (this.legs.length === 0) {
      this.container.innerHTML = '<div class="cfv-no-data"><p>No call leg data available</p></div>';
      return;
    }

    this.container.innerHTML = `
      <div class="cfv-drilldown">
        <div class="cfv-drilldown-filters">
          <button class="cfv-filter-btn ${this.filter === 'all' ? 'active' : ''}" data-filter="all">All (${this.legs.length})</button>
          <button class="cfv-filter-btn ${this.filter === 'errors' ? 'active' : ''}" data-filter="errors">Errors</button>
          <button class="cfv-filter-btn ${this.filter === 'bots' ? 'active' : ''}" data-filter="bots">Bots</button>
          <input class="cfv-drilldown-search" type="text" placeholder="Search legs..."
                 value="${escapeHtml(this.searchQuery)}" />
        </div>
        <div class="cfv-drilldown-list" id="cfvDrilldownList"></div>
      </div>
    `;

    this.renderLegs();
    this.attachEventListeners();
  }

  private getFilteredLegs(): Array<Record<string, unknown>> {
    let filtered = this.legs;

    if (this.filter === 'errors') {
      filtered = filtered.filter(leg => {
        const bp = (leg.backendParticipant ?? {}) as Record<string, unknown>;
        const code = String(bp.resultCode ?? '');
        return code !== '' && code !== '0' && code !== '200';
      });
    } else if (this.filter === 'bots') {
      filtered = filtered.filter(leg => {
        const userType = String(leg.userType ?? '').toLowerCase();
        return userType.includes('bot') || userType.includes('application');
      });
    }

    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      filtered = filtered.filter(leg => {
        const legStr = JSON.stringify(leg).toLowerCase();
        return legStr.includes(q);
      });
    }

    return filtered;
  }

  private renderLegs() {
    const list = this.container.querySelector('#cfvDrilldownList');
    if (!list) return;

    const filtered = this.getFilteredLegs();
    if (filtered.length === 0) {
      list.innerHTML = '<div class="cfv-no-data" style="height:100px"><p>No matching legs</p></div>';
      return;
    }

    list.innerHTML = filtered.map((leg, idx) => {
      const bp = (leg.backendParticipant ?? {}) as Record<string, unknown>;
      const legId = String(leg.legId ?? `leg-${idx}`);
      const legType = String(leg.legType ?? 'Unknown');
      const userType = String(leg.userType ?? '');
      const role = String(leg.role ?? '');
      const resultCode = String(bp.resultCode ?? '');
      const resultSubCode = String(bp.resultSubCode ?? '');
      const resultDetail = String(bp.resultDetailString ?? bp.resultDetail ?? '');
      const isError = resultCode !== '' && resultCode !== '0' && resultCode !== '200';
      const outcomeClass = isError ? 'failure' : 'success';
      const outcomeText = resultCode ? `${resultCode}/${resultSubCode}` : 'N/A';

      return `
        <div class="cfv-leg-row" data-leg-idx="${idx}">
          <div class="cfv-leg-header">
            <div class="cfv-leg-expand">${getIcon(ChevronRight, 14)}</div>
            <span class="cfv-leg-type">${escapeHtml(legType)}</span>
            <span class="cfv-leg-id" title="${escapeHtml(legId)}">${escapeHtml(legId)}</span>
            ${userType ? `<span style="font-size:11px;color:var(--text-tertiary)">${escapeHtml(userType)}</span>` : ''}
            <span class="cfv-leg-outcome ${outcomeClass}">${escapeHtml(outcomeText)}</span>
          </div>
          <div class="cfv-leg-details">
            <div class="cfv-leg-detail-grid">
              <span class="cfv-leg-detail-label">Leg ID</span>
              <span class="cfv-leg-detail-value">${escapeHtml(legId)}</span>
              <span class="cfv-leg-detail-label">Leg Type</span>
              <span class="cfv-leg-detail-value">${escapeHtml(legType)}</span>
              <span class="cfv-leg-detail-label">User Type</span>
              <span class="cfv-leg-detail-value">${escapeHtml(userType || 'N/A')}</span>
              <span class="cfv-leg-detail-label">Role</span>
              <span class="cfv-leg-detail-value">${escapeHtml(role || 'N/A')}</span>
              <span class="cfv-leg-detail-label">Result Code</span>
              <span class="cfv-leg-detail-value">${escapeHtml(resultCode || 'N/A')}</span>
              <span class="cfv-leg-detail-label">Result SubCode</span>
              <span class="cfv-leg-detail-value">${escapeHtml(resultSubCode || 'N/A')}</span>
              <span class="cfv-leg-detail-label">Result Detail</span>
              <span class="cfv-leg-detail-value">${escapeHtml(resultDetail || 'N/A')}</span>
              ${bp.didAccept !== undefined ? `
              <span class="cfv-leg-detail-label">Did Accept</span>
              <span class="cfv-leg-detail-value">${bp.didAccept ? 'Yes' : 'No'}</span>
              ` : ''}
              ${bp.callEndMessage ? `
              <span class="cfv-leg-detail-label">Call End Message</span>
              <span class="cfv-leg-detail-value">${escapeHtml(String(bp.callEndMessage))}</span>
              ` : ''}
              ${leg.failedStep ? `
              <span class="cfv-leg-detail-label">Failed Step</span>
              <span class="cfv-leg-detail-value" style="color:var(--error)">${escapeHtml(String(leg.failedStep))}</span>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Toggle expand on header click
    list.querySelectorAll('.cfv-leg-header').forEach(header => {
      header.addEventListener('click', () => {
        const row = header.closest('.cfv-leg-row');
        row?.classList.toggle('expanded');
      });
    });
  }

  private attachEventListeners() {
    // Filter buttons
    this.container.querySelectorAll('.cfv-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.filter = (btn as HTMLElement).dataset.filter as FilterMode;
        this.render();
      });
    });

    // Search input
    const searchInput = this.container.querySelector('.cfv-drilldown-search') as HTMLInputElement;
    if (searchInput) {
      let debounceTimer: ReturnType<typeof setTimeout>;
      searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this.searchQuery = searchInput.value;
          this.renderLegs();
        }, 300);
      });
    }
  }

  dispose() {}
}
