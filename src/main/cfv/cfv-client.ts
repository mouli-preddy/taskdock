import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { convertCallFlow, convertCallDetails, writeMetadata } from './cfv-converter.js';
import type { ApiResponse, CfvClientOptions, FetchProgress, FetchResult, PollStatus } from './cfv-types.js';

const DEFAULT_API_BASE = 'https://cfvapi-aks.cfvapi.skype.com';
const DEFAULT_OUTPUT_BASE = join(
  process.env.LOCALAPPDATA || join(process.env.HOME || '', 'AppData', 'Local'),
  'BrainBot',
  'cfv_calls'
);

const POLL_MAX_ATTEMPTS = 60;
const POLL_INTERVAL_MS = 2000;

export class CfvClient {
  private token: string;
  private apiBase: string;
  private outputBase: string;

  constructor(options: CfvClientOptions) {
    this.token = options.token;
    this.apiBase = options.apiBase ?? DEFAULT_API_BASE;
    this.outputBase = options.outputBase ?? DEFAULT_OUTPUT_BASE;
  }

  setToken(token: string): void {
    this.token = token;
  }

  async validateToken(): Promise<boolean> {
    const url = `${this.apiBase}/api/callSummary/00000000-0000-0000-0000-000000000000`;
    try {
      const resp = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      });
      // Any response other than 401/403 means the token is valid
      return resp.status !== 401 && resp.status !== 403;
    } catch {
      return false;
    }
  }

  async fetchCall(callId: string, onProgress?: (p: FetchProgress) => void): Promise<FetchResult> {
    const outputDir = join(this.outputBase, callId);
    const rawDir = join(outputDir, 'raw');
    await mkdir(rawDir, { recursive: true });

    const results: Record<string, unknown> = {};
    const totalSteps = 5;

    // 1. Fetch Call Summary
    onProgress?.({ step: 1, totalSteps, label: 'Fetching Call Summary' });
    const summaryUrl = `${this.apiBase}/api/callSummary/${callId}`;
    const summaryResult = await this.request<Record<string, unknown>>(summaryUrl);
    if (summaryResult.data) {
      results['callSummary'] = summaryResult.data;
    }

    // 2. Fetch Events (QoE)
    onProgress?.({ step: 2, totalSteps, label: 'Fetching Events (QoE)' });
    const eventsUrl = `${this.apiBase}/v2/api/events/${callId}?eventName=mdss_qoe`;
    const eventsResult = await this.request<Record<string, unknown>>(eventsUrl);
    if (eventsResult.data) {
      results['events_qoe'] = eventsResult.data;
    }

    // 3. Fetch Call Flow (with polling)
    onProgress?.({ step: 3, totalSteps, label: 'Fetching Call Flow' });
    const callFlowUrl = `${this.apiBase}/api/query/call/${callId}?forceReload=false&getMessageScores=true&forceCallFlowData=false`;
    const callFlowResult = await this.request<{ queryUrl?: string }>(callFlowUrl, { method: 'POST', body: '{}' });
    if (callFlowResult.data?.queryUrl) {
      const pollResult = await this.pollStatus(callFlowResult.data.queryUrl, (pct) => {
        onProgress?.({ step: 3, totalSteps, label: 'Fetching Call Flow', percentComplete: pct });
      });
      if (pollResult.data) {
        results['callFlow'] = pollResult.data;
      }
    }

    // 4. Fetch Call Details (with polling)
    onProgress?.({ step: 4, totalSteps, label: 'Fetching Call Details' });
    const detailsUrl = `${this.apiBase}/v2/api/callDetails/${callId}?forceReload=false`;
    const detailsResult = await this.request<{ queryUrl?: string } & Record<string, unknown>>(detailsUrl);
    if (detailsResult.data?.queryUrl) {
      const pollResult = await this.pollStatus(detailsResult.data.queryUrl, (pct) => {
        onProgress?.({ step: 4, totalSteps, label: 'Fetching Call Details', percentComplete: pct });
      });
      if (pollResult.data) {
        results['callDetails'] = pollResult.data;
      }
    } else if (detailsResult.data) {
      results['callDetails'] = detailsResult.data;
    }

    // 5. Fetch Chat Assistant availability
    onProgress?.({ step: 5, totalSteps, label: 'Fetching Chat Assistant info' });
    const chatUrl = `${this.apiBase}/api/ChatAssistant/Chat/${callId}/ChatAvailable`;
    const chatResult = await this.request<Record<string, unknown>>(chatUrl);
    if (chatResult.data) {
      results['chatAssistant'] = chatResult.data;
    }

    // Save raw JSON files
    const rawFiles: string[] = [];
    for (const [name, data] of Object.entries(results)) {
      const filePath = join(rawDir, `${name}.json`);
      const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      await writeFile(filePath, content, 'utf-8');
      rawFiles.push(`raw/${name}.json`);
    }

    // Convert to AI-friendly format
    const stats = { callflowMessages: 0, diagnosticFiles: 0 };

    if (results['callFlow']) {
      stats.callflowMessages = await convertCallFlow(
        results['callFlow'] as Record<string, unknown>,
        outputDir
      );
    }

    if (results['callDetails']) {
      stats.diagnosticFiles = await convertCallDetails(
        results['callDetails'] as Record<string, unknown>,
        outputDir
      );
    }

    await writeMetadata(callId, rawFiles, stats, outputDir);

    return { callId, outputDir, rawFiles, stats };
  }

  private async request<T>(url: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...options.headers,
        },
      });

      const raw = await response.text();

      if (!response.ok) {
        return { status: response.status, error: raw.slice(0, 500), raw };
      }

      const contentType = response.headers.get('Content-Type') ?? '';
      if (contentType.includes('application/json')) {
        return { status: response.status, data: JSON.parse(raw) as T, raw };
      }
      return { status: response.status, data: raw as unknown as T, raw };
    } catch (err) {
      return { status: 0, error: String(err) };
    }
  }

  private async pollStatus(
    queryUrl: string,
    onProgress?: (percentComplete: number) => void
  ): Promise<PollStatus> {
    for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
      const result = await this.request<Record<string, unknown>>(queryUrl, {
        method: 'POST',
        body: '{}',
      });

      if (result.error) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const data = result.data;
      if (data && typeof data === 'object') {
        const finished = data.finished as boolean | undefined;
        const failed = data.failed as boolean | undefined;
        const error = data.error as string | undefined;

        const components = data.componentStatus as Array<{ name: string; progress: number }> | undefined;
        if (components?.length && onProgress) {
          const avg = components.reduce((sum, c) => sum + (c.progress ?? 0), 0) / components.length;
          onProgress(avg);
        }

        if (failed) {
          return { finished: true, failed: true, error, data: data as Record<string, unknown> };
        }

        if (finished) {
          return { finished: true, failed: false, data: data as Record<string, unknown> };
        }
      }

      await sleep(POLL_INTERVAL_MS);
    }

    return { finished: false, failed: true, error: 'Timeout' };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
