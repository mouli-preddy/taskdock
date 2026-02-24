/**
 * DGrep Service
 * High-level service wrapping DGrepClient with session management,
 * event broadcasting, caching, and cancellation support.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { DGrepClient } from './dgrep-client.js';
import { loadCachedGenevaTokens, acquireGenevaTokens } from '../geneva-token-service.js';
import { getLogger } from '../services/logger-service.js';
import type {
  DGrepSearchSession,
  DGrepProgressEvent,
  DGrepCompleteEvent,
  DGrepErrorEvent,
  QueryByLogIdOptions,
  QueryOptions,
  LogId,
  SearchStatusResponse,
} from '../../shared/dgrep-types.js';
import { DGREP_FRONTEND_URLS, DGREP_ENDPOINT_URLS } from '../../shared/dgrep-types.js';

const LOG_CATEGORY = 'DGrepService';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class DGrepService extends EventEmitter {
  private client: DGrepClient;
  private sessions: Map<string, DGrepSearchSession> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private namespaceCache: Map<string, CacheEntry<string[]>> = new Map();
  private eventsCache: Map<string, CacheEntry<string[]>> = new Map();
  private initialized = false;

  constructor() {
    super();
    this.client = new DGrepClient();
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.client.initialize();
      this.initialized = true;
    }
  }

  // ==================== Token Management ====================

  async getTokenStatus(): Promise<{ hasToken: boolean; valid: boolean }> {
    const cached = loadCachedGenevaTokens();
    if (!cached) return { hasToken: false, valid: false };

    // Validate by making a lightweight API call
    try {
      const response = await fetch(
        'https://portal.microsoftgeneva.com/user-api/v1/hint/monitoringAccountConfig',
        {
          headers: {
            'Cookie': cached.cookie,
            'Csrftoken': cached.csrf,
            'X-Requested-With': 'XMLHttpRequest',
          },
        }
      );
      const valid = response.ok;
      return { hasToken: true, valid };
    } catch {
      return { hasToken: true, valid: false };
    }
  }

  async acquireTokens(): Promise<{ success: boolean; error?: string }> {
    try {
      await acquireGenevaTokens();
      this.initialized = false; // Force re-init with new tokens
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  }

  // ==================== Search ====================

  async startSearchByLogId(
    logId: LogId,
    startTime: string,
    endTime: string,
    options: QueryByLogIdOptions = {}
  ): Promise<string> {
    await this.ensureInitialized();

    const logger = getLogger();
    const sessionId = uuidv4();

    const session: DGrepSearchSession = {
      sessionId,
      status: 'searching',
      statusText: `Searching ${logId} logs...`,
      startTime,
      endTime,
      maxResults: options.maxResults,
      createdAt: new Date().toISOString(),
    };

    this.sessions.set(sessionId, session);
    const abortController = new AbortController();
    this.abortControllers.set(sessionId, abortController);

    this.emitProgress(session);

    logger.info(LOG_CATEGORY, 'Starting search by log ID', { sessionId, logId, startTime, endTime });

    // Run search in background
    this.runSearchByLogId(sessionId, logId, startTime, endTime, options, abortController.signal)
      .catch((error) => this.handleError(sessionId, error));

    return sessionId;
  }

  async startSearch(params: QueryOptions): Promise<string> {
    await this.ensureInitialized();

    const logger = getLogger();
    const sessionId = uuidv4();

    const session: DGrepSearchSession = {
      sessionId,
      status: 'searching',
      statusText: 'Searching...',
      endpoint: params.endpoint,
      namespaces: params.namespaces,
      eventNames: params.eventNames,
      startTime: params.startTime,
      endTime: params.endTime,
      maxResults: params.maxResults,
      createdAt: new Date().toISOString(),
    };

    this.sessions.set(sessionId, session);
    const abortController = new AbortController();
    this.abortControllers.set(sessionId, abortController);

    this.emitProgress(session);

    logger.info(LOG_CATEGORY, 'Starting custom search', { sessionId, endpoint: params.endpoint });

    this.runSearch(sessionId, params, abortController.signal)
      .catch((error) => this.handleError(sessionId, error));

    return sessionId;
  }

  cancelSearch(sessionId: string): void {
    const logger = getLogger();
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      logger.info(LOG_CATEGORY, 'Cancelling search', { sessionId });
      controller.abort();
    }

    const session = this.sessions.get(sessionId);
    if (session && session.status !== 'complete' && session.status !== 'error') {
      session.status = 'cancelled';
      session.statusText = undefined;
      this.emitProgress(session);
    }
  }

  // ==================== Session Management ====================

  getSession(sessionId: string): DGrepSearchSession | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): DGrepSearchSession[] {
    return Array.from(this.sessions.values()).sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  getResults(sessionId: string): { columns: string[]; rows: Record<string, any>[] } | undefined {
    const session = this.sessions.get(sessionId);
    if (!session || !session.results) return undefined;
    return { columns: session.columns || [], rows: session.results };
  }

  getResultsPage(sessionId: string, offset: number, limit: number): { columns: string[]; rows: Record<string, any>[]; totalCount: number } | undefined {
    const session = this.sessions.get(sessionId);
    if (!session || !session.results) return undefined;
    return {
      columns: session.columns || [],
      rows: session.results.slice(offset, offset + limit),
      totalCount: session.results.length,
    };
  }

  removeSession(sessionId: string): void {
    this.cancelSearch(sessionId);
    this.sessions.delete(sessionId);
    this.abortControllers.delete(sessionId);
  }

  // ==================== Metadata (cached) ====================

  // Cache of DGrepClients per frontend URL (gov clouds use different portals)
  private clientCache: Map<string, DGrepClient> = new Map();

  /** Get the correct DGrepClient for a given endpoint URL (gov clouds use different portals) */
  private getClientForEndpoint(endpoint: string): DGrepClient {
    // Find which endpoint name this URL belongs to, then get its frontend URL
    let frontendUrl = DGREP_FRONTEND_URLS['Default'] || '';
    for (const [name, url] of Object.entries(DGREP_ENDPOINT_URLS)) {
      if (url === endpoint) {
        frontendUrl = DGREP_FRONTEND_URLS[name] || frontendUrl;
        break;
      }
    }

    // Default portal - use existing client
    if (!frontendUrl || frontendUrl === 'https://dgrepv2-frontend-prod.trafficmanager.net') {
      return this.client;
    }

    // Gov cloud or other portal - use cached client
    let client = this.clientCache.get(frontendUrl);
    if (!client) {
      client = new DGrepClient(frontendUrl);
      this.clientCache.set(frontendUrl, client);
    }
    return client;
  }

  async getNamespaces(endpoint: string): Promise<string[]> {
    await this.ensureInitialized();

    const cached = this.namespaceCache.get(endpoint);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    const logger = getLogger();
    logger.info(LOG_CATEGORY, 'Fetching namespaces (cache miss)', { endpoint });

    const client = this.getClientForEndpoint(endpoint);
    const namespaces = await client.getNamespaces(endpoint);
    this.namespaceCache.set(endpoint, {
      data: namespaces,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return namespaces;
  }

  async getEvents(endpoint: string, namespace: string): Promise<string[]> {
    await this.ensureInitialized();

    const cacheKey = `${endpoint}::${namespace}`;
    const cached = this.eventsCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    const logger = getLogger();
    logger.info(LOG_CATEGORY, 'Fetching events (cache miss)', { endpoint, namespace });

    const client = this.getClientForEndpoint(endpoint);
    const events = await client.getEvents(endpoint, namespace);
    this.eventsCache.set(cacheKey, {
      data: events,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return events;
  }

  async getMonitoringAccounts(): Promise<any> {
    await this.ensureInitialized();
    return this.client.getMonitoringAccounts();
  }

  clearCaches(): void {
    this.namespaceCache.clear();
    this.eventsCache.clear();
  }

  // ==================== Client Query ====================

  async runClientQuery(sessionId: string, clientQuery: string): Promise<void> {
    await this.ensureInitialized();

    const logger = getLogger();
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (!session.queryId) throw new Error('Session has no queryId — server search may not have completed');
    if (!session.endpoint) throw new Error('Session has no endpoint');

    logger.info(LOG_CATEGORY, 'Running client query', { sessionId, queryId: session.queryId });

    session.status = 'fetching';
    session.statusText = 'Running client query...';
    this.emitProgress(session);

    try {
      const result = await this.client.runClientQuery(
        session.queryId,
        session.endpoint,
        clientQuery,
        session.maxResults,
        (data) => {
          session.columns = data.columns;
          session.results = data.rows;
          session.resultCount = data.totalCount;
          this.emitIntermediateResults(sessionId, data.columns, data.rows, data.totalCount);
        },
      );

      session.status = 'complete';
      session.statusText = undefined;
      session.resultCount = result.totalCount;
      session.columns = result.columns;
      session.results = result.rows;

      this.emitProgress(session);
      this.emitComplete(session);

      logger.info(LOG_CATEGORY, 'Client query complete', {
        sessionId,
        resultCount: result.totalCount,
      });
    } catch (error: any) {
      this.handleError(sessionId, error);
    }
  }

  /** Run a client query without updating session state or emitting UI events. Returns results directly. */
  async runClientQueryDetached(sessionId: string, clientQuery: string): Promise<{ columns: string[]; rows: Record<string, any>[]; totalCount: number }> {
    await this.ensureInitialized();

    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (!session.queryId) throw new Error('Session has no queryId — server search may not have completed');
    if (!session.endpoint) throw new Error('Session has no endpoint');

    return this.client.runClientQuery(
      session.queryId,
      session.endpoint,
      clientQuery,
      session.maxResults,
    );
  }

  // ==================== URL Generation ====================

  generateQueryUrl(
    logId: LogId,
    timeCenter: string,
    serverQuery: string,
    options?: { clientQuery?: string; offsetMinutes?: number; identityColumns?: Record<string, string[]> }
  ): string {
    return this.client.generateQueryUrl(logId, timeCenter, serverQuery, options);
  }

  // ==================== Internal ====================

  private async runSearchByLogId(
    sessionId: string,
    logId: LogId,
    startTime: string,
    endTime: string,
    options: QueryByLogIdOptions,
    abortSignal: AbortSignal
  ): Promise<void> {
    const logger = getLogger();
    const session = this.sessions.get(sessionId)!;

    try {
      session.status = 'polling';
      session.statusText = 'Polling for results...';
      this.emitProgress(session);

      const result = await this.client.queryByLogId(logId, startTime, endTime, {
        ...options,
        onProgress: (status: SearchStatusResponse) => {
          this.updateProgress(sessionId, status);
        },
        onIntermediateResults: (data) => {
          session.columns = data.columns;
          session.results = data.rows;
          session.resultCount = data.totalCount;
          this.emitIntermediateResults(sessionId, data.columns, data.rows, data.totalCount);
        },
        abortSignal,
      });

      session.status = 'complete';
      session.statusText = undefined;
      session.queryId = result.queryId;
      session.resultCount = result.totalCount;
      session.columns = result.columns;
      session.results = result.rows;

      this.emitProgress(session);
      this.emitComplete(session);

      logger.info(LOG_CATEGORY, 'Search complete', {
        sessionId,
        resultCount: result.totalCount,
      });
    } catch (error: any) {
      if (abortSignal.aborted) {
        session.status = 'cancelled';
        session.statusText = undefined;
        this.emitProgress(session);
        return;
      }
      throw error;
    }
  }

  private async runSearch(
    sessionId: string,
    params: QueryOptions,
    abortSignal: AbortSignal
  ): Promise<void> {
    const logger = getLogger();
    const session = this.sessions.get(sessionId)!;

    try {
      session.status = 'polling';
      session.statusText = 'Polling for results...';
      this.emitProgress(session);

      const result = await this.client.query({
        ...params,
        onProgress: (status: SearchStatusResponse) => {
          this.updateProgress(sessionId, status);
        },
        onIntermediateResults: (data) => {
          session.columns = data.columns;
          session.results = data.rows;
          session.resultCount = data.totalCount;
          this.emitIntermediateResults(sessionId, data.columns, data.rows, data.totalCount);
        },
        abortSignal,
      });

      session.status = 'complete';
      session.statusText = undefined;
      session.queryId = result.queryId;
      session.resultCount = result.totalCount;
      session.columns = result.columns;
      session.results = result.rows;

      this.emitProgress(session);
      this.emitComplete(session);

      logger.info(LOG_CATEGORY, 'Search complete', {
        sessionId,
        resultCount: result.totalCount,
      });
    } catch (error: any) {
      if (abortSignal.aborted) {
        session.status = 'cancelled';
        session.statusText = undefined;
        this.emitProgress(session);
        return;
      }
      throw error;
    }
  }

  private updateProgress(sessionId: string, status: SearchStatusResponse): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const processed = status.ProcessedBlobSize || 0;
    const scheduled = status.ScheduledBlobSize || 1;
    const progress = scheduled > 0 ? (processed / scheduled) * 100 : 0;

    session.resultCount = status.ResultCount || 0;
    session.statusText = `${status.Status} (${progress.toFixed(1)}%, ${session.resultCount} results)`;

    const event: DGrepProgressEvent = {
      sessionId,
      status: session.status,
      statusText: session.statusText,
      resultCount: session.resultCount,
      progress,
    };
    this.emit('progress', event);
  }

  private emitProgress(session: DGrepSearchSession): void {
    const event: DGrepProgressEvent = {
      sessionId: session.sessionId,
      status: session.status,
      statusText: session.statusText,
      resultCount: session.resultCount,
    };
    this.emit('progress', event);
  }

  private emitIntermediateResults(sessionId: string, columns: string[], rows: Record<string, any>[], totalCount: number): void {
    this.emit('intermediate-results', { sessionId, columns, rows, totalCount });
  }

  private emitComplete(session: DGrepSearchSession): void {
    const event: DGrepCompleteEvent = {
      sessionId: session.sessionId,
      resultCount: session.resultCount || 0,
      columns: session.columns || [],
    };
    this.emit('complete', event);
  }

  private handleError(sessionId: string, error: Error): void {
    const logger = getLogger();
    logger.error(LOG_CATEGORY, 'Search error', {
      sessionId,
      error: error.message,
      stack: error.stack,
    });

    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'error';
      session.error = error.message;
      session.statusText = undefined;
    }

    const event: DGrepErrorEvent = { sessionId, error: error.message };
    this.emit('error', event);
  }

  // ==================== Surrounding Docs ====================

  getSurroundingDocs(
    sessionId: string,
    rowIndex: number,
    count: number
  ): { columns: string[]; rows: Record<string, any>[]; startIndex: number; endIndex: number } | undefined {
    const session = this.sessions.get(sessionId);
    if (!session || !session.results) return undefined;

    const rows = session.results;
    const start = Math.max(0, rowIndex - count);
    const end = Math.min(rows.length, rowIndex + count + 1);

    return {
      columns: session.columns || [],
      rows: rows.slice(start, end),
      startIndex: start,
      endIndex: end - 1,
    };
  }

  // ==================== Live Tail ====================

  private liveTailIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

  startLiveTail(sessionId: string, intervalMs: number = 5000): void {
    const logger = getLogger();
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (!session.endpoint || !session.namespaces || !session.eventNames) {
      throw new Error('Session lacks endpoint/namespace/event info for live tail');
    }

    // Stop any existing live tail for this session
    this.stopLiveTail(sessionId);

    logger.info(LOG_CATEGORY, 'Starting live tail', { sessionId, intervalMs });

    const interval = setInterval(async () => {
      try {
        await this.ensureInitialized();
        const now = new Date();
        const windowStart = new Date(now.getTime() - intervalMs * 2);

        const result = await this.client.query({
          endpoint: session.endpoint!,
          namespaces: session.namespaces!,
          eventNames: session.eventNames!,
          startTime: windowStart.toISOString(),
          endTime: now.toISOString(),
          maxResults: 100,
        });

        if (result.rows.length > 0) {
          this.emit('live-tail-data', {
            sessionId,
            columns: result.columns,
            rows: result.rows,
            timestamp: now.toISOString(),
          });
        }
      } catch (err: any) {
        logger.error(LOG_CATEGORY, 'Live tail poll error', { sessionId, error: err?.message });
      }
    }, intervalMs);

    this.liveTailIntervals.set(sessionId, interval);
  }

  stopLiveTail(sessionId: string): void {
    const interval = this.liveTailIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.liveTailIntervals.delete(sessionId);
      getLogger().info(LOG_CATEGORY, 'Stopped live tail', { sessionId });
    }
  }

  dispose(): void {
    // Stop all live tails
    for (const [sessionId] of this.liveTailIntervals) {
      this.stopLiveTail(sessionId);
    }
    for (const [sessionId] of this.abortControllers) {
      this.cancelSearch(sessionId);
    }
    this.sessions.clear();
    this.abortControllers.clear();
    this.clearCaches();
  }
}

// Singleton
let instance: DGrepService | null = null;

export function getDGrepService(): DGrepService {
  if (!instance) {
    instance = new DGrepService();
  }
  return instance;
}

export function disposeDGrepService(): void {
  if (instance) {
    instance.dispose();
    instance = null;
  }
}
