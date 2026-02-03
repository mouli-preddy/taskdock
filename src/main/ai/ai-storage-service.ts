/**
 * AI Storage Service
 * Handles persistent storage of AI reviews and walkthroughs
 */

import { getAppDataPath } from '../utils/app-paths.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  AIReviewComment,
  AIProvider,
  AIProviderType,
  CodeWalkthrough,
  ReviewPreset,
  WalkthroughPreset,
  SavedReviewMetadata,
  SavedWalkthroughMetadata,
} from '../../shared/ai-types.js';

export interface SavedReview {
  sessionId: string;
  prId: number;
  organization: string;
  project: string;
  provider: AIProvider;
  savedAt: string; // ISO timestamp
  comments: AIReviewComment[];
}

export interface SavedWalkthrough {
  walkthrough: CodeWalkthrough;
  organization: string;
  project: string;
  savedAt: string; // ISO timestamp
}

export interface SavedReviewInfo {
  exists: boolean;
  savedAt?: string;
  commentCount?: number;
}

export interface SavedWalkthroughInfo {
  exists: boolean;
  savedAt?: string;
}

class AIStorageService {
  private getBasePath(): string {
    return path.join(getAppDataPath(), 'reviews');
  }

  /**
   * Get the storage directory path for a specific PR
   */
  getReviewPath(organization: string, project: string, prId: number): string {
    return path.join(
      this.getBasePath(),
      this.sanitizePath(organization),
      this.sanitizePath(project),
      prId.toString()
    );
  }

  /**
   * Sanitize path components to prevent directory traversal
   */
  private sanitizePath(component: string): string {
    return component.replace(/[<>:"/\\|?*]/g, '_');
  }

  /**
   * Ensure the directory exists
   */
  private async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  /**
   * Save a review to JSON file
   */
  async saveReview(
    organization: string,
    project: string,
    prId: number,
    sessionId: string,
    provider: AIProvider,
    comments: AIReviewComment[]
  ): Promise<void> {
    const dirPath = this.getReviewPath(organization, project, prId);
    await this.ensureDir(dirPath);

    const savedReview: SavedReview = {
      sessionId,
      prId,
      organization,
      project,
      provider,
      savedAt: new Date().toISOString(),
      comments,
    };

    const filePath = path.join(dirPath, 'review.json');
    await fs.writeFile(filePath, JSON.stringify(savedReview, null, 2), 'utf-8');
  }

  /**
   * Load a review from JSON file
   */
  async loadReview(
    organization: string,
    project: string,
    prId: number
  ): Promise<SavedReview | null> {
    const dirPath = this.getReviewPath(organization, project, prId);
    const filePath = path.join(dirPath, 'review.json');

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as SavedReview;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Check if a saved review exists
   */
  async hasReview(
    organization: string,
    project: string,
    prId: number
  ): Promise<SavedReviewInfo> {
    const dirPath = this.getReviewPath(organization, project, prId);
    const filePath = path.join(dirPath, 'review.json');

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const review = JSON.parse(content) as SavedReview;
      return {
        exists: true,
        savedAt: review.savedAt,
        commentCount: review.comments.length,
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return { exists: false };
      }
      throw error;
    }
  }

  /**
   * Save a walkthrough to JSON file
   */
  async saveWalkthrough(
    organization: string,
    project: string,
    prId: number,
    walkthrough: CodeWalkthrough
  ): Promise<void> {
    const dirPath = this.getReviewPath(organization, project, prId);
    await this.ensureDir(dirPath);

    const savedWalkthrough: SavedWalkthrough = {
      walkthrough,
      organization,
      project,
      savedAt: new Date().toISOString(),
    };

    const filePath = path.join(dirPath, 'walkthrough.json');
    await fs.writeFile(filePath, JSON.stringify(savedWalkthrough, null, 2), 'utf-8');
  }

  /**
   * Load a walkthrough from JSON file
   */
  async loadWalkthrough(
    organization: string,
    project: string,
    prId: number
  ): Promise<SavedWalkthrough | null> {
    const dirPath = this.getReviewPath(organization, project, prId);
    const filePath = path.join(dirPath, 'walkthrough.json');

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as SavedWalkthrough;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Check if a saved walkthrough exists
   */
  async hasWalkthrough(
    organization: string,
    project: string,
    prId: number
  ): Promise<SavedWalkthroughInfo> {
    const dirPath = this.getReviewPath(organization, project, prId);
    const filePath = path.join(dirPath, 'walkthrough.json');

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const walkthrough = JSON.parse(content) as SavedWalkthrough;
      return {
        exists: true,
        savedAt: walkthrough.savedAt,
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return { exists: false };
      }
      throw error;
    }
  }

  /**
   * Delete saved review and walkthrough data for a PR
   */
  async deleteSavedData(
    organization: string,
    project: string,
    prId: number
  ): Promise<void> {
    const dirPath = this.getReviewPath(organization, project, prId);

    try {
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Save a review with session-specific filename
   */
  async saveReviewSession(
    organization: string,
    project: string,
    prId: number,
    sessionId: string,
    displayName: string,
    provider: AIProviderType,
    comments: AIReviewComment[],
    preset?: ReviewPreset,
    customPrompt?: string
  ): Promise<void> {
    const dirPath = this.getReviewPath(organization, project, prId);
    await this.ensureDir(dirPath);

    const savedReview = {
      version: 2,
      sessionId,
      displayName,
      prId,
      organization,
      project,
      provider,
      preset,
      customPrompt,
      savedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      comments,
    };

    const filePath = path.join(dirPath, `review-${sessionId}.json`);
    await fs.writeFile(filePath, JSON.stringify(savedReview, null, 2), 'utf-8');
  }

  /**
   * Load all reviews for a PR (metadata only for listing)
   */
  async listReviews(
    organization: string,
    project: string,
    prId: number
  ): Promise<SavedReviewMetadata[]> {
    const dirPath = this.getReviewPath(organization, project, prId);

    try {
      const files = await fs.readdir(dirPath);
      const reviewFiles = files.filter(f => f.startsWith('review-') && f.endsWith('.json'));

      const reviews: SavedReviewMetadata[] = [];

      for (const file of reviewFiles) {
        try {
          const content = await fs.readFile(path.join(dirPath, file), 'utf-8');
          const review = JSON.parse(content);
          reviews.push({
            sessionId: review.sessionId,
            displayName: review.displayName || 'Review',
            provider: review.provider,
            preset: review.preset,
            customPrompt: review.customPrompt,
            commentCount: review.comments?.length || 0,
            createdAt: review.createdAt || review.savedAt,
            savedAt: review.savedAt,
          });
        } catch (e) {
          // Skip invalid files
        }
      }

      return reviews.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Load a specific review by session ID
   */
  async loadReviewSession(
    organization: string,
    project: string,
    prId: number,
    sessionId: string
  ): Promise<SavedReview | null> {
    const dirPath = this.getReviewPath(organization, project, prId);
    const filePath = path.join(dirPath, `review-${sessionId}.json`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as SavedReview;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete a specific review
   */
  async deleteReviewSession(
    organization: string,
    project: string,
    prId: number,
    sessionId: string
  ): Promise<void> {
    const dirPath = this.getReviewPath(organization, project, prId);
    const filePath = path.join(dirPath, `review-${sessionId}.json`);

    try {
      await fs.unlink(filePath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Save a walkthrough with session-specific filename
   */
  async saveWalkthroughSession(
    organization: string,
    project: string,
    prId: number,
    sessionId: string,
    displayName: string,
    provider: AIProviderType,
    walkthrough: CodeWalkthrough,
    preset?: WalkthroughPreset,
    customPrompt?: string
  ): Promise<void> {
    const dirPath = this.getReviewPath(organization, project, prId);
    await this.ensureDir(dirPath);

    const savedWalkthrough = {
      version: 2,
      sessionId,
      displayName,
      prId,
      organization,
      project,
      provider,
      preset,
      customPrompt,
      savedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      walkthrough,
    };

    const filePath = path.join(dirPath, `walkthrough-${sessionId}.json`);
    await fs.writeFile(filePath, JSON.stringify(savedWalkthrough, null, 2), 'utf-8');
  }

  /**
   * Load all walkthroughs for a PR (metadata only for listing)
   */
  async listWalkthroughs(
    organization: string,
    project: string,
    prId: number
  ): Promise<SavedWalkthroughMetadata[]> {
    const dirPath = this.getReviewPath(organization, project, prId);

    try {
      const files = await fs.readdir(dirPath);
      const walkthroughFiles = files.filter(f => f.startsWith('walkthrough-') && f.endsWith('.json'));

      const walkthroughs: SavedWalkthroughMetadata[] = [];

      // Check for legacy walkthrough.json file
      if (files.includes('walkthrough.json')) {
        try {
          const content = await fs.readFile(path.join(dirPath, 'walkthrough.json'), 'utf-8');
          const data = JSON.parse(content) as SavedWalkthrough;
          walkthroughs.push({
            sessionId: 'legacy-walkthrough',
            displayName: 'Walkthrough',
            provider: 'claude-sdk', // Legacy walkthroughs were from Claude
            stepCount: data.walkthrough?.steps?.length || 0,
            estimatedReadTime: data.walkthrough?.estimatedReadTime || 0,
            createdAt: data.savedAt,
            savedAt: data.savedAt,
          });
        } catch (e) {
          // Skip if invalid
        }
      }

      // Load session-based walkthroughs
      for (const file of walkthroughFiles) {
        try {
          const content = await fs.readFile(path.join(dirPath, file), 'utf-8');
          const data = JSON.parse(content);
          walkthroughs.push({
            sessionId: data.sessionId,
            displayName: data.displayName || 'Walkthrough',
            provider: data.provider,
            preset: data.preset,
            customPrompt: data.customPrompt,
            stepCount: data.walkthrough?.steps?.length || 0,
            estimatedReadTime: data.walkthrough?.estimatedReadTime || 0,
            createdAt: data.createdAt || data.savedAt,
            savedAt: data.savedAt,
          });
        } catch (e) {
          // Skip invalid files
        }
      }

      return walkthroughs.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Load a specific walkthrough by session ID
   */
  async loadWalkthroughSession(
    organization: string,
    project: string,
    prId: number,
    sessionId: string
  ): Promise<SavedWalkthrough | null> {
    const dirPath = this.getReviewPath(organization, project, prId);

    // Handle legacy walkthrough
    if (sessionId === 'legacy-walkthrough') {
      const legacyPath = path.join(dirPath, 'walkthrough.json');
      try {
        const content = await fs.readFile(legacyPath, 'utf-8');
        return JSON.parse(content) as SavedWalkthrough;
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    }

    const filePath = path.join(dirPath, `walkthrough-${sessionId}.json`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as SavedWalkthrough;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete a specific walkthrough
   */
  async deleteWalkthroughSession(
    organization: string,
    project: string,
    prId: number,
    sessionId: string
  ): Promise<void> {
    const dirPath = this.getReviewPath(organization, project, prId);
    const filePath = path.join(dirPath, `walkthrough-${sessionId}.json`);

    try {
      await fs.unlink(filePath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

// Singleton instance
let storageServiceInstance: AIStorageService | null = null;

export function getAIStorageService(): AIStorageService {
  if (!storageServiceInstance) {
    storageServiceInstance = new AIStorageService();
  }
  return storageServiceInstance;
}
