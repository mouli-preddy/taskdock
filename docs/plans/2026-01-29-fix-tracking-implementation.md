# Fix Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Track which comments (AI and ADO) have been fixed via the Apply button, persisting status to disk per PR and showing visual "Fixed" badges.

**Architecture:** New FixTrackerService persists fix state to `fixes.json` per PR. Hook into ApplyChangesService progress events to mark fixes on success. UI components track applying state and show badges for fixed comments.

**Tech Stack:** TypeScript, WebSocket IPC (Tauri bridge), existing AIStorageService patterns

---

## Task 1: Add Type Definitions

**Files:**
- Modify: `src/shared/ai-types.ts:412` (end of file)

**Step 1: Add the FixedComment and PRFixTracker types**

Add at the end of `src/shared/ai-types.ts`:

```typescript
// Fix tracking types
export interface FixedComment {
  commentId: string;           // ID of the comment (AI comment ID or ADO thread ID)
  commentType: 'ai' | 'ado';   // Whether it's an AI comment or ADO thread
  fixedAt: string;             // ISO timestamp when fixed
  filePath: string;            // File where fix was applied
  startLine: number;           // Line number where fix was applied
}

export interface PRFixTracker {
  prId: number;
  organization: string;
  project: string;
  fixes: FixedComment[];       // All fixes applied for this PR
  lastUpdated: string;         // ISO timestamp of last update
}
```

**Step 2: Update AIReviewComment interface to include fix status**

Find the `AIReviewComment` interface (around line 9) and add two optional fields after `adoThreadId`:

```typescript
export interface AIReviewComment {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  severity: 'critical' | 'warning' | 'suggestion' | 'praise';
  category: 'bug' | 'security' | 'performance' | 'style' | 'logic' | 'other';
  title: string;
  content: string;
  suggestedFix?: string;
  confidence: number;
  published: boolean;
  adoThreadId?: number;
  fixedByAI?: boolean;        // Whether this comment was fixed via Apply
  fixedAt?: string;           // When it was fixed
}
```

**Step 3: Verify file compiles**

Run: `npx tsc --noEmit src/shared/ai-types.ts`
Expected: No errors

**Step 4: Commit**

```bash
git add src/shared/ai-types.ts
git commit -m "feat(fix-tracking): add FixedComment and PRFixTracker types"
```

---

## Task 2: Create FixTrackerService

**Files:**
- Create: `src/main/ai/fix-tracker-service.ts`

**Step 1: Create the service file**

```typescript
/**
 * Fix Tracker Service
 * Tracks which comments (AI and ADO) have been fixed via the Apply mechanism
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { getAppDataPath } from '../utils/app-paths.js';
import type { FixedComment, PRFixTracker } from '../../shared/ai-types.js';
import { getLogger } from '../services/logger-service.js';

const LOG_CATEGORY = 'FixTrackerService';

class FixTrackerService {
  private getBasePath(): string {
    return path.join(getAppDataPath(), 'reviews');
  }

  /**
   * Sanitize path components to prevent directory traversal
   */
  private sanitizePath(component: string): string {
    return component.replace(/[<>:"/\\|?*]/g, '_');
  }

  /**
   * Get the path to a PR's fix tracker file
   */
  private getFixTrackerPath(prId: number, org: string, project: string): string {
    return path.join(
      this.getBasePath(),
      this.sanitizePath(org),
      this.sanitizePath(project),
      prId.toString(),
      'fixes.json'
    );
  }

  /**
   * Ensure the directory exists
   */
  private async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  /**
   * Load fix tracker for a PR
   */
  async loadFixTracker(prId: number, org: string, project: string): Promise<PRFixTracker> {
    const filePath = this.getFixTrackerPath(prId, org, project);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as PRFixTracker;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Return empty tracker
        return {
          prId,
          organization: org,
          project,
          fixes: [],
          lastUpdated: new Date().toISOString(),
        };
      }
      throw error;
    }
  }

  /**
   * Mark a comment as fixed (called when apply succeeds)
   */
  async markFixed(
    prId: number,
    org: string,
    project: string,
    fix: FixedComment
  ): Promise<void> {
    const logger = getLogger();
    const tracker = await this.loadFixTracker(prId, org, project);

    // Check if already marked (prevent duplicates)
    const existing = tracker.fixes.find(
      f => f.commentId === fix.commentId && f.commentType === fix.commentType
    );

    if (existing) {
      logger.info(LOG_CATEGORY, 'Comment already marked as fixed', {
        prId,
        commentId: fix.commentId,
        commentType: fix.commentType,
      });
      return;
    }

    tracker.fixes.push(fix);
    tracker.lastUpdated = new Date().toISOString();

    // Persist to disk
    const filePath = this.getFixTrackerPath(prId, org, project);
    const dir = path.dirname(filePath);
    await this.ensureDir(dir);
    await fs.writeFile(filePath, JSON.stringify(tracker, null, 2), 'utf-8');

    logger.info(LOG_CATEGORY, 'Marked comment as fixed', {
      prId,
      commentId: fix.commentId,
      commentType: fix.commentType,
    });
  }

  /**
   * Check if a specific comment is fixed
   */
  isFixed(
    commentId: string,
    commentType: 'ai' | 'ado',
    tracker: PRFixTracker
  ): boolean {
    return tracker.fixes.some(
      f => f.commentId === commentId && f.commentType === commentType
    );
  }

  /**
   * Get all fixed comment IDs for quick lookup
   */
  getFixedIds(tracker: PRFixTracker, commentType: 'ai' | 'ado'): Set<string> {
    return new Set(
      tracker.fixes
        .filter(f => f.commentType === commentType)
        .map(f => f.commentId)
    );
  }
}

// Singleton instance
let fixTrackerServiceInstance: FixTrackerService | null = null;

export function getFixTrackerService(): FixTrackerService {
  if (!fixTrackerServiceInstance) {
    fixTrackerServiceInstance = new FixTrackerService();
  }
  return fixTrackerServiceInstance;
}
```

**Step 2: Verify file compiles**

Run: `npx tsc --noEmit src/main/ai/fix-tracker-service.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/main/ai/fix-tracker-service.ts
git commit -m "feat(fix-tracking): add FixTrackerService for persisting fix state"
```

---

## Task 3: Add RPC Handlers to Bridge

**Files:**
- Modify: `src-backend/bridge.ts`

**Step 1: Import the service**

After line 23 (`import { getApplyChangesService...`), add:

```typescript
import { getFixTrackerService } from '../src/main/ai/fix-tracker-service.js';
```

**Step 2: Add RPC handlers in handleRpc function**

Find the `handleRpc` function and add these cases before the `default` case:

```typescript
    // Fix Tracker API
    case 'fix-tracker:load':
      return getFixTrackerService().loadFixTracker(params[0], params[1], params[2]);

    case 'fix-tracker:mark-fixed':
      return getFixTrackerService().markFixed(params[0], params[1], params[2], params[3]);
```

**Step 3: Verify file compiles**

Run: `npx tsc --noEmit src-backend/bridge.ts`
Expected: No errors

**Step 4: Commit**

```bash
git add src-backend/bridge.ts
git commit -m "feat(fix-tracking): add RPC handlers for fix tracker service"
```

---

## Task 4: Add Tauri API Methods

**Files:**
- Modify: `src/renderer/tauri-api.ts`

**Step 1: Add fix tracker methods**

After line 491 (`subscribe('apply-changes:progress', callback),`), add before the closing brace:

```typescript

  // Fix Tracker API
  fixTrackerLoad: (prId: number, org: string, project: string) =>
    invoke('fix-tracker:load', prId, org, project),
  fixTrackerMarkFixed: (prId: number, org: string, project: string, fix: any) =>
    invoke('fix-tracker:mark-fixed', prId, org, project, fix),
```

**Step 2: Verify file compiles**

Run: `npx tsc --noEmit src/renderer/tauri-api.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/renderer/tauri-api.ts
git commit -m "feat(fix-tracking): expose fix tracker API to renderer"
```

---

## Task 5: Add CSS Styles for Fixed Badge

**Files:**
- Modify: `src/renderer/styles/ai-review.css`

**Step 1: Add fixed badge styles**

Add at the end of the file:

```css
/* Fixed Badge */
.ai-comment-fixed-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  background: #107c1020;
  color: #107c10;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
}

.ai-comment-fixed-badge svg {
  width: 12px;
  height: 12px;
}

/* Apply button states */
.apply-ai-btn.applying {
  opacity: 0.7;
  cursor: not-allowed;
}

.apply-ai-btn.fixed {
  opacity: 0.7;
  cursor: default;
  color: #107c10;
}

/* ADO thread fixed badge */
.thread-fixed-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  background: #107c1020;
  color: #107c10;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
}

.thread-fixed-badge svg {
  width: 12px;
  height: 12px;
}
```

**Step 2: Commit**

```bash
git add src/renderer/styles/ai-review.css
git commit -m "feat(fix-tracking): add CSS styles for fixed badges"
```

---

## Task 6: Update AI Comments Panel

**Files:**
- Modify: `src/renderer/components/ai-comments-panel.ts`

**Step 1: Add state tracking for applying comments**

After line 65 (`private expandedApplyCommentId: string | null = null;`), add:

```typescript
  private applyingCommentIds: Set<string> = new Set();
  private fixedCommentIds: Set<string> = new Set();
```

**Step 2: Add methods to manage apply states**

After the `setCanApply` method (around line 103), add:

```typescript
  setApplyingComment(commentId: string, isApplying: boolean): void {
    if (isApplying) {
      this.applyingCommentIds.add(commentId);
    } else {
      this.applyingCommentIds.delete(commentId);
    }
    this.render();
  }

  setFixedComments(fixedIds: Set<string>): void {
    this.fixedCommentIds = fixedIds;
    this.render();
  }

  markCommentFixed(commentId: string): void {
    this.fixedCommentIds.add(commentId);
    this.applyingCommentIds.delete(commentId);
    this.render();
  }
```

**Step 3: Update renderComment method to show apply states**

Find the `renderComment` method (around line 434). Replace the apply button section (inside `ai-comment-actions`) with:

```typescript
            ${this.canApply ? (() => {
              const isApplying = this.applyingCommentIds.has(comment.id);
              const isFixed = this.fixedCommentIds.has(comment.id) || comment.fixedByAI;
              if (isFixed) {
                return `
                  <button class="btn btn-sm btn-ghost apply-ai-btn fixed" data-id="${comment.id}" disabled>
                    Fixed
                  </button>
                `;
              } else if (isApplying) {
                return `
                  <button class="btn btn-sm btn-ghost apply-ai-btn applying" data-id="${comment.id}" disabled>
                    Applying...
                  </button>
                `;
              } else {
                return `
                  <button class="btn btn-sm btn-ghost apply-ai-btn" data-id="${comment.id}" title="Apply this fix">
                    Apply
                  </button>
                `;
              }
            })() : ''}
```

**Step 4: Add fixed badge after published badge**

In the `renderComment` method, after the published badge section (around line 455), add:

```typescript
          ${(this.fixedCommentIds.has(comment.id) || comment.fixedByAI) ? `
            <span class="ai-comment-fixed-badge" title="Fixed via AI${comment.fixedAt ? ` on ${new Date(comment.fixedAt).toLocaleDateString()}` : ''}">
              ${iconHtml(Check, { size: 12 })}
              Fixed
            </span>
          ` : ''}
```

**Step 5: Commit**

```bash
git add src/renderer/components/ai-comments-panel.ts
git commit -m "feat(fix-tracking): add apply states and fixed badge to AI comments panel"
```

---

## Task 7: Update ADO Comments Panel

**Files:**
- Modify: `src/renderer/components/comments-panel.ts`

**Step 1: Import Check icon**

Update the import line at the top to include `Check`:

```typescript
import { iconHtml, MessageSquare, File, X, Check } from '../utils/icons.js';
```

**Step 2: Add state tracking for applying threads**

After line 17 (`private expandedApplyThreadId: number | null = null;`), add:

```typescript
  private applyingThreadIds: Set<number> = new Set();
  private fixedThreadIds: Set<string> = new Set();
```

**Step 3: Add methods to manage apply states**

After the `setCanApply` method (around line 48), add:

```typescript
  setApplyingThread(threadId: number, isApplying: boolean): void {
    if (isApplying) {
      this.applyingThreadIds.add(threadId);
    } else {
      this.applyingThreadIds.delete(threadId);
    }
    this.render();
  }

  setFixedThreads(fixedIds: Set<string>): void {
    this.fixedThreadIds = fixedIds;
    this.render();
  }

  markThreadFixed(threadId: number): void {
    this.fixedThreadIds.add(threadId.toString());
    this.applyingThreadIds.delete(threadId);
    this.render();
  }
```

**Step 4: Update renderThread to show apply states**

In the `renderThread` method, find the Apply button section (around line 165). Replace it with:

```typescript
          ${this.canApply && thread.threadContext?.filePath ? (() => {
            const isApplying = this.applyingThreadIds.has(thread.id);
            const isFixed = this.fixedThreadIds.has(thread.id.toString());
            if (isFixed) {
              return `
                <button class="btn btn-sm btn-ghost apply-btn fixed" data-thread-id="${thread.id}" disabled>
                  Fixed
                </button>
              `;
            } else if (isApplying) {
              return `
                <button class="btn btn-sm btn-ghost apply-btn applying" data-thread-id="${thread.id}" disabled>
                  Applying...
                </button>
              `;
            } else {
              return `
                <button class="btn btn-sm btn-ghost apply-btn" data-thread-id="${thread.id}">Apply</button>
              `;
            }
          })() : ''}
```

**Step 5: Add fixed badge in thread header**

In the `renderThread` method, after the thread status span (around line 148), add:

```typescript
          ${this.fixedThreadIds.has(thread.id.toString()) ? `
            <span class="thread-fixed-badge" title="Fixed via AI">
              ${iconHtml(Check, { size: 12 })}
              Fixed
            </span>
          ` : ''}
```

**Step 6: Commit**

```bash
git add src/renderer/components/comments-panel.ts
git commit -m "feat(fix-tracking): add apply states and fixed badge to ADO comments panel"
```

---

## Task 8: Wire Up Fix Tracking in App

**Files:**
- Modify: `src/renderer/app.ts`

**Step 1: Add state for tracking comment to queue item mapping**

Find the class properties section and add:

```typescript
  // Fix tracking: map source comment IDs to queue item IDs
  private commentToQueueItemMap: Map<string, { itemId: string; source: 'ai' | 'ado'; filePath: string; startLine: number }> = new Map();
```

**Step 2: Update the apply callback for AI comments to track state**

Find where `this.aiCommentsPanel.onApply` is set up. Update it to:

```typescript
    this.aiCommentsPanel.onApply(async (comment, customMessage) => {
      const state = this.getCurrentPRState();
      if (!state) return;

      // Mark as applying immediately
      this.aiCommentsPanel.setApplyingComment(comment.id, true);

      const content = `${comment.title}\n\n${comment.content}${comment.suggestedFix ? `\n\nSuggested fix:\n${comment.suggestedFix}` : ''}`;

      try {
        const itemId = await window.electronAPI.applyChangesQueue({
          prId: state.prId,
          source: 'ai',
          sourceId: comment.id,
          filePath: comment.filePath,
          lineNumber: comment.startLine,
          commentContent: content,
          customMessage,
        });

        // Track the mapping
        this.commentToQueueItemMap.set(itemId, {
          itemId,
          source: 'ai',
          filePath: comment.filePath,
          startLine: comment.startLine,
        });

        document.getElementById('reviewScreen')?.classList.add('apply-changes-open');
        await this.refreshApplyChangesState(state.prId);
        Toast.show('Added to apply queue', 'success');
      } catch (error) {
        this.aiCommentsPanel.setApplyingComment(comment.id, false);
        Toast.show('Failed to queue fix', 'error');
      }
    });
```

**Step 3: Update the apply callback for ADO comments to track state**

Find where `this.commentsPanel.onApply` is set up. Update it to:

```typescript
    this.commentsPanel.onApply(async (threadId, content, filePath, line, customMessage) => {
      const state = this.getCurrentPRState();
      if (!state) return;

      // Mark as applying immediately
      this.commentsPanel.setApplyingThread(threadId, true);

      try {
        const itemId = await window.electronAPI.applyChangesQueue({
          prId: state.prId,
          source: 'ado',
          sourceId: threadId.toString(),
          filePath,
          lineNumber: line,
          commentContent: content,
          customMessage,
        });

        // Track the mapping
        this.commentToQueueItemMap.set(itemId, {
          itemId,
          source: 'ado',
          filePath,
          startLine: line,
        });

        document.getElementById('reviewScreen')?.classList.add('apply-changes-open');
        await this.refreshApplyChangesState(state.prId);
        Toast.show('Added to apply queue', 'success');
      } catch (error) {
        this.commentsPanel.setApplyingThread(threadId, false);
        Toast.show('Failed to queue fix', 'error');
      }
    });
```

**Step 4: Update the onApplyChangesProgress handler to mark fixes**

Find where `window.electronAPI.onApplyChangesProgress` is set up. Update it to:

```typescript
    window.electronAPI.onApplyChangesProgress(async (event) => {
      const state = this.getCurrentPRState();
      if (!state || event.prId !== state.prId) return;

      // Find the mapping for this queue item
      const mapping = this.commentToQueueItemMap.get(event.itemId);

      if (event.status === 'success' && mapping) {
        // Mark as fixed in the fix tracker
        try {
          await window.electronAPI.fixTrackerMarkFixed(
            event.prId,
            state.organization,
            state.project,
            {
              commentId: mapping.source === 'ai'
                ? this.findSourceIdByQueueItem(event.itemId, 'ai')
                : this.findSourceIdByQueueItem(event.itemId, 'ado'),
              commentType: mapping.source,
              fixedAt: new Date().toISOString(),
              filePath: mapping.filePath,
              startLine: mapping.startLine,
            }
          );

          // Update UI
          if (mapping.source === 'ai') {
            const sourceId = this.findSourceIdByQueueItem(event.itemId, 'ai');
            if (sourceId) {
              this.aiCommentsPanel.markCommentFixed(sourceId);
            }
          } else {
            const sourceId = this.findSourceIdByQueueItem(event.itemId, 'ado');
            if (sourceId) {
              this.commentsPanel.markThreadFixed(parseInt(sourceId));
            }
          }
        } catch (error) {
          console.error('Failed to mark comment as fixed:', error);
        }

        // Clean up mapping
        this.commentToQueueItemMap.delete(event.itemId);
      } else if (event.status === 'failed') {
        // Reset applying state on failure
        if (mapping) {
          if (mapping.source === 'ai') {
            const sourceId = this.findSourceIdByQueueItem(event.itemId, 'ai');
            if (sourceId) {
              this.aiCommentsPanel.setApplyingComment(sourceId, false);
            }
          } else {
            const sourceId = this.findSourceIdByQueueItem(event.itemId, 'ado');
            if (sourceId) {
              this.commentsPanel.setApplyingThread(parseInt(sourceId), false);
            }
          }
          this.commentToQueueItemMap.delete(event.itemId);
        }
      }

      // Existing refresh logic
      await this.refreshApplyChangesState(state.prId);
    });
```

**Step 5: Add helper method to find source ID by queue item**

Add this helper method to the class:

```typescript
  private findSourceIdByQueueItem(itemId: string, source: 'ai' | 'ado'): string | null {
    // Look through the queue state to find the sourceId
    const queueState = this.applyChangesPanel.getState().queueState;
    if (!queueState) return null;

    const item = queueState.items.find(i => i.id === itemId && i.source === source);
    return item?.sourceId || null;
  }
```

**Step 6: Load fix tracker when PR loads**

Find where the PR is loaded and the panels are initialized. Add after loading the PR state:

```typescript
      // Load fix tracker and apply to panels
      const fixTracker = await window.electronAPI.fixTrackerLoad(
        state.prId,
        state.organization,
        state.project
      );

      const aiFixedIds = new Set(
        fixTracker.fixes
          .filter((f: any) => f.commentType === 'ai')
          .map((f: any) => f.commentId)
      );
      const adoFixedIds = new Set(
        fixTracker.fixes
          .filter((f: any) => f.commentType === 'ado')
          .map((f: any) => f.commentId)
      );

      this.aiCommentsPanel.setFixedComments(aiFixedIds);
      this.commentsPanel.setFixedThreads(adoFixedIds);
```

**Step 7: Commit**

```bash
git add src/renderer/app.ts
git commit -m "feat(fix-tracking): wire up fix tracking in main app"
```

---

## Task 9: Manual Testing

**Testing Checklist:**

1. **Apply AI comment fix**
   - Click Apply on an AI comment
   - Verify button shows "Applying..."
   - Wait for success
   - Verify button shows "Fixed" and green badge appears
   - Refresh app, verify badge persists

2. **Apply ADO thread fix**
   - Click Apply on an ADO thread
   - Verify button shows "Applying..."
   - Wait for success
   - Verify button shows "Fixed" and green badge appears
   - Refresh app, verify badge persists

3. **Failed fix**
   - Queue a fix that will fail (e.g., invalid file path)
   - Verify button returns to "Apply" on failure
   - Verify no badge appears

4. **Switch PRs**
   - Apply a fix on PR #1
   - Switch to PR #2
   - Switch back to PR #1
   - Verify fixed badge still appears

5. **Multiple fixes**
   - Apply multiple fixes in sequence
   - Verify each gets tracked independently
   - Verify all badges persist after app restart

**Step 1: Run the app**

Run: `npm run dev`

**Step 2: Test each scenario above**

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(fix-tracking): address issues found during testing"
```

---

## Summary

This plan implements fix tracking in 9 tasks:

1. **Task 1**: Add type definitions (FixedComment, PRFixTracker)
2. **Task 2**: Create FixTrackerService for persistence
3. **Task 3**: Add RPC handlers to bridge
4. **Task 4**: Add Tauri API methods for renderer
5. **Task 5**: Add CSS styles for fixed badges
6. **Task 6**: Update AI comments panel with apply states
7. **Task 7**: Update ADO comments panel with apply states
8. **Task 8**: Wire up fix tracking in main app
9. **Task 9**: Manual testing

Each task is independently testable and commits are granular for easy review and rollback.
