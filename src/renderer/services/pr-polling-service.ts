/**
 * PR Polling Service
 *
 * Handles automatic polling for PR updates including:
 * - Comment/thread changes
 * - New PR iterations (commits pushed)
 */

import type { CommentThread, PullRequestIteration, PollingSettings } from '../../shared/types.js';

export interface PollResult {
  hasNewVersion: boolean;
  hasCommentChanges: boolean;
  newIterationCount?: number;
  newIterationCommit?: string;
  updatedThreads?: CommentThread[];
}

export interface PollingState {
  lastKnownIterationCount: number;
  lastKnownIterationCommit: string | null;
  lastThreadsHash: string | null;
}

export type PollCallback = (tabId: string, result: PollResult) => void;

interface PollContext {
  tabId: string;
  org: string;
  project: string;
  repoId: string;
  prId: number;
  state: PollingState;
}

export class PRPollingService {
  private pollingIntervals: Map<string, number> = new Map();  // tabId -> intervalId
  private pollCallback: PollCallback | null = null;
  private settings: PollingSettings = { enabled: true, intervalSeconds: 30 };

  constructor() {
    // Load settings on init
    this.loadSettings();
  }

  /**
   * Set the callback to be invoked when poll detects changes
   */
  onPollResult(callback: PollCallback): void {
    this.pollCallback = callback;
  }

  /**
   * Update polling settings
   */
  setSettings(settings: PollingSettings): void {
    this.settings = settings;

    // If settings changed, we might need to restart polling for active tabs
    // This is handled by the caller (app.ts) when settings are saved
  }

  /**
   * Get current polling settings
   */
  getSettings(): PollingSettings {
    return { ...this.settings };
  }

  /**
   * Load settings from backend
   */
  private async loadSettings(): Promise<void> {
    try {
      const settings = await window.electronAPI.getPollingSettings();
      if (settings) {
        this.settings = settings;
      }
    } catch (error) {
      console.warn('[PRPollingService] Failed to load settings, using defaults:', error);
    }
  }

  /**
   * Start polling for a PR tab
   */
  startPolling(context: PollContext): void {
    if (!this.settings.enabled) {
      console.log(`[PRPollingService] Polling disabled, not starting for tab ${context.tabId}`);
      return;
    }

    // Stop existing polling for this tab if any
    this.stopPolling(context.tabId);

    const intervalMs = this.settings.intervalSeconds * 1000;
    console.log(`[PRPollingService] Starting polling for tab ${context.tabId} every ${this.settings.intervalSeconds}s`);

    const intervalId = window.setInterval(async () => {
      await this.poll(context);
    }, intervalMs);

    this.pollingIntervals.set(context.tabId, intervalId);
  }

  /**
   * Stop polling for a specific tab
   */
  stopPolling(tabId: string): void {
    const intervalId = this.pollingIntervals.get(tabId);
    if (intervalId !== undefined) {
      window.clearInterval(intervalId);
      this.pollingIntervals.delete(tabId);
      console.log(`[PRPollingService] Stopped polling for tab ${tabId}`);
    }
  }

  /**
   * Stop all active polling
   */
  stopAllPolling(): void {
    for (const [tabId, intervalId] of this.pollingIntervals) {
      window.clearInterval(intervalId);
      console.log(`[PRPollingService] Stopped polling for tab ${tabId}`);
    }
    this.pollingIntervals.clear();
  }

  /**
   * Check if polling is active for a tab
   */
  isPolling(tabId: string): boolean {
    return this.pollingIntervals.has(tabId);
  }

  /**
   * Restart polling for a tab (e.g., after refresh)
   */
  restartPolling(context: PollContext): void {
    this.startPolling(context);
  }

  /**
   * Poll for changes
   */
  private async poll(context: PollContext): Promise<void> {
    try {
      const result = await this.checkForChanges(context);

      if (result.hasNewVersion || result.hasCommentChanges) {
        // Update the stored state
        if (result.newIterationCount !== undefined) {
          context.state.lastKnownIterationCount = result.newIterationCount;
        }
        if (result.newIterationCommit !== undefined) {
          context.state.lastKnownIterationCommit = result.newIterationCommit;
        }
        if (result.updatedThreads) {
          context.state.lastThreadsHash = this.computeThreadsHash(result.updatedThreads);
        }

        // Notify callback
        this.pollCallback?.(context.tabId, result);
      }
    } catch (error) {
      console.warn(`[PRPollingService] Poll failed for tab ${context.tabId}:`, error);
      // Don't stop polling on error, just skip this cycle
    }
  }

  /**
   * Check for PR changes
   */
  private async checkForChanges(context: PollContext): Promise<PollResult> {
    const { org, project, repoId, prId, state } = context;
    const result: PollResult = {
      hasNewVersion: false,
      hasCommentChanges: false,
    };

    // Check for new iterations (new commits pushed)
    const iterations: PullRequestIteration[] = await window.electronAPI.getIterations(org, project, repoId, prId);

    if (iterations.length > state.lastKnownIterationCount) {
      result.hasNewVersion = true;
      result.newIterationCount = iterations.length;
      const latestIteration = iterations[iterations.length - 1];
      result.newIterationCommit = latestIteration?.sourceRefCommit?.commitId || undefined;
      console.log(`[PRPollingService] New version detected: ${state.lastKnownIterationCount} -> ${iterations.length} iterations`);
    } else if (iterations.length > 0) {
      // Check if the latest commit changed (edge case: force push)
      const latestIteration = iterations[iterations.length - 1];
      const latestCommit = latestIteration?.sourceRefCommit?.commitId || undefined;
      if (latestCommit && latestCommit !== state.lastKnownIterationCommit) {
        result.hasNewVersion = true;
        result.newIterationCount = iterations.length;
        result.newIterationCommit = latestCommit;
        console.log(`[PRPollingService] Version change detected (commit changed): ${state.lastKnownIterationCommit} -> ${latestCommit}`);
      }
    }

    // Check for thread/comment changes
    const threads: CommentThread[] = await window.electronAPI.getThreads(org, project, repoId, prId);
    const currentHash = this.computeThreadsHash(threads);

    if (state.lastThreadsHash !== null && currentHash !== state.lastThreadsHash) {
      result.hasCommentChanges = true;
      result.updatedThreads = threads;
      console.log(`[PRPollingService] Comment changes detected`);
    }

    return result;
  }

  /**
   * Compute a hash for threads to detect changes
   * Uses thread id and lastUpdatedDate for change detection
   */
  computeThreadsHash(threads: CommentThread[]): string {
    if (!threads || threads.length === 0) {
      return 'empty';
    }

    // Sort by id for consistent ordering
    const sortedThreads = [...threads].sort((a, b) => a.id - b.id);

    // Create a string representation: "id:lastUpdatedDate,..."
    const hashInput = sortedThreads
      .map(t => `${t.id}:${t.lastUpdatedDate}:${t.comments?.length || 0}`)
      .join(',');

    // Simple hash function (FNV-1a inspired)
    let hash = 2166136261;
    for (let i = 0; i < hashInput.length; i++) {
      hash ^= hashInput.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }

    return hash.toString(16);
  }

  /**
   * Initialize polling state from current PR data
   */
  static createInitialState(
    iterations: PullRequestIteration[],
    threads: CommentThread[]
  ): PollingState {
    const service = new PRPollingService();
    const latestIteration = iterations[iterations.length - 1];

    return {
      lastKnownIterationCount: iterations.length,
      lastKnownIterationCommit: latestIteration?.sourceRefCommit?.commitId || null,
      lastThreadsHash: service.computeThreadsHash(threads),
    };
  }
}
