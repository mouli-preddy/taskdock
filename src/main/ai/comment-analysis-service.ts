/**
 * Comment Analysis Service
 * Manages persistence, progress tracking, and AI analysis execution for ADO comment analysis.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getAppDataPath } from '../utils/app-paths.js';
import type { CommentAnalysis, PRCommentAnalyses, CommentThread } from '../../shared/types.js';
import type { AIProviderType, ReviewContextInfo, ReviewExecutorOptions } from '../../shared/ai-types.js';
import { getReviewExecutorService } from './review-executor-service.js';
import { getLogger } from '../services/logger-service.js';

const LOG_CATEGORY = 'CommentAnalysisService';

/**
 * Context required for analyzing comments
 */
export interface AnalysisContext {
  prId: number;
  org: string;
  project: string;
  repoPath?: string;
}

/**
 * Progress callback for analysis operations
 */
export interface AnalysisProgressCallback {
  (status: string): void;
}

class CommentAnalysisService {
  private progressCallbacks: Set<(event: { prId: number; status: string }) => void> = new Set();

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
   * Get the path to a PR's comment analyses file
   */
  private getAnalysesPath(prId: number, org: string, project: string): string {
    return path.join(
      this.getBasePath(),
      this.sanitizePath(org),
      this.sanitizePath(project),
      prId.toString(),
      'comment-analyses.json'
    );
  }

  /**
   * Ensure the directory exists
   */
  private async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  /**
   * Load analyses for a PR
   */
  async loadAnalyses(prId: number, org: string, project: string): Promise<PRCommentAnalyses> {
    const filePath = this.getAnalysesPath(prId, org, project);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as PRCommentAnalyses;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Return empty analyses
        return {
          prId,
          organization: org,
          project,
          analyses: [],
          lastUpdated: new Date().toISOString(),
        };
      }
      throw error;
    }
  }

  /**
   * Save analyses for a PR
   */
  async saveAnalyses(analyses: PRCommentAnalyses): Promise<void> {
    const logger = getLogger();
    const filePath = this.getAnalysesPath(
      analyses.prId,
      analyses.organization,
      analyses.project
    );
    const dir = path.dirname(filePath);

    await this.ensureDir(dir);
    analyses.lastUpdated = new Date().toISOString();
    await fs.writeFile(filePath, JSON.stringify(analyses, null, 2), 'utf-8');

    logger.info(LOG_CATEGORY, 'Saved comment analyses', {
      prId: analyses.prId,
      count: analyses.analyses.length,
    });
  }

  /**
   * Clear analysis for a specific thread
   */
  async clearAnalysis(prId: number, org: string, project: string, threadId: number): Promise<void> {
    const logger = getLogger();
    const analyses = await this.loadAnalyses(prId, org, project);

    const initialCount = analyses.analyses.length;
    analyses.analyses = analyses.analyses.filter(a => a.threadId !== threadId);

    if (analyses.analyses.length < initialCount) {
      await this.saveAnalyses(analyses);
      logger.info(LOG_CATEGORY, 'Cleared analysis for thread', {
        prId,
        threadId,
      });
    }
  }

  /**
   * Get analysis for a specific thread
   */
  getAnalysis(threadId: number, analyses: PRCommentAnalyses): CommentAnalysis | undefined {
    return analyses.analyses.find(a => a.threadId === threadId);
  }

  /**
   * Get all analyzed thread IDs for quick lookup
   */
  getAnalyzedThreadIds(analyses: PRCommentAnalyses): Set<number> {
    return new Set(analyses.analyses.map(a => a.threadId));
  }

  /**
   * Register a progress callback
   */
  onProgress(callback: (event: { prId: number; status: string }) => void): () => void {
    this.progressCallbacks.add(callback);
    return () => {
      this.progressCallbacks.delete(callback);
    };
  }

  /**
   * Emit progress to all registered callbacks
   */
  private emitProgress(prId: number, status: string): void {
    for (const callback of this.progressCallbacks) {
      try {
        callback({ prId, status });
      } catch (error) {
        const logger = getLogger();
        logger.error(LOG_CATEGORY, 'Error in progress callback', { error });
      }
    }
  }

  /**
   * Analyze comment threads using AI provider
   */
  async analyzeComments(
    threads: CommentThread[],
    context: AnalysisContext,
    provider: AIProviderType,
    fileContents: Map<string, string>,
    onProgress?: AnalysisProgressCallback,
    showTerminal: boolean = false
  ): Promise<CommentAnalysis[]> {
    const logger = getLogger();
    const guid = uuidv4();
    const outputFile = 'analysis-output.json';

    logger.info(LOG_CATEGORY, 'Starting comment analysis', {
      prId: context.prId,
      threadCount: threads.length,
      provider,
      guid,
    });

    onProgress?.('Preparing analysis prompt...');
    this.emitProgress(context.prId, 'Preparing analysis prompt...');

    // Create output directory for this analysis
    const outputPath = path.join(
      getAppDataPath(),
      'analysis',
      this.sanitizePath(context.org),
      this.sanitizePath(context.project),
      context.prId.toString(),
      guid
    );
    await fs.mkdir(outputPath, { recursive: true });

    // Build prompt with output file instruction
    const prompt = this.buildAnalysisPrompt(threads, context, fileContents, outputPath, outputFile, guid);

    onProgress?.('Analyzing comments...');
    this.emitProgress(context.prId, 'Analyzing comments...');

    // Use review executor service
    const executorService = getReviewExecutorService();
    const executor = executorService.getExecutor(provider, { showTerminal });

    // Create context for the executor
    const reviewContext: ReviewContextInfo = {
      guid,
      contextPath: outputPath, // Used for label and working context
      outputPath,
      workingDir: context.repoPath || process.cwd(),
      hasRepoContext: !!context.repoPath,
      repoPath: context.repoPath,
    };

    const options: ReviewExecutorOptions = {
      depth: 'quick',
      focusAreas: [],
      generateWalkthrough: false,
      customPrompt: prompt,
      customOutputFile: outputFile,
    };

    try {
      // Execute analysis using the AI provider
      const result = await executor.execute(reviewContext, options);

      // Parse the response from rawOutput
      const analyses = this.parseAnalysisResponse(result, threads);

      // Save results
      const existingAnalyses = await this.loadAnalyses(context.prId, context.org, context.project);

      // Merge new analyses (replace existing for same threadId)
      const analysisMap = new Map(existingAnalyses.analyses.map(a => [a.threadId, a]));
      for (const analysis of analyses) {
        analysisMap.set(analysis.threadId, analysis);
      }

      existingAnalyses.analyses = Array.from(analysisMap.values());
      existingAnalyses.lastUpdated = new Date().toISOString();
      await this.saveAnalyses(existingAnalyses);

      onProgress?.('Analysis complete');
      this.emitProgress(context.prId, 'Analysis complete');

      logger.info(LOG_CATEGORY, 'Comment analysis complete', {
        prId: context.prId,
        analyzedCount: analyses.length,
      });

      return analyses;
    } catch (error: any) {
      logger.error(LOG_CATEGORY, 'Comment analysis failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Build the analysis prompt for AI
   */
  private buildAnalysisPrompt(
    threads: CommentThread[],
    context: AnalysisContext,
    fileContents: Map<string, string>,
    outputPath: string,
    outputFile: string,
    guid: string
  ): string {
    let prompt = `# Analyze PR Review Comments

You are analyzing review comments on pull request #${context.prId}. For each comment, provide a recommendation.

## Output Instructions

Write your analysis results as a JSON array to: ${path.join(outputPath, outputFile)}

After writing the output file, create a completion marker file at: ${path.join(outputPath, `${guid}.done.json`)}
The completion marker should contain: {"status": "complete"}

## Comments to Analyze

`;

    for (const thread of threads) {
      const userComments = thread.comments.filter(c => c.commentType !== 'system' && !c.isDeleted);
      if (userComments.length === 0) continue;

      const filePath = thread.threadContext?.filePath || 'General';
      const line = thread.threadContext?.rightFileStart?.line || 0;
      const authorName = userComments[0]?.author?.displayName || 'Unknown';

      prompt += `### Comment Thread #${thread.id}
**File**: ${filePath}${line ? `:${line}` : ''}
**Reviewer**: ${authorName}
**Status**: ${thread.status}

**Comment**:
${userComments.map(c => c.content).join('\n\n')}

`;

      // Add code context if available
      if (thread.threadContext?.filePath && fileContents.has(thread.threadContext.filePath)) {
        const content = fileContents.get(thread.threadContext.filePath)!;
        const lines = content.split('\n');
        const startLine = Math.max(0, (line || 1) - 5);
        const endLine = Math.min(lines.length, (line || 1) + 10);
        const snippet = lines.slice(startLine, endLine).join('\n');

        prompt += `**Code Context** (lines ${startLine + 1}-${endLine}):
\`\`\`
${snippet}
\`\`\`

`;
      }

      prompt += '---\n\n';
    }

    prompt += `## Instructions

For each comment thread, respond with a JSON array. Each object should have:

\`\`\`json
[
  {
    "threadId": 123,
    "recommendation": "fix" | "reply" | "clarify",
    "reasoning": "Brief explanation of why this recommendation",
    "fixDescription": "What needs to be fixed (only if recommendation is 'fix')",
    "suggestedCode": "Code snippet showing the fix (only if recommendation is 'fix')",
    "suggestedMessage": "Draft reply text (only if recommendation is 'reply' or 'clarify')"
  }
]
\`\`\`

**Recommendation Guidelines**:
- **fix**: Comment identifies a valid issue that should be addressed in code
- **reply**: Comment is resolved, asks a question, or needs acknowledgment
- **clarify**: Comment is unclear, you disagree, or need more context from reviewer

Write ONLY the JSON array to the output file, no other text. Then create the completion marker file.`;

    return prompt;
  }

  /**
   * Parse AI response into CommentAnalysis objects
   */
  private parseAnalysisResponse(result: any, threads: CommentThread[]): CommentAnalysis[] {
    const logger = getLogger();
    const analyses: CommentAnalysis[] = [];

    try {
      // The result might have the JSON in various places depending on executor
      let jsonStr = '';

      if (typeof result === 'string') {
        jsonStr = result;
      } else if (result.comments && result.comments.length > 0) {
        // Check if first comment content contains our JSON
        jsonStr = result.comments[0]?.content || '';
      } else if (result.rawOutput) {
        jsonStr = result.rawOutput;
      }

      // Extract JSON array from response
      const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        logger.warn(LOG_CATEGORY, 'No JSON array found in analysis response');
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!Array.isArray(parsed)) {
        logger.warn(LOG_CATEGORY, 'Parsed result is not an array');
        return [];
      }

      const threadIds = new Set(threads.map(t => t.id));
      const now = new Date().toISOString();

      for (const item of parsed) {
        if (!item.threadId || !threadIds.has(item.threadId)) continue;
        if (!['fix', 'reply', 'clarify'].includes(item.recommendation)) continue;

        analyses.push({
          threadId: item.threadId,
          recommendation: item.recommendation,
          reasoning: item.reasoning || '',
          fixDescription: item.fixDescription,
          suggestedCode: item.suggestedCode,
          suggestedMessage: item.suggestedMessage,
          analyzedAt: now,
          analyzedBy: 'ai',
        });
      }

      return analyses;
    } catch (error: any) {
      logger.error(LOG_CATEGORY, 'Failed to parse analysis response', { error: error.message });
      return [];
    }
  }

  /**
   * Re-analyze a single comment thread
   */
  async reanalyzeComment(
    thread: CommentThread,
    context: AnalysisContext,
    provider: AIProviderType,
    fileContents: Map<string, string>,
    showTerminal: boolean = false
  ): Promise<CommentAnalysis | null> {
    const analyses = await this.analyzeComments([thread], context, provider, fileContents, undefined, showTerminal);
    return analyses[0] || null;
  }
}

// Singleton instance
let commentAnalysisServiceInstance: CommentAnalysisService | null = null;

export function getCommentAnalysisService(): CommentAnalysisService {
  if (!commentAnalysisServiceInstance) {
    commentAnalysisServiceInstance = new CommentAnalysisService();
  }
  return commentAnalysisServiceInstance;
}
