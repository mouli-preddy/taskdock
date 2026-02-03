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
   * @param prContextKey Optional - if provided, reuses the existing PR context instead of creating a new one
   */
  async startWalkthrough(
    prContext: PRContext,
    files: FileChange[],
    threads: CommentThread[],
    request: WalkthroughRequest,
    settings: ConsoleReviewSettings,
    fileContents: Map<string, { original: string | null; modified: string | null }>,
    prContextKey?: string
  ): Promise<string> {
    const logger = getLogger();
    logger.info(LOG_CATEGORY, 'Starting walkthrough', {
      prId: prContext.prId,
      provider: request.provider,
      displayName: request.displayName,
      prContextKey,
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
    this.runWalkthrough(session, prContext, files, threads, request, settings, fileContents, prContextKey).catch((error) => {
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
    fileContents: Map<string, { original: string | null; modified: string | null }>,
    prContextKey?: string
  ): Promise<void> {
    const logger = getLogger();

    try {
      const contextService = getReviewContextService();
      const executorService = getReviewExecutorService();

      let contextInfo;

      // Try to use existing PR context if prContextKey is provided
      if (prContextKey) {
        logger.info(LOG_CATEGORY, 'Attempting to reuse existing PR context', { sessionId: session.id, prContextKey });
        contextInfo = contextService.loadContextFromPRContextKey(
          prContextKey,
          { linkedRepositories: settings.linkedRepositories, whenRepoFound: settings.whenRepoFound }
        );

        if (contextInfo) {
          logger.info(LOG_CATEGORY, 'Reusing existing PR context', {
            sessionId: session.id,
            prContextKey,
            contextPath: contextInfo.contextPath,
          });
        }
      }

      // Fall back to creating new context if prContextKey not provided or context not found
      if (!contextInfo) {
        logger.info(LOG_CATEGORY, 'Preparing new context', { sessionId: session.id });
        contextInfo = await contextService.prepareContext(
          prContext,
          files,
          threads,
          { linkedRepositories: settings.linkedRepositories, whenRepoFound: settings.whenRepoFound },
          fileContents
        );
      }

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
        walkthroughOnly: true,
        walkthroughPrompt: this.buildWalkthroughPrompt(request),
        generatedFilePatterns: request.generatedFilePatterns,
        enableWorkIQ: request.enableWorkIQ,
        onStatusChange: (status: string) => {
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
    const logger = getLogger();
    logger.error(LOG_CATEGORY, 'Handling error', { sessionId, error: error.message });

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
      if (contextInfo.worktreeCreated && contextInfo.mainRepoPath && contextInfo.repoPath) {
        contextService.cleanupWorktree(contextInfo.mainRepoPath, contextInfo.repoPath);
      }
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
