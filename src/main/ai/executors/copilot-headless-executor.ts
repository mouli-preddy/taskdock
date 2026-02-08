/**
 * Copilot Headless Executor
 * Executes reviews by spawning GitHub Copilot CLI in background (no terminal UI)
 */

import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { BaseReviewExecutor, checkCliAvailability } from './base-executor.js';
import { buildReviewPrompt } from '../../terminal/review-prompt.js';
import { getLogger } from '../../services/logger-service.js';
import type {
  ReviewContextInfo,
  ReviewExecutorOptions,
  ReviewExecutorResult,
  AIReviewComment,
  CodeWalkthrough,
} from '../../../shared/ai-types.js';

const LOG_CATEGORY = 'CopilotHeadless';

// Timeout for headless review (30 minutes)
const HEADLESS_TIMEOUT_MS = 30 * 60 * 1000;
// Poll interval for completion file (1 second)
const POLL_INTERVAL_MS = 1000;

export class CopilotHeadlessExecutor extends BaseReviewExecutor {
  private childProcess: ChildProcess | null = null;

  async isAvailable(): Promise<{ available: boolean; error?: string }> {
    const logger = getLogger();
    logger.debug(LOG_CATEGORY, 'Checking Copilot CLI availability');
    const result = await checkCliAvailability('copilot');
    if (result.available) {
      logger.info(LOG_CATEGORY, 'Copilot CLI is available');
    } else {
      logger.warn(LOG_CATEGORY, 'Copilot CLI not available', { error: result.error });
    }
    return result;
  }

  async execute(
    context: ReviewContextInfo,
    options: ReviewExecutorOptions
  ): Promise<ReviewExecutorResult> {
    const logger = getLogger();
    const abortController = this.createAbortController();

    logger.info(LOG_CATEGORY, 'Starting Copilot headless review execution', {
      contextPath: context.contextPath,
      workingDir: context.workingDir,
      hasRepoContext: context.hasRepoContext,
      guid: context.guid,
      depth: options.depth,
      focusAreas: options.focusAreas,
      generateWalkthrough: options.generateWalkthrough,
    });

    try {
      // 1. Build prompt - use customPrompt if provided, otherwise build review prompt
      let prompt: string;

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

        if (!options.generateWalkthrough) {
          prompt += '\n\n## Walkthrough\nSkip generating the walkthrough.json file - focus only on review.json.';
        }

        logger.debug(LOG_CATEGORY, 'Built review prompt', { promptLength: prompt.length });
      }

      // 2. Write prompt to file (safer than command-line argument)
      const promptFilePath = path.join(context.outputPath, 'prompt.txt');
      fs.writeFileSync(promptFilePath, prompt, 'utf-8');
      logger.info(LOG_CATEGORY, 'Wrote prompt to file', { promptFilePath });

      // 3. Update status
      options.onStatusChange?.('Running Copilot AI review...');

      // 4. Spawn Copilot CLI in background
      logger.info(LOG_CATEGORY, 'Spawning Copilot CLI', {
        workingDir: context.workingDir,
        promptFile: promptFilePath,
      });

      await this.runCopilot(promptFilePath, context.workingDir, abortController.signal);

      // Check if aborted
      if (abortController.signal.aborted) {
        logger.warn(LOG_CATEGORY, 'Review aborted by user');
        return { comments: [], error: 'Review cancelled' };
      }

      // 5. Wait for completion file
      const doneFilePath = path.join(context.outputPath, `${context.guid}.done.json`);
      logger.info(LOG_CATEGORY, 'Waiting for completion file', { doneFilePath });

      await this.waitForCompletion(doneFilePath, abortController.signal, options.onStatusChange);

      // Check if aborted
      if (abortController.signal.aborted) {
        logger.warn(LOG_CATEGORY, 'Review aborted by user');
        return { comments: [], error: 'Review cancelled' };
      }

      logger.info(LOG_CATEGORY, 'Completion file detected');

      // 6. Update status
      options.onStatusChange?.('Reading results...');

      // 7. Read and return results
      return this.readResults(context, options.customOutputFile);
    } catch (error: any) {
      logger.error(LOG_CATEGORY, 'Copilot headless review execution failed', {
        error: error.message,
        stack: error.stack,
        aborted: abortController.signal.aborted,
      });

      if (abortController.signal.aborted) {
        return { comments: [], error: 'Review cancelled' };
      }
      return { comments: [], error: error.message || 'Copilot headless review failed' };
    }
  }

  private runCopilot(
    promptFilePath: string,
    workingDir: string,
    signal: AbortSignal
  ): Promise<void> {
    const logger = getLogger();

    return new Promise((resolve, reject) => {
      // Check if already aborted
      if (signal.aborted) {
        resolve();
        return;
      }

      // Spawn copilot CLI in non-interactive mode
      // --allow-all enables all permissions (similar to Claude's --dangerously-skip-permissions)
      // --add-dir pre-approves the context directory to skip trust prompts
      // -p runs in non-interactive mode with the given prompt text
      const contextPath = path.dirname(promptFilePath);
      const instruction = `Follow the instructions in: ${promptFilePath}`;
      // Escape double quotes in instruction and wrap in quotes for shell
      const escapedInstruction = instruction.replace(/"/g, '\\"');

      logger.info(LOG_CATEGORY, 'Spawning copilot process', { instruction, contextPath, cwd: workingDir });

      // Build command string with properly quoted instruction and pre-approved directory
      const command = `copilot --allow-all --add-dir "${contextPath}" -p "${escapedInstruction}"`;
      this.childProcess = spawn(command, [], {
        cwd: workingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        windowsHide: true, // Hide window on Windows
      });

      // Handle abort
      const abortHandler = () => {
        logger.info(LOG_CATEGORY, 'Abort signal received, killing process');
        this.killProcess();
        resolve();
      };
      signal.addEventListener('abort', abortHandler, { once: true });

      // Capture stdout/stderr for logging
      let stdout = '';
      let stderr = '';

      this.childProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
        // Log periodically to avoid flooding
        if (stdout.length % 1000 < 100) {
          logger.debug(LOG_CATEGORY, 'Copilot stdout', { length: stdout.length });
        }
      });

      this.childProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
        logger.debug(LOG_CATEGORY, 'Copilot stderr', { data: data.toString() });
      });

      this.childProcess.on('error', (error) => {
        logger.error(LOG_CATEGORY, 'Copilot process error', { error: error.message });
        signal.removeEventListener('abort', abortHandler);
        this.childProcess = null;
        reject(error);
      });

      this.childProcess.on('close', (code) => {
        logger.info(LOG_CATEGORY, 'Copilot CLI process closed', { code, stdoutLength: stdout.length, stderrLength: stderr.length });
        signal.removeEventListener('abort', abortHandler);
        this.childProcess = null;

        if (code === 0 || signal.aborted) {
          resolve();
        } else {
          reject(new Error(`Copilot CLI process exited with code ${code}: ${stderr || 'Unknown error'}`));
        }
      });
    });
  }

  private killProcess(): void {
    if (this.childProcess) {
      const logger = getLogger();
      logger.info(LOG_CATEGORY, 'Killing child process', { pid: this.childProcess.pid });

      // On Windows, we need to kill the process tree
      if (process.platform === 'win32' && this.childProcess.pid) {
        spawn('taskkill', ['/pid', this.childProcess.pid.toString(), '/f', '/t'], {
          stdio: 'ignore',
        });
      } else {
        this.childProcess.kill('SIGTERM');
      }
      this.childProcess = null;
    }
  }

  private waitForCompletion(
    doneFilePath: string,
    signal: AbortSignal,
    onStatusChange?: (status: string) => void
  ): Promise<void> {
    const logger = getLogger();

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let checkCount = 0;
      let lastLogTime = 0;

      const checkFile = () => {
        // Check if aborted
        if (signal.aborted) {
          logger.info(LOG_CATEGORY, 'Wait aborted by signal');
          resolve();
          return;
        }

        const elapsed = Date.now() - startTime;

        // Check timeout
        if (elapsed > HEADLESS_TIMEOUT_MS) {
          logger.error(LOG_CATEGORY, 'Copilot headless review timed out', { elapsedMs: elapsed, timeoutMs: HEADLESS_TIMEOUT_MS });
          reject(new Error('Copilot headless review timed out after 30 minutes'));
          return;
        }

        // Log progress every 10 seconds
        if (elapsed - lastLogTime > 10000) {
          logger.debug(LOG_CATEGORY, 'Still waiting for completion file', {
            elapsedMs: elapsed,
            checkCount,
            path: doneFilePath,
          });
          lastLogTime = elapsed;
        }

        // Check if done file exists
        if (fs.existsSync(doneFilePath)) {
          logger.info(LOG_CATEGORY, 'Completion file found', { path: doneFilePath });

          try {
            const content = fs.readFileSync(doneFilePath, 'utf-8');
            logger.debug(LOG_CATEGORY, 'Completion file content', { size: content.length, preview: content.substring(0, 200) });

            const result = JSON.parse(content);

            // Check for error status
            if (result.status === 'error') {
              logger.error(LOG_CATEGORY, 'Completion file indicates error', { error: result.error, result });
              reject(new Error(result.error || 'Review failed'));
              return;
            }

            logger.info(LOG_CATEGORY, 'Review completed successfully', { result });
            resolve();
          } catch (error: any) {
            // File might be partially written, wait and retry
            if (checkCount < 3) {
              checkCount++;
              logger.warn(LOG_CATEGORY, 'Failed to parse completion file, retrying', {
                error: error.message,
                checkCount,
              });
              setTimeout(checkFile, POLL_INTERVAL_MS);
              return;
            }
            logger.error(LOG_CATEGORY, 'Failed to parse completion file after retries', {
              error: error.message,
              checkCount,
            });
            reject(new Error(`Failed to parse completion file: ${error.message}`));
          }
          return;
        }

        // Update status periodically (every 30 seconds)
        const elapsedSeconds = Math.floor(elapsed / 1000);
        if (elapsedSeconds > 0 && elapsedSeconds % 30 === 0 && elapsed - lastLogTime < 2000) {
          onStatusChange?.(`Running Copilot AI review... (${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s)`);
        }

        // Poll again
        setTimeout(checkFile, POLL_INTERVAL_MS);
      };

      // Start polling
      logger.info(LOG_CATEGORY, 'Starting to poll for completion file');
      checkFile();
    });
  }

  cancel(): void {
    const logger = getLogger();
    logger.info(LOG_CATEGORY, 'Cancelling Copilot headless review');

    super.cancel();
    this.killProcess();
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
          severity: c.severity || 'minor',
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
