# Console-Based AI Review with Git Worktrees

**Date:** 2026-01-24
**Status:** Approved

## Overview

Replace SDK-based AI review with a console-based approach that launches Claude Code from the terminal, providing full repository context via git worktrees for deeper, more thorough code reviews.

## Goals

1. Launch Claude Code CLI instead of using SDK directly
2. Copy PR data (files, diffs, comments) to a temporary folder
3. Let Claude Code use its internal Task tool for parallelization
4. Write results to JSON files with a GUID completion signal
5. Show active terminals in a new sidebar section
6. Support multiple repo base folders for discovery
7. Reuse or create git worktrees for full repository context
8. Coexist with existing SDK-based "Quick Review" option

---

## Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User Initiates Review                          │
│                    (Clicks "Deep Review (Console)")                      │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      1. Prepare Review Context                           │
│  • Create temp folder: {appData}/taskdock/console-reviews/{guid}        │
│  • Copy: original/, modified/, diffs/, comments.json, pr.json           │
│  • Generate completion signal path: {guid}.done.json                    │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   2. Check for Local Repo (Based on Settings)            │
│  • Search base folders for matching repo                                │
│  • If found: check for existing worktree for PR branch                  │
│  • If worktree exists: reuse it | else: create new worktree             │
│  • Set working directory to worktree path                               │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    3. Launch Claude Code Terminal                        │
│  • Spawn PTY with node-pty in worktree/temp folder                      │
│  • Execute: claude --dangerously-skip-permissions "{prompt}"            │
│  • Add terminal to sidebar "Terminals" section                          │
│  • Start file watcher on {guid}.done.json                               │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    4. Monitor & Complete                                 │
│  • File watcher detects {guid}.done.json created                        │
│  • Read review.json and walkthrough.json from paths in done file        │
│  • Import results into existing AIReviewService format                  │
│  • Close terminal (based on user preference)                            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Temp Folder Structure

```
{appData}/taskdock/console-reviews/{guid}/
├── context/
│   ├── pr.json                 # PR metadata
│   ├── comments.json           # Existing PR comments/threads
│   └── files.json              # List of changed files
├── original/                   # Original file versions
│   └── {file paths...}
├── modified/                   # Modified file versions
│   └── {file paths...}
├── diffs/
│   └── {file paths}.diff       # Unified diff for each file
├── output/
│   ├── review.json             # Claude's review comments
│   └── walkthrough.json        # Claude's walkthrough
└── {guid}.done.json            # Completion signal
```

### File Formats

**pr.json:**
```json
{
  "id": 12345,
  "title": "Add user authentication",
  "description": "Implements OAuth2 login flow...",
  "author": "john.doe",
  "sourceBranch": "feature/auth",
  "targetBranch": "main",
  "repository": "my-app",
  "organization": "contoso",
  "project": "web-platform"
}
```

**comments.json:**
```json
{
  "threads": [
    {
      "id": 101,
      "filePath": "/src/auth.ts",
      "line": 42,
      "status": "active",
      "comments": [
        { "author": "reviewer", "content": "Consider rate limiting here" }
      ]
    }
  ]
}
```

**{guid}.done.json (written by Claude):**
```json
{
  "status": "complete",
  "reviewPath": "./output/review.json",
  "walkthroughPath": "./output/walkthrough.json",
  "filesReviewed": 12,
  "commentsGenerated": 8,
  "error": null
}
```

---

## Terminal Manager

### Interface

```typescript
interface TerminalSession {
  id: string;                    // GUID
  ptyProcess: IPty;
  label: string;                 // "PR #12345 Review"
  status: 'starting' | 'running' | 'completed' | 'error';
  prId: number;
  workingDir: string;
  completionWatcher: FSWatcher;
  createdAt: Date;
}

class TerminalManager {
  private sessions: Map<string, TerminalSession>;

  createSession(options: CreateSessionOptions): string;
  getSession(id: string): TerminalSession;
  getAllSessions(): TerminalSession[];
  writeToSession(id: string, data: string): void;
  resizeSession(id: string, cols: number, rows: number): void;
  killSession(id: string): void;

  onData(id: string, callback: (data: string) => void): void;
  onExit(id: string, callback: (code: number) => void): void;
  onStatusChange(id: string, callback: (status: string) => void): void;
}
```

---

## Git Worktree Service

### Interface

```typescript
interface RepoMatch {
  path: string;                  // e.g., "D:\git\my-app"
  remote: string;
  isExactMatch: boolean;
}

interface WorktreeInfo {
  path: string;                  // e.g., "D:\git\my-app-worktrees\pr-12345"
  branch: string;
  head: string;                  // commit SHA
}

class WorktreeService {
  constructor(baseFolders: string[]);

  findLocalRepo(repoUrl: string, repoName: string): RepoMatch | null;
  listWorktrees(repoPath: string): WorktreeInfo[];
  findWorktreeForBranch(repoPath: string, branch: string): WorktreeInfo | null;
  createWorktree(repoPath: string, branch: string, prId: number): WorktreeInfo;
  syncWorktree(worktreePath: string, branch: string): void;
  removeWorktree(repoPath: string, worktreePath: string): void;
}
```

### Worktree Location Strategy

```
Main repo:     D:\git\my-app
Worktrees:     D:\git\my-app-worktrees\
               ├── pr-12345\
               ├── pr-12389\
               └── pr-12401\
```

### Git Commands

```bash
# List worktrees
git -C "D:\git\my-app" worktree list --porcelain

# Create worktree
git -C "D:\git\my-app" fetch origin feature/auth
git -C "D:\git\my-app" worktree add "../my-app-worktrees/pr-12345" origin/feature/auth

# Sync to latest
git -C "D:\git\my-app-worktrees\pr-12345" fetch origin
git -C "D:\git\my-app-worktrees\pr-12345" checkout origin/feature/auth
```

---

## Sidebar UI

### Terminals Section

```
┌─────────────────────────────┐
│ 📋 Review                   │
├─────────────────────────────┤
│ 🖥️ Terminals               │  ← NEW
│  ┌───────────────────────┐  │
│  │ 🟢 PR #12345 Review   │  │
│  │ 🟢 PR #12389 Review   │  │
│  │ ⚪ PR #12301 Review   │  │
│  └───────────────────────┘  │
├─────────────────────────────┤
│ ⚙️ Settings                 │
└─────────────────────────────┘
```

### Terminal View

```
┌─────────────────────────────────────────────────────────────┐
│ Tabs: [PR #12345 ×] [PR #12389 ×]                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  $ claude --dangerously-skip-permissions "..."              │
│  ╭─────────────────────────────────────────────╮            │
│  │ I'll review this PR systematically...       │            │
│  ╰─────────────────────────────────────────────╯            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
│ Status: 🟢 Running  |  Files: 8/12  |  Comments: 5         │
└─────────────────────────────────────────────────────────────┘
```

---

## Settings

### New Store Defaults

```typescript
defaults: {
  // ... existing settings
  repoBaseFolders: [],           // e.g., ["D:\\git", "D:\\work\\repos"]

  consoleReview: {
    whenRepoFound: 'worktree',   // 'ask' | 'worktree' | 'tempOnly'
    whenRepoNotFound: 'immediate', // 'ask' | 'immediate' | 'clone'
    autoCloseTerminal: true,
    showNotification: true,
    worktreeCleanup: 'auto',     // 'ask' | 'auto' | 'never'
  }
}
```

### Settings UI

```
┌─────────────────────────────────────────────────────────────────┐
│ Repository Folders (for Deep Review)                            │
├─────────────────────────────────────────────────────────────────┤
│ Base folders where your repos are cloned:                       │
│                                                                 │
│ [D:\git                              ] [Browse] [✕]             │
│ [D:\work\repos                       ] [Browse] [✕]             │
│                                                                 │
│ [+ Add Folder]                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Console Review Options                                          │
├─────────────────────────────────────────────────────────────────┤
│ When local repo is found:                                       │
│ ○ Ask each time                                                 │
│ ● Always use worktree (recommended)                             │
│ ○ Always use temp folder only                                   │
│                                                                 │
│ When local repo is NOT found:                                   │
│ ○ Ask each time                                                 │
│ ● Start review immediately (temp folder)                        │
│ ○ Always clone first                                            │
│                                                                 │
│ ☑ Auto-close terminal when review completes                     │
│ ☑ Show notification when review completes                       │
│                                                                 │
│ Worktree cleanup:                                               │
│ ○ Ask each time                                                 │
│ ● Auto-cleanup after review                                     │
│ ○ Never cleanup (manual)                                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Review Initiation

### PR Review Actions

```
┌─────────────────────────────────────────────────────────────────┐
│ PR #12345: Add user authentication                              │
├─────────────────────────────────────────────────────────────────┤
│  [▶ Quick Review (SDK)]  [▶ Deep Review (Console)]              │
│       ~30 seconds              ~2-5 minutes                     │
│       File-level only          Full repo context                │
└─────────────────────────────────────────────────────────────────┘
```

### One-Click Flow (with recommended settings)

```
User clicks "Deep Review (Console)"
           │
           ▼
┌──────────────────────────────────────┐
│ 🚀 Starting Deep Review...           │
│                                      │
│ ✓ Prepared review context            │
│ ✓ Found local repo: D:\git\my-app    │
│ ✓ Using worktree: pr-12345           │
│ ✓ Launched Claude Code               │
│                                      │
│ Terminal added to sidebar            │
└──────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│ 🖥️ Deep review started for      │
│ PR #12345                       │
│                                 │
│ [View Terminal]  [Dismiss]      │
└─────────────────────────────────┘
```

---

## Claude Code Prompt

The prompt is structured for future skill extraction:

```typescript
// src/main/terminal/review-prompt.ts

export function buildReviewPrompt(options: ReviewPromptOptions): string {
  const { guid, contextPath, hasRepoContext, repoPath } = options;

  // === SKILL-EXTRACTABLE SECTION START ===
  const reviewInstructions = `
You are performing a code review for a Pull Request.

## Context Location
- PR metadata: ${contextPath}/context/pr.json
- Existing comments: ${contextPath}/context/comments.json
- Original files: ${contextPath}/original/
- Modified files: ${contextPath}/modified/
- Diff files: ${contextPath}/diffs/
${hasRepoContext ? `- Full repository: ${repoPath} (use for deeper context)` : ''}

## Your Task
1. Read pr.json to understand the PR purpose
2. Read comments.json to see existing feedback (don't duplicate)
3. Review each diff file, comparing original vs modified
4. ${hasRepoContext ? 'Use the full repo context to understand architectural impact' : 'Focus on the changed files provided'}
5. Use the Task tool to parallelize review of independent files
6. Write your findings to the output files

## Review Criteria
- **Security**: Injection, auth issues, data exposure
- **Bugs**: Logic errors, null handling, edge cases
- **Performance**: N+1 queries, loops, memory leaks
- **Code Quality**: Readability, naming, SOLID
- **Testing**: Missing coverage

## Output Files
Write ${contextPath}/output/review.json with comments array.
Write ${contextPath}/output/walkthrough.json with summary and steps.
Write ${contextPath}/${guid}.done.json LAST as completion signal.
`;
  // === SKILL-EXTRACTABLE SECTION END ===

  return reviewInstructions;
}
```

---

## Implementation Plan

### New Files

| File | Purpose |
|------|---------|
| `src/main/terminal/terminal-manager.ts` | PTY session lifecycle |
| `src/main/terminal/console-review-service.ts` | Review orchestration |
| `src/main/terminal/review-prompt.ts` | Claude Code prompt builder |
| `src/main/git/worktree-service.ts` | Git worktree management |
| `src/renderer/components/terminals-view.ts` | Terminal list + xterm UI |

### Modified Files

| File | Changes |
|------|---------|
| `src/main/main.ts` | IPC handlers for terminal & git |
| `src/main/preload.ts` | Expose terminal APIs |
| `src/renderer/app.ts` | Terminals section, deep review |
| `src/renderer/components/section-sidebar.ts` | Add Terminals section |
| `src/renderer/components/settings-view.ts` | New settings |
| `src/renderer/components/ai-comments-panel.ts` | Deep Review button |
| `package.json` | New dependencies |

### New Dependencies

```json
{
  "@lydell/node-pty": "^1.2.0-beta.3",
  "@xterm/xterm": "^5.5.0",
  "@xterm/addon-fit": "^0.10.0"
}
```

### New IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `terminal:create-session` | R→M | Start terminal |
| `terminal:list-sessions` | R→M | Get all sessions |
| `terminal:write` | R→M | Send input |
| `terminal:resize` | R→M | Resize terminal |
| `terminal:kill` | R→M | Kill session |
| `terminal:data` | M→R | Output stream |
| `terminal:status-change` | M→R | Status updates |
| `terminal:review-complete` | M→R | Review finished |
| `git:find-repo` | R→M | Search for repo |
| `git:list-worktrees` | R→M | List worktrees |
| `git:create-worktree` | R→M | Create worktree |

### Implementation Order

1. Add dependencies & copy xterm styles from electron-terminal sample
2. Create `WorktreeService` with repo discovery and worktree management
3. Create `TerminalManager` with PTY lifecycle
4. Create `ConsoleReviewService` to orchestrate the flow
5. Update Settings UI with new options
6. Add "Terminals" section to sidebar
7. Create `TerminalsView` component
8. Add "Deep Review" button to PR view
9. Wire up completion detection and result import
10. Test end-to-end flow

---

## Future Enhancements

- Extract prompt to a skill file for easier maintenance
- Support multiple concurrent reviews with progress aggregation
- Add review history with comparison
- Support for custom review criteria per project
