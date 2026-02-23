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

  return `# Log Analysis Task: Summarize

You are analyzing DGrep logs from Microsoft Geneva.

## Input Files (in ${workspace.basePath})
- \`data.csv\` - Log data with ${meta.totalRows} rows. Columns: ${meta.columns.join(', ')}
- \`patterns.json\` - Detected message patterns with frequency counts
- \`metadata.json\` - Query parameters (endpoint: ${meta.endpoint}, namespace: ${meta.namespace}, events: ${meta.events.join(', ')})
${sourceRepoPath ? `\n## Source Code\nThe source code for this service is available in the current working directory (${sourceRepoPath}). You can read source files to understand log messages, trace error causes, and correlate log entries with code paths.\n` : ''}
## Task
1. Read data.csv to understand the log content
2. Read patterns.json for pre-detected patterns
3. Identify error/warning patterns, their frequency, and severity
4. Note time correlations (spikes, gaps, trends)
5. If source code is available, correlate errors with code
6. Write your analysis as JSON to: \`${workspace.summaryOutputPath}\`

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
    { "description": "Error spike at 14:32 UTC", "startTime": "ISO date", "endTime": "ISO date", "affectedRows": 25 }
  ],
  "narrative": "Markdown summary of findings...",
  "recommendations": ["actionable recommendation 1"],
  "totalRowsAnalyzed": 1000,
  "timeRange": { "start": "ISO date", "end": "ISO date" }
}
\`\`\`

Be thorough but concise. Focus on actionable insights.`;
}

export function buildRCAPrompt(
  workspace: AnalysisWorkspace,
  targetRow: Record<string, any>,
  targetIndex: number,
  sourceRepoPath?: string
): string {
  return `# Log Analysis Task: Root Cause Analysis

You are investigating a specific error in DGrep logs.

## Input Files (in ${workspace.basePath})
- \`data.csv\` - Full log data
- \`patterns.json\` - Detected patterns
- \`metadata.json\` - Query context
${sourceRepoPath ? `\n## Source Code\nSource code is available in the current working directory. Read relevant source files to trace the error.\n` : ''}
## Target Error (Row ${targetIndex})
\`\`\`json
${JSON.stringify(targetRow, null, 2)}
\`\`\`

## Task
1. Read the log data, focusing on entries around the target error
2. Trace what happened before and after this error
3. If source code is available, find the code that generated this error
4. Identify the root cause and contributing factors
5. Write your analysis to: \`${workspace.rcaOutputPath}\`

## Output JSON Schema
\`\`\`json
{
  "rootCause": "Clear explanation of root cause",
  "confidence": 0.85,
  "severity": "critical",
  "evidenceTimeline": [
    { "timestamp": "2026-02-20T15:32:00Z", "description": "What happened", "rowIndex": 145, "relevance": "direct" }
  ],
  "linkedRows": [1, 5, 12],
  "recommendation": "What to do about it",
  "codeReferences": ["file.cs:123 - method that threw the error"],
  "additionalFindings": "Extra context"
}
\`\`\``;
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}
