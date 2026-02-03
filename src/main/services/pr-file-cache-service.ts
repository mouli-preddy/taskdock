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
    // Guard against null/undefined filePath
    if (!filePath) {
      console.warn('[PRFileCacheService] getFileContent called with null/undefined filePath');
      return null;
    }

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
      // Skip files with null/undefined paths
      if (!file.path) continue;

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
