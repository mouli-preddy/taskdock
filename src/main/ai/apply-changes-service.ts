/**
 * Apply Changes Service
 * Manages queue of comment-based fixes and executes them via AI agents
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import type { ApplyChangeItem, ApplyChangesQueueState } from '../../shared/types.js';
import type { ConsoleReviewSettings } from '../../shared/terminal-types.js';
import { getLogger } from '../services/logger-service.js';

const LOG_CATEGORY = 'ApplyChangesService';

export interface ApplyChangesProgressEvent {
  prId: number;
  itemId: string;
  status: ApplyChangeItem['status'];
  message?: string;
  commitSha?: string;
  errorMessage?: string;
}

export interface QueueItemRequest {
  prId: number;
  source: 'ado' | 'ai';
  sourceId: string;
  filePath: string;
  lineNumber: number;
  commentContent: string;
  customMessage: string;
}

export interface PRMetadata {
  org: string;
  project: string;
  repository: string;
  sourceBranch: string;
}

export class ApplyChangesService extends EventEmitter {
  private queues: Map<number, ApplyChangesQueueState> = new Map();
  private contextDirs: Map<number, string> = new Map();
  private worktreePaths: Map<number, string> = new Map();
  private prTitles: Map<number, string> = new Map();
  private prMetadata: Map<number, PRMetadata> = new Map();
  private hasLinkedRepo: Map<number, boolean> = new Map();
  private settings: ConsoleReviewSettings | null = null;

  constructor() {
    super();
  }

  setSettings(settings: ConsoleReviewSettings): void {
    this.settings = settings;
  }

  /**
   * Initialize queue for a PR - loads from disk if exists
   */
  async initializeForPR(
    prId: number,
    contextDir: string,
    worktreePath: string | undefined,
    prTitle: string,
    prMetadata?: PRMetadata,
    hasLinkedRepo?: boolean
  ): Promise<ApplyChangesQueueState> {
    const logger = getLogger();
    this.contextDirs.set(prId, contextDir);
    if (worktreePath) {
      this.worktreePaths.set(prId, worktreePath);
    }
    this.prTitles.set(prId, prTitle);
    if (prMetadata) {
      this.prMetadata.set(prId, prMetadata);
    }
    this.hasLinkedRepo.set(prId, hasLinkedRepo ?? !!worktreePath);

    // Try to load existing queue
    const existing = await this.loadQueue(prId);
    if (existing) {
      // Reset any "running" items to "pending" (app may have crashed)
      for (const item of existing.items) {
        if (item.status === 'running') {
          item.status = 'pending';
        }
      }
      existing.isProcessing = false;
      existing.currentItemId = null;
      this.queues.set(prId, existing);
      logger.info(LOG_CATEGORY, 'Loaded existing queue', { prId, itemCount: existing.items.length });
      return existing;
    }

    // Create empty queue
    const queue: ApplyChangesQueueState = {
      items: [],
      isPaused: false,
      isProcessing: false,
      currentItemId: null,
      lastUpdated: new Date().toISOString(),
    };
    this.queues.set(prId, queue);
    return queue;
  }

  /**
   * Get queue state for a PR
   */
  getQueueState(prId: number): ApplyChangesQueueState | null {
    return this.queues.get(prId) || null;
  }

  /**
   * Queue a new item
   */
  async queueItem(request: QueueItemRequest): Promise<string> {
    const logger = getLogger();
    const queue = this.queues.get(request.prId);
    if (!queue) {
      throw new Error(`Queue not initialized for PR ${request.prId}`);
    }

    const item: ApplyChangeItem = {
      id: uuidv4(),
      prId: request.prId,
      source: request.source,
      sourceId: request.sourceId,
      filePath: request.filePath,
      lineNumber: request.lineNumber,
      commentContent: request.commentContent,
      customMessage: request.customMessage,
      status: 'pending',
      queuedAt: new Date().toISOString(),
    };

    queue.items.push(item);
    await this.persistState(request.prId);
    logger.info(LOG_CATEGORY, 'Item queued', { prId: request.prId, itemId: item.id });

    // Auto-start processing if not paused and not already processing
    if (!queue.isPaused && !queue.isProcessing) {
      this.processNext(request.prId);
    }

    return item.id;
  }

  /**
   * Remove an item from the queue
   */
  async removeItem(prId: number, itemId: string): Promise<void> {
    const queue = this.queues.get(prId);
    if (!queue) return;

    queue.items = queue.items.filter(i => i.id !== itemId);
    await this.persistState(prId);
  }

  /**
   * Pause the queue
   */
  async pauseQueue(prId: number): Promise<void> {
    const queue = this.queues.get(prId);
    if (!queue) return;

    queue.isPaused = true;
    await this.persistState(prId);
  }

  /**
   * Resume the queue
   */
  async resumeQueue(prId: number): Promise<void> {
    const queue = this.queues.get(prId);
    if (!queue) return;

    queue.isPaused = false;
    await this.persistState(prId);

    // Start processing if not already
    if (!queue.isProcessing) {
      this.processNext(prId);
    }
  }

  /**
   * Retry a failed item
   */
  async retryItem(prId: number, itemId: string): Promise<void> {
    const queue = this.queues.get(prId);
    if (!queue) return;

    const item = queue.items.find(i => i.id === itemId);
    if (!item || item.status !== 'failed') return;

    item.status = 'pending';
    item.errorMessage = undefined;
    item.startedAt = undefined;
    item.completedAt = undefined;

    queue.isPaused = false;
    await this.persistState(prId);

    if (!queue.isProcessing) {
      this.processNext(prId);
    }
  }

  /**
   * Skip a failed item
   */
  async skipItem(prId: number, itemId: string): Promise<void> {
    const queue = this.queues.get(prId);
    if (!queue) return;

    const item = queue.items.find(i => i.id === itemId);
    if (!item) return;

    item.status = 'skipped';
    item.completedAt = new Date().toISOString();

    queue.isPaused = false;
    await this.persistState(prId);

    this.emitProgress(prId, item);

    if (!queue.isProcessing) {
      this.processNext(prId);
    }
  }

  /**
   * Clear completed/skipped/failed items
   */
  async clearCompleted(prId: number): Promise<void> {
    const queue = this.queues.get(prId);
    if (!queue) return;

    queue.items = queue.items.filter(i =>
      i.status === 'pending' || i.status === 'running'
    );
    await this.persistState(prId);
  }

  /**
   * Check if Apply Changes is available for a PR
   */
  canApplyChanges(prId: number): { canApply: boolean; reason?: string } {
    // Apply is available if repo is linked (worktree will be created on demand)
    if (this.hasLinkedRepo.get(prId)) {
      return { canApply: true };
    }
    return { canApply: false, reason: 'No linked repository found for this PR' };
  }

  // ==================== Private Methods ====================

  private async processNext(prId: number): Promise<void> {
    const logger = getLogger();
    const queue = this.queues.get(prId);
    if (!queue || queue.isPaused || queue.isProcessing) return;

    const nextItem = queue.items.find(i => i.status === 'pending');
    if (!nextItem) {
      logger.info(LOG_CATEGORY, 'No more items to process', { prId });
      return;
    }

    queue.isProcessing = true;
    queue.currentItemId = nextItem.id;
    nextItem.status = 'running';
    nextItem.startedAt = new Date().toISOString();
    await this.persistState(prId);
    this.emitProgress(prId, nextItem);

    try {
      await this.executeChange(prId, nextItem);
      nextItem.status = 'success';
      nextItem.completedAt = new Date().toISOString();
      await this.persistState(prId);
      this.emitProgress(prId, nextItem);
      logger.info(LOG_CATEGORY, 'Item completed successfully', { prId, itemId: nextItem.id });

      // Continue to next item
      queue.isProcessing = false;
      queue.currentItemId = null;
      this.processNext(prId);
    } catch (error: any) {
      logger.error(LOG_CATEGORY, 'Item failed', { prId, itemId: nextItem.id, error: error.message });
      nextItem.status = 'failed';
      nextItem.errorMessage = error.message;
      nextItem.completedAt = new Date().toISOString();
      queue.isPaused = true; // Pause on failure
      queue.isProcessing = false;
      queue.currentItemId = null;
      await this.persistState(prId);
      this.emitProgress(prId, nextItem);
    }
  }

  private async executeChange(prId: number, item: ApplyChangeItem): Promise<void> {
    const logger = getLogger();
    let worktreePath = this.worktreePaths.get(prId);
    const contextDir = this.contextDirs.get(prId);
    const prTitle = this.prTitles.get(prId) || `PR #${prId}`;
    const metadata = this.prMetadata.get(prId);

    if (!contextDir) {
      throw new Error('Context not initialized');
    }

    // Create worktree on demand if needed
    if (!worktreePath && metadata && this.settings?.linkedRepositories?.length) {
      logger.info(LOG_CATEGORY, 'Creating worktree on demand', { prId, branch: metadata.sourceBranch });
      const { getWorktreeService } = await import('../git/worktree-service.js');
      const worktreeService = getWorktreeService(this.settings.linkedRepositories);
      const repoUrl = `https://dev.azure.com/${metadata.org}/${metadata.project}/_git/${metadata.repository}`;
      const repoMatch = worktreeService.findLocalRepo(repoUrl, metadata.repository);

      if (repoMatch) {
        // Check for existing worktree first
        const existingWorktree = worktreeService.findWorktreeForBranch(repoMatch.path, metadata.sourceBranch);
        if (existingWorktree) {
          worktreePath = existingWorktree.path;
          logger.info(LOG_CATEGORY, 'Found existing worktree', { worktreePath });
        } else {
          // Create new worktree
          const newWorktree = worktreeService.createWorktree(repoMatch.path, metadata.sourceBranch, prId);
          worktreePath = newWorktree.path;
          logger.info(LOG_CATEGORY, 'Created new worktree', { worktreePath });
        }
        this.worktreePaths.set(prId, worktreePath);
      }
    }

    if (!worktreePath) {
      throw new Error('No worktree available and could not create one');
    }

    if (!this.settings) {
      throw new Error('Settings not initialized');
    }

    // Create run directory for this item
    const runDir = path.join(contextDir, 'apply-changes', 'runs', item.id);
    fs.mkdirSync(runDir, { recursive: true });

    // Build the prompt
    const sentinelPath = path.join(runDir, 'sentinel.json');
    const prompt = this.buildPrompt(item, worktreePath, prId, prTitle, runDir);
    const promptPath = path.join(runDir, 'prompt.md');
    fs.writeFileSync(promptPath, prompt, 'utf-8');

    logger.info(LOG_CATEGORY, 'Executing change', {
      prId,
      itemId: item.id,
      provider: this.settings.applyChanges.provider,
      worktreePath,
      sentinelPath,
    });

    // Start the terminal session
    const { getTerminalManager } = await import('../terminal/terminal-manager.js');
    const terminalManager = getTerminalManager();

    const sessionId = terminalManager.createSession({
      prId,
      organization: '',
      project: '',
      label: `Apply: ${item.filePath}:${item.lineNumber}`,
      workingDir: worktreePath,
      contextPath: contextDir,
      outputPath: runDir,
      prompt,
      cliCommand: this.settings.applyChanges.provider.includes('copilot') ? 'copilot' : 'claude',
    });

    logger.info(LOG_CATEGORY, 'Terminal session started', { prId, itemId: item.id, sessionId });

    // Poll for sentinel file
    const timeoutMs = this.settings.applyChanges.timeoutMinutes * 60 * 1000;
    const startTime = Date.now();
    const pollInterval = 2000;

    while (Date.now() - startTime < timeoutMs) {
      if (fs.existsSync(sentinelPath)) {
        const sentinelContent = fs.readFileSync(sentinelPath, 'utf-8');
        const sentinel = JSON.parse(sentinelContent);

        if (sentinel.status === 'success') {
          // Store commit ID and summary from sentinel file
          if (sentinel.commitId) {
            item.commitSha = sentinel.commitId;
            logger.info(LOG_CATEGORY, 'Fix applied and committed', {
              prId,
              itemId: item.id,
              commitSha: item.commitSha,
            });
          } else {
            logger.info(LOG_CATEGORY, 'Fix completed with no changes needed', {
              prId,
              itemId: item.id,
            });
          }
          // Store summary (if provided)
          if (sentinel.summary) {
            item.summary = sentinel.summary;
          }
          return;
        } else {
          // Store summary even on failure to show what the LLM attempted
          if (sentinel.summary) {
            item.summary = sentinel.summary;
          }
          throw new Error(sentinel.message || 'Fix failed');
        }
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Timeout after ${this.settings.applyChanges.timeoutMinutes} minutes`);
  }

  private buildPrompt(
    item: ApplyChangeItem,
    repoPath: string,
    prId: number,
    prTitle: string,
    runDir: string
  ): string {
    const sentinelPath = path.join(runDir, 'sentinel.json');

    // Truncate comment for commit message (max 100 chars)
    const truncatedComment = item.commentContent.length > 100
      ? item.commentContent.substring(0, 100) + '...'
      : item.commentContent;

    return `You are fixing code based on a review comment.

## Context
- Repository: ${repoPath}
- File: ${item.filePath}
- Line: ${item.lineNumber}
- PR: #${prId} - ${prTitle}

## Review Comment
${item.commentContent}

## Additional Instructions
${item.customMessage || 'None provided'}

## Your Task
1. Read the file and understand the context around line ${item.lineNumber}
2. Implement the fix suggested in the review comment
3. Make minimal, focused changes - only what's needed to address the comment
4. Do NOT make unrelated improvements or refactors

## Git Commit Instructions
IMPORTANT: After making changes, you MUST commit them yourself using git commands.

If changes were made:
1. Stage the files you modified using: git add <file1> <file2> ...
2. Create a commit with this format:
   git commit -m "fix(PR #${prId}): ${truncatedComment.replace(/"/g, '\\"')}

   Applied from ${item.source} comment on ${item.filePath}:${item.lineNumber}

   ${item.customMessage ? 'Additional instructions: ' + item.customMessage : ''}"

3. Get the commit SHA using: git rev-parse HEAD
4. Write the commit SHA to the sentinel file (see below)

If NO changes were needed (code already correct):
- Do NOT create a commit
- Write sentinel file with empty commitId (see below)

## When Complete
Write your result to: ${sentinelPath}

If changes were made and committed:
{"status": "success", "message": "Fix applied successfully", "commitId": "<the commit SHA from git rev-parse HEAD>", "summary": "<brief summary of what you changed (1-2 sentences)>", "timestamp": "<ISO timestamp>"}

Example summary: "Updated error handling in login function to properly catch network errors. Added try-catch block and user-friendly error messages."

If NO changes were needed:
{"status": "success", "message": "No changes needed - code already correct", "commitId": "", "summary": "<explain why no changes were needed>", "timestamp": "<ISO timestamp>"}

Example summary: "The code already implements the requested validation. No changes required."

If you encountered an error:
{"status": "failed", "message": "<why you couldn't apply the fix>", "commitId": "", "summary": "<brief explanation of what went wrong>", "timestamp": "<ISO timestamp>"}

Example summary: "Could not locate the function mentioned in the comment. The file structure may have changed."
`;
  }

  // ==================== Persistence ====================

  private getQueuePath(prId: number): string | null {
    const contextDir = this.contextDirs.get(prId);
    if (!contextDir) return null;
    return path.join(contextDir, 'apply-changes', 'queue.json');
  }

  private async loadQueue(prId: number): Promise<ApplyChangesQueueState | null> {
    const queuePath = this.getQueuePath(prId);
    if (!queuePath || !fs.existsSync(queuePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(queuePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async persistState(prId: number): Promise<void> {
    const queue = this.queues.get(prId);
    const queuePath = this.getQueuePath(prId);
    if (!queue || !queuePath) return;

    queue.lastUpdated = new Date().toISOString();

    const dir = path.dirname(queuePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2), 'utf-8');
  }

  // ==================== Events ====================

  private emitProgress(prId: number, item: ApplyChangeItem): void {
    const event: ApplyChangesProgressEvent = {
      prId,
      itemId: item.id,
      status: item.status,
      commitSha: item.commitSha,
      errorMessage: item.errorMessage,
    };
    this.emit('progress', event);
  }

  onProgress(callback: (event: ApplyChangesProgressEvent) => void): void {
    this.on('progress', callback);
  }
}

// Singleton
let applyChangesServiceInstance: ApplyChangesService | null = null;

export function getApplyChangesService(): ApplyChangesService {
  if (!applyChangesServiceInstance) {
    applyChangesServiceInstance = new ApplyChangesService();
  }
  return applyChangesServiceInstance;
}

export function disposeApplyChangesService(): void {
  applyChangesServiceInstance = null;
}
