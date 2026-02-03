# Fix Tracking for AI & ADO Comments - Design Document

**Created:** 2026-01-29
**Status:** Ready for Implementation

## Overview

Enable tracking of which comments (both AI-generated and ADO threads) have been fixed via the "Apply" button. When a fix is successfully applied, mark the comment as fixed, persist this to a file, and show a visual "Fixed" badge in the UI with a disabled Apply button.

## Goals

- Track which comments have been fixed via AI across app sessions
- Persist fix status per PR (not per review session)
- Show clear visual feedback when a comment has been fixed
- Prevent re-applying the same fix
- Support both AI comments and ADO threads with unified tracking

## Non-Goals

- Automatically detect if code was manually fixed without using Apply
- Track fixes outside of the Apply mechanism
- Sync fix status back to ADO/PR comments
- Version control or history of multiple fix attempts

---

## 1. Data Model & Storage

### Type Definitions

**New types in `src/shared/ai-types.ts`:**

```typescript
// Track applied fixes for a PR
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

**Update to `AIReviewComment` type:**

```typescript
export interface AIReviewComment {
  // ... existing fields ...
  fixedByAI?: boolean;        // Whether this comment was fixed via Apply
  fixedAt?: string;           // When it was fixed
}
```

### File Storage

**Path:** `.taskdock/reviews/{organization}/{project}/{prId}/fixes.json`

**Structure:**
```
.taskdock/
  reviews/
    {organization}/
      {project}/
        {prId}/
          fixes.json              ← New file
          review-sessions/
            {sessionId}/
              review.json
              walkthrough.json
```

**Why this approach?**
- Separate file keeps fix tracking independent from review sessions
- Per-PR basis allows loading fix status regardless of which review session is active
- Works for both AI comments and ADO threads with a unified structure
- Survives app restarts and session switches

---

## 2. UI Changes

### Visual Indicators

**For AI Comments Panel (`ai-comments-panel.ts`):**
- Add a "Fixed" badge next to the "Published" badge for fixed comments
- Badge appearance: Green checkmark with "Fixed" label (#107c10 color)
- Apply button shows different states based on fix status

**For ADO Comments Panel (`comments-panel.ts`):**
- Add a "Fixed" badge in the thread actions area for fixed threads
- Same visual styling as AI comments for consistency
- Apply button shows different states based on fix status

### UI States

| State | Apply Button | Badge | Behavior |
|-------|--------------|-------|----------|
| Not fixed | Enabled "Apply" | None | Can queue fix |
| Queued/Running | Disabled "Applying..." | None | Processing, wait |
| Fixed | Disabled "Fixed" | ✓ Fixed (green) | Cannot re-apply |
| Failed | Enabled "Apply" | None | Can retry |

### Rendering Changes

**Badge HTML:**
```html
<span class="ai-comment-fixed-badge" title="Fixed via AI on {date}">
  ✓ Fixed
</span>
```

**Apply Button States:**
```html
<!-- Not fixed -->
<button class="btn btn-sm btn-ghost apply-ai-btn" data-id="${comment.id}">
  Apply
</button>

<!-- Applying -->
<button class="btn btn-sm btn-ghost apply-ai-btn" data-id="${comment.id}" disabled>
  Applying...
</button>

<!-- Fixed -->
<button class="btn btn-sm btn-ghost apply-ai-btn" data-id="${comment.id}" disabled>
  Fixed
</button>
```

**CSS for badge:**
```css
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
```

---

## 3. Implementation Flow

### Complete Apply Flow

1. **Initial state**: Comment shows "Apply" button (enabled)

2. **User clicks "Apply" → enters custom message → clicks "Queue"**:
   - Fix gets queued via `applyChangesQueue` IPC call
   - Item is added to the queue with `status: 'pending'`
   - Button updates to "Applying..." (disabled)
   - Store mapping: `commentId → queueItemId`

3. **During execution**:
   - Item status changes to `status: 'running'`
   - Progress event emitted with `status: 'running'`
   - Button still shows "Applying..." (disabled)

4. **On completion**:

   **SUCCESS PATH**:
   - `ApplyChangesProgressEvent` emitted with:
     - `status: 'success'`
     - `commitSha` (the git commit hash)
   - **→ HOOK POINT: Mark as fixed here!**
   - Call `FixTrackerService.markFixed()`
   - Update `fixes.json` with the fixed comment
   - Update comment object: `fixedByAI = true`, `fixedAt = timestamp`
   - Re-render UI to show "Fixed" badge
   - Button shows "Fixed" (disabled)

   **FAILURE PATH**:
   - `ApplyChangesProgressEvent` emitted with:
     - `status: 'failed'`
     - `errorMessage`
   - **Do NOT mark as fixed**
   - Button returns to "Apply" (enabled)
   - User can retry

### Hook Integration Point

**In `src/renderer/app.ts`:**

```typescript
window.electronAPI.onApplyChangesProgress(async (event) => {
  const state = this.getCurrentPRState();
  if (!state || event.prId !== state.prId) return;

  // Find the comment that was being applied
  const { commentId, commentType } = this.findCommentByQueueItem(event.itemId);

  if (event.status === 'success' && commentId) {
    // Mark as fixed!
    await window.electronAPI.fixTrackerMarkFixed(
      event.prId,
      commentId,
      commentType,
      filePath,  // From the queue item
      startLine  // From the queue item
    );

    // Update the UI
    if (commentType === 'ai') {
      this.aiCommentsPanel.updateComment(commentId, {
        fixedByAI: true,
        fixedAt: new Date().toISOString()
      });
    } else {
      // Mark ADO thread as fixed in UI state
      this.markAdoThreadFixed(commentId);
    }
  }

  // Update button state based on status
  this.updateApplyButtonState(commentId, commentType, event.status);

  // Existing refresh logic
  await this.refreshApplyChangesState(state.prId);
});
```

---

## 4. Service Implementation

### New Service: FixTrackerService

**File:** `src/main/ai/fix-tracker-service.ts`

**Methods:**

```typescript
export class FixTrackerService {
  /**
   * Load fix tracker for a PR
   */
  async loadFixTracker(
    prId: number,
    org: string,
    project: string
  ): Promise<PRFixTracker>;

  /**
   * Mark a comment as fixed (called when apply succeeds)
   */
  async markFixed(
    prId: number,
    org: string,
    project: string,
    fix: FixedComment
  ): Promise<void>;

  /**
   * Check if a specific comment is fixed
   */
  isFixed(
    commentId: string,
    commentType: 'ai' | 'ado',
    tracker: PRFixTracker
  ): boolean;

  /**
   * Get all fixed comment IDs for quick lookup
   */
  getFixedIds(
    tracker: PRFixTracker,
    commentType: 'ai' | 'ado'
  ): Set<string>;

  /**
   * Get the file path for a PR's fix tracker
   */
  private getFixTrackerPath(
    prId: number,
    org: string,
    project: string
  ): string;
}
```

**Implementation Details:**

```typescript
async loadFixTracker(prId: number, org: string, project: string): Promise<PRFixTracker> {
  const filePath = this.getFixTrackerPath(prId, org, project);

  if (!fs.existsSync(filePath)) {
    // Create new tracker
    return {
      prId,
      organization: org,
      project,
      fixes: [],
      lastUpdated: new Date().toISOString()
    };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

async markFixed(prId: number, org: string, project: string, fix: FixedComment): Promise<void> {
  const tracker = await this.loadFixTracker(prId, org, project);

  // Check if already marked (prevent duplicates)
  const existing = tracker.fixes.find(
    f => f.commentId === fix.commentId && f.commentType === fix.commentType
  );

  if (!existing) {
    tracker.fixes.push(fix);
    tracker.lastUpdated = new Date().toISOString();

    // Persist to disk
    const filePath = this.getFixTrackerPath(prId, org, project);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(tracker, null, 2), 'utf-8');
  }
}

isFixed(commentId: string, commentType: 'ai' | 'ado', tracker: PRFixTracker): boolean {
  return tracker.fixes.some(
    f => f.commentId === commentId && f.commentType === commentType
  );
}

getFixedIds(tracker: PRFixTracker, commentType: 'ai' | 'ado'): Set<string> {
  return new Set(
    tracker.fixes
      .filter(f => f.commentType === commentType)
      .map(f => f.commentId)
  );
}
```

### IPC Handlers

**In `src/main/main.ts`:**

```typescript
// Fix Tracker handlers
const fixTrackerService = getFixTrackerService();

ipcMain.handle('fix-tracker:load', async (_, prId: number, org: string, project: string) => {
  return fixTrackerService.loadFixTracker(prId, org, project);
});

ipcMain.handle('fix-tracker:mark-fixed', async (_, prId: number, org: string, project: string, fix: any) => {
  return fixTrackerService.markFixed(prId, org, project, fix);
});
```

### Integration Points

1. **When PR loads**:
   - Load fix tracker: `loadFixTracker(prId, org, project)`
   - Pass fixed IDs to both AI and ADO panels
   - Panels render badges for fixed comments

2. **When Apply succeeds**:
   - Listen to `onApplyChangesProgress` event
   - If `status === 'success'`, call `markFixed()`
   - Update UI to show badge

3. **When rendering comments**:
   - Check if comment ID is in fixed set
   - Render "Fixed" badge and disabled button if fixed

---

## 5. Edge Cases & Testing

### Edge Cases

1. **Multiple fixes for same comment**:
   - Track only the first successful fix
   - Badge shows "Fixed" once, button stays disabled
   - Don't duplicate entries in `fixes.json` (check before adding)

2. **Fix tracking across sessions**:
   - Load `fixes.json` when switching PRs
   - Persist when switching away from PR
   - Fixed status survives app restart

3. **Comment no longer exists**:
   - Old fixes remain in `fixes.json` for history
   - Don't show badge if comment was deleted from ADO
   - Cleanup can be manual (future enhancement)

4. **Failed fixes**:
   - Do NOT mark as fixed on failure
   - Allow retry without affecting fixed status
   - Only mark fixed when `status === 'success'`

5. **Concurrent applies**:
   - Queue processes sequentially (existing behavior)
   - Each success event marks its specific comment
   - No race conditions due to sequential processing

6. **Fix tracking state management**:
   - Maintain `commentId → queueItemId` mapping to correlate progress events
   - Clear mapping after completion (success or failure)
   - Handle app restart: items in queue reset to pending, fixed status preserved

### Testing Checklist

- [ ] Apply AI comment fix → button shows "Applying..." then "Fixed" with badge
- [ ] Apply ADO thread fix → button shows "Applying..." then "Fixed" with badge
- [ ] Failed fix → verify button returns to "Apply", no badge
- [ ] Restart app → verify fixed badges persist
- [ ] Switch between PRs → verify correct fixed state per PR
- [ ] Apply button disabled during "Applying..." state
- [ ] Multiple reviews on same PR share fix tracking
- [ ] Queuing multiple fixes → each gets tracked independently
- [ ] Fix same comment twice → second attempt shows already fixed

---

## 6. Implementation Tasks

### Task 1: Create FixTrackerService
- Create `src/main/ai/fix-tracker-service.ts`
- Implement all methods (loadFixTracker, markFixed, isFixed, getFixedIds)
- Add singleton pattern and export getFixTrackerService()

### Task 2: Add IPC Handlers
- Add handlers in `src/main/main.ts` for fix-tracker operations
- Add preload API methods in `src/main/preload.ts`

### Task 3: Update Type Definitions
- Add FixedComment and PRFixTracker types to `src/shared/ai-types.ts`
- Add fixedByAI and fixedAt fields to AIReviewComment

### Task 4: Update AI Comments Panel
- Add fix state tracking (commentId → queueItemId mapping)
- Update rendering to show "Fixed" badge and button states
- Load fixed status when panel initializes

### Task 5: Update ADO Comments Panel
- Add fix state tracking (threadId → queueItemId mapping)
- Update rendering to show "Fixed" badge and button states
- Load fixed status when panel initializes

### Task 6: Wire Up in app.ts
- Load fix tracker when PR opens
- Listen to onApplyChangesProgress events
- Call markFixed on success
- Update panel UI states
- Maintain commentId → queueItemId mappings

### Task 7: Add CSS Styles
- Add styles for .ai-comment-fixed-badge
- Update button states styling (Applying..., Fixed)

### Task 8: Testing
- Manual testing of all scenarios
- Test app restart persistence
- Test PR switching
- Test concurrent fixes

---

## 7. Future Enhancements

- Clean up old fixes from deleted comments
- Export fix history as report
- Show fix history timeline in UI
- Auto-detect manual fixes outside of Apply
- Undo a fix (revert commit and remove from tracker)

---

## Summary

This design provides a complete solution for tracking which comments have been fixed via the Apply mechanism. The key points are:

1. **Per-PR storage** in `fixes.json` alongside review sessions
2. **Hook on success** by listening to `ApplyChangesProgressEvent` with `status: 'success'`
3. **Visual feedback** with "Fixed" badge and disabled button
4. **State management** during "Applying..." phase with disabled button
5. **Unified tracking** for both AI and ADO comments

The implementation integrates cleanly with the existing ApplyChangesService and doesn't require changes to the queue mechanism itself.
