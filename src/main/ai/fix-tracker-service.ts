/**
 * Fix Tracker Service
 * Tracks which comments (AI and ADO) have been fixed via the Apply mechanism
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { getAppDataPath } from '../utils/app-paths.js';
import type { FixedComment, PRFixTracker } from '../../shared/ai-types.js';
import { getLogger } from '../services/logger-service.js';

const LOG_CATEGORY = 'FixTrackerService';

class FixTrackerService {
  private getBasePath(): string {
    return path.join(getAppDataPath(), 'reviews');
  }

  /**
   * Sanitize path components to prevent directory traversal
   */
  private sanitizePath(component: string): string {
    return component.replace(/[<>:"/\\|?*]/g, '_');
  }

  /**
   * Get the path to a PR's fix tracker file
   */
  private getFixTrackerPath(prId: number, org: string, project: string): string {
    return path.join(
      this.getBasePath(),
      this.sanitizePath(org),
      this.sanitizePath(project),
      prId.toString(),
      'fixes.json'
    );
  }

  /**
   * Ensure the directory exists
   */
  private async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  /**
   * Load fix tracker for a PR
   */
  async loadFixTracker(prId: number, org: string, project: string): Promise<PRFixTracker> {
    const filePath = this.getFixTrackerPath(prId, org, project);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as PRFixTracker;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Return empty tracker
        return {
          prId,
          organization: org,
          project,
          fixes: [],
          lastUpdated: new Date().toISOString(),
        };
      }
      throw error;
    }
  }

  /**
   * Mark a comment as fixed (called when apply succeeds)
   */
  async markFixed(
    prId: number,
    org: string,
    project: string,
    fix: FixedComment
  ): Promise<void> {
    const logger = getLogger();
    const tracker = await this.loadFixTracker(prId, org, project);

    // Check if already marked (prevent duplicates)
    const existing = tracker.fixes.find(
      f => f.commentId === fix.commentId && f.commentType === fix.commentType
    );

    if (existing) {
      logger.info(LOG_CATEGORY, 'Comment already marked as fixed', {
        prId,
        commentId: fix.commentId,
        commentType: fix.commentType,
      });
      return;
    }

    tracker.fixes.push(fix);
    tracker.lastUpdated = new Date().toISOString();

    // Persist to disk
    const filePath = this.getFixTrackerPath(prId, org, project);
    const dir = path.dirname(filePath);
    await this.ensureDir(dir);
    await fs.writeFile(filePath, JSON.stringify(tracker, null, 2), 'utf-8');

    logger.info(LOG_CATEGORY, 'Marked comment as fixed', {
      prId,
      commentId: fix.commentId,
      commentType: fix.commentType,
    });
  }

  /**
   * Check if a specific comment is fixed
   */
  isFixed(
    commentId: string,
    commentType: 'ai' | 'ado',
    tracker: PRFixTracker
  ): boolean {
    return tracker.fixes.some(
      f => f.commentId === commentId && f.commentType === commentType
    );
  }

  /**
   * Get all fixed comment IDs for quick lookup
   */
  getFixedIds(tracker: PRFixTracker, commentType: 'ai' | 'ado'): Set<string> {
    return new Set(
      tracker.fixes
        .filter(f => f.commentType === commentType)
        .map(f => f.commentId)
    );
  }
}

// Singleton instance
let fixTrackerServiceInstance: FixTrackerService | null = null;

export function getFixTrackerService(): FixTrackerService {
  if (!fixTrackerServiceInstance) {
    fixTrackerServiceInstance = new FixTrackerService();
  }
  return fixTrackerServiceInstance;
}
