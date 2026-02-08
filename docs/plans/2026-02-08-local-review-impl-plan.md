# Local Review Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable reviewing local git changes (uncommitted, staged, branch compare, commit range) using the same tab experience as PR reviews.

**Architecture:** New `LocalDiffService` on the backend produces `FileChange[]` and context directories identical to PR review. A `LocalReviewTabState` parallels `PRTabState`. The renderer's PR Home view gains a "Local Review" section. All existing components (diff viewer, AI review, walkthroughs, apply changes) work unchanged because they receive the same data shapes.

**Tech Stack:** TypeScript, simple-git (already in project), Node.js fs, existing AI review pipeline.

**Design Doc:** `docs/plans/2026-02-08-local-review-design.md`

---

## Task 1: Add Shared Types for Local Review

**Files:**
- Modify: `src/shared/types.ts` (after line 160, after `FileChangeMetadata`)
- Modify: `src/shared/ai-types.ts` (after `ReviewContextInfo` ~line 278)

**Step 1: Add local review types to `src/shared/types.ts`**

Add after `FileChangeMetadata` definition (~line 160):

```typescript
export type LocalDiffMode = 'uncommitted' | 'staged' | 'all-local' | 'branch-compare' | 'commit-range';

export interface LocalReviewRequest {
  repoPath: string;
  repoName: string;
  diffMode: LocalDiffMode;
  baseBranch?: string;      // For branch-compare
  targetBranch?: string;    // For branch-compare
  fromCommit?: string;      // For commit-range
  toCommit?: string;        // For commit-range
}

export interface LocalReviewManifest {
  contextVersion: number;
  repoName: string;
  repoPath: string;
  diffMode: LocalDiffMode;
  baseBranch?: string;
  targetBranch?: string;
  baseCommit: string;       // HEAD SHA or merge-base SHA
  targetCommit: string;     // HEAD SHA, "working-tree", or "index"
  capturedAt: string;
  files: Array<{
    path: string;
    changeType: ChangeType;
    objectId?: string;
    originalObjectId?: string;
  }>;
}

export interface LocalBranchInfo {
  current: string;
  upstream?: string;
  locals: string[];
}

export interface LocalCommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  date: string;
  author: string;
}
```

**Step 2: Verify types compile**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`
Expected: No new errors from these additions.

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(local-review): add shared types for local diff modes and manifests"
```

---

## Task 2: Create LocalDiffService (Backend)

**Files:**
- Create: `src/main/git/local-diff-service.ts`

**Step 1: Create the service file**

Create `src/main/git/local-diff-service.ts` with all git diff operations. This service uses `simple-git` (same as `WorktreeService`) to:
- Parse `--name-status` output into `FileChange[]`
- Retrieve file content via `git show`
- List branches and recent commits
- Compute merge-base for branch comparisons

```typescript
import simpleGit, { SimpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import { FileChange, ChangeType, LocalDiffMode, LocalBranchInfo, LocalCommitInfo } from '../../shared/types';

export class LocalDiffService {

  private getGit(repoPath: string): SimpleGit {
    return simpleGit(repoPath);
  }

  /**
   * Get list of changed files for a given diff mode.
   * Returns FileChange[] with same shape as ADO PR changes (no content yet).
   */
  async getFileList(repoPath: string, diffMode: LocalDiffMode, options?: {
    baseBranch?: string;
    fromCommit?: string;
    toCommit?: string;
  }): Promise<{ files: FileChange[]; baseCommit: string; targetCommit: string }> {
    const git = this.getGit(repoPath);
    let diffArgs: string[];
    let baseCommit: string;
    let targetCommit: string;

    const headSha = (await git.revparse(['HEAD'])).trim();

    switch (diffMode) {
      case 'uncommitted':
        diffArgs = ['--name-status'];
        baseCommit = headSha;
        targetCommit = 'working-tree';
        break;
      case 'staged':
        diffArgs = ['--cached', '--name-status'];
        baseCommit = headSha;
        targetCommit = 'index';
        break;
      case 'all-local':
        diffArgs = ['HEAD', '--name-status'];
        baseCommit = headSha;
        targetCommit = 'working-tree';
        break;
      case 'branch-compare': {
        const base = options?.baseBranch;
        if (!base) throw new Error('baseBranch required for branch-compare mode');
        const mergeBase = (await git.raw(['merge-base', base, 'HEAD'])).trim();
        diffArgs = ['--name-status', `${mergeBase}..HEAD`];
        baseCommit = mergeBase;
        targetCommit = headSha;
        break;
      }
      case 'commit-range': {
        const from = options?.fromCommit;
        const to = options?.toCommit;
        if (!from || !to) throw new Error('fromCommit and toCommit required for commit-range mode');
        diffArgs = ['--name-status', `${from}..${to}`];
        baseCommit = from;
        targetCommit = to;
        break;
      }
      default:
        throw new Error(`Unknown diff mode: ${diffMode}`);
    }

    const raw = await git.diff(diffArgs);
    const files = this.parseNameStatus(raw);
    return { files, baseCommit, targetCommit };
  }

  /**
   * Parse `git diff --name-status` output into FileChange[].
   * Lines look like: "M\tsrc/file.ts" or "R100\told.ts\tnew.ts"
   */
  private parseNameStatus(output: string): FileChange[] {
    const lines = output.trim().split('\n').filter(l => l.length > 0);
    const files: FileChange[] = [];

    for (const line of lines) {
      const parts = line.split('\t');
      const statusCode = parts[0];

      let changeType: ChangeType;
      let filePath: string;

      if (statusCode.startsWith('R')) {
        changeType = 'rename';
        filePath = parts[2]; // new path
      } else if (statusCode === 'A') {
        changeType = 'add';
        filePath = parts[1];
      } else if (statusCode === 'D') {
        changeType = 'delete';
        filePath = parts[1];
      } else if (statusCode === 'M' || statusCode === 'T') {
        changeType = 'edit';
        filePath = parts[1];
      } else {
        // C (copy) or other — treat as edit
        changeType = 'edit';
        filePath = parts[1];
      }

      // Normalize path separators
      filePath = filePath.replace(/\\/g, '/');

      files.push({
        path: filePath,
        changeType,
        threads: [],
      });
    }

    return files;
  }

  /**
   * Get file content at a specific git ref.
   * For working tree files, reads from disk.
   * For index files, uses `git show :path`.
   * For commits, uses `git show ref:path`.
   */
  async getFileContent(repoPath: string, ref: string, filePath: string): Promise<string> {
    if (ref === 'working-tree') {
      const fullPath = path.join(repoPath, filePath);
      try {
        return await fs.promises.readFile(fullPath, 'utf-8');
      } catch {
        return '';
      }
    }

    const git = this.getGit(repoPath);
    const gitRef = ref === 'index' ? `:${filePath}` : `${ref}:${filePath}`;
    try {
      return await git.show([gitRef]);
    } catch {
      return '';
    }
  }

  /**
   * Get branches for the repo.
   */
  async getBranches(repoPath: string): Promise<LocalBranchInfo> {
    const git = this.getGit(repoPath);
    const branchResult = await git.branchLocal();
    const current = branchResult.current;

    let upstream: string | undefined;
    try {
      upstream = (await git.raw(['rev-parse', '--abbrev-ref', '@{upstream}'])).trim();
    } catch {
      // No upstream set
    }

    return {
      current,
      upstream,
      locals: branchResult.all,
    };
  }

  /**
   * Get recent commits for commit range picker.
   */
  async getRecentCommits(repoPath: string, count: number = 30): Promise<LocalCommitInfo[]> {
    const git = this.getGit(repoPath);
    const log = await git.log({ maxCount: count });

    return log.all.map(entry => ({
      hash: entry.hash,
      shortHash: entry.hash.substring(0, 7),
      message: entry.message,
      date: entry.date,
      author: entry.author_name,
    }));
  }

  /**
   * Get merge-base between two refs.
   */
  async getMergeBase(repoPath: string, ref1: string, ref2: string): Promise<string> {
    const git = this.getGit(repoPath);
    return (await git.raw(['merge-base', ref1, ref2])).trim();
  }

  /**
   * Get the current HEAD SHA.
   */
  async getHeadSha(repoPath: string): Promise<string> {
    const git = this.getGit(repoPath);
    return (await git.revparse(['HEAD'])).trim();
  }

  /**
   * Get the current branch name.
   */
  async getCurrentBranch(repoPath: string): Promise<string> {
    const git = this.getGit(repoPath);
    return (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
  }
}

let instance: LocalDiffService | null = null;

export function getLocalDiffService(): LocalDiffService {
  if (!instance) {
    instance = new LocalDiffService();
  }
  return instance;
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`
Expected: No new errors.

**Step 3: Commit**

```bash
git add src/main/git/local-diff-service.ts
git commit -m "feat(local-review): add LocalDiffService for git diff operations"
```

---

## Task 3: Create LocalContextService (Backend)

**Files:**
- Create: `src/main/ai/local-context-service.ts`

**Step 1: Create the service**

This service captures file content from git into a context directory structure identical to PR contexts. It produces `ReviewContextInfo` for AI executors.

Reference `src/main/ai/review-context-service.ts` for the PR equivalent — this service mirrors its output format.

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import { FileChange, LocalDiffMode, LocalReviewManifest, LocalReviewRequest } from '../../shared/types';
import { ReviewContextInfo } from '../../shared/ai-types';
import { getLocalDiffService } from '../git/local-diff-service';

export class LocalContextService {
  private localContextsDir: string;

  constructor() {
    const appData = process.env.APPDATA || path.join(require('os').homedir(), '.taskdock');
    this.localContextsDir = path.join(appData, 'taskdock', 'local-contexts');
    fs.mkdirSync(this.localContextsDir, { recursive: true });
  }

  /**
   * Generate a deterministic context key for a local review.
   */
  getContextKey(request: LocalReviewRequest): string {
    const repoName = path.basename(request.repoPath).replace(/[^a-zA-Z0-9-_]/g, '_');
    switch (request.diffMode) {
      case 'uncommitted':
        return `${repoName}-uncommitted`;
      case 'staged':
        return `${repoName}-staged`;
      case 'all-local':
        return `${repoName}-all-local`;
      case 'branch-compare': {
        const target = (request.targetBranch || 'HEAD').replace(/[^a-zA-Z0-9-_]/g, '_');
        const base = (request.baseBranch || 'main').replace(/[^a-zA-Z0-9-_]/g, '_');
        return `${repoName}-branch-${target}-vs-${base}`;
      }
      case 'commit-range': {
        const from = (request.fromCommit || '').substring(0, 7);
        const to = (request.toCommit || '').substring(0, 7);
        return `${repoName}-range-${from}-${to}`;
      }
      default:
        return `${repoName}-unknown`;
    }
  }

  getContextPath(contextKey: string): string {
    return path.join(this.localContextsDir, contextKey);
  }

  /**
   * Capture local git changes into a context directory.
   * Produces the same directory structure as PR contexts.
   */
  async captureContext(request: LocalReviewRequest): Promise<{
    contextKey: string;
    contextPath: string;
    files: FileChange[];
    manifest: LocalReviewManifest;
  }> {
    const diffService = getLocalDiffService();
    const contextKey = this.getContextKey(request);
    const contextPath = this.getContextPath(contextKey);

    // Get file list
    const { files, baseCommit, targetCommit } = await diffService.getFileList(
      request.repoPath,
      request.diffMode,
      {
        baseBranch: request.baseBranch,
        fromCommit: request.fromCommit,
        toCommit: request.toCommit,
      }
    );

    // Create directory structure (clean context/ subdirs, preserve reviews/)
    const contextDir = path.join(contextPath, 'context');
    const originalDir = path.join(contextPath, 'original');
    const modifiedDir = path.join(contextPath, 'modified');
    const diffsDir = path.join(contextPath, 'diffs');

    // Clean context subdirectories but NOT review files at top level
    for (const dir of [contextDir, originalDir, modifiedDir, diffsDir]) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      fs.mkdirSync(dir, { recursive: true });
    }

    // Ensure reviews dir exists
    fs.mkdirSync(path.join(contextPath, 'reviews'), { recursive: true });

    // Determine refs for content retrieval
    const originalRef = baseCommit;
    const modifiedRef = targetCommit;

    // Capture file content
    const manifestFiles: LocalReviewManifest['files'] = [];

    for (const file of files) {
      const filePath = file.path;

      // Get original content (if not an add)
      let originalContent = '';
      if (file.changeType !== 'add') {
        originalContent = await diffService.getFileContent(request.repoPath, originalRef, filePath);
        if (originalContent) {
          const origPath = path.join(originalDir, filePath);
          fs.mkdirSync(path.dirname(origPath), { recursive: true });
          fs.writeFileSync(origPath, originalContent, 'utf-8');
        }
      }

      // Get modified content (if not a delete)
      let modifiedContent = '';
      if (file.changeType !== 'delete') {
        modifiedContent = await diffService.getFileContent(request.repoPath, modifiedRef, filePath);
        if (modifiedContent) {
          const modPath = path.join(modifiedDir, filePath);
          fs.mkdirSync(path.dirname(modPath), { recursive: true });
          fs.writeFileSync(modPath, modifiedContent, 'utf-8');
        }
      }

      // Write unified diff
      // Use simple-git diff for the unified diff content
      const git = require('simple-git').default(request.repoPath);
      try {
        let diffContent: string;
        if (file.changeType === 'add') {
          diffContent = `--- /dev/null\n+++ b/${filePath}\n` + modifiedContent.split('\n').map(l => `+${l}`).join('\n');
        } else if (file.changeType === 'delete') {
          diffContent = `--- a/${filePath}\n+++ /dev/null\n` + originalContent.split('\n').map(l => `-${l}`).join('\n');
        } else {
          // For edit/rename, generate a simple diff marker
          diffContent = `--- a/${filePath}\n+++ b/${filePath}\n`;
        }
        const diffPath = path.join(diffsDir, `${filePath}.diff`);
        fs.mkdirSync(path.dirname(diffPath), { recursive: true });
        fs.writeFileSync(diffPath, diffContent, 'utf-8');
      } catch {
        // Ignore diff generation errors
      }

      manifestFiles.push({
        path: filePath,
        changeType: file.changeType,
      });
    }

    // Build manifest
    const repoName = path.basename(request.repoPath);
    const manifest: LocalReviewManifest = {
      contextVersion: 1,
      repoName,
      repoPath: request.repoPath,
      diffMode: request.diffMode,
      baseBranch: request.baseBranch,
      targetBranch: request.targetBranch,
      baseCommit,
      targetCommit,
      capturedAt: new Date().toISOString(),
      files: manifestFiles,
    };

    // Write manifest
    fs.writeFileSync(path.join(contextDir, 'files.json'), JSON.stringify(manifest, null, 2));

    // Write synthetic pr.json (for executor compatibility)
    const syntheticPR = this.buildSyntheticPR(request, repoName);
    fs.writeFileSync(path.join(contextDir, 'pr.json'), JSON.stringify(syntheticPR, null, 2));

    // Write empty comments.json
    fs.writeFileSync(path.join(contextDir, 'comments.json'), JSON.stringify([]));

    return { contextKey, contextPath, files, manifest };
  }

  /**
   * Build a synthetic PR object for executor compatibility.
   * Executors read pr.json to understand what they're reviewing.
   */
  private buildSyntheticPR(request: LocalReviewRequest, repoName: string): Record<string, unknown> {
    let title: string;
    switch (request.diffMode) {
      case 'uncommitted':
        title = `Local Review: uncommitted changes`;
        break;
      case 'staged':
        title = `Local Review: staged changes`;
        break;
      case 'all-local':
        title = `Local Review: all local changes`;
        break;
      case 'branch-compare':
        title = `Local Review: ${request.targetBranch || 'HEAD'} vs ${request.baseBranch}`;
        break;
      case 'commit-range':
        title = `Local Review: ${request.fromCommit?.substring(0, 7)}..${request.toCommit?.substring(0, 7)}`;
        break;
      default:
        title = 'Local Review';
    }

    return {
      prId: 0,
      title,
      description: `Local git diff review — ${request.diffMode}`,
      sourceBranch: request.targetBranch ? `refs/heads/${request.targetBranch}` : 'refs/heads/HEAD',
      targetBranch: request.baseBranch ? `refs/heads/${request.baseBranch}` : 'refs/heads/HEAD',
      repository: {
        name: repoName,
        path: request.repoPath,
      },
      status: 'active',
      createdBy: { displayName: 'Local' },
    };
  }

  /**
   * Create a ReviewContextInfo for AI executors.
   * workingDir is the actual repo path (no worktree needed).
   */
  createReviewContextInfo(contextPath: string, repoPath: string): ReviewContextInfo {
    const guid = uuid();
    const outputPath = path.join(contextPath, 'reviews', guid);
    fs.mkdirSync(outputPath, { recursive: true });

    return {
      guid,
      contextPath,
      outputPath,
      workingDir: repoPath,
      hasRepoContext: true,
      repoPath,
      worktreeCreated: false,
      mainRepoPath: repoPath,
    };
  }

  /**
   * Refresh context — re-captures files without deleting reviews.
   */
  async refreshContext(request: LocalReviewRequest): Promise<{
    contextKey: string;
    contextPath: string;
    files: FileChange[];
    manifest: LocalReviewManifest;
  }> {
    // captureContext already preserves the reviews/ directory
    return this.captureContext(request);
  }
}

let instance: LocalContextService | null = null;

export function getLocalContextService(): LocalContextService {
  if (!instance) {
    instance = new LocalContextService();
  }
  return instance;
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`
Expected: No new errors.

**Step 3: Commit**

```bash
git add src/main/ai/local-context-service.ts
git commit -m "feat(local-review): add LocalContextService for context directory creation"
```

---

## Task 4: Add Local Review Storage Methods to AIStorageService

**Files:**
- Modify: `src/main/ai/ai-storage-service.ts`

**Step 1: Add local review path method**

Add a `getLocalReviewPath(contextKey)` method alongside existing `getReviewPath(org, project, prId)`. The local review path is: `{basePath}/local/{contextKey}/`.

Find `getReviewPath` method (~line 56) and add after it:

```typescript
getLocalReviewPath(contextKey: string): string {
  return path.join(this.getBasePath(), 'local', contextKey);
}
```

**Step 2: Add local review list/save/load/delete methods**

Add methods that mirror the existing `saveReviewSession`, `listReviews`, `loadReviewSession`, `deleteReviewSession` but use `getLocalReviewPath(contextKey)` instead of `getReviewPath(org, project, prId)`. These should be named:
- `saveLocalReviewSession(contextKey, sessionId, displayName, provider, comments, preset?, customPrompt?)`
- `listLocalReviews(contextKey)`
- `loadLocalReviewSession(contextKey, sessionId)`
- `deleteLocalReviewSession(contextKey, sessionId)`
- `saveLocalWalkthroughSession(contextKey, sessionId, displayName, provider, walkthrough, preset?, customPrompt?)`
- `listLocalWalkthroughs(contextKey)`
- `loadLocalWalkthroughSession(contextKey, sessionId)`
- `deleteLocalWalkthroughSession(contextKey, sessionId)`

The implementation bodies are identical to the PR versions — the only difference is the directory path. Extract the common file reading/writing logic into private helpers to avoid duplication.

**Step 3: Verify it compiles**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`

**Step 4: Commit**

```bash
git add src/main/ai/ai-storage-service.ts
git commit -m "feat(local-review): add local review storage methods to AIStorageService"
```

---

## Task 5: Add Local Review Fix Tracker Support

**Files:**
- Modify: `src/main/ai/fix-tracker-service.ts`

**Step 1: Add local review fix tracker methods**

Add alongside existing methods:

```typescript
getLocalFixTrackerPath(contextKey: string): string {
  return path.join(this.basePath, 'local', contextKey, 'fixes.json');
}

async loadLocalFixTracker(contextKey: string): Promise<PRFixTracker> {
  // Same logic as loadFixTracker but uses getLocalFixTrackerPath
}

async markLocalFixed(contextKey: string, fix: FixedComment): Promise<void> {
  // Same logic as markFixed but uses getLocalFixTrackerPath
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`

**Step 3: Commit**

```bash
git add src/main/ai/fix-tracker-service.ts
git commit -m "feat(local-review): add local fix tracker methods"
```

---

## Task 6: Wire Up Backend RPC Handlers

**Files:**
- Modify: `src-backend/bridge.ts`

**Step 1: Import new services**

Add imports for `getLocalDiffService` and `getLocalContextService` alongside existing service imports (~line 146).

**Step 2: Add `local-review:*` RPC handlers**

In the `handleRpc` switch statement, add new cases:

```typescript
// Local Review - Git operations
case 'local-review:get-branches':
  return getLocalDiffService().getBranches(params[0]);

case 'local-review:get-recent-commits':
  return getLocalDiffService().getRecentCommits(params[0], params[1]);

case 'local-review:get-file-list':
  return getLocalDiffService().getFileList(params[0], params[1], params[2]);

case 'local-review:capture-context':
  return getLocalContextService().captureContext(params[0]);

case 'local-review:refresh-context':
  return getLocalContextService().refreshContext(params[0]);

case 'local-review:get-context-key':
  return getLocalContextService().getContextKey(params[0]);

case 'local-review:get-file-content': {
  const contextKey = params[0];
  const filePath = params[1];
  const version = params[2]; // 'original' or 'modified'
  const contextPath = getLocalContextService().getContextPath(contextKey);
  const fullPath = path.join(contextPath, version, filePath);
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

case 'local-review:create-review-context-info':
  return getLocalContextService().createReviewContextInfo(params[0], params[1]);

// Local Review - Storage
case 'local-review:list-reviews':
  return storageService.listLocalReviews(params[0]);

case 'local-review:load-review-session':
  return storageService.loadLocalReviewSession(params[0], params[1]);

case 'local-review:save-review-session':
  return storageService.saveLocalReviewSession(params[0], params[1], params[2], params[3], params[4], params[5], params[6]);

case 'local-review:delete-review-session':
  return storageService.deleteLocalReviewSession(params[0], params[1]);

case 'local-review:list-walkthroughs':
  return storageService.listLocalWalkthroughs(params[0]);

case 'local-review:load-walkthrough-session':
  return storageService.loadLocalWalkthroughSession(params[0], params[1]);

case 'local-review:save-walkthrough-session':
  return storageService.saveLocalWalkthroughSession(params[0], params[1], params[2], params[3], params[4], params[5], params[6]);

case 'local-review:delete-walkthrough-session':
  return storageService.deleteLocalWalkthroughSession(params[0], params[1]);

// Local Review - Comments (user-added)
case 'local-review:load-comments': {
  const contextPath = getLocalContextService().getContextPath(params[0]);
  const commentsPath = path.join(contextPath, 'comments.json');
  try {
    return JSON.parse(fs.readFileSync(commentsPath, 'utf-8'));
  } catch {
    return [];
  }
}

case 'local-review:save-comments': {
  const contextPath = getLocalContextService().getContextPath(params[0]);
  const commentsPath = path.join(contextPath, 'comments.json');
  fs.mkdirSync(path.dirname(commentsPath), { recursive: true });
  fs.writeFileSync(commentsPath, JSON.stringify(params[1], null, 2));
  return;
}

// Local Review - Fix Tracker
case 'local-review:load-fix-tracker':
  return fixTrackerService.loadLocalFixTracker(params[0]);

case 'local-review:mark-fixed':
  return fixTrackerService.markLocalFixed(params[0], params[1]);
```

**Step 3: Verify it compiles**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`

**Step 4: Commit**

```bash
git add src-backend/bridge.ts
git commit -m "feat(local-review): add local-review RPC handlers to bridge"
```

---

## Task 7: Add Renderer API Declarations

**Files:**
- Modify: `src/renderer/api.d.ts`
- Modify: `src/renderer/tauri-api.ts` (WebSocket bridge)

**Step 1: Add local review API methods to `api.d.ts`**

Add a new section in the `ElectronAPI` interface for local review methods. Place after the git methods section (~line 262):

```typescript
// Local Review
localReviewGetBranches: (repoPath: string) => Promise<LocalBranchInfo>;
localReviewGetRecentCommits: (repoPath: string, count?: number) => Promise<LocalCommitInfo[]>;
localReviewGetFileList: (repoPath: string, diffMode: LocalDiffMode, options?: { baseBranch?: string; fromCommit?: string; toCommit?: string }) => Promise<{ files: FileChange[]; baseCommit: string; targetCommit: string }>;
localReviewCaptureContext: (request: LocalReviewRequest) => Promise<{ contextKey: string; contextPath: string; files: FileChange[]; manifest: LocalReviewManifest }>;
localReviewRefreshContext: (request: LocalReviewRequest) => Promise<{ contextKey: string; contextPath: string; files: FileChange[]; manifest: LocalReviewManifest }>;
localReviewGetContextKey: (request: LocalReviewRequest) => Promise<string>;
localReviewGetFileContent: (contextKey: string, filePath: string, version: 'original' | 'modified') => Promise<string | null>;
localReviewCreateReviewContextInfo: (contextPath: string, repoPath: string) => Promise<ReviewContextInfo>;

// Local Review - Storage
localReviewListReviews: (contextKey: string) => Promise<SavedReviewMetadata[]>;
localReviewLoadReviewSession: (contextKey: string, sessionId: string) => Promise<SavedReview | null>;
localReviewSaveReviewSession: (contextKey: string, sessionId: string, displayName: string, provider: string, comments: AIReviewComment[], preset?: any, customPrompt?: string) => Promise<void>;
localReviewDeleteReviewSession: (contextKey: string, sessionId: string) => Promise<void>;
localReviewListWalkthroughs: (contextKey: string) => Promise<SavedWalkthroughMetadata[]>;
localReviewLoadWalkthroughSession: (contextKey: string, sessionId: string) => Promise<SavedWalkthrough | null>;
localReviewSaveWalkthroughSession: (contextKey: string, sessionId: string, displayName: string, provider: string, walkthrough: any, preset?: any, customPrompt?: string) => Promise<void>;
localReviewDeleteWalkthroughSession: (contextKey: string, sessionId: string) => Promise<void>;

// Local Review - Comments
localReviewLoadComments: (contextKey: string) => Promise<CommentThread[]>;
localReviewSaveComments: (contextKey: string, comments: CommentThread[]) => Promise<void>;

// Local Review - Fix Tracker
localReviewLoadFixTracker: (contextKey: string) => Promise<any>;
localReviewMarkFixed: (contextKey: string, fix: any) => Promise<void>;
```

**Step 2: Add implementations to `tauri-api.ts`**

Wire each method to the corresponding `local-review:*` RPC call via the WebSocket bridge. Follow the existing pattern used for other methods (e.g., `gitListWorktrees` calls `rpc('git:list-worktrees', ...)`).

```typescript
localReviewGetBranches: (repoPath) => rpc('local-review:get-branches', repoPath),
localReviewGetRecentCommits: (repoPath, count) => rpc('local-review:get-recent-commits', repoPath, count),
localReviewGetFileList: (repoPath, diffMode, options) => rpc('local-review:get-file-list', repoPath, diffMode, options),
localReviewCaptureContext: (request) => rpc('local-review:capture-context', request),
localReviewRefreshContext: (request) => rpc('local-review:refresh-context', request),
localReviewGetContextKey: (request) => rpc('local-review:get-context-key', request),
localReviewGetFileContent: (contextKey, filePath, version) => rpc('local-review:get-file-content', contextKey, filePath, version),
localReviewCreateReviewContextInfo: (contextPath, repoPath) => rpc('local-review:create-review-context-info', contextPath, repoPath),
localReviewListReviews: (contextKey) => rpc('local-review:list-reviews', contextKey),
localReviewLoadReviewSession: (contextKey, sessionId) => rpc('local-review:load-review-session', contextKey, sessionId),
localReviewSaveReviewSession: (contextKey, sessionId, displayName, provider, comments, preset, customPrompt) => rpc('local-review:save-review-session', contextKey, sessionId, displayName, provider, comments, preset, customPrompt),
localReviewDeleteReviewSession: (contextKey, sessionId) => rpc('local-review:delete-review-session', contextKey, sessionId),
localReviewListWalkthroughs: (contextKey) => rpc('local-review:list-walkthroughs', contextKey),
localReviewLoadWalkthroughSession: (contextKey, sessionId) => rpc('local-review:load-walkthrough-session', contextKey, sessionId),
localReviewSaveWalkthroughSession: (contextKey, sessionId, displayName, provider, walkthrough, preset, customPrompt) => rpc('local-review:save-walkthrough-session', contextKey, sessionId, displayName, provider, walkthrough, preset, customPrompt),
localReviewDeleteWalkthroughSession: (contextKey, sessionId) => rpc('local-review:delete-walkthrough-session', contextKey, sessionId),
localReviewLoadComments: (contextKey) => rpc('local-review:load-comments', contextKey),
localReviewSaveComments: (contextKey, comments) => rpc('local-review:save-comments', contextKey, comments),
localReviewLoadFixTracker: (contextKey) => rpc('local-review:load-fix-tracker', contextKey),
localReviewMarkFixed: (contextKey, fix) => rpc('local-review:mark-fixed', contextKey, fix),
```

**Step 3: Verify it compiles**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`

**Step 4: Commit**

```bash
git add src/renderer/api.d.ts src/renderer/tauri-api.ts
git commit -m "feat(local-review): add renderer API declarations and WebSocket bridge wiring"
```

---

## Task 8: Add Local Review Section to PR Home View

**Files:**
- Modify: `src/renderer/components/pr-home-view.ts`

This is the entry point UI. Add a "Local Review" section below the PR list that shows linked repositories, their worktrees, and a custom path option. Each repo/worktree can be expanded to show the inline diff mode selector.

**Step 1: Add local review tab and section to render()**

In the `render()` method (~line 129), add a new tab for "Local" alongside existing tabs (review, created, monitored). Add the corresponding list container.

**Step 2: Add `renderLocalReviewSection()` method**

New method that:
1. Loads linked repositories via `window.electronAPI.getConsoleReviewSettings()`
2. For each linked repo, fetches worktrees via `window.electronAPI.gitListWorktrees(repo.path)`
3. Renders each repo as a card with repo name, path, and expand button
4. Renders worktrees nested under each repo
5. Adds "+ Custom Path" button at the bottom
6. Each card click expands inline diff mode selector

**Step 3: Add `renderDiffModeSelector(repoPath)` method**

Renders inline when a repo/worktree is clicked:
- 4 quick mode buttons (Uncommitted, Staged, All Local, Branch Compare)
- Branch compare: dropdown for base branch (populated from `localReviewGetBranches`)
- Expandable "Commit Range" with from/to dropdowns (populated from `localReviewGetRecentCommits`)
- "Open Review" button

**Step 4: Add callback and event handling**

- Add `onOpenLocalReview(callback: (request: LocalReviewRequest) => void)` callback
- Wire button clicks to populate request and invoke callback
- Custom path: uses `window.electronAPI.showOpenDialog` for folder selection, validates with `gitIsRepo`

**Step 5: Style the section**

Add CSS in the component's styles for:
- `.local-repo-card` — Clean card with repo name, path, subtle border
- `.diff-mode-selector` — Inline expandable with smooth animation
- `.diff-mode-btn` — Modern pill buttons for quick modes
- `.branch-selector`, `.commit-selector` — Clean dropdown styling
- `.open-review-btn` — Primary action button

**Step 6: Commit**

```bash
git add src/renderer/components/pr-home-view.ts
git commit -m "feat(local-review): add Local Review section to PR Home view"
```

---

## Task 9: Add LocalReviewTabState and Tab Management to app.ts

**Files:**
- Modify: `src/renderer/app.ts`

This is the largest task — wiring up the local review tab lifecycle in the main app orchestrator. Follow the existing `PRTabState` and `openPRTab`/`loadPullRequest` patterns.

**Step 1: Add `LocalReviewTabState` interface**

Add alongside `PRTabState` (~line 84):

```typescript
interface LocalReviewTabState {
  type: 'local-review';
  repoPath: string;
  repoName: string;
  diffMode: LocalDiffMode;
  baseBranch?: string;
  targetBranch?: string;
  fromCommit?: string;
  toCommit?: string;
  contextKey: string;
  contextPath: string | null;
  fileChanges: FileChange[];
  selectedFile: string | null;
  threads: CommentThread[];         // Local user comments
  diffViewMode: 'split' | 'unified' | 'preview';
  aiSessionId: string | null;
  aiReviewInProgress: boolean;
  hasSavedReview: boolean;
  savedReviewInfo: SavedReviewInfo | null;
  aiPanelState?: AICommentsPanelState;
}
```

**Step 2: Extend `ReviewTab` interface**

Add `localState?: LocalReviewTabState` alongside existing `prState`.

**Step 3: Add `openLocalReviewTab(request: LocalReviewRequest)` method**

This method:
1. Computes context key via `localReviewGetContextKey(request)`
2. Checks if a tab with same context key already exists (reuse if so)
3. Creates new `ReviewTab` with `type: 'local-review'`, appropriate label
4. Calls `loadLocalReview(request)` to capture context and populate file list

**Step 4: Add `loadLocalReview(request)` method**

This method:
1. Calls `localReviewCaptureContext(request)` — gets files + context path
2. Populates `localState.fileChanges` from result
3. Loads saved user comments via `localReviewLoadComments(contextKey)`
4. Assigns threads to matching `FileChange` entries
5. Loads saved reviews/walkthroughs via `localReviewListReviews/Walkthroughs`
6. Renders file list and selects first file

**Step 5: Add `refreshLocalReview()` method**

Called when refresh button is clicked:
1. Re-captures context via `localReviewRefreshContext(request)`
2. Preserves current file selection if still in list
3. Reloads diff viewer

**Step 6: Wire PR Home callback**

Connect `prHomeView.onOpenLocalReview()` to `openLocalReviewTab()`.

**Step 7: Adapt shared tab rendering**

When rendering a local review tab:
- File list sidebar uses `localState.fileChanges`
- File content loaded via `localReviewGetFileContent(contextKey, path, version)` (lazy-load pattern)
- Diff viewer receives `FileChange` (same as PR)
- AI review panel uses same `showReviewDialog()` → start review flow
- No iteration selector, no publish buttons, no polling
- Show refresh button in toolbar
- Comments panel shows local threads (not ADO)

**Step 8: Wire AI review for local context**

When AI review is started from a local tab:
- Call `localReviewCreateReviewContextInfo(contextPath, repoPath)` to get `ReviewContextInfo`
- Pass to `aiStartReview()` with synthetic PR context from `pr.json`
- AI progress/comment/walkthrough events work unchanged
- Save review via `localReviewSaveReviewSession(contextKey, ...)`

**Step 9: Wire Apply Changes for local context**

When Apply is clicked on a comment in local review:
- Initialize apply queue with `contextKey` as key
- Use repo path directly as working directory (no worktree)
- Commit format: `fix(local-review): <comment>`

**Step 10: Wire user comments for local review**

When user adds a comment via gutter selection:
- Create `CommentThread` with auto-incrementing local ID
- Add to `localState.threads`
- Persist via `localReviewSaveComments(contextKey, threads)`
- Update `FileChange.threads` for the affected file
- Re-render diff viewer comment badges

**Step 11: Commit**

```bash
git add src/renderer/app.ts
git commit -m "feat(local-review): add local review tab lifecycle and state management"
```

---

## Task 10: Integration Testing and Polish

**Files:**
- All modified files from previous tasks

**Step 1: Build and verify no compile errors**

Run: `npx tsc --noEmit --project tsconfig.json`
Expected: Clean build (or only pre-existing errors unrelated to local review).

**Step 2: Manual testing checklist**

Test each diff mode:
- [ ] Open PR Home → Local Review section shows linked repos
- [ ] Click repo → diff mode selector expands inline
- [ ] Select "Uncommitted" → tab opens, file list shows, diffs render
- [ ] Select "Staged" → same flow with staged changes only
- [ ] Select "All Local" → same flow with combined changes
- [ ] Select "Branch Compare" → branch dropdown populates, diffs render
- [ ] Select "Commit Range" → commit dropdowns populate, diffs render
- [ ] Click Refresh → files re-captured, diff viewer updates
- [ ] Add user comment via gutter → comment appears in Comments Panel
- [ ] Start AI review → review dialog works, comments appear in AI Panel
- [ ] Apply a comment → queue item processes, commit created
- [ ] Generate walkthrough → walkthrough renders
- [ ] Close and reopen tab → saved reviews/walkthroughs persist
- [ ] Custom path → folder picker works, validates git repo

**Step 3: Fix any issues found**

Address any bugs discovered during testing.

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(local-review): integration fixes and polish"
```

---

## Task Summary

| Task | Description | Dependencies |
|------|------------|-------------|
| 1 | Shared types | None |
| 2 | LocalDiffService (backend git ops) | Task 1 |
| 3 | LocalContextService (context dirs) | Tasks 1, 2 |
| 4 | Storage methods in AIStorageService | Task 1 |
| 5 | Fix tracker methods | Task 1 |
| 6 | Backend RPC handlers | Tasks 2, 3, 4, 5 |
| 7 | Renderer API declarations | Task 6 |
| 8 | PR Home UI (entry point) | Task 7 |
| 9 | App.ts tab lifecycle (largest) | Tasks 7, 8 |
| 10 | Integration testing | All |

Tasks 2-5 are independent of each other and can be parallelized.
Tasks 4 and 5 are small and quick.
Task 9 is the largest and most complex — it touches the main orchestrator.
