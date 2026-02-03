/**
 * Base Review Executor Interface
 * All review executors must implement this interface
 */

import type { ReviewContextInfo, ReviewExecutorOptions, ReviewExecutorResult } from '../../../shared/ai-types.js';

export interface IReviewExecutor {
  /**
   * Execute the review
   */
  execute(
    context: ReviewContextInfo,
    options: ReviewExecutorOptions
  ): Promise<ReviewExecutorResult>;

  /**
   * Cancel the review if in progress
   */
  cancel(): void;

  /**
   * Check if this executor is available
   */
  isAvailable(): Promise<{ available: boolean; error?: string }>;
}

/**
 * Base class with common functionality
 */
export abstract class BaseReviewExecutor implements IReviewExecutor {
  protected abortController: AbortController | null = null;

  abstract execute(
    context: ReviewContextInfo,
    options: ReviewExecutorOptions
  ): Promise<ReviewExecutorResult>;

  abstract isAvailable(): Promise<{ available: boolean; error?: string }>;

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  protected createAbortController(): AbortController {
    this.abortController = new AbortController();
    return this.abortController;
  }
}
