/**
 * AI Review Service
 * Main orchestration service for AI-powered code reviews
 * Uses unified context preparation and provider-specific executors
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { getReviewContextService } from './review-context-service.js';
import { getReviewExecutorService } from './review-executor-service.js';
import { getLogger } from '../services/logger-service.js';
import type {
  AIProviderType,
  AIReviewSession,
  AIReviewRequest,
  AIReviewComment,
  AIProgressEvent,
  AICommentEvent,
  AIWalkthroughEvent,
  AIErrorEvent,
  PRContext,
  CodeWalkthrough,
  ReviewContextInfo,
  ReviewPreset,
} from '../../shared/ai-types.js';
import type { FileChange, CommentThread } from '../../shared/types.js';
import type { ConsoleReviewSettings } from '../../shared/terminal-types.js';

const LOG_CATEGORY = 'AIReviewService';

export class AIReviewService extends EventEmitter {
  private sessions: Map<string, AIReviewSession> = new Map();
  private activeSession: string | null = null;
  private contextInfoMap: Map<string, ReviewContextInfo> = new Map();

  constructor() {
    super();
  }

  /**
   * Get available providers and their status
   */
  async getProviders(): Promise<{ provider: AIProviderType; available: boolean; error?: string }[]> {
    const logger = getLogger();
    logger.debug(LOG_CATEGORY, 'Getting available providers');
    const executorService = getReviewExecutorService();
    const providers = await executorService.getAvailableProviders();
    logger.info(LOG_CATEGORY, 'Provider availability', { providers });
    return providers;
  }

  /**
   * Start a new AI review session
   * @param prContextKey Optional - if provided, reuses the existing PR context instead of creating a new one
   */
  async startReview(
    prContext: PRContext,
    files: FileChange[],
    threads: CommentThread[],
    request: AIReviewRequest,
    settings: ConsoleReviewSettings,
    fileContents: Map<string, { original: string | null; modified: string | null }>,
    prContextKey?: string
  ): Promise<string> {
    const logger = getLogger();
    logger.info(LOG_CATEGORY, 'Starting review', {
      prId: prContext.prId,
      provider: request.provider,
      depth: request.depth,
      focusAreas: request.focusAreas,
      fileCount: files.length,
      threadCount: threads.length,
    });

    // Note: Multiple concurrent sessions are now allowed
    // Previously this would cancel the existing session

    const executorService = getReviewExecutorService();
    const executor = executorService.getExecutor(request.provider);

    logger.debug(LOG_CATEGORY, 'Checking provider availability', { provider: request.provider });
    const availability = await executor.isAvailable();
    if (!availability.available) {
      logger.error(LOG_CATEGORY, 'Provider not available', { provider: request.provider, error: availability.error });
      throw new Error(`Provider ${request.provider} is not available: ${availability.error}`);
    }

    const sessionId = uuidv4();
    logger.info(LOG_CATEGORY, 'Created new session', { sessionId, prId: prContext.prId, provider: request.provider });

    const session: AIReviewSession = {
      sessionId,
      prId: prContext.prId,
      provider: request.provider,
      showTerminal: request.showTerminal,
      status: 'preparing',
      statusText: 'Preparing context...',
      comments: [],
      // New fields for multiple session support
      displayName: request.displayName || this.generateDisplayName(request),
      preset: request.preset,
      customPrompt: request.customPrompt,
      createdAt: new Date().toISOString(),
    };

    this.sessions.set(sessionId, session);
    this.activeSession = sessionId;
    this.emitProgress(session);

    // Run review in background
    this.runReview(session, prContext, files, threads, request, settings, fileContents, prContextKey).catch((error) => {
      logger.error(LOG_CATEGORY, 'Review failed in background', { sessionId, error: error.message, stack: error.stack });
      this.handleError(sessionId, error);
    });

    return sessionId;
  }

  /**
   * Run the review process using context service and executor service
   * @param prContextKey Optional - if provided, reuses the existing PR context instead of creating a new one
   */
  private async runReview(
    session: AIReviewSession,
    prContext: PRContext,
    files: FileChange[],
    threads: CommentThread[],
    request: AIReviewRequest,
    settings: ConsoleReviewSettings,
    fileContents: Map<string, { original: string | null; modified: string | null }>,
    prContextKey?: string
  ): Promise<void> {
    const logger = getLogger();
    logger.info(LOG_CATEGORY, 'Running review', { sessionId: session.sessionId, provider: request.provider, prContextKey });

    try {
      const contextService = getReviewContextService();
      const executorService = getReviewExecutorService();

      let contextInfo;

      // Try to use existing PR context if prContextKey is provided
      if (prContextKey) {
        logger.info(LOG_CATEGORY, 'Attempting to reuse existing PR context', { sessionId: session.sessionId, prContextKey });
        contextInfo = contextService.loadContextFromPRContextKey(
          prContextKey,
          { linkedRepositories: settings.linkedRepositories, whenRepoFound: settings.whenRepoFound }
        );

        if (contextInfo) {
          logger.info(LOG_CATEGORY, 'Reusing existing PR context', {
            sessionId: session.sessionId,
            prContextKey,
            contextPath: contextInfo.contextPath,
          });
        }
      }

      // Fall back to creating new context if prContextKey not provided or context not found
      if (!contextInfo) {
        logger.info(LOG_CATEGORY, 'Preparing new context', { sessionId: session.sessionId });
        contextInfo = await contextService.prepareContext(
          prContext,
          files,
          threads,
          { linkedRepositories: settings.linkedRepositories, whenRepoFound: settings.whenRepoFound },
          fileContents
        );
      }

      logger.info(LOG_CATEGORY, 'Context ready', {
        sessionId: session.sessionId,
        contextPath: contextInfo.contextPath,
        workingDir: contextInfo.workingDir,
        hasRepoContext: contextInfo.hasRepoContext,
        reusedExisting: !!prContextKey,
      });

      this.contextInfoMap.set(session.sessionId, contextInfo);
      session.contextPath = contextInfo.contextPath;

      // Update status
      session.status = 'reviewing';
      session.statusText = 'Running AI review...';
      this.emitProgress(session);

      // Execute review
      logger.info(LOG_CATEGORY, 'Executing review with provider', { sessionId: session.sessionId, provider: request.provider, showTerminal: request.showTerminal });
      const executor = executorService.getExecutor(request.provider, { showTerminal: request.showTerminal });
      const result = await executor.execute(contextInfo, {
        depth: request.depth,
        focusAreas: request.focusAreas,
        generateWalkthrough: request.generateWalkthrough,
        generatedFilePatterns: request.generatedFilePatterns,
        enableWorkIQ: request.enableWorkIQ,
        onStatusChange: (status) => {
          logger.debug(LOG_CATEGORY, 'Status change', { sessionId: session.sessionId, status });
          session.statusText = status;
          this.emitProgress(session);
        },
      });

      logger.info(LOG_CATEGORY, 'Executor completed', {
        sessionId: session.sessionId,
        hasError: !!result.error,
        commentCount: result.comments.length,
        hasWalkthrough: !!result.walkthrough,
      });

      // Handle result
      if (result.error) {
        logger.error(LOG_CATEGORY, 'Executor returned error', { sessionId: session.sessionId, error: result.error });
        throw new Error(result.error);
      }

      // Add comments to session and emit
      for (const comment of result.comments) {
        session.comments.push(comment);
        this.emitComment(session.sessionId, comment);
      }
      logger.info(LOG_CATEGORY, 'Comments processed', { sessionId: session.sessionId, count: result.comments.length });

      // Add walkthrough if present
      if (result.walkthrough) {
        result.walkthrough.prId = prContext.prId;
        session.walkthrough = result.walkthrough;
        this.emitWalkthrough(session.sessionId, result.walkthrough);
        logger.info(LOG_CATEGORY, 'Walkthrough processed', { sessionId: session.sessionId, steps: result.walkthrough.totalSteps });
      }

      // Mark complete
      session.status = 'complete';
      session.statusText = undefined;
      this.emitProgress(session);
      logger.info(LOG_CATEGORY, 'Review complete', { sessionId: session.sessionId, commentCount: session.comments.length });
    } catch (error: any) {
      this.handleError(session.sessionId, error);
    }
  }

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

  /**
   * Cancel a review session
   */
  cancelSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'cancelled';
      session.statusText = undefined;

      const executorService = getReviewExecutorService();
      const executor = executorService.getExecutor(session.provider, { showTerminal: session.showTerminal });
      executor.cancel();

      if (this.activeSession === sessionId) {
        this.activeSession = null;
      }

      this.emitProgress(session);
    }
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): AIReviewSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get context info for a session
   */
  getContextInfo(sessionId: string): ReviewContextInfo | undefined {
    return this.contextInfoMap.get(sessionId);
  }

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

  /**
   * Get all comments from a session
   */
  getComments(sessionId: string): AIReviewComment[] {
    const session = this.sessions.get(sessionId);
    return session?.comments || [];
  }

  /**
   * Mark a comment as published (after posting to ADO)
   */
  markCommentPublished(sessionId: string, commentId: string, adoThreadId: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const comment = session.comments.find((c) => c.id === commentId);
      if (comment) {
        comment.published = true;
        comment.adoThreadId = adoThreadId;
      }
    }
  }

  /**
   * Remove a comment from the session
   */
  dismissComment(sessionId: string, commentId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.comments = session.comments.filter((c) => c.id !== commentId);
    }
  }

  /**
   * Get the walkthrough from a session
   */
  getWalkthrough(sessionId: string): CodeWalkthrough | undefined {
    return this.sessions.get(sessionId)?.walkthrough;
  }

  /**
   * Get terminal session ID for terminal providers (claude-terminal, copilot-terminal)
   */
  getTerminalSessionId(sessionId: string): string | null {
    const session = this.sessions.get(sessionId);
    if (session?.provider === 'claude-terminal' || session?.provider === 'copilot-terminal') {
      const executorService = getReviewExecutorService();
      return executorService.getTerminalSessionId(session.provider);
    }
    return null;
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    // Clean up context folders for all sessions
    const contextService = getReviewContextService();
    for (const [sessionId, contextInfo] of this.contextInfoMap) {
      contextService.cleanupContext(contextInfo.contextPath);
      if (contextInfo.worktreeCreated && contextInfo.mainRepoPath && contextInfo.repoPath) {
        contextService.cleanupWorktree(contextInfo.mainRepoPath, contextInfo.repoPath);
      }
    }

    this.sessions.clear();
    this.contextInfoMap.clear();
    this.activeSession = null;
  }

  // Event emitters
  private emitProgress(session: AIReviewSession): void {
    const event: AIProgressEvent = {
      sessionId: session.sessionId,
      status: session.status as AIProgressEvent['status'],
      statusText: session.statusText,
    };
    this.emit('progress', event);
  }

  private emitComment(sessionId: string, comment: AIReviewComment): void {
    const event: AICommentEvent = { sessionId, comment };
    this.emit('comment', event);
  }

  private emitWalkthrough(sessionId: string, walkthrough: CodeWalkthrough): void {
    const event: AIWalkthroughEvent = { sessionId, walkthrough };
    this.emit('walkthrough', event);
  }

  private handleError(sessionId: string, error: Error): void {
    const logger = getLogger();
    logger.error(LOG_CATEGORY, 'Handling error', { sessionId, error: error.message, stack: error.stack });

    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'error';
      session.error = error.message;
      session.statusText = undefined;
    }

    const event: AIErrorEvent = { sessionId, error: error.message };
    this.emit('error', event);
  }

  // Callback registration helpers
  onProgress(callback: (event: AIProgressEvent) => void): void {
    this.on('progress', callback);
  }

  onComment(callback: (event: AICommentEvent) => void): void {
    this.on('comment', callback);
  }

  onWalkthrough(callback: (event: AIWalkthroughEvent) => void): void {
    this.on('walkthrough', callback);
  }

  onError(callback: (event: AIErrorEvent) => void): void {
    this.on('error', callback);
  }
}

// Singleton instance
let aiReviewServiceInstance: AIReviewService | null = null;

export function getAIReviewService(): AIReviewService {
  if (!aiReviewServiceInstance) {
    aiReviewServiceInstance = new AIReviewService();
  }
  return aiReviewServiceInstance;
}

export async function disposeAIReviewService(): Promise<void> {
  if (aiReviewServiceInstance) {
    await aiReviewServiceInstance.dispose();
    aiReviewServiceInstance = null;
  }
}
