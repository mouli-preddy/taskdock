# Apply Changes Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to queue review comment fixes that an AI agent executes sequentially with automatic commits.

**Architecture:** New ApplyChangesService manages a queue per PR, executes fixes via ReviewExecutorService, persists state to disk. UI adds "Apply" buttons to comment panels and a new ApplyChangesPanel for queue management.

**Tech Stack:** TypeScript, Electron IPC, existing ReviewExecutorService/WorktreeService patterns

---

## Task 1: Add Types to shared/types.ts

**Files:**
- Modify: `src/shared/types.ts:208` (end of file)

**Step 1: Add the ApplyChangeItem and ApplyChangesQueueState types**

```typescript
// Apply Changes types
export type ApplyChangeItemStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface ApplyChangeItem {
  id: string;
  prId: number;
  source: 'ado' | 'ai';
  sourceId: string;           // ADO threadId or AI comment id
  filePath: string;
  lineNumber: number;
  commentContent: string;     // Full comment text for AI
  customMessage: string;      // User's additional instructions
  status: ApplyChangeItemStatus;
  commitSha?: string;         // Set on success
  errorMessage?: string;      // Set on failure
  queuedAt: string;           // ISO date string
  startedAt?: string;
  completedAt?: string;
}

export interface ApplyChangesQueueState {
  items: ApplyChangeItem[];
  isPaused: boolean;
  isProcessing: boolean;
  currentItemId: string | null;
  lastUpdated: string;        // ISO date string
}
```

**Step 2: Verify file compiles**

Run: `npx tsc --noEmit src/shared/types.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(apply-changes): add ApplyChangeItem and queue state types"
```

---

## Task 2: Add Settings to terminal-types.ts

**Files:**
- Modify: `src/shared/terminal-types.ts:48` (after generatedFilePatterns)
- Modify: `src/shared/terminal-types.ts:58` (DEFAULT_CONSOLE_REVIEW_SETTINGS)

**Step 1: Add applyChanges settings interface**

After line 47 (`generatedFilePatterns: string[];`), add:

```typescript
  applyChanges: {
    provider: 'claude-sdk' | 'claude-terminal' | 'copilot-sdk' | 'copilot-terminal';
    showTerminal: boolean;
    timeoutMinutes: number;
  };
```

**Step 2: Add default values**

Update `DEFAULT_CONSOLE_REVIEW_SETTINGS` to include:

```typescript
  applyChanges: {
    provider: 'claude-terminal',
    showTerminal: false,
    timeoutMinutes: 5,
  },
```

**Step 3: Verify file compiles**

Run: `npx tsc --noEmit src/shared/terminal-types.ts`
Expected: No errors

**Step 4: Commit**

```bash
git add src/shared/terminal-types.ts
git commit -m "feat(apply-changes): add settings for provider and timeout"
```

---

## Task 3: Create ApplyChangesService (Core Queue Logic)

**Files:**
- Create: `src/main/ai/apply-changes-service.ts`

**Step 1: Create the service file with queue management**

```typescript
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

export class ApplyChangesService extends EventEmitter {
  private queues: Map<number, ApplyChangesQueueState> = new Map();
  private contextDirs: Map<number, string> = new Map();
  private worktreePaths: Map<number, string> = new Map();
  private prTitles: Map<number, string> = new Map();
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
    worktreePath: string,
    prTitle: string
  ): Promise<ApplyChangesQueueState> {
    const logger = getLogger();
    this.contextDirs.set(prId, contextDir);
    this.worktreePaths.set(prId, worktreePath);
    this.prTitles.set(prId, prTitle);

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
    const worktreePath = this.worktreePaths.get(prId);
    if (!worktreePath) {
      return { canApply: false, reason: 'No worktree available for this PR' };
    }
    return { canApply: true };
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
    const worktreePath = this.worktreePaths.get(prId);
    const contextDir = this.contextDirs.get(prId);
    const prTitle = this.prTitles.get(prId) || `PR #${prId}`;

    if (!worktreePath || !contextDir) {
      throw new Error('Worktree or context not initialized');
    }

    if (!this.settings) {
      throw new Error('Settings not initialized');
    }

    // Create run directory for this item
    const runDir = path.join(contextDir, 'apply-changes', 'runs', item.id);
    fs.mkdirSync(runDir, { recursive: true });

    // Build the prompt
    const prompt = this.buildPrompt(item, worktreePath, prId, prTitle, runDir);
    const promptPath = path.join(runDir, 'prompt.md');
    fs.writeFileSync(promptPath, prompt, 'utf-8');

    const sentinelPath = path.join(runDir, 'sentinel.json');

    logger.info(LOG_CATEGORY, 'Executing change', {
      prId,
      itemId: item.id,
      provider: this.settings.applyChanges.provider,
      worktreePath,
    });

    // Execute using the appropriate provider
    const { getReviewExecutorService } = await import('./review-executor-service.js');
    const executorService = getReviewExecutorService();
    const executor = executorService.getExecutor(this.settings.applyChanges.provider, {
      showTerminal: this.settings.applyChanges.showTerminal,
    });

    // For terminal-based execution, we need to wait for the sentinel file
    // For SDK-based, we execute directly
    // This is a simplified implementation - real implementation would handle both patterns

    // Poll for sentinel file with timeout
    const timeoutMs = this.settings.applyChanges.timeoutMinutes * 60 * 1000;
    const startTime = Date.now();
    const pollInterval = 2000;

    // For now, throw an error indicating this needs the full executor implementation
    // The actual execution will be implemented in a later task
    throw new Error('Executor integration not yet implemented - see Task 4');
  }

  private buildPrompt(
    item: ApplyChangeItem,
    repoPath: string,
    prId: number,
    prTitle: string,
    runDir: string
  ): string {
    const sentinelPath = path.join(runDir, 'sentinel.json');

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

## When Complete
Write your result to: ${sentinelPath}

On success:
{"status": "success", "message": "Fix applied successfully", "filesChanged": ["<files you modified>"], "timestamp": "<ISO timestamp>"}

On failure:
{"status": "failed", "message": "<why you couldn't apply the fix>", "filesChanged": [], "timestamp": "<ISO timestamp>"}
`;
  }

  private async commitChange(
    worktreePath: string,
    item: ApplyChangeItem,
    prId: number,
    filesChanged: string[]
  ): Promise<string> {
    const { execSync } = await import('child_process');

    // Stage changed files
    for (const file of filesChanged) {
      execSync(`git add "${file}"`, { cwd: worktreePath });
    }

    // Create commit message
    const truncatedComment = item.commentContent.substring(0, 50).replace(/\n/g, ' ');
    const commitMsg = `fix(PR #${prId}): ${truncatedComment}${item.commentContent.length > 50 ? '...' : ''}

Applied from ${item.source} comment on ${item.filePath}:${item.lineNumber}${item.customMessage ? `\nAdditional context: ${item.customMessage}` : ''}`;

    execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd: worktreePath });

    // Get commit SHA
    const sha = execSync('git rev-parse HEAD', { cwd: worktreePath }).toString().trim();
    return sha;
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
```

**Step 2: Verify file compiles**

Run: `npx tsc --noEmit src/main/ai/apply-changes-service.ts`
Expected: No errors (may need to fix imports)

**Step 3: Commit**

```bash
git add src/main/ai/apply-changes-service.ts
git commit -m "feat(apply-changes): add ApplyChangesService with queue management"
```

---

## Task 4: Add IPC Handlers to main.ts

**Files:**
- Modify: `src/main/main.ts`

**Step 1: Import the service at the top of the file**

After line 27 (`import { getPRFileCacheService } from './services/pr-file-cache-service.js';`), add:

```typescript
import { getApplyChangesService, disposeApplyChangesService } from './ai/apply-changes-service.js';
```

**Step 2: Add IPC handlers in setupIpcHandlers() function**

After the logger handlers (around line 1033), add:

```typescript
  // Apply Changes handlers
  const applyChangesService = getApplyChangesService();

  // Forward progress events to renderer
  applyChangesService.onProgress((event) => {
    mainWindow?.webContents.send('apply-changes:progress', event);
  });

  ipcMain.handle('apply-changes:initialize', async (
    _,
    prId: number,
    contextDir: string,
    worktreePath: string,
    prTitle: string
  ) => {
    const settings = store.get('consoleReview') as ConsoleReviewSettings;
    applyChangesService.setSettings(settings);
    return applyChangesService.initializeForPR(prId, contextDir, worktreePath, prTitle);
  });

  ipcMain.handle('apply-changes:get-state', async (_, prId: number) => {
    return applyChangesService.getQueueState(prId);
  });

  ipcMain.handle('apply-changes:queue', async (_, request: any) => {
    return applyChangesService.queueItem(request);
  });

  ipcMain.handle('apply-changes:remove', async (_, prId: number, itemId: string) => {
    return applyChangesService.removeItem(prId, itemId);
  });

  ipcMain.handle('apply-changes:pause', async (_, prId: number) => {
    return applyChangesService.pauseQueue(prId);
  });

  ipcMain.handle('apply-changes:resume', async (_, prId: number) => {
    return applyChangesService.resumeQueue(prId);
  });

  ipcMain.handle('apply-changes:retry', async (_, prId: number, itemId: string) => {
    return applyChangesService.retryItem(prId, itemId);
  });

  ipcMain.handle('apply-changes:skip', async (_, prId: number, itemId: string) => {
    return applyChangesService.skipItem(prId, itemId);
  });

  ipcMain.handle('apply-changes:clear-completed', async (_, prId: number) => {
    return applyChangesService.clearCompleted(prId);
  });

  ipcMain.handle('apply-changes:can-apply', async (_, prId: number) => {
    return applyChangesService.canApplyChanges(prId);
  });
```

**Step 3: Add dispose call in will-quit handler**

In the `app.on('will-quit', ...)` handler, add after `disposeWalkthroughService();`:

```typescript
  disposeApplyChangesService();
```

**Step 4: Verify file compiles**

Run: `npx tsc --noEmit src/main/main.ts`
Expected: No errors

**Step 5: Commit**

```bash
git add src/main/main.ts
git commit -m "feat(apply-changes): add IPC handlers for queue management"
```

---

## Task 5: Add Preload API

**Files:**
- Modify: `src/main/preload.ts`

**Step 1: Add Apply Changes IPC methods to electronAPI object**

After the logger API section (around line 343), add:

```typescript
  // Apply Changes API
  applyChangesInitialize: (prId: number, contextDir: string, worktreePath: string, prTitle: string) =>
    ipcRenderer.invoke('apply-changes:initialize', prId, contextDir, worktreePath, prTitle),
  applyChangesGetState: (prId: number) =>
    ipcRenderer.invoke('apply-changes:get-state', prId),
  applyChangesQueue: (request: any) =>
    ipcRenderer.invoke('apply-changes:queue', request),
  applyChangesRemove: (prId: number, itemId: string) =>
    ipcRenderer.invoke('apply-changes:remove', prId, itemId),
  applyChangesPause: (prId: number) =>
    ipcRenderer.invoke('apply-changes:pause', prId),
  applyChangesResume: (prId: number) =>
    ipcRenderer.invoke('apply-changes:resume', prId),
  applyChangesRetry: (prId: number, itemId: string) =>
    ipcRenderer.invoke('apply-changes:retry', prId, itemId),
  applyChangesSkip: (prId: number, itemId: string) =>
    ipcRenderer.invoke('apply-changes:skip', prId, itemId),
  applyChangesClearCompleted: (prId: number) =>
    ipcRenderer.invoke('apply-changes:clear-completed', prId),
  applyChangesCanApply: (prId: number) =>
    ipcRenderer.invoke('apply-changes:can-apply', prId),

  // Apply Changes event listener
  onApplyChangesProgress: (callback: (event: any) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: any) => callback(event);
    ipcRenderer.on('apply-changes:progress', handler);
    return () => ipcRenderer.removeListener('apply-changes:progress', handler);
  },
```

**Step 2: Add TypeScript interface declarations**

In the `ElectronAPI` interface, add:

```typescript
  // Apply Changes
  applyChangesInitialize: (prId: number, contextDir: string, worktreePath: string, prTitle: string) => Promise<any>;
  applyChangesGetState: (prId: number) => Promise<any>;
  applyChangesQueue: (request: any) => Promise<string>;
  applyChangesRemove: (prId: number, itemId: string) => Promise<void>;
  applyChangesPause: (prId: number) => Promise<void>;
  applyChangesResume: (prId: number) => Promise<void>;
  applyChangesRetry: (prId: number, itemId: string) => Promise<void>;
  applyChangesSkip: (prId: number, itemId: string) => Promise<void>;
  applyChangesClearCompleted: (prId: number) => Promise<void>;
  applyChangesCanApply: (prId: number) => Promise<{ canApply: boolean; reason?: string }>;
  onApplyChangesProgress: (callback: (event: any) => void) => () => void;
```

**Step 3: Verify file compiles**

Run: `npx tsc --noEmit src/main/preload.ts`
Expected: No errors

**Step 4: Commit**

```bash
git add src/main/preload.ts
git commit -m "feat(apply-changes): expose IPC API to renderer via preload"
```

---

## Task 6: Create ApplyChangesPanel UI Component

**Files:**
- Create: `src/renderer/components/apply-changes-panel.ts`

**Step 1: Create the panel component**

```typescript
/**
 * Apply Changes Panel
 * Displays queue of comment-based fixes with status and controls
 */

import type { ApplyChangeItem, ApplyChangesQueueState } from '../../shared/types.js';
import { escapeHtml } from '../utils/html-utils.js';
import {
  iconHtml,
  X,
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  Trash2,
  Check,
  AlertCircle,
  Clock,
  Loader,
  GitCommit,
} from '../utils/icons.js';

export interface ApplyChangesPanelState {
  queueState: ApplyChangesQueueState | null;
  canApply: boolean;
}

export class ApplyChangesPanel {
  private container: HTMLElement;
  private queueState: ApplyChangesQueueState | null = null;
  private canApply: boolean = false;

  // Callbacks
  private closeCallback?: () => void;
  private pauseCallback?: () => void;
  private resumeCallback?: () => void;
  private retryCallback?: (itemId: string) => void;
  private skipCallback?: (itemId: string) => void;
  private removeCallback?: (itemId: string) => void;
  private clearCompletedCallback?: () => void;
  private navigateCallback?: (filePath: string, line: number) => void;

  constructor() {
    this.container = document.getElementById('applyChangesPanel')!;
    this.render();
  }

  setContainer(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  onPause(callback: () => void): void {
    this.pauseCallback = callback;
  }

  onResume(callback: () => void): void {
    this.resumeCallback = callback;
  }

  onRetry(callback: (itemId: string) => void): void {
    this.retryCallback = callback;
  }

  onSkip(callback: (itemId: string) => void): void {
    this.skipCallback = callback;
  }

  onRemove(callback: (itemId: string) => void): void {
    this.removeCallback = callback;
  }

  onClearCompleted(callback: () => void): void {
    this.clearCompletedCallback = callback;
  }

  onNavigate(callback: (filePath: string, line: number) => void): void {
    this.navigateCallback = callback;
  }

  setState(state: ApplyChangesPanelState): void {
    this.queueState = state.queueState;
    this.canApply = state.canApply;
    this.render();
  }

  getState(): ApplyChangesPanelState {
    return {
      queueState: this.queueState,
      canApply: this.canApply,
    };
  }

  updateItem(itemId: string, updates: Partial<ApplyChangeItem>): void {
    if (!this.queueState) return;
    const item = this.queueState.items.find(i => i.id === itemId);
    if (item) {
      Object.assign(item, updates);
      this.render();
    }
  }

  clear(): void {
    this.queueState = null;
    this.render();
  }

  private render(): void {
    if (!this.container) return;

    const items = this.queueState?.items || [];
    const isPaused = this.queueState?.isPaused || false;
    const isProcessing = this.queueState?.isProcessing || false;

    const pendingCount = items.filter(i => i.status === 'pending').length;
    const runningCount = items.filter(i => i.status === 'running').length;
    const completedCount = items.filter(i => i.status === 'success' || i.status === 'skipped').length;
    const failedCount = items.filter(i => i.status === 'failed').length;

    const statusText = isPaused && failedCount > 0
      ? 'Paused - fix failed'
      : isProcessing
        ? `Processing ${runningCount + completedCount} of ${items.length}`
        : pendingCount > 0
          ? `${pendingCount} pending`
          : 'Queue empty';

    this.container.innerHTML = `
      <div class="apply-changes-header">
        <div class="apply-changes-title">
          ${iconHtml(GitCommit, { size: 20 })}
          <span>Apply Changes</span>
          <span class="apply-changes-count">${items.length}</span>
        </div>
        <div class="apply-changes-header-actions">
          ${items.length > 0 ? `
            ${isPaused ? `
              <button class="btn btn-sm btn-ghost resume-btn" title="Resume">
                ${iconHtml(Play, { size: 14 })}
              </button>
            ` : `
              <button class="btn btn-sm btn-ghost pause-btn" title="Pause">
                ${iconHtml(Pause, { size: 14 })}
              </button>
            `}
            ${completedCount > 0 ? `
              <button class="btn btn-sm btn-ghost clear-completed-btn" title="Clear completed">
                ${iconHtml(Trash2, { size: 14 })}
              </button>
            ` : ''}
          ` : ''}
          <button class="btn btn-icon close-apply-panel-btn" title="Close">
            ${iconHtml(X, { size: 20 })}
          </button>
        </div>
      </div>

      <div class="apply-changes-status">
        <span class="status-text">${statusText}</span>
        ${isProcessing ? '<div class="status-spinner"></div>' : ''}
      </div>

      <div class="apply-changes-list">
        ${items.length === 0
          ? this.renderEmptyState()
          : items.map(item => this.renderItem(item)).join('')
        }
      </div>
    `;

    this.attachEventListeners();
  }

  private renderEmptyState(): string {
    return `
      <div class="apply-changes-empty">
        ${iconHtml(GitCommit, { size: 48, strokeWidth: 1.5 })}
        <p>No changes queued</p>
        <p class="apply-changes-empty-hint">Click "Apply" on any comment to get started</p>
      </div>
    `;
  }

  private renderItem(item: ApplyChangeItem): string {
    const fileName = item.filePath.split('/').pop() || item.filePath;
    const truncatedComment = item.commentContent.substring(0, 50).replace(/\n/g, ' ');

    const statusIcon = this.getStatusIcon(item.status);
    const statusClass = item.status;

    return `
      <div class="apply-change-item ${statusClass}" data-item-id="${item.id}">
        <div class="apply-change-item-header">
          <span class="apply-change-status-icon">${statusIcon}</span>
          <span class="apply-change-location"
                data-file="${item.filePath}"
                data-line="${item.lineNumber}">
            ${escapeHtml(fileName)}:${item.lineNumber}
          </span>
          ${item.status === 'pending' ? `
            <button class="btn btn-xs btn-ghost remove-item-btn" data-id="${item.id}" title="Remove">
              ${iconHtml(X, { size: 12 })}
            </button>
          ` : ''}
        </div>

        <div class="apply-change-preview" title="${escapeHtml(item.commentContent)}">
          ${escapeHtml(truncatedComment)}${item.commentContent.length > 50 ? '...' : ''}
        </div>

        ${item.customMessage ? `
          <div class="apply-change-custom-message">
            <em>${escapeHtml(item.customMessage)}</em>
          </div>
        ` : ''}

        ${item.status === 'success' && item.commitSha ? `
          <div class="apply-change-commit">
            ${iconHtml(Check, { size: 12 })}
            <span class="commit-sha">${item.commitSha.substring(0, 7)}</span>
          </div>
        ` : ''}

        ${item.status === 'failed' ? `
          <div class="apply-change-error">
            ${escapeHtml(item.errorMessage || 'Unknown error')}
          </div>
          <div class="apply-change-actions">
            <button class="btn btn-sm btn-ghost retry-btn" data-id="${item.id}">
              ${iconHtml(RotateCcw, { size: 14 })}
              Retry
            </button>
            <button class="btn btn-sm btn-ghost skip-btn" data-id="${item.id}">
              ${iconHtml(SkipForward, { size: 14 })}
              Skip
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  private getStatusIcon(status: ApplyChangeItem['status']): string {
    switch (status) {
      case 'pending':
        return iconHtml(Clock, { size: 14, class: 'status-pending' });
      case 'running':
        return iconHtml(Loader, { size: 14, class: 'status-running spinning' });
      case 'success':
        return iconHtml(Check, { size: 14, class: 'status-success' });
      case 'failed':
        return iconHtml(AlertCircle, { size: 14, class: 'status-failed' });
      case 'skipped':
        return iconHtml(SkipForward, { size: 14, class: 'status-skipped' });
      default:
        return '';
    }
  }

  private attachEventListeners(): void {
    // Close button
    this.container.querySelector('.close-apply-panel-btn')?.addEventListener('click', () => {
      this.closeCallback?.();
    });

    // Pause button
    this.container.querySelector('.pause-btn')?.addEventListener('click', () => {
      this.pauseCallback?.();
    });

    // Resume button
    this.container.querySelector('.resume-btn')?.addEventListener('click', () => {
      this.resumeCallback?.();
    });

    // Clear completed button
    this.container.querySelector('.clear-completed-btn')?.addEventListener('click', () => {
      this.clearCompletedCallback?.();
    });

    // Remove item buttons
    this.container.querySelectorAll('.remove-item-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const itemId = (btn as HTMLElement).dataset.id;
        if (itemId) this.removeCallback?.(itemId);
      });
    });

    // Retry buttons
    this.container.querySelectorAll('.retry-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.id;
        if (itemId) this.retryCallback?.(itemId);
      });
    });

    // Skip buttons
    this.container.querySelectorAll('.skip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.id;
        if (itemId) this.skipCallback?.(itemId);
      });
    });

    // Navigate to file location
    this.container.querySelectorAll('.apply-change-location').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const filePath = (el as HTMLElement).dataset.file;
        const line = parseInt((el as HTMLElement).dataset.line || '1');
        if (filePath) this.navigateCallback?.(filePath, line);
      });
    });
  }
}
```

**Step 2: Add required icons to icons.ts if missing**

Check and add these icons if not present: `Pause`, `RotateCcw`, `SkipForward`, `Trash2`, `Clock`, `Loader`, `GitCommit`

**Step 3: Verify file compiles**

Run: `npx tsc --noEmit src/renderer/components/apply-changes-panel.ts`
Expected: No errors (may need icon imports)

**Step 4: Commit**

```bash
git add src/renderer/components/apply-changes-panel.ts
git commit -m "feat(apply-changes): add ApplyChangesPanel UI component"
```

---

## Task 7: Add CSS Styles for Apply Changes

**Files:**
- Modify: `src/renderer/styles/panels.css` (or create `src/renderer/styles/apply-changes.css`)

**Step 1: Add styles for the panel and items**

```css
/* Apply Changes Panel */
.apply-changes-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.apply-changes-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.apply-changes-count {
  background: var(--bg-tertiary);
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
}

.apply-changes-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.apply-changes-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--bg-secondary);
  font-size: 13px;
  color: var(--text-secondary);
}

.status-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-color);
  border-top-color: var(--accent-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.apply-changes-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.apply-changes-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  color: var(--text-tertiary);
  text-align: center;
}

.apply-changes-empty-hint {
  font-size: 13px;
  margin-top: 8px;
}

/* Apply Change Item */
.apply-change-item {
  padding: 12px;
  margin-bottom: 8px;
  background: var(--bg-secondary);
  border-radius: 6px;
  border-left: 3px solid var(--border-color);
}

.apply-change-item.pending {
  border-left-color: var(--text-tertiary);
}

.apply-change-item.running {
  border-left-color: var(--accent-color);
  background: var(--bg-accent-subtle);
}

.apply-change-item.success {
  border-left-color: var(--success-color);
}

.apply-change-item.failed {
  border-left-color: var(--error-color);
  background: var(--bg-error-subtle);
}

.apply-change-item.skipped {
  border-left-color: var(--text-tertiary);
  opacity: 0.7;
}

.apply-change-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.apply-change-status-icon {
  display: flex;
  align-items: center;
}

.apply-change-status-icon .spinning {
  animation: spin 1s linear infinite;
}

.status-pending { color: var(--text-tertiary); }
.status-running { color: var(--accent-color); }
.status-success { color: var(--success-color); }
.status-failed { color: var(--error-color); }
.status-skipped { color: var(--text-tertiary); }

.apply-change-location {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--accent-color);
  cursor: pointer;
}

.apply-change-location:hover {
  text-decoration: underline;
}

.apply-change-preview {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.apply-change-custom-message {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 4px;
}

.apply-change-commit {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--success-color);
}

.commit-sha {
  font-family: var(--font-mono);
}

.apply-change-error {
  margin-top: 8px;
  padding: 8px;
  background: var(--bg-error);
  border-radius: 4px;
  font-size: 12px;
  color: var(--error-color);
}

.apply-change-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

/* Apply Button in Comments */
.apply-btn {
  padding: 2px 8px;
  font-size: 11px;
}

.apply-input-container {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
}

.apply-input {
  flex: 1;
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.apply-input::placeholder {
  color: var(--text-tertiary);
}

.apply-queue-btn {
  padding: 4px 8px;
  font-size: 11px;
}

.apply-cancel-btn {
  padding: 4px;
  font-size: 11px;
}
```

**Step 2: Import styles if creating new file**

If creating a new file, import it in the main styles.

**Step 3: Commit**

```bash
git add src/renderer/styles/
git commit -m "feat(apply-changes): add CSS styles for panel and items"
```

---

## Task 8: Add "Apply" Button to CommentsPanel

**Files:**
- Modify: `src/renderer/components/comments-panel.ts`

**Step 1: Add callback and state for apply functionality**

After the existing callbacks (around line 14), add:

```typescript
  private applyCallback?: (threadId: number, content: string, filePath: string, line: number, customMessage: string) => void;
  private canApply: boolean = false;
  private expandedApplyThreadId: number | null = null;
```

**Step 2: Add setter methods**

After `onScrollToLine`, add:

```typescript
  onApply(callback: (threadId: number, content: string, filePath: string, line: number, customMessage: string) => void) {
    this.applyCallback = callback;
  }

  setCanApply(canApply: boolean) {
    this.canApply = canApply;
    this.render();
  }
```

**Step 3: Modify renderThread to include Apply button**

In the `thread-actions` div, add after the reply button:

```typescript
          ${this.canApply && thread.threadContext?.filePath ? `
            <button class="btn btn-sm btn-ghost apply-btn" data-thread-id="${thread.id}">Apply</button>
          ` : ''}
```

**Step 4: Add apply input container after thread-actions**

```typescript
        ${this.canApply && thread.threadContext?.filePath ? `
          <div class="apply-input-container hidden" data-thread-id="${thread.id}">
            <input type="text" class="apply-input" placeholder="Additional instructions (optional)..." />
            <button class="btn btn-sm btn-primary apply-queue-btn" data-thread-id="${thread.id}">Queue</button>
            <button class="btn btn-sm btn-ghost apply-cancel-btn" data-thread-id="${thread.id}">
              ${iconHtml(X, { size: 12 })}
            </button>
          </div>
        ` : ''}
```

**Step 5: Add event listeners for apply buttons**

In `attachEventListeners`, add:

```typescript
    // Apply button click - show input
    this.listContainer.querySelectorAll('.apply-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const threadId = (btn as HTMLElement).dataset.threadId;
        const container = this.listContainer.querySelector(`.apply-input-container[data-thread-id="${threadId}"]`);
        container?.classList.remove('hidden');
        container?.querySelector('input')?.focus();
      });
    });

    // Apply queue button
    this.listContainer.querySelectorAll('.apply-queue-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const threadId = parseInt((btn as HTMLElement).dataset.threadId || '0');
        const thread = this.threads.find(t => t.id === threadId) || this.fileThreads.find(t => t.id === threadId);
        if (!thread || !this.applyCallback) return;

        const container = this.listContainer.querySelector(`.apply-input-container[data-thread-id="${threadId}"]`);
        const input = container?.querySelector('input') as HTMLInputElement;
        const customMessage = input?.value || '';

        const filePath = thread.threadContext?.filePath || '';
        const line = thread.threadContext?.rightFileStart?.line || thread.threadContext?.leftFileStart?.line || 1;
        const content = thread.comments.filter(c => c.commentType !== 'system' && !c.isDeleted)
          .map(c => c.content).join('\n\n');

        this.applyCallback(threadId, content, filePath, line, customMessage);

        // Hide input and clear
        container?.classList.add('hidden');
        if (input) input.value = '';
      });
    });

    // Apply cancel button
    this.listContainer.querySelectorAll('.apply-cancel-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const threadId = (btn as HTMLElement).dataset.threadId;
        const container = this.listContainer.querySelector(`.apply-input-container[data-thread-id="${threadId}"]`);
        container?.classList.add('hidden');
        const input = container?.querySelector('input') as HTMLInputElement;
        if (input) input.value = '';
      });
    });

    // Enter to queue, Escape to cancel
    this.listContainer.querySelectorAll('.apply-input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        const container = (input as HTMLElement).closest('.apply-input-container');
        if (e.key === 'Enter') {
          e.preventDefault();
          (container?.querySelector('.apply-queue-btn') as HTMLButtonElement)?.click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          (container?.querySelector('.apply-cancel-btn') as HTMLButtonElement)?.click();
        }
      });
    });
```

**Step 6: Commit**

```bash
git add src/renderer/components/comments-panel.ts
git commit -m "feat(apply-changes): add Apply button to ADO comments panel"
```

---

## Task 9: Add "Apply" Button to AICommentsPanel

**Files:**
- Modify: `src/renderer/components/ai-comments-panel.ts`

**Step 1: Add callback and state**

After existing callbacks (around line 62), add:

```typescript
  private applyCallback?: (comment: AIReviewComment, customMessage: string) => void;
  private canApply: boolean = false;
  private expandedApplyCommentId: string | null = null;
```

**Step 2: Add setter methods**

After `onSave`, add:

```typescript
  onApply(callback: (comment: AIReviewComment, customMessage: string) => void): void {
    this.applyCallback = callback;
  }

  setCanApply(canApply: boolean): void {
    this.canApply = canApply;
    this.render();
  }
```

**Step 3: Modify renderComment to include Apply button**

In the `ai-comment-actions` div, add before the dismiss button:

```typescript
            ${this.canApply ? `
              <button class="btn btn-sm btn-ghost apply-ai-btn" data-id="${comment.id}" title="Apply this fix">
                Apply
              </button>
            ` : ''}
```

**Step 4: Add apply input after ai-comment-footer**

```typescript
        ${this.canApply ? `
          <div class="apply-input-container hidden" data-comment-id="${comment.id}">
            <input type="text" class="apply-input" placeholder="Additional instructions (optional)..." />
            <button class="btn btn-sm btn-primary apply-queue-btn" data-id="${comment.id}">Queue</button>
            <button class="btn btn-sm btn-ghost apply-cancel-btn" data-id="${comment.id}">
              ${iconHtml(X, { size: 12 })}
            </button>
          </div>
        ` : ''}
```

**Step 5: Add event listeners**

In `attachEventListeners`, add:

```typescript
    // Apply AI comment button
    this.container.querySelectorAll('.apply-ai-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const commentId = (btn as HTMLElement).dataset.id;
        const container = this.container.querySelector(`.apply-input-container[data-comment-id="${commentId}"]`);
        container?.classList.remove('hidden');
        container?.querySelector('input')?.focus();
      });
    });

    // Apply queue button for AI comments
    this.container.querySelectorAll('.apply-input-container .apply-queue-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const commentId = (btn as HTMLElement).dataset.id;
        const comment = this.comments.find(c => c.id === commentId);
        if (!comment || !this.applyCallback) return;

        const container = this.container.querySelector(`.apply-input-container[data-comment-id="${commentId}"]`);
        const input = container?.querySelector('input') as HTMLInputElement;
        const customMessage = input?.value || '';

        this.applyCallback(comment, customMessage);

        container?.classList.add('hidden');
        if (input) input.value = '';
      });
    });

    // Apply cancel button for AI comments
    this.container.querySelectorAll('.apply-input-container .apply-cancel-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const commentId = (btn as HTMLElement).dataset.id;
        const container = this.container.querySelector(`.apply-input-container[data-comment-id="${commentId}"]`);
        container?.classList.add('hidden');
        const input = container?.querySelector('input') as HTMLInputElement;
        if (input) input.value = '';
      });
    });

    // Enter/Escape handlers for AI comment apply inputs
    this.container.querySelectorAll('.apply-input-container .apply-input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        const container = (input as HTMLElement).closest('.apply-input-container');
        if (e.key === 'Enter') {
          e.preventDefault();
          (container?.querySelector('.apply-queue-btn') as HTMLButtonElement)?.click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          (container?.querySelector('.apply-cancel-btn') as HTMLButtonElement)?.click();
        }
      });
    });
```

**Step 6: Commit**

```bash
git add src/renderer/components/ai-comments-panel.ts
git commit -m "feat(apply-changes): add Apply button to AI comments panel"
```

---

## Task 10: Wire Up ApplyChangesPanel in app.ts

**Files:**
- Modify: `src/renderer/app.ts`

**Step 1: Import ApplyChangesPanel**

Add to imports:

```typescript
import { ApplyChangesPanel, type ApplyChangesPanelState } from './components/apply-changes-panel.js';
```

**Step 2: Add to PRTabState interface**

Add to `PRTabState`:

```typescript
  // Apply Changes state
  applyChangesPanelState?: ApplyChangesPanelState;
```

**Step 3: Add panel instance**

After `walkthroughUI` declaration:

```typescript
  private applyChangesPanel: ApplyChangesPanel;
```

**Step 4: Initialize in constructor**

After `this.walkthroughUI = new WalkthroughUI();`:

```typescript
    this.applyChangesPanel = new ApplyChangesPanel();
```

**Step 5: Set up callbacks**

In an appropriate initialization method, add:

```typescript
    // Apply Changes Panel callbacks
    this.applyChangesPanel.onClose(() => {
      document.getElementById('reviewScreen')?.classList.remove('apply-changes-open');
    });

    this.applyChangesPanel.onPause(async () => {
      const state = this.getCurrentPRState();
      if (state) {
        await window.electronAPI.applyChangesPause(state.prId);
      }
    });

    this.applyChangesPanel.onResume(async () => {
      const state = this.getCurrentPRState();
      if (state) {
        await window.electronAPI.applyChangesResume(state.prId);
      }
    });

    this.applyChangesPanel.onRetry(async (itemId) => {
      const state = this.getCurrentPRState();
      if (state) {
        await window.electronAPI.applyChangesRetry(state.prId, itemId);
      }
    });

    this.applyChangesPanel.onSkip(async (itemId) => {
      const state = this.getCurrentPRState();
      if (state) {
        await window.electronAPI.applyChangesSkip(state.prId, itemId);
      }
    });

    this.applyChangesPanel.onRemove(async (itemId) => {
      const state = this.getCurrentPRState();
      if (state) {
        await window.electronAPI.applyChangesRemove(state.prId, itemId);
      }
    });

    this.applyChangesPanel.onClearCompleted(async () => {
      const state = this.getCurrentPRState();
      if (state) {
        await window.electronAPI.applyChangesClearCompleted(state.prId);
      }
    });

    this.applyChangesPanel.onNavigate((filePath, line) => {
      this.navigateToFile(filePath, line);
    });
```

**Step 6: Set up event listener for progress updates**

In `initAIListeners` or similar:

```typescript
    window.electronAPI.onApplyChangesProgress((event) => {
      const state = this.getCurrentPRState();
      if (state && event.prId === state.prId) {
        // Refresh queue state
        this.refreshApplyChangesState(state.prId);
      }
    });
```

**Step 7: Add helper method to refresh state**

```typescript
  private async refreshApplyChangesState(prId: number): Promise<void> {
    const queueState = await window.electronAPI.applyChangesGetState(prId);
    const canApply = (await window.electronAPI.applyChangesCanApply(prId)).canApply;
    this.applyChangesPanel.setState({ queueState, canApply });
  }
```

**Step 8: Wire up CommentsPanel apply callback**

```typescript
    this.commentsPanel.onApply(async (threadId, content, filePath, line, customMessage) => {
      const state = this.getCurrentPRState();
      if (!state) return;

      await window.electronAPI.applyChangesQueue({
        prId: state.prId,
        source: 'ado',
        sourceId: threadId.toString(),
        filePath,
        lineNumber: line,
        commentContent: content,
        customMessage,
      });

      // Open the panel
      document.getElementById('reviewScreen')?.classList.add('apply-changes-open');
      await this.refreshApplyChangesState(state.prId);
      Toast.show('Added to apply queue', 'success');
    });
```

**Step 9: Wire up AICommentsPanel apply callback**

```typescript
    this.aiCommentsPanel.onApply(async (comment, customMessage) => {
      const state = this.getCurrentPRState();
      if (!state) return;

      const content = `${comment.title}\n\n${comment.content}${comment.suggestedFix ? `\n\nSuggested fix:\n${comment.suggestedFix}` : ''}`;

      await window.electronAPI.applyChangesQueue({
        prId: state.prId,
        source: 'ai',
        sourceId: comment.id,
        filePath: comment.filePath,
        lineNumber: comment.startLine,
        commentContent: content,
        customMessage,
      });

      document.getElementById('reviewScreen')?.classList.add('apply-changes-open');
      await this.refreshApplyChangesState(state.prId);
      Toast.show('Added to apply queue', 'success');
    });
```

**Step 10: Commit**

```bash
git add src/renderer/app.ts
git commit -m "feat(apply-changes): wire up ApplyChangesPanel in main app"
```

---

## Task 11: Add Panel Container to HTML and Initialize canApply

**Files:**
- Modify: `src/renderer/index.html`

**Step 1: Add panel container in the review screen**

After the existing panels (ai-comments-panel, walkthroughs-panel), add:

```html
<div id="applyChangesPanel" class="side-panel apply-changes-panel"></div>
```

**Step 2: Add toggle button in header (if desired)**

This is optional - the panel opens automatically when items are queued.

**Step 3: Initialize canApply when loading PR**

In the PR loading logic, after worktree is determined, call:

```typescript
const canApplyResult = await window.electronAPI.applyChangesCanApply(prId);
this.commentsPanel.setCanApply(canApplyResult.canApply);
this.aiCommentsPanel.setCanApply(canApplyResult.canApply);
```

**Step 4: Commit**

```bash
git add src/renderer/index.html src/renderer/app.ts
git commit -m "feat(apply-changes): add panel container and initialize canApply state"
```

---

## Task 12: Add Settings UI for Apply Changes

**Files:**
- Modify: `src/renderer/components/settings-view.ts`

**Step 1: Add Apply Changes section to settings form**

In the render method, add a new section:

```typescript
      <div class="settings-section">
        <h3>Apply Changes</h3>
        <div class="settings-group">
          <label>
            <span>AI Provider</span>
            <select id="applyChangesProvider">
              <option value="claude-sdk" ${settings.applyChanges?.provider === 'claude-sdk' ? 'selected' : ''}>Claude SDK</option>
              <option value="claude-terminal" ${settings.applyChanges?.provider === 'claude-terminal' ? 'selected' : ''}>Claude Terminal</option>
              <option value="copilot-sdk" ${settings.applyChanges?.provider === 'copilot-sdk' ? 'selected' : ''}>Copilot SDK</option>
              <option value="copilot-terminal" ${settings.applyChanges?.provider === 'copilot-terminal' ? 'selected' : ''}>Copilot Terminal</option>
            </select>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" id="applyChangesShowTerminal" ${settings.applyChanges?.showTerminal ? 'checked' : ''}>
            <span>Show terminal window (terminal providers only)</span>
          </label>
          <label>
            <span>Timeout per fix (minutes)</span>
            <input type="number" id="applyChangesTimeout" value="${settings.applyChanges?.timeoutMinutes || 5}" min="1" max="30">
          </label>
        </div>
      </div>
```

**Step 2: Add save handlers**

In the save logic, include:

```typescript
      applyChanges: {
        provider: (document.getElementById('applyChangesProvider') as HTMLSelectElement).value,
        showTerminal: (document.getElementById('applyChangesShowTerminal') as HTMLInputElement).checked,
        timeoutMinutes: parseInt((document.getElementById('applyChangesTimeout') as HTMLInputElement).value) || 5,
      },
```

**Step 3: Commit**

```bash
git add src/renderer/components/settings-view.ts
git commit -m "feat(apply-changes): add settings UI for provider and timeout"
```

---

## Task 13: Implement Executor Integration (Terminal Mode)

**Files:**
- Modify: `src/main/ai/apply-changes-service.ts`

**Step 1: Implement executeChange with sentinel file polling**

Replace the placeholder `executeChange` method with full implementation:

```typescript
  private async executeChange(prId: number, item: ApplyChangeItem): Promise<void> {
    const logger = getLogger();
    const worktreePath = this.worktreePaths.get(prId);
    const contextDir = this.contextDirs.get(prId);
    const prTitle = this.prTitles.get(prId) || `PR #${prId}`;

    if (!worktreePath || !contextDir) {
      throw new Error('Worktree or context not initialized');
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

    const sessionId = await terminalManager.createSession({
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

    // Poll for sentinel file
    const timeoutMs = this.settings.applyChanges.timeoutMinutes * 60 * 1000;
    const startTime = Date.now();
    const pollInterval = 2000;

    while (Date.now() - startTime < timeoutMs) {
      if (fs.existsSync(sentinelPath)) {
        const sentinelContent = fs.readFileSync(sentinelPath, 'utf-8');
        const sentinel = JSON.parse(sentinelContent);

        if (sentinel.status === 'success') {
          // Commit the changes
          if (sentinel.filesChanged && sentinel.filesChanged.length > 0) {
            const commitSha = await this.commitChange(worktreePath, item, prId, sentinel.filesChanged);
            item.commitSha = commitSha;
          }
          return;
        } else {
          throw new Error(sentinel.message || 'Fix failed');
        }
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Timeout after ${this.settings.applyChanges.timeoutMinutes} minutes`);
  }
```

**Step 2: Verify and test**

Run the app and test the full flow.

**Step 3: Commit**

```bash
git add src/main/ai/apply-changes-service.ts
git commit -m "feat(apply-changes): implement terminal executor integration"
```

---

## Summary

This plan covers:
1. **Tasks 1-2**: Type definitions and settings
2. **Tasks 3-5**: Backend service and IPC layer
3. **Tasks 6-7**: UI component and styles
4. **Tasks 8-9**: Apply buttons in comment panels
5. **Tasks 10-11**: Wiring in main app
6. **Task 12**: Settings UI
7. **Task 13**: Full executor integration

Each task is designed to be independently testable and commits are granular for easy review and rollback.
