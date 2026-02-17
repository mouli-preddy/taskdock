/**
 * Review Context Service
 * Prepares unified context folder structure for all AI review providers.
 * Extracted from console-review-service.ts for shared use across:
 * - Claude SDK executor
 * - Claude Terminal executor
 * - Copilot SDK executor
 */

import { getAppDataPath } from '../utils/app-paths.js';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getWorktreeService } from '../git/worktree-service.js';
import type { PRContext, ReviewContextInfo, AIReviewComment, CodeWalkthrough } from '../../shared/ai-types.js';
import type { FileChange, CommentThread } from '../../shared/types.js';
import type { LinkedRepository } from '../../shared/terminal-types.js';

export interface ReviewContextSettings {
  linkedRepositories: LinkedRepository[];
  whenRepoFound: 'ask' | 'worktree' | 'tempOnly';
}

export interface ReviewOutputFiles {
  review?: {
    comments: AIReviewComment[];
  };
  walkthrough?: CodeWalkthrough;
}

// Bump this when the context format or file-fetching strategy changes
// to auto-invalidate stale caches (e.g. switching from target-tip to merge-base blobs).
const CONTEXT_VERSION = 2;

export class ReviewContextService {
  private prContextsDir: string;  // Renamed from reviewsDir

  constructor() {
    this.prContextsDir = path.join(getAppDataPath(), 'claude-toolkit', 'pr-contexts');
    if (!fs.existsSync(this.prContextsDir)) {
      fs.mkdirSync(this.prContextsDir, { recursive: true });
    }
    this.cleanupStaleContexts();
  }

  /**
   * Generate a deterministic context key for a PR.
   * Format: {org}-{project}-{prId}
   */
  getPRContextKey(org: string, project: string, prId: number): string {
    // Sanitize org and project names for filesystem safety
    const safeOrg = org.replace(/[^a-zA-Z0-9-_]/g, '_');
    const safeProject = project.replace(/[^a-zA-Z0-9-_]/g, '_');
    return `${safeOrg}-${safeProject}-${prId}`;
  }

  /**
   * Get the full path to a PR context directory.
   */
  getPRContextPath(prContextKey: string): string {
    return path.join(this.prContextsDir, prContextKey);
  }

  /**
   * Check if a PR context already exists on disk.
   */
  hasPRContext(prContextKey: string): boolean {
    const manifestPath = path.join(this.getPRContextPath(prContextKey), 'context', 'files.json');
    return fs.existsSync(manifestPath);
  }

  /**
   * Ensure PR context exists on disk. If it already exists and is up-to-date,
   * returns immediately. Otherwise creates it.
   *
   * This is the main entry point for UI-initiated context creation.
   */
  async ensurePRContext(
    prContext: PRContext,
    files: FileChange[],
    threads: CommentThread[],
    settings: ReviewContextSettings,
    fileContents: Map<string, { original: string | null; modified: string | null }>,
    lastCommitId: string
  ): Promise<{ contextPath: string; prContextKey: string; reused: boolean }> {
    if (!prContext.org || !prContext.project) {
      throw new Error('ensurePRContext requires org and project to be defined in prContext');
    }
    const prContextKey = this.getPRContextKey(prContext.org, prContext.project, prContext.prId);
    const contextPath = this.getPRContextPath(prContextKey);

    // Check if context already exists and is up-to-date
    if (this.hasPRContext(prContextKey)) {
      try {
        const manifestPath = path.join(contextPath, 'context', 'files.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

        // If lastCommitId and version match, context is still valid
        if (manifest.lastCommitId === lastCommitId && manifest.contextVersion === CONTEXT_VERSION) {
          console.log(`[ReviewContextService] Reusing existing PR context: ${prContextKey}`);
          return { contextPath, prContextKey, reused: true };
        }

        // PR was updated or context version changed - remove stale context
        const reason = manifest.contextVersion !== CONTEXT_VERSION ? 'context version changed' : 'PR updated';
        console.log(`[ReviewContextService] ${reason}, refreshing context: ${prContextKey}`);
        fs.rmSync(contextPath, { recursive: true, force: true });
      } catch (error) {
        console.warn(`[ReviewContextService] Error reading existing context, recreating:`, error);
        try {
          fs.rmSync(contextPath, { recursive: true, force: true });
        } catch { /* ignore cleanup errors */ }
      }
    }

    // Create new context with deterministic path
    await this.prepareContextWithKey(prContextKey, prContext, files, threads, settings, fileContents, lastCommitId);

    return { contextPath, prContextKey, reused: false };
  }

  /**
   * File fetcher interface for backend-side file retrieval.
   * Used by ensurePRContextWithFetch to avoid sending file contents over IPC.
   */
  public async ensurePRContextWithFetch(
    prContext: PRContext,
    files: Array<{
      path: string;
      changeType: string;
      objectId?: string;
      originalObjectId?: string;
      originalPath?: string;
    }>,
    threads: CommentThread[],
    settings: ReviewContextSettings,
    lastCommitId: string,
    repoId: string,
    fetcher: {
      getFileContent: (objectId: string) => Promise<string>;
    }
  ): Promise<{ contextPath: string; prContextKey: string; reused: boolean }> {
    if (!prContext.org || !prContext.project) {
      throw new Error('ensurePRContextWithFetch requires org and project to be defined in prContext');
    }
    const prContextKey = this.getPRContextKey(prContext.org, prContext.project, prContext.prId);
    const contextPath = this.getPRContextPath(prContextKey);

    // Check if context already exists and is up-to-date
    if (this.hasPRContext(prContextKey)) {
      try {
        const manifestPath = path.join(contextPath, 'context', 'files.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

        // If lastCommitId and version match, context is still valid
        if (manifest.lastCommitId === lastCommitId && manifest.contextVersion === CONTEXT_VERSION) {
          console.log(`[ReviewContextService] Reusing existing PR context: ${prContextKey}`);
          return { contextPath, prContextKey, reused: true };
        }

        // PR was updated or context version changed - remove stale context
        const reason = manifest.contextVersion !== CONTEXT_VERSION ? 'context version changed' : 'PR updated';
        console.log(`[ReviewContextService] ${reason}, refreshing context: ${prContextKey}`);
        fs.rmSync(contextPath, { recursive: true, force: true });
      } catch (error) {
        console.warn(`[ReviewContextService] Error reading existing context, recreating:`, error);
        try {
          fs.rmSync(contextPath, { recursive: true, force: true });
        } catch { /* ignore cleanup errors */ }
      }
    }

    // Create new context by fetching files
    await this.prepareContextWithFetch(prContextKey, prContext, files, threads, settings, lastCommitId, fetcher);

    return { contextPath, prContextKey, reused: false };
  }

  /**
   * Prepare context by fetching files directly in backend.
   * Avoids sending large payloads over IPC.
   */
  private async prepareContextWithFetch(
    prContextKey: string,
    prContext: PRContext,
    files: Array<{
      path: string;
      changeType: string;
      objectId?: string;
      originalObjectId?: string;
      originalPath?: string;
    }>,
    threads: CommentThread[],
    settings: ReviewContextSettings,
    lastCommitId: string,
    fetcher: {
      getFileContent: (objectId: string) => Promise<string>;
    }
  ): Promise<void> {
    const contextPath = this.getPRContextPath(prContextKey);

    try {
      // Create directory structure
      fs.mkdirSync(path.join(contextPath, 'context'), { recursive: true });
      fs.mkdirSync(path.join(contextPath, 'original'), { recursive: true });
      fs.mkdirSync(path.join(contextPath, 'modified'), { recursive: true });
      fs.mkdirSync(path.join(contextPath, 'diffs'), { recursive: true });
      fs.mkdirSync(path.join(contextPath, 'output'), { recursive: true });
      fs.mkdirSync(path.join(contextPath, 'reviews'), { recursive: true });

      // Write PR metadata
      fs.writeFileSync(
        path.join(contextPath, 'context', 'pr.json'),
        JSON.stringify({
          id: prContext.prId,
          title: prContext.title,
          description: prContext.description,
          sourceBranch: prContext.sourceBranch,
          targetBranch: prContext.targetBranch,
          repository: prContext.repository,
          org: prContext.org,
          project: prContext.project,
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

      // Write files list with manifest info
      const manifest = {
        contextVersion: CONTEXT_VERSION,
        prId: prContext.prId,
        org: prContext.org,
        project: prContext.project,
        lastCommitId,
        createdAt: new Date().toISOString(),
        files: files.map(f => ({
          path: f.path,
          changeType: f.changeType,
          objectId: f.objectId,
          originalObjectId: f.originalObjectId,
        })),
      };
      fs.writeFileSync(
        path.join(contextPath, 'context', 'files.json'),
        JSON.stringify(manifest, null, 2)
      );

      // Fetch and write file contents
      console.log(`[ReviewContextService] Fetching ${files.length} files for PR context: ${prContextKey}`);

      for (const file of files) {
        // Skip files with null/undefined paths
        if (!file.path) {
          console.warn('[ReviewContextService] Skipping file with null path');
          continue;
        }
        const safePath = file.path.replace(/^\//, '');

        // Validate paths (prevent path traversal)
        const originalPath = path.join(contextPath, 'original', safePath);
        const resolvedOriginal = path.resolve(originalPath);
        const expectedOriginalBase = path.resolve(contextPath, 'original');
        if (!resolvedOriginal.startsWith(expectedOriginalBase + path.sep) && resolvedOriginal !== expectedOriginalBase) {
          console.warn(`[ReviewContextService] Skipping potentially malicious path: ${file.path}`);
          continue;
        }

        const modifiedPath = path.join(contextPath, 'modified', safePath);
        const resolvedModified = path.resolve(modifiedPath);
        const expectedModifiedBase = path.resolve(contextPath, 'modified');
        if (!resolvedModified.startsWith(expectedModifiedBase + path.sep) && resolvedModified !== expectedModifiedBase) {
          console.warn(`[ReviewContextService] Skipping potentially malicious path: ${file.path}`);
          continue;
        }

        // Fetch modified content
        if (file.objectId && file.changeType !== 'delete') {
          try {
            const modifiedContent = await fetcher.getFileContent(file.objectId);
            fs.mkdirSync(path.dirname(modifiedPath), { recursive: true });
            fs.writeFileSync(modifiedPath, modifiedContent);
          } catch (e) {
            console.warn(`[ReviewContextService] Failed to fetch modified content for ${file.path}:`, e);
          }
        }

        // Fetch original content using merge-base blob (originalObjectId)
        if (['edit', 'delete', 'rename'].includes(file.changeType)) {
          if (file.originalObjectId) {
            try {
              const originalContent = await fetcher.getFileContent(file.originalObjectId);
              fs.mkdirSync(path.dirname(originalPath), { recursive: true });
              fs.writeFileSync(originalPath, originalContent);
            } catch (e) {
              console.warn(`[ReviewContextService] Failed to fetch original content for ${file.path}:`, e);
            }
          } else {
            console.warn(`[ReviewContextService] No originalObjectId for ${file.path}, skipping original`);
          }
        }
      }

      console.log(`[ReviewContextService] Created PR context: ${prContextKey}`);
    } catch (error) {
      // Cleanup on failure
      this.cleanupContext(contextPath);
      throw new Error(`Failed to prepare PR context: ${error}`);
    }
  }

  /**
   * Prepare context with a specific key (deterministic path).
   * Used by ensurePRContext for UI-initiated context creation.
   */
  private async prepareContextWithKey(
    prContextKey: string,
    prContext: PRContext,
    files: FileChange[],
    threads: CommentThread[],
    settings: ReviewContextSettings,
    fileContents: Map<string, { original: string | null; modified: string | null }>,
    lastCommitId: string
  ): Promise<void> {
    const contextPath = this.getPRContextPath(prContextKey);

    try {
      // Create directory structure
      fs.mkdirSync(path.join(contextPath, 'context'), { recursive: true });
      fs.mkdirSync(path.join(contextPath, 'original'), { recursive: true });
      fs.mkdirSync(path.join(contextPath, 'modified'), { recursive: true });
      fs.mkdirSync(path.join(contextPath, 'diffs'), { recursive: true });
      fs.mkdirSync(path.join(contextPath, 'output'), { recursive: true });
      fs.mkdirSync(path.join(contextPath, 'reviews'), { recursive: true });

      // Write PR metadata
      fs.writeFileSync(
        path.join(contextPath, 'context', 'pr.json'),
        JSON.stringify({
          id: prContext.prId,
          title: prContext.title,
          description: prContext.description,
          sourceBranch: prContext.sourceBranch,
          targetBranch: prContext.targetBranch,
          repository: prContext.repository,
          org: prContext.org,
          project: prContext.project,
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

      // Write files list with manifest info
      const manifest = {
        contextVersion: CONTEXT_VERSION,
        prId: prContext.prId,
        org: prContext.org,
        project: prContext.project,
        lastCommitId,
        createdAt: new Date().toISOString(),
        files: files.map(f => ({
          path: f.path,
          changeType: f.changeType,
          objectId: f.objectId,
          originalObjectId: f.originalObjectId,
        })),
      };
      fs.writeFileSync(
        path.join(contextPath, 'context', 'files.json'),
        JSON.stringify(manifest, null, 2)
      );

      // Write file contents
      for (const file of files) {
        // Skip files with null/undefined paths
        if (!file.path) {
          console.warn('[ReviewContextService] Skipping file with null path');
          continue;
        }
        const contents = fileContents.get(file.path);
        if (!contents) continue;

        const safePath = file.path.replace(/^\//, '');

        // Validate paths (prevent path traversal)
        const originalPath = path.join(contextPath, 'original', safePath);
        const resolvedOriginal = path.resolve(originalPath);
        const expectedOriginalBase = path.resolve(contextPath, 'original');
        if (!resolvedOriginal.startsWith(expectedOriginalBase + path.sep) && resolvedOriginal !== expectedOriginalBase) {
          console.warn(`[ReviewContextService] Skipping potentially malicious path: ${file.path}`);
          continue;
        }

        const modifiedPath = path.join(contextPath, 'modified', safePath);
        const resolvedModified = path.resolve(modifiedPath);
        const expectedModifiedBase = path.resolve(contextPath, 'modified');
        if (!resolvedModified.startsWith(expectedModifiedBase + path.sep) && resolvedModified !== expectedModifiedBase) {
          console.warn(`[ReviewContextService] Skipping potentially malicious path: ${file.path}`);
          continue;
        }

        if (contents.original !== null) {
          fs.mkdirSync(path.dirname(originalPath), { recursive: true });
          fs.writeFileSync(originalPath, contents.original);
        }

        if (contents.modified !== null) {
          fs.mkdirSync(path.dirname(modifiedPath), { recursive: true });
          fs.writeFileSync(modifiedPath, contents.modified);
        }
      }

      console.log(`[ReviewContextService] Created PR context: ${prContextKey}`);
    } catch (error) {
      // Cleanup on failure
      this.cleanupContext(contextPath);
      throw new Error(`Failed to prepare PR context: ${error}`);
    }
  }

  /**
   * Clean up old PR context folders that exceed the max age
   * @param maxAgeMs Maximum age in milliseconds (default: 7 days)
   */
  cleanupStaleContexts(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): void {
    try {
      if (!fs.existsSync(this.prContextsDir)) return;
      const entries = fs.readdirSync(this.prContextsDir, { withFileTypes: true });
      const now = Date.now();
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(this.prContextsDir, entry.name);
        try {
          const stats = fs.statSync(dirPath);
          if (now - stats.mtimeMs > maxAgeMs) {
            fs.rmSync(dirPath, { recursive: true, force: true });
            console.log(`[ReviewContextService] Cleaned up stale PR context: ${entry.name}`);
          }
        } catch (error) {
          console.error(`[ReviewContextService] Error checking/cleaning ${entry.name}:`, error);
        }
      }
    } catch (error) {
      console.error('[ReviewContextService] Error cleaning up stale contexts:', error);
    }
  }

  /**
   * Prepare the review context folder structure
   * Creates: context/, original/, modified/, diffs/, output/
   * Writes PR metadata, comments, and file contents
   */
  async prepareContext(
    prContext: PRContext,
    files: FileChange[],
    threads: CommentThread[],
    settings: ReviewContextSettings,
    fileContents: Map<string, { original: string | null; modified: string | null }>
  ): Promise<ReviewContextInfo> {
    const guid = uuidv4();
    const contextPath = path.join(this.prContextsDir, guid);

    try {
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
          sourceBranch: prContext.sourceBranch,
          targetBranch: prContext.targetBranch,
          repository: prContext.repository,
          org: prContext.org,
          project: prContext.project,
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
        // Skip files with null/undefined paths
        if (!file.path) {
          console.warn('[ReviewContextService] Skipping file with null path');
          continue;
        }
        const contents = fileContents.get(file.path);
        if (!contents) continue;

        const safePath = file.path.replace(/^\//, '');

        // Validate path doesn't escape context directory (prevent path traversal)
        const originalPath = path.join(contextPath, 'original', safePath);
        const resolvedOriginal = path.resolve(originalPath);
        const expectedOriginalBase = path.resolve(contextPath, 'original');
        if (!resolvedOriginal.startsWith(expectedOriginalBase + path.sep) && resolvedOriginal !== expectedOriginalBase) {
          console.warn(`[ReviewContextService] Skipping potentially malicious path: ${file.path}`);
          continue;
        }

        const modifiedPath = path.join(contextPath, 'modified', safePath);
        const resolvedModified = path.resolve(modifiedPath);
        const expectedModifiedBase = path.resolve(contextPath, 'modified');
        if (!resolvedModified.startsWith(expectedModifiedBase + path.sep) && resolvedModified !== expectedModifiedBase) {
          console.warn(`[ReviewContextService] Skipping potentially malicious path: ${file.path}`);
          continue;
        }

        const diffPath = path.join(contextPath, 'diffs', `${safePath}.diff`);
        const resolvedDiff = path.resolve(diffPath);
        const expectedDiffsBase = path.resolve(contextPath, 'diffs');
        if (!resolvedDiff.startsWith(expectedDiffsBase + path.sep) && resolvedDiff !== expectedDiffsBase) {
          console.warn(`[ReviewContextService] Skipping potentially malicious path: ${file.path}`);
          continue;
        }

        if (contents.original !== null) {
          fs.mkdirSync(path.dirname(originalPath), { recursive: true });
          fs.writeFileSync(originalPath, contents.original);
        }

        if (contents.modified !== null) {
          fs.mkdirSync(path.dirname(modifiedPath), { recursive: true });
          fs.writeFileSync(modifiedPath, contents.modified);
        }

        // Generate diff
        if (contents.original !== null || contents.modified !== null) {
          fs.mkdirSync(path.dirname(diffPath), { recursive: true });
          const diff = this.generateUnifiedDiff(
            file.path,
            contents.original || '',
            contents.modified || ''
          );
          fs.writeFileSync(diffPath, diff);
        }
      }
    } catch (error) {
      // Cleanup on failure
      this.cleanupContext(contextPath);
      throw new Error(`Failed to prepare review context: ${error}`);
    }

    // Check for local repo
    let workingDir = contextPath;
    let hasRepoContext = false;
    let repoPath: string | undefined;
    let worktreeCreated = false;
    let mainRepoPath: string | undefined;

    const worktreeService = getWorktreeService(settings.linkedRepositories);
    // Construct proper URL with org/project/repo for matching
    const repoUrl = prContext.org && prContext.project
      ? `https://dev.azure.com/${prContext.org}/${prContext.project}/_git/${prContext.repository}`
      : `https://dev.azure.com/${prContext.repository}`;
    console.log('[ReviewContextService] Looking for repo:', repoUrl);
    console.log('[ReviewContextService] Linked repos:', settings.linkedRepositories?.map(r => r.originUrl));
    const repoMatch = worktreeService.findLocalRepo(repoUrl, prContext.repository);
    console.log('[ReviewContextService] Repo match:', repoMatch);

    if (repoMatch && settings.whenRepoFound !== 'tempOnly') {
      mainRepoPath = repoMatch.path;

      // Try to use worktree
      const existingWorktree = worktreeService.findWorktreeForBranch(
        repoMatch.path,
        prContext.sourceBranch
      );

      if (existingWorktree) {
        console.log('[ReviewContextService] Found existing worktree:', existingWorktree.path);
        try {
          worktreeService.syncWorktree(existingWorktree.path, prContext.sourceBranch);
          workingDir = existingWorktree.path;
          hasRepoContext = true;
          repoPath = existingWorktree.path;
          worktreeCreated = false; // Using existing worktree
          console.log('[ReviewContextService] Synced worktree, workingDir:', workingDir);
        } catch (error) {
          console.error('[ReviewContextService] Failed to sync worktree:', error);
          // Fall back to temp folder (workingDir stays as contextPath)
        }
      } else {
        console.log('[ReviewContextService] Creating new worktree for branch:', prContext.sourceBranch);
        try {
          const newWorktree = worktreeService.createWorktree(
            repoMatch.path,
            prContext.sourceBranch,
            prContext.prId
          );
          workingDir = newWorktree.path;
          hasRepoContext = true;
          repoPath = newWorktree.path;
          worktreeCreated = true; // We created this worktree
          console.log('[ReviewContextService] Created worktree, workingDir:', workingDir);
        } catch (error) {
          console.error('[ReviewContextService] Failed to create worktree:', error);
          // Fall back to temp folder
        }
      }
    }
    console.log('[ReviewContextService] Final workingDir:', workingDir, 'hasRepoContext:', hasRepoContext, 'worktreeCreated:', worktreeCreated);

    // For new contexts, output goes to the output/ subdirectory
    const outputPath = path.join(contextPath, 'output');

    return {
      guid,
      contextPath,
      outputPath,
      workingDir,
      hasRepoContext,
      repoPath,
      worktreeCreated,
      mainRepoPath,
    };
  }

  /**
   * Generate a unified diff format string
   */
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

  /**
   * Remove a context folder
   */
  cleanupContext(contextPath: string): void {
    try {
      fs.rmSync(contextPath, { recursive: true, force: true });
      console.log(`[ReviewContextService] Cleaned up context: ${contextPath}`);
    } catch (error) {
      console.error('[ReviewContextService] Failed to cleanup context:', error);
    }
  }

  /**
   * Remove a worktree via worktreeService
   */
  cleanupWorktree(mainRepoPath: string, worktreePath: string): void {
    try {
      console.log('[ReviewContextService] Removing worktree:', worktreePath, 'from repo:', mainRepoPath);
      const worktreeService = getWorktreeService([]);
      worktreeService.removeWorktree(mainRepoPath, worktreePath);
      console.log('[ReviewContextService] Successfully removed worktree');
    } catch (error) {
      console.error('[ReviewContextService] Failed to cleanup worktree:', error);
    }
  }

  /**
   * Read output files (review.json and walkthrough.json) from the output directory
   * These files are written by the AI executor after completing the review
   */
  readOutputFiles(contextPath: string): ReviewOutputFiles {
    const result: ReviewOutputFiles = {};
    const outputDir = path.join(contextPath, 'output');

    // Read review.json
    const reviewPath = path.join(outputDir, 'review.json');
    if (fs.existsSync(reviewPath)) {
      try {
        const content = fs.readFileSync(reviewPath, 'utf-8');
        const parsed = JSON.parse(content);
        if (parsed.comments && Array.isArray(parsed.comments)) {
          result.review = { comments: parsed.comments };
        }
      } catch (error) {
        console.error('[ReviewContextService] Failed to read review.json:', error);
      }
    }

    // Read walkthrough.json
    const walkthroughPath = path.join(outputDir, 'walkthrough.json');
    if (fs.existsSync(walkthroughPath)) {
      try {
        const content = fs.readFileSync(walkthroughPath, 'utf-8');
        const parsed = JSON.parse(content);
        result.walkthrough = parsed;
      } catch (error) {
        console.error('[ReviewContextService] Failed to read walkthrough.json:', error);
      }
    }

    return result;
  }

  /**
   * Get the PR contexts directory path
   */
  getPrContextsDir(): string {
    return this.prContextsDir;
  }

  /**
   * Load ReviewContextInfo from an existing PR context.
   * Used by AI review and walkthrough services to reuse context created when PR was opened.
   */
  loadContextFromPRContextKey(
    prContextKey: string,
    settings: ReviewContextSettings
  ): ReviewContextInfo | null {
    const contextPath = this.getPRContextPath(prContextKey);

    if (!this.hasPRContext(prContextKey)) {
      console.warn(`[ReviewContextService] PR context not found: ${prContextKey}`);
      return null;
    }

    try {
      // Read PR metadata to get repo info for worktree lookup
      const prMetadataPath = path.join(contextPath, 'context', 'pr.json');
      let prMetadata: { repository?: string; org?: string; project?: string; sourceBranch?: string } = {};
      if (fs.existsSync(prMetadataPath)) {
        prMetadata = JSON.parse(fs.readFileSync(prMetadataPath, 'utf-8'));
      }

      // Default working directory is the context path
      let workingDir = contextPath;
      let hasRepoContext = false;
      let repoPath: string | undefined;
      let worktreeCreated = false;
      let mainRepoPath: string | undefined;

      // Try to find local repo and worktree if settings allow
      if (prMetadata.repository && settings.whenRepoFound !== 'tempOnly') {
        const worktreeService = getWorktreeService(settings.linkedRepositories);
        const repoUrl = prMetadata.org && prMetadata.project
          ? `https://dev.azure.com/${prMetadata.org}/${prMetadata.project}/_git/${prMetadata.repository}`
          : `https://dev.azure.com/${prMetadata.repository}`;

        const repoMatch = worktreeService.findLocalRepo(repoUrl, prMetadata.repository);

        if (repoMatch && prMetadata.sourceBranch) {
          mainRepoPath = repoMatch.path;
          const existingWorktree = worktreeService.findWorktreeForBranch(
            repoMatch.path,
            prMetadata.sourceBranch
          );

          if (existingWorktree) {
            try {
              worktreeService.syncWorktree(existingWorktree.path, prMetadata.sourceBranch);
              workingDir = existingWorktree.path;
              hasRepoContext = true;
              repoPath = existingWorktree.path;
              worktreeCreated = false;
              console.log('[ReviewContextService] Synced existing worktree, workingDir:', workingDir);
            } catch (error) {
              console.error('[ReviewContextService] Failed to sync worktree:', error);
            }
          } else {
            // No existing worktree - create one
            // Need prId from context path (format: org-project-prId)
            const prIdMatch = prContextKey.match(/-(\d+)$/);
            if (prIdMatch) {
              const prId = parseInt(prIdMatch[1], 10);
              console.log('[ReviewContextService] Creating new worktree for branch:', prMetadata.sourceBranch);
              try {
                const newWorktree = worktreeService.createWorktree(
                  repoMatch.path,
                  prMetadata.sourceBranch,
                  prId
                );
                workingDir = newWorktree.path;
                hasRepoContext = true;
                repoPath = newWorktree.path;
                worktreeCreated = true;
                console.log('[ReviewContextService] Created worktree, workingDir:', workingDir);
              } catch (error) {
                console.error('[ReviewContextService] Failed to create worktree:', error);
              }
            }
          }
        }
      }

      // Create unique output path for this review session
      const reviewGuid = uuidv4();
      const outputPath = path.join(contextPath, 'reviews', reviewGuid);
      fs.mkdirSync(outputPath, { recursive: true });

      // If no worktree was found, use outputPath as workingDir
      if (!hasRepoContext) {
        workingDir = outputPath;
      }

      console.log(`[ReviewContextService] Loaded context from: ${prContextKey}, workingDir: ${workingDir}, outputPath: ${outputPath}`);

      return {
        guid: reviewGuid, // Use a new GUID for this review session
        contextPath,      // Read files from here
        outputPath,       // Write output here
        workingDir,       // Run Claude from here (worktree or outputPath if no worktree)
        hasRepoContext,
        repoPath,
        worktreeCreated,
        mainRepoPath,
      };
    } catch (error) {
      console.error(`[ReviewContextService] Error loading context from ${prContextKey}:`, error);
      return null;
    }
  }
}

// Singleton instance
let reviewContextService: ReviewContextService | null = null;

/**
 * Get the singleton ReviewContextService instance
 */
export function getReviewContextService(): ReviewContextService {
  if (!reviewContextService) {
    reviewContextService = new ReviewContextService();
  }
  return reviewContextService;
}
