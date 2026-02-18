import type {
  DGrepEndpointName,
  LogId,
  OffsetSign,
  OffsetUnit,
  ScopingCondition,
  ScopingOperator,
  DGrepProgressEvent,
  DGrepCompleteEvent,
  DGrepErrorEvent,
  QueryOptions,
} from '../../shared/dgrep-types.js';
import {
  DGREP_ENDPOINT_URLS,
  LOG_CONFIGS,
} from '../../shared/dgrep-types.js';
import type { DGrepFormState } from '../../shared/dgrep-ui-types.js';
import { DGrepSearchableSelect } from './dgrep-searchable-select.js';
import { DGrepResultsTable } from './dgrep-results-table.js';
import { parseDGrepUrl, buildDGrepUrl } from './dgrep-url-parser.js';
import { KqlEditor } from './kql-editor.js';
import { getIcon, Search, X, Download, RefreshCw } from '../utils/icons.js';

const ENDPOINT_NAMES = Object.keys(DGREP_ENDPOINT_URLS) as DGrepEndpointName[];
const LOG_IDS = Object.keys(LOG_CONFIGS) as LogId[];
const SCOPING_OPERATORS: ScopingOperator[] = ['contains', '!contains', '==', '!=', 'equals any of', 'contains any of'];
const MAX_VISIBLE_EVENTS = 200;

export class DGrepSearchView {
  private container: HTMLElement;
  private namespaceSelect!: DGrepSearchableSelect;
  private resultsTable!: DGrepResultsTable;
  private serverQueryEditor!: KqlEditor;
  private clientQueryEditor!: KqlEditor;

  // Form state
  private allEvents: string[] = [];
  private filteredEvents: string[] = [];
  private selectedEvents: Set<string> = new Set();
  private showSecurityEvents = false;
  private scopingConditions: ScopingCondition[] = [];

  // Search state
  private activeSessionId: string | null = null;
  private pendingSessionId = false; // true while waiting for sessionId from RPC
  private searching = false;
  private namespacesLoading = false;
  private eventsLoading = false;
  private bufferedEvents: Array<{ type: string; event: any }> = [];

  // Callbacks
  private onSearchCallback: ((params: QueryOptions) => Promise<string>) | null = null;
  private onSearchByLogIdCallback: ((logId: LogId, startTime: string, endTime: string, options: any) => Promise<string>) | null = null;
  private onCancelCallback: ((sessionId: string) => void) | null = null;
  private onOpenInGenevaCallback: ((url: string) => void) | null = null;
  private onFetchNamespacesCallback: ((endpoint: string) => Promise<string[]>) | null = null;
  private onFetchEventsCallback: ((endpoint: string, namespace: string) => Promise<string[]>) | null = null;
  private onGetResultsCallback: ((sessionId: string) => Promise<{ columns: string[]; rows: Record<string, any>[] } | undefined>) | null = null;
  private onGetResultsPageCallback: ((sessionId: string, offset: number, limit: number) => Promise<{ columns: string[]; rows: Record<string, any>[]; totalCount: number } | undefined>) | null = null;
  private onRunClientQueryCallback: ((sessionId: string, clientQuery: string) => Promise<void>) | null = null;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.render();
    this.attachEventListeners();
  }

  // ==================== Callback setters ====================

  onSearch(cb: (params: QueryOptions) => Promise<string>): void { this.onSearchCallback = cb; }
  onSearchByLogId(cb: (logId: LogId, startTime: string, endTime: string, options: any) => Promise<string>): void { this.onSearchByLogIdCallback = cb; }
  onCancel(cb: (sessionId: string) => void): void { this.onCancelCallback = cb; }
  onOpenInGeneva(cb: (url: string) => void): void { this.onOpenInGenevaCallback = cb; }
  onFetchNamespaces(cb: (endpoint: string) => Promise<string[]>): void { this.onFetchNamespacesCallback = cb; }
  onFetchEvents(cb: (endpoint: string, namespace: string) => Promise<string[]>): void { this.onFetchEventsCallback = cb; }
  onGetResults(cb: (sessionId: string) => Promise<{ columns: string[]; rows: Record<string, any>[] } | undefined>): void { this.onGetResultsCallback = cb; }
  onGetResultsPage(cb: (sessionId: string, offset: number, limit: number) => Promise<{ columns: string[]; rows: Record<string, any>[]; totalCount: number } | undefined>): void { this.onGetResultsPageCallback = cb; }
  onRunClientQuery(cb: (sessionId: string, clientQuery: string) => Promise<void>): void { this.onRunClientQueryCallback = cb; }

  // ==================== Public methods ====================

  setSearchProgress(event: DGrepProgressEvent): void {
    // Buffer events if we haven't received the sessionId yet
    if (this.pendingSessionId && !this.activeSessionId) {
      this.bufferedEvents.push({ type: 'progress', event });
      // Still show progress even while buffering
      this.searching = true;
      this.updateStatusBar(event.statusText || 'Searching...', event.progress, event.resultCount);
      return;
    }
    if (event.sessionId !== this.activeSessionId) return;
    this.searching = true;
    this.updateStatusBar(event.statusText || 'Searching...', event.progress, event.resultCount);
  }

  setSearchComplete(event: DGrepCompleteEvent): void {
    if (this.pendingSessionId && !this.activeSessionId) {
      this.bufferedEvents.push({ type: 'complete', event });
      return;
    }
    if (event.sessionId !== this.activeSessionId) return;
    this.searching = false;
    this.updateStatusBar(`Complete: ${event.resultCount.toLocaleString()} results`, 100, event.resultCount);
    this.updateSearchButtons();
    this.enableClientQuery(true);
    this.loadResults(event.sessionId);
  }

  setSearchError(event: DGrepErrorEvent): void {
    if (this.pendingSessionId && !this.activeSessionId) {
      this.bufferedEvents.push({ type: 'error', event });
      return;
    }
    if (event.sessionId !== this.activeSessionId) return;
    this.searching = false;
    this.updateStatusBar(`Error: ${event.error}`, undefined, undefined, true);
    this.updateSearchButtons();
  }

  setIntermediateResults(event: { sessionId: string; columns: string[]; rows: Record<string, any>[]; totalCount: number }): void {
    // Accept intermediate results during pending (new search, no stale sessionId yet)
    // or when sessionId matches the active search
    const isCurrentSearch = event.sessionId === this.activeSessionId;
    const isNewSearch = this.pendingSessionId && !this.activeSessionId;
    if (isCurrentSearch || isNewSearch) {
      this.resultsTable.setData(event.columns, event.rows);
      this.enableActionButtons(true);
      this.updateStatusBar(
        `Searching... (${event.rows.length.toLocaleString()} of ~${event.totalCount.toLocaleString()} rows loaded)`,
        undefined,
        event.rows.length,
      );
    }
  }

  setResults(columns: string[], rows: Record<string, any>[]): void {
    this.resultsTable.setData(columns, rows);
  }

  async populateFromUrl(url: string): Promise<void> {
    const parsed = parseDGrepUrl(url);
    if (!parsed) return;

    // Set endpoint
    if (parsed.endpoint) {
      const endpointSelect = this.container.querySelector('#dgrepEndpoint') as HTMLSelectElement;
      if (endpointSelect) {
        endpointSelect.value = parsed.endpoint;
        await this.onEndpointChange(parsed.endpoint);
      }
    }

    // Set namespace
    if (parsed.namespace) {
      this.namespaceSelect.setValue(parsed.namespace);
      await this.onNamespaceChange(parsed.namespace);
    }

    // Set events
    if (parsed.eventNames.length > 0) {
      this.selectedEvents = new Set(parsed.eventNames);
      this.renderEventsList();
    }

    // Set time
    if (parsed.referenceTime) {
      const timeInput = this.container.querySelector('#dgrepReferenceTime') as HTMLInputElement;
      if (timeInput) {
        // Convert ISO to datetime-local format
        const dt = new Date(parsed.referenceTime);
        timeInput.value = dt.toISOString().slice(0, 16);
      }
    }

    // Set offset
    if (parsed.offset != null) {
      const offsetVal = this.container.querySelector('#dgrepOffsetValue') as HTMLInputElement;
      if (offsetVal) offsetVal.value = String(parsed.offset);
    }
    if (parsed.offsetUnit) {
      const offsetUnit = this.container.querySelector('#dgrepOffsetUnit') as HTMLSelectElement;
      if (offsetUnit) offsetUnit.value = parsed.offsetUnit;
    }

    // Set offset sign
    const signRadio = this.container.querySelector(`input[name="dgrepOffsetSign"][value="${parsed.offsetSign}"]`) as HTMLInputElement;
    if (signRadio) signRadio.checked = true;

    // Set server query
    if (parsed.serverQuery) {
      this.serverQueryEditor.setValue(parsed.serverQuery);
    }

    // Set client query
    if (parsed.clientQuery) {
      this.clientQueryEditor.setValue(parsed.clientQuery);
    }

    // Set scoping conditions
    if (parsed.scopingConditions.length > 0) {
      this.scopingConditions = parsed.scopingConditions;
      this.renderScopingConditions();
    }
  }

  async populateFromLogId(logId: LogId): Promise<void> {
    const config = LOG_CONFIGS[logId];
    if (!config) return;

    // Set endpoint
    const endpointSelect = this.container.querySelector('#dgrepEndpoint') as HTMLSelectElement;
    if (endpointSelect) {
      endpointSelect.value = config.endpointName;
      await this.onEndpointChange(config.endpointName);
    }

    // Set namespace
    this.namespaceSelect.setValue(config.namespace);
    await this.onNamespaceChange(config.namespace);

    // Set events
    this.selectedEvents = new Set(config.events.split(',').map(e => e.trim()));
    this.renderEventsList();

    // Set default client query
    this.clientQueryEditor.setValue(config.defaultClientQuery);
  }

  // ==================== Rendering ====================

  private render(): void {
    this.container.innerHTML = `
      <div class="dgrep-container">
        <div class="dgrep-query-panel" id="dgrepQueryPanel">
          <div class="dgrep-panel-header">
            <h3>Query</h3>
            <button class="btn btn-sm btn-ghost dgrep-collapse-btn" id="dgrepCollapseBtn" title="Collapse panel">&laquo;</button>
          </div>

          <!-- Quick actions bar -->
          <div class="dgrep-quick-bar">
            <div class="dgrep-field">
              <label>Log Preset</label>
              <select id="dgrepLogId" class="dgrep-select">
                <option value="">-- Select preset --</option>
                ${LOG_IDS.map(id => `<option value="${id}">${id} (${LOG_CONFIGS[id].namespace}/${LOG_CONFIGS[id].events})</option>`).join('')}
              </select>
            </div>
            <div class="dgrep-field dgrep-url-field">
              <label>DGrep URL</label>
              <div class="dgrep-url-row">
                <input type="text" id="dgrepUrlInput" class="dgrep-input" placeholder="Paste DGrep portal URL...">
                <button class="btn btn-sm btn-secondary" id="dgrepParseUrlBtn">Parse</button>
              </div>
            </div>
          </div>

          <div class="dgrep-form-scroll">
            <!-- Endpoint -->
            <div class="dgrep-field">
              <label>Endpoint</label>
              <select id="dgrepEndpoint" class="dgrep-select">
                <option value="">-- Select endpoint --</option>
                ${ENDPOINT_NAMES.map(name => `<option value="${name}">${name}</option>`).join('')}
              </select>
            </div>

            <!-- Namespace -->
            <div class="dgrep-field">
              <label>Namespace</label>
              <div id="dgrepNamespaceContainer"></div>
              <div class="dgrep-loading-indicator hidden" id="dgrepNamespaceLoading">Loading namespaces...</div>
            </div>

            <!-- Events -->
            <div class="dgrep-field">
              <label>Events</label>
              <div class="dgrep-events-toolbar">
                <input type="text" id="dgrepEventsFilter" class="dgrep-input dgrep-input-sm" placeholder="Filter events...">
                <button class="btn btn-xs btn-secondary" id="dgrepSelectAllEvents">Select All</button>
                <label class="dgrep-checkbox-label">
                  <input type="checkbox" id="dgrepShowSecurityEvents">
                  <span>Show Asm*</span>
                </label>
              </div>
              <div class="dgrep-events-list" id="dgrepEventsList"></div>
              <div class="dgrep-loading-indicator hidden" id="dgrepEventsLoading">Loading events...</div>
            </div>

            <!-- Time Range -->
            <div class="dgrep-field">
              <label>Reference Time (UTC)</label>
              <input type="datetime-local" id="dgrepReferenceTime" class="dgrep-input" step="1">
              <div class="dgrep-quick-time">
                <button class="btn btn-xs btn-secondary" data-quick-time="now">Now</button>
                <button class="btn btn-xs btn-secondary" data-quick-time="1">±1m</button>
                <button class="btn btn-xs btn-secondary" data-quick-time="5">±5m</button>
                <button class="btn btn-xs btn-secondary" data-quick-time="15">±15m</button>
                <button class="btn btn-xs btn-secondary" data-quick-time="30">±30m</button>
              </div>
            </div>

            <div class="dgrep-field">
              <label>Offset</label>
              <div class="dgrep-offset-row">
                <label class="dgrep-radio-label"><input type="radio" name="dgrepOffsetSign" value="~" checked> ±</label>
                <label class="dgrep-radio-label"><input type="radio" name="dgrepOffsetSign" value="+"> +</label>
                <label class="dgrep-radio-label"><input type="radio" name="dgrepOffsetSign" value="-"> -</label>
                <input type="number" id="dgrepOffsetValue" class="dgrep-input dgrep-input-sm" value="30" min="1">
                <select id="dgrepOffsetUnit" class="dgrep-select dgrep-select-sm">
                  <option value="Minutes">Minutes</option>
                  <option value="Hours">Hours</option>
                  <option value="Days">Days</option>
                </select>
              </div>
            </div>

            <!-- Scoping Conditions -->
            <div class="dgrep-field">
              <label>Scoping Conditions</label>
              <div id="dgrepScopingConditions"></div>
              <button class="btn btn-xs btn-secondary" id="dgrepAddScoping">+ Add condition</button>
            </div>

            <!-- Server Query -->
            <div class="dgrep-field">
              <label>Server Query (KQL)</label>
              <div id="dgrepServerQueryEditor" class="kql-editor-container"></div>
            </div>

            <!-- Max Results -->
            <div class="dgrep-field">
              <label>Max Results</label>
              <select id="dgrepMaxResults" class="dgrep-select dgrep-select-sm">
                <option value="10000">10,000</option>
                <option value="100000">100,000</option>
                <option value="500000" selected>500,000</option>
                <option value="750000">750,000</option>
                <option value="1000000">1,000,000</option>
              </select>
            </div>
          </div>

          <!-- Search buttons -->
          <div class="dgrep-search-buttons">
            <button class="btn btn-primary" id="dgrepSearchBtn">
              ${getIcon(Search, 14)} Search
            </button>
            <button class="btn btn-secondary hidden" id="dgrepCancelBtn">
              ${getIcon(X, 14)} Cancel
            </button>
          </div>
        </div>

        <div class="dgrep-results-panel">
          <!-- Status bar -->
          <div class="dgrep-status-bar" id="dgrepStatusBar">
            <div class="dgrep-status-content">
              <span class="dgrep-status-text" id="dgrepStatusText">Ready</span>
              <span class="dgrep-result-count hidden" id="dgrepResultCount"></span>
            </div>
            <div class="dgrep-progress-bar hidden" id="dgrepProgressBar">
              <div class="dgrep-progress-fill" id="dgrepProgressFill"></div>
            </div>
          </div>

          <!-- Client query -->
          <div class="dgrep-client-query-bar">
            <div class="dgrep-client-query-section">
              <div id="dgrepClientQueryEditor" class="kql-editor-container kql-editor-client"></div>
              <button class="btn btn-sm btn-primary" id="dgrepRunClientQuery" disabled title="Run client query against existing server results">Run</button>
            </div>
            <input type="text" id="dgrepClientFilter" class="dgrep-input" placeholder="Quick text filter across all columns...">
          </div>

          <!-- Actions bar -->
          <div class="dgrep-actions-bar">
            <button class="btn btn-sm btn-secondary" id="dgrepDownloadCsv" disabled>
              ${getIcon(Download, 14)} CSV
            </button>
            <button class="btn btn-sm btn-secondary" id="dgrepOpenGeneva" disabled>Open in Geneva</button>
            <button class="btn btn-sm btn-secondary" id="dgrepCopyQueryId" disabled>Copy Query ID</button>
          </div>

          <!-- Results table -->
          <div class="dgrep-results-area" id="dgrepResultsArea"></div>
        </div>
      </div>
    `;

    // Initialize sub-components
    const nsContainer = this.container.querySelector('#dgrepNamespaceContainer')!;
    this.namespaceSelect = new DGrepSearchableSelect(nsContainer as HTMLElement, 'Select namespace...');
    this.namespaceSelect.setDisabled(true);
    this.namespaceSelect.onChange((value) => this.onNamespaceChange(value));

    const resultsArea = this.container.querySelector('#dgrepResultsArea')!;
    this.resultsTable = new DGrepResultsTable(resultsArea as HTMLElement);

    // Initialize KQL editors
    this.serverQueryEditor = new KqlEditor({
      parent: this.container.querySelector('#dgrepServerQueryEditor') as HTMLElement,
      placeholder: 'Optional server-side KQL filter...',
      minHeight: '42px',
      maxHeight: '120px',
    });
    this.clientQueryEditor = new KqlEditor({
      parent: this.container.querySelector('#dgrepClientQueryEditor') as HTMLElement,
      placeholder: 'Client-side KQL (re-query server results)...',
      minHeight: '36px',
      maxHeight: '90px',
    });

    // Set default time to now
    this.setTimeToNow();
  }

  private attachEventListeners(): void {
    // Collapse/expand panel
    this.container.querySelector('#dgrepCollapseBtn')?.addEventListener('click', () => {
      const panel = this.container.querySelector('#dgrepQueryPanel')!;
      panel.classList.toggle('collapsed');
      const btn = this.container.querySelector('#dgrepCollapseBtn')!;
      btn.innerHTML = panel.classList.contains('collapsed') ? '&raquo;' : '&laquo;';
    });

    // Log preset select
    this.container.querySelector('#dgrepLogId')?.addEventListener('change', async (e) => {
      const logId = (e.target as HTMLSelectElement).value as LogId;
      if (logId) {
        await this.populateFromLogId(logId);
      }
    });

    // Parse URL button
    this.container.querySelector('#dgrepParseUrlBtn')?.addEventListener('click', () => {
      const input = this.container.querySelector('#dgrepUrlInput') as HTMLInputElement;
      if (input.value.trim()) {
        this.populateFromUrl(input.value.trim());
      }
    });

    // Endpoint change
    this.container.querySelector('#dgrepEndpoint')?.addEventListener('change', async (e) => {
      const name = (e.target as HTMLSelectElement).value as DGrepEndpointName;
      if (name) {
        await this.onEndpointChange(name);
      }
    });

    // Events filter
    this.container.querySelector('#dgrepEventsFilter')?.addEventListener('input', (e) => {
      this.filterEvents((e.target as HTMLInputElement).value);
    });

    // Select all events
    this.container.querySelector('#dgrepSelectAllEvents')?.addEventListener('click', () => {
      const visibleEvents = this.getVisibleEvents();
      const allSelected = visibleEvents.every(e => this.selectedEvents.has(e));
      if (allSelected) {
        visibleEvents.forEach(e => this.selectedEvents.delete(e));
      } else {
        visibleEvents.forEach(e => this.selectedEvents.add(e));
      }
      this.renderEventsList();
    });

    // Show security events toggle
    this.container.querySelector('#dgrepShowSecurityEvents')?.addEventListener('change', (e) => {
      this.showSecurityEvents = (e.target as HTMLInputElement).checked;
      this.filterEvents((this.container.querySelector('#dgrepEventsFilter') as HTMLInputElement)?.value || '');
    });

    // Quick time buttons
    this.container.querySelectorAll('[data-quick-time]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = (btn as HTMLElement).dataset.quickTime!;
        if (val === 'now') {
          this.setTimeToNow();
        } else {
          this.setTimeToNow();
          const offsetInput = this.container.querySelector('#dgrepOffsetValue') as HTMLInputElement;
          if (offsetInput) offsetInput.value = val;
          // Set sign to ±
          const signRadio = this.container.querySelector('input[name="dgrepOffsetSign"][value="~"]') as HTMLInputElement;
          if (signRadio) signRadio.checked = true;
        }
      });
    });

    // Add scoping condition
    this.container.querySelector('#dgrepAddScoping')?.addEventListener('click', () => {
      this.scopingConditions.push({ column: '', operator: 'contains', value: '' });
      this.renderScopingConditions();
    });

    // Search button
    this.container.querySelector('#dgrepSearchBtn')?.addEventListener('click', () => {
      this.executeSearch();
    });

    // Cancel button
    this.container.querySelector('#dgrepCancelBtn')?.addEventListener('click', () => {
      if (this.activeSessionId) {
        this.onCancelCallback?.(this.activeSessionId);
        this.searching = false;
        this.updateSearchButtons();
        this.updateStatusBar('Cancelled', undefined, undefined, false);
      }
    });

    // Run client query button
    this.container.querySelector('#dgrepRunClientQuery')?.addEventListener('click', () => {
      this.executeClientQuery();
    });

    // Client filter
    this.container.querySelector('#dgrepClientFilter')?.addEventListener('input', (e) => {
      this.resultsTable.setClientFilter((e.target as HTMLInputElement).value);
    });

    // Download CSV
    this.container.querySelector('#dgrepDownloadCsv')?.addEventListener('click', () => {
      this.resultsTable.exportCsv();
    });

    // Open in Geneva
    this.container.querySelector('#dgrepOpenGeneva')?.addEventListener('click', () => {
      const url = buildDGrepUrl(this.buildFormState());
      this.onOpenInGenevaCallback?.(url);
    });

    // Copy Query ID
    this.container.querySelector('#dgrepCopyQueryId')?.addEventListener('click', () => {
      if (this.activeSessionId) {
        navigator.clipboard.writeText(this.activeSessionId);
      }
    });
  }

  // ==================== Cascading fetches ====================

  private async onEndpointChange(name: DGrepEndpointName): Promise<void> {
    const endpoint = DGREP_ENDPOINT_URLS[name];
    if (!endpoint) return;

    // Clear namespace and events
    this.namespaceSelect.setValue('');
    this.namespaceSelect.setItems([]);
    this.allEvents = [];
    this.selectedEvents.clear();
    this.renderEventsList();

    // Fetch namespaces
    this.namespacesLoading = true;
    this.namespaceSelect.setDisabled(true);
    this.container.querySelector('#dgrepNamespaceLoading')?.classList.remove('hidden');

    try {
      const namespaces = await this.onFetchNamespacesCallback?.(endpoint) ?? [];
      this.namespaceSelect.setItems(namespaces);
      this.namespaceSelect.setDisabled(false);
    } catch (err: any) {
      console.error('Failed to fetch namespaces:', err);
    } finally {
      this.namespacesLoading = false;
      this.container.querySelector('#dgrepNamespaceLoading')?.classList.add('hidden');
    }
  }

  private async onNamespaceChange(namespace: string): Promise<void> {
    if (!namespace) return;

    const endpointSelect = this.container.querySelector('#dgrepEndpoint') as HTMLSelectElement;
    const name = endpointSelect?.value as DGrepEndpointName;
    const endpoint = DGREP_ENDPOINT_URLS[name];
    if (!endpoint) return;

    // Clear events
    this.allEvents = [];
    this.selectedEvents.clear();
    this.renderEventsList();

    // Fetch events
    this.eventsLoading = true;
    this.container.querySelector('#dgrepEventsLoading')?.classList.remove('hidden');

    try {
      this.allEvents = await this.onFetchEventsCallback?.(endpoint, namespace) ?? [];
      this.filterEvents('');
    } catch (err: any) {
      console.error('Failed to fetch events:', err);
    } finally {
      this.eventsLoading = false;
      this.container.querySelector('#dgrepEventsLoading')?.classList.add('hidden');
    }
  }

  // ==================== Events list ====================

  private getVisibleEvents(): string[] {
    return this.filteredEvents;
  }

  private filterEvents(query: string): void {
    let events = this.allEvents;

    // Filter out Asm* security events unless toggled
    if (!this.showSecurityEvents) {
      events = events.filter(e => !e.startsWith('Asm'));
    }

    if (query.trim()) {
      const lower = query.toLowerCase();
      events = events.filter(e => e.toLowerCase().includes(lower));
    }

    this.filteredEvents = events;
    this.renderEventsList();
  }

  private renderEventsList(): void {
    const list = this.container.querySelector('#dgrepEventsList');
    if (!list) return;

    const visible = this.filteredEvents.slice(0, MAX_VISIBLE_EVENTS);
    const remaining = this.filteredEvents.length - visible.length;

    if (this.filteredEvents.length === 0 && this.allEvents.length === 0) {
      list.innerHTML = '<div class="dgrep-events-empty">Select endpoint and namespace first</div>';
      return;
    }

    if (this.filteredEvents.length === 0) {
      list.innerHTML = '<div class="dgrep-events-empty">No matching events</div>';
      return;
    }

    let html = '';
    for (const event of visible) {
      const checked = this.selectedEvents.has(event) ? 'checked' : '';
      html += `<label class="dgrep-event-item"><input type="checkbox" ${checked} data-event="${this.escapeAttr(event)}"><span>${this.escapeHtml(event)}</span></label>`;
    }
    if (remaining > 0) {
      html += `<div class="dgrep-events-more">${remaining} more\u2026 type to filter</div>`;
    }
    list.innerHTML = html;

    // Attach handlers
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const event = (cb as HTMLInputElement).dataset.event!;
        if ((cb as HTMLInputElement).checked) {
          this.selectedEvents.add(event);
        } else {
          this.selectedEvents.delete(event);
        }
      });
    });
  }

  // ==================== Scoping conditions ====================

  private renderScopingConditions(): void {
    const container = this.container.querySelector('#dgrepScopingConditions');
    if (!container) return;

    if (this.scopingConditions.length === 0) {
      container.innerHTML = '<div class="dgrep-scoping-empty">No conditions</div>';
      return;
    }

    container.innerHTML = this.scopingConditions.map((sc, i) => `
      <div class="dgrep-scoping-row" data-index="${i}">
        <input type="text" class="dgrep-input dgrep-input-sm dgrep-scoping-col" value="${this.escapeAttr(sc.column)}" placeholder="Column">
        <select class="dgrep-select dgrep-select-sm dgrep-scoping-op">
          ${SCOPING_OPERATORS.map(op => `<option value="${op}" ${op === sc.operator ? 'selected' : ''}>${op}</option>`).join('')}
        </select>
        <input type="text" class="dgrep-input dgrep-input-sm dgrep-scoping-val" value="${this.escapeAttr(sc.value)}" placeholder="Value">
        <button class="btn btn-xs btn-ghost dgrep-scoping-remove" title="Remove">&times;</button>
      </div>
    `).join('');

    // Attach handlers
    container.querySelectorAll('.dgrep-scoping-row').forEach(row => {
      const idx = parseInt((row as HTMLElement).dataset.index!, 10);
      const colInput = row.querySelector('.dgrep-scoping-col') as HTMLInputElement;
      const opSelect = row.querySelector('.dgrep-scoping-op') as HTMLSelectElement;
      const valInput = row.querySelector('.dgrep-scoping-val') as HTMLInputElement;
      const removeBtn = row.querySelector('.dgrep-scoping-remove')!;

      colInput.addEventListener('input', () => { this.scopingConditions[idx].column = colInput.value; });
      opSelect.addEventListener('change', () => { this.scopingConditions[idx].operator = opSelect.value as ScopingOperator; });
      valInput.addEventListener('input', () => { this.scopingConditions[idx].value = valInput.value; });
      removeBtn.addEventListener('click', () => {
        this.scopingConditions.splice(idx, 1);
        this.renderScopingConditions();
      });
    });
  }

  // ==================== Search execution ====================

  private async executeSearch(): Promise<void> {
    const opts = this.buildQueryOptions();
    if (!opts) return;

    this.searching = true;
    this.pendingSessionId = true;
    this.activeSessionId = null;
    this.bufferedEvents = [];
    this.updateSearchButtons();
    this.enableClientQuery(false);
    this.updateStatusBar('Starting search...', 0);

    try {
      const sessionId = await this.onSearchCallback?.(opts);
      this.pendingSessionId = false;
      if (sessionId) {
        this.activeSessionId = sessionId;
        this.enableActionButtons(true);
        // Replay any buffered events that arrived before we got the sessionId
        this.replayBufferedEvents(sessionId);
      }
    } catch (err: any) {
      this.pendingSessionId = false;
      this.searching = false;
      this.updateSearchButtons();
      this.updateStatusBar(`Error: ${err.message}`, undefined, undefined, true);
    }
  }

  private async executeClientQuery(): Promise<void> {
    if (!this.activeSessionId) {
      this.updateStatusBar('No active search — run a server search first', undefined, undefined, true);
      return;
    }

    const clientQuery = this.clientQueryEditor.getValue().trim();
    if (!clientQuery) {
      this.updateStatusBar('Enter a client KQL query', undefined, undefined, true);
      return;
    }

    this.searching = true;
    this.updateSearchButtons();
    this.updateStatusBar('Running client query...', 0);

    try {
      await this.onRunClientQueryCallback?.(this.activeSessionId, clientQuery);
      // Results will arrive via progress/intermediate/complete events
    } catch (err: any) {
      this.searching = false;
      this.updateSearchButtons();
      this.updateStatusBar(`Client query error: ${err.message}`, undefined, undefined, true);
    }
  }

  private replayBufferedEvents(sessionId: string): void {
    const events = this.bufferedEvents;
    this.bufferedEvents = [];
    for (const { type, event } of events) {
      const patched = { ...event, sessionId };
      switch (type) {
        case 'progress': this.setSearchProgress(patched); break;
        case 'complete': this.setSearchComplete(patched); break;
        case 'error': this.setSearchError(patched); break;
      }
    }
  }

  private buildQueryOptions(): QueryOptions | null {
    const endpointSelect = this.container.querySelector('#dgrepEndpoint') as HTMLSelectElement;
    const endpointName = endpointSelect?.value as DGrepEndpointName;
    const endpoint = DGREP_ENDPOINT_URLS[endpointName];
    if (!endpoint) {
      this.updateStatusBar('Please select an endpoint', undefined, undefined, true);
      return null;
    }

    const namespace = this.namespaceSelect.getValue();
    if (!namespace) {
      this.updateStatusBar('Please select a namespace', undefined, undefined, true);
      return null;
    }

    const eventNames = Array.from(this.selectedEvents);
    if (eventNames.length === 0) {
      this.updateStatusBar('Please select at least one event', undefined, undefined, true);
      return null;
    }

    const { startTime, endTime } = this.computeTimeRange();
    if (!startTime || !endTime) {
      this.updateStatusBar('Please set a reference time', undefined, undefined, true);
      return null;
    }

    const serverQuery = this.serverQueryEditor.getValue();
    const clientQuery = this.clientQueryEditor.getValue();
    const maxResults = parseInt((this.container.querySelector('#dgrepMaxResults') as HTMLSelectElement)?.value || '500000', 10);

    // Build identity columns from scoping conditions
    const identityColumns: Record<string, string[]> = {};
    for (const sc of this.scopingConditions) {
      if (sc.column && sc.value) {
        identityColumns[sc.column] = [sc.value];
      }
    }

    return {
      endpoint,
      namespaces: [namespace],
      eventNames,
      startTime,
      endTime,
      serverQuery: serverQuery || undefined,
      clientQuery: clientQuery || undefined,
      maxResults,
      identityColumns: Object.keys(identityColumns).length > 0 ? identityColumns : undefined,
    };
  }

  private buildFormState(): DGrepFormState {
    const endpointSelect = this.container.querySelector('#dgrepEndpoint') as HTMLSelectElement;
    const signRadio = this.container.querySelector('input[name="dgrepOffsetSign"]:checked') as HTMLInputElement;

    return {
      endpoint: (endpointSelect?.value || 'Diagnostics PROD') as DGrepEndpointName,
      namespace: this.namespaceSelect.getValue(),
      selectedEvents: Array.from(this.selectedEvents),
      referenceTime: (this.container.querySelector('#dgrepReferenceTime') as HTMLInputElement)?.value || '',
      offsetSign: (signRadio?.value || '~') as OffsetSign,
      offsetValue: parseInt((this.container.querySelector('#dgrepOffsetValue') as HTMLInputElement)?.value || '30', 10),
      offsetUnit: ((this.container.querySelector('#dgrepOffsetUnit') as HTMLSelectElement)?.value || 'Minutes') as OffsetUnit,
      scopingConditions: this.scopingConditions.filter(sc => sc.column && sc.value),
      serverQuery: this.serverQueryEditor.getValue(),
      clientQuery: this.clientQueryEditor.getValue(),
      maxResults: parseInt((this.container.querySelector('#dgrepMaxResults') as HTMLSelectElement)?.value || '500000', 10),
      showSecurityEvents: this.showSecurityEvents,
    };
  }

  private computeTimeRange(): { startTime: string; endTime: string } | { startTime: null; endTime: null } {
    const timeInput = this.container.querySelector('#dgrepReferenceTime') as HTMLInputElement;
    if (!timeInput?.value) return { startTime: null, endTime: null };

    const refTime = new Date(timeInput.value + 'Z'); // Treat as UTC
    const offsetValue = parseInt((this.container.querySelector('#dgrepOffsetValue') as HTMLInputElement)?.value || '30', 10);
    const offsetUnit = (this.container.querySelector('#dgrepOffsetUnit') as HTMLSelectElement)?.value || 'Minutes';
    const signRadio = this.container.querySelector('input[name="dgrepOffsetSign"]:checked') as HTMLInputElement;
    const sign = (signRadio?.value || '~') as OffsetSign;

    let offsetMs: number;
    switch (offsetUnit) {
      case 'Hours': offsetMs = offsetValue * 60 * 60 * 1000; break;
      case 'Days': offsetMs = offsetValue * 24 * 60 * 60 * 1000; break;
      default: offsetMs = offsetValue * 60 * 1000; break;
    }

    let startTime: Date;
    let endTime: Date;

    switch (sign) {
      case '~': // ± (both directions)
        startTime = new Date(refTime.getTime() - offsetMs);
        endTime = new Date(refTime.getTime() + offsetMs);
        break;
      case '+': // After reference
        startTime = refTime;
        endTime = new Date(refTime.getTime() + offsetMs);
        break;
      case '-': // Before reference
        startTime = new Date(refTime.getTime() - offsetMs);
        endTime = refTime;
        break;
      default:
        startTime = new Date(refTime.getTime() - offsetMs);
        endTime = new Date(refTime.getTime() + offsetMs);
    }

    return {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    };
  }

  // ==================== UI updates ====================

  private setTimeToNow(): void {
    const input = this.container.querySelector('#dgrepReferenceTime') as HTMLInputElement;
    if (input) {
      const now = new Date();
      input.value = now.toISOString().slice(0, 16);
    }
  }

  private updateStatusBar(text: string, progress?: number, resultCount?: number, isError = false): void {
    const statusText = this.container.querySelector('#dgrepStatusText');
    const resultCountEl = this.container.querySelector('#dgrepResultCount');
    const progressBar = this.container.querySelector('#dgrepProgressBar');
    const progressFill = this.container.querySelector('#dgrepProgressFill') as HTMLElement;
    const statusBar = this.container.querySelector('#dgrepStatusBar');

    if (statusText) {
      statusText.textContent = text;
      statusBar?.classList.toggle('dgrep-status-error', isError);
    }

    if (resultCountEl) {
      if (resultCount != null) {
        resultCountEl.textContent = `${resultCount.toLocaleString()} results`;
        resultCountEl.classList.remove('hidden');
      } else {
        resultCountEl.classList.add('hidden');
      }
    }

    if (progressBar && progressFill) {
      if (progress != null && progress < 100) {
        progressBar.classList.remove('hidden');
        progressFill.style.width = `${Math.min(100, progress)}%`;
      } else {
        progressBar.classList.add('hidden');
      }
    }
  }

  private updateSearchButtons(): void {
    const searchBtn = this.container.querySelector('#dgrepSearchBtn') as HTMLButtonElement;
    const cancelBtn = this.container.querySelector('#dgrepCancelBtn') as HTMLButtonElement;

    if (searchBtn) {
      searchBtn.disabled = this.searching;
      searchBtn.classList.toggle('hidden', this.searching);
    }
    if (cancelBtn) {
      cancelBtn.classList.toggle('hidden', !this.searching);
    }
  }

  private enableActionButtons(enabled: boolean): void {
    const csvBtn = this.container.querySelector('#dgrepDownloadCsv') as HTMLButtonElement;
    const genevaBtn = this.container.querySelector('#dgrepOpenGeneva') as HTMLButtonElement;
    const copyBtn = this.container.querySelector('#dgrepCopyQueryId') as HTMLButtonElement;

    if (csvBtn) csvBtn.disabled = !enabled;
    if (genevaBtn) genevaBtn.disabled = !enabled;
    if (copyBtn) copyBtn.disabled = !enabled;
  }

  private enableClientQuery(enabled: boolean): void {
    const clientQueryBtn = this.container.querySelector('#dgrepRunClientQuery') as HTMLButtonElement;
    if (clientQueryBtn) clientQueryBtn.disabled = !enabled;
  }

  private async loadResults(sessionId: string): Promise<void> {
    // Use paginated fetching to avoid RPC timeout on large result sets
    const pageSize = 5000;

    try {
      this.updateStatusBar('Loading results...', undefined);

      // Fetch first page to get totalCount and columns
      const firstPage = await this.onGetResultsPageCallback?.(sessionId, 0, pageSize);
      if (!firstPage) {
        // Fallback to full fetch (will use 5-minute timeout)
        const results = await this.onGetResultsCallback?.(sessionId);
        if (results) {
          this.resultsTable.setData(results.columns, results.rows);
          this.enableActionButtons(true);
          this.updateStatusBar(`Complete: ${results.rows.length.toLocaleString()} results`, 100, results.rows.length);
        }
        return;
      }

      const { columns, totalCount } = firstPage;
      let allRows = [...firstPage.rows];

      // Show first page immediately
      this.resultsTable.setData(columns, allRows);
      this.enableActionButtons(true);

      if (totalCount <= pageSize) {
        this.updateStatusBar(`Complete: ${totalCount.toLocaleString()} results`, 100, totalCount);
        return;
      }

      // Fetch remaining pages
      for (let offset = pageSize; offset < totalCount; offset += pageSize) {
        // Abort if a new search was started
        if (sessionId !== this.activeSessionId) return;

        this.updateStatusBar(
          `Loading results... (${allRows.length.toLocaleString()} of ${totalCount.toLocaleString()})`,
          (offset / totalCount) * 100,
          allRows.length,
        );

        const page = await this.onGetResultsPageCallback?.(sessionId, offset, pageSize);
        if (!page) break;

        allRows = allRows.concat(page.rows);
        this.resultsTable.setData(columns, allRows);
      }

      this.updateStatusBar(`Complete: ${allRows.length.toLocaleString()} results`, 100, allRows.length);
    } catch (err: any) {
      console.error('Failed to load results:', err);
      this.updateStatusBar(`Error loading results: ${err.message}`, undefined, undefined, true);
    }
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
