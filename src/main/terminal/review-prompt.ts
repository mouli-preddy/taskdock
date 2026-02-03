import type { ReviewPreset, WalkthroughPreset } from '../../shared/ai-types.js';

export interface ReviewPromptOptions {
  guid: string;
  contextPath: string;  // Where to READ files from (original/, modified/, context/)
  outputPath: string;   // Where to WRITE output (review.json, walkthrough.json)
  hasRepoContext: boolean;
  repoPath?: string;
  // Optional inline content to avoid file reads (prevents concurrency issues)
  inlineContext?: {
    prJson?: string;
    commentsJson?: string;
    filesJson?: string;
  };
  // Preset and custom prompt options
  preset?: ReviewPreset;
  customPrompt?: string;
  // Walkthrough-only mode options
  walkthroughOnly?: boolean;
  walkthroughPreset?: WalkthroughPreset;
  walkthroughPrompt?: string;
  // Generated file patterns (e.g., *.g.cs, *.json)
  generatedFilePatterns?: string[];
  // Enable WorkIQ to gather recent related information
  enableWorkIQ?: boolean;
}

/**
 * Prompt template for walkthrough-only mode (no review comments)
 */
function buildWalkthroughOnlyPrompt(
  contextSection: string,
  taskInstructions: string,
  contextPath: string,
  outputPath: string,
  guid: string,
  walkthroughPreset?: WalkthroughPreset,
  walkthroughPrompt?: string,
  enableWorkIQ?: boolean
): string {
  let prompt = `You are generating a code walkthrough for a Pull Request.
Your task is to create a detailed, step-by-step walkthrough of the changes.

${contextSection}

## Your Task
1. Review the PR to understand the purpose and context of the changes
2. Create a logical walkthrough that explains the changes step-by-step
3. Write your findings to the output file specified below

## Walkthrough Focus
Focus on:
1. Explaining what each change does
2. How the changes work together
3. The overall flow of the implementation
4. Key design decisions`;

  // Add walkthrough preset instructions
  if (walkthroughPreset?.customPrompt) {
    prompt += `\n\n## Walkthrough Preset: ${walkthroughPreset.name}\n${walkthroughPreset.customPrompt}`;
  }

  // Add custom walkthrough instructions
  if (walkthroughPrompt) {
    prompt += `\n\n## Additional Instructions\n${walkthroughPrompt}`;
  }

  // Add WorkIQ instructions when enabled
  if (enableWorkIQ) {
    prompt += `\n\n## WorkIQ Context Gathering
If workiq tool:ask_work_iq is available to you in this chat, use them to gather context from recent meetings related to this PR:
- Search for meeting discussions that relate to the changes being walked through
- Look for decisions or requirements discussed in meetings that provide context
- Find any mentioned concerns, edge cases, or considerations from team discussions
This additional context from meetings will help you provide more informed and relevant walkthrough explanations.`;
  }

  prompt += `

## Output Format

### ${outputPath}/walkthrough.json
Write a JSON file with this structure:
{
  "summary": "Brief overview of what this PR accomplishes",
  "architectureDiagram": "Optional mermaid diagram showing component relationships",
  "steps": [
    {
      "order": 1,
      "filePath": "/src/example.ts",
      "startLine": 10,
      "endLine": 25,
      "title": "Step title describing this part",
      "description": "Detailed explanation of what this code does and why"
    }
  ]
}

### ${outputPath}/${guid}.done.json (WRITE THIS LAST)
After completing walkthrough.json, write:
{
  "status": "complete",
  "reviewPath": null,
  "walkthroughPath": "./walkthrough.json",
  "filesReviewed": <number of files reviewed>,
  "commentsGenerated": 0,
  "error": null
}

## Important Rules
1. Write ${guid}.done.json ONLY after walkthrough.json is fully written
2. If you encounter an error that prevents completion, still write ${guid}.done.json with:
   { "status": "error", "error": "description of what went wrong", ... }
3. Create a logical flow that helps reviewers understand the PR
4. Include code snippets where helpful for understanding`;

  return prompt;
}

export function buildReviewPrompt(options: ReviewPromptOptions): string {
  const { guid, contextPath, outputPath, hasRepoContext, repoPath, inlineContext } = options;

  // Build context section - inline if provided, otherwise point to files
  let contextSection: string;
  if (inlineContext?.prJson && inlineContext?.commentsJson && inlineContext?.filesJson) {
    contextSection = `## PR Context (Inline)

### PR Metadata
\`\`\`json
${inlineContext.prJson}
\`\`\`

### Existing Comments
\`\`\`json
${inlineContext.commentsJson}
\`\`\`

### Changed Files List
\`\`\`json
${inlineContext.filesJson}
\`\`\`

### File Locations
- Original files: ${contextPath}/original/
- Modified files: ${contextPath}/modified/
- Diff files: ${contextPath}/diffs/
${hasRepoContext ? `- Full repository: ${repoPath} (use for deeper architectural context)` : ''}`;
  } else {
    contextSection = `## Context Location
- PR metadata: ${contextPath}/context/pr.json
- Existing comments: ${contextPath}/context/comments.json
- Changed files list: ${contextPath}/context/files.json
- Original files: ${contextPath}/original/
- Modified files: ${contextPath}/modified/
- Diff files: ${contextPath}/diffs/
${hasRepoContext ? `- Full repository: ${repoPath} (use for deeper architectural context)` : ''}`;
  }

  // === SKILL-EXTRACTABLE SECTION START ===
  const taskInstructions = inlineContext?.prJson
    ? `## Your Task
1. Review the PR metadata above to understand the purpose and context
2. Note the existing comments above to avoid duplicating feedback
3. Review each diff file in diffs/, comparing original vs modified versions
4. ${hasRepoContext ? 'Use the full repo to understand architectural impact and patterns' : 'Focus analysis on the changed files provided'}
5. Write your findings to the output files specified below`
    : `## Your Task
1. Read pr.json to understand the PR purpose and context
2. Read comments.json to see existing feedback (avoid duplicating)
3. Review each diff file in diffs/, comparing original vs modified versions
4. ${hasRepoContext ? 'Use the full repo to understand architectural impact and patterns' : 'Focus analysis on the changed files provided'}
5. Write your findings to the output files specified below`;

  // Handle walkthrough-only mode
  if (options.walkthroughOnly) {
    return buildWalkthroughOnlyPrompt(
      contextSection,
      taskInstructions,
      contextPath,
      outputPath,
      guid,
      options.walkthroughPreset,
      options.walkthroughPrompt,
      options.enableWorkIQ
    );
  }

  let reviewInstructions = `You are performing a code review for a Pull Request.

${contextSection}

${taskInstructions}

## Review Criteria
Evaluate each change for:
- **Security**: Injection vulnerabilities, authentication issues, data exposure, OWASP top 10
- **Bugs**: Logic errors, null/undefined handling, edge cases, race conditions
- **Performance**: N+1 queries, unnecessary loops, memory leaks, inefficient algorithms
- **Code Quality**: Readability, naming conventions, code duplication, SOLID principles
- **Testing**: Missing test coverage for new or changed code paths`;

  // Add preset instructions
  if (options.preset?.customPrompt) {
    reviewInstructions += `\n\n## Review Preset: ${options.preset.name}\n${options.preset.customPrompt}`;
  }

  // Add custom user instructions
  if (options.customPrompt) {
    reviewInstructions += `\n\n## Additional User Instructions\n${options.customPrompt}`;
  }

  // Add generated files note
  if (options.generatedFilePatterns && options.generatedFilePatterns.length > 0) {
    const patterns = options.generatedFilePatterns.join(', ');
    reviewInstructions += `\n\n## Generated Files Note
The following file patterns are auto-generated: ${patterns}
These files are typically machine-generated and should receive lighter review scrutiny. Focus on:
- Verifying the generation source/config is correct
- Checking for accidental manual modifications
- Ensuring generated output matches expected format
Skip detailed code quality reviews for these files unless they appear to have been manually modified.`;
  }

  // Add WorkIQ instructions when enabled
  if (options.enableWorkIQ) {
    reviewInstructions += `\n\n## WorkIQ Context Gathering
If workiq tool:ask_work_iq is available to you in this chat, use them to gather context from recent meetings related to this PR:
- Search for meeting discussions that relate to the changes being reviewed
- Look for decisions or requirements discussed in meetings that provide context
- Find any mentioned concerns, edge cases, or considerations from team discussions
This additional context from meetings will help you provide more informed and relevant review feedback.`;
  }

  reviewInstructions += `

## Output Format

### ${outputPath}/review.json
Write a JSON file with this structure:
{
  "comments": [
    {
      "id": "unique-uuid",
      "filePath": "/src/example.ts",
      "startLine": 42,
      "endLine": 45,
      "severity": "warning",
      "category": "security",
      "title": "Short summary of the issue",
      "content": "Detailed explanation in markdown format",
      "suggestedFix": "Optional code suggestion",
      "confidence": 0.85
    }
  ]
}

Severity values: "critical" | "warning" | "suggestion" | "praise"
Category values: "security" | "bug" | "performance" | "style" | "logic" | "testing"
Confidence: 0.0 to 1.0

### ${outputPath}/walkthrough.json
Write a JSON file with this structure:
{
  "summary": "Markdown overview of what this PR accomplishes",
  "architectureDiagram": "Optional mermaid diagram showing component relationships",
  "steps": [
    {
      "order": 1,
      "filePath": "/src/example.ts",
      "startLine": 10,
      "endLine": 25,
      "title": "Step title describing this part",
      "description": "Explanation of what this code does and why"
    }
  ]
}

### ${outputPath}/${guid}.done.json (WRITE THIS LAST)
After completing review.json and walkthrough.json, write:
{
  "status": "complete",
  "reviewPath": "./review.json",
  "walkthroughPath": "./walkthrough.json",
  "filesReviewed": <number of files reviewed>,
  "commentsGenerated": <number of comments>,
  "error": null
}

## Important Rules
1. Write ${guid}.done.json ONLY after review.json and walkthrough.json are fully written
2. If you encounter an error that prevents completion, still write ${guid}.done.json with:
   { "status": "error", "error": "description of what went wrong", ... }
3. Be thorough but concise - focus on actionable feedback
4. Praise good code patterns, not just problems
5. Consider the PR description context when reviewing`;
  // === SKILL-EXTRACTABLE SECTION END ===

  return reviewInstructions;
}
