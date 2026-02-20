import { randomUUID } from 'crypto';
import { loadCachedGenevaTokens, acquireGenevaTokens } from './geneva-token-service.js';
import type {
  GenevaDashboard,
  GenevaDashboardTreeEntry,
  GenevaMetricsRequest,
  GenevaMetricsResponse,
  GenevaMqlQuery,
  GenevaTokens,
  GenevaWidgetMetrics,
  GenevaDashboardMetrics,
} from '../shared/geneva-types.js';

const PORTAL_BASE_URL = 'https://portal.microsoftgeneva.com';

export class GenevaApiClient {
  private tokenCache: GenevaTokens | null = null;

  /**
   * Load tokens from cache or acquire fresh ones via Playwright
   */
  private getTokens(): GenevaTokens {
    if (this.tokenCache) {
      return this.tokenCache;
    }

    const cached = loadCachedGenevaTokens();
    if (cached) {
      this.tokenCache = cached;
      return cached;
    }

    throw new Error('No cached Geneva tokens. Call refreshTokens() first.');
  }

  /**
   * Refresh tokens via Playwright + Edge browser automation
   */
  async refreshTokens(): Promise<GenevaTokens> {
    const tokens = await acquireGenevaTokens();
    this.tokenCache = tokens;
    return tokens;
  }

  /**
   * Get tokens, auto-refreshing if the cache is missing or invalid
   */
  private async ensureTokens(): Promise<GenevaTokens> {
    try {
      return this.getTokens();
    } catch {
      return this.refreshTokens();
    }
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const tokens = await this.ensureTokens();
    return {
      'Cookie': tokens.cookie,
      'Csrftoken': tokens.csrf,
      'Content-Type': 'application/json',
      'clientid': 'Jarvis',
      'X-Requested-With': 'XMLHttpRequest',
      'jarvis.overridetimeout': '601000',
      'sourceidentity': JSON.stringify({
        user: 'TaskDock',
        time: Date.now(),
        retry: false,
      }),
      'traceguid': randomUUID(),
    };
  }

  private async request<T>(url: string, options: RequestInit = {}): Promise<T> {
    const headers = await this.getHeaders();

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...options.headers as Record<string, string>,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      const preview = errorText.substring(0, 200);
      throw new Error(
        `Geneva API Error: ${response.status} ${response.statusText} - ${preview}`
      );
    }

    return response.json() as Promise<T>;
  }

  // ==================== Public API Methods ====================

  /**
   * Get a full dashboard definition
   */
  async getDashboard(account: string, path: string): Promise<GenevaDashboard> {
    const url = `${PORTAL_BASE_URL}/user-api/v2/dashboard/get/${encodeURIComponent(account)}/${path}`;
    return this.request<GenevaDashboard>(url);
  }

  /**
   * List all dashboards in an account
   */
  async getDashboardTree(account: string): Promise<GenevaDashboardTreeEntry[]> {
    const url = `${PORTAL_BASE_URL}/user-api/v1/dashboard/getTree/${encodeURIComponent(account)}`;
    return this.request<GenevaDashboardTreeEntry[]>(url);
  }

  /**
   * Execute a single MQL metrics query
   */
  async queryMetrics(params: {
    account: string;
    namespace: string;
    query: string;
    startTime: Date;
    endTime: Date;
    resolutionMs?: number;
    selectionCount?: number;
  }): Promise<GenevaMetricsResponse> {
    const url = `${PORTAL_BASE_URL}/user-api/queryGateway/v2/language/jarvis/monitoringAccount/${encodeURIComponent(params.account)}`;

    const body: GenevaMetricsRequest = {
      monitoringAccount: params.account,
      metricNamespace: params.namespace,
      startTimeUTC: params.startTime.toUTCString(),
      endTimeUTC: params.endTime.toUTCString(),
      queryStatement: params.query,
      resolutionInMilliseconds: params.resolutionMs ?? 300000,
      resolutionReductionAggregationType: 'None',
      selectionCount: params.selectionCount ?? 100,
      queryParameters: {},
    };

    return this.request<GenevaMetricsResponse>(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Fetch a dashboard and execute all widget MQL queries in parallel.
   * Returns the dashboard definition and metrics for every widget.
   */
  async getDashboardMetrics(
    account: string,
    path: string,
    timeRange?: { startTime: Date; endTime: Date }
  ): Promise<GenevaDashboardMetrics> {
    const dashboard = await this.getDashboard(account, path);
    const widgets = dashboard.content?.wires?.widgets ?? [];

    const now = Date.now();
    const queries: Array<{ widgetTitle: string; widgetGuid: string; query: GenevaMqlQuery; startTime: Date; endTime: Date }> = [];

    for (const widget of widgets) {
      const data = widget.wires?.data;
      if (!data?.mdmKql?.length) continue;

      // Resolve time range: use override, or convert relative offsets to absolute
      let startTime: Date;
      let endTime: Date;

      if (timeRange) {
        startTime = timeRange.startTime;
        endTime = timeRange.endTime;
      } else {
        startTime = new Date(now + data.startTime);
        endTime = data.endTime === -1 ? new Date(now) : new Date(now + data.endTime);
      }

      for (const mqlQuery of data.mdmKql) {
        queries.push({
          widgetTitle: widget.wires.title,
          widgetGuid: widget.guid,
          query: mqlQuery,
          startTime,
          endTime,
        });
      }
    }

    const results = await Promise.all(
      queries.map(async (q): Promise<GenevaWidgetMetrics> => {
        const results = await this.queryMetrics({
          account: q.query.account || account,
          namespace: q.query.namespace,
          query: q.query.kqlQuery,
          startTime: q.startTime,
          endTime: q.endTime,
        });
        return {
          widgetTitle: q.widgetTitle,
          widgetGuid: q.widgetGuid,
          query: q.query,
          results,
        };
      })
    );

    return { dashboard, widgetMetrics: results };
  }
}
