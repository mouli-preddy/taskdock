/**
 * Review Executor Service
 * Factory and orchestrator for review executors
 */

import { ClaudeSDKExecutor } from './executors/claude-sdk-executor.js';
import { ClaudeTerminalExecutor } from './executors/claude-terminal-executor.js';
import { ClaudeHeadlessExecutor } from './executors/claude-headless-executor.js';
import { CopilotSDKExecutor } from './executors/copilot-sdk-executor.js';
import { CopilotTerminalExecutor } from './executors/copilot-terminal-executor.js';
import { CopilotHeadlessExecutor } from './executors/copilot-headless-executor.js';
import type { IReviewExecutor } from './executors/base-executor.js';
import type { AIProviderType } from '../../shared/ai-types.js';

export interface GetExecutorOptions {
  showTerminal?: boolean;
}

export class ReviewExecutorService {
  private executors: Map<AIProviderType, IReviewExecutor> = new Map();
  private claudeHeadlessExecutor: ClaudeHeadlessExecutor;
  private copilotHeadlessExecutor: CopilotHeadlessExecutor;
  private cachedProviderAvailability: { provider: AIProviderType; available: boolean; error?: string }[] | null = null;
  private cacheWarmupPromise: Promise<void> | null = null;

  constructor() {
    this.executors.set('claude-sdk', new ClaudeSDKExecutor());
    this.executors.set('claude-terminal', new ClaudeTerminalExecutor());
    this.executors.set('copilot-sdk', new CopilotSDKExecutor());
    this.executors.set('copilot-terminal', new CopilotTerminalExecutor());
    this.claudeHeadlessExecutor = new ClaudeHeadlessExecutor();
    this.copilotHeadlessExecutor = new CopilotHeadlessExecutor();
  }

  getExecutor(provider: AIProviderType, options?: GetExecutorOptions): IReviewExecutor {
    // For claude-terminal, route to headless executor if showTerminal is false
    if (provider === 'claude-terminal' && options?.showTerminal === false) {
      return this.claudeHeadlessExecutor;
    }

    // For copilot-terminal, route to headless executor if showTerminal is false
    if (provider === 'copilot-terminal' && options?.showTerminal === false) {
      return this.copilotHeadlessExecutor;
    }

    const executor = this.executors.get(provider);
    if (!executor) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    return executor;
  }

  async getAvailableProviders(): Promise<{ provider: AIProviderType; available: boolean; error?: string }[]> {
    // Return cached results if available
    if (this.cachedProviderAvailability) {
      return this.cachedProviderAvailability;
    }

    // If warmup is in progress, wait for it
    if (this.cacheWarmupPromise) {
      await this.cacheWarmupPromise;
      if (this.cachedProviderAvailability) {
        return this.cachedProviderAvailability;
      }
    }

    // Fallback: check availability synchronously (shouldn't happen normally)
    return this.checkProviderAvailability();
  }

  /**
   * Warm up the provider availability cache at app startup.
   * This runs the availability checks in the background so the dialog opens instantly.
   */
  async warmupProviderCache(): Promise<void> {
    if (this.cacheWarmupPromise) {
      return this.cacheWarmupPromise;
    }

    this.cacheWarmupPromise = this.checkProviderAvailability().then(results => {
      this.cachedProviderAvailability = results;
    });

    return this.cacheWarmupPromise;
  }

  /**
   * Force refresh the provider availability cache.
   * Use this when user explicitly wants to recheck provider status.
   */
  async refreshProviderCache(): Promise<{ provider: AIProviderType; available: boolean; error?: string }[]> {
    this.cachedProviderAvailability = null;
    this.cacheWarmupPromise = null;
    const results = await this.checkProviderAvailability();
    this.cachedProviderAvailability = results;
    return results;
  }

  private async checkProviderAvailability(): Promise<{ provider: AIProviderType; available: boolean; error?: string }[]> {
    // Run all provider checks in parallel for faster startup
    const checks = Array.from(this.executors.entries()).map(async ([provider, executor]) => {
      const status = await executor.isAvailable();
      return {
        provider,
        available: status.available,
        error: status.error,
      };
    });

    return Promise.all(checks);
  }

  getTerminalSessionId(provider: AIProviderType): string | null {
    if (provider !== 'claude-terminal' && provider !== 'copilot-terminal') {
      return null;
    }
    const executor = this.executors.get(provider) as ClaudeTerminalExecutor | CopilotTerminalExecutor;
    return executor.getTerminalSessionId();
  }
}

// Singleton
let reviewExecutorService: ReviewExecutorService | null = null;

export function getReviewExecutorService(): ReviewExecutorService {
  if (!reviewExecutorService) {
    reviewExecutorService = new ReviewExecutorService();
  }
  return reviewExecutorService;
}
