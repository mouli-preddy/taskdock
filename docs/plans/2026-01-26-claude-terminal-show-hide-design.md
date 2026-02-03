# Claude Terminal Show/Hide Checkbox Design

**Date:** 2026-01-26
**Status:** Approved

## Overview

Add a "Show Terminal" checkbox to the AI Code Review dialog when using Claude Terminal provider. When unchecked (default), run Claude in the background without displaying a terminal, reducing resource usage and keeping the user on their current view.

## Requirements

- Add "Show Terminal" checkbox to AI Review dialog
- Checkbox only visible when Claude Terminal provider is selected
- Default: unchecked (background mode)
- When unchecked: run `claude --dangerously-skip-permissions -p "<prompt>"` via `child_process.spawn()`
- When checked: current behavior (show terminal)
- Add progress indicator in AI Comments Panel for all providers

## Design

### 1. New Headless Executor

**New file:** `src/main/ai/executors/claude-headless-executor.ts`

This executor will:
- Implement the same `ReviewExecutor` interface as other executors
- Use `child_process.spawn()` to run `claude --dangerously-skip-permissions -p "<prompt>"`
- Write prompt to file (same as terminal executor for safety)
- Poll for completion file (same pattern as terminal executor)
- Read results from `output/review.json` and `output/walkthrough.json`

Key difference from terminal executor: No PTY, no terminal session created, runs silently in background.

### 2. Dialog UI Changes

**File:** `src/renderer/app.ts` (in `showAIReviewDialog()`)

Changes:
- Add "Show Terminal" checkbox HTML after the provider dropdown
- Checkbox is hidden by default, only shown when `claude-terminal` is selected
- Add event listener on provider dropdown to toggle checkbox visibility
- Pass `showTerminal` boolean in the review request

```
Provider: [Claude Terminal ▼]
☐ Show Terminal          ← New checkbox, only visible for claude-terminal
```

**Request object change:** Add `showTerminal?: boolean` to `AIReviewRequest` interface.

### 3. Executor Service Routing

**File:** `src/main/ai/review-executor-service.ts`

Changes to `getExecutor()` logic:
- When provider is `claude-terminal`:
  - If `showTerminal` is true → return `ClaudeTerminalExecutor` (current behavior)
  - If `showTerminal` is false → return new `ClaudeHeadlessExecutor`

This keeps the provider selection simple in the UI while routing to the appropriate executor based on the checkbox.

### 4. Progress Indicator in AI Comments Panel

**File:** `src/renderer/components/ai-comments-panel.ts`

Changes:
- Add a `showProgress(message: string)` method that displays a loading state
- Add a `hideProgress()` method to remove it when review completes
- Loading state: spinner icon + status text (e.g., "Running AI review...")
- Position at top of comments panel, replaces/precedes comment list

**File:** `src/renderer/app.ts`

Changes to `startAIReview()`:
- After calling `aiStartReview()`, immediately show progress in comments panel
- On `review-complete` or error event, hide progress
- This applies to ALL providers, not just headless

### 5. UI Flow Changes

**File:** `src/renderer/app.ts` (in `startAIReview()`)

Current behavior: When `claude-terminal` is selected, it switches UI to terminals section.

New behavior:
- If `showTerminal` is true → switch to terminals section (current behavior)
- If `showTerminal` is false → stay on current view, show progress in comments panel

This means users can continue viewing the PR/diff while the review runs in background.

## Files Changed

| File | Change |
|------|--------|
| `src/main/ai/executors/claude-headless-executor.ts` | **New file** - Headless executor using `spawn()` |
| `src/main/ai/review-executor-service.ts` | Route to headless executor when `showTerminal: false` |
| `src/renderer/app.ts` | Add checkbox UI, pass `showTerminal` in request, conditional terminal switch, show progress |
| `src/renderer/components/ai-comments-panel.ts` | Add `showProgress()`/`hideProgress()` methods |
| `src/shared/types.ts` (or wherever `AIReviewRequest` is) | Add `showTerminal?: boolean` property |
| `src/main/preload.ts` + `src/main/preload.cjs` | Update if IPC signature changes (likely no change needed) |

## Data Flow

```
Dialog (showTerminal: false)
  → IPC → AIReviewService
  → ReviewExecutorService routes to ClaudeHeadlessExecutor
  → spawn('claude', ['--dangerously-skip-permissions', '-p', promptFile])
  → polls for completion → reads results → emits events
```
