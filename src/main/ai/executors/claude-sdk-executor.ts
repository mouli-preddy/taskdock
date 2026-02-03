/**
 * Claude SDK Executor
 * Executes reviews using Claude Agent SDK
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
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

const LOG_CATEGORY = 'ClaudeSDK';

export class ClaudeSDKExecutor extends BaseReviewExecutor {
  private model: 'sonnet' | 'opus' | 'haiku' = 'sonnet';

  async isAvailable(): Promise<{ available: boolean; error?: string }> {
    const logger = getLogger();
    logger.debug(LOG_CATEGORY, 'Checking SDK availability...');

    try {
      // Try a minimal query to check authentication
      const response = query({
        prompt: 'Say "ok"',
        options: {
          model: 'haiku',
          maxTurns: 1,
        },
      });

      // Consume the response to check for errors
      for await (const message of response) {
        if (message.type === 'result' && message.is_error) {
          const errorMsg = (message as any).error || 'Authentication failed';
          logger.error(LOG_CATEGORY, 'SDK not available', { error: errorMsg });
          return { available: false, error: errorMsg };
        }
      }

      logger.info(LOG_CATEGORY, 'SDK is available');
      return { available: true };
    } catch (error: any) {
      logger.error(LOG_CATEGORY, 'SDK availability check failed', { error: error.message, stack: error.stack });
      return {
        available: false,
        error: error.message || 'Failed to connect to Claude SDK',
      };
    }
  }

  async execute(
    context: ReviewContextInfo,
    options: ReviewExecutorOptions
  ): Promise<ReviewExecutorResult> {
    const logger = getLogger();
    const abortController = this.createAbortController();

    logger.info(LOG_CATEGORY, 'Starting review execution', {
      contextPath: context.contextPath,
      workingDir: context.workingDir,
      hasRepoContext: context.hasRepoContext,
      depth: options.depth,
      focusAreas: options.focusAreas,
      generateWalkthrough: options.generateWalkthrough,
    });

    try {
      // Read context files and pass inline to avoid parallel tool calls
      // (Claude Code's parallel Read calls trigger API concurrency errors)
      const prJsonPath = path.join(context.contextPath, 'context', 'pr.json');
      const commentsJsonPath = path.join(context.contextPath, 'context', 'comments.json');
      const filesJsonPath = path.join(context.contextPath, 'context', 'files.json');

      const inlineContext = {
        prJson: fs.existsSync(prJsonPath) ? fs.readFileSync(prJsonPath, 'utf-8') : undefined,
        commentsJson: fs.existsSync(commentsJsonPath) ? fs.readFileSync(commentsJsonPath, 'utf-8') : undefined,
        filesJson: fs.existsSync(filesJsonPath) ? fs.readFileSync(filesJsonPath, 'utf-8') : undefined,
      };

      logger.debug(LOG_CATEGORY, 'Read context files for inline passing', {
        hasPrJson: !!inlineContext.prJson,
        hasCommentsJson: !!inlineContext.commentsJson,
        hasFilesJson: !!inlineContext.filesJson,
      });

      // 1. Build prompt - use customPrompt if provided, otherwise build review prompt
      let prompt: string;
      const isCustomPrompt = !!options.customPrompt;

      if (options.customPrompt) {
        prompt = options.customPrompt;
        logger.debug(LOG_CATEGORY, 'Using custom prompt', { promptLength: prompt.length });
      } else {
        prompt = buildReviewPrompt({
          guid: context.guid,
          contextPath: context.contextPath,
          outputPath: context.outputPath,
          hasRepoContext: context.hasRepoContext,
          repoPath: context.repoPath,
          inlineContext,
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
      }

      // 4. Call options.onStatusChange
      options.onStatusChange?.('Running AI review...');

      // 5. Execute query() with the prompt
      // Use bypassPermissions to allow reading context files from AppData directory
      // This is safe because we control what context is available to the review
      logger.info(LOG_CATEGORY, 'Calling Claude SDK query()', {
        model: this.model,
        maxTurns: 50,
        cwd: context.workingDir,
        permissionMode: 'bypassPermissions',
      });

      const response = query({
        prompt,
        options: {
          model: this.model,
          maxTurns: 50,
          cwd: context.workingDir,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
        },
      });

      // 6. Consume response, check for abort
      let messageCount = 0;
      for await (const message of response) {
        messageCount++;

        // Log all message types for debugging
        logger.debug(LOG_CATEGORY, 'Received SDK message', {
          messageNumber: messageCount,
          type: message.type,
          isError: (message as any).is_error,
        });

        // Check if aborted
        if (abortController.signal.aborted) {
          logger.warn(LOG_CATEGORY, 'Review aborted by user');
          return { comments: [], error: 'Review cancelled' };
        }

        // Check for SDK errors
        if (message.type === 'result' && message.is_error) {
          const errorMsg = (message as any).error || 'SDK execution failed';
          logger.error(LOG_CATEGORY, 'SDK returned error result', {
            error: errorMsg,
            messageNumber: messageCount,
            fullMessage: JSON.stringify(message),
          });
          return { comments: [], error: errorMsg };
        }

        // Log result completion
        if (message.type === 'result') {
          logger.info(LOG_CATEGORY, 'SDK execution completed', {
            messageCount,
            duration: message.duration_ms,
            isError: message.is_error,
          });
        }
      }

      // Check abort one more time after completion
      if (abortController.signal.aborted) {
        logger.warn(LOG_CATEGORY, 'Review aborted after completion');
        return { comments: [], error: 'Review cancelled' };
      }

      logger.info(LOG_CATEGORY, 'SDK query completed', { totalMessages: messageCount });

      // 7. Call options.onStatusChange
      options.onStatusChange?.('Reading results...');

      // 8. Read and return results
      return this.readResults(context, options.customOutputFile);
    } catch (error: any) {
      logger.error(LOG_CATEGORY, 'Review execution failed', {
        error: error.message,
        stack: error.stack,
        aborted: abortController.signal.aborted,
      });

      if (abortController.signal.aborted) {
        return { comments: [], error: 'Review cancelled' };
      }
      return { comments: [], error: error.message || 'Review failed' };
    }
  }

  private readResults(context: ReviewContextInfo, customOutputFile?: string): ReviewExecutorResult {
    const logger = getLogger();
    const outputDir = context.outputPath;

    // Check what files exist in output dir
    if (fs.existsSync(outputDir)) {
      const outputFiles = fs.readdirSync(outputDir);
      logger.debug(LOG_CATEGORY, 'Output directory contents', { files: outputFiles });
    } else {
      logger.warn(LOG_CATEGORY, 'Output directory does not exist', { outputDir });
    }

    // If customOutputFile specified, read raw output and return
    if (customOutputFile) {
      const customPath = path.join(outputDir, customOutputFile);
      logger.info(LOG_CATEGORY, 'Reading custom output file', { customPath });

      if (fs.existsSync(customPath)) {
        try {
          const rawOutput = fs.readFileSync(customPath, 'utf-8');
          logger.info(LOG_CATEGORY, 'Read custom output', { size: rawOutput.length });
          return { comments: [], rawOutput };
        } catch (error: any) {
          logger.error(LOG_CATEGORY, 'Failed to read custom output file', { error: error.message });
          return { comments: [], error: `Failed to read output: ${error.message}` };
        }
      } else {
        logger.warn(LOG_CATEGORY, 'Custom output file not found', { customPath });
        return { comments: [], error: 'Output file not found' };
      }
    }

    // Standard review results
    const reviewPath = path.join(outputDir, 'review.json');
    const walkthroughPath = path.join(outputDir, 'walkthrough.json');

    logger.info(LOG_CATEGORY, 'Reading results', { outputDir, reviewPath, walkthroughPath });

    let comments: AIReviewComment[] = [];
    let walkthrough: CodeWalkthrough | undefined;

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
