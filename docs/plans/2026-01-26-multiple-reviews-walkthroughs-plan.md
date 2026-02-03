# Multiple Reviews & Walkthroughs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable multiple concurrent AI reviews and walkthroughs per PR, with customizable presets and user-defined focus areas.

**Architecture:** Extend existing `AIReviewService` to support multiple sessions per PR, create new `WalkthroughService` for standalone walkthroughs, and add `PresetService` for managing user-configurable presets. UI changes include tabbed interface for reviews in `AICommentsPanel` and new sidebar section for walkthroughs.

**Tech Stack:** TypeScript, Electron (IPC), xterm.js (terminals), existing renderer component patterns.

---

## Task 1: Add New Types to ai-types.ts

**Files:**
- Modify: `src/shared/ai-types.ts`

**Step 1: Add preset types**

Add these types after the existing `SavedWalkthrough` interface (around line 191):

```typescript
// Review preset (built-in or user-created)
export interface ReviewPreset {
  id: string;
  name: string;
  description?: string;
  focusAreas: ('security' | 'performance' | 'bugs' | 'style')[];
  customPrompt?: string;
  isBuiltIn: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Walkthrough preset
export interface WalkthroughPreset {
  id: string;
  name: string;
  description?: string;
  customPrompt?: string;
  isBuiltIn: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Built-in review presets
export const BUILT_IN_REVIEW_PRESETS: ReviewPreset[] = [
  {
    id: 'quick-scan',
    name: 'Quick Scan',
    description: 'Fast overview of all areas',
    focusAreas: ['security', 'performance', 'bugs', 'style'],
    isBuiltIn: true,
  },
  {
    id: 'security-audit',
    name: 'Security Audit',
    description: 'Focus on security vulnerabilities',
    focusAreas: ['security'],
    customPrompt: 'Pay special attention to authentication, authorization, input validation, and data exposure.',
    isBuiltIn: true,
  },
  {
    id: 'performance-review',
    name: 'Performance Review',
    description: 'Focus on performance issues',
    focusAreas: ['performance'],
    customPrompt: 'Look for N+1 queries, unnecessary re-renders, memory leaks, and inefficient algorithms.',
    isBuiltIn: true,
  },
  {
    id: 'bug-hunt',
    name: 'Bug Hunt',
    description: 'Focus on potential bugs and edge cases',
    focusAreas: ['bugs'],
    customPrompt: 'Look for edge cases, null pointer issues, race conditions, and logic errors.',
    isBuiltIn: true,
  },
  {
    id: 'code-style',
    name: 'Code Style',
    description: 'Focus on style and maintainability',
    focusAreas: ['style'],
    customPrompt: 'Focus on code readability, naming conventions, and maintainability.',
    isBuiltIn: true,
  },
];

// Built-in walkthrough presets
export const BUILT_IN_WALKTHROUGH_PRESETS: WalkthroughPreset[] = [
  {
    id: 'full-overview',
    name: 'Full Overview',
    description: 'Complete PR walkthrough',
    isBuiltIn: true,
  },
  {
    id: 'architecture-changes',
    name: 'Architecture Changes',
    description: 'Focus on structural changes',
    customPrompt: 'Focus on explaining architectural decisions, component relationships, and structural changes.',
    isBuiltIn: true,
  },
  {
    id: 'data-flow',
    name: 'Data Flow',
    description: 'Explain how data moves through changes',
    customPrompt: 'Trace how data flows through the changed code, from input to output.',
    isBuiltIn: true,
  },
  {
    id: 'testing-strategy',
    name: 'Testing Strategy',
    description: 'Explain what tests cover',
    customPrompt: 'Explain the testing approach, what scenarios are covered, and any gaps.',
    isBuiltIn: true,
  },
];

// Walkthrough session for standalone walkthroughs
export interface WalkthroughSession {
  id: string;
  prId: number;
  name: string;
  provider: AIProviderType;
  showTerminal?: boolean;
  status: 'preparing' | 'generating' | 'complete' | 'error' | 'cancelled';
  statusText?: string;
  contextPath?: string;
  walkthrough?: CodeWalkthrough;
  preset?: WalkthroughPreset;
  customPrompt?: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

// Request for standalone walkthrough
export interface WalkthroughRequest {
  prId: number;
  provider: AIProviderType;
  preset?: WalkthroughPreset;
  customPrompt?: string;
  showTerminal?: boolean;
  displayName: string;
}

// Walkthrough progress event
export interface WalkthroughProgressEvent {
  sessionId: string;
  status: WalkthroughSession['status'];
  statusText?: string;
}

// Walkthrough complete event
export interface WalkthroughCompleteEvent {
  sessionId: string;
  walkthrough: CodeWalkthrough;
}

// Walkthrough error event
export interface WalkthroughErrorEvent {
  sessionId: string;
  error: string;
}
```

**Step 2: Extend AIReviewRequest**

Modify the existing `AIReviewRequest` interface (around line 76):

```typescript
export interface AIReviewRequest {
  prId: number;
  provider: AIProviderType;
  depth: 'quick' | 'standard' | 'thorough';
  focusAreas: ('security' | 'performance' | 'bugs' | 'style')[];
  generateWalkthrough: boolean;
  showTerminal?: boolean;
  // New fields for multiple reviews support
  preset?: ReviewPreset;
  customPrompt?: string;
  displayName?: string;
}
```

**Step 3: Extend AIReviewSession**

Modify the existing `AIReviewSession` interface (around line 55):

```typescript
export interface AIReviewSession {
  sessionId: string;
  prId: number;
  provider: AIProviderType;
  showTerminal?: boolean;
  status: 'idle' | 'preparing' | 'reviewing' | 'complete' | 'error' | 'cancelled';
  statusText?: string;
  contextPath?: string;
  comments: AIReviewComment[];
  walkthrough?: CodeWalkthrough;
  error?: string;
  // New fields for multiple reviews support
  displayName?: string;
  preset?: ReviewPreset;
  customPrompt?: string;
  createdAt?: string;
  completedAt?: string;
}
```

**Step 4: Add SavedReview extension**

Extend `SavedReview` interface (in ai-storage-service.ts or ai-types.ts):

```typescript
export interface SavedReviewMetadata {
  sessionId: string;
  displayName: string;
  provider: AIProviderType;
  preset?: ReviewPreset;
  customPrompt?: string;
  commentCount: number;
  createdAt: string;
  savedAt: string;
}

export interface SavedWalkthroughMetadata {
  sessionId: string;
  displayName: string;
  provider: AIProviderType;
  preset?: WalkthroughPreset;
  customPrompt?: string;
  stepCount: number;
  estimatedReadTime: number;
  createdAt: string;
  savedAt: string;
}
```

**Step 5: Commit**

```bash
git add src/shared/ai-types.ts
git commit -m "feat: add types for multiple reviews/walkthroughs and presets"
```

---

## Task 2: Create PresetService

**Files:**
- Create: `src/main/ai/preset-service.ts`

**Step 1: Create the preset service**

```typescript
/**
 * Preset Service
 * Manages built-in and user-created presets for reviews and walkthroughs
 */

import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { ReviewPreset, WalkthroughPreset } from '../../shared/ai-types.js';
import {
  BUILT_IN_REVIEW_PRESETS,
  BUILT_IN_WALKTHROUGH_PRESETS,
} from '../../shared/ai-types.js';

interface PresetsFile<T> {
  version: number;
  presets: T[];
}

class PresetService {
  private getPresetsDir(): string {
    return path.join(app.getPath('appData'), 'taskdock', 'presets');
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.getPresetsDir(), { recursive: true });
  }

  private getReviewPresetsPath(): string {
    return path.join(this.getPresetsDir(), 'review-presets.json');
  }

  private getWalkthroughPresetsPath(): string {
    return path.join(this.getPresetsDir(), 'walkthrough-presets.json');
  }

  // ==================== Review Presets ====================

  async getReviewPresets(): Promise<ReviewPreset[]> {
    const userPresets = await this.loadUserReviewPresets();
    return [...BUILT_IN_REVIEW_PRESETS, ...userPresets];
  }

  private async loadUserReviewPresets(): Promise<ReviewPreset[]> {
    try {
      const content = await fs.readFile(this.getReviewPresetsPath(), 'utf-8');
      const data = JSON.parse(content) as PresetsFile<ReviewPreset>;
      return data.presets || [];
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async saveUserReviewPresets(presets: ReviewPreset[]): Promise<void> {
    await this.ensureDir();
    const data: PresetsFile<ReviewPreset> = { version: 1, presets };
    await fs.writeFile(this.getReviewPresetsPath(), JSON.stringify(data, null, 2), 'utf-8');
  }

  async saveReviewPreset(preset: Omit<ReviewPreset, 'id' | 'isBuiltIn' | 'createdAt'>): Promise<ReviewPreset> {
    const userPresets = await this.loadUserReviewPresets();
    const now = new Date().toISOString();
    const newPreset: ReviewPreset = {
      ...preset,
      id: `user-${uuidv4()}`,
      isBuiltIn: false,
      createdAt: now,
      updatedAt: now,
    };
    userPresets.push(newPreset);
    await this.saveUserReviewPresets(userPresets);
    return newPreset;
  }

  async updateReviewPreset(id: string, updates: Partial<ReviewPreset>): Promise<ReviewPreset | null> {
    const userPresets = await this.loadUserReviewPresets();
    const index = userPresets.findIndex(p => p.id === id);
    if (index === -1) return null;

    userPresets[index] = {
      ...userPresets[index],
      ...updates,
      id, // Preserve ID
      isBuiltIn: false, // Ensure it stays user preset
      updatedAt: new Date().toISOString(),
    };
    await this.saveUserReviewPresets(userPresets);
    return userPresets[index];
  }

  async deleteReviewPreset(id: string): Promise<boolean> {
    const userPresets = await this.loadUserReviewPresets();
    const filtered = userPresets.filter(p => p.id !== id);
    if (filtered.length === userPresets.length) return false;
    await this.saveUserReviewPresets(filtered);
    return true;
  }

  // ==================== Walkthrough Presets ====================

  async getWalkthroughPresets(): Promise<WalkthroughPreset[]> {
    const userPresets = await this.loadUserWalkthroughPresets();
    return [...BUILT_IN_WALKTHROUGH_PRESETS, ...userPresets];
  }

  private async loadUserWalkthroughPresets(): Promise<WalkthroughPreset[]> {
    try {
      const content = await fs.readFile(this.getWalkthroughPresetsPath(), 'utf-8');
      const data = JSON.parse(content) as PresetsFile<WalkthroughPreset>;
      return data.presets || [];
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async saveUserWalkthroughPresets(presets: WalkthroughPreset[]): Promise<void> {
    await this.ensureDir();
    const data: PresetsFile<WalkthroughPreset> = { version: 1, presets };
    await fs.writeFile(this.getWalkthroughPresetsPath(), JSON.stringify(data, null, 2), 'utf-8');
  }

  async saveWalkthroughPreset(preset: Omit<WalkthroughPreset, 'id' | 'isBuiltIn' | 'createdAt'>): Promise<WalkthroughPreset> {
    const userPresets = await this.loadUserWalkthroughPresets();
    const now = new Date().toISOString();
    const newPreset: WalkthroughPreset = {
      ...preset,
      id: `user-${uuidv4()}`,
      isBuiltIn: false,
      createdAt: now,
      updatedAt: now,
    };
    userPresets.push(newPreset);
    await this.saveUserWalkthroughPresets(userPresets);
    return newPreset;
  }

  async updateWalkthroughPreset(id: string, updates: Partial<WalkthroughPreset>): Promise<WalkthroughPreset | null> {
    const userPresets = await this.loadUserWalkthroughPresets();
    const index = userPresets.findIndex(p => p.id === id);
    if (index === -1) return null;

    userPresets[index] = {
      ...userPresets[index],
      ...updates,
      id,
      isBuiltIn: false,
      updatedAt: new Date().toISOString(),
    };
    await this.saveUserWalkthroughPresets(userPresets);
    return userPresets[index];
  }

  async deleteWalkthroughPreset(id: string): Promise<boolean> {
    const userPresets = await this.loadUserWalkthroughPresets();
    const filtered = userPresets.filter(p => p.id !== id);
    if (filtered.length === userPresets.length) return false;
    await this.saveUserWalkthroughPresets(filtered);
    return true;
  }
}

// Singleton
let presetServiceInstance: PresetService | null = null;

export function getPresetService(): PresetService {
  if (!presetServiceInstance) {
    presetServiceInstance = new PresetService();
  }
  return presetServiceInstance;
}
```

**Step 2: Commit**

```bash
git add src/main/ai/preset-service.ts
git commit -m "feat: add PresetService for managing review and walkthrough presets"
```

---

## Task 3: Extend AIStorageService for Multiple Reviews/Walkthroughs

**Files:**
- Modify: `src/main/ai/ai-storage-service.ts`

**Step 1: Add methods for multiple review/walkthrough files**

Add these methods to the `AIStorageService` class:

```typescript
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
```

**Step 2: Add necessary imports at the top**

```typescript
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
```

**Step 3: Commit**

```bash
git add src/main/ai/ai-storage-service.ts
git commit -m "feat: extend AIStorageService for multiple reviews/walkthroughs per PR"
```

---

## Task 4: Update AIReviewService for Multiple Sessions

**Files:**
- Modify: `src/main/ai/ai-review-service.ts`

**Step 1: Remove single-session restriction**

In the `startReview` method, remove or comment out the code that cancels existing sessions:

```typescript
// Remove this block (around line 73-75):
// if (this.activeSession) {
//   this.cancelSession(this.activeSession);
// }
```

**Step 2: Add displayName and other fields to session creation**

Update the session object creation (around line 91):

```typescript
const session: AIReviewSession = {
  sessionId,
  prId: prContext.prId,
  provider: request.provider,
  showTerminal: request.showTerminal,
  status: 'preparing',
  statusText: 'Preparing context...',
  comments: [],
  // New fields
  displayName: request.displayName || this.generateDisplayName(request),
  preset: request.preset,
  customPrompt: request.customPrompt,
  createdAt: new Date().toISOString(),
};
```

**Step 3: Add helper method for display name generation**

```typescript
/**
 * Generate a display name for a review session
 */
private generateDisplayName(request: AIReviewRequest): string {
  if (request.preset) {
    return request.preset.name;
  }
  if (request.customPrompt) {
    // Truncate custom prompt to first 30 chars
    const truncated = request.customPrompt.substring(0, 30);
    return `Custom: ${truncated}${request.customPrompt.length > 30 ? '...' : ''}`;
  }
  return 'Review';
}
```

**Step 4: Add method to get sessions for a PR**

```typescript
/**
 * Get all sessions for a specific PR
 */
getSessionsForPR(prId: number): AIReviewSession[] {
  return Array.from(this.sessions.values())
    .filter(s => s.prId === prId)
    .sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
}

/**
 * Remove a session
 */
removeSession(sessionId: string): void {
  const session = this.sessions.get(sessionId);
  if (session) {
    // Cancel if running
    if (session.status === 'preparing' || session.status === 'reviewing') {
      this.cancelSession(sessionId);
    }
    this.sessions.delete(sessionId);
    this.contextInfoMap.delete(sessionId);
  }
}
```

**Step 5: Commit**

```bash
git add src/main/ai/ai-review-service.ts
git commit -m "feat: update AIReviewService to support multiple concurrent sessions"
```

---

## Task 5: Create WalkthroughService

**Files:**
- Create: `src/main/ai/walkthrough-service.ts`

**Step 1: Create the walkthrough service**

```typescript
/**
 * Walkthrough Service
 * Manages standalone walkthrough generation sessions
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { getReviewContextService } from './review-context-service.js';
import { getReviewExecutorService } from './review-executor-service.js';
import { getLogger } from '../services/logger-service.js';
import type {
  AIProviderType,
  WalkthroughSession,
  WalkthroughRequest,
  WalkthroughProgressEvent,
  WalkthroughCompleteEvent,
  WalkthroughErrorEvent,
  PRContext,
  CodeWalkthrough,
  ReviewContextInfo,
  WalkthroughPreset,
} from '../../shared/ai-types.js';
import type { FileChange, CommentThread } from '../../shared/types.js';
import type { ConsoleReviewSettings } from '../../shared/terminal-types.js';

const LOG_CATEGORY = 'WalkthroughService';

export class WalkthroughService extends EventEmitter {
  private sessions: Map<string, WalkthroughSession> = new Map();
  private contextInfoMap: Map<string, ReviewContextInfo> = new Map();

  constructor() {
    super();
  }

  /**
   * Start a new walkthrough generation session
   */
  async startWalkthrough(
    prContext: PRContext,
    files: FileChange[],
    threads: CommentThread[],
    request: WalkthroughRequest,
    settings: ConsoleReviewSettings,
    fileContents: Map<string, { original: string | null; modified: string | null }>
  ): Promise<string> {
    const logger = getLogger();
    logger.info(LOG_CATEGORY, 'Starting walkthrough', {
      prId: prContext.prId,
      provider: request.provider,
      displayName: request.displayName,
    });

    const executorService = getReviewExecutorService();
    const executor = executorService.getExecutor(request.provider);

    const availability = await executor.isAvailable();
    if (!availability.available) {
      throw new Error(`Provider ${request.provider} is not available: ${availability.error}`);
    }

    const sessionId = uuidv4();
    const session: WalkthroughSession = {
      id: sessionId,
      prId: prContext.prId,
      name: request.displayName,
      provider: request.provider,
      showTerminal: request.showTerminal,
      status: 'preparing',
      statusText: 'Preparing context...',
      preset: request.preset,
      customPrompt: request.customPrompt,
      createdAt: new Date().toISOString(),
    };

    this.sessions.set(sessionId, session);
    this.emitProgress(session);

    // Run in background
    this.runWalkthrough(session, prContext, files, threads, request, settings, fileContents).catch((error) => {
      logger.error(LOG_CATEGORY, 'Walkthrough failed', { sessionId, error: error.message });
      this.handleError(sessionId, error);
    });

    return sessionId;
  }

  private async runWalkthrough(
    session: WalkthroughSession,
    prContext: PRContext,
    files: FileChange[],
    threads: CommentThread[],
    request: WalkthroughRequest,
    settings: ConsoleReviewSettings,
    fileContents: Map<string, { original: string | null; modified: string | null }>
  ): Promise<void> {
    const logger = getLogger();

    try {
      const contextService = getReviewContextService();
      const executorService = getReviewExecutorService();

      // Prepare context
      const contextInfo = await contextService.prepareContext(
        prContext,
        files,
        threads,
        { linkedRepositories: settings.linkedRepositories, whenRepoFound: settings.whenRepoFound },
        fileContents
      );

      this.contextInfoMap.set(session.id, contextInfo);
      session.contextPath = contextInfo.contextPath;

      // Update status
      session.status = 'generating';
      session.statusText = 'Generating walkthrough...';
      this.emitProgress(session);

      // Execute - request walkthrough only
      const executor = executorService.getExecutor(request.provider, { showTerminal: request.showTerminal });
      const result = await executor.execute(contextInfo, {
        depth: 'standard',
        focusAreas: [],
        generateWalkthrough: true,
        walkthroughOnly: true, // New flag to indicate walkthrough-only mode
        walkthroughPrompt: this.buildWalkthroughPrompt(request),
        onStatusChange: (status) => {
          session.statusText = status;
          this.emitProgress(session);
        },
      });

      if (result.error) {
        throw new Error(result.error);
      }

      if (!result.walkthrough) {
        throw new Error('No walkthrough generated');
      }

      // Store walkthrough
      result.walkthrough.prId = prContext.prId;
      session.walkthrough = result.walkthrough;
      session.status = 'complete';
      session.completedAt = new Date().toISOString();
      session.statusText = undefined;

      this.emitProgress(session);
      this.emitComplete(session.id, result.walkthrough);

    } catch (error: any) {
      this.handleError(session.id, error);
    }
  }

  private buildWalkthroughPrompt(request: WalkthroughRequest): string {
    let prompt = 'Generate a detailed code walkthrough for this PR.';

    if (request.preset?.customPrompt) {
      prompt += `\n\nFocus: ${request.preset.customPrompt}`;
    }

    if (request.customPrompt) {
      prompt += `\n\nUser instructions: ${request.customPrompt}`;
    }

    return prompt;
  }

  cancelWalkthrough(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'cancelled';
      session.statusText = undefined;

      const executorService = getReviewExecutorService();
      const executor = executorService.getExecutor(session.provider, { showTerminal: session.showTerminal });
      executor.cancel();

      this.emitProgress(session);
    }
  }

  getSession(sessionId: string): WalkthroughSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionsForPR(prId: number): WalkthroughSession[] {
    return Array.from(this.sessions.values())
      .filter(s => s.prId === prId)
      .sort((a, b) => {
        const aTime = new Date(a.createdAt).getTime();
        const bTime = new Date(b.createdAt).getTime();
        return bTime - aTime;
      });
  }

  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.status === 'preparing' || session.status === 'generating') {
        this.cancelWalkthrough(sessionId);
      }
      this.sessions.delete(sessionId);
      this.contextInfoMap.delete(sessionId);
    }
  }

  getContextInfo(sessionId: string): ReviewContextInfo | undefined {
    return this.contextInfoMap.get(sessionId);
  }

  // Event emitters
  private emitProgress(session: WalkthroughSession): void {
    const event: WalkthroughProgressEvent = {
      sessionId: session.id,
      status: session.status,
      statusText: session.statusText,
    };
    this.emit('progress', event);
  }

  private emitComplete(sessionId: string, walkthrough: CodeWalkthrough): void {
    const event: WalkthroughCompleteEvent = { sessionId, walkthrough };
    this.emit('complete', event);
  }

  private handleError(sessionId: string, error: Error): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'error';
      session.error = error.message;
      session.statusText = undefined;
    }

    const event: WalkthroughErrorEvent = { sessionId, error: error.message };
    this.emit('error', event);
  }

  // Callback registration
  onProgress(callback: (event: WalkthroughProgressEvent) => void): void {
    this.on('progress', callback);
  }

  onComplete(callback: (event: WalkthroughCompleteEvent) => void): void {
    this.on('complete', callback);
  }

  onError(callback: (event: WalkthroughErrorEvent) => void): void {
    this.on('error', callback);
  }

  async dispose(): Promise<void> {
    const contextService = getReviewContextService();
    for (const [, contextInfo] of this.contextInfoMap) {
      contextService.cleanupContext(contextInfo.contextPath);
    }
    this.sessions.clear();
    this.contextInfoMap.clear();
  }
}

// Singleton
let walkthroughServiceInstance: WalkthroughService | null = null;

export function getWalkthroughService(): WalkthroughService {
  if (!walkthroughServiceInstance) {
    walkthroughServiceInstance = new WalkthroughService();
  }
  return walkthroughServiceInstance;
}

export async function disposeWalkthroughService(): Promise<void> {
  if (walkthroughServiceInstance) {
    await walkthroughServiceInstance.dispose();
    walkthroughServiceInstance = null;
  }
}
```

**Step 2: Commit**

```bash
git add src/main/ai/walkthrough-service.ts
git commit -m "feat: add WalkthroughService for standalone walkthrough generation"
```

---

## Task 6: Add IPC Handlers for New Services

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/main/preload.cjs`

**Step 1: Add imports to main.ts**

Add at the top of main.ts:

```typescript
import { getPresetService } from './ai/preset-service.js';
import { getWalkthroughService, disposeWalkthroughService } from './ai/walkthrough-service.js';
```

**Step 2: Add preset IPC handlers to main.ts**

Add in `setupIpcHandlers()`:

```typescript
  // ==================== Preset handlers ====================
  const presetService = getPresetService();

  ipcMain.handle('presets:get-review-presets', async () => {
    return presetService.getReviewPresets();
  });

  ipcMain.handle('presets:save-review-preset', async (_, preset) => {
    return presetService.saveReviewPreset(preset);
  });

  ipcMain.handle('presets:update-review-preset', async (_, id: string, updates) => {
    return presetService.updateReviewPreset(id, updates);
  });

  ipcMain.handle('presets:delete-review-preset', async (_, id: string) => {
    return presetService.deleteReviewPreset(id);
  });

  ipcMain.handle('presets:get-walkthrough-presets', async () => {
    return presetService.getWalkthroughPresets();
  });

  ipcMain.handle('presets:save-walkthrough-preset', async (_, preset) => {
    return presetService.saveWalkthroughPreset(preset);
  });

  ipcMain.handle('presets:update-walkthrough-preset', async (_, id: string, updates) => {
    return presetService.updateWalkthroughPreset(id, updates);
  });

  ipcMain.handle('presets:delete-walkthrough-preset', async (_, id: string) => {
    return presetService.deleteWalkthroughPreset(id);
  });
```

**Step 3: Add walkthrough service IPC handlers to main.ts**

```typescript
  // ==================== Walkthrough Service handlers ====================
  const walkthroughService = getWalkthroughService();

  walkthroughService.onProgress((event) => {
    mainWindow?.webContents.send('walkthrough:progress', event);
  });

  walkthroughService.onComplete((event) => {
    mainWindow?.webContents.send('walkthrough:complete', event);
    // Auto-save walkthrough
    const session = walkthroughService.getSession(event.sessionId);
    const context = walkthroughSessionContextMap.get(event.sessionId);
    if (session && context && event.walkthrough) {
      storageService.saveWalkthroughSession(
        context.organization,
        context.project,
        context.prId,
        event.sessionId,
        session.name,
        session.provider,
        event.walkthrough,
        session.preset,
        session.customPrompt
      ).catch(err => console.error('Failed to auto-save walkthrough:', err));
    }
  });

  walkthroughService.onError((event) => {
    mainWindow?.webContents.send('walkthrough:error', event);
  });

  // Track walkthrough session context for saving
  const walkthroughSessionContextMap = new Map<string, { organization: string; project: string; prId: number }>();

  ipcMain.handle('walkthrough:start', async (
    _,
    org: string,
    project: string,
    prContext: PRContext,
    files: FileChange[],
    threads: CommentThread[],
    request: WalkthroughRequest,
    fileContents: Record<string, { original: string | null; modified: string | null }>
  ) => {
    const settings = store.get('consoleReview') as ConsoleReviewSettings;
    const contentsMap = new Map(Object.entries(fileContents));

    const sessionId = await walkthroughService.startWalkthrough(
      prContext,
      files,
      threads,
      request,
      settings,
      contentsMap as Map<string, { original: string | null; modified: string | null }>
    );

    walkthroughSessionContextMap.set(sessionId, { organization: org, project, prId: prContext.prId });
    return sessionId;
  });

  ipcMain.handle('walkthrough:cancel', async (_, sessionId: string) => {
    walkthroughService.cancelWalkthrough(sessionId);
  });

  ipcMain.handle('walkthrough:get-session', async (_, sessionId: string) => {
    return walkthroughService.getSession(sessionId);
  });

  ipcMain.handle('walkthrough:get-sessions-for-pr', async (_, prId: number) => {
    return walkthroughService.getSessionsForPR(prId);
  });

  ipcMain.handle('walkthrough:remove-session', async (_, sessionId: string) => {
    walkthroughService.removeSession(sessionId);
    walkthroughSessionContextMap.delete(sessionId);
  });
```

**Step 4: Add storage list handlers to main.ts**

```typescript
  // ==================== Extended Storage handlers ====================
  ipcMain.handle('ai:list-reviews', async (_, org: string, project: string, prId: number) => {
    return storageService.listReviews(org, project, prId);
  });

  ipcMain.handle('ai:load-review-session', async (_, org: string, project: string, prId: number, sessionId: string) => {
    return storageService.loadReviewSession(org, project, prId, sessionId);
  });

  ipcMain.handle('ai:delete-review-session', async (_, org: string, project: string, prId: number, sessionId: string) => {
    return storageService.deleteReviewSession(org, project, prId, sessionId);
  });

  ipcMain.handle('ai:list-walkthroughs', async (_, org: string, project: string, prId: number) => {
    return storageService.listWalkthroughs(org, project, prId);
  });

  ipcMain.handle('ai:load-walkthrough-session', async (_, org: string, project: string, prId: number, sessionId: string) => {
    return storageService.loadWalkthroughSession(org, project, prId, sessionId);
  });

  ipcMain.handle('ai:delete-walkthrough-session', async (_, org: string, project: string, prId: number, sessionId: string) => {
    return storageService.deleteWalkthroughSession(org, project, prId, sessionId);
  });

  ipcMain.handle('ai:get-sessions-for-pr', async (_, prId: number) => {
    return aiService.getSessionsForPR(prId);
  });

  ipcMain.handle('ai:remove-session', async (_, sessionId: string) => {
    aiService.removeSession(sessionId);
    sessionContextMap.delete(sessionId);
  });
```

**Step 5: Update preload.ts - Add new API methods**

Add in the `contextBridge.exposeInMainWorld` call:

```typescript
  // Preset API
  presetsGetReviewPresets: () => ipcRenderer.invoke('presets:get-review-presets'),
  presetsSaveReviewPreset: (preset: any) => ipcRenderer.invoke('presets:save-review-preset', preset),
  presetsUpdateReviewPreset: (id: string, updates: any) => ipcRenderer.invoke('presets:update-review-preset', id, updates),
  presetsDeleteReviewPreset: (id: string) => ipcRenderer.invoke('presets:delete-review-preset', id),
  presetsGetWalkthroughPresets: () => ipcRenderer.invoke('presets:get-walkthrough-presets'),
  presetsSaveWalkthroughPreset: (preset: any) => ipcRenderer.invoke('presets:save-walkthrough-preset', preset),
  presetsUpdateWalkthroughPreset: (id: string, updates: any) => ipcRenderer.invoke('presets:update-walkthrough-preset', id, updates),
  presetsDeleteWalkthroughPreset: (id: string) => ipcRenderer.invoke('presets:delete-walkthrough-preset', id),

  // Walkthrough Service API
  walkthroughStart: (org: string, project: string, prContext: any, files: any[], threads: any[], request: any, fileContents: any) =>
    ipcRenderer.invoke('walkthrough:start', org, project, prContext, files, threads, request, fileContents),
  walkthroughCancel: (sessionId: string) => ipcRenderer.invoke('walkthrough:cancel', sessionId),
  walkthroughGetSession: (sessionId: string) => ipcRenderer.invoke('walkthrough:get-session', sessionId),
  walkthroughGetSessionsForPR: (prId: number) => ipcRenderer.invoke('walkthrough:get-sessions-for-pr', prId),
  walkthroughRemoveSession: (sessionId: string) => ipcRenderer.invoke('walkthrough:remove-session', sessionId),

  // Walkthrough event listeners
  onWalkthroughProgress: (callback: (event: any) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: any) => callback(event);
    ipcRenderer.on('walkthrough:progress', handler);
    return () => ipcRenderer.removeListener('walkthrough:progress', handler);
  },
  onWalkthroughComplete: (callback: (event: any) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: any) => callback(event);
    ipcRenderer.on('walkthrough:complete', handler);
    return () => ipcRenderer.removeListener('walkthrough:complete', handler);
  },
  onWalkthroughError: (callback: (event: any) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: any) => callback(event);
    ipcRenderer.on('walkthrough:error', handler);
    return () => ipcRenderer.removeListener('walkthrough:error', handler);
  },

  // Extended storage API
  aiListReviews: (org: string, project: string, prId: number) =>
    ipcRenderer.invoke('ai:list-reviews', org, project, prId),
  aiLoadReviewSession: (org: string, project: string, prId: number, sessionId: string) =>
    ipcRenderer.invoke('ai:load-review-session', org, project, prId, sessionId),
  aiDeleteReviewSession: (org: string, project: string, prId: number, sessionId: string) =>
    ipcRenderer.invoke('ai:delete-review-session', org, project, prId, sessionId),
  aiListWalkthroughs: (org: string, project: string, prId: number) =>
    ipcRenderer.invoke('ai:list-walkthroughs', org, project, prId),
  aiLoadWalkthroughSession: (org: string, project: string, prId: number, sessionId: string) =>
    ipcRenderer.invoke('ai:load-walkthrough-session', org, project, prId, sessionId),
  aiDeleteWalkthroughSession: (org: string, project: string, prId: number, sessionId: string) =>
    ipcRenderer.invoke('ai:delete-walkthrough-session', org, project, prId, sessionId),
  aiGetSessionsForPR: (prId: number) => ipcRenderer.invoke('ai:get-sessions-for-pr', prId),
  aiRemoveSession: (sessionId: string) => ipcRenderer.invoke('ai:remove-session', sessionId),
```

**Step 6: Update preload.cjs with same changes**

Mirror all the changes from preload.ts to preload.cjs (the runtime file).

**Step 7: Update electron.d.ts with type definitions**

Add the new methods to the `ElectronAPI` interface.

**Step 8: Commit**

```bash
git add src/main/main.ts src/main/preload.ts src/main/preload.cjs src/renderer/electron.d.ts
git commit -m "feat: add IPC handlers for presets, walkthroughs, and multi-session support"
```

---

## Task 7: Create WalkthroughsView Component (Sidebar Section)

**Files:**
- Create: `src/renderer/components/walkthroughs-view.ts`

**Step 1: Create the component**

```typescript
/**
 * Walkthroughs View
 * Sidebar section displaying walkthrough sessions
 */

import type { WalkthroughSession, SavedWalkthroughMetadata } from '../../shared/ai-types.js';
import { escapeHtml } from '../utils/html-utils.js';

type WalkthroughItem = WalkthroughSession | SavedWalkthroughMetadata;

export class WalkthroughsView {
  private container: HTMLElement;
  private sessions: WalkthroughSession[] = [];
  private savedWalkthroughs: SavedWalkthroughMetadata[] = [];
  private activeSessionId: string | null = null;

  private selectCallback?: (sessionId: string, isSaved: boolean) => void;
  private closeCallback?: (sessionId: string, isSaved: boolean) => void;
  private newCallback?: () => void;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.render();
  }

  onSelect(callback: (sessionId: string, isSaved: boolean) => void): void {
    this.selectCallback = callback;
  }

  onClose(callback: (sessionId: string, isSaved: boolean) => void): void {
    this.closeCallback = callback;
  }

  onNew(callback: () => void): void {
    this.newCallback = callback;
  }

  setSessions(sessions: WalkthroughSession[]): void {
    this.sessions = sessions;
    this.render();
  }

  setSavedWalkthroughs(walkthroughs: SavedWalkthroughMetadata[]): void {
    this.savedWalkthroughs = walkthroughs;
    this.render();
  }

  setActiveSession(sessionId: string | null): void {
    this.activeSessionId = sessionId;
    this.render();
  }

  addSession(session: WalkthroughSession): void {
    this.sessions.push(session);
    this.render();
  }

  updateSession(sessionId: string, updates: Partial<WalkthroughSession>): void {
    const session = this.sessions.find(s => s.id === sessionId);
    if (session) {
      Object.assign(session, updates);
      this.render();
    }
  }

  removeSession(sessionId: string): void {
    this.sessions = this.sessions.filter(s => s.id !== sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
    this.render();
  }

  refresh(): void {
    this.render();
  }

  private getAllItems(): { item: WalkthroughItem; isSaved: boolean }[] {
    const items: { item: WalkthroughItem; isSaved: boolean }[] = [];

    // Add active sessions first
    for (const session of this.sessions) {
      items.push({ item: session, isSaved: false });
    }

    // Add saved walkthroughs that aren't already in sessions
    for (const saved of this.savedWalkthroughs) {
      if (!this.sessions.find(s => s.id === saved.sessionId)) {
        items.push({ item: saved, isSaved: true });
      }
    }

    return items;
  }

  private render(): void {
    const items = this.getAllItems();
    const count = items.length;

    this.container.innerHTML = `
      <div class="walkthroughs-view">
        <div class="walkthroughs-header">
          <span>Walkthroughs</span>
          <span class="walkthrough-count">${count}</span>
          <button class="btn btn-icon new-walkthrough-btn" title="Request Walkthrough">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
        <div class="walkthroughs-list">
          ${count === 0 ? `
            <div class="walkthroughs-empty">
              <p>No walkthroughs yet</p>
              <p class="hint">Click + to request a walkthrough</p>
            </div>
          ` : items.map(({ item, isSaved }) => this.renderItem(item, isSaved)).join('')}
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  private renderItem(item: WalkthroughItem, isSaved: boolean): string {
    const sessionId = 'id' in item ? item.id : item.sessionId;
    const name = 'name' in item ? item.name : item.displayName;
    const status = 'status' in item ? item.status : 'complete';
    const isActive = sessionId === this.activeSessionId;

    // Determine metadata text
    let metaText = '';
    if ('estimatedReadTime' in item && 'stepCount' in item) {
      metaText = `${item.estimatedReadTime} min · ${item.stepCount} steps`;
    } else if ('walkthrough' in item && item.walkthrough) {
      metaText = `${item.walkthrough.estimatedReadTime || 0} min · ${item.walkthrough.steps?.length || 0} steps`;
    } else if (status === 'generating' || status === 'preparing') {
      metaText = item.statusText || 'Generating...';
    }

    return `
      <div class="walkthrough-item ${isActive ? 'active' : ''} ${status} ${isSaved ? 'saved' : ''}"
           data-id="${sessionId}"
           data-saved="${isSaved}">
        <span class="walkthrough-status-dot" title="${this.getStatusText(status)}"></span>
        <div class="walkthrough-info">
          <span class="walkthrough-name">${escapeHtml(name)}</span>
          <span class="walkthrough-meta">${metaText}</span>
        </div>
        <button class="walkthrough-close-btn" data-id="${sessionId}" data-saved="${isSaved}" title="Remove">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `;
  }

  private getStatusText(status: string): string {
    switch (status) {
      case 'preparing': return 'Preparing...';
      case 'generating': return 'Generating...';
      case 'complete': return 'Complete';
      case 'error': return 'Error';
      case 'cancelled': return 'Cancelled';
      default: return 'Unknown';
    }
  }

  private attachEventListeners(): void {
    // New button
    this.container.querySelector('.new-walkthrough-btn')?.addEventListener('click', () => {
      this.newCallback?.();
    });

    // Item click
    this.container.querySelectorAll('.walkthrough-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.walkthrough-close-btn')) return;
        const id = (item as HTMLElement).dataset.id;
        const isSaved = (item as HTMLElement).dataset.saved === 'true';
        if (id) {
          this.activeSessionId = id;
          this.render();
          this.selectCallback?.(id, isSaved);
        }
      });
    });

    // Close buttons
    this.container.querySelectorAll('.walkthrough-close-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id;
        const isSaved = (btn as HTMLElement).dataset.saved === 'true';
        if (id) {
          this.closeCallback?.(id, isSaved);
        }
      });
    });
  }
}
```

**Step 2: Add CSS styles**

Add to the main CSS file or create a new one:

```css
/* Walkthroughs View Styles */
.walkthroughs-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.walkthroughs-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.walkthroughs-header span:first-child {
  font-weight: 600;
}

.walkthrough-count {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
}

.new-walkthrough-btn {
  margin-left: auto;
}

.walkthroughs-list {
  flex: 1;
  overflow-y: auto;
}

.walkthroughs-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary);
}

.walkthroughs-empty .hint {
  font-size: 12px;
  margin-top: 8px;
}

.walkthrough-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-color);
}

.walkthrough-item:hover {
  background: var(--bg-hover);
}

.walkthrough-item.active {
  background: var(--bg-selected);
}

.walkthrough-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.walkthrough-item.preparing .walkthrough-status-dot,
.walkthrough-item.generating .walkthrough-status-dot {
  background: var(--color-warning);
  animation: pulse 1.5s infinite;
}

.walkthrough-item.complete .walkthrough-status-dot {
  background: var(--color-success);
}

.walkthrough-item.error .walkthrough-status-dot {
  background: var(--color-error);
}

.walkthrough-item.saved:not(.active) .walkthrough-status-dot {
  background: var(--text-tertiary);
}

.walkthrough-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.walkthrough-name {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.walkthrough-meta {
  font-size: 11px;
  color: var(--text-secondary);
}

.walkthrough-close-btn {
  opacity: 0;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: var(--text-secondary);
}

.walkthrough-item:hover .walkthrough-close-btn {
  opacity: 1;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

**Step 3: Commit**

```bash
git add src/renderer/components/walkthroughs-view.ts
git commit -m "feat: add WalkthroughsView sidebar component"
```

---

## Task 8: Add Tab Bar to AICommentsPanel

**Files:**
- Modify: `src/renderer/components/ai-comments-panel.ts`

**Step 1: Add tab state tracking**

Add new properties to the class:

```typescript
// Tab state
private reviewTabs: Array<{
  sessionId: string;
  displayName: string;
  status: string;
  isActive: boolean;
  isSaved: boolean;
}> = [];
private activeTabId: string | null = null;

// Callbacks for tab actions
private tabSelectCallback?: (sessionId: string, isSaved: boolean) => void;
private tabCloseCallback?: (sessionId: string, isSaved: boolean) => void;
private newReviewCallback?: () => void;
```

**Step 2: Add tab management methods**

```typescript
onTabSelect(callback: (sessionId: string, isSaved: boolean) => void): void {
  this.tabSelectCallback = callback;
}

onTabClose(callback: (sessionId: string, isSaved: boolean) => void): void {
  this.tabCloseCallback = callback;
}

onNewReview(callback: () => void): void {
  this.newReviewCallback = callback;
}

setTabs(tabs: Array<{ sessionId: string; displayName: string; status: string; isSaved: boolean }>): void {
  this.reviewTabs = tabs.map(t => ({ ...t, isActive: t.sessionId === this.activeTabId }));
  this.render();
}

setActiveTab(sessionId: string | null): void {
  this.activeTabId = sessionId;
  this.reviewTabs = this.reviewTabs.map(t => ({ ...t, isActive: t.sessionId === sessionId }));
  this.render();
}

addTab(tab: { sessionId: string; displayName: string; status: string; isSaved: boolean }): void {
  this.reviewTabs.push({ ...tab, isActive: false });
  this.setActiveTab(tab.sessionId);
}

updateTab(sessionId: string, updates: Partial<{ displayName: string; status: string }>): void {
  const tab = this.reviewTabs.find(t => t.sessionId === sessionId);
  if (tab) {
    Object.assign(tab, updates);
    this.render();
  }
}

removeTab(sessionId: string): void {
  this.reviewTabs = this.reviewTabs.filter(t => t.sessionId !== sessionId);
  if (this.activeTabId === sessionId) {
    this.activeTabId = this.reviewTabs[0]?.sessionId || null;
  }
  this.render();
}
```

**Step 3: Update render method to include tab bar**

Add after the header div in render():

```typescript
<div class="ai-review-tabs">
  <div class="ai-tabs-scroll">
    ${this.reviewTabs.map(tab => `
      <div class="ai-tab ${tab.isActive ? 'active' : ''} ${tab.status}"
           data-id="${tab.sessionId}"
           data-saved="${tab.isSaved}">
        <span class="ai-tab-status"></span>
        <span class="ai-tab-name">${escapeHtml(tab.displayName)}</span>
        <button class="ai-tab-close" data-id="${tab.sessionId}" data-saved="${tab.isSaved}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `).join('')}
  </div>
  <button class="ai-tab-new" title="Start New Review">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  </button>
</div>
```

**Step 4: Add tab event listeners in attachEventListeners**

```typescript
// Tab clicks
this.container.querySelectorAll('.ai-tab').forEach(tab => {
  tab.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.ai-tab-close')) return;
    const id = (tab as HTMLElement).dataset.id;
    const isSaved = (tab as HTMLElement).dataset.saved === 'true';
    if (id) {
      this.setActiveTab(id);
      this.tabSelectCallback?.(id, isSaved);
    }
  });
});

// Tab close buttons
this.container.querySelectorAll('.ai-tab-close').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = (btn as HTMLElement).dataset.id;
    const isSaved = (btn as HTMLElement).dataset.saved === 'true';
    if (id) {
      this.tabCloseCallback?.(id, isSaved);
    }
  });
});

// New review button
this.container.querySelector('.ai-tab-new')?.addEventListener('click', () => {
  this.newReviewCallback?.();
});
```

**Step 5: Add tab CSS**

```css
.ai-review-tabs {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.ai-tabs-scroll {
  display: flex;
  flex: 1;
  overflow-x: auto;
  scrollbar-width: none;
}

.ai-tabs-scroll::-webkit-scrollbar {
  display: none;
}

.ai-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  border-right: 1px solid var(--border-color);
  white-space: nowrap;
  max-width: 180px;
}

.ai-tab:hover {
  background: var(--bg-hover);
}

.ai-tab.active {
  background: var(--bg-primary);
  border-bottom: 2px solid var(--color-primary);
}

.ai-tab-status {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.ai-tab.preparing .ai-tab-status,
.ai-tab.reviewing .ai-tab-status {
  background: var(--color-warning);
  animation: pulse 1.5s infinite;
}

.ai-tab.complete .ai-tab-status {
  background: var(--color-success);
}

.ai-tab.error .ai-tab-status {
  background: var(--color-error);
}

.ai-tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
}

.ai-tab-close {
  opacity: 0;
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  color: var(--text-secondary);
}

.ai-tab:hover .ai-tab-close {
  opacity: 1;
}

.ai-tab-new {
  padding: 8px 12px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
}

.ai-tab-new:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
```

**Step 6: Commit**

```bash
git add src/renderer/components/ai-comments-panel.ts
git commit -m "feat: add tab bar to AICommentsPanel for multiple reviews"
```

---

## Task 9: Create Review Dialog Component

**Files:**
- Create: `src/renderer/components/review-dialog.ts`

This task involves creating a modal dialog component for starting new reviews with preset selection. The dialog should include:
- Preset selection (built-in and user presets)
- Custom prompt text area
- AI provider selection
- Review depth selection
- Focus areas checkboxes
- Show terminal checkbox (for Claude Terminal)
- Preset management (save, edit, delete)

Due to length, implementation details should follow the existing dialog patterns in the codebase.

**Step: Commit**

```bash
git add src/renderer/components/review-dialog.ts
git commit -m "feat: add ReviewDialog component with preset support"
```

---

## Task 10: Create Walkthrough Dialog Component

**Files:**
- Create: `src/renderer/components/walkthrough-dialog.ts`

Similar to Task 9, create a dialog for requesting standalone walkthroughs with:
- Walkthrough preset selection
- Custom prompt text area
- AI provider selection
- Show terminal checkbox
- Preset management

**Step: Commit**

```bash
git add src/renderer/components/walkthrough-dialog.ts
git commit -m "feat: add WalkthroughDialog component with preset support"
```

---

## Task 11: Update WalkthroughUI with Header Info

**Files:**
- Modify: `src/renderer/components/walkthrough-ui.ts`

**Step 1: Add name and source to the header**

Update the render method's header section to show the walkthrough name:

```typescript
<div class="walkthrough-header">
  <div class="walkthrough-drag-handle">...</div>
  <div class="walkthrough-title-section">
    <div class="walkthrough-title">
      <svg class="robot-icon" ...>...</svg>
      <span>${escapeHtml(this.walkthrough?.displayName || 'Code Walkthrough')}</span>
    </div>
    ${this.walkthrough?.preset ? `
      <span class="walkthrough-source">From preset: ${escapeHtml(this.walkthrough.preset.name)}</span>
    ` : this.walkthrough?.customPrompt ? `
      <span class="walkthrough-source">Custom request</span>
    ` : ''}
  </div>
  <div class="walkthrough-header-actions">...</div>
</div>
```

**Step 2: Update show method to accept extended walkthrough**

```typescript
show(walkthrough: CodeWalkthrough & { displayName?: string; preset?: WalkthroughPreset; customPrompt?: string }): void {
  // ...existing code
}
```

**Step 3: Add CSS for the new elements**

```css
.walkthrough-title-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.walkthrough-source {
  font-size: 11px;
  color: var(--text-secondary);
}
```

**Step 4: Commit**

```bash
git add src/renderer/components/walkthrough-ui.ts
git commit -m "feat: add name and source info to WalkthroughUI header"
```

---

## Task 12: Wire Everything Together in app.ts

**Files:**
- Modify: `src/renderer/app.ts`

**Step 1: Import new components**

```typescript
import { WalkthroughsView } from './components/walkthroughs-view.js';
import { showReviewDialog } from './components/review-dialog.js';
import { showWalkthroughDialog } from './components/walkthrough-dialog.js';
```

**Step 2: Initialize WalkthroughsView**

Add in initialization code:

```typescript
const walkthroughsView = new WalkthroughsView('walkthroughsSection');
```

**Step 3: Wire up event handlers**

- Connect AICommentsPanel tab events to load/save review sessions
- Connect WalkthroughsView events to load/save walkthrough sessions
- Handle dialog results to start reviews/walkthroughs
- Load saved reviews and walkthroughs when opening a PR tab
- Initialize walkthrough service event listeners

**Step 4: Update PR tab initialization**

When opening a PR tab:
- Load saved review metadata and populate tabs
- Load saved walkthrough metadata and populate sidebar
- Don't auto-open any content

**Step 5: Commit**

```bash
git add src/renderer/app.ts
git commit -m "feat: wire up multiple reviews and walkthroughs in app.ts"
```

---

## Task 13: Add Sidebar Section for Walkthroughs

**Files:**
- Modify: `src/renderer/index.html` (or equivalent)
- Modify: `src/renderer/components/section-sidebar.ts`

**Step 1: Add walkthroughs section to sidebar**

Add a new collapsible section below Terminals:

```html
<div class="sidebar-section" id="walkthroughsSidebarSection">
  <div id="walkthroughsSection"></div>
</div>
```

**Step 2: Update section-sidebar.ts if needed**

Ensure the walkthroughs section is handled in the sidebar component.

**Step 3: Commit**

```bash
git add src/renderer/index.html src/renderer/components/section-sidebar.ts
git commit -m "feat: add walkthroughs section to sidebar"
```

---

## Task 14: Update review-prompt.ts for Presets and Walkthroughs

**Files:**
- Modify: `src/main/terminal/review-prompt.ts`

**Step 1: Update prompt generation to include preset/custom instructions**

Modify `buildReviewPrompt` to accept and incorporate preset and custom prompt:

```typescript
export function buildReviewPrompt(
  options: {
    depth: string;
    focusAreas: string[];
    generateWalkthrough: boolean;
    preset?: ReviewPreset;
    customPrompt?: string;
    walkthroughOnly?: boolean;
    walkthroughPrompt?: string;
  }
): string {
  let prompt = BASE_PROMPT;

  // Add preset instructions
  if (options.preset?.customPrompt) {
    prompt += `\n\nPreset Focus (${options.preset.name}):\n${options.preset.customPrompt}`;
  }

  // Add custom user instructions
  if (options.customPrompt) {
    prompt += `\n\nAdditional Instructions:\n${options.customPrompt}`;
  }

  // Handle walkthrough-only mode
  if (options.walkthroughOnly) {
    prompt = WALKTHROUGH_ONLY_PROMPT;
    if (options.walkthroughPrompt) {
      prompt += `\n\n${options.walkthroughPrompt}`;
    }
  }

  return prompt;
}
```

**Step 2: Commit**

```bash
git add src/main/terminal/review-prompt.ts
git commit -m "feat: update prompt generation for presets and custom instructions"
```

---

## Task 15: Final Integration and Testing

**Files:**
- All modified files

**Step 1: Run TypeScript compilation**

```bash
npm run build
```

**Step 2: Fix any type errors**

**Step 3: Test the application**

- Start the app
- Open a PR
- Start multiple reviews with different presets
- Start a custom review
- Verify tabs work correctly
- Start standalone walkthroughs
- Verify sidebar list updates
- Test saving and loading presets
- Test persistence across app restarts

**Step 4: Final commit**

```bash
git add .
git commit -m "feat: complete multiple reviews and walkthroughs feature"
```

---

## Summary of All New/Modified Files

### New Files:
- `src/main/ai/preset-service.ts`
- `src/main/ai/walkthrough-service.ts`
- `src/renderer/components/walkthroughs-view.ts`
- `src/renderer/components/review-dialog.ts`
- `src/renderer/components/walkthrough-dialog.ts`

### Modified Files:
- `src/shared/ai-types.ts`
- `src/main/ai/ai-storage-service.ts`
- `src/main/ai/ai-review-service.ts`
- `src/main/main.ts`
- `src/main/preload.ts`
- `src/main/preload.cjs`
- `src/main/terminal/review-prompt.ts`
- `src/renderer/electron.d.ts`
- `src/renderer/components/ai-comments-panel.ts`
- `src/renderer/components/walkthrough-ui.ts`
- `src/renderer/components/section-sidebar.ts`
- `src/renderer/app.ts`
