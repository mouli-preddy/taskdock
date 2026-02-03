# PR File Memory Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce memory footprint for PR file viewing by implementing disk-based storage with LRU caching, achieving 98% memory reduction for typical workloads.

**Architecture:** Files are written to disk when PR opens, then lazily loaded on-demand with an LRU cache. The cache uses Git objectIds as keys for cross-PR deduplication. A new `PRFileCacheService` coordinates between the existing `ReviewContextService` (disk I/O) and the UI layer.

**Tech Stack:** TypeScript, Node.js fs APIs, lru-cache npm package, Electron IPC

**Design Document:** `docs/plans/2026-01-28-pr-file-memory-optimization-design.md`

---

## Task 1: Add lru-cache Dependency

**Files:**
- Modify: `package.json:35-52` (dependencies section)

**Step 1: Install lru-cache package**

Run:
```bash
npm install lru-cache
```
Expected: Package added to dependencies

**Step 2: Verify installation**

Run:
```bash
npm ls lru-cache
```
Expected: Shows lru-cache version (should be ^10.x or higher)

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore: add lru-cache dependency for PR file caching

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create FileChange Type Without Content

**Files:**
- Modify: `src/shared/types.ts:139-148`

**Step 1: Add FileChangeMetadata interface**

In `src/shared/types.ts`, add a new interface after the existing `FileChange` interface (around line 148):

```typescript
/**
 * FileChange without content - used for in-memory storage after lazy loading migration.
 * Content is loaded on-demand from disk via PRFileCacheService.
 */
export interface FileChangeMetadata {
  path: string;
  changeType: ChangeType;
  objectId?: string;
  originalObjectId?: string;
  threads: CommentThread[];
}
```

**Step 2: Verify types compile**

Run:
```bash
npm run typecheck
```
Expected: No errors (new interface is additive)

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "$(cat <<'EOF'
feat: add FileChangeMetadata interface for lazy loading

Separates file metadata from content to support on-demand loading.
FileChange still has content fields for backwards compatibility.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create Cache Configuration Types

**Files:**
- Create: `src/shared/cache-types.ts`

**Step 1: Create cache types file**

Create `src/shared/cache-types.ts`:

```typescript
/**
 * Configuration for the PR file cache system.
 * Controls memory usage and disk retention.
 */
export interface FileCacheConfig {
  /** Maximum number of files to keep in memory cache. Default: 20 */
  maxFiles: number;
  /** Maximum total size of cache in bytes. Default: 50MB */
  maxSizeBytes: number;
  /** Maximum size of a single file to cache. Larger files bypass cache. Default: 5MB */
  maxFileSizeBytes: number;
  /** Files larger than this are considered "large" and bypass cache. Default: 1MB */
  largeFileThreshold: number;
}

/** Statistics for cache monitoring */
export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  currentSize: number;
  currentCount: number;
}

/** Metadata stored in PR context manifest */
export interface PRContextManifest {
  prId: number;
  org: string;
  project: string;
  lastCommitId: string;
  createdAt: string;
  files: Array<{
    path: string;
    changeType: string;
    objectId?: string;
    originalObjectId?: string;
  }>;
}

/** Default cache configuration */
export const DEFAULT_CACHE_CONFIG: FileCacheConfig = {
  maxFiles: 20,
  maxSizeBytes: 50 * 1024 * 1024, // 50MB
  maxFileSizeBytes: 5 * 1024 * 1024, // 5MB
  largeFileThreshold: 1 * 1024 * 1024, // 1MB
};
```

**Step 2: Verify types compile**

Run:
```bash
npm run typecheck
```
Expected: No errors

**Step 3: Commit**

```bash
git add src/shared/cache-types.ts
git commit -m "$(cat <<'EOF'
feat: add cache configuration types for PR file caching

Defines FileCacheConfig, CacheStats, PRContextManifest types.
Sets sensible defaults: 20 files, 50MB total, 5MB per file.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Update ReviewContextService Directory Structure

**Files:**
- Modify: `src/main/ai/review-context-service.ts:31-40` (constructor)
- Modify: `src/main/ai/review-context-service.ts:46-67` (cleanup)
- Modify: `src/main/ai/review-context-service.ts:74-82` (prepareContext path generation)

**Step 1: Change reviews directory to pr-contexts**

In `src/main/ai/review-context-service.ts`, update the constructor (lines 31-40):

```typescript
export class ReviewContextService {
  private prContextsDir: string;  // Renamed from reviewsDir

  constructor() {
    this.prContextsDir = path.join(getAppDataPath(), 'claude-toolkit', 'pr-contexts');
    if (!fs.existsSync(this.prContextsDir)) {
      fs.mkdirSync(this.prContextsDir, { recursive: true });
    }
    this.cleanupStaleContexts();
  }
```

**Step 2: Update cleanup to 7 days retention**

Update the cleanupStaleContexts method (lines 46-67):

```typescript
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
```

**Step 3: Update all references from reviewsDir to prContextsDir**

Search and replace `this.reviewsDir` → `this.prContextsDir` throughout the file.

**Step 4: Verify build succeeds**

Run:
```bash
npm run build:main
```
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/main/ai/review-context-service.ts
git commit -m "$(cat <<'EOF'
refactor: rename reviews dir to pr-contexts, extend retention to 7 days

- Storage path: claude-toolkit/pr-contexts/ (was reviews/)
- Retention: 7 days (was 24 hours)
- Supports shared storage between UI and AI reviews

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add Deterministic Context Path Generation

**Files:**
- Modify: `src/main/ai/review-context-service.ts`

**Step 1: Add method to generate deterministic PR context key**

Add this method to ReviewContextService class:

```typescript
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
```

**Step 2: Add ensurePRContext method for UI use**

Add this method that the UI will call:

```typescript
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
    const prContextKey = this.getPRContextKey(prContext.org, prContext.project, prContext.prId);
    const contextPath = this.getPRContextPath(prContextKey);

    // Check if context already exists and is up-to-date
    if (this.hasPRContext(prContextKey)) {
      try {
        const manifestPath = path.join(contextPath, 'context', 'files.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

        // If lastCommitId matches, context is still valid
        if (manifest.lastCommitId === lastCommitId) {
          console.log(`[ReviewContextService] Reusing existing PR context: ${prContextKey}`);
          return { contextPath, prContextKey, reused: true };
        }

        // PR was updated - remove stale context
        console.log(`[ReviewContextService] PR updated, refreshing context: ${prContextKey}`);
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
```

**Step 3: Add prepareContextWithKey method**

Add a variant of prepareContext that uses a specific key instead of generating a GUID:

```typescript
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
```

**Step 4: Verify build succeeds**

Run:
```bash
npm run build:main
```
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/main/ai/review-context-service.ts
git commit -m "$(cat <<'EOF'
feat: add deterministic PR context paths and ensurePRContext method

- getPRContextKey(): generates {org}-{project}-{prId} key
- ensurePRContext(): creates or reuses existing context
- Detects PR updates via lastCommitId in manifest
- Enables UI and AI reviews to share same disk files

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Create PRFileCacheService

**Files:**
- Create: `src/main/services/pr-file-cache-service.ts`

**Step 1: Create the cache service file**

Create `src/main/services/pr-file-cache-service.ts`:

```typescript
/**
 * PR File Cache Service
 * Provides LRU caching for PR file contents with disk-backed storage.
 * Uses Git objectIds as cache keys for cross-PR deduplication.
 */

import { LRUCache } from 'lru-cache';
import fs from 'fs';
import path from 'path';
import type { FileCacheConfig, CacheStats } from '../../shared/cache-types.js';
import { DEFAULT_CACHE_CONFIG } from '../../shared/cache-types.js';
import { getReviewContextService } from '../ai/review-context-service.js';

export class PRFileCacheService {
  private cache: LRUCache<string, string>;
  private config: FileCacheConfig;
  private stats: CacheStats;

  constructor(config: Partial<FileCacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      currentSize: 0,
      currentCount: 0,
    };

    this.cache = new LRUCache<string, string>({
      max: this.config.maxFiles,
      maxSize: this.config.maxSizeBytes,
      sizeCalculation: (content: string) => content.length * 2, // UTF-16 chars = 2 bytes
      dispose: () => {
        this.stats.evictions++;
      },
    });
  }

  /**
   * Get file content from cache, disk, or re-fetch from ADO.
   * Three-tier fallback: cache → disk → ADO API
   */
  async getFileContent(
    prContextKey: string,
    filePath: string,
    version: 'original' | 'modified',
    objectId: string,
    adoFetcher?: () => Promise<string>
  ): Promise<string | null> {
    // 1. Check cache first
    const cached = this.cache.get(objectId);
    if (cached !== undefined) {
      this.stats.hits++;
      this.updateStats();
      return cached;
    }

    this.stats.misses++;

    // 2. Try loading from disk
    const contextService = getReviewContextService();
    const contextPath = contextService.getPRContextPath(prContextKey);
    const safePath = filePath.replace(/^\//, '');
    const diskPath = path.join(contextPath, version, safePath);

    try {
      if (fs.existsSync(diskPath)) {
        const fileStats = fs.statSync(diskPath);

        // Check file size limits
        if (fileStats.size > this.config.maxFileSizeBytes) {
          console.warn(`[PRFileCacheService] File too large to cache: ${filePath} (${fileStats.size} bytes)`);
          // Still return the content, just don't cache it
          return fs.readFileSync(diskPath, 'utf-8');
        }

        const content = fs.readFileSync(diskPath, 'utf-8');

        // Large files bypass cache but still return content
        if (fileStats.size > this.config.largeFileThreshold) {
          console.log(`[PRFileCacheService] Large file, skipping cache: ${filePath}`);
          return content;
        }

        // Cache for next time
        this.cache.set(objectId, content);
        this.updateStats();
        return content;
      }
    } catch (error) {
      console.warn(`[PRFileCacheService] Disk read failed for ${filePath}:`, error);
    }

    // 3. Fallback: fetch from ADO
    if (adoFetcher) {
      try {
        console.log(`[PRFileCacheService] Fetching from ADO: ${filePath}`);
        const content = await adoFetcher();

        // Try to repair disk storage
        try {
          fs.mkdirSync(path.dirname(diskPath), { recursive: true });
          fs.writeFileSync(diskPath, content, 'utf-8');
        } catch (writeError) {
          console.warn(`[PRFileCacheService] Failed to repair disk storage:`, writeError);
        }

        // Cache if not too large
        if (content.length * 2 <= this.config.largeFileThreshold) {
          this.cache.set(objectId, content);
          this.updateStats();
        }

        return content;
      } catch (fetchError) {
        console.error(`[PRFileCacheService] ADO fetch failed for ${filePath}:`, fetchError);
        throw fetchError;
      }
    }

    return null;
  }

  /**
   * Evict all cache entries for a specific PR.
   * Called when a PR tab is closed to free memory.
   */
  evictPRFromCache(prContextKey: string): void {
    const contextService = getReviewContextService();
    const contextPath = contextService.getPRContextPath(prContextKey);

    // Read the manifest to get all objectIds for this PR
    try {
      const manifestPath = path.join(contextPath, 'context', 'files.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

        for (const file of manifest.files || []) {
          if (file.objectId) {
            this.cache.delete(file.objectId);
          }
          if (file.originalObjectId) {
            this.cache.delete(file.originalObjectId);
          }
        }

        console.log(`[PRFileCacheService] Evicted cache entries for PR: ${prContextKey}`);
      }
    } catch (error) {
      console.warn(`[PRFileCacheService] Error evicting PR from cache:`, error);
    }

    this.updateStats();
  }

  /**
   * Preload files into cache (background warmup).
   */
  async warmCache(
    prContextKey: string,
    files: Array<{ path: string; objectId?: string; originalObjectId?: string }>,
    maxFiles: number = 5
  ): Promise<void> {
    const contextService = getReviewContextService();
    const contextPath = contextService.getPRContextPath(prContextKey);

    let loaded = 0;

    for (const file of files) {
      if (loaded >= maxFiles) break;

      // Try to warm modified version first (most commonly viewed)
      if (file.objectId && !this.cache.has(file.objectId)) {
        const safePath = file.path.replace(/^\//, '');
        const diskPath = path.join(contextPath, 'modified', safePath);

        try {
          if (fs.existsSync(diskPath)) {
            const stats = fs.statSync(diskPath);
            if (stats.size <= this.config.largeFileThreshold) {
              const content = fs.readFileSync(diskPath, 'utf-8');
              this.cache.set(file.objectId, content);
              loaded++;
            }
          }
        } catch { /* ignore warmup errors */ }
      }
    }

    this.updateStats();
    console.log(`[PRFileCacheService] Warmed cache with ${loaded} files for: ${prContextKey}`);
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.cache.clear();
    this.updateStats();
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  private updateStats(): void {
    this.stats.currentCount = this.cache.size;
    this.stats.currentSize = this.cache.calculatedSize || 0;
  }
}

// Singleton instance
let instance: PRFileCacheService | null = null;

export function getPRFileCacheService(): PRFileCacheService {
  if (!instance) {
    instance = new PRFileCacheService();
  }
  return instance;
}
```

**Step 2: Verify build succeeds**

Run:
```bash
npm run build:main
```
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/main/services/pr-file-cache-service.ts
git commit -m "$(cat <<'EOF'
feat: add PRFileCacheService with LRU caching

- Three-tier fallback: cache → disk → ADO API
- Uses objectId as cache key for cross-PR deduplication
- Large file detection and cache bypass
- evictPRFromCache() for memory cleanup on tab close
- warmCache() for background preloading
- Configurable limits via FileCacheConfig

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add IPC Handlers for File Cache

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`

**Step 1: Add IPC handlers in main.ts**

Add these IPC handlers after the existing ADO handlers (around line 200):

```typescript
import { getPRFileCacheService } from './services/pr-file-cache-service.js';

// PR File Cache IPC handlers
ipcMain.handle('cache:get-file-content', async (
  _,
  prContextKey: string,
  filePath: string,
  version: 'original' | 'modified',
  objectId: string,
  org: string,
  project: string,
  repoId: string
) => {
  const cacheService = getPRFileCacheService();

  // Create ADO fetcher for fallback
  const adoFetcher = async () => {
    if (version === 'modified') {
      return adoClient.getFileContent(org, project, repoId, objectId);
    } else {
      // For original, we'd need the branch info - this is a simplified fallback
      throw new Error('Cannot fetch original content without branch info');
    }
  };

  return cacheService.getFileContent(prContextKey, filePath, version, objectId, adoFetcher);
});

ipcMain.handle('cache:evict-pr', async (_, prContextKey: string) => {
  const cacheService = getPRFileCacheService();
  cacheService.evictPRFromCache(prContextKey);
});

ipcMain.handle('cache:warm', async (
  _,
  prContextKey: string,
  files: Array<{ path: string; objectId?: string; originalObjectId?: string }>,
  maxFiles?: number
) => {
  const cacheService = getPRFileCacheService();
  await cacheService.warmCache(prContextKey, files, maxFiles);
});

ipcMain.handle('cache:get-stats', async () => {
  const cacheService = getPRFileCacheService();
  return cacheService.getStats();
});
```

**Step 2: Add preload API**

In `src/main/preload.ts`, add to the contextBridge.exposeInMainWorld call:

```typescript
// PR File Cache API
getCachedFileContent: (
  prContextKey: string,
  filePath: string,
  version: 'original' | 'modified',
  objectId: string,
  org: string,
  project: string,
  repoId: string
) => ipcRenderer.invoke('cache:get-file-content', prContextKey, filePath, version, objectId, org, project, repoId),

evictPRFromCache: (prContextKey: string) =>
  ipcRenderer.invoke('cache:evict-pr', prContextKey),

warmCache: (
  prContextKey: string,
  files: Array<{ path: string; objectId?: string; originalObjectId?: string }>,
  maxFiles?: number
) => ipcRenderer.invoke('cache:warm', prContextKey, files, maxFiles),

getCacheStats: () => ipcRenderer.invoke('cache:get-stats'),
```

**Step 3: Verify build succeeds**

Run:
```bash
npm run build:main
```
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/main/main.ts src/main/preload.ts
git commit -m "$(cat <<'EOF'
feat: add IPC handlers for PR file cache

Exposes cache service to renderer via:
- getCachedFileContent(): three-tier fetch
- evictPRFromCache(): cleanup on tab close
- warmCache(): background preloading
- getCacheStats(): monitoring

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Add IPC Handler for ensurePRContext

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`

**Step 1: Add ensurePRContext IPC handler**

In `src/main/main.ts`:

```typescript
ipcMain.handle('context:ensure-pr-context', async (
  _,
  prContext: PRContext,
  files: FileChange[],
  threads: CommentThread[],
  settings: ReviewContextSettings,
  fileContents: Array<[string, { original: string | null; modified: string | null }]>,
  lastCommitId: string
) => {
  const contextService = getReviewContextService();
  const fileContentsMap = new Map(fileContents);
  return contextService.ensurePRContext(prContext, files, threads, settings, fileContentsMap, lastCommitId);
});
```

**Step 2: Add preload API**

In `src/main/preload.ts`:

```typescript
ensurePRContext: (
  prContext: PRContext,
  files: FileChange[],
  threads: CommentThread[],
  settings: ReviewContextSettings,
  fileContents: Array<[string, { original: string | null; modified: string | null }]>,
  lastCommitId: string
) => ipcRenderer.invoke('context:ensure-pr-context', prContext, files, threads, settings, fileContents, lastCommitId),
```

**Step 3: Verify build succeeds**

Run:
```bash
npm run build:main
```
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/main/main.ts src/main/preload.ts
git commit -m "$(cat <<'EOF'
feat: add ensurePRContext IPC handler

Allows renderer to create/reuse PR context on disk.
Returns { contextPath, prContextKey, reused } for UI state.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Add Loading Indicator to DiffViewer

**Files:**
- Modify: `src/renderer/components/diff-viewer.ts:162-186`

**Step 1: Add showLoading and showError methods**

Add these methods to the DiffViewer class:

```typescript
  /**
   * Show loading indicator while file content is being fetched.
   */
  showLoading(filePath?: string): void {
    this.container.innerHTML = `
      <div class="diff-loading">
        <div class="loading-spinner"></div>
        <span>Loading ${filePath ? `"${filePath}"` : 'file'}...</span>
      </div>
    `;
  }

  /**
   * Show error message when file loading fails.
   */
  showError(message: string): void {
    this.container.innerHTML = `
      <div class="diff-error">
        <span class="error-icon">⚠️</span>
        <span>${escapeHtml(message)}</span>
      </div>
    `;
  }
```

**Step 2: Add CSS for loading state**

In the appropriate CSS file or inline styles, ensure these styles exist:

```css
.diff-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-secondary);
  gap: 12px;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border-color);
  border-top-color: var(--accent-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.diff-error {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--error-color);
  gap: 8px;
}
```

**Step 3: Verify build succeeds**

Run:
```bash
npm run build:renderer
```
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/renderer/components/diff-viewer.ts
git commit -m "$(cat <<'EOF'
feat: add loading and error states to DiffViewer

- showLoading(): displays spinner while fetching file
- showError(): displays error message on failure
- Supports lazy loading UX

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Update PRTabState Interface

**Files:**
- Modify: `src/renderer/app.ts:74-96`

**Step 1: Add prContextKey to PRTabState**

Update the PRTabState interface:

```typescript
interface PRTabState {
  org: string;
  project: string;
  repoId: string;
  repoName: string;
  prId: number;
  pullRequest: PullRequest | null;
  iterations: PullRequestIteration[];
  selectedIteration: number | null;
  fileChanges: FileChange[];  // Will store metadata only after migration
  selectedFile: string | null;
  threads: CommentThread[];
  diffViewMode: 'split' | 'unified';
  // Context path for disk-based storage
  prContextKey: string | null;
  // AI Review state
  aiSessionId: string | null;
  aiReviewInProgress: boolean;
  hasSavedReview: boolean;
  hasSavedWalkthrough: boolean;
  savedReviewInfo: SavedReviewInfo | null;
  savedWalkthroughInfo: SavedWalkthroughInfo | null;
  aiPanelState?: AICommentsPanelState;
}
```

**Step 2: Initialize prContextKey where PRTabState is created**

Find where PRTabState objects are created and add `prContextKey: null`.

**Step 3: Verify build succeeds**

Run:
```bash
npm run build:renderer
```
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/renderer/app.ts
git commit -m "$(cat <<'EOF'
feat: add prContextKey to PRTabState

Tracks the deterministic context key for disk-based file storage.
Used by selectFile() for lazy loading and closeReviewTab() for cleanup.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Update processChanges for Disk Storage

**Files:**
- Modify: `src/renderer/app.ts:1448-1499`

**Step 1: Modify processChanges to save files to disk**

Update the processChanges method to write files to disk after fetching:

```typescript
  private async processChanges(state: PRTabState, changes: IterationChange[]) {
    const targetBranch = state.pullRequest!.targetRefName.replace('refs/heads/', '');
    const lastCommitId = state.pullRequest!.lastMergeSourceCommit?.commitId || '';

    // Phase 1: Fetch all files (same as before)
    const fileContentsMap = new Map<string, { original: string | null; modified: string | null }>();

    const processedChanges = await Promise.all(
      changes.map(async (change): Promise<FileChange> => {
        const fileThreads = state.threads.filter(t =>
          t.threadContext?.filePath === change.item.path
        );

        let originalContent: string | null = null;
        let modifiedContent: string | null = null;

        // Load file contents for diff
        if (change.item.objectId && change.changeType !== 'delete') {
          try {
            modifiedContent = await window.electronAPI.getFileContent(
              state.org,
              state.project,
              state.repoId,
              change.item.objectId
            );
          } catch (e) {
            console.warn('Failed to load modified content:', e);
          }
        }

        if (['edit', 'delete', 'rename'].includes(change.changeType)) {
          try {
            originalContent = await window.electronAPI.getFileFromBranch(
              state.org,
              state.project,
              state.repoId,
              change.originalPath || change.item.path,
              targetBranch
            ) || null;
          } catch (e) {
            console.warn('Failed to load original content:', e);
          }
        }

        // Store content for disk write
        fileContentsMap.set(change.item.path, { original: originalContent, modified: modifiedContent });

        return {
          path: change.item.path,
          changeType: change.changeType as ChangeType,
          originalContent,  // Still include for now - will be removed in Phase 2
          modifiedContent,  // Still include for now - will be removed in Phase 2
          objectId: change.item.objectId,
          originalObjectId: change.item.originalObjectId,
          threads: fileThreads,
        };
      })
    );

    // Phase 2: Write to disk via ensurePRContext
    try {
      const prContext = {
        prId: state.prId,
        title: state.pullRequest!.title,
        description: state.pullRequest!.description || '',
        sourceBranch: state.pullRequest!.sourceRefName.replace('refs/heads/', ''),
        targetBranch,
        repository: state.repoName,
        org: state.org,
        project: state.project,
      };

      const settings = await window.electronAPI.getSettings();
      const linkedRepositories = settings?.linkedRepositories || [];

      const result = await window.electronAPI.ensurePRContext(
        prContext,
        processedChanges,
        state.threads,
        { linkedRepositories, whenRepoFound: 'tempOnly' },
        Array.from(fileContentsMap.entries()),
        lastCommitId
      );

      state.prContextKey = result.prContextKey;
      console.log(`[App] PR context ${result.reused ? 'reused' : 'created'}: ${result.prContextKey}`);

      // Background cache warmup (non-blocking)
      const filesToWarm = processedChanges.slice(0, 5).map(f => ({
        path: f.path,
        objectId: f.objectId,
        originalObjectId: f.originalObjectId,
      }));
      window.electronAPI.warmCache(result.prContextKey, filesToWarm).catch(console.warn);

    } catch (error) {
      console.error('[App] Failed to create PR context:', error);
      // Continue without disk storage - files are still in memory
    }

    state.fileChanges = processedChanges;
  }
```

**Step 2: Verify build succeeds**

Run:
```bash
npm run build:renderer
```
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/renderer/app.ts
git commit -m "$(cat <<'EOF'
feat: write PR files to disk in processChanges

- Creates PR context on disk via ensurePRContext()
- Stores prContextKey in state for lazy loading
- Background cache warmup for first 5 files
- Graceful fallback if disk write fails

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Update selectFile for Lazy Loading

**Files:**
- Modify: `src/renderer/app.ts:1501-1514`

**Step 1: Make selectFile async with lazy loading**

Update selectFile to load content on-demand:

```typescript
  private async selectFile(path: string) {
    const state = this.getCurrentPRState();
    if (!state) return;

    state.selectedFile = path;
    this.fileTree.setSelected(path);

    const file = state.fileChanges.find(f => f.path === path);
    if (!file) return;

    // Check if content is already in memory (backwards compatibility)
    if (file.originalContent !== undefined || file.modifiedContent !== undefined) {
      this.diffViewer.render(file, state.diffViewMode);
      this.commentsPanel.setFileThreads(file.threads);
      setTimeout(() => this.updateChangeNavigation(), 50);
      return;
    }

    // Lazy load from cache/disk
    if (!state.prContextKey) {
      this.diffViewer.showError('File content not available');
      return;
    }

    this.diffViewer.showLoading(path);

    try {
      const [originalContent, modifiedContent] = await Promise.all([
        file.originalObjectId
          ? window.electronAPI.getCachedFileContent(
              state.prContextKey,
              file.path,
              'original',
              file.originalObjectId,
              state.org,
              state.project,
              state.repoId
            )
          : Promise.resolve(null),
        file.objectId
          ? window.electronAPI.getCachedFileContent(
              state.prContextKey,
              file.path,
              'modified',
              file.objectId,
              state.org,
              state.project,
              state.repoId
            )
          : Promise.resolve(null),
      ]);

      const fileWithContent: FileChange = {
        ...file,
        originalContent: originalContent || undefined,
        modifiedContent: modifiedContent || undefined,
      };

      this.diffViewer.render(fileWithContent, state.diffViewMode);
      this.commentsPanel.setFileThreads(file.threads);
      setTimeout(() => this.updateChangeNavigation(), 50);

    } catch (error) {
      console.error('[App] Failed to load file content:', error);
      this.diffViewer.showError(`Failed to load file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
```

**Step 2: Update all callers of selectFile to handle async**

Search for `this.selectFile(` and ensure callers don't depend on synchronous completion.
Most callers (click handlers, keyboard navigation) should work fine with async.

**Step 3: Verify build succeeds**

Run:
```bash
npm run build:renderer
```
Expected: Build succeeds

**Step 4: Test manually**

Run:
```bash
npm run dev
```
Expected:
- Opening a PR shows loading indicator briefly
- File switching shows content
- Large files load without caching

**Step 5: Commit**

```bash
git add src/renderer/app.ts
git commit -m "$(cat <<'EOF'
feat: implement lazy file loading in selectFile

- Shows loading indicator while fetching
- Loads via getCachedFileContent (cache → disk → ADO)
- Backwards compatible with in-memory content
- Handles errors gracefully with error display

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Update closeReviewTab for Cache Cleanup

**Files:**
- Modify: `src/renderer/app.ts:644-686`

**Step 1: Add cache eviction on tab close**

Update closeReviewTab to evict from cache:

```typescript
  private closeReviewTab(tabId: string) {
    const tab = this.reviewTabs.find(t => t.id === tabId);
    if (!tab || !tab.closeable) return;

    // Remove tab
    const index = this.reviewTabs.findIndex(t => t.id === tabId);
    this.reviewTabs.splice(index, 1);

    // Get state before cleanup for cache eviction
    const state = this.prTabStates.get(tabId);

    // Evict from memory cache (keeps files on disk)
    if (state?.prContextKey) {
      window.electronAPI.evictPRFromCache(state.prContextKey).catch(console.warn);
    }

    // Clean up event listeners
    const controller = this.tabEventListeners.get(tabId);
    if (controller) {
      controller.abort();
      this.tabEventListeners.delete(tabId);
    }

    // Clean up WalkthroughsView
    this.walkthroughsViews.delete(tabId);

    // Clean up ResizablePanels
    const resizer = this.resizablePanels.get(tabId);
    if (resizer) {
      resizer.destroy();
      this.resizablePanels.delete(tabId);
    }

    // Remove tab state
    this.prTabStates.delete(tabId);

    // Remove tab panel
    const panel = document.getElementById(`prTabPanel-${tabId}`);
    panel?.remove();

    // Switch to another tab if this was active
    if (this.activeReviewTabId === tabId) {
      const newIndex = Math.min(index, this.reviewTabs.length - 1);
      const newTab = this.reviewTabs[newIndex];
      if (newTab) {
        this.switchReviewTab(newTab.id);
      }
    }

    this.updateTabBar();
  }
```

**Step 2: Verify build succeeds**

Run:
```bash
npm run build:renderer
```
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/renderer/app.ts
git commit -m "$(cat <<'EOF'
feat: evict PR from cache on tab close

- Calls evictPRFromCache() before deleting state
- Frees memory immediately
- Files remain on disk for 7 days (reuse on reopen)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Remove Content from FileChange After Initial Load

**Files:**
- Modify: `src/renderer/app.ts:1448-1499`

**Step 1: Clear content from state after disk write**

At the end of processChanges, after the disk write succeeds, clear the content from memory:

```typescript
    // Phase 3: Clear content from memory (lazy loading now handles it)
    if (state.prContextKey) {
      state.fileChanges = processedChanges.map(f => ({
        path: f.path,
        changeType: f.changeType,
        objectId: f.objectId,
        originalObjectId: f.originalObjectId,
        threads: f.threads,
        // Content intentionally omitted - will be lazy loaded
      }));
    } else {
      // Fallback: keep content in memory if disk storage failed
      state.fileChanges = processedChanges;
    }
```

**Step 2: Verify build succeeds**

Run:
```bash
npm run build:renderer
```
Expected: Build succeeds

**Step 3: Test memory reduction**

Run:
```bash
npm run dev
```
Expected:
- Open a PR with many files
- Memory usage should be much lower than before
- Files still load correctly when selected

**Step 4: Commit**

```bash
git add src/renderer/app.ts
git commit -m "$(cat <<'EOF'
feat: clear file content from memory after disk write

- Removes originalContent/modifiedContent from state.fileChanges
- Content lazy loaded on-demand via selectFile()
- Achieves 98% memory reduction for typical PRs
- Falls back to in-memory if disk write fails

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Integration Testing

**Files:**
- No files created - manual testing

**Step 1: Test basic functionality**

Run:
```bash
npm run dev
```

Test cases:
1. Open a small PR (5 files) - should work normally
2. Open a large PR (50+ files) - should work without memory issues
3. Switch between files - content should load with loading indicator
4. Close tab and reopen same PR - should reuse disk context

**Step 2: Test cache behavior**

1. View several files to populate cache
2. Check cache stats via dev tools console: `await window.electronAPI.getCacheStats()`
3. Verify hits increase on re-viewing same file
4. Close tab and verify memory freed (cache evicted)

**Step 3: Test error scenarios**

1. Open PR, then manually delete disk context folder
2. Try to view a file - should fallback to ADO fetch
3. Disconnect network after opening PR - should load from disk

**Step 4: Document any issues found**

Create issues for any bugs discovered during testing.

**Step 5: Commit any fixes**

If any fixes were needed, commit them with descriptive messages.

---

## Task 16: Final Cleanup and Documentation

**Files:**
- Update: `docs/plans/2026-01-28-pr-file-memory-optimization-design.md` (mark as implemented)

**Step 1: Mark design doc as implemented**

Update the status in the design document header:

```markdown
**Status:** ✅ Implemented (2026-01-28)
```

**Step 2: Add implementation notes**

Add a section at the bottom of the design doc:

```markdown
## Implementation Notes

- Implemented in Tasks 1-15 of `2026-01-28-pr-file-memory-optimization-impl.md`
- lru-cache package version: ^10.x
- Disk storage path: `{appData}/claude-toolkit/pr-contexts/`
- IPC handlers: `cache:get-file-content`, `cache:evict-pr`, `cache:warm`, `cache:get-stats`
- Backwards compatible: in-memory content still works if disk storage fails
```

**Step 3: Final commit**

```bash
git add docs/plans/2026-01-28-pr-file-memory-optimization-design.md
git commit -m "$(cat <<'EOF'
docs: mark PR file memory optimization as implemented

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

This implementation plan covers 16 tasks:

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Add lru-cache dependency | `package.json` |
| 2 | Create FileChangeMetadata type | `src/shared/types.ts` |
| 3 | Create cache configuration types | `src/shared/cache-types.ts` |
| 4 | Update ReviewContextService directory | `src/main/ai/review-context-service.ts` |
| 5 | Add deterministic context paths | `src/main/ai/review-context-service.ts` |
| 6 | Create PRFileCacheService | `src/main/services/pr-file-cache-service.ts` |
| 7 | Add IPC handlers for cache | `src/main/main.ts`, `src/main/preload.ts` |
| 8 | Add ensurePRContext IPC handler | `src/main/main.ts`, `src/main/preload.ts` |
| 9 | Add loading indicator to DiffViewer | `src/renderer/components/diff-viewer.ts` |
| 10 | Update PRTabState interface | `src/renderer/app.ts` |
| 11 | Update processChanges for disk storage | `src/renderer/app.ts` |
| 12 | Update selectFile for lazy loading | `src/renderer/app.ts` |
| 13 | Update closeReviewTab for cleanup | `src/renderer/app.ts` |
| 14 | Remove content from FileChange | `src/renderer/app.ts` |
| 15 | Integration testing | Manual testing |
| 16 | Final cleanup and documentation | Design doc |

**Expected outcome:** 98% memory reduction for typical PR workloads, with lazy loading latency < 200ms for cached files and < 1s for disk reads.
