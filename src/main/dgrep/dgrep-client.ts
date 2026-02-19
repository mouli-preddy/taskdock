/**
 * DGrep API Client
 * Low-level HTTP client for Geneva DGrep log search API.
 * Handles token management, search execution, and metadata queries.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { getLogger } from '../services/logger-service.js';
import type {
  DGrepTokens,
  StartSearchRequest,
  SearchStatusResponse,
  SearchResultsResponse,
  QueryOptions,
  QueryByLogIdOptions,
  LogId,
} from '../../shared/dgrep-types.js';
import { LOG_CONFIGS, DGREP_CONSTANTS } from '../../shared/dgrep-types.js';

const LOG_CATEGORY = 'DGrepClient';

const CACHE_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'BrainBot'
);
const CACHE_FILE = path.join(CACHE_DIR, 'geneva_tokens.json');
const GATHER_SCRIPT = path.join('C:', 'git', 'scripts', 'gather-geneva-secrets.py');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DGrepClient {
  private portalEndpoint: string;
  private cookie: string = '';
  private csrf: string = '';
  private tokenRefreshInProgress: Promise<DGrepTokens> | null = null;

  constructor(portalEndpoint: string = DGREP_CONSTANTS.PORTAL_URL) {
    this.portalEndpoint = portalEndpoint;
  }

  // ==================== Token Management ====================

  async initialize(): Promise<void> {
    const logger = getLogger();
    logger.info(LOG_CATEGORY, 'Initializing DGrep client');

    const cached = this.loadCachedTokens();
    if (cached) {
      this.cookie = cached.cookie;
      this.csrf = cached.csrf;
      logger.info(LOG_CATEGORY, 'Loaded cached tokens', {
        cookieLength: this.cookie.length,
        csrfLength: this.csrf.length,
      });
      return;
    }

    logger.info(LOG_CATEGORY, 'No cached tokens found, gathering fresh tokens');
    const tokens = await this.gatherTokens();
    this.cookie = tokens.cookie;
    this.csrf = tokens.csrf;
    logger.info(LOG_CATEGORY, 'Tokens gathered', {
      cookieLength: this.cookie.length,
      csrfLength: this.csrf.length,
    });
  }

  private loadCachedTokens(): DGrepTokens | null {
    try {
      if (!fs.existsSync(CACHE_FILE)) return null;

      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      if (
        data.cookie &&
        data.cookie.length > DGREP_CONSTANTS.MIN_COOKIE_LENGTH &&
        data.csrf
      ) {
        return { cookie: data.cookie, csrf: data.csrf };
      }
    } catch {
      // Ignore parse errors
    }
    return null;
  }

  private gatherTokens(): Promise<DGrepTokens> {
    const logger = getLogger();
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(GATHER_SCRIPT)) {
        reject(new Error(`gather-geneva-secrets.py not found at ${GATHER_SCRIPT}`));
        return;
      }

      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      logger.info(LOG_CATEGORY, 'Spawning token gather script', { script: GATHER_SCRIPT });

      const proc = spawn(pythonCmd, [GATHER_SCRIPT, '--non-interactive', '--output', CACHE_FILE], {
        stdio: 'inherit',
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Token gather script exited with code ${code}`));
          return;
        }

        const cached = this.loadCachedTokens();
        if (!cached) {
          reject(new Error('Failed to load tokens after gather'));
          return;
        }

        resolve(cached);
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn Python process: ${err.message}`));
      });
    });
  }

  async refreshTokens(): Promise<void> {
    if (this.tokenRefreshInProgress) {
      const tokens = await this.tokenRefreshInProgress;
      this.cookie = tokens.cookie;
      this.csrf = tokens.csrf;
      return;
    }

    const logger = getLogger();
    logger.info(LOG_CATEGORY, 'Refreshing tokens');

    this.tokenRefreshInProgress = this.gatherTokens();
    try {
      const tokens = await this.tokenRefreshInProgress;
      this.cookie = tokens.cookie;
      this.csrf = tokens.csrf;
      logger.info(LOG_CATEGORY, 'Tokens refreshed', {
        cookieLength: this.cookie.length,
        csrfLength: this.csrf.length,
      });
    } finally {
      this.tokenRefreshInProgress = null;
    }
  }

  private getHeaders(): Record<string, string> {
    return {
      Accept: '*/*',
      Cookie: this.cookie,
      Csrftoken: this.csrf,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
      Referer: `${this.portalEndpoint}/frameable/dgrep?hideShell=true&nopreview=true&parentOrigin=${this.portalEndpoint}`,
    };
  }

  private async request<T>(
    url: string,
    options: RequestInit = {},
    retryOnAuth = true
  ): Promise<T> {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...(options.headers as Record<string, string> | undefined),
      },
    });

    if ((response.status === 401 || response.status === 403) && retryOnAuth) {
      const logger = getLogger();
      logger.warn(LOG_CATEGORY, `Auth error ${response.status}, refreshing tokens`);
      await this.refreshTokens();
      return this.request<T>(url, options, false);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DGrep API error ${response.status}: ${text.substring(0, 500)}`);
    }

    return response.json() as Promise<T>;
  }

  // ==================== Core Search (3-step) ====================

  async startSearch(params: {
    endpoint: string;
    namespaces: string[];
    eventNames: string[];
    startTime: string;
    endTime: string;
    serverQuery?: string;
    maxResults?: number;
    identityColumns?: Record<string, string[]>;
  }): Promise<string> {
    const logger = getLogger();
    const queryId = uuidv4();

    const url = `${this.portalEndpoint}/user-api/v2/logs/startSearchV2?addAADClaimToMdsCalls=true&useDSTSPathwayWithDSTSLogin=false`;

    const maxResults = params.maxResults || DGREP_CONSTANTS.DEFAULT_MAX_RESULTS;

    const serverQuery = params.serverQuery?.trim() || '';

    const body: StartSearchRequest = {
      endpoint: params.endpoint,
      namespaces: params.namespaces,
      eventNames: params.eventNames,
      startTime: params.startTime,
      endTime: params.endTime,
      identityColumns: params.identityColumns || {},
      queryID: queryId,
      queryType: serverQuery ? 2 : 1, // 2 = KQL with server filter, 1 = no server filter
      query: serverQuery,
      searchCriteria: null,
      maxResults,
      shimMode: 'Dgrep',
    };

    logger.info(LOG_CATEGORY, 'Starting search', {
      namespaces: params.namespaces,
      eventNames: params.eventNames,
      startTime: params.startTime,
      endTime: params.endTime,
      serverQuery: serverQuery || '(none)',
      queryType: body.queryType,
      maxResults,
    });

    await this.request<void>(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return queryId;
  }

  async pollStatus(
    queryId: string,
    endpoint: string,
    options?: {
      onProgress?: (status: SearchStatusResponse) => void;
      abortSignal?: AbortSignal;
    }
  ): Promise<SearchStatusResponse> {
    const logger = getLogger();
    const encodedEndpoint = doubleEncodeEndpoint(endpoint);
    const baseUrl = `${this.portalEndpoint}/user-api/v2/logs/searchstatus/id/${queryId}/endpoint/${encodedEndpoint}`;

    const startTime = Date.now();
    const timeoutMs = DGREP_CONSTANTS.POLL_TIMEOUT_S * 1000;

    while (Date.now() - startTime < timeoutMs) {
      if (options?.abortSignal?.aborted) {
        throw new Error('Search cancelled');
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const status = await this.request<SearchStatusResponse>(`${baseUrl}?_=${timestamp}`);

      const currentStatus = status.Status || 'Unknown';

      if (currentStatus === 'Initializing' || currentStatus === 'Searching') {
        options?.onProgress?.(status);
        await sleep(DGREP_CONSTANTS.POLL_INTERVAL_MS);
        continue;
      }

      logger.info(LOG_CATEGORY, 'Search finished', {
        status: currentStatus,
        resultCount: status.ResultCount,
      });

      return status;
    }

    throw new Error(`Search timed out after ${DGREP_CONSTANTS.POLL_TIMEOUT_S}s`);
  }

  async fetchResults(
    queryId: string,
    endpoint: string,
    clientQuery: string,
    startIndex: number,
    endIndex: number
  ): Promise<SearchResultsResponse> {
    const encodedEndpoint = doubleEncodeEndpoint(endpoint);
    const url =
      `${this.portalEndpoint}/user-api/v2/logs/results/id/${queryId}/endpoint/${encodedEndpoint}` +
      `?startIndex=${startIndex}&endIndex=${endIndex}&querytype=KQL`;

    return this.request<SearchResultsResponse>(url, {
      method: 'POST',
      body: JSON.stringify(clientQuery),
    });
  }

  /**
   * Full search orchestration: start → poll (with intermediate results) → fetch final results in batches
   */
  async query(params: QueryOptions & {
    onProgress?: (status: SearchStatusResponse) => void;
    onIntermediateResults?: (data: { columns: string[]; rows: Record<string, any>[]; totalCount: number }) => void;
    abortSignal?: AbortSignal;
  }): Promise<{
    columns: string[];
    rows: Record<string, any>[];
    totalCount: number;
    queryId: string;
  }> {
    const logger = getLogger();
    const clientQuery = params.clientQuery || 'source';
    const maxResults = params.maxResults || DGREP_CONSTANTS.DEFAULT_MAX_RESULTS;

    // Step 1: Start search
    const queryId = await this.startSearch({
      endpoint: params.endpoint,
      namespaces: params.namespaces,
      eventNames: params.eventNames,
      startTime: params.startTime,
      endTime: params.endTime,
      serverQuery: params.serverQuery,
      maxResults,
      identityColumns: params.identityColumns,
    });

    // Step 2: Poll until complete, fetching intermediate results when available
    let lastFetchedCount = 0;
    let pollCount = 0;
    let intermediateFetchInFlight = false;

    const status = await this.pollStatus(queryId, params.endpoint, {
      onProgress: (pollStatus) => {
        params.onProgress?.(pollStatus);
        pollCount++;

        // Fetch intermediate results every 5 polls when new results are available
        // Use a guard to prevent overlapping intermediate fetches
        const available = pollStatus.ResultCount || 0;
        const shouldFetch = available > lastFetchedCount && (pollCount === 1 || pollCount % 5 === 0);
        if (shouldFetch && !intermediateFetchInFlight) {
          intermediateFetchInFlight = true;
          this.fetchResults(
            queryId, params.endpoint, clientQuery, 0, Math.min(available, 5000)
          ).then((partial) => {
            const cols = extractColumnNames(partial.Columns);
            const rows = partial.Rows || [];
            lastFetchedCount = available;
            params.onIntermediateResults?.({
              columns: cols,
              rows,
              totalCount: available,
            });
          }).catch((e) => {
            // Intermediate fetch can fail during active search — that's OK
            logger.debug(LOG_CATEGORY, 'Intermediate result fetch skipped', { error: (e as Error).message });
          }).finally(() => {
            intermediateFetchInFlight = false;
          });
        }
      },
      abortSignal: params.abortSignal,
    });

    logger.info(LOG_CATEGORY, 'Search completed', {
      resultCount: status.ResultCount,
    });

    // Step 3: Get preview (count only)
    const preview = await this.fetchResults(queryId, params.endpoint, clientQuery, 1, 0);
    const totalCount = Math.min(maxResults, preview.Count || 0);
    const columns = extractColumnNames(preview.Columns);

    if (totalCount === 0) {
      return { columns, rows: [], totalCount: 0, queryId };
    }

    // Step 4: Fetch actual results in batches
    const batchSize = 5000;
    const allRows: Record<string, any>[] = [];

    for (let offset = 0; offset < totalCount; offset += batchSize) {
      if (params.abortSignal?.aborted) throw new Error('Search cancelled');

      const end = Math.min(offset + batchSize, totalCount);
      const batch = await this.fetchResults(queryId, params.endpoint, clientQuery, offset, end);
      allRows.push(...(batch.Rows || []));

      // Emit intermediate results as batches load
      if (offset + batchSize < totalCount) {
        params.onIntermediateResults?.({
          columns,
          rows: allRows,
          totalCount,
        });
      }
    }

    return { columns, rows: allRows, totalCount, queryId };
  }

  /**
   * Re-run a client query against existing server-side search results.
   * Does not re-run the server search — only re-fetches with a new client KQL.
   */
  async runClientQuery(
    queryId: string,
    endpoint: string,
    clientQuery: string,
    maxResults?: number,
    onIntermediateResults?: (data: { columns: string[]; rows: Record<string, any>[]; totalCount: number }) => void,
  ): Promise<{
    columns: string[];
    rows: Record<string, any>[];
    totalCount: number;
  }> {
    const logger = getLogger();
    const limit = maxResults || DGREP_CONSTANTS.DEFAULT_MAX_RESULTS;

    // Get count first
    const preview = await this.fetchResults(queryId, endpoint, clientQuery, 1, 0);
    const totalCount = Math.min(limit, preview.Count || 0);
    const columns = extractColumnNames(preview.Columns);

    if (totalCount === 0) {
      return { columns, rows: [], totalCount: 0 };
    }

    logger.info(LOG_CATEGORY, 'Running client query', { queryId, totalCount });

    // Fetch in batches
    const batchSize = 5000;
    const allRows: Record<string, any>[] = [];

    for (let offset = 0; offset < totalCount; offset += batchSize) {
      const end = Math.min(offset + batchSize, totalCount);
      const batch = await this.fetchResults(queryId, endpoint, clientQuery, offset, end);
      allRows.push(...(batch.Rows || []));

      if (offset + batchSize < totalCount) {
        onIntermediateResults?.({ columns, rows: allRows, totalCount });
      }
    }

    return { columns, rows: allRows, totalCount };
  }

  /**
   * Convenience method using pre-configured log source
   */
  async queryByLogId(
    logId: LogId,
    startTime: string,
    endTime: string,
    options: QueryByLogIdOptions & {
      onProgress?: (status: SearchStatusResponse) => void;
      onIntermediateResults?: (data: { columns: string[]; rows: Record<string, any>[]; totalCount: number }) => void;
      abortSignal?: AbortSignal;
    } = {}
  ): Promise<{
    columns: string[];
    rows: Record<string, any>[];
    totalCount: number;
    queryId: string;
  }> {
    const config = LOG_CONFIGS[logId];
    if (!config) {
      throw new Error(`Unknown logId: ${logId}. Available: ${Object.keys(LOG_CONFIGS).join(', ')}`);
    }

    let clientQuery = options.clientQuery ?? config.defaultClientQuery;
    const limitLines = options.limitLines ?? 100;
    clientQuery = `${clientQuery.trim()}\n| limit ${limitLines}`;

    return this.query({
      endpoint: config.endpoint,
      namespaces: [config.namespace],
      eventNames: [config.events],
      startTime,
      endTime,
      serverQuery: options.serverQuery,
      clientQuery,
      maxResults: options.maxResults,
      identityColumns: options.identityColumns,
      onProgress: options.onProgress,
      onIntermediateResults: options.onIntermediateResults,
      abortSignal: options.abortSignal,
    });
  }

  // ==================== Metadata APIs ====================

  async getNamespaces(endpoint: string): Promise<string[]> {
    const logger = getLogger();
    const encodedEndpoint = doubleEncodeEndpoint(endpoint);
    const url = `${this.portalEndpoint}/user-api/v1/logs/environment/${encodedEndpoint}/namespace`;

    logger.info(LOG_CATEGORY, 'Fetching namespaces', { endpoint });
    return this.request<string[]>(url);
  }

  async getEvents(endpoint: string, namespace: string): Promise<string[]> {
    const logger = getLogger();
    const encodedEndpoint = doubleEncodeEndpoint(endpoint);
    const timestamp = Math.floor(Date.now() / 1000);
    const url =
      `${this.portalEndpoint}/user-api/v1/logs/environment/${encodedEndpoint}` +
      `/namespace/${namespace}/eventNames?_=${timestamp}`;

    logger.info(LOG_CATEGORY, 'Fetching events', { endpoint, namespace });

    return this.request<string[]>(url);
  }

  async getMonitoringAccounts(): Promise<any> {
    const url = `${this.portalEndpoint}/user-api/v1/hint/monitoringAccountConfig`;
    return this.request<any>(url);
  }

  // ==================== URL Generation ====================

  generateQueryUrl(
    logId: LogId,
    timeCenter: string,
    serverQuery: string,
    options: {
      clientQuery?: string;
      offsetMinutes?: number;
      identityColumns?: Record<string, string[]>;
    } = {}
  ): string {
    const config = LOG_CONFIGS[logId];
    if (!config) {
      throw new Error(`Unknown logId: ${logId}`);
    }

    const clientQuery = options.clientQuery ?? config.defaultClientQuery;
    const offsetMinutes = options.offsetMinutes ?? 30;

    let scopingParam = '';
    if (options.identityColumns) {
      const scopingValues: string[] = [];
      for (const [key, values] of Object.entries(options.identityColumns)) {
        scopingValues.push(`["${key}","${values.join(',')}"]`);
      }
      scopingParam = `&scopingConditions=${encodeURIComponent(`[${scopingValues.join(',')}]`)}`;
    }

    const dt = new Date(timeCenter);
    const formattedTime = dt.toISOString().slice(0, 16) + ':00.000Z';

    return (
      `https://portal.microsoftgeneva.com/logs/dgrep` +
      `?page=logs&be=DGrep${scopingParam}` +
      `&time=${formattedTime}&offset=~${offsetMinutes}&offsetUnit=Minutes&UTC=true` +
      `&ep=${encodeURIComponent(config.endpointName)}&ns=${config.namespace}&en=${config.events}` +
      `&serverQuery=${encodeURIComponent(serverQuery)}&serverQueryType=kql` +
      `&kqlClientQuery=${encodeURIComponent(clientQuery)}`
    );
  }
}

// ==================== Utilities ====================

export function doubleEncodeEndpoint(endpoint: string): string {
  return encodeURIComponent(encodeURIComponent(endpoint));
}

function extractColumnNames(columns: Record<string, number> | undefined): string[] {
  if (!columns || typeof columns !== 'object') return [];
  return Object.keys(columns);
}
