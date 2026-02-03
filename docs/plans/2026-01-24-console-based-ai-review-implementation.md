# Console-Based AI Review Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a console-based "Deep Review" option that launches Claude Code CLI with full repository context via git worktrees.

**Architecture:** Spawn Claude Code in a PTY terminal, copy PR data to temp folder, optionally use git worktrees for full repo context, monitor a GUID completion file to detect when review is done, display terminals in a new sidebar section.

**Tech Stack:** node-pty, xterm.js, Electron IPC, git worktrees, fs.watch

---

## Task 1: Add Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Add terminal dependencies**

Add to `dependencies` in `package.json`:
```json
"@lydell/node-pty": "^1.2.0-beta.3",
"@xterm/xterm": "^5.5.0",
"@xterm/addon-fit": "^0.10.0"
```

**Step 2: Install dependencies**

Run: `npm install`
Expected: Dependencies installed successfully

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add node-pty and xterm.js for terminal support"
```

---

## Task 2: Create Terminal Types

**Files:**
- Create: `src/shared/terminal-types.ts`

**Step 1: Write the terminal types file**

```typescript
// Terminal session types for console-based AI review

export interface TerminalSession {
  id: string;
  label: string;
  status: 'starting' | 'running' | 'completed' | 'error';
  prId: number;
  organization: string;
  project: string;
  workingDir: string;
  contextPath: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export interface CreateTerminalOptions {
  prId: number;
  organization: string;
  project: string;
  label: string;
  workingDir: string;
  contextPath: string;
  prompt: string;
}

export interface ConsoleReviewResult {
  status: 'complete' | 'error';
  reviewPath: string;
  walkthroughPath: string;
  filesReviewed: number;
  commentsGenerated: number;
  error: string | null;
}

export interface ConsoleReviewSettings {
  repoBaseFolders: string[];
  whenRepoFound: 'ask' | 'worktree' | 'tempOnly';
  whenRepoNotFound: 'ask' | 'immediate' | 'clone';
  autoCloseTerminal: boolean;
  showNotification: boolean;
  worktreeCleanup: 'ask' | 'auto' | 'never';
}

export const DEFAULT_CONSOLE_REVIEW_SETTINGS: ConsoleReviewSettings = {
  repoBaseFolders: [],
  whenRepoFound: 'worktree',
  whenRepoNotFound: 'immediate',
  autoCloseTerminal: true,
  showNotification: true,
  worktreeCleanup: 'auto',
};
```

**Step 2: Commit**

```bash
git add src/shared/terminal-types.ts
git commit -m "feat: add terminal and console review types"
```

---

## Task 3: Create WorktreeService

**Files:**
- Create: `src/main/git/worktree-service.ts`

**Step 1: Write the worktree service**

```typescript
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export interface RepoMatch {
  path: string;
  remote: string;
  isExactMatch: boolean;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

export class WorktreeService {
  private baseFolders: string[];

  constructor(baseFolders: string[]) {
    this.baseFolders = baseFolders;
  }

  setBaseFolders(folders: string[]): void {
    this.baseFolders = folders;
  }

  findLocalRepo(repoUrl: string, repoName: string): RepoMatch | null {
    for (const baseFolder of this.baseFolders) {
      if (!fs.existsSync(baseFolder)) continue;

      // Direct name match
      const directPath = path.join(baseFolder, repoName);
      if (this.isGitRepo(directPath)) {
        if (this.remoteMatches(directPath, repoUrl)) {
          return { path: directPath, remote: repoUrl, isExactMatch: true };
        }
      }

      // Scan subfolders
      try {
        const subdirs = fs.readdirSync(baseFolder, { withFileTypes: true });
        for (const subdir of subdirs) {
          if (!subdir.isDirectory()) continue;
          const repoPath = path.join(baseFolder, subdir.name);
          if (this.isGitRepo(repoPath) && this.remoteMatches(repoPath, repoUrl)) {
            return { path: repoPath, remote: repoUrl, isExactMatch: subdir.name === repoName };
          }
        }
      } catch (error) {
        console.error(`Error scanning ${baseFolder}:`, error);
      }
    }
    return null;
  }

  listWorktrees(repoPath: string): WorktreeInfo[] {
    try {
      const output = execSync(`git worktree list --porcelain`, {
        cwd: repoPath,
        encoding: 'utf-8',
      });

      const worktrees: WorktreeInfo[] = [];
      const entries = output.trim().split('\n\n');

      for (const entry of entries) {
        const lines = entry.split('\n');
        const worktree: Partial<WorktreeInfo> = {};

        for (const line of lines) {
          if (line.startsWith('worktree ')) {
            worktree.path = line.substring(9);
          } else if (line.startsWith('HEAD ')) {
            worktree.head = line.substring(5);
          } else if (line.startsWith('branch ')) {
            worktree.branch = line.substring(7).replace('refs/heads/', '');
          }
        }

        if (worktree.path && worktree.head) {
          worktrees.push(worktree as WorktreeInfo);
        }
      }

      return worktrees;
    } catch (error) {
      console.error('Error listing worktrees:', error);
      return [];
    }
  }

  findWorktreeForBranch(repoPath: string, branch: string): WorktreeInfo | null {
    const worktrees = this.listWorktrees(repoPath);
    const normalizedBranch = branch.replace('refs/heads/', '');
    return worktrees.find(w => w.branch === normalizedBranch) || null;
  }

  createWorktree(repoPath: string, branch: string, prId: number): WorktreeInfo {
    const normalizedBranch = branch.replace('refs/heads/', '');
    const worktreesDir = `${repoPath}-worktrees`;
    const worktreePath = path.join(worktreesDir, `pr-${prId}`);

    // Create worktrees directory if needed
    if (!fs.existsSync(worktreesDir)) {
      fs.mkdirSync(worktreesDir, { recursive: true });
    }

    // Fetch the branch
    try {
      execSync(`git fetch origin ${normalizedBranch}`, {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch (error) {
      console.warn('Fetch warning (may be ok):', error);
    }

    // Create worktree
    execSync(`git worktree add "${worktreePath}" origin/${normalizedBranch}`, {
      cwd: repoPath,
      encoding: 'utf-8',
    });

    // Get HEAD commit
    const head = execSync('git rev-parse HEAD', {
      cwd: worktreePath,
      encoding: 'utf-8',
    }).trim();

    return { path: worktreePath, branch: normalizedBranch, head };
  }

  syncWorktree(worktreePath: string, branch: string): void {
    const normalizedBranch = branch.replace('refs/heads/', '');
    execSync(`git fetch origin ${normalizedBranch}`, {
      cwd: worktreePath,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    execSync(`git checkout origin/${normalizedBranch}`, {
      cwd: worktreePath,
      encoding: 'utf-8',
    });
  }

  removeWorktree(repoPath: string, worktreePath: string): void {
    execSync(`git worktree remove "${worktreePath}" --force`, {
      cwd: repoPath,
      encoding: 'utf-8',
    });
  }

  private isGitRepo(dirPath: string): boolean {
    try {
      return fs.existsSync(path.join(dirPath, '.git'));
    } catch {
      return false;
    }
  }

  private remoteMatches(repoPath: string, targetUrl: string): boolean {
    try {
      const remotes = execSync('git remote -v', {
        cwd: repoPath,
        encoding: 'utf-8',
      });

      // Normalize URLs for comparison
      const normalizeUrl = (url: string) => {
        return url
          .replace(/\.git$/, '')
          .replace(/^https?:\/\//, '')
          .replace(/^git@([^:]+):/, '$1/')
          .toLowerCase();
      };

      const targetNormalized = normalizeUrl(targetUrl);
      return remotes.split('\n').some(line => {
        const match = line.match(/\s+([^\s]+)\s+/);
        if (match) {
          return normalizeUrl(match[1]) === targetNormalized;
        }
        return false;
      });
    } catch {
      return false;
    }
  }
}

let worktreeService: WorktreeService | null = null;

export function getWorktreeService(baseFolders: string[] = []): WorktreeService {
  if (!worktreeService) {
    worktreeService = new WorktreeService(baseFolders);
  } else {
    worktreeService.setBaseFolders(baseFolders);
  }
  return worktreeService;
}
```

**Step 2: Commit**

```bash
git add src/main/git/worktree-service.ts
git commit -m "feat: add WorktreeService for git worktree management"
```

---

## Task 4: Create TerminalManager

**Files:**
- Create: `src/main/terminal/terminal-manager.ts`

**Step 1: Write the terminal manager**

```typescript
import * as pty from '@lydell/node-pty';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { TerminalSession, CreateTerminalOptions } from '../../shared/terminal-types.js';

interface IPtyProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (exitInfo: { exitCode: number }) => void): void;
}

interface SessionInternal extends TerminalSession {
  ptyProcess: IPtyProcess | null;
  completionWatcher: fs.FSWatcher | null;
}

export class TerminalManager extends EventEmitter {
  private sessions: Map<string, SessionInternal> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  getShell(): string {
    return process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
  }

  createSession(options: CreateTerminalOptions): string {
    const id = uuidv4();
    const session: SessionInternal = {
      id,
      label: options.label,
      status: 'starting',
      prId: options.prId,
      organization: options.organization,
      project: options.project,
      workingDir: options.workingDir,
      contextPath: options.contextPath,
      createdAt: new Date().toISOString(),
      ptyProcess: null,
      completionWatcher: null,
    };

    this.sessions.set(id, session);

    // Spawn PTY
    const ptyProcess = pty.spawn(this.getShell(), [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: options.workingDir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    }) as IPtyProcess;

    session.ptyProcess = ptyProcess;

    // Forward PTY data
    ptyProcess.onData((data: string) => {
      this.emit('data', { sessionId: id, data });
    });

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      session.status = exitCode === 0 ? 'completed' : 'error';
      session.completedAt = new Date().toISOString();
      this.emit('exit', { sessionId: id, exitCode });
      this.emit('status-change', { sessionId: id, status: session.status });
    });

    // Start completion file watcher
    this.startCompletionWatcher(id, options.contextPath);

    // Launch Claude Code after shell initializes
    setTimeout(() => {
      if (session.ptyProcess) {
        const escapedPrompt = options.prompt.replace(/"/g, '\\"');
        session.ptyProcess.write(`claude --dangerously-skip-permissions "${escapedPrompt}"\r`);
        session.status = 'running';
        this.emit('status-change', { sessionId: id, status: 'running' });
      }
    }, 500);

    return id;
  }

  private startCompletionWatcher(sessionId: string, contextPath: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const completionFile = path.join(contextPath, `${sessionId}.done.json`);

    // Ensure output directory exists
    const outputDir = path.join(contextPath, 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const checkCompletion = () => {
      if (fs.existsSync(completionFile)) {
        try {
          const content = fs.readFileSync(completionFile, 'utf-8');
          const result = JSON.parse(content);
          this.emit('review-complete', { sessionId, result });

          // Stop watcher
          if (session.completionWatcher) {
            session.completionWatcher.close();
            session.completionWatcher = null;
          }
        } catch (error) {
          console.error('Error reading completion file:', error);
        }
      }
    };

    // Watch the context directory for the completion file
    try {
      session.completionWatcher = fs.watch(contextPath, (eventType, filename) => {
        if (filename === `${sessionId}.done.json`) {
          // Debounce
          const existing = this.debounceTimers.get(sessionId);
          if (existing) clearTimeout(existing);

          this.debounceTimers.set(sessionId, setTimeout(() => {
            checkCompletion();
            this.debounceTimers.delete(sessionId);
          }, 300));
        }
      });
    } catch (error) {
      console.error('Error starting completion watcher:', error);
    }
  }

  getSession(id: string): TerminalSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;

    // Return without internal fields
    const { ptyProcess, completionWatcher, ...publicSession } = session;
    return publicSession;
  }

  getAllSessions(): TerminalSession[] {
    return Array.from(this.sessions.values()).map(s => {
      const { ptyProcess, completionWatcher, ...publicSession } = s;
      return publicSession;
    });
  }

  writeToSession(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (session?.ptyProcess) {
      session.ptyProcess.write(data);
    }
  }

  resizeSession(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (session?.ptyProcess) {
      session.ptyProcess.resize(cols, rows);
    }
  }

  killSession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      if (session.ptyProcess) {
        session.ptyProcess.kill();
      }
      if (session.completionWatcher) {
        session.completionWatcher.close();
      }
      const timer = this.debounceTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        this.debounceTimers.delete(id);
      }
      session.status = 'completed';
      session.completedAt = new Date().toISOString();
      this.emit('status-change', { sessionId: id, status: 'completed' });
    }
  }

  removeSession(id: string): void {
    this.killSession(id);
    this.sessions.delete(id);
  }

  dispose(): void {
    for (const [id] of this.sessions) {
      this.killSession(id);
    }
    this.sessions.clear();
  }
}

let terminalManager: TerminalManager | null = null;

export function getTerminalManager(): TerminalManager {
  if (!terminalManager) {
    terminalManager = new TerminalManager();
  }
  return terminalManager;
}

export function disposeTerminalManager(): void {
  if (terminalManager) {
    terminalManager.dispose();
    terminalManager = null;
  }
}
```

**Step 2: Commit**

```bash
git add src/main/terminal/terminal-manager.ts
git commit -m "feat: add TerminalManager for PTY session management"
```

---

## Task 5: Create Review Prompt Builder

**Files:**
- Create: `src/main/terminal/review-prompt.ts`

**Step 1: Write the prompt builder**

```typescript
export interface ReviewPromptOptions {
  guid: string;
  contextPath: string;
  hasRepoContext: boolean;
  repoPath?: string;
}

export function buildReviewPrompt(options: ReviewPromptOptions): string {
  const { guid, contextPath, hasRepoContext, repoPath } = options;

  // === SKILL-EXTRACTABLE SECTION START ===
  const reviewInstructions = `You are performing a code review for a Pull Request.

## Context Location
- PR metadata: ${contextPath}/context/pr.json
- Existing comments: ${contextPath}/context/comments.json
- Changed files list: ${contextPath}/context/files.json
- Original files: ${contextPath}/original/
- Modified files: ${contextPath}/modified/
- Diff files: ${contextPath}/diffs/
${hasRepoContext ? `- Full repository: ${repoPath} (use for deeper architectural context)` : ''}

## Your Task
1. Read pr.json to understand the PR purpose and context
2. Read comments.json to see existing feedback (avoid duplicating)
3. Review each diff file in diffs/, comparing original vs modified versions
4. ${hasRepoContext ? 'Use the full repo to understand architectural impact and patterns' : 'Focus analysis on the changed files provided'}
5. Use the Task tool to parallelize review of independent files for efficiency
6. Write your findings to the output files specified below

## Review Criteria
Evaluate each change for:
- **Security**: Injection vulnerabilities, authentication issues, data exposure, OWASP top 10
- **Bugs**: Logic errors, null/undefined handling, edge cases, race conditions
- **Performance**: N+1 queries, unnecessary loops, memory leaks, inefficient algorithms
- **Code Quality**: Readability, naming conventions, code duplication, SOLID principles
- **Testing**: Missing test coverage for new or changed code paths

## Output Format

### ${contextPath}/output/review.json
Write a JSON file with this structure:
{
  "comments": [
    {
      "id": "unique-uuid",
      "filePath": "/src/example.ts",
      "startLine": 42,
      "endLine": 45,
      "severity": "warning",
      "category": "security",
      "title": "Short summary of the issue",
      "content": "Detailed explanation in markdown format",
      "suggestedFix": "Optional code suggestion",
      "confidence": 0.85
    }
  ]
}

Severity values: "critical" | "warning" | "suggestion" | "praise"
Category values: "security" | "bug" | "performance" | "style" | "logic" | "testing"
Confidence: 0.0 to 1.0

### ${contextPath}/output/walkthrough.json
Write a JSON file with this structure:
{
  "summary": "Markdown overview of what this PR accomplishes",
  "architectureDiagram": "Optional mermaid diagram showing component relationships",
  "steps": [
    {
      "order": 1,
      "filePath": "/src/example.ts",
      "startLine": 10,
      "endLine": 25,
      "title": "Step title describing this part",
      "description": "Explanation of what this code does and why"
    }
  ]
}

### ${contextPath}/${guid}.done.json (WRITE THIS LAST)
After completing review.json and walkthrough.json, write:
{
  "status": "complete",
  "reviewPath": "./output/review.json",
  "walkthroughPath": "./output/walkthrough.json",
  "filesReviewed": <number of files reviewed>,
  "commentsGenerated": <number of comments>,
  "error": null
}

## Important Rules
1. Write ${guid}.done.json ONLY after review.json and walkthrough.json are fully written
2. If you encounter an error that prevents completion, still write ${guid}.done.json with:
   { "status": "error", "error": "description of what went wrong", ... }
3. Be thorough but concise - focus on actionable feedback
4. Praise good code patterns, not just problems
5. Consider the PR description context when reviewing`;
  // === SKILL-EXTRACTABLE SECTION END ===

  return reviewInstructions;
}
```

**Step 2: Commit**

```bash
git add src/main/terminal/review-prompt.ts
git commit -m "feat: add review prompt builder for Claude Code"
```

---

## Task 6: Create ConsoleReviewService

**Files:**
- Create: `src/main/terminal/console-review-service.ts`

**Step 1: Write the console review service**

```typescript
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getTerminalManager } from './terminal-manager.js';
import { buildReviewPrompt } from './review-prompt.js';
import { getWorktreeService } from '../git/worktree-service.js';
import type { PRContext } from '../../shared/ai-types.js';
import type { FileChange } from '../../shared/types.js';
import type { CommentThread } from '../../shared/types.js';
import type { ConsoleReviewSettings } from '../../shared/terminal-types.js';

export interface PreparedReviewContext {
  guid: string;
  contextPath: string;
  workingDir: string;
  hasRepoContext: boolean;
  repoPath?: string;
}

export class ConsoleReviewService {
  private reviewsDir: string;

  constructor() {
    this.reviewsDir = path.join(app.getPath('userData'), 'taskdock', 'console-reviews');
    if (!fs.existsSync(this.reviewsDir)) {
      fs.mkdirSync(this.reviewsDir, { recursive: true });
    }
  }

  async prepareReviewContext(
    prContext: PRContext,
    files: FileChange[],
    threads: CommentThread[],
    settings: ConsoleReviewSettings,
    fileContents: Map<string, { original: string | null; modified: string | null }>
  ): Promise<PreparedReviewContext> {
    const guid = uuidv4();
    const contextPath = path.join(this.reviewsDir, guid);

    // Create directory structure
    fs.mkdirSync(path.join(contextPath, 'context'), { recursive: true });
    fs.mkdirSync(path.join(contextPath, 'original'), { recursive: true });
    fs.mkdirSync(path.join(contextPath, 'modified'), { recursive: true });
    fs.mkdirSync(path.join(contextPath, 'diffs'), { recursive: true });
    fs.mkdirSync(path.join(contextPath, 'output'), { recursive: true });

    // Write PR metadata
    fs.writeFileSync(
      path.join(contextPath, 'context', 'pr.json'),
      JSON.stringify({
        id: prContext.prId,
        title: prContext.title,
        description: prContext.description,
        author: prContext.author,
        sourceBranch: prContext.sourceBranch,
        targetBranch: prContext.targetBranch,
        repository: prContext.repository,
      }, null, 2)
    );

    // Write existing comments
    const formattedThreads = threads.map(t => ({
      id: t.id,
      filePath: t.threadContext?.filePath || null,
      line: t.threadContext?.rightFileStart?.line || null,
      status: t.status,
      comments: t.comments.map(c => ({
        author: c.author?.displayName || 'Unknown',
        content: c.content,
      })),
    }));
    fs.writeFileSync(
      path.join(contextPath, 'context', 'comments.json'),
      JSON.stringify({ threads: formattedThreads }, null, 2)
    );

    // Write files list
    fs.writeFileSync(
      path.join(contextPath, 'context', 'files.json'),
      JSON.stringify(files.map(f => ({
        path: f.path,
        changeType: f.changeType,
      })), null, 2)
    );

    // Write file contents and diffs
    for (const file of files) {
      const contents = fileContents.get(file.path);
      if (!contents) continue;

      const safePath = file.path.replace(/^\//, '');

      if (contents.original !== null) {
        const originalPath = path.join(contextPath, 'original', safePath);
        fs.mkdirSync(path.dirname(originalPath), { recursive: true });
        fs.writeFileSync(originalPath, contents.original);
      }

      if (contents.modified !== null) {
        const modifiedPath = path.join(contextPath, 'modified', safePath);
        fs.mkdirSync(path.dirname(modifiedPath), { recursive: true });
        fs.writeFileSync(modifiedPath, contents.modified);
      }

      // Generate diff
      if (contents.original !== null || contents.modified !== null) {
        const diffPath = path.join(contextPath, 'diffs', `${safePath}.diff`);
        fs.mkdirSync(path.dirname(diffPath), { recursive: true });
        const diff = this.generateUnifiedDiff(
          file.path,
          contents.original || '',
          contents.modified || ''
        );
        fs.writeFileSync(diffPath, diff);
      }
    }

    // Check for local repo
    let workingDir = contextPath;
    let hasRepoContext = false;
    let repoPath: string | undefined;

    const worktreeService = getWorktreeService(settings.repoBaseFolders);
    const repoUrl = `https://dev.azure.com/${prContext.repository}`;
    const repoMatch = worktreeService.findLocalRepo(repoUrl, prContext.repository);

    if (repoMatch && settings.whenRepoFound !== 'tempOnly') {
      // Try to use worktree
      const existingWorktree = worktreeService.findWorktreeForBranch(
        repoMatch.path,
        prContext.sourceBranch
      );

      if (existingWorktree) {
        worktreeService.syncWorktree(existingWorktree.path, prContext.sourceBranch);
        workingDir = existingWorktree.path;
        hasRepoContext = true;
        repoPath = existingWorktree.path;
      } else {
        try {
          const newWorktree = worktreeService.createWorktree(
            repoMatch.path,
            prContext.sourceBranch,
            prContext.prId
          );
          workingDir = newWorktree.path;
          hasRepoContext = true;
          repoPath = newWorktree.path;
        } catch (error) {
          console.error('Failed to create worktree:', error);
          // Fall back to temp folder
        }
      }
    }

    return {
      guid,
      contextPath,
      workingDir,
      hasRepoContext,
      repoPath,
    };
  }

  startReview(prepared: PreparedReviewContext): string {
    const terminalManager = getTerminalManager();
    const prompt = buildReviewPrompt({
      guid: prepared.guid,
      contextPath: prepared.contextPath,
      hasRepoContext: prepared.hasRepoContext,
      repoPath: prepared.repoPath,
    });

    return terminalManager.createSession({
      prId: 0, // Will be set by caller
      organization: '',
      project: '',
      label: `Review ${prepared.guid.substring(0, 8)}`,
      workingDir: prepared.workingDir,
      contextPath: prepared.contextPath,
      prompt,
    });
  }

  private generateUnifiedDiff(filePath: string, original: string, modified: string): string {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');

    let diff = `--- a${filePath}\n+++ b${filePath}\n`;

    // Simple line-by-line diff (for a proper diff, use the 'diff' package)
    const maxLines = Math.max(originalLines.length, modifiedLines.length);
    let hunkStart = -1;
    let hunkLines: string[] = [];

    for (let i = 0; i < maxLines; i++) {
      const origLine = originalLines[i];
      const modLine = modifiedLines[i];

      if (origLine !== modLine) {
        if (hunkStart === -1) {
          hunkStart = i + 1;
          // Add context before
          for (let j = Math.max(0, i - 3); j < i; j++) {
            if (originalLines[j] !== undefined) {
              hunkLines.push(` ${originalLines[j]}`);
            }
          }
        }
        if (origLine !== undefined) {
          hunkLines.push(`-${origLine}`);
        }
        if (modLine !== undefined) {
          hunkLines.push(`+${modLine}`);
        }
      } else if (hunkStart !== -1) {
        // Add context after
        hunkLines.push(` ${origLine}`);
        if (hunkLines.filter(l => l.startsWith(' ')).length >= 3) {
          diff += `@@ -${hunkStart},${hunkLines.filter(l => l.startsWith('-') || l.startsWith(' ')).length} `;
          diff += `+${hunkStart},${hunkLines.filter(l => l.startsWith('+') || l.startsWith(' ')).length} @@\n`;
          diff += hunkLines.join('\n') + '\n';
          hunkStart = -1;
          hunkLines = [];
        }
      }
    }

    if (hunkLines.length > 0) {
      diff += `@@ -${hunkStart} +${hunkStart} @@\n`;
      diff += hunkLines.join('\n') + '\n';
    }

    return diff;
  }

  cleanupContext(contextPath: string): void {
    try {
      fs.rmSync(contextPath, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to cleanup context:', error);
    }
  }
}

let consoleReviewService: ConsoleReviewService | null = null;

export function getConsoleReviewService(): ConsoleReviewService {
  if (!consoleReviewService) {
    consoleReviewService = new ConsoleReviewService();
  }
  return consoleReviewService;
}
```

**Step 2: Commit**

```bash
git add src/main/terminal/console-review-service.ts
git commit -m "feat: add ConsoleReviewService for orchestrating console reviews"
```

---

## Task 7: Update Store Defaults and Add IPC Handlers

**Files:**
- Modify: `src/main/main.ts`

**Step 1: Add imports at the top of main.ts (after line 16)**

```typescript
import { getTerminalManager, disposeTerminalManager } from './terminal/terminal-manager.js';
import { getConsoleReviewService } from './terminal/console-review-service.js';
import { getWorktreeService } from './git/worktree-service.js';
import type { ConsoleReviewSettings } from '../shared/terminal-types.js';
import { DEFAULT_CONSOLE_REVIEW_SETTINGS } from '../shared/terminal-types.js';
```

**Step 2: Update store defaults (replace lines 22-31)**

```typescript
const store = new Store({
  defaults: {
    organization: '',
    project: '',
    theme: 'system',
    diffViewMode: 'split',
    sidebarCollapsed: false,
    windowBounds: { width: 1400, height: 900 },
    consoleReview: DEFAULT_CONSOLE_REVIEW_SETTINGS,
  },
});
```

**Step 3: Add terminal IPC handlers inside setupIpcHandlers() before the closing brace**

```typescript
  // Terminal IPC handlers
  const terminalManager = getTerminalManager();
  const consoleReviewService = getConsoleReviewService();

  // Forward terminal events
  terminalManager.on('data', (event) => {
    mainWindow?.webContents.send('terminal:data', event);
  });
  terminalManager.on('exit', (event) => {
    mainWindow?.webContents.send('terminal:exit', event);
  });
  terminalManager.on('status-change', (event) => {
    mainWindow?.webContents.send('terminal:status-change', event);
  });
  terminalManager.on('review-complete', (event) => {
    mainWindow?.webContents.send('terminal:review-complete', event);
  });

  ipcMain.handle('terminal:list-sessions', () => {
    return terminalManager.getAllSessions();
  });

  ipcMain.handle('terminal:get-session', (_, sessionId: string) => {
    return terminalManager.getSession(sessionId);
  });

  ipcMain.on('terminal:write', (_, { sessionId, data }) => {
    terminalManager.writeToSession(sessionId, data);
  });

  ipcMain.on('terminal:resize', (_, { sessionId, cols, rows }) => {
    terminalManager.resizeSession(sessionId, cols, rows);
  });

  ipcMain.handle('terminal:kill', (_, sessionId: string) => {
    terminalManager.killSession(sessionId);
  });

  ipcMain.handle('terminal:remove', (_, sessionId: string) => {
    terminalManager.removeSession(sessionId);
  });

  // Console review handlers
  ipcMain.handle('console-review:prepare', async (_, { prContext, files, threads, fileContents }) => {
    const settings = store.get('consoleReview') as ConsoleReviewSettings;
    const contentsMap = new Map(Object.entries(fileContents));
    return consoleReviewService.prepareReviewContext(
      prContext,
      files,
      threads,
      settings,
      contentsMap as Map<string, { original: string | null; modified: string | null }>
    );
  });

  ipcMain.handle('console-review:start', (_, { prepared, prId, organization, project, label }) => {
    const terminalMgr = getTerminalManager();
    const prompt = buildReviewPrompt({
      guid: prepared.guid,
      contextPath: prepared.contextPath,
      hasRepoContext: prepared.hasRepoContext,
      repoPath: prepared.repoPath,
    });
    return terminalMgr.createSession({
      prId,
      organization,
      project,
      label,
      workingDir: prepared.workingDir,
      contextPath: prepared.contextPath,
      prompt,
    });
  });

  ipcMain.handle('console-review:cleanup', (_, contextPath: string) => {
    consoleReviewService.cleanupContext(contextPath);
  });

  // Git/Worktree handlers
  ipcMain.handle('git:find-repo', (_, { repoUrl, repoName }) => {
    const settings = store.get('consoleReview') as ConsoleReviewSettings;
    const worktreeService = getWorktreeService(settings.repoBaseFolders);
    return worktreeService.findLocalRepo(repoUrl, repoName);
  });

  ipcMain.handle('git:list-worktrees', (_, repoPath: string) => {
    const settings = store.get('consoleReview') as ConsoleReviewSettings;
    const worktreeService = getWorktreeService(settings.repoBaseFolders);
    return worktreeService.listWorktrees(repoPath);
  });

  // Console review settings handlers
  ipcMain.handle('config:get-console-review-settings', () => {
    return store.get('consoleReview') as ConsoleReviewSettings;
  });

  ipcMain.handle('config:set-console-review-settings', (_, settings: ConsoleReviewSettings) => {
    store.set('consoleReview', settings);
  });

  ipcMain.handle('config:browse-folder', async () => {
    const { dialog } = await import('electron');
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
```

**Step 4: Add buildReviewPrompt import**

Add to imports at top:
```typescript
import { buildReviewPrompt } from './terminal/review-prompt.js';
```

**Step 5: Update app quit handler (find app.on('will-quit') and update)**

```typescript
app.on('will-quit', async () => {
  disposeTerminalManager();
  await disposeAIReviewService();
});
```

**Step 6: Commit**

```bash
git add src/main/main.ts
git commit -m "feat: add terminal and console review IPC handlers"
```

---

## Task 8: Update Preload Script

**Files:**
- Modify: `src/main/preload.ts`

**Step 1: Add terminal API methods after the Config API section (before the closing });)**

```typescript
  // Terminal API
  terminalListSessions: () => ipcRenderer.invoke('terminal:list-sessions'),
  terminalGetSession: (sessionId: string) => ipcRenderer.invoke('terminal:get-session', sessionId),
  terminalWrite: (sessionId: string, data: string) => ipcRenderer.send('terminal:write', { sessionId, data }),
  terminalResize: (sessionId: string, cols: number, rows: number) => ipcRenderer.send('terminal:resize', { sessionId, cols, rows }),
  terminalKill: (sessionId: string) => ipcRenderer.invoke('terminal:kill', sessionId),
  terminalRemove: (sessionId: string) => ipcRenderer.invoke('terminal:remove', sessionId),

  // Terminal event listeners
  onTerminalData: (callback: (event: { sessionId: string; data: string }) => void) => {
    ipcRenderer.on('terminal:data', (_, event) => callback(event));
    return () => ipcRenderer.removeAllListeners('terminal:data');
  },
  onTerminalExit: (callback: (event: { sessionId: string; exitCode: number }) => void) => {
    ipcRenderer.on('terminal:exit', (_, event) => callback(event));
    return () => ipcRenderer.removeAllListeners('terminal:exit');
  },
  onTerminalStatusChange: (callback: (event: { sessionId: string; status: string }) => void) => {
    ipcRenderer.on('terminal:status-change', (_, event) => callback(event));
    return () => ipcRenderer.removeAllListeners('terminal:status-change');
  },
  onTerminalReviewComplete: (callback: (event: { sessionId: string; result: any }) => void) => {
    ipcRenderer.on('terminal:review-complete', (_, event) => callback(event));
    return () => ipcRenderer.removeAllListeners('terminal:review-complete');
  },

  // Console review API
  consoleReviewPrepare: (params: { prContext: any; files: any[]; threads: any[]; fileContents: Record<string, { original: string | null; modified: string | null }> }) =>
    ipcRenderer.invoke('console-review:prepare', params),
  consoleReviewStart: (params: { prepared: any; prId: number; organization: string; project: string; label: string }) =>
    ipcRenderer.invoke('console-review:start', params),
  consoleReviewCleanup: (contextPath: string) =>
    ipcRenderer.invoke('console-review:cleanup', contextPath),

  // Git API
  gitFindRepo: (repoUrl: string, repoName: string) =>
    ipcRenderer.invoke('git:find-repo', { repoUrl, repoName }),
  gitListWorktrees: (repoPath: string) =>
    ipcRenderer.invoke('git:list-worktrees', repoPath),

  // Console review settings
  getConsoleReviewSettings: () => ipcRenderer.invoke('config:get-console-review-settings'),
  setConsoleReviewSettings: (settings: any) => ipcRenderer.invoke('config:set-console-review-settings', settings),
  browseFolder: () => ipcRenderer.invoke('config:browse-folder'),
```

**Step 2: Add corresponding type definitions to ElectronAPI interface**

```typescript
  // Terminal
  terminalListSessions: () => Promise<any[]>;
  terminalGetSession: (sessionId: string) => Promise<any>;
  terminalWrite: (sessionId: string, data: string) => void;
  terminalResize: (sessionId: string, cols: number, rows: number) => void;
  terminalKill: (sessionId: string) => Promise<void>;
  terminalRemove: (sessionId: string) => Promise<void>;
  onTerminalData: (callback: (event: { sessionId: string; data: string }) => void) => () => void;
  onTerminalExit: (callback: (event: { sessionId: string; exitCode: number }) => void) => () => void;
  onTerminalStatusChange: (callback: (event: { sessionId: string; status: string }) => void) => () => void;
  onTerminalReviewComplete: (callback: (event: { sessionId: string; result: any }) => void) => () => void;

  // Console review
  consoleReviewPrepare: (params: any) => Promise<any>;
  consoleReviewStart: (params: any) => Promise<string>;
  consoleReviewCleanup: (contextPath: string) => Promise<void>;

  // Git
  gitFindRepo: (repoUrl: string, repoName: string) => Promise<any>;
  gitListWorktrees: (repoPath: string) => Promise<any[]>;

  // Console review settings
  getConsoleReviewSettings: () => Promise<any>;
  setConsoleReviewSettings: (settings: any) => Promise<void>;
  browseFolder: () => Promise<string | null>;
```

**Step 3: Commit**

```bash
git add src/main/preload.ts
git commit -m "feat: expose terminal and console review APIs to renderer"
```

---

## Task 9: Update SectionSidebar

**Files:**
- Modify: `src/renderer/components/section-sidebar.ts`

**Step 1: Update SectionId type (line 1)**

```typescript
export type SectionId = 'review' | 'terminals' | 'settings';
```

**Step 2: Add terminals section to SECTIONS array (after review, before settings)**

```typescript
  {
    id: 'terminals',
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="4 17 10 11 4 5"/>
      <line x1="12" y1="19" x2="20" y2="19"/>
    </svg>`,
    label: 'Terminals',
  },
```

**Step 3: Commit**

```bash
git add src/renderer/components/section-sidebar.ts
git commit -m "feat: add Terminals section to sidebar"
```

---

## Task 10: Create TerminalsView Component

**Files:**
- Create: `src/renderer/components/terminals-view.ts`

**Step 1: Write the terminals view component**

```typescript
import type { TerminalSession } from '../../shared/terminal-types.js';

declare const Terminal: any;
declare const FitAddon: any;

export class TerminalsView {
  private container: HTMLElement;
  private sessions: TerminalSession[] = [];
  private activeSessionId: string | null = null;
  private terminals: Map<string, any> = new Map();
  private fitAddons: Map<string, any> = new Map();

  private selectCallback?: (sessionId: string) => void;
  private closeCallback?: (sessionId: string) => void;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.render();
    this.setupEventListeners();
  }

  onSelect(callback: (sessionId: string) => void): void {
    this.selectCallback = callback;
  }

  onClose(callback: (sessionId: string) => void): void {
    this.closeCallback = callback;
  }

  setSessions(sessions: TerminalSession[]): void {
    this.sessions = sessions;
    this.render();
  }

  setActiveSession(sessionId: string | null): void {
    this.activeSessionId = sessionId;
    this.updateActiveState();
    if (sessionId) {
      this.showTerminal(sessionId);
    }
  }

  addSession(session: TerminalSession): void {
    this.sessions.push(session);
    this.render();
    this.setActiveSession(session.id);
  }

  updateSession(sessionId: string, updates: Partial<TerminalSession>): void {
    const session = this.sessions.find(s => s.id === sessionId);
    if (session) {
      Object.assign(session, updates);
      this.render();
    }
  }

  removeSession(sessionId: string): void {
    this.sessions = this.sessions.filter(s => s.id !== sessionId);
    this.terminals.delete(sessionId);
    this.fitAddons.delete(sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = this.sessions[0]?.id || null;
    }
    this.render();
  }

  writeToTerminal(sessionId: string, data: string): void {
    const terminal = this.terminals.get(sessionId);
    if (terminal) {
      terminal.write(data);
    }
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="terminals-view">
        <div class="terminals-sidebar">
          <div class="terminals-header">
            <span>Terminals</span>
            <span class="terminal-count">${this.sessions.length}</span>
          </div>
          <div class="terminals-list">
            ${this.sessions.length === 0 ? `
              <div class="terminals-empty">
                <p>No active terminals</p>
                <p class="hint">Start a Deep Review to open a terminal</p>
              </div>
            ` : this.sessions.map(s => this.renderSessionItem(s)).join('')}
          </div>
        </div>
        <div class="terminal-panel">
          ${this.activeSessionId ? `
            <div class="terminal-toolbar">
              <span class="terminal-title">${this.getActiveSession()?.label || ''}</span>
              <div class="terminal-actions">
                <button class="btn btn-icon kill-btn" title="Stop">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                  </svg>
                </button>
                <button class="btn btn-icon close-btn" title="Close">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            </div>
            <div class="terminal-container" id="terminalContainer-${this.activeSessionId}"></div>
            <div class="terminal-status-bar">
              <span class="status-indicator ${this.getActiveSession()?.status || ''}">
                <span class="status-dot"></span>
                <span class="status-text">${this.getStatusText(this.getActiveSession()?.status)}</span>
              </span>
            </div>
          ` : `
            <div class="terminal-placeholder">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polyline points="4 17 10 11 4 5"/>
                <line x1="12" y1="19" x2="20" y2="19"/>
              </svg>
              <p>Select a terminal or start a Deep Review</p>
            </div>
          `}
        </div>
      </div>
    `;

    this.attachEventListeners();

    if (this.activeSessionId) {
      this.initTerminal(this.activeSessionId);
    }
  }

  private renderSessionItem(session: TerminalSession): string {
    const isActive = session.id === this.activeSessionId;
    return `
      <div class="terminal-item ${isActive ? 'active' : ''} ${session.status}" data-id="${session.id}">
        <span class="terminal-status-dot"></span>
        <span class="terminal-label">${this.escapeHtml(session.label)}</span>
        <button class="terminal-close-btn" data-id="${session.id}" title="Close">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `;
  }

  private getActiveSession(): TerminalSession | undefined {
    return this.sessions.find(s => s.id === this.activeSessionId);
  }

  private getStatusText(status?: string): string {
    switch (status) {
      case 'starting': return 'Starting...';
      case 'running': return 'Running';
      case 'completed': return 'Completed';
      case 'error': return 'Error';
      default: return 'Unknown';
    }
  }

  private initTerminal(sessionId: string): void {
    const container = document.getElementById(`terminalContainer-${sessionId}`);
    if (!container) return;

    // Check if terminal already exists
    if (this.terminals.has(sessionId)) {
      const terminal = this.terminals.get(sessionId);
      const fitAddon = this.fitAddons.get(sessionId);
      container.innerHTML = '';
      terminal.open(container);
      fitAddon.fit();
      return;
    }

    // Create new terminal
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#ffffff',
        cursorAccent: '#1e1e1e',
        selection: 'rgba(255, 255, 255, 0.3)',
        black: '#1e1e1e',
        red: '#f14c4c',
        green: '#23d18b',
        yellow: '#dcdcaa',
        blue: '#3794ff',
        magenta: '#bc89bd',
        cyan: '#29b8db',
        white: '#cccccc',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#dcdcaa',
        brightBlue: '#3794ff',
        brightMagenta: '#bc89bd',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(container);
    fitAddon.fit();

    this.terminals.set(sessionId, terminal);
    this.fitAddons.set(sessionId, fitAddon);

    // Handle input
    terminal.onData((data: string) => {
      window.electronAPI.terminalWrite(sessionId, data);
    });

    // Handle resize
    terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      window.electronAPI.terminalResize(sessionId, cols, rows);
    });

    // Window resize
    window.addEventListener('resize', () => {
      fitAddon.fit();
    });
  }

  private showTerminal(sessionId: string): void {
    // Hide all, show active
    this.terminals.forEach((terminal, id) => {
      const container = document.getElementById(`terminalContainer-${id}`);
      if (container) {
        container.style.display = id === sessionId ? 'block' : 'none';
      }
    });
  }

  private updateActiveState(): void {
    this.container.querySelectorAll('.terminal-item').forEach(item => {
      const id = (item as HTMLElement).dataset.id;
      item.classList.toggle('active', id === this.activeSessionId);
    });
  }

  private attachEventListeners(): void {
    // Session item click
    this.container.querySelectorAll('.terminal-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.terminal-close-btn')) return;
        const id = (item as HTMLElement).dataset.id;
        if (id) {
          this.setActiveSession(id);
          this.selectCallback?.(id);
        }
      });
    });

    // Close buttons in list
    this.container.querySelectorAll('.terminal-close-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id;
        if (id) {
          this.closeCallback?.(id);
        }
      });
    });

    // Toolbar buttons
    this.container.querySelector('.kill-btn')?.addEventListener('click', () => {
      if (this.activeSessionId) {
        window.electronAPI.terminalKill(this.activeSessionId);
      }
    });

    this.container.querySelector('.close-btn')?.addEventListener('click', () => {
      if (this.activeSessionId) {
        this.closeCallback?.(this.activeSessionId);
      }
    });
  }

  private setupEventListeners(): void {
    // Listen for terminal data
    window.electronAPI.onTerminalData((event) => {
      this.writeToTerminal(event.sessionId, event.data);
    });

    // Listen for status changes
    window.electronAPI.onTerminalStatusChange((event) => {
      this.updateSession(event.sessionId, { status: event.status as any });
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
```

**Step 2: Commit**

```bash
git add src/renderer/components/terminals-view.ts
git commit -m "feat: add TerminalsView component for terminal management UI"
```

---

## Task 11: Add xterm CSS and HTML script tags

**Files:**
- Modify: `src/renderer/index.html` (or wherever the HTML template is)

**Step 1: Add xterm.js CSS and scripts to the HTML head/body**

Add to `<head>`:
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css">
```

Add before closing `</body>`:
```html
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.js"></script>
```

**Step 2: Add terminals view container to the HTML**

Add alongside existing view containers:
```html
<div id="terminalsScreen" class="screen terminals-screen" style="display: none;">
  <div id="terminalsView"></div>
</div>
```

**Step 3: Commit**

```bash
git add src/renderer/index.html
git commit -m "feat: add xterm.js dependencies and terminals container"
```

---

## Task 12: Add Terminal CSS Styles

**Files:**
- Create or modify: `src/renderer/styles/terminals.css`

**Step 1: Create terminal styles**

```css
/* Terminals View Styles */
.terminals-view {
  display: flex;
  height: 100%;
  background: var(--bg-primary);
}

.terminals-sidebar {
  width: 250px;
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
}

.terminals-header {
  padding: 12px 16px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-color);
}

.terminal-count {
  background: var(--bg-secondary);
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
}

.terminals-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.terminals-empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-secondary);
}

.terminals-empty .hint {
  font-size: 12px;
  margin-top: 8px;
}

.terminal-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.terminal-item:hover {
  background: var(--bg-hover);
}

.terminal-item.active {
  background: var(--bg-selected);
}

.terminal-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-secondary);
  flex-shrink: 0;
}

.terminal-item.running .terminal-status-dot {
  background: var(--success-color);
  animation: pulse 2s infinite;
}

.terminal-item.starting .terminal-status-dot {
  background: var(--warning-color);
  animation: pulse 0.5s infinite;
}

.terminal-item.completed .terminal-status-dot {
  background: var(--text-secondary);
}

.terminal-item.error .terminal-status-dot {
  background: var(--error-color);
}

.terminal-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-close-btn {
  opacity: 0;
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: var(--text-secondary);
  border-radius: 4px;
}

.terminal-item:hover .terminal-close-btn {
  opacity: 1;
}

.terminal-close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.terminal-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.terminal-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-color);
}

.terminal-title {
  font-weight: 500;
}

.terminal-actions {
  display: flex;
  gap: 4px;
}

.terminal-container {
  flex: 1;
  padding: 8px;
  overflow: hidden;
}

.terminal-status-bar {
  padding: 4px 16px;
  border-top: 1px solid var(--border-color);
  font-size: 12px;
}

.terminal-status-bar .status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
}

.terminal-status-bar .status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-secondary);
}

.terminal-status-bar .status-indicator.running .status-dot {
  background: var(--success-color);
  animation: pulse 2s infinite;
}

.terminal-status-bar .status-indicator.starting .status-dot {
  background: var(--warning-color);
  animation: pulse 0.5s infinite;
}

.terminal-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  gap: 16px;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

**Step 2: Import the styles in the main CSS or HTML**

**Step 3: Commit**

```bash
git add src/renderer/styles/terminals.css
git commit -m "feat: add terminal view CSS styles"
```

---

## Remaining Tasks (Summary)

The following tasks follow the same pattern and should be implemented:

### Task 13: Update app.ts to handle Terminals section
- Import TerminalsView
- Initialize terminals view in initSections()
- Handle section switching for 'terminals'
- Wire up terminal event listeners

### Task 14: Update Settings View with Console Review options
- Add repo base folders input list
- Add console review behavior options
- Add browse folder functionality

### Task 15: Add Deep Review button to AI Comments Panel
- Add "Deep Review (Console)" button alongside existing review button
- Create showDeepReviewDialog() method
- Wire up to startDeepReview()

### Task 16: Implement startDeepReview in app.ts
- Gather file contents for all changed files
- Call consoleReviewPrepare
- Call consoleReviewStart
- Switch to terminals view
- Handle review completion

### Task 17: Integration testing
- Test full flow: start deep review → terminal opens → review completes
- Test worktree detection and creation
- Test settings persistence

### Task 18: Final commit
```bash
git add .
git commit -m "feat: complete console-based AI review implementation"
```

---

## Notes for Implementation

1. **xterm.js loading**: In production, consider bundling xterm.js instead of CDN
2. **Error handling**: Add try-catch blocks around all async operations
3. **Cleanup**: Ensure worktrees and temp folders are cleaned up appropriately
4. **Testing**: Test on Windows (PowerShell) and macOS/Linux (bash)
5. **Future skill extraction**: The prompt in `review-prompt.ts` is structured for easy extraction to a skill file
