/**
 * Base Review Executor Interface
 * All review executors must implement this interface
 */

import { spawn } from 'child_process';
import type { ReviewContextInfo, ReviewExecutorOptions, ReviewExecutorResult } from '../../../shared/ai-types.js';

/**
 * Check if a CLI command is available on the system
 * @param command The command to check (e.g., 'claude', 'copilot')
 * @returns Promise resolving to availability status
 */
export async function checkCliAvailability(command: string): Promise<{ available: boolean; error?: string }> {
  return new Promise((resolve) => {
    // Use 'where' on Windows, 'which' on Unix
    const checkCommand = process.platform === 'win32' ? 'where' : 'which';

    const child = spawn(checkCommand, [command], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // Set a timeout to avoid hanging
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ available: false, error: `Timeout checking for ${command} CLI` });
    }, 5000);

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({ available: false, error: `Failed to check ${command} CLI: ${error.message}` });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 && stdout.trim().length > 0) {
        resolve({ available: true });
      } else {
        resolve({
          available: false,
          error: `${command} CLI not found. Please install it and ensure it's in your PATH.`,
        });
      }
    });
  });
}

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
