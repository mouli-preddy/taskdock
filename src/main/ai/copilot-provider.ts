/**
 * GitHub Copilot AI Provider
 * Uses GitHub Copilot SDK for code review with seamless auth via GitHub CLI
 */

import { CopilotClient } from '@github/copilot-sdk';
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

interface CopilotConfig {
  model: 'claude-opus-4.6' | 'gpt-4o' | 'gpt-4' | 'gpt-5' | 'claude-3.5-sonnet';
  streaming: boolean;
}

// Singleton client instance
let clientInstance: CopilotClient | null = null;

async function getClient(): Promise<CopilotClient> {
  if (!clientInstance) {
    clientInstance = new CopilotClient();
    await clientInstance.start();
  }
  return clientInstance;
}

export async function stopCopilotClient(): Promise<void> {
  if (clientInstance) {
    await clientInstance.stop();
    clientInstance = null;
  }
}

export class CopilotProvider implements IAIProvider {
  readonly name: AIProvider = 'copilot';
  private config: CopilotConfig = {
    model: 'gpt-5',
    streaming: true,
  };

  configure(config: AIProviderConfig): void {
    if (config.model) {
      this.config.model = config.model as CopilotConfig['model'];
    }
  }

  async isAvailable(): Promise<AIProviderStatus> {
    try {
      const client = await getClient();

      // Create a test session to verify auth
      const session = await client.createSession({
        model: this.config.model,
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
      return { provider: 'copilot', available: true };
    } catch (error: any) {
      return {
        provider: 'copilot',
        available: false,
        error: error.message || 'Failed to connect to GitHub Copilot',
      };
    }
  }

  async *reviewChunk(
    chunk: ReviewChunk,
    context: ReviewContext
  ): AsyncGenerator<AIReviewComment> {
    const client = await getClient();
    const prompt = this.buildReviewPrompt(chunk, context);

    const session = await client.createSession({
      model: this.config.model,
      streaming: this.config.streaming,
      systemMessage: {
        mode: 'append',
        content: CODE_REVIEW_SYSTEM_PROMPT,
      },
    });

    try {
      const response = await new Promise<string>((resolve, reject) => {
        let fullContent = '';

        session.on((event: any) => {
          switch (event.type) {
            case 'assistant.message':
              fullContent = event.data.content;
              break;
            case 'assistant.message_delta':
              fullContent += event.data.deltaContent;
              break;
            case 'session.idle':
              resolve(fullContent);
              break;
            case 'session.error':
              reject(new Error(event.data.message));
              break;
          }
        });

        session.send({ prompt }).catch(reject);
      });

      // Parse the response
      const parsedComments = this.parseReviewResponse(response, chunk.filePath);
      for (const comment of parsedComments) {
        yield comment;
      }
    } finally {
      await session.destroy();
    }
  }

  async generateWalkthrough(
    files: FileChange[],
    prContext: PRContext
  ): Promise<CodeWalkthrough> {
    const client = await getClient();
    const prompt = this.buildWalkthroughPrompt(files, prContext);

    const session = await client.createSession({
      model: this.config.model,
      streaming: this.config.streaming, // Use same streaming setting as review
      systemMessage: {
        mode: 'append',
        content: WALKTHROUGH_SYSTEM_PROMPT,
      },
    });

    try {
      const response = await new Promise<string>((resolve, reject) => {
        let fullContent = '';

        session.on((event: any) => {
          switch (event.type) {
            case 'assistant.message':
              fullContent = event.data.content;
              break;
            case 'assistant.message_delta':
              fullContent += event.data.deltaContent;
              break;
            case 'session.idle':
              resolve(fullContent);
              break;
            case 'session.error':
              reject(new Error(event.data.message));
              break;
          }
        });

        session.send({ prompt }).catch(reject);
      });

      return this.parseWalkthroughResponse(response, prContext.prId);
    } finally {
      await session.destroy();
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

    return `${depthInstruction}
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

Analyze this code and respond with ONLY a JSON object (no other text). Use this exact format:
\`\`\`json
{
  "comments": [
    {
      "severity": "critical|major|minor|trivial",
      "category": "bug|security|performance|style|logic|compliance|recommendation|nitpick|other",
      "title": "Brief title",
      "content": "Detailed explanation",
      "startLine": 1,
      "endLine": 1,
      "suggestedFix": "optional code fix",
      "confidence": 0.9
    }
  ]
}
\`\`\`

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

    return `## PR Information
- Title: ${prContext.title}
- Description: ${prContext.description || 'No description provided'}
- Source: ${prContext.sourceBranch} -> ${prContext.targetBranch}
- Repository: ${prContext.repository}

## Changed Files (${files.length} total)
${filesSummary}

## Sample Changes
${diffSamples}

Generate a walkthrough for this PR. Respond with ONLY a JSON object in this exact format (no other text, no bash commands):
\`\`\`json
{
  "summary": "High-level summary of all changes in markdown format (2-3 sentences)",
  "architectureDiagram": "Optional mermaid diagram showing the flow/architecture of changes. Use flowchart TD or graph TD syntax. Example: graph TD\\n    A[Component] --> B[Service]\\n    B --> C[Database]",
  "estimatedReadTime": 5,
  "steps": [
    {
      "stepNumber": 1,
      "title": "Brief step title",
      "description": "Detailed explanation in markdown format. Can include **bold**, *italic*, and inline \`code\`.",
      "filePath": "/path/to/file",
      "startLine": 10,
      "endLine": 20,
      "relatedFiles": [],
      "diagram": "Optional mermaid diagram for this specific step if it helps explain the change"
    }
  ]
}
\`\`\`

Guidelines for diagrams:
- Include architectureDiagram if the PR involves multiple components or has a clear flow
- Use mermaid flowchart/graph syntax: graph TD, flowchart LR, sequenceDiagram, etc.
- Keep diagrams simple and focused on the key changes
- Escape newlines as \\n in the JSON string`;
  }

  private parseReviewResponse(response: string, filePath: string): AIReviewComment[] {
    try {
      // First try to find explicitly marked JSON blocks
      let jsonMatch = response.match(/```json\s*([\s\S]*?)```/);

      // Then try generic code blocks that look like JSON (start with {)
      if (!jsonMatch) {
        jsonMatch = response.match(/```\s*(\{[\s\S]*?\})\s*```/);
      }

      // Then try to find raw JSON object with "comments" property
      if (!jsonMatch) {
        jsonMatch = response.match(/(\{[\s\S]*"comments"[\s\S]*\})/);
      }

      if (!jsonMatch) {
        return [];
      }

      let jsonStr = jsonMatch[1].trim();

      // Try to fix truncated JSON by closing brackets
      const parsed = this.tryParseJSON(jsonStr);
      if (!parsed) {
        return [];
      }

      const comments = parsed.comments || [parsed];

      return comments
        .filter((c: any) => c && (c.title || c.content))
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
    } catch {
      return [];
    }
  }

  private tryParseJSON(jsonStr: string): any {
    // First try direct parse
    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      // Ignore, try fixes
    }

    // Try to fix truncated JSON
    let fixed = jsonStr;

    // Count open brackets
    const openBraces = (jsonStr.match(/\{/g) || []).length;
    const closeBraces = (jsonStr.match(/\}/g) || []).length;
    const openBrackets = (jsonStr.match(/\[/g) || []).length;
    const closeBrackets = (jsonStr.match(/\]/g) || []).length;

    // Add missing closing brackets
    for (let i = 0; i < openBrackets - closeBrackets; i++) {
      fixed += ']';
    }
    for (let i = 0; i < openBraces - closeBraces; i++) {
      fixed += '}';
    }

    // Try to parse again
    try {
      return JSON.parse(fixed);
    } catch (e) {
      // Try removing trailing partial content before last complete object/array
      const lastCompleteEnd = Math.max(
        fixed.lastIndexOf('}'),
        fixed.lastIndexOf(']')
      );
      if (lastCompleteEnd > 0) {
        try {
          return JSON.parse(fixed.substring(0, lastCompleteEnd + 1));
        } catch (e2) {
          // Give up
        }
      }
    }

    return null;
  }

  private parseWalkthroughResponse(response: string, prId: number): CodeWalkthrough {
    try {
      // First try to find explicitly marked JSON blocks
      let jsonMatch = response.match(/```json\s*([\s\S]*?)```/);

      // Then try generic code blocks that look like JSON (start with {)
      if (!jsonMatch) {
        jsonMatch = response.match(/```\s*(\{[\s\S]*?\})\s*```/);
      }

      // Then try to find raw JSON object with "steps" property
      if (!jsonMatch) {
        jsonMatch = response.match(/(\{[\s\S]*"steps"[\s\S]*\})/);
      }

      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = this.tryParseJSON(jsonMatch[1].trim());
      if (!parsed) {
        throw new Error('Could not parse JSON');
      }

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
    } catch {
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
