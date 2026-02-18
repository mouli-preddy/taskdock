import type { CfvCallSummary, FetchProgress } from '../../../shared/cfv-types.js';
import { escapeHtml, formatTimeAgo } from '../../utils/html-utils.js';
import { getIcon, RefreshCw, Search, Trash2, Activity, Zap, Edit, X } from '../../utils/icons.js';

export interface TokenAcquisitionProgress {
  status: string;
  message: string;
  headless?: boolean;
  tokenLength?: number;
  error?: string;
}

// Map backend status codes to user-friendly messages
const STATUS_MESSAGES: Record<string, string> = {
  'checking-profile': 'Checking Edge profile...',
  'copying-profile': 'Setting up Edge profile...',
  'launching-browser': 'Launching Edge (headless)...',
  'navigating': 'Navigating to CFV portal...',
  'waiting-for-auth': 'Complete login in the browser window...',
  'navigating-to-call': 'Triggering API calls...',
  'token-captured': 'Token captured!',
  'headless-failed': 'Headless login failed, opening browser...',
  'opening-visible': 'Opening Edge for login...',
  'error': 'Token acquisition failed',
  'complete': 'Token acquired!',
  'cancelled': 'Cancelled',
};

export class CfvHomeView {
  private container: HTMLElement;
  private calls: CfvCallSummary[] = [];
  private loading = false;
  private tokenValid = false;
  private hasToken = false;
  private fetchProgress: FetchProgress | null = null;
  private fetching = false;
  private showManualToken = false;
  private acquiring = false;

  private onFetchCallCallback: ((callId: string) => void) | null = null;
  private onOpenCallCallback: ((callId: string) => void) | null = null;
  private onSetTokenCallback: ((token: string) => void) | null = null;
  private onDeleteCallCallback: ((callId: string) => void) | null = null;
  private onRefreshCallback: (() => void) | null = null;
  private onAcquireTokenCallback: (() => void) | null = null;
  private onCancelAcquireTokenCallback: (() => void) | null = null;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.render();
  }

  onFetchCall(callback: (callId: string) => void) {
    this.onFetchCallCallback = callback;
  }

  onOpenCall(callback: (callId: string) => void) {
    this.onOpenCallCallback = callback;
  }

  onSetToken(callback: (token: string) => void) {
    this.onSetTokenCallback = callback;
  }

  onDeleteCall(callback: (callId: string) => void) {
    this.onDeleteCallCallback = callback;
  }

  onRefresh(callback: () => void) {
    this.onRefreshCallback = callback;
  }

  onAcquireToken(callback: () => void) {
    this.onAcquireTokenCallback = callback;
  }

  onCancelAcquireToken(callback: () => void) {
    this.onCancelAcquireTokenCallback = callback;
  }

  setCalls(calls: CfvCallSummary[]) {
    this.calls = calls;
    this.loading = false;
    this.renderCallsList();
  }

  setLoading(loading: boolean) {
    this.loading = loading;
    this.renderCallsList();
  }

  setTokenStatus(status: { valid: boolean; hasToken: boolean }) {
    this.tokenValid = status.valid;
    this.hasToken = status.hasToken;
    this.updateTokenStatus();
  }

  setFetchProgress(progress: FetchProgress | null) {
    this.fetchProgress = progress;
    this.fetching = !!progress;
    this.updateFetchProgress();
  }

  setTokenAcquisitionProgress(progress: TokenAcquisitionProgress | null) {
    const area = this.container.querySelector('#cfvTokenAcquisitionArea') as HTMLElement;
    const autoLoginBtn = this.container.querySelector('#cfvAutoLoginBtn') as HTMLButtonElement;
    if (!area) return;

    if (!progress) {
      area.style.display = 'none';
      this.acquiring = false;
      if (autoLoginBtn) autoLoginBtn.disabled = false;
      return;
    }

    this.acquiring = true;
    if (autoLoginBtn) autoLoginBtn.disabled = true;
    area.style.display = '';

    const message = STATUS_MESSAGES[progress.status] || progress.message;
    const isError = progress.status === 'error';
    const isDone = progress.status === 'complete' || progress.status === 'cancelled';
    const showSpinner = !isError && !isDone;
    const showCancel = showSpinner;

    area.innerHTML = `
      <div class="cfv-token-acquisition ${isError ? 'error' : ''} ${isDone ? 'done' : ''}">
        ${showSpinner ? '<div class="loading-spinner small"></div>' : ''}
        <span class="cfv-token-acquisition-msg">${escapeHtml(message)}</span>
        ${showCancel ? `<button class="btn btn-secondary btn-small" id="cfvCancelAcquireBtn">${getIcon(X, 12)} Cancel</button>` : ''}
      </div>
    `;

    if (showCancel) {
      area.querySelector('#cfvCancelAcquireBtn')?.addEventListener('click', () => {
        this.onCancelAcquireTokenCallback?.();
      });
    }

    // Auto-hide on completion after a brief delay
    if (isDone) {
      setTimeout(() => {
        this.setTokenAcquisitionProgress(null);
      }, 2000);
    }
  }

  setSubtitle(text: string) {
    const el = this.container.querySelector('.cfv-subtitle');
    if (el) el.textContent = text;
  }

  private render() {
    this.container.innerHTML = `
      <div class="cfv-home-view">
        <header class="cfv-header">
          <div style="display:flex;align-items:center;gap:8px">
            <h1>Call Flow Visualizer</h1>
            <span class="cfv-subtitle"></span>
          </div>
          <button class="btn btn-secondary" id="cfvRefreshBtn">
            ${getIcon(RefreshCw, 16)}
            Refresh
          </button>
        </header>

        <div class="cfv-token-bar">
          <div class="cfv-token-status">
            <div class="cfv-token-dot" id="cfvTokenDot"></div>
            <span id="cfvTokenLabel">No token</span>
          </div>
          <button class="btn btn-primary btn-small" id="cfvAutoLoginBtn">
            ${getIcon(Zap, 14)}
            Auto Login
          </button>
          <button class="btn btn-icon btn-small btn-secondary" id="cfvToggleManualBtn" title="Manual token paste">
            ${getIcon(Edit, 14)}
          </button>
        </div>

        <div class="cfv-manual-token-row" id="cfvManualTokenRow" style="display:none">
          <input type="password" class="cfv-token-input" id="cfvTokenInput"
                 placeholder="Paste CFV Bearer token..." autocomplete="off" />
          <button class="btn btn-secondary btn-small" id="cfvSetTokenBtn">Set Token</button>
        </div>

        <div id="cfvTokenAcquisitionArea" style="display:none"></div>

        <div class="cfv-search-bar">
          <input type="text" id="cfvCallIdInput" placeholder="Enter Call ID (GUID)..." />
          <button class="btn btn-primary" id="cfvFetchBtn" ${this.fetching ? 'disabled' : ''}>
            ${getIcon(Search, 16)}
            Fetch
          </button>
        </div>

        <div class="cfv-progress-bar" id="cfvProgressBar" style="display:none">
          <div class="cfv-progress-fill" id="cfvProgressFill"></div>
        </div>
        <div class="cfv-progress-label" id="cfvProgressLabel" style="display:none"></div>

        <div class="cfv-calls-list" id="cfvCallsList"></div>
      </div>
    `;

    this.attachEventListeners();
    this.renderCallsList();
  }

  private attachEventListeners() {
    this.container.querySelector('#cfvRefreshBtn')?.addEventListener('click', () => {
      this.onRefreshCallback?.();
    });

    this.container.querySelector('#cfvAutoLoginBtn')?.addEventListener('click', () => {
      this.onAcquireTokenCallback?.();
    });

    this.container.querySelector('#cfvToggleManualBtn')?.addEventListener('click', () => {
      this.showManualToken = !this.showManualToken;
      const row = this.container.querySelector('#cfvManualTokenRow') as HTMLElement;
      if (row) row.style.display = this.showManualToken ? '' : 'none';
    });

    this.container.querySelector('#cfvSetTokenBtn')?.addEventListener('click', () => {
      const input = this.container.querySelector('#cfvTokenInput') as HTMLInputElement;
      const token = input.value.trim();
      if (token) {
        this.onSetTokenCallback?.(token);
        input.value = '';
      }
    });

    this.container.querySelector('#cfvTokenInput')?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        const input = e.target as HTMLInputElement;
        const token = input.value.trim();
        if (token) {
          this.onSetTokenCallback?.(token);
          input.value = '';
        }
      }
    });

    this.container.querySelector('#cfvFetchBtn')?.addEventListener('click', () => {
      const input = this.container.querySelector('#cfvCallIdInput') as HTMLInputElement;
      const callId = input.value.trim();
      if (callId) {
        this.onFetchCallCallback?.(callId);
      }
    });

    this.container.querySelector('#cfvCallIdInput')?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        const input = e.target as HTMLInputElement;
        const callId = input.value.trim();
        if (callId) {
          this.onFetchCallCallback?.(callId);
        }
      }
    });
  }

  private updateTokenStatus() {
    const dot = this.container.querySelector('#cfvTokenDot');
    const label = this.container.querySelector('#cfvTokenLabel');
    if (!dot || !label) return;

    dot.className = 'cfv-token-dot';
    if (this.hasToken && this.tokenValid) {
      dot.classList.add('valid');
      label.textContent = 'Token valid';
    } else if (this.hasToken) {
      dot.classList.add('invalid');
      label.textContent = 'Token expired';
    } else {
      label.textContent = 'No token';
    }
  }

  private updateFetchProgress() {
    const bar = this.container.querySelector('#cfvProgressBar') as HTMLElement;
    const fill = this.container.querySelector('#cfvProgressFill') as HTMLElement;
    const label = this.container.querySelector('#cfvProgressLabel') as HTMLElement;
    const fetchBtn = this.container.querySelector('#cfvFetchBtn') as HTMLButtonElement;

    if (!bar || !fill || !label) return;

    if (this.fetchProgress) {
      bar.style.display = '';
      label.style.display = '';
      const pct = this.fetchProgress.percentComplete
        ?? ((this.fetchProgress.step / this.fetchProgress.totalSteps) * 100);
      fill.style.width = `${Math.min(100, pct)}%`;
      label.textContent = `Step ${this.fetchProgress.step}/${this.fetchProgress.totalSteps}: ${this.fetchProgress.label}`;
      if (fetchBtn) fetchBtn.disabled = true;
    } else {
      bar.style.display = 'none';
      label.style.display = 'none';
      fill.style.width = '0%';
      if (fetchBtn) fetchBtn.disabled = false;
    }
  }

  private renderCallsList() {
    const container = this.container.querySelector('#cfvCallsList');
    if (!container) return;

    if (this.loading) {
      container.innerHTML = `
        <div class="cfv-loading">
          <div class="loading-spinner"></div>
          <p>Loading cached calls...</p>
        </div>
      `;
      return;
    }

    if (this.calls.length === 0) {
      container.innerHTML = `
        <div class="cfv-empty">
          ${getIcon(Activity, 48)}
          <p>No cached calls</p>
          <p style="font-size:11px">Enter a Call ID above and click Fetch to get started</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.calls.map(call => `
      <div class="cfv-call-card" data-call-id="${escapeHtml(call.callId)}">
        <div class="cfv-call-card-info">
          <div class="cfv-call-id">${escapeHtml(call.callId)}</div>
          <div class="cfv-call-meta">
            ${call.messageCount} messages &middot; ${call.diagnosticFiles} diagnostic files &middot;
            ${formatTimeAgo(new Date(call.fetchedAt))}
          </div>
        </div>
        <div class="cfv-call-actions">
          <button class="btn btn-icon btn-small btn-danger cfv-delete-btn"
                  data-call-id="${escapeHtml(call.callId)}" title="Delete">
            ${getIcon(Trash2, 14)}
          </button>
        </div>
      </div>
    `).join('');

    // Attach card click -> open
    container.querySelectorAll('.cfv-call-card').forEach(card => {
      card.addEventListener('click', (e) => {
        // Don't open if delete button was clicked
        if ((e.target as HTMLElement).closest('.cfv-delete-btn')) return;
        const callId = (card as HTMLElement).dataset.callId!;
        this.onOpenCallCallback?.(callId);
      });
    });

    // Attach delete buttons
    container.querySelectorAll('.cfv-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const callId = (btn as HTMLElement).dataset.callId!;
        this.onDeleteCallCallback?.(callId);
      });
    });
  }
}
