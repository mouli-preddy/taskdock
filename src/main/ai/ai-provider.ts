/**
 * AI Provider Interface
 * Common interface for AI code review providers (Claude, Copilot)
 */

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

export interface AIProviderConfig {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Interface that all AI providers must implement
 */
export interface IAIProvider {
  /** Provider identifier */
  readonly name: AIProvider;

  /**
   * Review a single chunk of code and yield comments as they are found
   * @param chunk - The code chunk to review
   * @param context - Context about the PR and file
   */
  reviewChunk(chunk: ReviewChunk, context: ReviewContext): AsyncGenerator<AIReviewComment>;

  /**
   * Generate a walkthrough for the entire PR
   * @param files - All files changed in the PR
   * @param prContext - Context about the PR
   */
  generateWalkthrough(files: FileChange[], prContext: PRContext): Promise<CodeWalkthrough>;

  /**
   * Check if this provider is available (authenticated, etc.)
   */
  isAvailable(): Promise<AIProviderStatus>;

  /**
   * Configure the provider with custom settings
   * @param config - Provider-specific configuration
   */
  configure(config: AIProviderConfig): void;
}

/**
 * System prompt for code review
 */
export const CODE_REVIEW_SYSTEM_PROMPT = `You are an expert code reviewer. Analyze the provided code changes and identify:

1. **Bugs**: Logic errors, potential runtime exceptions, incorrect behavior
2. **Security Issues**: SQL injection, XSS, authentication/authorization issues, sensitive data exposure
3. **Performance Problems**: N+1 queries, unnecessary iterations, memory leaks
4. **Code Quality**: Unclear naming, missing error handling, code duplication
5. **Good Practices**: Well-written code worth praising

For each issue found, respond with a JSON object in this exact format:
{
  "comments": [
    {
      "severity": "critical|warning|suggestion|praise",
      "category": "bug|security|performance|style|logic|other",
      "title": "Brief title (max 60 chars)",
      "content": "Detailed explanation of the issue",
      "startLine": <number>,
      "endLine": <number>,
      "suggestedFix": "Optional code suggestion",
      "confidence": <0-1>
    }
  ]
}

Guidelines:
- Be specific and actionable
- Reference line numbers from the diff
- Include code suggestions when helpful
- Use "praise" for well-written code
- Set confidence based on certainty (0.9+ for obvious issues, lower for potential issues)
- Focus on the most impactful issues`;

/**
 * System prompt for walkthrough generation
 */
export const WALKTHROUGH_SYSTEM_PROMPT = `You are an expert at explaining code changes. Create a guided walkthrough of the PR changes.

For each step, explain:
- What code is being changed
- Why this change is important
- How it relates to other changes

Respond with JSON in this format:
{
  "summary": "High-level summary of all changes (2-3 sentences)",
  "estimatedReadTime": <minutes>,
  "steps": [
    {
      "stepNumber": <number>,
      "title": "Brief step title",
      "description": "Detailed explanation of this change",
      "filePath": "/path/to/file",
      "startLine": <number>,
      "endLine": <number>,
      "codeSnippet": "Key code snippet",
      "relatedFiles": ["optional array of related file paths"]
    }
  ]
}

Guidelines:
- Order steps logically (dependencies first, then features)
- Keep descriptions clear for any developer
- Highlight architectural decisions
- Group related changes into single steps when appropriate`;

/**
 * Tool definition for structured review output (used by Claude)
 */
export const REVIEW_TOOL_DEFINITION = {
  name: 'submit_review_comment',
  description: 'Submit a code review comment for the analyzed code',
  input_schema: {
    type: 'object',
    properties: {
      severity: {
        type: 'string',
        enum: ['critical', 'warning', 'suggestion', 'praise'],
        description: 'Severity level of the comment',
      },
      category: {
        type: 'string',
        enum: ['bug', 'security', 'performance', 'style', 'logic', 'other'],
        description: 'Category of the issue',
      },
      title: {
        type: 'string',
        description: 'Brief title for the comment (max 60 characters)',
      },
      content: {
        type: 'string',
        description: 'Detailed explanation of the issue or praise',
      },
      startLine: {
        type: 'number',
        description: 'Starting line number in the diff',
      },
      endLine: {
        type: 'number',
        description: 'Ending line number in the diff',
      },
      suggestedFix: {
        type: 'string',
        description: 'Optional code suggestion to fix the issue',
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'Confidence level (0-1) in this assessment',
      },
    },
    required: ['severity', 'category', 'title', 'content', 'startLine', 'endLine', 'confidence'],
  },
};

/**
 * Detect programming language from file extension
 */
export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript/React',
    js: 'JavaScript',
    jsx: 'JavaScript/React',
    py: 'Python',
    rb: 'Ruby',
    java: 'Java',
    cs: 'C#',
    cpp: 'C++',
    c: 'C',
    go: 'Go',
    rs: 'Rust',
    swift: 'Swift',
    kt: 'Kotlin',
    scala: 'Scala',
    php: 'PHP',
    html: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    json: 'JSON',
    yaml: 'YAML',
    yml: 'YAML',
    xml: 'XML',
    sql: 'SQL',
    sh: 'Shell',
    bash: 'Bash',
    ps1: 'PowerShell',
    md: 'Markdown',
  };
  return langMap[ext] || 'Unknown';
}
