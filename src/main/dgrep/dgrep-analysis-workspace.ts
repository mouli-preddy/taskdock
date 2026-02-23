/**
 * DGrep Analysis Workspace
 * Creates workspace folders with CSV data, query tool, and prompt files
 * for AI agent-based log analysis.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { getQueryToolSource } from './dgrep-query-tool.js';

const TASKDOCK_DIR = path.join(os.homedir(), '.taskdock');
const DGREP_ANALYSIS_DIR = path.join(TASKDOCK_DIR, 'dgrep', 'analysis');

export interface AnalysisWorkspace {
  basePath: string;
  dataPath: string;
  queryToolPath: string;
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
  _patterns: any[],
  metadata: AnalysisMetadata
): AnalysisWorkspace {
  const basePath = path.join(DGREP_ANALYSIS_DIR, sessionId);
  fs.mkdirSync(basePath, { recursive: true });

  // Write CSV with _row column prepended
  const dataPath = path.join(basePath, 'data.csv');
  const allCols = ['_row', ...columns];
  const header = allCols.map(c => csvEscape(c)).join(',');
  const csvRows = rows.map((row, i) =>
    [String(i), ...columns.map(c => csvEscape(String(row[c] ?? '')))].join(',')
  );
  fs.writeFileSync(dataPath, [header, ...csvRows].join('\n'), 'utf-8');

  // Write query tool
  const queryToolPath = path.join(basePath, 'query-logs.mjs');
  fs.writeFileSync(queryToolPath, getQueryToolSource(), 'utf-8');

  // Write metadata
  const metadataPath = path.join(basePath, 'metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify({ ...metadata, columns }, null, 2), 'utf-8');

  return {
    basePath,
    dataPath,
    queryToolPath,
    metadataPath,
    summaryOutputPath: path.join(basePath, 'summary-output.json'),
    rcaOutputPath: path.join(basePath, 'rca-output.json'),
    promptPath: path.join(basePath, 'prompt.md'),
  };
}

export function buildSummaryPrompt(workspace: AnalysisWorkspace, sourceRepoPath?: string): string {
  const meta = JSON.parse(fs.readFileSync(workspace.metadataPath, 'utf-8'));

  return `# Log Analysis

Analyze ${meta.totalRows} rows of service logs from ${meta.namespace} (${meta.events.join(', ')}).
Time range: ${meta.startTime} to ${meta.endTime}.

## Files in ${workspace.basePath}
- \`data.csv\` — The log data with a \`_row\` column for line numbers. **Do NOT read this file end-to-end.** Use the query tool.
- \`query-logs.mjs\` — CSV-aware search tool. Use this to explore the data.
- \`metadata.json\` — Query parameters.
${sourceRepoPath ? `
## Source Code
Source code is at \`${sourceRepoPath}\` (current working directory). Read source files to trace error origins, understand retry/fallback logic, and determine if errors propagate to users. Use subagents (Task tool) for parallel code investigation if needed.
` : ''}
## How to Investigate

**Step 1: Understand the data shape.**
Run \`node query-logs.mjs --head 3\` to see column names and a few sample rows.

**Step 2: Find errors and warnings.**
Based on what you see in the columns, use the tool to search. Examples:
- \`node query-logs.mjs "Error" --count\`
- \`node query-logs.mjs "Warning" --count\`
- \`node query-logs.mjs "Error" --limit 30\` to see the actual error messages

**Step 3: Find operational issues.**
Search for things that indicate real failures:
- \`node query-logs.mjs "fail|exception|timeout|retry|refused|exceeded|fatal"\`
- Search for whatever else seems relevant based on what you see.

**Step 4: Investigate each interesting finding.**
- \`node query-logs.mjs --row N --context 10\` to see what happened before/after an error
- \`node query-logs.mjs "some_correlation_id"\` to trace a specific request
- Use Grep on data.csv for more complex searches if needed

**Step 5: Separate real failures from noise.**
- An error that was retried and succeeded = noise
- Retries exhausted / max attempts exceeded = real failure
- Auth errors followed by token refresh = noise
- HTTP 5xx as the final response = real failure
- High-frequency library logging at Error level = usually noise

**Step 6: Write your analysis** as JSON to: \`${workspace.summaryOutputPath}\`

## Output JSON Schema
\`\`\`json
{
  "errorBreakdown": [
    { "errorType": "ErrorName", "count": 48, "severity": "critical|error|warning|info", "sampleMessage": "Example message" }
  ],
  "topPatterns": [
    { "pattern": "description", "count": 100, "trend": "increasing|stable|decreasing", "firstSeen": "ISO date", "lastSeen": "ISO date", "percentage": 12.5 }
  ],
  "timeCorrelations": [
    { "description": "Error spike at 14:32 UTC", "startTime": "ISO date", "endTime": "ISO date", "affectedRows": 25 }
  ],
  "narrative": "The story of what happened — what was real vs noise, and what needs attention",
  "recommendations": ["specific actionable next steps"],
  "totalRowsAnalyzed": ${meta.totalRows},
  "timeRange": { "start": "${meta.startTime}", "end": "${meta.endTime}" }
}
\`\`\`

## Severity Guide
- **critical**: Confirmed user-facing outage or data loss
- **error**: Real failures that affected functionality
- **warning**: Issues that could escalate
- **info**: Logged as errors but confirmed harmless

If you find retry exhaustion or terminal failures, the assessment cannot be "no issues found."`;
}

export function buildRCAPrompt(
  workspace: AnalysisWorkspace,
  targetRow: Record<string, any>,
  targetIndex: number,
  sourceRepoPath?: string
): string {
  return `# Root Cause Analysis

Investigate a specific log entry and trace what caused it.

## Files in ${workspace.basePath}
- \`data.csv\` — Full log data with \`_row\` column for line numbers. Use the query tool, not sequential reading.
- \`query-logs.mjs\` — CSV-aware search tool.
- \`metadata.json\` — Query context.
${sourceRepoPath ? `
## Source Code
Source at current working directory. Find the code that emits this log message, trace its callers, understand retry/fallback logic.
` : ''}
## Target Entry (Row ${targetIndex})
\`\`\`json
${JSON.stringify(targetRow, null, 2)}
\`\`\`

## How to Investigate

1. **Get context:** Run \`node query-logs.mjs --row ${targetIndex} --context 15\` to see what happened around this entry.

2. **Trace the request:** Look for correlation IDs, request IDs, or activity IDs in the target row. Search for them: \`node query-logs.mjs "the_id_value"\`

3. **Find the cause:** The root cause is usually BEFORE the target entry — a failed dependency, a timeout, a bad request. Trace backwards.

4. **Check if it was handled:** Did retries succeed? Did a fallback kick in? Or did the error propagate to the user?

5. **Write your analysis** to: \`${workspace.rcaOutputPath}\`

## Output JSON Schema
\`\`\`json
{
  "rootCause": "WHY this happened — the full causal chain, not just the symptom",
  "confidence": 0.85,
  "severity": "critical|high|medium|low",
  "evidenceTimeline": [
    { "timestamp": "ISO date", "description": "what happened", "rowIndex": 0, "relevance": "direct|contributing|context" }
  ],
  "linkedRows": [1, 5, 12],
  "recommendation": "specific next steps",
  "codeReferences": ["file.cs:123 - relevant code"],
  "additionalFindings": "real issue or noise? one-off or systemic?"
}
\`\`\``;
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}
