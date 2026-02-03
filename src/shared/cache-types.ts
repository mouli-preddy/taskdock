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
