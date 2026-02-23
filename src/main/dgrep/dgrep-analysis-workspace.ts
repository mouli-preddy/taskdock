/**
 * DGrep Analysis Workspace
 * Creates workspace folders with CSV data, patterns, metadata, and prompt files
 * for AI agent-based log analysis.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const TASKDOCK_DIR = path.join(os.homedir(), '.taskdock');
const DGREP_ANALYSIS_DIR = path.join(TASKDOCK_DIR, 'dgrep', 'analysis');

export interface AnalysisWorkspace {
  basePath: string;
  dataPath: string;
  patternsPath: string;
  metadataPath: string;
  summaryOutputPath: string;
  rcaOutputPath: string;
  promptPath: string;
}

export interface AnalysisMetadata {
  endpoint: string;
  namespace: string;
  events: string[];
  startTime: string;
  endTime: string;
  totalRows: number;
}

export function createAnalysisWorkspace(
  sessionId: string,
  columns: string[],
  rows: Record<string, any>[],
  patterns: any[],
  metadata: AnalysisMetadata
): AnalysisWorkspace {
  const basePath = path.join(DGREP_ANALYSIS_DIR, sessionId);
  fs.mkdirSync(basePath, { recursive: true });

  // Write CSV
  const dataPath = path.join(basePath, 'data.csv');
  const header = columns.map(c => csvEscape(c)).join(',');
  const csvRows = rows.map(row =>
    columns.map(c => csvEscape(String(row[c] ?? ''))).join(',')
  );
  fs.writeFileSync(dataPath, [header, ...csvRows].join('\n'), 'utf-8');

  // Write patterns
  const patternsPath = path.join(basePath, 'patterns.json');
  fs.writeFileSync(patternsPath, JSON.stringify(patterns, null, 2), 'utf-8');

  // Write metadata
  const metadataPath = path.join(basePath, 'metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify({ ...metadata, columns }, null, 2), 'utf-8');

  return {
    basePath,
    dataPath,
    patternsPath,
    metadataPath,
    summaryOutputPath: path.join(basePath, 'summary-output.json'),
    rcaOutputPath: path.join(basePath, 'rca-output.json'),
    promptPath: path.join(basePath, 'prompt.md'),
  };
}

export function buildSummaryPrompt(workspace: AnalysisWorkspace, sourceRepoPath?: string): string {
  const meta = JSON.parse(fs.readFileSync(workspace.metadataPath, 'utf-8'));

  return `# Log Analysis Task: Understand What Actually Happened

You are a senior on-call engineer analyzing DGrep logs from Microsoft Geneva. Your job is NOT to simply count errors — it is to figure out **what actually happened** and whether it matters.

## Critical Mindset

**Many log entries that look alarming are harmless.** Services routinely log errors for:
- Expected retry paths (transient network blips, token refreshes)
- Graceful degradation (fallback codepaths that work as designed)
- Noisy health checks or background tasks that fail without user impact
- Race conditions during startup/shutdown that self-resolve

**Your job is to separate signal from noise.** An error logged 500 times might be completely benign if it's a retry loop that always succeeds on the next attempt. Meanwhile, a single warning buried in the logs might indicate a real outage.

## Input Files (in ${workspace.basePath})
- \`data.csv\` — Log data with ${meta.totalRows} rows. Columns: ${meta.columns.join(', ')}
- \`patterns.json\` — Detected message patterns with frequency counts
- \`metadata.json\` — Query parameters (endpoint: ${meta.endpoint}, namespace: ${meta.namespace}, events: ${meta.events.join(', ')})
${sourceRepoPath ? `
## Source Code
The source code for this service is available in the current working directory (\`${sourceRepoPath}\`). **Use it.** Read source files to:
- Trace what code path produces each error message
- Understand if an error is caught and handled (retry, fallback, ignored)
- Determine if an error actually reaches users or silently resolves
- Map log messages to their call chains and understand the flow
- Use subagents (Task tool) to investigate multiple code paths in parallel when needed
` : ''}
## Analysis Process
1. **Read the data** — Read data.csv and patterns.json
2. **Build a timeline** — What happened chronologically? Identify phases (normal → degradation → failure → recovery)
3. **Trace each error pattern through the code** (if source available) — Does this error get retried? Does the caller handle it? Does it propagate to users?
4. **Classify real impact:**
   - **Real issues**: Errors that caused user-visible failures, data loss, or service degradation
   - **Noise**: Errors that are logged but handled, retried successfully, or have no downstream impact
5. **Identify the story** — What is the one-paragraph explanation a human on-call would give their manager?
6. **Write your analysis** as JSON to: \`${workspace.summaryOutputPath}\`

## Output JSON Schema
Write a JSON file with this exact structure:
\`\`\`json
{
  "errorBreakdown": [
    { "errorType": "ErrorName", "count": 48, "severity": "critical", "sampleMessage": "Example message" }
  ],
  "topPatterns": [
    { "pattern": "description", "count": 100, "trend": "increasing", "firstSeen": "ISO date", "lastSeen": "ISO date", "percentage": 12.5 }
  ],
  "timeCorrelations": [
    { "description": "Error spike at 14:32 UTC correlated with deployment", "startTime": "ISO date", "endTime": "ISO date", "affectedRows": 25 }
  ],
  "narrative": "Markdown summary: the story of what happened, what was real vs noise, and what actually needs attention",
  "recommendations": ["actionable recommendation with specific next steps"],
  "totalRowsAnalyzed": 1000,
  "timeRange": { "start": "ISO date", "end": "ISO date" }
}
\`\`\`

### Severity Guidelines
- **critical**: User-facing outage, data loss, or security breach — confirmed, not speculative
- **error**: Real failures that affected functionality but service partially continued
- **warning**: Degraded behavior or issues that could escalate if not addressed
- **info**: Logged as errors but confirmed harmless (retried, handled, no user impact)

**Default to lower severity unless you have evidence of real impact.** A high error count alone does NOT make something critical.`;
}

export function buildRCAPrompt(
  workspace: AnalysisWorkspace,
  targetRow: Record<string, any>,
  targetIndex: number,
  sourceRepoPath?: string
): string {
  return `# Log Analysis Task: Root Cause Analysis — Trace the Real Cause

You are a senior on-call engineer investigating a specific log entry. Your job is to figure out **what actually caused this** and **whether it actually matters**.

## Critical Mindset

**Don't take the error message at face value.** Many errors are:
- Symptoms of an upstream failure (the real cause is elsewhere)
- Expected behavior logged at the wrong level (e.g., "error" for a normal retry)
- Side effects of a legitimate operation (shutdown, deployment, config change)

**Trace backwards through the evidence.** The target row is where the user is looking, but the root cause is usually earlier in the timeline — a failed dependency, a bad config push, a resource exhaustion, etc.

## Input Files (in ${workspace.basePath})
- \`data.csv\` — Full log data with surrounding context
- \`patterns.json\` — Detected patterns
- \`metadata.json\` — Query context
${sourceRepoPath ? `
## Source Code
Source code is available in the current working directory. **Use it extensively:**
- Find the code that emits this log message — trace the method, its callers, its error handlers
- Determine if this error is caught, retried, or propagated
- Look at the retry/fallback logic — does the operation eventually succeed?
- Understand the service architecture from the code to trace cross-component failures
- Use subagents (Task tool) to investigate multiple source files or call chains in parallel
` : ''}
## Target Entry (Row ${targetIndex})
\`\`\`json
${JSON.stringify(targetRow, null, 2)}
\`\`\`

## Investigation Process
1. **Read surrounding logs** — Look at what happened in the 30-60 seconds before and after this entry
2. **Identify the causal chain** — What triggered what? Follow correlation IDs, request IDs, or timestamps
3. **Trace through code** (if available) — Find where this message is logged, what conditions produce it, what the caller does when it fails
4. **Assess real impact** — Did this error actually cause a user-visible problem, or was it handled gracefully?
5. **Determine root cause** — Not "X threw an exception" but "X threw because Y timed out because Z was overloaded due to W"
6. **Write your analysis** to: \`${workspace.rcaOutputPath}\`

## Output JSON Schema
\`\`\`json
{
  "rootCause": "The real root cause — not just the symptom, but WHY it happened and the full causal chain",
  "confidence": 0.85,
  "severity": "critical|high|medium|low",
  "evidenceTimeline": [
    { "timestamp": "2026-02-20T15:32:00Z", "description": "What happened and why it matters", "rowIndex": 145, "relevance": "direct|contributing|context" }
  ],
  "linkedRows": [1, 5, 12],
  "recommendation": "Specific, actionable next steps — not generic advice",
  "codeReferences": ["file.cs:123 - method that threw the error", "caller.cs:45 - retry logic that should have caught this"],
  "additionalFindings": "Was this a real issue or noise? Is it a one-off or systemic? What else should the engineer check?"
}
\`\`\`

### Severity Guidelines
- **critical**: Confirmed user-facing outage or data loss with evidence
- **high**: Real failure that degraded service, but not a full outage
- **medium**: Issue that needs fixing but didn't cause immediate user impact (or was retried successfully)
- **low**: Logged as error but actually benign — handled, retried, or expected behavior`;
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}
