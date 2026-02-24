/**
 * DGrep Analysis Workspace
 * Creates workspace folders with CSV data, query tool, and prompt files
 * for AI agent-based log analysis.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { getQueryToolSource } from './dgrep-query-tool.js';
import { encode as toonEncode, decode as toonDecode } from '@toon-format/toon';

const TASKDOCK_DIR = path.join(os.homedir(), '.taskdock');
const DGREP_ANALYSIS_DIR = path.join(TASKDOCK_DIR, 'dgrep', 'analysis');

export interface AnalysisWorkspace {
  basePath: string;
  dataPath: string;
  queryToolPath: string;
  kqlGuidelinesPath: string;
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
  analysisLevel?: 'quick' | 'standard' | 'detailed' | 'custom';
  customPrompt?: string;
  sourceRepoPath?: string;
  serviceName?: string;
  serviceDescription?: string;
  serverQuery?: string;
  clientQuery?: string;
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

  // Write KQL guidelines
  const kqlGuidelinesPath = path.join(basePath, 'kql-guidelines.md');
  fs.writeFileSync(kqlGuidelinesPath, getKqlGuidelines(), 'utf-8');

  // Write metadata
  const metadataPath = path.join(basePath, 'metadata.toon');
  fs.writeFileSync(metadataPath, toonEncode({ ...metadata, columns }), 'utf-8');

  return {
    basePath,
    dataPath,
    queryToolPath,
    kqlGuidelinesPath,
    metadataPath,
    summaryOutputPath: path.join(basePath, 'summary-output.json'),
    rcaOutputPath: path.join(basePath, 'rca-output.json'),
    promptPath: path.join(basePath, 'prompt.md'),
  };
}

export function buildSummaryPrompt(workspace: AnalysisWorkspace, sourceRepoPath?: string): string {
  const meta = toonDecode(fs.readFileSync(workspace.metadataPath, 'utf-8')) as any;

  const ws = workspace.basePath.replace(/\\/g, '/');
  const outputPath = workspace.summaryOutputPath.replace(/\\/g, '/');

  const serviceName = meta.serviceName || '';
  const serviceDesc = meta.serviceDescription || '';

  return `# Log Analysis

Analyze ${meta.totalRows} rows of service logs from ${meta.namespace} (${meta.events.join(', ')}).
Time range: ${meta.startTime} to ${meta.endTime}.
Endpoint: ${meta.endpoint}
${serviceName ? `Service: **${serviceName}**${serviceDesc ? ` — ${serviceDesc}` : ''}` : ''}

## Workspace: ${ws}
- \`data.csv\` — Log data with \`_row\` column. **Do NOT read end-to-end.** Use the query tool.
- \`query-logs.mjs\` — CSV-aware search tool (run via Bash).
- \`metadata.toon\` — Query parameters.
${sourceRepoPath ? `
## Source Code Repository
${serviceName ? `This is the source code for **${serviceName}**.` : 'Source code for this service is available.'}
Repository path: \`${sourceRepoPath}\`

Subagents should use this path as their working directory to read source files, trace error origins, understand retry/fallback logic, and correlate log messages with code paths.
` : ''}
## Process — Follow these 4 phases in order. Use TaskCreate to track progress.

### Phase 1: Extract Errors

Create a task: "Extract errors and warnings from logs"

Launch a subagent (Task tool, subagent_type "general-purpose") with this instruction:

> You are extracting errors and warnings from log data.
>
> **Workspace:** \`${ws}\`
>
> 1. Run \`node ${ws}/query-logs.mjs --head 3\` to see column names and sample rows.
> 2. Use the query tool to find all errors, exceptions, failures, and warnings:
>    - \`node ${ws}/query-logs.mjs "Error" --limit 200\`
>    - \`node ${ws}/query-logs.mjs "exception|fail|timeout|retry|refused|exceeded|fatal|unreachable|5[0-9][0-9]" --limit 200\`
>    - Search for whatever else seems relevant based on the columns you see.
> 3. Write ALL found error/warning rows to \`${ws}/errors-extracted.md\` — one entry per row with its row number, timestamp, severity, and full message.

Wait for it to finish. Mark the task completed.

### Phase 2: Categorize

Create a task: "Categorize errors into groups"

Launch a subagent (Task tool, subagent_type "general-purpose") with this instruction:

> Read \`${ws}/errors-extracted.md\`. Group similar errors together — same root message template but different IDs/timestamps/line numbers count as one group.
>
> Write \`${ws}/error-categories.md\` with this format — each category gets an unchecked checkbox:
>
> - [ ] **1. [short description]** (N occurrences, rows: X, Y, Z)
>   Sample: [one representative message]
>
> - [ ] **2. [short description]** (N occurrences, rows: X, Y, Z)
>   Sample: [one representative message]
>
> Order by likely severity (most concerning first). Mark obvious noise as "(likely noise)" but leave real investigation to the next phase.

Wait for it to finish. Read \`${ws}/error-categories.md\`. Create a task for each category: "Investigate: [category description]". Mark the categorize task completed.

### Phase 3: Investigate (parallel subagents)
${meta.analysisLevel === 'quick' ? `
**QUICK MODE:** From the categorized list, pick the top 3-5 categories most likely to be user-impacting — things like retry exhaustion, terminal HTTP errors, unhandled exceptions, timeouts, service unavailable. Skip obvious noise (library logging, auth refreshes, health checks). Only launch subagents for your selected categories.
` : meta.analysisLevel === 'standard' ? `
**STANDARD MODE:** From the categorized list, pick the top 5-10 categories that are most likely to matter — real failures first, then warnings that could indicate degradation. Skip categories that are clearly noise (verbose library logging, routine auth refreshes). Launch subagents for your selected categories.
` : meta.analysisLevel === 'custom' && meta.customPrompt ? `
**CUSTOM FOCUS:** The user wants you to focus on: "${meta.customPrompt}". Prioritize investigating categories related to this concern. You may skip unrelated categories.
` : `
**DETAILED MODE:** Investigate ALL categories, including those marked as noise, to confirm they are truly benign.
`}
For EACH category you are investigating, launch a separate subagent (Task tool, subagent_type "general-purpose"). **Launch them all in parallel in a single message with multiple tool calls.**

Each subagent gets this instruction (fill in the specifics for that category):

> You are investigating one error category from a log analysis.
>
> **Category:** [name]
> **Occurrences:** [count]
> **Rows:** [row numbers from the category]
> **Sample:** [the sample message]
>
> **Workspace:** \`${ws}\`
> - Use \`node ${ws}/query-logs.mjs --row N --context 15\` to see what happened around each error.
> - Use \`node ${ws}/query-logs.mjs "some_id_from_the_row"\` to trace a request by its correlation/activity/trace ID.
> - Use Grep on \`${ws}/data.csv\` for complex searches.
${sourceRepoPath ? `> - Source code for ${serviceName ? `**${serviceName}**` : 'this service'} is at \`${sourceRepoPath}\`. Read source files to trace where the error originates and whether it is caught/retried/propagated.\n` : ''}
> **Determine:**
> 1. Is this a REAL failure or noise?
>    - Retried and succeeded → noise
>    - Retries exhausted / max attempts exceeded → REAL failure
>    - Auth error + token refresh + success → noise
>    - HTTP 5xx as the final response with no recovery → REAL failure
>    - High-frequency library logging → usually noise
> 2. What is the root cause?
> 3. What is the user/service impact?
> 4. What should be done about it?
>
> Write your detailed findings to \`${ws}/investigation-[N].md\` where N is the category number.
> Then edit \`${ws}/error-categories.md\` to check off this category: change \`- [ ]\` to \`- [x]\` for category [N].

After all subagents complete, read \`${ws}/error-categories.md\` and verify all checkboxes are checked. Mark each investigation task as completed.

### Phase 4: Synthesize report

Create a task: "Write final analysis report"

Read all \`${ws}/investigation-*.md\` files. Synthesize into the final JSON report.

Write to: \`${outputPath}\`

\`\`\`json
{
  "issues": [
    {
      "id": "issue-1",
      "title": "Short issue description",
      "severity": "critical|error|warning|info",
      "occurrences": 5,
      "briefRootCause": "1-2 sentence explanation of why this happened",
      "detailedAnalysisPath": "${ws}/investigation-1.md"
    }
  ],
  "errorBreakdown": [
    { "errorType": "ErrorName", "count": 48, "severity": "critical|error|warning|info", "sampleMessage": "Example message" }
  ],
  "topPatterns": [
    { "pattern": "description", "count": 100, "trend": "increasing|stable|decreasing", "firstSeen": "ISO date", "lastSeen": "ISO date", "percentage": 12.5 }
  ],
  "timeCorrelations": [
    { "description": "Error spike at 14:32 UTC", "startTime": "ISO date", "endTime": "ISO date", "affectedRows": 25 }
  ],
  "narrative": "The story of what ACTUALLY happened — lead with real issues, explain what is noise and why, be specific about impact",
  "recommendations": ["specific actionable next steps"],
  "totalRowsAnalyzed": ${meta.totalRows},
  "timeRange": { "start": "${meta.startTime}", "end": "${meta.endTime}" }
}
\`\`\`

The \`issues\` array should have one entry per investigated category from Phase 3. Use the investigation-N.md file path as \`detailedAnalysisPath\`.

## Severity Guide
- **critical**: Confirmed user-facing outage or data loss
- **error**: Real failures that affected functionality
- **warning**: Issues that could escalate
- **info**: Logged as errors but confirmed harmless

If any investigation found retry exhaustion or terminal failures, the assessment cannot be "no issues found."`;
}

export function buildRCAPrompt(
  workspace: AnalysisWorkspace,
  targetRow: Record<string, any>,
  targetIndex: number,
  sourceRepoPath?: string
): string {
  const meta = toonDecode(fs.readFileSync(workspace.metadataPath, 'utf-8')) as any;
  const serviceName = meta.serviceName || '';
  const serviceDesc = meta.serviceDescription || '';

  return `# Root Cause Analysis

Investigate a specific log entry and trace what caused it.
${serviceName ? `Service: **${serviceName}**${serviceDesc ? ` — ${serviceDesc}` : ''}` : ''}

## Files in ${workspace.basePath}
- \`data.csv\` — Full log data with \`_row\` column for line numbers. Use the query tool, not sequential reading.
- \`query-logs.mjs\` — CSV-aware search tool.
- \`metadata.toon\` — Query context.
${sourceRepoPath ? `
## Source Code Repository
${serviceName ? `This is the source code for **${serviceName}**.` : 'Source code for this service is available.'}
Repository path: \`${sourceRepoPath}\`

Find the code that emits this log message, trace its callers, understand retry/fallback logic.
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

export function getKqlGuidelines(): string {
  return `# KQL Reference for DGrep

KQL is the query language used in DGrep. In a client query, \`source\` represents the data produced by the server query.

## Example

\`\`\`
source
| where ActivityId == "383112e4-a7a8-4b94-a701-4266dfc18e41"
| project PreciseTimeStamp, Message
\`\`\`

## Tabular Operators
- \`where\` — Filter rows
- \`project\` — Select/rename columns
- \`project-away\` — Remove columns
- \`project-rename\` — Rename columns
- \`extend\` — Add computed columns
- \`summarize\` — Aggregate (count, avg, sum, min, max, dcount, etc.)
- \`order\` / \`sort\` — Sort rows
- \`limit\` / \`take\` — Limit row count
- \`parse\` — Extract fields from strings
- \`join\` — Inner join only: \`| join kind=inner (...) on Key\`
- \`print\` — Produce a single row
- \`mvexpand\` — Expand dynamic arrays (use \`mvexpand\`, not \`mv-expand\`)
- \`columnifexists\` — Safe column reference (use \`columnifexists\`, not \`column_ifexists\`)

## String Operators
- \`==\`, \`!=\`, \`=~\`, \`!~\`
- \`contains\`, \`!contains\`, \`contains_cs\`, \`!contains_cs\`
- \`startswith\`, \`!startswith\`, \`startswith_cs\`, \`!startswith_cs\`
- \`endswith\`, \`!endswith\`, \`endswith_cs\`, \`!endswith_cs\`
- \`matches regex\`
- \`in\`, \`!in\`

## Aggregation Functions
\`count()\`, \`countif()\`, \`avg()\`, \`sum()\`, \`min()\`, \`max()\`,
\`dcount()\` (100% accurate, no Accuracy arg), \`dcountif()\`,
\`makeset()\`, \`percentile()\`, \`any()\` (single arg only)

## Scalar Functions
- **String:** \`strlen\`, \`substring\`, \`indexof\`, \`split\`, \`strcat\`, \`strcat_delim\`, \`tolower\`, \`toupper\`, \`extract\`, \`extractall\` (not extract_all), \`countof\`, \`isempty\`, \`isnotempty\`, \`parse_json\`, \`parse_xml\`, \`base64_encodestring\` (not base64_encode_tostring), \`base64_decodestring\` (not base64_decode_tostring), \`hash_sha256\`
- **DateTime:** \`ago\`, \`now\`, \`datetime_add\`, \`datetime_diff\`, \`datetime_part\`, \`dayofmonth\`, \`dayofweek\`, \`dayofyear\`, \`getmonth\`, \`getyear\`, \`hourofday\`, \`startofday\`, \`startofmonth\`, \`startofweek\`, \`startofyear\`, \`endofday\`, \`endofmonth\`, \`endofweek\`, \`endofyear\`, \`weekofyear\`, \`make_datetime\`, \`make_timespan\`, \`todatetime\`, \`totimespan\`
- **Conversion:** \`tobool\`, \`todatetime\`, \`todouble\`/\`toreal\`, \`toguid\`, \`toint\`, \`tolong\`, \`tostring\`, \`totimespan\`
- **Math:** \`abs\`, \`bin\`/\`floor\`, \`ceiling\`, \`exp\`, \`exp2\`, \`exp10\`, \`log\`, \`log2\`, \`log10\`, \`pow\`, \`round\`, \`sign\`
- **Conditional:** \`case\`, \`iif\`, \`max_of\`, \`min_of\`
- **Dynamic:** \`array_concat\`, \`array_length\`, \`pack_array\`, \`pack\`, \`parse_json\`, \`zip\`
- **Type:** \`gettype\`, \`isnull\`, \`isnotnull\`

## let statements
\`\`\`
let threshold = 100;
source | where Duration > threshold
\`\`\`

## Key Differences from Kusto
- No \`dynamic({})\` literals — use \`parse_json('...')\` instead
- Only inner join supported
- Use \`mvexpand\` not \`mv-expand\`
- Use \`columnifexists\` not \`column_ifexists\`
- Use \`extractall\` not \`extract_all\`
- Use \`base64_encodestring\`/\`base64_decodestring\` not \`base64_encode_tostring\`/\`base64_decode_tostring\`
- \`dcount\` is always 100% accurate (no Accuracy argument)
- \`any()\` supports only one argument
`;
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}
