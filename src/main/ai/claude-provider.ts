/**
 * Claude AI Provider
 * Uses Claude Agent SDK for code review with seamless auth via Azure CLI or API key
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { v4 as uuidv4 } from 'uuid';
import type {
  IAIProvider,
  AIProviderConfig,
} from './ai-provider.js';
import {
  CODE_REVIEW_SYSTEM_PROMPT,
  WALKTHROUGH_SYSTEM_PROMPT,
  detectLanguage,
} from './ai-provider.js';
import type {
  AIProvider,
  AIReviewComment,
  ReviewChunk,
  ReviewContext,
  CodeWalkthrough,
  PRContext,
  AIProviderStatus,
} from '../../shared/ai-types.js';
import type { FileChange } from '../../shared/types.js';

interface ClaudeConfig {
  model: 'sonnet' | 'opus' | 'haiku';
  maxTokens: number;
}

export class ClaudeProvider implements IAIProvider {
  readonly name: AIProvider = 'claude';
  private config: ClaudeConfig = {
    model: 'sonnet',
    maxTokens: 4096,
  };

  configure(config: AIProviderConfig): void {
    if (config.model) {
      this.config.model = config.model as ClaudeConfig['model'];
    }
    if (config.maxTokens) {
      this.config.maxTokens = config.maxTokens;
    }
  }

  async isAvailable(): Promise<AIProviderStatus> {
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
          return {
            provider: 'claude',
            available: false,
            error: errorMsg,
          };
        }
      }

      return { provider: 'claude', available: true };
    } catch (error: any) {
      return {
        provider: 'claude',
        available: false,
        error: error.message || 'Failed to connect to Claude',
      };
    }
  }

  async *reviewChunk(
    chunk: ReviewChunk,
    context: ReviewContext
  ): AsyncGenerator<AIReviewComment> {
    const prompt = this.buildReviewPrompt(chunk, context);

    try {
      const response = query({
        prompt,
        options: {
          model: this.config.model,
          maxTurns: 1,
        },
      });

      let fullResponse = '';

      for await (const message of response) {
        if (message.type === 'assistant' && message.message?.content) {
          const textContent = message.message.content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('');
          fullResponse += textContent;
        }

        // Handle tool use for structured output
        if (message.type === 'assistant' && message.message?.content) {
          const toolUses = message.message.content.filter((b: any) => b.type === 'tool_use') as any[];
          for (const toolUse of toolUses) {
            if (toolUse.name === 'submit_review_comment') {
              const comment = this.parseToolInput(toolUse.input, chunk.filePath);
              if (comment) {
                yield comment;
              }
            }
          }
        }
      }

      // Parse JSON response if no tool use
      if (fullResponse) {
        const comments = this.parseReviewResponse(fullResponse, chunk.filePath);
        for (const comment of comments) {
          yield comment;
        }
      }
    } catch (error) {
      console.error('Claude review chunk error:', error);
      // Don't throw - just yield no comments for this chunk
    }
  }

  async generateWalkthrough(
    files: FileChange[],
    prContext: PRContext
  ): Promise<CodeWalkthrough> {
    const prompt = this.buildWalkthroughPrompt(files, prContext);

    try {
      const response = query({
        prompt,
        options: {
          model: this.config.model,
          maxTurns: 1,
        },
      });

      let fullResponse = '';

      for await (const message of response) {
        if (message.type === 'assistant' && message.message?.content) {
          const textContent = message.message.content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('');
          fullResponse += textContent;
        }
      }

      return this.parseWalkthroughResponse(fullResponse, prContext.prId);
    } catch (error) {
      console.error('Claude walkthrough error:', error);
      return {
        id: uuidv4(),
        prId: prContext.prId,
        summary: 'Failed to generate walkthrough',
        steps: [],
        totalSteps: 0,
        estimatedReadTime: 0,
      };
    }
  }

  private buildReviewPrompt(chunk: ReviewChunk, context: ReviewContext): string {
    const focusAreas = context.focusAreas?.length
      ? `Focus especially on: ${context.focusAreas.join(', ')}`
      : '';

    const depthInstruction = {
      quick: 'Focus only on critical bugs and security issues. Be concise.',
      standard: 'Review for bugs, security, performance, and style issues.',
      thorough: 'Perform an in-depth review covering all aspects including edge cases, documentation, and best practices.',
    }[context.depth];

    return `${CODE_REVIEW_SYSTEM_PROMPT}

${depthInstruction}
${focusAreas}

## Context
- Repository: ${context.pr.repository}
- PR: ${context.pr.title}
- File: ${chunk.filePath}
- Language: ${chunk.language}
- Lines: ${chunk.startLine}-${chunk.endLine}

## Code Diff
\`\`\`${chunk.language.toLowerCase()}
${chunk.contextBefore ? `// Context before:\n${chunk.contextBefore}\n\n` : ''}// Changes:
${chunk.diffContent}
${chunk.contextAfter ? `\n\n// Context after:\n${chunk.contextAfter}` : ''}
\`\`\`

Analyze this code and provide your review as a JSON object with a "comments" array. Each comment should have: startLine, endLine, severity (critical/major/minor/trivial), category (bug/security/performance/style/logic/compliance/recommendation/nitpick/other), title, content, suggestedFix (optional), confidence (0-1).

If there are no issues, return: \`\`\`json\n{"comments": []}\n\`\`\``;
  }

  private buildWalkthroughPrompt(files: FileChange[], prContext: PRContext): string {
    const filesSummary = files.map(f => {
      const lang = detectLanguage(f.path);
      const addLines = f.modifiedContent?.split('\n').length || 0;
      const delLines = f.originalContent?.split('\n').length || 0;
      return `- ${f.path} (${lang}, ${f.changeType}, +${addLines}/-${delLines})`;
    }).join('\n');

    const diffSamples = files.slice(0, 5).map(f => {
      const lines = (f.modifiedContent || f.originalContent || '').split('\n').slice(0, 50);
      return `### ${f.path}\n\`\`\`\n${lines.join('\n')}\n\`\`\``;
    }).join('\n\n');

    return `${WALKTHROUGH_SYSTEM_PROMPT}

## PR Information
- Title: ${prContext.title}
- Description: ${prContext.description || 'No description provided'}
- Source: ${prContext.sourceBranch} -> ${prContext.targetBranch}
- Repository: ${prContext.repository}

## Changed Files (${files.length} total)
${filesSummary}

## Sample Changes
${diffSamples}

Generate a walkthrough for this PR as a JSON object with the following structure:
\`\`\`json
{
  "summary": "Brief summary of what this PR does (supports markdown)",
  "architectureDiagram": "Optional mermaid diagram showing the flow/architecture of changes. Use flowchart TD or graph TD syntax. Example: graph TD\\n    A[Component] --> B[Service]\\n    B --> C[Database]",
  "steps": [
    {
      "stepNumber": 1,
      "title": "Step title",
      "description": "Detailed explanation (supports markdown)",
      "filePath": "path/to/file.ts",
      "startLine": 10,
      "endLine": 20,
      "relatedFiles": [],
      "diagram": "Optional mermaid diagram for this specific step"
    }
  ],
  "estimatedReadTime": 5
}
\`\`\`

Guidelines for diagrams:
- Include architectureDiagram if the PR involves multiple components or has a clear flow
- Use mermaid flowchart/graph syntax: graph TD, flowchart LR, sequenceDiagram, etc.
- Keep diagrams simple and focused on the key changes
- Escape newlines as \\n in the JSON string`;
  }

  private parseToolInput(input: any, filePath: string): AIReviewComment | null {
    try {
      return {
        id: uuidv4(),
        filePath,
        startLine: input.startLine || 1,
        endLine: input.endLine || input.startLine || 1,
        severity: input.severity || 'minor',
        category: input.category || 'other',
        title: input.title || 'Review Comment',
        content: input.content || '',
        suggestedFix: input.suggestedFix,
        confidence: input.confidence || 0.7,
        published: false,
      };
    } catch {
      return null;
    }
  }

  private parseReviewResponse(response: string, filePath: string): AIReviewComment[] {
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                        response.match(/(\{[\s\S]*"comments"[\s\S]*\})/);

      if (!jsonMatch) {
        return [];
      }

      const parsed = JSON.parse(jsonMatch[1]);
      const comments = parsed.comments || [parsed];

      return comments
        .filter((c: any) => c.content || c.title)
        .map((c: any) => ({
          id: uuidv4(),
          filePath,
          startLine: c.startLine || 1,
          endLine: c.endLine || c.startLine || 1,
          severity: c.severity || 'minor',
          category: c.category || 'other',
          title: c.title || 'Review Comment',
          content: c.content || '',
          suggestedFix: c.suggestedFix,
          confidence: c.confidence || 0.7,
          published: false,
        }));
    } catch (error) {
      console.error('Failed to parse Claude review response:', error);
      return [];
    }
  }

  private parseWalkthroughResponse(response: string, prId: number): CodeWalkthrough {
    try {
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                        response.match(/(\{[\s\S]*"steps"[\s\S]*\})/);

      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[1]);

      return {
        id: uuidv4(),
        prId,
        summary: parsed.summary || 'Code changes walkthrough',
        architectureDiagram: parsed.architectureDiagram || undefined,
        steps: (parsed.steps || []).map((s: any, i: number) => ({
          stepNumber: s.stepNumber || i + 1,
          title: s.title || `Step ${i + 1}`,
          description: s.description || '',
          filePath: s.filePath || '',
          startLine: s.startLine || 1,
          endLine: s.endLine || s.startLine || 1,
          relatedFiles: s.relatedFiles || [],
          diagram: s.diagram || undefined,
        })),
        totalSteps: parsed.steps?.length || 0,
        estimatedReadTime: parsed.estimatedReadTime || 5,
      };
    } catch (error) {
      console.error('Failed to parse Claude walkthrough response:', error);
      return {
        id: uuidv4(),
        prId,
        summary: 'Failed to generate walkthrough',
        steps: [],
        totalSteps: 0,
        estimatedReadTime: 0,
      };
    }
  }
}
