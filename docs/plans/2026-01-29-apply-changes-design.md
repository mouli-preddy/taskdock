# Apply Changes Feature Design

## Overview

"Apply Changes" allows users to queue comment-based fixes that an AI agent executes in sequence using the PR's worktree. Each fix results in an automatic commit. The queue runs in the background with configurable terminal visibility.

**Key behaviors:**
- Works for both ADO comments and AI-generated review comments
- AI agent interprets the comment content and makes appropriate changes
- Simple inline text input for additional user instructions
- One commit per successful fix
- Auto-advances on success, pauses on failure for user decision
- Configurable provider (Claude SDK/Terminal, Copilot SDK/Terminal)
- Queue state persisted to disk for reconstruction

## Data Model

### New Types (`src/shared/types.ts`)

```typescript
interface ApplyChangeItem {
  id: string;
  prId: number;
  source: 'ado' | 'ai';
  sourceId: string;           // ADO threadId or AI comment id
  filePath: string;
  lineNumber: number;
  commentContent: string;     // Full comment text for AI
  customMessage: string;      // User's additional instructions
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  commitSha?: string;         // Set on success
  errorMessage?: string;      // Set on failure
  queuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

interface ApplyChangesQueueState {
  items: ApplyChangeItem[];
  isPaused: boolean;          // True when paused on failure
  isProcessing: boolean;
  currentItemId: string | null;
}
```

### Settings (`src/shared/terminal-types.ts`)

```typescript
interface ConsoleReviewSettings {
  // ... existing settings

  applyChanges: {
    provider: 'claude-sdk' | 'claude-terminal' | 'copilot-sdk' | 'copilot-terminal';
    showTerminal: boolean;        // Only applies to terminal providers
    commitAfterEach: boolean;     // default: true
    timeoutMinutes: number;       // default: 5
    autoResumeOnSuccess: boolean; // default: true
  };
}
```

## UI Components

### "Apply Changes" Button & Input

Added to both `CommentsPanel` and `AICommentsPanel` for each comment:

- Small "Apply" button appears next to comments (only when repo signature matches a registered repo)
- On click, an inline text input slides out with placeholder "Additional instructions (optional)..."
- "Queue" button confirms and adds to queue, "x" cancels
- Input supports Enter to queue, Escape to cancel

### ApplyChangesPanel

New right-side collapsible panel (`src/renderer/components/apply-changes-panel.ts`):

**Header:**
- "Apply Changes" title
- Pause/resume button
- Clear completed button
- Close button

**Status bar:**
- Shows "Processing 2 of 5" or "Paused - fix failed" with progress

**Queue list items show:**
- File path with line number (e.g., `src/utils/helper.ts:42`)
- Truncated comment preview (~50 chars, expandable on hover)
- Custom message in italics if present
- Status icon: pending, running (animated), success, failed, skipped
- Commit SHA link on success
- Error message on failure

**Failed item actions:**
- Retry, Skip, Cancel Queue buttons appear when paused

**Empty state:**
- "No changes queued. Click 'Apply' on any comment to get started."

## Backend Service Architecture

### ApplyChangesService (`src/main/ai/apply-changes-service.ts`)

```typescript
class ApplyChangesService {
  private queues: Map<number, ApplyChangesQueueState>;

  // Persistence
  private getQueuePath(prId: number): string;
  private saveQueue(prId: number): Promise<void>;
  private loadQueue(prId: number): Promise<ApplyChangesQueueState | null>;
  async initializeForPR(prId: number, contextDir: string): Promise<ApplyChangesQueueState>;
  private async persistState(prId: number): Promise<void>;

  // Queue management
  queueItem(prId: number, item: Omit<ApplyChangeItem, 'id' | 'status' | 'queuedAt'>): string;
  removeItem(prId: number, itemId: string): void;
  pauseQueue(prId: number): void;
  resumeQueue(prId: number): void;
  retryItem(prId: number, itemId: string): void;
  skipItem(prId: number, itemId: string): void;
  clearCompleted(prId: number): void;

  // Processing
  private processNext(prId: number): Promise<void>;
  private executeChange(item: ApplyChangeItem, worktreePath: string): Promise<void>;
  private commitChange(worktreePath: string, item: ApplyChangeItem): Promise<string>;
}
```

### IPC Handlers (`src/main/ipc-handlers.ts`)

- `apply-changes:queue` - Add item to queue
- `apply-changes:remove` - Remove item from queue
- `apply-changes:pause` / `resume` / `retry` / `skip`
- `apply-changes:get-state` - Get current queue state for a PR
- `apply-changes:clear-completed`
- `apply-changes:can-apply` - Check if Apply is available for a PR

## Persistence

Queue state persisted to the PR's context directory:

```
{contextDir}/apply-changes/
  queue.json          # Current queue state
  history.json        # Completed/failed items for reference
  runs/
    {itemId}/
      prompt.md       # The prompt sent to agent
      sentinel.json   # Written by agent when complete
```

### queue.json Structure

```json
{
  "items": [...],
  "isPaused": true,
  "isProcessing": false,
  "currentItemId": null,
  "lastUpdated": "2026-01-29T10:30:00Z"
}
```

On PR tab open, if `queue.json` exists with pending items, the panel auto-opens and shows the restored queue. Running items are reset to pending (in case app crashed mid-execution).

### Sentinel File Structure

```json
{
  "status": "success" | "failed",
  "message": "Fix applied successfully" | "Could not apply: <reason>",
  "filesChanged": ["src/utils/helper.ts"],
  "timestamp": "2026-01-29T10:30:00Z"
}
```

## Agent Prompt Design

### Prompt Template (Terminal Mode)

```
You are fixing code based on a review comment.

## Context
- Repository: {repoPath}
- File: {filePath}
- Line: {lineNumber}
- PR: #{prId} - {prTitle}

## Review Comment
{commentContent}

## Additional Instructions
{customMessage || "None provided"}

## Your Task
1. Read the file and understand the context around line {lineNumber}
2. Implement the fix suggested in the review comment
3. Make minimal, focused changes - only what's needed to address the comment
4. Do NOT make unrelated improvements or refactors

## When Complete
Write your result to: {sentinelPath}

On success:
{"status": "success", "message": "Fix applied successfully", "filesChanged": ["<files you modified>"], "timestamp": "<ISO timestamp>"}

On failure:
{"status": "failed", "message": "<why you couldn't apply the fix>", "filesChanged": [], "timestamp": "<ISO timestamp>"}
```

### Commit Message Format

```
fix(PR #{prId}): {truncatedComment}

Applied from {source} comment on {filePath}:{lineNumber}
{customMessage ? `\nAdditional context: ${customMessage}` : ''}
```

## Provider Configuration

- **SDK providers**: Run headless, `showTerminal` setting ignored
- **Terminal providers**: Respect `showTerminal` setting
- Uses same `ReviewExecutorService.getExecutor()` factory pattern

## Implementation Files

### New Files

| File | Purpose |
|------|---------|
| `src/main/ai/apply-changes-service.ts` | Queue management, agent execution, persistence |
| `src/renderer/components/apply-changes-panel.ts` | Queue panel UI component |
| `src/preload/apply-changes-api.ts` | IPC bridge for renderer |

### Modified Files

| File | Changes |
|------|---------|
| `src/shared/types.ts` | Add `ApplyChangeItem`, `ApplyChangesQueueState` types |
| `src/shared/terminal-types.ts` | Add `applyChanges` settings to `ConsoleReviewSettings` |
| `src/renderer/components/comments-panel.ts` | Add "Apply" button + inline input to ADO comments |
| `src/renderer/components/ai-comments-panel.ts` | Add "Apply" button + inline input to AI comments |
| `src/renderer/app.ts` | Initialize panel, handle panel toggle, wire up IPC |
| `src/renderer/styles/panels.css` | Styles for new panel and Apply button/input |
| `src/main/ipc-handlers.ts` | Add apply-changes IPC handlers |
| `src/main/main.ts` | Initialize ApplyChangesService |
| `src/preload/preload.ts` | Expose apply-changes API |
| `src/renderer/components/settings-panel.ts` | Add Apply Changes settings section |

## Integration Points

1. Panel toggles from app header (like existing panels)
2. Uses `WorktreeService` for worktree path resolution
3. Uses `ReviewExecutorService` for agent execution
4. Uses `ReviewContextService` for context directory paths
5. Emits events for UI updates via IPC
