/**
 * GitHub Copilot SDK Executor
 * Executes reviews using GitHub Copilot SDK
 */

import { CopilotClient } from '@github/copilot-sdk';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { BaseReviewExecutor } from './base-executor.js';
import { buildReviewPrompt } from '../../terminal/review-prompt.js';
import { getLogger } from '../../services/logger-service.js';
import type {
  ReviewContextInfo,
  ReviewExecutorOptions,
  ReviewExecutorResult,
  AIReviewComment,
  CodeWalkthrough,
} from '../../../shared/ai-types.js';

const LOG_CATEGORY = 'CopilotSDK';

// Singleton client instance
let clientInstance: CopilotClient | null = null;

async function getClient(): Promise<CopilotClient> {
  const logger = getLogger();
  if (!clientInstance) {
    logger.info(LOG_CATEGORY, 'Creating new CopilotClient instance');
    clientInstance = new CopilotClient();
    await clientInstance.start();
    logger.info(LOG_CATEGORY, 'CopilotClient started');
  }
  return clientInstance;
}

export async function stopCopilotClient(): Promise<void> {
  if (clientInstance) {
    await clientInstance.stop();
    clientInstance = null;
  }
}

export class CopilotSDKExecutor extends BaseReviewExecutor {
  private model: 'gpt-4o' | 'gpt-4' | 'gpt-5' | 'claude-3.5-sonnet' = 'gpt-4o';
  private session: any = null;

  async isAvailable(): Promise<{ available: boolean; error?: string }> {
    const logger = getLogger();
    logger.debug(LOG_CATEGORY, 'Checking Copilot availability...');

    try {
      const client = await getClient();

      // Create a test session to verify auth
      const session = await client.createSession({
        model: this.model,
        streaming: false,
      });

      // Test with minimal prompt
      const result = await new Promise<string>((resolve, reject) => {
        let response = '';
        const timeout = setTimeout(() => {
          reject(new Error('Timeout checking Copilot availability'));
        }, 10000);

        session.on((event: any) => {
          if (event.type === 'assistant.message') {
            response = event.data.content;
          } else if (event.type === 'session.idle') {
            clearTimeout(timeout);
            resolve(response);
          } else if (event.type === 'session.error') {
            clearTimeout(timeout);
            reject(new Error(event.data.message));
          }
        });

        session.send({ prompt: 'Say "ok"' }).catch(reject);
      });

      await session.destroy();
      logger.info(LOG_CATEGORY, 'Copilot is available');
      return { available: true };
    } catch (error: any) {
      logger.error(LOG_CATEGORY, 'Copilot availability check failed', { error: error.message, stack: error.stack });
      return {
        available: false,
        error: error.message || 'Failed to connect to GitHub Copilot',
      };
    }
  }

  async execute(
    context: ReviewContextInfo,
    options: ReviewExecutorOptions
  ): Promise<ReviewExecutorResult> {
    const logger = getLogger();
    const abortController = this.createAbortController();

    logger.info(LOG_CATEGORY, 'Starting Copilot review execution', {
      contextPath: context.contextPath,
      workingDir: context.workingDir,
      hasRepoContext: context.hasRepoContext,
      depth: options.depth,
      focusAreas: options.focusAreas,
      generateWalkthrough: options.generateWalkthrough,
    });

    try {
      // 1. Get client
      const client = await getClient();

      // 2. Build prompt using buildReviewPrompt() with context info
      let prompt = buildReviewPrompt({
        guid: context.guid,
        contextPath: context.contextPath,
        outputPath: context.outputPath,
        hasRepoContext: context.hasRepoContext,
        repoPath: context.repoPath,
        generatedFilePatterns: options.generatedFilePatterns,
        enableWorkIQ: options.enableWorkIQ,
      });

      // Add depth and focus area instructions
      const depthInstruction = {
        quick: '\n\n## Review Depth: Quick\nFocus only on critical bugs and security issues. Be concise.',
        standard: '\n\n## Review Depth: Standard\nReview for bugs, security, performance, and style issues.',
        thorough: '\n\n## Review Depth: Thorough\nPerform an in-depth review covering all aspects including edge cases, documentation, and best practices.',
      }[options.depth];
      prompt += depthInstruction;

      if (options.focusAreas.length > 0) {
        prompt += `\n\n## Focus Areas\nPay special attention to: ${options.focusAreas.join(', ')}`;
      }

      // Add walkthrough instruction if not needed
      if (!options.generateWalkthrough) {
        prompt += '\n\n## Walkthrough\nSkip generating the walkthrough.json file - focus only on review.json.';
      }

      logger.debug(LOG_CATEGORY, 'Built review prompt', { promptLength: prompt.length });

      // 3. Create session with streaming: true
      options.onStatusChange?.('Running AI review...');

      logger.info(LOG_CATEGORY, 'Creating Copilot session', { model: this.model, streaming: true });
      this.session = await client.createSession({
        model: this.model,
        streaming: true,
      });

      // 4. Wait for session.idle event
      let eventCount = 0;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          logger.error(LOG_CATEGORY, 'Session timeout', { eventCount });
          reject(new Error('Review timeout - session did not complete in time'));
        }, 600000); // 10 minute timeout for long reviews

        this.session.on((event: any) => {
          eventCount++;

          // Log all events
          logger.debug(LOG_CATEGORY, 'Received session event', {
            eventNumber: eventCount,
            type: event.type,
            hasData: !!event.data,
          });

          // Check if aborted
          if (abortController.signal.aborted) {
            logger.warn(LOG_CATEGORY, 'Session aborted by user');
            clearTimeout(timeout);
            reject(new Error('Review cancelled'));
            return;
          }

          switch (event.type) {
            case 'assistant.message':
              // Full message received (non-streaming)
              logger.debug(LOG_CATEGORY, 'Received full message', { contentLength: event.data?.content?.length });
              break;
            case 'assistant.message_delta':
              // Streaming delta received
              break;
            case 'session.idle':
              logger.info(LOG_CATEGORY, 'Session completed (idle)', { eventCount });
              clearTimeout(timeout);
              resolve();
              break;
            case 'session.error':
              logger.error(LOG_CATEGORY, 'Session error event', { message: event.data?.message, event: JSON.stringify(event) });
              clearTimeout(timeout);
              reject(new Error(event.data.message || 'Session error'));
              break;
          }
        });

        logger.info(LOG_CATEGORY, 'Sending prompt to session');
        this.session.send({ prompt }).catch((err: Error) => {
          logger.error(LOG_CATEGORY, 'Failed to send prompt', { error: err.message });
          clearTimeout(timeout);
          reject(err);
        });
      });

      // Check abort after completion
      if (abortController.signal.aborted) {
        logger.warn(LOG_CATEGORY, 'Review aborted after completion');
        return { comments: [], error: 'Review cancelled' };
      }

      // 5. Destroy session
      if (this.session) {
        logger.debug(LOG_CATEGORY, 'Destroying session');
        await this.session.destroy();
        this.session = null;
      }

      // 6. Read and return results from output files
      options.onStatusChange?.('Reading results...');
      return this.readResults(context);
    } catch (error: any) {
      logger.error(LOG_CATEGORY, 'Copilot review execution failed', {
        error: error.message,
        stack: error.stack,
        aborted: abortController.signal.aborted,
      });

      // Clean up session on error
      if (this.session) {
        await this.session.destroy().catch((e: Error) => {
          logger.error(LOG_CATEGORY, 'Failed to destroy session on error', { error: e.message });
        });
        this.session = null;
      }

      if (abortController.signal.aborted) {
        return { comments: [], error: 'Review cancelled' };
      }
      return { comments: [], error: error.message || 'Review failed' };
    }
  }

  cancel(): void {
    const logger = getLogger();
    logger.info(LOG_CATEGORY, 'Cancelling Copilot review');
    super.cancel();
    if (this.session) {
      this.session.destroy().catch((e: Error) => {
        logger.error(LOG_CATEGORY, 'Failed to destroy session on cancel', { error: e.message });
      });
      this.session = null;
    }
  }

  private readResults(context: ReviewContextInfo): ReviewExecutorResult {
    const logger = getLogger();
    const outputDir = context.outputPath;
    const reviewPath = path.join(outputDir, 'review.json');
    const walkthroughPath = path.join(outputDir, 'walkthrough.json');

    logger.info(LOG_CATEGORY, 'Reading results', { outputDir, reviewPath, walkthroughPath });

    let comments: AIReviewComment[] = [];
    let walkthrough: CodeWalkthrough | undefined;

    // Check what files exist in output dir
    if (fs.existsSync(outputDir)) {
      const outputFiles = fs.readdirSync(outputDir);
      logger.debug(LOG_CATEGORY, 'Output directory contents', { files: outputFiles });
    } else {
      logger.warn(LOG_CATEGORY, 'Output directory does not exist', { outputDir });
    }

    // Read review.json
    if (fs.existsSync(reviewPath)) {
      try {
        const rawContent = fs.readFileSync(reviewPath, 'utf-8');
        logger.debug(LOG_CATEGORY, 'Raw review.json content', { size: rawContent.length, preview: rawContent.substring(0, 500) });

        const reviewData = JSON.parse(rawContent);
        comments = (reviewData.comments || []).map((c: any) => ({
          id: c.id || uuidv4(),
          filePath: c.filePath || '',
          startLine: c.startLine || 1,
          endLine: c.endLine || c.startLine || 1,
          severity: c.severity || 'suggestion',
          category: c.category || 'other',
          title: c.title || 'Review Comment',
          content: c.content || '',
          suggestedFix: c.suggestedFix,
          confidence: typeof c.confidence === 'number' ? c.confidence : 0.7,
          published: false,
        }));
        logger.info(LOG_CATEGORY, 'Parsed review.json', { commentCount: comments.length });
      } catch (error: any) {
        logger.error(LOG_CATEGORY, 'Failed to parse review.json', { error: error.message, path: reviewPath });
      }
    } else {
      logger.warn(LOG_CATEGORY, 'review.json not found', { path: reviewPath });
    }

    // Read walkthrough.json
    if (fs.existsSync(walkthroughPath)) {
      try {
        const rawContent = fs.readFileSync(walkthroughPath, 'utf-8');
        logger.debug(LOG_CATEGORY, 'Raw walkthrough.json content', { size: rawContent.length, preview: rawContent.substring(0, 500) });

        const walkthroughData = JSON.parse(rawContent);
        walkthrough = {
          id: uuidv4(),
          prId: 0, // Will be set by caller if needed
          summary: walkthroughData.summary || 'Code changes walkthrough',
          architectureDiagram: walkthroughData.architectureDiagram,
          steps: (walkthroughData.steps || []).map((s: any, i: number) => ({
            stepNumber: s.order || s.stepNumber || i + 1,
            title: s.title || `Step ${i + 1}`,
            description: s.description || '',
            filePath: s.filePath || '',
            startLine: s.startLine || 1,
            endLine: s.endLine || s.startLine || 1,
            relatedFiles: s.relatedFiles || [],
            diagram: s.diagram,
          })),
          totalSteps: walkthroughData.steps?.length || 0,
          estimatedReadTime: walkthroughData.estimatedReadTime || 5,
        };
        logger.info(LOG_CATEGORY, 'Parsed walkthrough.json', { stepCount: walkthrough.totalSteps });
      } catch (error: any) {
        logger.error(LOG_CATEGORY, 'Failed to parse walkthrough.json', { error: error.message, path: walkthroughPath });
      }
    } else {
      logger.debug(LOG_CATEGORY, 'walkthrough.json not found (may be intentional)', { path: walkthroughPath });
    }

    logger.info(LOG_CATEGORY, 'Results read complete', { commentCount: comments.length, hasWalkthrough: !!walkthrough });
    return { comments, walkthrough };
  }
}
