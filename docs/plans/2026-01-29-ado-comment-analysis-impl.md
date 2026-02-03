# ADO Comment Analysis Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an "Analyze" button to the ADO Comments Panel that sends comments to AI for recommendations (fix/reply/clarify) with actionable inline UI.

**Architecture:** New `CommentAnalysisService` uses existing `ReviewExecutorService` factory to get AI provider. Analysis persisted to `comment-analyses.json` following the fix-tracker pattern. UI enriches comments inline with collapsible analysis sections.

**Tech Stack:** TypeScript, Tauri (WebSocket bridge), vanilla DOM components, CSS variables

---

## Task 1: Add Analysis Types

**Files:**
- Modify: `src/shared/types.ts`

**Step 1: Add types at end of file**

```typescript
// Comment Analysis types
export type AnalysisRecommendation = 'fix' | 'reply' | 'clarify';

export interface CommentAnalysis {
  threadId: number;
  recommendation: AnalysisRecommendation;
  reasoning: string;
  fixDescription?: string;
  suggestedCode?: string;
  suggestedMessage?: string;
  analyzedAt: string;
  analyzedBy: string;
}

export interface PRCommentAnalyses {
  prId: number;
  organization: string;
  project: string;
  analyses: CommentAnalysis[];
  lastUpdated: string;
}
```

**Step 2: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(analysis): add comment analysis types"
```

---

## Task 2: Create CommentAnalysisService - Persistence

**Files:**
- Create: `src/main/ai/comment-analysis-service.ts`

**Step 1: Create service with load/save**

```typescript
/**
 * Comment Analysis Service
 * Analyzes ADO PR comments and provides recommendations (fix, reply, clarify)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { getAppDataPath } from '../utils/app-paths.js';
import type { CommentAnalysis, PRCommentAnalyses, CommentThread } from '../../shared/types.js';
import type { AIProviderType, ReviewContextInfo, ReviewExecutorOptions } from '../../shared/ai-types.js';
import { getReviewExecutorService } from './review-executor-service.js';
import { getLogger } from '../services/logger-service.js';

const LOG_CATEGORY = 'CommentAnalysisService';

export interface AnalysisContext {
  prId: number;
  org: string;
  project: string;
  repoPath?: string;
}

export interface AnalysisProgressCallback {
  (status: string): void;
}

class CommentAnalysisService {
  private progressCallbacks: Set<(event: { prId: number; status: string }) => void> = new Set();

  private getBasePath(): string {
    return path.join(getAppDataPath(), 'reviews');
  }

  private sanitizePath(component: string): string {
    return component.replace(/[<>:"/\\|?*]/g, '_');
  }

  private getAnalysesPath(prId: number, org: string, project: string): string {
    return path.join(
      this.getBasePath(),
      this.sanitizePath(org),
      this.sanitizePath(project),
      prId.toString(),
      'comment-analyses.json'
    );
  }

  private async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  async loadAnalyses(prId: number, org: string, project: string): Promise<PRCommentAnalyses> {
    const filePath = this.getAnalysesPath(prId, org, project);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as PRCommentAnalyses;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
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

  async saveAnalyses(analyses: PRCommentAnalyses): Promise<void> {
    const filePath = this.getAnalysesPath(analyses.prId, analyses.organization, analyses.project);
    const dir = path.dirname(filePath);
    await this.ensureDir(dir);
    await fs.writeFile(filePath, JSON.stringify(analyses, null, 2), 'utf-8');
  }

  async clearAnalysis(prId: number, org: string, project: string, threadId: number): Promise<void> {
    const analyses = await this.loadAnalyses(prId, org, project);
    analyses.analyses = analyses.analyses.filter(a => a.threadId !== threadId);
    analyses.lastUpdated = new Date().toISOString();
    await this.saveAnalyses(analyses);
  }

  getAnalysis(threadId: number, analyses: PRCommentAnalyses): CommentAnalysis | undefined {
    return analyses.analyses.find(a => a.threadId === threadId);
  }

  getAnalyzedThreadIds(analyses: PRCommentAnalyses): Set<number> {
    return new Set(analyses.analyses.map(a => a.threadId));
  }

  onProgress(callback: (event: { prId: number; status: string }) => void): () => void {
    this.progressCallbacks.add(callback);
    return () => this.progressCallbacks.delete(callback);
  }

  private emitProgress(prId: number, status: string): void {
    for (const callback of this.progressCallbacks) {
      callback({ prId, status });
    }
  }
}

// Singleton
let instance: CommentAnalysisService | null = null;

export function getCommentAnalysisService(): CommentAnalysisService {
  if (!instance) {
    instance = new CommentAnalysisService();
  }
  return instance;
}
```

**Step 2: Commit**

```bash
git add src/main/ai/comment-analysis-service.ts
git commit -m "feat(analysis): add CommentAnalysisService with persistence"
```

---

## Task 3: Add Analysis Execution to Service

**Files:**
- Modify: `src/main/ai/comment-analysis-service.ts`

**Step 1: Add analyzeComments method**

Add this method to the `CommentAnalysisService` class:

```typescript
  async analyzeComments(
    threads: CommentThread[],
    context: AnalysisContext,
    provider: AIProviderType,
    fileContents: Map<string, string>,
    onProgress?: AnalysisProgressCallback
  ): Promise<CommentAnalysis[]> {
    const logger = getLogger();
    logger.info(LOG_CATEGORY, 'Starting comment analysis', {
      prId: context.prId,
      threadCount: threads.length,
      provider,
    });

    onProgress?.('Preparing analysis prompt...');
    this.emitProgress(context.prId, 'Preparing analysis prompt...');

    const prompt = this.buildAnalysisPrompt(threads, context, fileContents);

    onProgress?.('Analyzing comments...');
    this.emitProgress(context.prId, 'Analyzing comments...');

    // Use review executor service to get appropriate provider
    const executorService = getReviewExecutorService();
    const executor = executorService.getExecutor(provider, { showTerminal: false });

    // Create a minimal context for the executor
    const reviewContext: ReviewContextInfo = {
      guid: `analysis-${Date.now()}`,
      contextPath: '',
      outputPath: '',
      workingDir: context.repoPath || process.cwd(),
      hasRepoContext: !!context.repoPath,
      repoPath: context.repoPath,
    };

    const options: ReviewExecutorOptions = {
      depth: 'quick',
      focusAreas: [],
      generateWalkthrough: false,
    };

    try {
      // Execute analysis using the AI provider
      const result = await executor.execute(reviewContext, {
        ...options,
        customPrompt: prompt,
      } as any);

      // Parse the response - we expect JSON in the comments array
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

  private buildAnalysisPrompt(
    threads: CommentThread[],
    context: AnalysisContext,
    fileContents: Map<string, string>
  ): string {
    let prompt = `# Analyze PR Review Comments

You are analyzing review comments on pull request #${context.prId}. For each comment, provide a recommendation.

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

Respond ONLY with the JSON array, no other text.`;

    return prompt;
  }

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

  async reanalyzeComment(
    thread: CommentThread,
    context: AnalysisContext,
    provider: AIProviderType,
    fileContents: Map<string, string>
  ): Promise<CommentAnalysis | null> {
    const analyses = await this.analyzeComments([thread], context, provider, fileContents);
    return analyses[0] || null;
  }
```

**Step 2: Commit**

```bash
git add src/main/ai/comment-analysis-service.ts
git commit -m "feat(analysis): add AI analysis execution to service"
```

---

## Task 4: Add Bridge RPC Handlers

**Files:**
- Modify: `src-backend/bridge.ts`

**Step 1: Import the service**

Add import near the top with other imports:

```typescript
import { getCommentAnalysisService } from '../src/main/ai/comment-analysis-service.js';
```

**Step 2: Initialize service and event forwarding**

Add after other service initializations (around line 149):

```typescript
const commentAnalysisService = getCommentAnalysisService();

// Set up analysis progress forwarding
commentAnalysisService.onProgress((event) => broadcast('comment-analysis:progress', event));
```

**Step 3: Add RPC handlers**

Add in the `handleRpc` switch statement before the `default` case:

```typescript
    // Comment Analysis API
    case 'comment-analysis:analyze': {
      const [threads, context, provider, fileContentsObj] = params;
      const fileContents = new Map(Object.entries(fileContentsObj || {}));
      return commentAnalysisService.analyzeComments(threads, context, provider, fileContents);
    }
    case 'comment-analysis:load':
      return commentAnalysisService.loadAnalyses(params[0], params[1], params[2]);
    case 'comment-analysis:clear':
      return commentAnalysisService.clearAnalysis(params[0], params[1], params[2], params[3]);
    case 'comment-analysis:reanalyze': {
      const [thread, context, provider, fileContentsObj] = params;
      const fileContents = new Map(Object.entries(fileContentsObj || {}));
      return commentAnalysisService.reanalyzeComment(thread, context, provider, fileContents);
    }
```

**Step 4: Commit**

```bash
git add src-backend/bridge.ts
git commit -m "feat(analysis): add comment analysis RPC handlers to bridge"
```

---

## Task 5: Add Frontend API Methods

**Files:**
- Modify: `src/renderer/tauri-api.ts`

**Step 1: Add API methods**

Add before the closing brace of `tauriAPI` object (around line 497):

```typescript
  // Comment Analysis API
  commentAnalysisAnalyze: (
    threads: any[],
    context: { prId: number; org: string; project: string; repoPath?: string },
    provider: string,
    fileContents: Record<string, string>
  ) => invoke('comment-analysis:analyze', threads, context, provider, fileContents),
  commentAnalysisLoad: (prId: number, org: string, project: string) =>
    invoke('comment-analysis:load', prId, org, project),
  commentAnalysisClear: (prId: number, org: string, project: string, threadId: number) =>
    invoke('comment-analysis:clear', prId, org, project, threadId),
  commentAnalysisReanalyze: (
    thread: any,
    context: { prId: number; org: string; project: string; repoPath?: string },
    provider: string,
    fileContents: Record<string, string>
  ) => invoke('comment-analysis:reanalyze', thread, context, provider, fileContents),
  onCommentAnalysisProgress: (callback: (event: { prId: number; status: string }) => void) =>
    subscribe('comment-analysis:progress', callback),
```

**Step 2: Commit**

```bash
git add src/renderer/tauri-api.ts
git commit -m "feat(analysis): add comment analysis frontend API"
```

---

## Task 6: Add CSS Styles for Analysis UI

**Files:**
- Create: `src/renderer/styles/comment-analysis.css`

**Step 1: Create CSS file**

```css
/* ========================================
   Comment Analysis Styles
   ======================================== */

/* Analyze button in header */
.analyze-btn {
  display: flex;
  align-items: center;
  gap: 4px;
}

.analyze-btn .analyze-count {
  background: var(--bg-tertiary);
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 11px;
}

.analyze-btn.analyzing {
  opacity: 0.7;
  pointer-events: none;
}

.analyze-btn .spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--border-color);
  border-top-color: var(--accent-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

/* Analysis section in thread */
.comment-analysis {
  margin-top: 12px;
  padding: 12px;
  background: var(--bg-tertiary);
  border-radius: 6px;
  border-left: 3px solid var(--accent-color);
}

.comment-analysis.fix {
  border-left-color: var(--warning-color, #ffaa44);
}

.comment-analysis.reply {
  border-left-color: var(--success-color, #107c10);
}

.comment-analysis.clarify {
  border-left-color: var(--info-color, #0078d4);
}

.analysis-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.analysis-recommendation {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 13px;
}

.analysis-recommendation.fix { color: var(--warning-color, #ffaa44); }
.analysis-recommendation.reply { color: var(--success-color, #107c10); }
.analysis-recommendation.clarify { color: var(--info-color, #0078d4); }

.analysis-refresh-btn {
  padding: 4px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-tertiary);
  border-radius: 4px;
}

.analysis-refresh-btn:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.analysis-reasoning {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 12px;
  line-height: 1.5;
}

/* Fix recommendation styles */
.analysis-fix-description {
  font-size: 13px;
  margin-bottom: 8px;
}

.analysis-suggested-code {
  margin: 8px 0;
  padding: 8px;
  background: var(--bg-primary);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 12px;
  overflow-x: auto;
  white-space: pre-wrap;
  border: 1px solid var(--border-color);
}

.analysis-fix-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.analysis-fix-input {
  flex: 1;
  padding: 6px 8px;
  font-size: 12px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.analysis-fix-input::placeholder {
  color: var(--text-tertiary);
}

/* Reply/Clarify styles */
.analysis-message-container {
  margin-top: 8px;
}

.analysis-message {
  width: 100%;
  padding: 8px;
  font-size: 13px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
  resize: vertical;
  min-height: 60px;
  font-family: inherit;
}

.analysis-message:read-only {
  background: var(--bg-secondary);
  cursor: default;
}

.analysis-message-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

/* Posted indicator */
.analysis-posted {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  background: var(--bg-success-subtle, rgba(16, 124, 16, 0.1));
  color: var(--success-color);
  border-radius: 4px;
  font-size: 12px;
}

/* Error state */
.analysis-error {
  padding: 8px;
  background: var(--bg-error-subtle, rgba(209, 52, 56, 0.1));
  color: var(--error-color);
  border-radius: 4px;
  font-size: 12px;
  margin-top: 8px;
}

/* Spinner animation */
@keyframes spin {
  to { transform: rotate(360deg); }
}
```

**Step 2: Import in main styles**

Add import in `src/renderer/styles/main.css` (if it exists) or ensure it's loaded via HTML.

**Step 3: Commit**

```bash
git add src/renderer/styles/comment-analysis.css
git commit -m "feat(analysis): add CSS styles for comment analysis UI"
```

---

## Task 7: Add Analyze Button to CommentsPanel Header

**Files:**
- Modify: `src/renderer/components/comments-panel.ts`

**Step 1: Add new properties and callbacks**

Add after existing private properties (around line 19):

```typescript
  private analyses: Map<number, CommentAnalysis> = new Map();
  private isAnalyzing: boolean = false;
  private analyzeCallback?: (threadIds: number[]) => void;
  private reanalyzeCallback?: (threadId: number) => void;
  private applyAnalysisFixCallback?: (threadId: number, analysis: CommentAnalysis, customMessage: string) => void;
  private postAnalysisReplyCallback?: (threadId: number, content: string) => void;
  private editingReplyThreadId: number | null = null;
```

**Step 2: Add import for CommentAnalysis type**

Update the import at the top:

```typescript
import type { CommentThread, Comment, ThreadStatus, CommentAnalysis } from '../../shared/types.js';
```

**Step 3: Add callback setters**

Add after existing callback setters:

```typescript
  onAnalyze(callback: (threadIds: number[]) => void) {
    this.analyzeCallback = callback;
  }

  onReanalyze(callback: (threadId: number) => void) {
    this.reanalyzeCallback = callback;
  }

  onApplyAnalysisFix(callback: (threadId: number, analysis: CommentAnalysis, customMessage: string) => void) {
    this.applyAnalysisFixCallback = callback;
  }

  onPostAnalysisReply(callback: (threadId: number, content: string) => void) {
    this.postAnalysisReplyCallback = callback;
  }

  setAnalyses(analyses: CommentAnalysis[]) {
    this.analyses = new Map(analyses.map(a => [a.threadId, a]));
    this.render();
  }

  setAnalyzing(analyzing: boolean) {
    this.isAnalyzing = analyzing;
    this.render();
  }

  updateAnalysis(analysis: CommentAnalysis) {
    this.analyses.set(analysis.threadId, analysis);
    this.render();
  }

  markAnalysisPosted(threadId: number) {
    // Remove analysis after posting - it's been handled
    this.analyses.delete(threadId);
    this.render();
  }
```

**Step 4: Add getUnanalyzedActiveThreads method**

```typescript
  private getUnanalyzedActiveThreads(): CommentThread[] {
    const threadsToShow = this.showAllComments
      ? this.threads
      : (this.fileThreads.length > 0 ? this.fileThreads : this.threads);

    return threadsToShow.filter(t =>
      t.status === 'active' &&
      !this.analyses.has(t.id) &&
      !this.fixedThreadIds.has(t.id.toString())
    );
  }
```

**Step 5: Commit**

```bash
git add src/renderer/components/comments-panel.ts
git commit -m "feat(analysis): add analysis state management to CommentsPanel"
```

---

## Task 8: Add Analyze Button Rendering

**Files:**
- Modify: `src/renderer/components/comments-panel.ts`

**Step 1: Import RefreshCw icon**

Update icons import to include RefreshCw:

```typescript
import { iconHtml, MessageSquare, File, X, Check, RefreshCw } from '../utils/icons.js';
```

**Step 2: Add renderAnalyzeButton method**

Add this method to the class:

```typescript
  renderAnalyzeButton(): string {
    const unanalyzed = this.getUnanalyzedActiveThreads();
    const count = unanalyzed.length;

    if (this.isAnalyzing) {
      return `
        <button class="btn btn-sm btn-primary analyze-btn analyzing" disabled>
          <span class="spinner"></span>
          Analyzing...
        </button>
      `;
    }

    return `
      <button class="btn btn-sm btn-primary analyze-btn" ${count === 0 ? 'disabled' : ''}>
        Analyze${count > 0 ? ` <span class="analyze-count">${count}</span>` : ''}
      </button>
    `;
  }
```

**Step 3: Update render method to include analyze button**

In the `render()` method, after rendering the threads list, add the analyze button to the header. Find where the panel header is rendered and update it to include the button.

Add a method to render the header:

```typescript
  renderHeader(): string {
    return `
      <div class="comments-panel-header">
        <span class="panel-title">Comments</span>
        ${this.renderAnalyzeButton()}
      </div>
    `;
  }
```

**Step 4: Commit**

```bash
git add src/renderer/components/comments-panel.ts
git commit -m "feat(analysis): add Analyze button rendering"
```

---

## Task 9: Add Inline Analysis Rendering

**Files:**
- Modify: `src/renderer/components/comments-panel.ts`

**Step 1: Add renderAnalysis method**

```typescript
  private renderAnalysis(threadId: number): string {
    const analysis = this.analyses.get(threadId);
    if (!analysis) return '';

    const isEditing = this.editingReplyThreadId === threadId;
    const recommendationLabel = {
      fix: 'FIX',
      reply: 'REPLY',
      clarify: 'CLARIFY',
    }[analysis.recommendation];

    const icon = {
      fix: '💡',
      reply: '💬',
      clarify: '❓',
    }[analysis.recommendation];

    let content = '';

    if (analysis.recommendation === 'fix') {
      content = `
        <div class="analysis-fix-description">${analysis.fixDescription || ''}</div>
        ${analysis.suggestedCode ? `
          <div class="analysis-suggested-code">${this.escapeHtml(analysis.suggestedCode)}</div>
        ` : ''}
        <div class="analysis-fix-actions">
          <input type="text" class="analysis-fix-input" placeholder="Additional instructions (optional)..." data-thread-id="${threadId}" />
          <button class="btn btn-sm btn-primary analysis-apply-fix-btn" data-thread-id="${threadId}">Apply Fix</button>
        </div>
      `;
    } else {
      // reply or clarify
      content = `
        <div class="analysis-message-container">
          <textarea class="analysis-message" data-thread-id="${threadId}" ${isEditing ? '' : 'readonly'}>${analysis.suggestedMessage || ''}</textarea>
          <div class="analysis-message-actions">
            ${isEditing ? `
              <button class="btn btn-sm btn-ghost analysis-cancel-edit-btn" data-thread-id="${threadId}">Cancel</button>
              <button class="btn btn-sm btn-primary analysis-post-btn" data-thread-id="${threadId}">Post to ADO</button>
            ` : `
              <button class="btn btn-sm btn-ghost analysis-edit-btn" data-thread-id="${threadId}">Edit</button>
              <button class="btn btn-sm btn-primary analysis-post-btn" data-thread-id="${threadId}">Post to ADO</button>
            `}
          </div>
        </div>
      `;
    }

    return `
      <div class="comment-analysis ${analysis.recommendation}" data-thread-id="${threadId}">
        <div class="analysis-header">
          <span class="analysis-recommendation ${analysis.recommendation}">
            ${icon} Recommendation: ${recommendationLabel}
          </span>
          <button class="analysis-refresh-btn" data-thread-id="${threadId}" title="Re-analyze">
            ${iconHtml(RefreshCw, { size: 14 })}
          </button>
        </div>
        <div class="analysis-reasoning">${analysis.reasoning}</div>
        ${content}
      </div>
    `;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
```

**Step 2: Update renderThread to include analysis**

In the `renderThread` method, add the analysis section after the thread-actions div:

Find this line:
```typescript
        </div>
        ${this.canApply && thread.threadContext?.filePath ? `
```

And add before it:
```typescript
        ${this.renderAnalysis(thread.id)}
```

**Step 3: Commit**

```bash
git add src/renderer/components/comments-panel.ts
git commit -m "feat(analysis): add inline analysis rendering"
```

---

## Task 10: Add Analysis Event Listeners

**Files:**
- Modify: `src/renderer/components/comments-panel.ts`

**Step 1: Add analysis event listeners in attachEventListeners**

Add at the end of `attachEventListeners()`:

```typescript
    // Analyze button click
    const analyzeBtn = this.container.querySelector('.analyze-btn:not(.analyzing)');
    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', () => {
        const unanalyzed = this.getUnanalyzedActiveThreads();
        if (unanalyzed.length > 0 && this.analyzeCallback) {
          this.analyzeCallback(unanalyzed.map(t => t.id));
        }
      });
    }

    // Refresh/reanalyze buttons
    this.listContainer.querySelectorAll('.analysis-refresh-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const threadId = parseInt((e.currentTarget as HTMLElement).dataset.threadId || '0');
        if (threadId && this.reanalyzeCallback) {
          this.reanalyzeCallback(threadId);
        }
      });
    });

    // Apply fix buttons
    this.listContainer.querySelectorAll('.analysis-apply-fix-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const threadId = parseInt((e.currentTarget as HTMLElement).dataset.threadId || '0');
        const analysis = this.analyses.get(threadId);
        const input = this.listContainer.querySelector(`.analysis-fix-input[data-thread-id="${threadId}"]`) as HTMLInputElement;
        const customMessage = input?.value.trim() || '';

        if (threadId && analysis && this.applyAnalysisFixCallback) {
          this.applyAnalysisFixCallback(threadId, analysis, customMessage);
        }
      });
    });

    // Edit reply buttons
    this.listContainer.querySelectorAll('.analysis-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const threadId = parseInt((e.currentTarget as HTMLElement).dataset.threadId || '0');
        this.editingReplyThreadId = threadId;
        this.render();
        // Focus the textarea
        const textarea = this.listContainer.querySelector(`.analysis-message[data-thread-id="${threadId}"]`) as HTMLTextAreaElement;
        textarea?.focus();
      });
    });

    // Cancel edit buttons
    this.listContainer.querySelectorAll('.analysis-cancel-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.editingReplyThreadId = null;
        this.render();
      });
    });

    // Post to ADO buttons
    this.listContainer.querySelectorAll('.analysis-post-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const threadId = parseInt((e.currentTarget as HTMLElement).dataset.threadId || '0');
        const textarea = this.listContainer.querySelector(`.analysis-message[data-thread-id="${threadId}"]`) as HTMLTextAreaElement;
        const content = textarea?.value.trim();

        if (threadId && content && this.postAnalysisReplyCallback) {
          this.postAnalysisReplyCallback(threadId, content);
        }
      });
    });

    // Handle Escape in analysis message textarea
    this.listContainer.querySelectorAll('.analysis-message').forEach(textarea => {
      textarea.addEventListener('keydown', (e: Event) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Escape') {
          this.editingReplyThreadId = null;
          this.render();
        }
      });
    });
```

**Step 2: Commit**

```bash
git add src/renderer/components/comments-panel.ts
git commit -m "feat(analysis): add analysis event listeners"
```

---

## Task 11: Wire Up Analysis in App

**Files:**
- Modify: `src/renderer/app.ts`

**Step 1: Add analysis imports**

Add to the imports from shared/types.ts:

```typescript
import type { CommentAnalysis } from '../shared/types.js';
```

**Step 2: Add analysis initialization in initEventListeners or where comments panel callbacks are set**

Find where `this.commentsPanel.onApply(...)` is called and add after it:

```typescript
    // Comment Analysis callbacks
    this.commentsPanel.onAnalyze(async (threadIds) => {
      await this.analyzeComments(threadIds);
    });

    this.commentsPanel.onReanalyze(async (threadId) => {
      await this.reanalyzeComment(threadId);
    });

    this.commentsPanel.onApplyAnalysisFix(async (threadId, analysis, customMessage) => {
      await this.applyAnalysisFix(threadId, analysis, customMessage);
    });

    this.commentsPanel.onPostAnalysisReply(async (threadId, content) => {
      await this.postAnalysisReply(threadId, content);
    });
```

**Step 3: Add analysis methods to the class**

```typescript
  private async analyzeComments(threadIds: number[]) {
    const tabState = this.getActiveTabState();
    if (!tabState) return;

    const threads = tabState.threads.filter(t => threadIds.includes(t.id));
    if (threads.length === 0) return;

    this.commentsPanel.setAnalyzing(true);

    try {
      // Get file contents for context
      const fileContents: Record<string, string> = {};
      for (const thread of threads) {
        const filePath = thread.threadContext?.filePath;
        if (filePath && !fileContents[filePath]) {
          const fileChange = tabState.fileChanges.find(f => f.path === filePath);
          if (fileChange?.modifiedContent) {
            fileContents[filePath] = fileChange.modifiedContent;
          }
        }
      }

      const context = {
        prId: tabState.prId,
        org: tabState.org,
        project: tabState.project,
      };

      // Default to claude-sdk for analysis
      const provider = 'claude-sdk';

      const analyses = await window.electronAPI.commentAnalysisAnalyze(
        threads,
        context,
        provider,
        fileContents
      );

      this.commentsPanel.setAnalyses(analyses);
      Toast.show('Analysis complete', 'success');
    } catch (error: any) {
      Toast.show(`Analysis failed: ${error.message}`, 'error');
    } finally {
      this.commentsPanel.setAnalyzing(false);
    }
  }

  private async reanalyzeComment(threadId: number) {
    const tabState = this.getActiveTabState();
    if (!tabState) return;

    const thread = tabState.threads.find(t => t.id === threadId);
    if (!thread) return;

    try {
      const filePath = thread.threadContext?.filePath;
      const fileContents: Record<string, string> = {};
      if (filePath) {
        const fileChange = tabState.fileChanges.find(f => f.path === filePath);
        if (fileChange?.modifiedContent) {
          fileContents[filePath] = fileChange.modifiedContent;
        }
      }

      const context = {
        prId: tabState.prId,
        org: tabState.org,
        project: tabState.project,
      };

      const analysis = await window.electronAPI.commentAnalysisReanalyze(
        thread,
        context,
        'claude-sdk',
        fileContents
      );

      if (analysis) {
        this.commentsPanel.updateAnalysis(analysis);
        Toast.show('Comment re-analyzed', 'success');
      }
    } catch (error: any) {
      Toast.show(`Re-analysis failed: ${error.message}`, 'error');
    }
  }

  private async applyAnalysisFix(threadId: number, analysis: CommentAnalysis, customMessage: string) {
    const tabState = this.getActiveTabState();
    if (!tabState) return;

    const thread = tabState.threads.find(t => t.id === threadId);
    if (!thread || !thread.threadContext?.filePath) return;

    // Build enriched content for apply changes
    let content = thread.comments
      .filter(c => c.commentType !== 'system' && !c.isDeleted)
      .map(c => c.content)
      .join('\n\n');

    content += `\n\n---\nAI Analysis: ${analysis.reasoning}`;
    if (analysis.fixDescription) {
      content += `\n\nFix: ${analysis.fixDescription}`;
    }
    if (analysis.suggestedCode) {
      content += `\n\nSuggested code:\n\`\`\`\n${analysis.suggestedCode}\n\`\`\``;
    }

    const filePath = thread.threadContext.filePath;
    const line = thread.threadContext.rightFileStart?.line || thread.threadContext.leftFileStart?.line || 0;

    // Use existing apply callback
    if (this.commentsPanel['applyCallback']) {
      this.commentsPanel['applyCallback'](threadId, content, filePath, line, customMessage);
    }
  }

  private async postAnalysisReply(threadId: number, content: string) {
    const tabState = this.getActiveTabState();
    if (!tabState) return;

    try {
      await window.electronAPI.replyToThread(
        tabState.org,
        tabState.project,
        tabState.repoId,
        tabState.prId,
        threadId,
        content
      );

      this.commentsPanel.markAnalysisPosted(threadId);
      Toast.show('Reply posted to ADO', 'success');

      // Refresh threads to show new reply
      await this.refreshThreads();
    } catch (error: any) {
      Toast.show(`Failed to post reply: ${error.message}`, 'error');
    }
  }

  private getActiveTabState(): PRTabState | null {
    return this.prTabStates.get(this.activeReviewTabId) || null;
  }

  private async refreshThreads() {
    const tabState = this.getActiveTabState();
    if (!tabState) return;

    const threads = await window.electronAPI.getThreads(
      tabState.org,
      tabState.project,
      tabState.repoId,
      tabState.prId
    );
    tabState.threads = threads;
    this.commentsPanel.setThreads(threads);
  }
```

**Step 4: Load saved analyses when switching to a PR tab**

Find where PR data is loaded (likely in a method like `loadPR` or `switchToTab`) and add:

```typescript
    // Load saved analyses
    const savedAnalyses = await window.electronAPI.commentAnalysisLoad(
      tabState.prId,
      tabState.org,
      tabState.project
    );
    if (savedAnalyses?.analyses?.length > 0) {
      this.commentsPanel.setAnalyses(savedAnalyses.analyses);
    }
```

**Step 5: Commit**

```bash
git add src/renderer/app.ts
git commit -m "feat(analysis): wire up comment analysis in main app"
```

---

## Task 12: Add CSS Import

**Files:**
- Modify: `src/renderer/index.html` or main CSS entry point

**Step 1: Add CSS import**

Add the stylesheet link:

```html
<link rel="stylesheet" href="styles/comment-analysis.css">
```

Or if using CSS imports in main.css:

```css
@import 'comment-analysis.css';
```

**Step 2: Commit**

```bash
git add src/renderer/index.html
git commit -m "feat(analysis): add comment analysis CSS import"
```

---

## Task 13: End-to-End Testing

**Steps:**

1. Build the app: `npm run build`
2. Start the app: `npm run dev` or `npm run tauri dev`
3. Open a PR with active comments
4. Click "Analyze" button in comments panel header
5. Verify:
   - Button shows spinner while analyzing
   - Analysis sections appear inline below comments
   - Fix recommendations show code and Apply Fix button
   - Reply/Clarify show editable textarea
   - Refresh button re-analyzes individual comment
   - Apply Fix queues to apply changes
   - Post to ADO creates reply
6. Close and reopen PR - verify analyses persist

**Step 1: Manual test**

Run through the test steps manually.

**Step 2: Final commit**

```bash
git add -A
git commit -m "feat(analysis): complete ADO comment analysis feature"
```

---

## Summary

This implementation adds:

1. **Types**: `CommentAnalysis`, `PRCommentAnalyses` in `src/shared/types.ts`
2. **Service**: `CommentAnalysisService` with persistence and AI execution
3. **Bridge**: RPC handlers for analyze, load, clear, reanalyze
4. **Frontend API**: Methods in `tauri-api.ts`
5. **CSS**: Styles for analysis UI in `comment-analysis.css`
6. **UI**: Analyze button, inline analysis sections with actions
7. **Integration**: Wired up in `app.ts` with Apply Changes and ADO reply

Total: ~13 tasks, estimated 1-2 hours of implementation time.
