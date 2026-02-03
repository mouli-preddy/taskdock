# PR File Memory Optimization Design

**Date:** 2026-01-28
**Status:** Implemented (2026-01-28)
**Goal:** Reduce memory footprint for PR file viewing by implementing disk-based storage with LRU caching

---

## Problem Statement

### Current Architecture
The application loads all PR file contents into memory when opening a PR tab:

- **app.ts:1451-1498**: Fetches `originalContent` and `modifiedContent` for every file
- **Stored in memory**: `state.fileChanges` array contains full file contents
- **Memory growth**: Multiple PR tabs multiply memory usage linearly

### Impact
For large PRs (50+ files, or files >1MB each):
- Memory footprint grows significantly
- All file contents loaded upfront, even if user only views a few files
- Multiple PR tabs can consume 50MB+ of memory

### Goal
Adopt a lazy-loading approach similar to the AI review system:
- Save files to disk when PR is opened
- Load file contents on-demand when user clicks a file
- Cache recently viewed files with LRU eviction
- Purge from memory when no longer needed

---

## Architecture Overview

### Key Components

**1. PRFileCacheService** (New)
- Global LRU cache mapping `objectId → file content`
- Coordinates disk I/O with ReviewContextService
- Manages cache lifecycle and eviction

**2. ReviewContextService** (Modified)
- Unified storage for both UI viewing and AI reviews
- Deterministic paths: `{org}-{project}-{prId}` instead of random GUID
- Longer retention: 7 days instead of 24 hours

**3. App.ts** (Modified)
- Lazy file loading on user interaction
- Store file metadata only, not content
- Async `selectFile()` with loading indicators

### Storage Structure

```
{appData}/claude-toolkit/pr-contexts/  ← Renamed from "reviews"
  ├── {org}-{project}-{prId}/           ← Deterministic key
  │   ├── context/
  │   │   ├── pr.json
  │   │   ├── comments.json
  │   │   └── files.json
  │   ├── original/                     ← Shared by UI and AI
  │   │   └── {file-paths}
  │   ├── modified/                     ← Shared by UI and AI
  │   │   └── {file-paths}
  │   └── reviews/                      ← AI review outputs
  │       └── {session-guid}/
  │           ├── output/
  │           │   ├── review.json
  │           │   └── walkthrough.json
  │           └── {guid}.done.json
```

---

## Cache Strategy

### Global Shared Cache

**Why Global?**
- Fixed memory ceiling regardless of number of open PRs
- Cross-PR optimization: same files in multiple PRs reuse cached content
- Predictable memory usage
- Simpler to manage than per-tab caches

**Cache Key: ObjectId**
```typescript
type FileCacheKey = string; // objectId from Azure DevOps
// Example: "abc123def456..." (Git SHA-1 hash)
```

**Why ObjectId?**
- Provided by Azure DevOps Git API
- Immutable: same objectId = identical content (guaranteed by Git)
- Content-addressed: perfect for deduplication
- Cross-PR cache hits when same commit appears in multiple PRs

### Cache Configuration

```typescript
interface FileCacheConfig {
  maxFiles: number;           // Default: 20 files
  maxSizeBytes: number;       // Default: 50MB total
  maxFileSizeBytes: number;   // Default: 5MB per file limit
  largeFileThreshold: number; // Default: 1MB = "large file"
}
```

**Eviction Policy:**
- LRU (Least Recently Used)
- Triggered when `maxFiles` or `maxSizeBytes` exceeded
- Large files (>1MB) bypass cache, read directly from disk

---

## Data Flow

### Opening a PR Tab

**Current Flow:**
```
openPRTab → loadPullRequest → loadIterationChanges →
  fetch ALL files → store in state.fileChanges → done
```

**New Flow:**
```
openPRTab → loadPullRequest → loadIterationChanges →
  fetch ALL file contents (needed for disk write) →
  write to disk via ensurePRContext() →
  store metadata only (no content) in state →
  optional: background warmup cache
```

**Implementation:**
```typescript
// Phase 1: Fetch all files (same as before)
const fileContents = await Promise.all(
  changes.map(async (change) => {
    const original = await getOriginalContent(...);
    const modified = await getModifiedContent(...);
    return { path, original, modified, objectId, ... };
  })
);

// Phase 2: Write to disk
const prContextKey = `${state.org}-${state.project}-${state.prId}`;
const contextInfo = await prFileCacheService.ensurePRContext(
  prContext,
  changes,
  threads,
  settings,
  new Map(fileContents.map(f => [f.path, { original: f.original, modified: f.modified }]))
);

// Phase 3: Store metadata only
state.fileChanges = changes.map((change): FileChange => {
  return {
    path: change.item.path,
    changeType: change.changeType,
    // NO originalContent/modifiedContent!
    objectId: change.item.objectId,
    originalObjectId: change.item.originalObjectId,
    threads: fileThreads,
  };
});

state.contextPath = contextInfo.contextPath;
```

### Viewing a File

**Current Flow:**
```
selectFile → read from state.fileChanges (in memory) → render
```

**New Flow:**
```
selectFile → getFileContent(objectId) →
  Check cache → Hit? → Render
              → Miss? → Load from disk → Cache → Render
```

**Implementation:**
```typescript
private async selectFile(path: string) {
  const file = state.fileChanges.find(f => f.path === path);
  if (!file) return;

  this.diffViewer.showLoading();

  try {
    const prContextKey = `${state.org}-${state.project}-${state.prId}`;

    // Load on-demand via cache service
    const [originalContent, modifiedContent] = await Promise.all([
      file.originalObjectId
        ? prFileCacheService.getFileContent(prContextKey, file.path, 'original', file.originalObjectId)
        : null,
      file.objectId
        ? prFileCacheService.getFileContent(prContextKey, file.path, 'modified', file.objectId)
        : null,
    ]);

    const fileWithContent: FileChange = { ...file, originalContent, modifiedContent };
    this.diffViewer.render(fileWithContent, state.diffViewMode);

  } catch (error) {
    this.diffViewer.showError(`Failed to load file: ${error.message}`);
  }
}
```

---

## PRFileCacheService Implementation

### Core Interface

```typescript
class PRFileCacheService {
  private cache: LRUCache<string, string>; // objectId -> content
  private prContexts: Map<string, PRContextMetadata>;
  private contextService: ReviewContextService;
  private stats: CacheStats;

  constructor(config: FileCacheConfig) {
    this.cache = new LRUCache({
      max: config.maxFiles,
      maxSize: config.maxSizeBytes,
      sizeCalculation: (content) => content.length,
    });
  }

  /**
   * Get or create PR context on disk
   * Returns existing if already prepared
   */
  async ensurePRContext(
    prContext: PRContext,
    files: FileChange[],
    threads: CommentThread[],
    settings: ReviewContextSettings,
    fileContents: Map<string, { original: string | null; modified: string | null }>
  ): Promise<ReviewContextInfo>

  /**
   * Get file content (cache-first, then disk, then ADO fallback)
   */
  async getFileContent(
    prContextKey: string,
    filePath: string,
    version: 'original' | 'modified',
    objectId: string
  ): Promise<string>

  /**
   * Preload files into cache (background, low priority)
   */
  async warmCache(prContextKey: string, filePaths: string[]): Promise<void>

  /**
   * Remove PR context from disk when tab closes
   */
  async cleanupPRContext(prContextKey: string): Promise<void>

  /**
   * Clear cache entries for closed PR (but keep on disk)
   */
  evictPRFromCache(prContextKey: string): void

  /**
   * Clean up stale PR contexts from disk (time-based)
   */
  cleanupStalePRContexts(maxAgeMs?: number): void
}
```

### getFileContent() Algorithm

```typescript
async getFileContent(
  prContextKey: string,
  filePath: string,
  version: 'original' | 'modified',
  objectId: string
): Promise<string> {
  // 1. Check cache
  const cached = this.cache.get(objectId);
  if (cached) {
    this.stats.hits++;
    return cached;
  }

  this.stats.misses++;

  // 2. Check file size before loading
  const diskPath = path.join(this.getContextPath(prContextKey), version, filePath);
  const stats = await fs.promises.stat(diskPath);

  if (stats.size > this.config.maxFileSizeBytes) {
    throw new Error(`File too large: ${filePath} (${stats.size} bytes)`);
  }

  // 3. Large files bypass cache
  if (stats.size > this.config.largeFileThreshold) {
    return await fs.promises.readFile(diskPath, 'utf-8');
  }

  // 4. Load from disk
  const content = await fs.promises.readFile(diskPath, 'utf-8');

  // 5. Cache for next time
  this.cache.set(objectId, content);

  return content;
}
```

---

## Cleanup Strategy

### Two-Tier Cleanup

**Tier 1: Memory Cache (Immediate)**
```typescript
private closeReviewTab(tabId: string) {
  const state = this.prTabStates.get(tabId);

  if (state) {
    const prContextKey = `${state.org}-${state.project}-${state.prId}`;

    // Evict from cache only - frees memory immediately
    prFileCacheService.evictPRFromCache(prContextKey);

    this.prTabStates.delete(tabId);
  }
}
```

**Benefits:**
- Instant memory recovery when tab closes
- Files remain on disk for potential reopen
- Multiple AI reviews can reuse cached files

**Tier 2: Disk Storage (Time-Based)**
```typescript
cleanupStalePRContexts(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): void {
  // Default: 7 days (vs 24h for old review contexts)

  const prContextsDir = path.join(getAppDataPath(), 'claude-toolkit', 'pr-contexts');
  const now = Date.now();

  for (const entry of fs.readdirSync(prContextsDir)) {
    const contextPath = path.join(prContextsDir, entry);
    const manifestPath = path.join(contextPath, 'context', 'files.json');

    try {
      const stats = fs.statSync(manifestPath);
      const age = now - stats.mtimeMs;

      if (age > maxAgeMs) {
        fs.rmSync(contextPath, { recursive: true, force: true });
        console.log(`Cleaned up stale PR context: ${entry}`);
      }
    } catch (error) {
      console.error(`Error cleaning ${entry}:`, error);
    }
  }
}
```

**Called:**
- On app startup (default)
- Optionally: periodic interval (e.g., every 24h)

---

## Unified Storage Benefits

### Reuse Between UI and AI Reviews

**Before:**
- UI: Files in memory
- AI Review: Files written to temporary disk location
- Duplication: Same files stored twice

**After:**
- UI: Opens PR → writes files to disk
- AI Review: Reuses same files from disk
- Multiple AI reviews: All reuse same files

**Storage Lifecycle:**
```
1. User opens PR tab
   → Files written to pr-contexts/{org}-{project}-{prId}/

2. User starts AI review
   → Reads from pr-contexts/{org}-{project}-{prId}/original|modified/
   → Writes output to pr-contexts/{org}-{project}-{prId}/reviews/{session-guid}/

3. User starts another AI review on same PR
   → Reuses same files from step 1
   → Creates new reviews/{session-guid-2}/ folder

4. User closes PR tab
   → Cache evicted (memory freed)
   → Disk files remain (for 7 days)

5. User reopens same PR within 7 days
   → Instant load from disk (no ADO fetch)
   → Starts with empty cache, lazy loads on demand
```

---

## Error Handling

### 1. Disk I/O Failures

**Scenarios:**
- Disk full
- File not found
- Permission errors
- Corrupted files

**Handling: Three-tier fallback**
```typescript
async getFileContent(...): Promise<string> {
  try {
    // 1. Check cache
    const cached = this.cache.get(objectId);
    if (cached) return cached;

    // 2. Load from disk
    const diskPath = path.join(this.getContextPath(prContextKey), version, filePath);

    if (!fs.existsSync(diskPath)) {
      console.warn(`File missing on disk, re-fetching: ${filePath}`);
      return await this.fetchAndCacheFile(prContextKey, filePath, version, objectId);
    }

    const content = await fs.promises.readFile(diskPath, 'utf-8');
    this.cache.set(objectId, content);
    return content;

  } catch (error) {
    // 3. Fallback: Fetch from ADO
    console.error(`Disk read failed, falling back to ADO:`, error);
    return await this.fetchAndCacheFile(prContextKey, filePath, version, objectId);
  }
}

private async fetchAndCacheFile(...): Promise<string> {
  const content = await window.electronAPI.getFileContent(org, project, repoId, objectId);

  // Try to repair disk storage
  try {
    const diskPath = path.join(this.getContextPath(prContextKey), version, filePath);
    await fs.promises.mkdir(path.dirname(diskPath), { recursive: true });
    await fs.promises.writeFile(diskPath, content, 'utf-8');
  } catch (writeError) {
    console.error('Failed to repair disk storage:', writeError);
    // Continue - we have the content
  }

  this.cache.set(objectId, content);
  return content;
}
```

### 2. Large Files

**Problem:** 100MB file could exceed cache limits or cause memory issues

**Detection:**
```typescript
const stats = await fs.promises.stat(diskPath);

if (stats.size > this.config.maxFileSizeBytes) {
  throw new Error(`File too large to cache: ${filePath} (${stats.size} bytes)`);
}

if (stats.size > this.config.largeFileThreshold) {
  // Large file: don't cache, read directly each time
  console.warn(`Large file, skipping cache: ${filePath}`);
  return await fs.promises.readFile(diskPath, 'utf-8');
}
```

### 3. Concurrent Access

**Scenario:** User views files while AI review is running

**Solution:** Read-only safety with lock files
```typescript
async ensurePRContext(...): Promise<ReviewContextInfo> {
  const prContextKey = `${org}-${project}-${prId}`;
  const contextPath = this.getContextPath(prContextKey);

  // Check if already prepared
  if (fs.existsSync(path.join(contextPath, 'context', 'files.json'))) {
    return this.loadExistingContext(prContextKey);
  }

  // First time: use lock file to prevent race condition
  const lockPath = path.join(contextPath, '.preparing.lock');

  try {
    await fs.promises.mkdir(contextPath, { recursive: true });
    const fd = await fs.promises.open(lockPath, 'wx'); // Fails if exists
    await fd.close();

    // We have the lock - prepare context
    await this.contextService.prepareContext(...);

    // Release lock
    await fs.promises.unlink(lockPath);

    return { contextPath, ... };

  } catch (error) {
    if (error.code === 'EEXIST') {
      // Another process is preparing - wait and retry
      await this.waitForPreparation(lockPath);
      return this.loadExistingContext(prContextKey);
    }
    throw error;
  }
}
```

**Safety guarantees:**
- Both UI and AI read from same disk files (no conflicts)
- AI writes to separate `reviews/{sessionGuid}/output/` folder
- Files are immutable after initial write
- No file locking needed for reads

### 4. Stale Data / PR Updates

**Scenario:** PR gets updated while tab is open (new commits pushed)

**Detection:**
```typescript
interface PRContextManifest {
  prId: number;
  lastCommitId: string;  // Track source branch HEAD
  createdAt: string;
  files: FileMetadata[];
}

async refreshPR(state: PRTabState): Promise<void> {
  const currentCommitId = state.pullRequest.lastMergeSourceCommit.commitId;
  const cachedManifest = this.loadManifest(state.contextPath);

  if (cachedManifest.lastCommitId !== currentCommitId) {
    // PR was updated - invalidate cache
    console.log('PR updated, refreshing context');

    await prFileCacheService.cleanupPRContext(prContextKey);
    await this.loadPullRequest(state, tabId); // Re-fetch everything
  }
}
```

### 5. Cache Corruption

**Optional integrity check (development only):**
```typescript
if (process.env.NODE_ENV === 'development') {
  const actualHash = crypto.createHash('sha1').update(content).digest('hex');
  if (actualHash !== objectId) {
    console.error(`CACHE CORRUPTION: ${filePath} hash mismatch!`);
    return await this.fetchAndCacheFile(...);
  }
}
```

---

## Memory Savings Analysis

### Before (Current)

**Scenario:** User opens 5 PR tabs, each with 50 files averaging 100KB

```
Memory per PR:
  50 files × 100KB × 2 (original + modified) = 10MB

Total memory:
  5 PRs × 10MB = 50MB
```

### After (Optimized)

**Global cache:** 20 files × 50KB average = 1MB total

```
Memory with 5 open PRs:
  Shared cache: 1MB (regardless of number of PRs)

Memory savings: 50MB → 1MB = 98% reduction
```

**Additional benefits:**
- Opening 10 more PRs: 0MB additional memory (cache already full)
- Viewing same files across PRs: Instant (cache hit)
- Large files (>1MB): Bypass cache completely

---

## Configuration

### User Settings

```typescript
interface PRCacheSettings {
  // Memory cache
  maxCachedFiles: number;        // Default: 20
  maxCacheSizeMB: number;        // Default: 50
  maxFileSizeMB: number;         // Default: 5

  // Disk storage
  diskRetentionDays: number;     // Default: 7
  cleanupOnStartup: boolean;     // Default: true

  // Performance
  enableBackgroundWarmup: boolean; // Default: true
  warmupFileCount: number;         // Default: 5
}
```

**Accessible via:**
- Settings UI (new section under "Performance")
- Config file: `~/.claude-toolkit/settings.json`

---

## Implementation Plan

### Phase 1: Core Infrastructure
1. Create `PRFileCacheService` class with LRU cache integration
2. Add `lru-cache` dependency
3. Update `ReviewContextService`:
   - Rename `reviews/` → `pr-contexts/`
   - Add deterministic path generation: `{org}-{project}-{prId}`
   - Update cleanup logic (7 days instead of 24h)
4. Add configuration interface and defaults
5. Update types: remove `originalContent`/`modifiedContent` from in-memory `FileChange`

**Estimated effort:** 2-3 days

### Phase 2: App.ts Integration
1. Modify `loadIterationChanges()` to save files to disk via `ensurePRContext()`
2. Update `FileChange` state management (metadata only)
3. Make `selectFile()` async with lazy loading via `getFileContent()`
4. Add loading indicators in `DiffViewer.showLoading()`
5. Implement cache eviction on tab close

**Estimated effort:** 2 days

### Phase 3: Error Handling
1. Add three-tier fallback (cache → disk → ADO)
2. Implement large file detection and bypass logic
3. Add lock file mechanism for concurrent writes
4. Add integrity checks for development mode
5. Handle PR update/stale data detection

**Estimated effort:** 1-2 days

### Phase 4: Optimization
1. Implement background cache warmup
2. Add cache statistics and monitoring
3. Make cleanup intervals configurable
4. Add user settings UI for cache limits
5. Add telemetry for cache hit/miss rates

**Estimated effort:** 1-2 days

### Phase 5: Testing & Validation
1. Test with large PRs (100+ files, 5MB+ files)
2. Test concurrent AI reviews while viewing files
3. Test tab switching performance
4. Verify disk cleanup works correctly
5. Test all error recovery paths
6. Performance benchmarks before/after

**Estimated effort:** 2 days

**Total estimated effort:** 8-11 days

---

## Success Criteria

- ✓ Memory usage remains under 5MB regardless of number of open PR tabs
- ✓ File viewing latency < 200ms for cached files
- ✓ File viewing latency < 1s for disk reads
- ✓ No file content stored in `state.fileChanges` in memory
- ✓ AI reviews work without changes
- ✓ Multiple AI reviews on same PR reuse files
- ✓ Cache hit rate > 80% for typical usage patterns
- ✓ Disk cleanup successfully removes stale contexts
- ✓ All error scenarios have graceful fallbacks

---

## Future Enhancements

### 1. Smart Prefetching
- Prefetch files adjacent to currently viewed file
- Prefetch files with comments
- ML-based prediction of next file to view

### 2. Advanced Eviction Policies
- LFU (Least Frequently Used) option
- TTL (Time To Live) option
- Hybrid LRU-LFU

### 3. Compression
- Compress files on disk (gzip)
- Decompress on load into cache
- Trade disk space for CPU cycles

### 4. Shared Cache Across App Instances
- SQLite-based shared cache
- Multiple app windows share same cache
- Requires inter-process communication

### 5. Progressive Loading
- Load file headers first (first 100 lines)
- Load full file on scroll to bottom
- Useful for very large files (10MB+)

---

## Related Work

### Existing Patterns in Codebase

**ReviewContextService** (src/main/ai/review-context-service.ts)
- Already writes files to disk for AI reviews
- Cleanup logic exists (currently 24h)
- Structure is compatible with our design

**DiffViewer** (src/renderer/components/diff-viewer.ts)
- Already generates diffs on-demand
- Can be extended with loading indicators

**FileTree** (src/renderer/components/file-tree.ts)
- Already shows file list without contents
- Compatible with metadata-only storage

### Similar Patterns in Other Tools

**VS Code**
- File system provider abstraction
- Virtual documents loaded on-demand
- LRU cache for recently opened files

**GitHub Desktop**
- Disk-based diff storage
- Lazy loading of file diffs
- Cleanup on repository close

---

## Risks & Mitigations

### Risk 1: Disk I/O Performance
**Impact:** Slow file loading degrades UX

**Mitigation:**
- SSD-optimized (most users have SSDs)
- Cache warmup for likely files
- Fallback to ADO always available
- Large files bypass cache

### Risk 2: Disk Space Usage
**Impact:** PR contexts consume disk space

**Mitigation:**
- 7-day retention limit
- User-configurable retention
- Cleanup on startup
- Typical usage: 50 PRs × 10MB = 500MB (acceptable)

### Risk 3: Cache Misses Degrade Performance
**Impact:** Too many cache misses = frequent disk reads

**Mitigation:**
- Tunable cache size (default: 20 files / 50MB)
- Background warmup
- Monitor cache hit rate
- Adjust defaults based on telemetry

### Risk 4: Concurrent Write Conflicts
**Impact:** Race condition when multiple processes write to disk

**Mitigation:**
- Lock file mechanism
- Atomic file operations
- Retry logic with backoff
- Detection of existing context

---

## Conclusion

This design provides a comprehensive solution for reducing PR memory footprint while maintaining performance and reliability. The two-tier storage strategy (memory cache + disk persistence) achieves:

- **98% memory reduction** for typical workloads
- **Reusable storage** between UI and AI reviews
- **Graceful degradation** with multi-tier fallbacks
- **Predictable performance** with bounded memory usage

The phased implementation plan allows for incremental rollout with validation at each stage.

---

## Implementation Notes

- Implemented in Tasks 1-18 of `2026-01-28-pr-file-memory-optimization-impl.md`
- lru-cache package version: ^11.2.5
- Disk storage path: `{appData}/claude-toolkit/pr-contexts/`
- PR context key format: `{org}-{project}-{prId}`
- IPC handlers: `cache:get-file-content`, `cache:evict-pr`, `cache:warm`, `cache:get-stats`, `context:ensure-pr-context`
- Backwards compatible: in-memory content still works if disk storage fails
- AI review and walkthrough now share the same PR context path
- PR updates are detected via lastCommitId comparison in manifest
