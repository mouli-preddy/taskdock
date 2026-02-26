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
import { DGrepTimeHistogram } from './dgrep-time-histogram.js';
import { DGrepSeverityMinimap } from './dgrep-severity-minimap.js';
import { parseDGrepUrl, buildDGrepUrl } from './dgrep-url-parser.js';
import { KqlEditor } from './kql-editor.js';
import { getIcon, Search, X, Download, RefreshCw, Zap } from '../utils/icons.js';
import { DGrepNLInput } from './dgrep-nl-input.js';
import { DGrepCommandPalette } from './dgrep-command-palette.js';
import { DGrepSavedQueries } from './dgrep-saved-queries.js';
import type { SavedQuery } from './dgrep-saved-queries.js';
import { DGrepFacetedSidebar } from './dgrep-faceted-sidebar.js';
import { DGrepAISummaryPanel } from './dgrep-ai-summary-panel.js';
import { DGrepRCAPanel } from './dgrep-ai-rca-panel.js';
import { DGrepChatPanel } from './dgrep-chat-panel.js';
import { DGrepAISuggestionsBar } from './dgrep-ai-suggestions-bar.js';
import type { DGrepAISummary, DGrepRootCauseAnalysis, DGrepChatEvent, ImproveDisplayResult } from '../../shared/dgrep-ai-types.js';

const ENDPOINT_NAMES = Object.keys(DGREP_ENDPOINT_URLS) as DGrepEndpointName[];
const LOG_IDS = Object.keys(LOG_CONFIGS) as LogId[];
const SCOPING_OPERATORS: ScopingOperator[] = ['contains', '!contains', '==', '!=', 'equals any of', 'contains any of'];
const MAX_VISIBLE_EVENTS = 200;

export class DGrepSearchView {
  private container: HTMLElement;
  private namespaceSelect!: DGrepSearchableSelect;
  private resultsTable!: DGrepResultsTable;
  private histogram!: DGrepTimeHistogram;
  private minimap!: DGrepSeverityMinimap;
  private facetedSidebar!: DGrepFacetedSidebar;
  private nlInput!: DGrepNLInput;
  private commandPalette!: DGrepCommandPalette;
  private savedQueries!: DGrepSavedQueries;
  private aiSummaryPanel!: DGrepAISummaryPanel;
  private rcaPanel!: DGrepRCAPanel;
  private chatPanel!: DGrepChatPanel;
  private suggestionsBar!: DGrepAISuggestionsBar;
  private serverQueryEditor!: KqlEditor;
  private clientQueryEditor!: KqlEditor;

  // Form state
  private allEvents: string[] = [];
  private filteredEvents: string[] = [];
  private selectedEvents: Set<string> = new Set();
  private showSecurityEvents = false;
  private scopingConditions: ScopingCondition[] = [];

  // Service linking
  private services: Array<{ id: string; name: string; repoPath: string }> = [];
  private namespaceServiceMap: Record<string, string> = {}; // namespace -> serviceId

  // Search state
  private activeSessionId: string | null = null;
  private pendingSessionId = false; // true while waiting for sessionId from RPC
  private searching = false;
  private namespacesLoading = false;
  private eventsLoading = false;
  private bufferedEvents: Array<{ type: string; event: any }> = [];

  // Column preset applied flag (reset per search, set after first data load)
  private columnPresetApplied = false;

  // Quick filter regex toggle state
  private quickFilterRegex = false;

  // Shadow mode state
  private shadowMode = false;
  private shadowId = '';
  private shadowPendingClientQuery = ''; // set when client query starts, consumed on complete
  private shadowExpandedLines: Set<number> = new Set(); // row indices expanded during current step
  private shadowLog: Array<{
    timestamp: string;
    type: 'server_search' | 'client_query';
    description: string;
    params: Record<string, any>;
    csvPath: string;
    resultCount: number;
    expandedLines: number[];
  }> = [];

  // Token state
  private tokenStatus: { hasToken: boolean; valid: boolean } = { hasToken: false, valid: false };
  private acquiringToken = false;

  // Callbacks
  private onCheckTokenStatusCallback: (() => Promise<{ hasToken: boolean; valid: boolean }>) | null = null;
  private onAcquireTokensCallback: (() => Promise<{ success: boolean; error?: string }>) | null = null;
  private onSearchCallback: ((params: QueryOptions) => Promise<string>) | null = null;
  private onSearchByLogIdCallback: ((logId: LogId, startTime: string, endTime: string, options: any) => Promise<string>) | null = null;
  private onCancelCallback: ((sessionId: string) => void) | null = null;
  private onOpenInGenevaCallback: ((url: string) => void) | null = null;
  private onFetchNamespacesCallback: ((endpoint: string) => Promise<string[]>) | null = null;
  private onFetchEventsCallback: ((endpoint: string, namespace: string) => Promise<string[]>) | null = null;
  private onGetResultsCallback: ((sessionId: string) => Promise<{ columns: string[]; rows: Record<string, any>[] } | undefined>) | null = null;
  private onGetResultsPageCallback: ((sessionId: string, offset: number, limit: number) => Promise<{ columns: string[]; rows: Record<string, any>[]; totalCount: number } | undefined>) | null = null;
  private onRunClientQueryCallback: ((sessionId: string, clientQuery: string) => Promise<void>) | null = null;
  private onNLToKQLCallback: ((prompt: string, columns: string[]) => Promise<{ kql: string; explanation: string }>) | null = null;
  private onSaveQueryCallback: ((name: string, formState: DGrepFormState) => Promise<void>) | null = null;
  private onLoadQueriesCallback: (() => Promise<SavedQuery[]>) | null = null;
  private onDeleteQueryCallback: ((name: string) => Promise<void>) | null = null;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.render();
    this.attachEventListeners();
    // Show "no token" bar immediately — checkTokenStatus() will update it
    this.renderTokenBar();
    this.loadServicesAndMapping();
  }

  private async loadServicesAndMapping(): Promise<void> {
    try {
      this.services = await (window as any).electronAPI?.getServices?.() ?? [];
      // Load persisted namespace→service mapping from localStorage
      try {
        this.namespaceServiceMap = JSON.parse(localStorage.getItem('dgrep:namespaceServiceMap') || '{}');
      } catch { this.namespaceServiceMap = {}; }
      this.populateServiceDropdown();
    } catch { /* ignore */ }
  }

  private populateServiceDropdown(): void {
    const select = this.container.querySelector('#dgrepLinkedService') as HTMLSelectElement;
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '<option value="">None</option>';
    for (const svc of this.services) {
      const opt = document.createElement('option');
      opt.value = svc.id;
      opt.textContent = svc.name;
      select.appendChild(opt);
    }
    select.value = currentVal || '';
  }

  private getLinkedService(): { repoPath: string; name: string; description?: string } | null {
    const select = this.container.querySelector('#dgrepLinkedService') as HTMLSelectElement;
    const serviceId = select?.value;
    if (!serviceId) return null;
    const svc = this.services.find(s => s.id === serviceId);
    if (!svc?.repoPath) return null;
    return { repoPath: svc.repoPath, name: svc.name, description: (svc as any).description };
  }

  private updateLinkedServiceFromNamespace(): void {
    const namespace = this.namespaceSelect?.getValue();
    if (!namespace) return;
    const select = this.container.querySelector('#dgrepLinkedService') as HTMLSelectElement;
    if (!select) return;
    const savedServiceId = this.namespaceServiceMap[namespace];
    select.value = savedServiceId || '';
  }

  private saveNamespaceServiceMapping(): void {
    const namespace = this.namespaceSelect?.getValue();
    const select = this.container.querySelector('#dgrepLinkedService') as HTMLSelectElement;
    if (!namespace || !select) return;
    if (select.value) {
      this.namespaceServiceMap[namespace] = select.value;
    } else {
      delete this.namespaceServiceMap[namespace];
    }
    localStorage.setItem('dgrep:namespaceServiceMap', JSON.stringify(this.namespaceServiceMap));
  }

  // ==================== Callback setters ====================

  onCheckTokenStatus(cb: () => Promise<{ hasToken: boolean; valid: boolean }>): void { this.onCheckTokenStatusCallback = cb; }
  onAcquireTokens(cb: () => Promise<{ success: boolean; error?: string }>): void { this.onAcquireTokensCallback = cb; }
  onSearch(cb: (params: QueryOptions) => Promise<string>): void { this.onSearchCallback = cb; }
  onSearchByLogId(cb: (logId: LogId, startTime: string, endTime: string, options: any) => Promise<string>): void { this.onSearchByLogIdCallback = cb; }
  onCancel(cb: (sessionId: string) => void): void { this.onCancelCallback = cb; }
  onOpenInGeneva(cb: (url: string) => void): void { this.onOpenInGenevaCallback = cb; }
  onFetchNamespaces(cb: (endpoint: string) => Promise<string[]>): void { this.onFetchNamespacesCallback = cb; }
  onFetchEvents(cb: (endpoint: string, namespace: string) => Promise<string[]>): void { this.onFetchEventsCallback = cb; }
  onGetResults(cb: (sessionId: string) => Promise<{ columns: string[]; rows: Record<string, any>[] } | undefined>): void { this.onGetResultsCallback = cb; }
  onGetResultsPage(cb: (sessionId: string, offset: number, limit: number) => Promise<{ columns: string[]; rows: Record<string, any>[]; totalCount: number } | undefined>): void { this.onGetResultsPageCallback = cb; }
  onRunClientQuery(cb: (sessionId: string, clientQuery: string) => Promise<void>): void { this.onRunClientQueryCallback = cb; }
  onNLToKQL(cb: (prompt: string, columns: string[]) => Promise<{ kql: string; explanation: string }>): void { this.onNLToKQLCallback = cb; }
  onSaveQuery(cb: (name: string, formState: DGrepFormState) => Promise<void>): void { this.onSaveQueryCallback = cb; }
  onLoadQueries(cb: () => Promise<SavedQuery[]>): void { this.onLoadQueriesCallback = cb; }
  onDeleteQuery(cb: (name: string) => Promise<void>): void { this.onDeleteQueryCallback = cb; }

  /** Check and display token status. Call when the DGrep tab becomes visible. */
  async checkTokenStatus(): Promise<void> {
    if (!this.onCheckTokenStatusCallback) return;
    try {
      // Use a timeout to prevent blocking the UI if backend is slow
      const result = await Promise.race([
        this.onCheckTokenStatusCallback(),
        new Promise<{ hasToken: boolean; valid: boolean }>((_, reject) =>
          setTimeout(() => reject(new Error('Token check timeout')), 5000)
        ),
      ]);
      this.tokenStatus = result;
    } catch {
      this.tokenStatus = { hasToken: false, valid: false };
    }
    this.renderTokenBar();
  }

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
    this.loadResults(event.sessionId).then(() => {
      // Shadow mode: log action after results are loaded so CSV snapshot has fresh data
      if (this.shadowMode) {
        if (this.shadowPendingClientQuery) {
          const kql = this.shadowPendingClientQuery;
          this.shadowPendingClientQuery = '';
          this.shadowLogAction('client_query', `Client query: ${kql}`, { kql }, event.resultCount);
        } else {
          const ctx = this.buildChatQueryContext();
          const desc = `Server search: ${ctx.namespace}/${ctx.events.join(',')} from ${ctx.startTime} to ${ctx.endTime}${ctx.serverQuery ? ` with KQL: ${ctx.serverQuery}` : ''}`;
          this.shadowLogAction('server_search', desc, ctx, event.resultCount);
        }
      }
    });
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
      if (!this.columnPresetApplied) {
        this.columnPresetApplied = true;
        this.applySavedColumnPreset();
      }
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
    if (!this.columnPresetApplied) {
      this.columnPresetApplied = true;
      this.applySavedColumnPreset();
    }
    // Histogram/minimap updated automatically via onDataChange
  }

  // AI event handlers (called from app.ts when bridge events arrive)
  handleAISummaryProgress(event: { sessionId: string; text: string }): void {
    this.aiSummaryPanel?.handleSummaryProgress?.(event.text);
  }
  handleAISummaryComplete(event: { sessionId: string; summary?: DGrepAISummary; error?: string }): void {
    if (event.error) {
      this.aiSummaryPanel?.handleSummaryError?.(event.error);
    } else if (event.summary) {
      this.aiSummaryPanel?.handleSummaryComplete?.(event.summary);
    }
    // Enable AI buttons
    const btn = this.container.querySelector('#dgrepAISummarizeBtn') as HTMLButtonElement;
    if (btn) btn.disabled = false;
    const chatBtn = this.container.querySelector('#dgrepAIChatBtn') as HTMLButtonElement;
    if (chatBtn) chatBtn.disabled = false;
  }
  handleAIRCAProgress(event: { sessionId: string; text: string }): void {
    this.rcaPanel?.handleRCAProgress?.(event.text);
  }
  handleAIRCAComplete(event: { sessionId: string; analysis?: DGrepRootCauseAnalysis; error?: string }): void {
    if (event.error) {
      this.rcaPanel?.handleRCAError?.(event.error);
    } else if (event.analysis) {
      this.rcaPanel?.handleRCAComplete?.(event.analysis);
    }
  }
  handleAIChatEvent(event: DGrepChatEvent): void {
    this.chatPanel?.handleChatEvent?.(event);
  }
  handleAIClientQueryUpdate(event: { chatSessionId: string; dgrepSessionId: string; kql: string }): void {
    if (event.dgrepSessionId === this.activeSessionId) {
      this.clientQueryEditor.setValue(event.kql);
    }
  }

  handleAIImproveDisplayProgress(event: { sessionId: string; text: string }): void {
    if (event.sessionId === this.activeSessionId) {
      this.resultsTable?.showImproveDisplayProgress(event.text);
    }
  }

  handleAIImproveDisplayComplete(event: { sessionId: string; result?: ImproveDisplayResult; error?: string }): void {
    if (event.sessionId !== this.activeSessionId) return;
    if (event.error) {
      this.resultsTable?.setImproveDisplayError(event.error);
    } else if (event.result) {
      this.resultsTable?.setImproveDisplayResult(event.result);
    }
  }

  // ==================== Shadow Mode ====================

  private setShadowStripVisible(visible: boolean): void {
    const strip = this.container.querySelector('#dgrepShadowStrip') as HTMLElement;
    const btn = this.container.querySelector('#dgrepShadowToggle') as HTMLButtonElement;
    if (strip) strip.style.display = visible ? '' : 'none';
    if (btn) btn.classList.toggle('active', visible);
  }

  private toggleShadowMode(): void {
    if (this.shadowMode) {
      this.shadowCancel();
      return;
    }
    this.shadowMode = true;
    this.shadowId = Date.now().toString(36);
    this.shadowLog = [];
    this.shadowPendingClientQuery = '';
    this.shadowExpandedLines.clear();
    this.setShadowStripVisible(true);
    this.updateShadowCount();
  }

  private updateShadowCount(): void {
    const el = this.container.querySelector('#dgrepShadowCount');
    if (el) el.textContent = String(this.shadowLog.length);
  }

  /** Log a shadow action and save a CSV snapshot of current results. */
  private async shadowLogAction(
    type: 'server_search' | 'client_query',
    description: string,
    params: Record<string, any>,
    resultCount: number,
  ): Promise<void> {
    if (!this.shadowMode) return;

    const columns = this.resultsTable.getColumns();
    const rows = this.resultsTable.getFilteredRows();
    const stepIndex = this.shadowLog.length;

    let csvPath = '';
    try {
      csvPath = await (window as any).electronAPI?.dgrepAIShadowSaveCsv?.(
        this.shadowId, stepIndex, columns, rows.slice(0, 50000)
      ) ?? '';
    } catch (err) {
      console.error('Shadow CSV save failed:', err);
    }

    // Attach expanded lines from the previous step (lines viewed before this action)
    const expandedLines = [...this.shadowExpandedLines].sort((a, b) => a - b);
    this.shadowExpandedLines.clear();

    this.shadowLog.push({
      timestamp: new Date().toISOString(),
      type,
      description,
      params,
      csvPath,
      resultCount,
      expandedLines,
    });
    this.updateShadowCount();
  }

  private async shadowLearn(): Promise<void> {
    if (this.shadowLog.length === 0) {
      this.shadowCancel();
      return;
    }

    this.shadowMode = false;
    this.setShadowStripVisible(false);

    this.chatPanel.resetSession();
    this.chatPanel.show();

    const linkedService = this.getLinkedService();
    const queryContext = this.buildChatQueryContext();
    const columns = this.resultsTable.getColumns();
    const rows = this.resultsTable.getFilteredRows();

    try {
      const chatSessionId = await (window as any).electronAPI?.dgrepAILearningCreate?.(
        this.activeSessionId,
        columns, rows.slice(0, 2000),
        this.shadowLog,
        linkedService?.repoPath, linkedService?.name, queryContext
      ) ?? '';

      if (chatSessionId) {
        this.chatPanel.setExternalSession(chatSessionId);
        this.shadowLog = [];
      } else {
        this.chatPanel.resetSession();
      }
    } catch (err) {
      console.error('Failed to create learning session:', err);
    }
  }

  private shadowCancel(): void {
    this.shadowMode = false;
    this.shadowLog = [];
    this.setShadowStripVisible(false);
  }

  async populateFromUrl(url: string): Promise<void> {
    const parsed = parseDGrepUrl(url);
    if (!parsed) {
      this.updateStatusBar('Could not parse DGrep URL', undefined, undefined, true);
      return;
    }

    this.updateStatusBar('Parsing URL...', undefined);

    try {
      // Set endpoint and cascade namespace fetch
      if (parsed.endpoint) {
        const endpointSelect = this.container.querySelector('#dgrepEndpoint') as HTMLSelectElement;
        if (endpointSelect) {
          endpointSelect.value = parsed.endpoint;
          await this.onEndpointChange(parsed.endpoint);
        }
      }

      // Set namespace and cascade events fetch
      // onNamespaceChange() clears selectedEvents, so we must set events AFTER it completes
      if (parsed.namespace) {
        this.namespaceSelect.setValue(parsed.namespace);
        try {
          await this.onNamespaceChange(parsed.namespace);
        } catch (err: any) {
          console.warn('Failed to fetch events for namespace:', parsed.namespace, err);
        }
      }

      // Set events AFTER namespace change has fetched the events list
      // Even if the fetch failed, force-add the URL's event names so they're selectable
      if (parsed.eventNames.length > 0) {
        this.selectedEvents = new Set(parsed.eventNames);
        // Ensure the URL event names are in allEvents even if the fetch didn't return them
        for (const ev of parsed.eventNames) {
          if (!this.allEvents.includes(ev)) {
            this.allEvents.push(ev);
          }
        }
        this.filterEvents('');  // Re-filter to update filteredEvents and render with checks
      }

      // Set time
      if (parsed.referenceTime) {
        const timeInput = this.container.querySelector('#dgrepReferenceTime') as HTMLInputElement;
        if (timeInput) {
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

      this.updateStatusBar('URL parsed. Ready to search.', undefined);
    } catch (err: any) {
      console.error('Failed to populate from URL:', err);
      this.updateStatusBar(`URL parse error: ${err.message}`, undefined, undefined, true);
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
      <div class="dgrep-token-bar" id="dgrepTokenBar"></div>
      <div class="dgrep-container">
        <div class="dgrep-query-panel" id="dgrepQueryPanel">
          <div class="dgrep-panel-header">
            <h3>Query</h3>
            <button class="btn btn-sm btn-ghost dgrep-collapse-btn" id="dgrepCollapseBtn" title="Collapse panel">&laquo;</button>
          </div>

          <!-- Quick actions bar -->
          <div class="dgrep-quick-bar">
            <div class="dgrep-field" style="display:flex;align-items:end;gap:4px">
              <div style="flex:1">
                <label>Log Preset</label>
                <select id="dgrepLogId" class="dgrep-select">
                  <option value="">-- Select preset --</option>
                  ${LOG_IDS.map(id => `<option value="${id}">${id} (${LOG_CONFIGS[id].namespace}/${LOG_CONFIGS[id].events})</option>`).join('')}
                </select>
              </div>
              <div id="dgrepSavedQueriesContainer"></div>
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

            <!-- Linked Service -->
            <div class="dgrep-field">
              <label>Linked Service</label>
              <select id="dgrepLinkedService" class="dgrep-select dgrep-select-sm">
                <option value="">None</option>
              </select>
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

            <!-- NL-to-KQL input -->
            <div class="dgrep-field">
              <label>AI Query</label>
              <div id="dgrepNLInputContainer"></div>
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

          <!-- Time histogram -->
          <div id="dgrepHistogramContainer"></div>

          <!-- Client query -->
          <div class="dgrep-client-query-bar">
            <div class="dgrep-client-query-section">
              <div id="dgrepClientQueryEditor" class="kql-editor-container kql-editor-client"></div>
              <button class="btn btn-sm btn-primary" id="dgrepRunClientQuery" disabled title="Run client query against existing server results">Run</button>
            </div>
            <div class="dgrep-filter-row">
              <input type="text" id="dgrepClientFilter" class="dgrep-input" placeholder="Quick filter (Enter = filter, Shift+Enter = highlight)...">
              <button class="dgrep-regex-btn" id="dgrepRegexToggle" title="Toggle regex mode">.*</button>
            </div>
          </div>

          <!-- Actions bar -->
          <div class="dgrep-actions-bar">
            <button class="btn btn-sm btn-secondary" id="dgrepDownloadCsv" disabled>
              ${getIcon(Download, 14)} CSV
            </button>
            <button class="btn btn-sm btn-secondary" id="dgrepOpenGeneva" disabled>Open in Geneva</button>
            <button class="btn btn-sm btn-secondary dgrep-facets-btn" id="dgrepFacetsToggle">Facets</button>
            <span style="flex:1"></span>
            <button class="btn btn-sm btn-secondary" id="dgrepAISummarizeBtn" disabled>Summarize</button>
            <button class="btn btn-sm btn-secondary" id="dgrepAIChatBtn" disabled>AI Chat</button>
            <button class="btn btn-sm btn-secondary" id="dgrepShadowToggle" disabled>Shadow</button>
          </div>

          <!-- Shadow mode indicator -->
          <div class="dgrep-shadow-strip" id="dgrepShadowStrip" style="display:none">
            <span class="dgrep-shadow-indicator"></span>
            <span>Shadow mode — recording actions (<span id="dgrepShadowCount">0</span> steps)</span>
            <span style="flex:1"></span>
            <button class="btn btn-xs btn-primary" id="dgrepShadowLearn">Learn</button>
            <button class="btn btn-xs btn-ghost" id="dgrepShadowCancel">Cancel</button>
          </div>

          <!-- AI Summary Panel -->
          <div id="dgrepAISummarySlot"></div>
          <!-- AI Suggestions Bar -->
          <div id="dgrepAISuggestionsSlot"></div>

          <!-- Results + Chat + Faceted Sidebar -->
          <div style="display:flex;flex:1;overflow:hidden;min-height:0">
            <div class="dgrep-results-area" id="dgrepResultsArea" style="flex:1;overflow:hidden;min-height:0"></div>
            <div id="dgrepChatPanelSlot"></div>
            <div id="dgrepFacetedSidebarSlot" style="display:flex;overflow:hidden;min-height:0"></div>
          </div>
          <!-- RCA Panel (slides up from bottom) -->
          <div id="dgrepRCAPanelSlot"></div>
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

    // Initialize faceted sidebar
    const facetSlot = this.container.querySelector('#dgrepFacetedSidebarSlot') as HTMLElement;
    this.facetedSidebar = new DGrepFacetedSidebar(facetSlot);
    this.facetedSidebar.onFilterAdd = (column, value) => {
      // Add as a quick value filter on the results table
      const filters = this.resultsTable.getColumnFilters();
      filters.set(column, new Set([value]));
      this.resultsTable.setColumnFilters(filters);
    };
    this.facetedSidebar.onFilterExclude = (column, value) => {
      // Exclude: set column filter to all values except this one
      const allRows = this.resultsTable.getFilteredRows();
      const allVals = new Set<string>();
      for (const row of allRows) {
        allVals.add(String(row[column] ?? ''));
      }
      allVals.delete(value);
      const filters = this.resultsTable.getColumnFilters();
      filters.set(column, allVals);
      this.resultsTable.setColumnFilters(filters);
    };

    // Wire column visibility persistence
    this.resultsTable.onColumnVisibilityChange = (visibleColumns) => {
      const key = this.getColumnPresetKey();
      if (key) {
        localStorage.setItem(key, JSON.stringify(visibleColumns));
      }
    };

    // Wire data flow to faceted sidebar
    this.resultsTable.onDataChange((columns, _allRows, filteredRows) => {
      this.facetedSidebar.setData(columns, filteredRows);
      this.updateHistogram(columns, filteredRows);
    });

    // Track row expansions for shadow mode
    this.resultsTable.onRowExpand((rowIndex) => {
      if (this.shadowMode) this.shadowExpandedLines.add(rowIndex);
    });

    this.resultsTable.onImproveDisplayRequest(() => {
      if (!this.activeSessionId) return;
      const columns = this.resultsTable.getColumns();
      const rows = this.resultsTable.getAllRows();
      const metadata = this.buildAnalysisMetadata(rows.length);
      window.electronAPI.dgrepAIImproveDisplay(this.activeSessionId, columns, rows, metadata);
    });

    // Initialize AI panels
    const summarySlot = this.container.querySelector('#dgrepAISummarySlot') as HTMLElement;
    this.aiSummaryPanel = new DGrepAISummaryPanel(summarySlot);
    this.aiSummaryPanel.onSummarize = async (columns, rows, patterns) => {
      if (this.activeSessionId) {
        const metadata = this.buildAnalysisMetadata(rows.length);
        const { level, customPrompt } = this.aiSummaryPanel.getAnalysisLevel();
        const linkedService = this.getLinkedService();
        await (window as any).electronAPI?.dgrepAISummarizeLogs?.(
          this.activeSessionId, columns, rows.slice(0, 2000), patterns || [],
          {
            ...metadata,
            analysisLevel: level,
            customPrompt,
            sourceRepoPath: linkedService?.repoPath,
            serviceName: linkedService?.name,
            serviceDescription: linkedService?.description,
          }
        );
      }
    };

    const rcaSlot = this.container.querySelector('#dgrepRCAPanelSlot') as HTMLElement;
    this.rcaPanel = new DGrepRCAPanel(rcaSlot);
    this.rcaPanel.onNavigateToRow = (rowIndex: number) => {
      // Select the row in the results table by setting selection
      (this.resultsTable as any).selectedRowIndex = rowIndex;
      (this.resultsTable as any).render?.();
    };

    const chatSlot = this.container.querySelector('#dgrepChatPanelSlot') as HTMLElement;
    this.chatPanel = new DGrepChatPanel(chatSlot);
    this.chatPanel.onCreateSession = async (columns, rows) => {
      const linkedService = this.getLinkedService();
      const queryContext = this.buildChatQueryContext();
      return await (window as any).electronAPI?.dgrepAIChatCreate?.(
        this.activeSessionId, columns, rows.slice(0, 2000),
        linkedService?.repoPath, linkedService?.name, queryContext
      ) ?? '';
    };
    this.chatPanel.onSendMessage = async (chatSessionId, message) => {
      await (window as any).electronAPI?.dgrepAIChatSend?.(chatSessionId, message);
    };
    this.chatPanel.onDestroySession = async (chatSessionId) => {
      await (window as any).electronAPI?.dgrepAIChatDestroy?.(chatSessionId);
    };

    const suggestionsSlot = this.container.querySelector('#dgrepAISuggestionsSlot') as HTMLElement;
    this.suggestionsBar = new DGrepAISuggestionsBar(suggestionsSlot);
    this.suggestionsBar.onSuggestionClick = (suggestion: string) => {
      this.chatPanel.show();
      // Pre-fill the chat input with the suggestion text
      (this.chatPanel as any).prefillMessage?.(suggestion);
    };

    // Wire AI buttons in actions bar
    const triggerSummarize = () => {
      const rows = this.resultsTable.getFilteredRows();
      const cols = this.resultsTable.getColumns();
      const patterns = this.resultsTable.getPatterns();
      this.aiSummaryPanel.summarize(cols, rows, patterns as any);
    };
    this.container.querySelector('#dgrepAISummarizeBtn')?.addEventListener('click', () => {
      // Just show the panel — user clicks internal Summarize button after choosing level
      if (!(this.aiSummaryPanel as any).visible) {
        this.aiSummaryPanel.show();
      } else {
        this.aiSummaryPanel.toggle();
      }
    });
    // Listen for summarize from the panel's internal Summarize button
    this.container.addEventListener('request-summarize', () => {
      triggerSummarize();
    });
    this.container.querySelector('#dgrepAIChatBtn')?.addEventListener('click', () => {
      this.chatPanel.toggle();
      if (this.chatPanel.isVisible()) {
        const rows = this.resultsTable.getFilteredRows();
        const cols = this.resultsTable.getColumns();
        this.chatPanel.initSession(cols, rows);
      }
    });

    // Shadow mode buttons
    this.container.querySelector('#dgrepShadowToggle')?.addEventListener('click', () => {
      this.toggleShadowMode();
    });
    this.container.querySelector('#dgrepShadowLearn')?.addEventListener('click', () => {
      this.shadowLearn();
    });
    this.container.querySelector('#dgrepShadowCancel')?.addEventListener('click', () => {
      this.shadowCancel();
    });

    // Initialize time histogram
    const histogramContainer = this.container.querySelector('#dgrepHistogramContainer')!;
    this.histogram = new DGrepTimeHistogram(histogramContainer as HTMLElement);
    this.histogram.onTimeRangeSelect((start, end) => {
      this.resultsTable.setTimeRangeFilter(start, end);
    });
    this.histogram.onBucketClick((time) => {
      this.resultsTable.scrollToTime(time);
    });

    // Initialize NL input
    const nlContainer = this.container.querySelector('#dgrepNLInputContainer') as HTMLElement;
    this.nlInput = new DGrepNLInput(nlContainer, {
      onGenerateKQL: async (prompt, columns) => {
        if (!this.onNLToKQLCallback) {
          this.nlInput.setError('NL-to-KQL not available');
          return;
        }
        try {
          const result = await this.onNLToKQLCallback(prompt, columns);
          this.nlInput.setResult(result.kql, result.explanation);
          this.serverQueryEditor.setValue(result.kql);
        } catch (err: any) {
          this.nlInput.setError(err.message || 'Failed to generate KQL');
        }
      },
      onKQLGenerated: (_kql, _explanation) => {
        // Already set in onGenerateKQL above
      },
    });

    // Initialize saved queries
    const savedQueriesContainer = this.container.querySelector('#dgrepSavedQueriesContainer') as HTMLElement;
    this.savedQueries = new DGrepSavedQueries(savedQueriesContainer, {
      onSaveQuery: async (name, _formState) => {
        const formState = this.getFormState();
        if (this.onSaveQueryCallback) {
          await this.onSaveQueryCallback(name, formState);
          await this.refreshSavedQueries();
        }
      },
      onLoadQuery: (formState) => {
        this.loadFormState(formState);
      },
      onDeleteQuery: async (name) => {
        if (this.onDeleteQueryCallback) {
          await this.onDeleteQueryCallback(name);
          await this.refreshSavedQueries();
        }
      },
    });

    // Initialize command palette (singleton)
    this.commandPalette = DGrepCommandPalette.getInstance();

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

  private renderTokenBar(): void {
    const bar = this.container.querySelector('#dgrepTokenBar') as HTMLElement;
    if (!bar) return;

    if (this.acquiringToken) {
      bar.style.display = '';
      bar.innerHTML = `
        <div class="dgrep-token-status acquiring">
          <div class="loading-spinner small"></div>
          <span>Acquiring Geneva tokens...</span>
        </div>`;
      return;
    }

    if (this.tokenStatus.hasToken && this.tokenStatus.valid) {
      bar.style.display = 'none';
      return;
    }

    const message = this.tokenStatus.hasToken
      ? 'Geneva tokens expired. Please login again.'
      : 'No Geneva tokens found. Login required to use DGrep.';

    bar.style.display = '';
    bar.innerHTML = `
      <div class="dgrep-token-status no-token">
        <span>${message}</span>
        <button class="btn btn-primary btn-small" id="dgrepLoginBtn">${getIcon(Zap, 14)} Login</button>
      </div>`;

    bar.querySelector('#dgrepLoginBtn')?.addEventListener('click', () => this.handleAcquireTokens());
  }

  private async handleAcquireTokens(): Promise<void> {
    if (!this.onAcquireTokensCallback || this.acquiringToken) return;
    this.acquiringToken = true;
    this.renderTokenBar();

    try {
      const result = await this.onAcquireTokensCallback();
      if (result.success) {
        this.tokenStatus = { hasToken: true, valid: true };
      } else {
        // Show error briefly then re-render
        const bar = this.container.querySelector('#dgrepTokenBar') as HTMLElement;
        if (bar) {
          bar.innerHTML = `
            <div class="dgrep-token-status error">
              <span>Login failed: ${result.error || 'Unknown error'}</span>
              <button class="btn btn-primary btn-small" id="dgrepRetryLoginBtn">${getIcon(Zap, 14)} Retry</button>
            </div>`;
          bar.querySelector('#dgrepRetryLoginBtn')?.addEventListener('click', () => this.handleAcquireTokens());
        }
      }
    } catch (err: any) {
      this.tokenStatus = { hasToken: false, valid: false };
    } finally {
      this.acquiringToken = false;
      this.renderTokenBar();
    }
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

    // Linked service change → persist mapping
    this.container.querySelector('#dgrepLinkedService')?.addEventListener('change', () => {
      this.saveNamespaceServiceMapping();
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

    // Client filter - live text filter on input (passes regex flag)
    const clientFilterInput = this.container.querySelector('#dgrepClientFilter') as HTMLInputElement;
    clientFilterInput?.addEventListener('input', () => {
      this.resultsTable.setClientFilter(clientFilterInput.value, this.quickFilterRegex);
    });

    // Client filter - Enter = create filter condition, Shift+Enter = create highlight condition
    clientFilterInput?.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const value = clientFilterInput.value.trim();
      if (!value) return;
      e.preventDefault();
      const mode = e.shiftKey ? 'highlight' : 'filter';
      const color = mode === 'highlight' ? this.resultsTable.nextHighlightColor() : '';
      this.resultsTable.addCondition({
        id: this.resultsTable.generateConditionId(),
        column: '__text__',
        value,
        isRegex: this.quickFilterRegex,
        mode,
        color,
      });
      clientFilterInput.value = '';
      this.resultsTable.setClientFilter('');
    });

    // Regex toggle button
    this.container.querySelector('#dgrepRegexToggle')?.addEventListener('click', () => {
      this.quickFilterRegex = !this.quickFilterRegex;
      const btn = this.container.querySelector('#dgrepRegexToggle');
      btn?.classList.toggle('active', this.quickFilterRegex);
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

    // Facets toggle
    this.container.querySelector('#dgrepFacetsToggle')?.addEventListener('click', () => {
      this.facetedSidebar.toggle();
      const btn = this.container.querySelector('#dgrepFacetsToggle');
      btn?.classList.toggle('active', this.facetedSidebar.isVisible());
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

    // Auto-select linked service for this namespace
    this.updateLinkedServiceFromNamespace();

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

    // Clear previous results before starting a new search
    this.resultsTable.clearData();
    this.histogram.setData([], '', '');

    this.searching = true;
    this.pendingSessionId = true;
    this.activeSessionId = null;
    this.bufferedEvents = [];
    this.columnPresetApplied = false;
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
        // Auto-collapse the query panel to give more space to results
        this.collapseQueryPanel();
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

    if (this.shadowMode) this.shadowPendingClientQuery = clientQuery;

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

  private buildAnalysisMetadata(totalRows: number): any {
    const endpointSelect = this.container.querySelector('#dgrepEndpoint') as HTMLSelectElement;
    const endpointName = endpointSelect?.value as DGrepEndpointName;
    const endpoint = DGREP_ENDPOINT_URLS[endpointName] || '';
    const namespace = this.namespaceSelect?.getValue() || '';
    const events = Array.from(this.selectedEvents);
    const timeRange = this.computeTimeRange();
    return {
      endpoint,
      namespace,
      events,
      startTime: timeRange.startTime || '',
      endTime: timeRange.endTime || '',
      totalRows,
    };
  }

  private buildChatQueryContext(): { endpoint: string; namespace: string; events: string[]; startTime: string; endTime: string; serverQuery: string; clientQuery: string } {
    const endpointSelect = this.container.querySelector('#dgrepEndpoint') as HTMLSelectElement;
    const endpointName = endpointSelect?.value || '';
    const namespace = this.namespaceSelect?.getValue() || '';
    const events = Array.from(this.selectedEvents);
    const timeRange = this.computeTimeRange();
    return {
      endpoint: endpointName,
      namespace,
      events,
      startTime: timeRange.startTime || '',
      endTime: timeRange.endTime || '',
      serverQuery: this.serverQueryEditor.getValue() || '',
      clientQuery: this.clientQueryEditor.getValue() || '',
    };
  }

  getFormState(): DGrepFormState { return this.buildFormState(); }

  async loadFormState(s: DGrepFormState): Promise<void> {
    const ep = this.container.querySelector('#dgrepEndpoint') as HTMLSelectElement;
    if (ep && s.endpoint) { ep.value = s.endpoint; await this.onEndpointChange(s.endpoint); }
    if (s.namespace) { this.namespaceSelect.setValue(s.namespace); await this.onNamespaceChange(s.namespace); }
    if (s.selectedEvents?.length) { this.selectedEvents = new Set(s.selectedEvents); this.renderEventsList(); }
    if (s.referenceTime) { const t = this.container.querySelector('#dgrepReferenceTime') as HTMLInputElement; if (t) t.value = s.referenceTime; }
    if (s.offsetSign) { const r = this.container.querySelector(`input[name="dgrepOffsetSign"][value="${s.offsetSign}"]`) as HTMLInputElement; if (r) r.checked = true; }
    if (s.offsetValue != null) { const o = this.container.querySelector('#dgrepOffsetValue') as HTMLInputElement; if (o) o.value = String(s.offsetValue); }
    if (s.offsetUnit) { const u = this.container.querySelector('#dgrepOffsetUnit') as HTMLSelectElement; if (u) u.value = s.offsetUnit; }
    if (s.scopingConditions) { this.scopingConditions = [...s.scopingConditions]; this.renderScopingConditions(); }
    if (s.serverQuery != null) this.serverQueryEditor.setValue(s.serverQuery);
    if (s.clientQuery != null) this.clientQueryEditor.setValue(s.clientQuery);
    if (s.maxResults) { const m = this.container.querySelector('#dgrepMaxResults') as HTMLSelectElement; if (m) m.value = String(s.maxResults); }
    if (s.showSecurityEvents != null) { this.showSecurityEvents = s.showSecurityEvents; const c = this.container.querySelector('#dgrepShowSecurityEvents') as HTMLInputElement; if (c) c.checked = s.showSecurityEvents; }
  }

  async refreshSavedQueries(): Promise<void> {
    if (!this.onLoadQueriesCallback) return;
    try {
      const qs = await this.onLoadQueriesCallback();
      this.savedQueries.setQueries(qs);
      this.commandPalette.addSavedQueryCommands(qs, (n) => { const q = qs.find(x => x.name === n); if (q) this.loadFormState(q.formState); });
    } catch (e: any) { console.error('Failed to load saved queries:', e); }
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

    if (csvBtn) csvBtn.disabled = !enabled;
    if (genevaBtn) genevaBtn.disabled = !enabled;
    // Enable AI buttons when results are available
    const aiSumBtn = this.container.querySelector('#dgrepAISummarizeBtn') as HTMLButtonElement;
    const aiChatBtn = this.container.querySelector('#dgrepAIChatBtn') as HTMLButtonElement;
    if (aiSumBtn) aiSumBtn.disabled = !enabled;
    if (aiChatBtn) aiChatBtn.disabled = !enabled;
    const shadowBtn = this.container.querySelector('#dgrepShadowToggle') as HTMLButtonElement;
    if (shadowBtn) shadowBtn.disabled = !enabled;
  }

  private collapseQueryPanel(): void {
    const panel = this.container.querySelector('#dgrepQueryPanel');
    if (panel && !panel.classList.contains('collapsed')) {
      panel.classList.add('collapsed');
      const btn = this.container.querySelector('#dgrepCollapseBtn');
      if (btn) btn.innerHTML = '&raquo;';
    }
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
          if (!this.columnPresetApplied) {
            this.columnPresetApplied = true;
            this.applySavedColumnPreset();
          }
          this.enableActionButtons(true);
          this.updateStatusBar(`Complete: ${results.rows.length.toLocaleString()} results`, 100, results.rows.length);
        }
        return;
      }

      const { columns, totalCount } = firstPage;
      let allRows = [...firstPage.rows];

      // Show first page immediately
      this.resultsTable.setData(columns, allRows);
      if (!this.columnPresetApplied) {
        this.columnPresetApplied = true;
        this.applySavedColumnPreset();
      }
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

  private updateHistogram(columns: string[], rows: Record<string, any>[]): void {
    // Priority: PreciseTimeStamp (sub-second) > TIMESTAMP (minute-resolution) > any *timestamp* column
    const timeCol = columns.find(c => c === 'PreciseTimeStamp')
      || columns.find(c => c === 'TIMESTAMP')
      || columns.find(c => c.toLowerCase().includes('timestamp'))
      || '';
    // Prefer text-based severity columns (severityText=Information/Error/Warning) over numeric Level
    const sevCol = columns.find(c => c === 'severityText')
      || columns.find(c => c === 'Severity')
      || columns.find(c => c === 'level' || c === 'Level')
      || '';
    if (timeCol) {
      this.histogram.setData(rows, timeCol, sevCol);
    }
    // Update minimap
    if (sevCol) {
      this.ensureMinimap();
      this.minimap?.setData(rows, sevCol);
    }
  }

  private ensureMinimap(): void {
    if (this.minimap) return;
    const slot = this.resultsTable.getMinimapSlot();
    if (!slot) return;
    // Clear the slot placeholder and mount the minimap
    slot.innerHTML = '';
    this.minimap = new DGrepSeverityMinimap(slot);
    this.minimap.onScrollTo((rowIndex) => {
      const scrollEl = this.resultsTable.getScrollContainer();
      if (scrollEl) {
        const rowHeight = 24;
        // Center the target row in the viewport
        const viewportHeight = scrollEl.clientHeight;
        scrollEl.scrollTop = Math.max(0, rowIndex * rowHeight - viewportHeight / 2);
      }
    });

    // Wire scroll events to update minimap viewport
    const scrollEl = this.resultsTable.getScrollContainer();
    if (scrollEl) {
      scrollEl.addEventListener('scroll', () => {
        this.updateMinimapViewport(scrollEl);
      });
    }
  }

  private updateMinimapViewport(scrollEl: HTMLElement): void {
    if (!this.minimap) return;
    const totalRows = this.resultsTable.getRowCount();
    if (totalRows === 0) return;
    const rowHeight = 24;
    const visibleRows = Math.floor(scrollEl.clientHeight / rowHeight);
    const scrolledRows = Math.floor(scrollEl.scrollTop / rowHeight);
    this.minimap.setViewportRange(scrolledRows, Math.min(totalRows, scrolledRows + visibleRows));
  }

  /** Apply saved column preset if one exists for the current namespace+events */
  private applySavedColumnPreset(): void {
    const key = this.getColumnPresetKey();
    if (!key) return;
    const saved = localStorage.getItem(key);
    if (!saved) return;
    try {
      const names: string[] = JSON.parse(saved);
      if (Array.isArray(names) && names.length > 0) {
        this.resultsTable.setVisibleColumnNames(names);
      }
    } catch {
      // Ignore corrupt data
    }
  }

  private getColumnPresetKey(): string {
    const ns = this.namespaceSelect.getValue();
    const events = Array.from(this.selectedEvents).sort().join(',');
    if (!ns || !events) return '';
    return `dgrep-columns:${ns}:${events}`;
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
