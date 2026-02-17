# Local Review Design

## Overview

Add support for reviewing local git changes using the same tab experience as PR reviews. Instead of fetching diffs from Azure DevOps, source changes from a local git repository — uncommitted, staged, branch comparisons, or commit ranges.

The core principle: produce **identical data structures** (`FileChange[]`, context directory with `original/`/`modified/`/`context/files.json`) so the diff viewer, AI review executors, and walkthrough generator work unchanged.

## Entry Point

The PR Home view gains a **"Local Review"** section below the PR list. It auto-populates from:

1. **Linked Repositories** (from Console Review settings, `LinkedRepository[]`)
2. **Worktree paths** nested under each linked repo (via `worktreeService.listWorktrees()`)
3. **"+ Custom Path"** option for one-off repos (folder picker, validated via `gitIsRepo()`)

Clicking a repo/worktree expands an **inline diff mode selector** with a clean, modern appearance. The selector shows:

### Quick Mode Buttons
- **Uncommitted** — Working tree vs HEAD
- **Staged** — Index vs HEAD
- **All Local** — Working tree + staged vs HEAD
- **Branch Compare** — Current branch vs selected base branch

### Branch Compare Options
- Auto-detect current branch via `git.branch()`
- Base branch dropdown populated with:
  - Upstream tracking branch (default if set, via `git.raw(['rev-parse', '--abbrev-ref', '@{upstream}'])`)
  - `main` or `master` (whichever exists)
  - Other local branches (via `git.branchLocal()`)
- Uses three-dot merge-base diff to show changes since divergence

### Commit Range Section (expandable)
- "From" and "To" dropdowns populated from `git.log({ maxCount: 30 })`
- Displays as `{shortHash} — {message}` per entry
- Uses two-dot diff (`from..to`)

An **"Open Review"** button launches the tab.

## Tab Behavior

- Each diff mode opens its **own tab** (fixed mode, not switchable)
- Tab header: `"Local: {repoName} — {mode description}"`
  - Examples: `"Local: taskdock — staged"`, `"Local: taskdock — feature-xyz vs main"`
- Same UI as PR tabs: file list sidebar, diff viewer, AI review panel, walkthrough
- **Refresh button** in toolbar re-captures files from git (replaces PR's iteration selector)
- No iteration selector — not applicable for local review
- No comment publishing — local only

## Data Pipeline

### Producing Identical FileChange[]

The local git service produces `FileChange[]` with the same shape as ADO:

```typescript
interface FileChange {
  path: string;                    // File path (e.g., "src/main.ts")
  changeType: ChangeType;         // 'add' | 'edit' | 'delete' | 'rename'
  originalContent?: string;       // Lazy-loaded from context/original/
  modifiedContent?: string;       // Lazy-loaded from context/modified/
  objectId?: string;              // Git object hash for modified version
  originalObjectId?: string;      // Git object hash for original version
  threads: CommentThread[];       // Always empty for local review
}
```

### Git Commands Per Diff Mode

All commands run via `simple-git` (already used by `WorktreeService`):

| Mode | File List | Original Content | Modified Content |
|------|-----------|-----------------|-----------------|
| Uncommitted | `git.diff(['--name-status'])` | `git.show(['HEAD:{path}'])` | `fs.readFile(repoPath/{path})` |
| Staged | `git.diff(['--cached', '--name-status'])` | `git.show(['HEAD:{path}'])` | `git.show([':{path}'])` |
| All Local | `git.diff(['HEAD', '--name-status'])` | `git.show(['HEAD:{path}'])` | `fs.readFile(repoPath/{path})` |
| Branch Compare | `git.diff(['--name-status', '{mergeBase}..HEAD'])` | `git.show(['{mergeBase}:{path}'])` | `git.show(['HEAD:{path}'])` |
| Commit Range | `git.diff(['--name-status', '{from}..{to}'])` | `git.show(['{from}:{path}'])` | `git.show(['{to}:{path}'])` |

**Branch Compare merge-base**: `git.raw(['merge-base', baseBranch, 'HEAD'])` returns the common ancestor SHA.

**Change type mapping** from `--name-status` output:
- `A` → `'add'` (original is empty string)
- `M` → `'edit'`
- `D` → `'delete'` (modified is empty string)
- `R{score}\toldpath\tnewpath` → `'rename'`

**Object IDs**: Retrieved via `git.raw(['rev-parse', '{ref}:{path}'])` for each file to populate `objectId`/`originalObjectId`.

### Context Directory Structure (identical to PR)

```
{contextPath}/
├── context/
│   ├── pr.json              # Synthetic PR metadata (for executor compatibility)
│   ├── files.json           # Manifest
│   └── comments.json        # Empty array (no ADO comments)
├── original/                # "Before" file versions
│   └── src/main.ts
├── modified/                # "After" file versions
│   └── src/main.ts
├── diffs/                   # Unified diffs per file
│   └── src/main.ts.diff
└── reviews/                 # Per-review executor working directories
    └── {guid}/
```

### Synthetic pr.json (for executor compatibility)

AI review executors read `pr.json` for context. Local review creates a synthetic version:

```json
{
  "prId": 0,
  "title": "Local Review: feature-xyz vs main",
  "description": "Local git diff review",
  "sourceBranch": "refs/heads/feature-xyz",
  "targetBranch": "refs/heads/main",
  "repository": {
    "name": "taskdock",
    "path": "C:/git/taskdock"
  },
  "status": "active",
  "createdBy": { "displayName": "Local" }
}
```

### Synthetic ReviewContextInfo (for executor compatibility)

```typescript
{
  guid: string,                    // Fresh UUID per review session
  contextPath: string,             // local-contexts/{contextKey}/
  outputPath: string,              // local-contexts/{contextKey}/reviews/{guid}/
  workingDir: repoPath,            // The actual repo path (already local!)
  hasRepoContext: true,            // Always true for local review
  repoPath: repoPath,
  worktreeCreated: false,          // We didn't create it
  mainRepoPath: repoPath
}
```

Key advantage: `workingDir` is always the real repo — no worktree creation needed.

## Storage

### Context (refreshable)

```
{appData}/local-contexts/{contextKey}/
  ├── context/
  │   ├── pr.json            # Synthetic PR metadata
  │   ├── files.json         # Manifest
  │   └── comments.json      # Empty array
  ├── original/
  ├── modified/
  ├── diffs/
  └── reviews/{guid}/        # Executor working directories
```

**Context key format**: `{repoName}-{mode}[-specifier]`

Examples:
- `taskdock-uncommitted`
- `taskdock-staged`
- `taskdock-all-local`
- `taskdock-branch-feature-xyz-vs-main`
- `taskdock-range-abc1234-def5678`

**Manifest** (`files.json`):
```json
{
  "contextVersion": 1,
  "repoName": "taskdock",
  "repoPath": "C:/git/taskdock",
  "diffMode": "branch-compare",
  "baseBranch": "main",
  "targetBranch": "feature-xyz",
  "baseCommit": "abc1234def...",
  "targetCommit": "def5678abc...",
  "capturedAt": "2026-02-08T10:00:00Z",
  "files": [
    { "path": "src/app.ts", "changeType": "edit", "objectId": "...", "originalObjectId": "..." },
    { "path": "src/new-file.ts", "changeType": "add", "objectId": "..." }
  ]
}
```

For uncommitted/staged/all-local: `baseCommit` = HEAD SHA, `targetCommit` = `"working-tree"` or `"index"`.

### Reviews & Walkthroughs (persistent, scoped to context key)

```
{appData}/reviews/local/{contextKey}/
  ├── review-{sessionId}.json
  └── walkthrough-{sessionId}.json
```

Same `SavedReview` and `SavedWalkthrough` file formats as PR reviews.

### Refresh Behavior

- **Manual only** — User clicks refresh button in tab toolbar
- On refresh: `context/`, `original/`, `modified/`, `diffs/` are rebuilt from git
- Review and walkthrough files under `reviews/local/{contextKey}/` are **never deleted**
- Old reviews reference the file state at capture time
- User can run multiple reviews against same captured content without refreshing

## What's Reused From PR Tab

| Component | Reused As-Is | Changes Needed |
|-----------|-------------|----------------|
| Diff Viewer | Yes | None — takes `FileChange` with content |
| AI Comments Panel | Yes | None — takes comments array |
| AI Review Dialog | Yes | None — provider/preset selection is source-agnostic |
| Walkthrough View | Yes | None — takes walkthrough data |
| Review Executors | Yes | None — read from context directory + write to output |
| File List Sidebar | Mostly | Adapt to `FileChange[]` from local (same shape, threads always empty) |
| Tab Header | No | New format for local review info |
| Iteration Selector | No | Replaced with refresh button |
| Comment Publishing | No | Not applicable — local only |
| PR Polling | No | Not applicable |

## What's New

### 1. Local Review section in PR Home
- Renders linked repos + worktrees + custom path option
- Inline diff mode selector with branch/commit pickers
- "Open Review" button

### 2. Local Git Service (`src/main/git/local-diff-service.ts`)
New backend service with methods:
- `getFileList(repoPath, diffMode, options)` → `FileChange[]`
- `getFileContent(repoPath, ref, filePath)` → `string`
- `getBranches(repoPath)` → `{ current, upstream?, locals[] }`
- `getRecentCommits(repoPath, count)` → `{ hash, shortHash, message, date }[]`
- `getMergeBase(repoPath, branch1, branch2)` → `string` (SHA)
- `captureContext(repoPath, diffMode, options)` → writes context directory, returns `contextPath`

### 3. Local Context Service (`src/main/ai/local-context-service.ts`)
- Creates context directory structure identical to PR contexts
- Writes `pr.json` (synthetic), `files.json`, `comments.json`
- Copies file content to `original/` and `modified/`
- Generates unified diffs for `diffs/`
- Produces `ReviewContextInfo` for executors

### 4. Local Storage Adapter
- Routes save/load/list for reviews/walkthroughs to `reviews/local/{contextKey}/`
- Same `AIStorageService` interface, different base path

### 5. Tab State (`LocalReviewTabState`)
```typescript
interface LocalReviewTabState {
  type: 'local-review';
  repoPath: string;
  repoName: string;
  diffMode: 'uncommitted' | 'staged' | 'all-local' | 'branch-compare' | 'commit-range';
  baseBranch?: string;           // For branch-compare
  targetBranch?: string;         // For branch-compare
  fromCommit?: string;           // For commit-range
  toCommit?: string;             // For commit-range
  contextKey: string;
  contextPath: string | null;
  fileChanges: FileChange[];
  selectedFile: string | null;
  diffViewMode: 'split' | 'unified' | 'preview';
  aiSessionId: string | null;
  aiReviewInProgress: boolean;
  hasSavedReview: boolean;
  savedReviewInfo: SavedReviewInfo | null;
}
```

### 6. Refresh Action
- Re-runs git diff commands for the tab's diff mode
- Rebuilds context directory (original/, modified/, diffs/, files.json)
- Reloads file list and diff viewer
- Preserves all review sessions

## Not In Scope (v1)

- Comment publishing/export — reviews are local-only
- Auto-refresh / file watching — manual refresh only
- Stash review — reviewing stashed changes
- Multi-repo review — one repo per tab
