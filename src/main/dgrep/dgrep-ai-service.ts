/**
 * DGrep AI Service
 * AI-powered log analysis using agent executor pattern.
 *
 * Summary and RCA: Workspace-based agent execution using Copilot SDK
 * CopilotClient (default) or Claude SDK query(). Writes data to workspace
 * files, launches agent with prompt, reads structured JSON output.
 *
 * NL-to-KQL, chat, anomaly detection: Lightweight CopilotClient sessions.
 * Default model: gpt-5.3-codex via Copilot SDK.
 */

import { EventEmitter } from 'node:events';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { encode as toonEncode, decode as toonDecode } from '@toon-format/toon';
import { CopilotClient } from '@github/copilot-sdk';
import {
  createAnalysisWorkspace,
  buildSummaryPrompt,
  buildRCAPrompt,
  type AnalysisMetadata,
  type AnalysisWorkspace,
} from './dgrep-analysis-workspace.js';
import { getDGrepService } from './dgrep-service.js';
import { resolveMemoryKey, readMemories, addMemory } from './dgrep-memory-service.js';
import { getLogger } from '../services/logger-service.js';
import { ScrubLayer } from './scrub-layer.js';
import type {
  DGrepAISummary,
  DGrepRootCauseAnalysis,
  DGrepAnomalyResult,
  DGrepChatMessage,
  DGrepChatEvent,
  DGrepNLToKQLResult,
} from '../../shared/dgrep-ai-types.js';

const LOG_CATEGORY = 'DGrepAIService';

// ==================== Lightweight System Prompts (kept for NL-to-KQL, anomaly, chat) ====================

const NL_TO_KQL_SYSTEM_PROMPT = `You are an expert at converting natural language queries into KQL (Kusto Query Language) for Geneva DGrep log searches.

The user will provide:
- A natural language description of what they want to find
- Available column names
- Sample rows to understand the data shape

Generate a KQL query that filters the source data. The base query is always \`source\`.
Common patterns:
- \`source | where Column contains "value"\`
- \`source | where PreciseTimeStamp between (datetime(start) .. datetime(end))\`
- \`source | summarize count() by Column\`
- \`source | where Column !contains "noise"\`
- \`source | sort by PreciseTimeStamp asc\`

Respond with ONLY a JSON object:
\`\`\`json
{
  "kql": "source | where ...",
  "explanation": "Brief explanation of what this query does"
}
\`\`\``;

const ANOMALY_SYSTEM_PROMPT = `You are an expert at detecting anomalies in Microsoft service logs from Geneva DGrep.

You will receive log rows with column names. Analyze them for anomalies:
1. **Timing anomalies** — Unusual gaps, bursts, or delays between events
2. **Frequency anomalies** — Sudden spikes or drops in event rates
3. **Content anomalies** — Unusual values, unexpected error codes, strange patterns
4. **Sequence anomalies** — Events out of expected order
5. **Missing data** — Expected events that are absent

Respond with ONLY a JSON object:
\`\`\`json
{
  "anomalyIndices": [0, 5, 12],
  "explanations": [
    { "rowIndex": 0, "reason": "Why this is anomalous", "anomalyType": "timing|frequency|content|sequence|missing", "severity": "high|medium|low" }
  ],
  "summary": "Brief overview of anomalies found"
}
\`\`\``;

const CHAT_SYSTEM_PROMPT = `You are an AI assistant specialized in analyzing Geneva DGrep service logs.

You have access to a log dataset that the user is currently viewing. The column names and a sample of the data will be provided.

Help the user understand their logs by:
- Answering questions about patterns, errors, and trends
- Suggesting KQL queries for filtering
- Explaining log entries and service behavior
- Identifying potential issues and root causes

Use markdown formatting for clarity. Be concise and actionable.
When referencing specific rows, mention their index number so the user can find them.`;

const IMPROVE_DISPLAY_SYSTEM_PROMPT = `You are an expert at analyzing log data and improving its display for readability.

You have tools to read and search a CSV log file. Use them to understand the data shape, column contents, and value patterns.

Your job is to return a JSON object that tells the UI:
1. Which columns to show, in what order (hide noisy/internal columns, prioritize useful ones)
2. For columns with complex/multi-line/long values, provide a JavaScript function that extracts the most useful single-line summary from the raw cell text.

The user sees ONE LINE per row in a table and needs to scan logs quickly. Your formatter must distill each cell into the most scannable single-line text possible.

Formatter function guidelines:
- The function receives the raw cell text as a string parameter named "text"
- Return a PLAIN TEXT string (NOT HTML) — a single line the user can scan at a glance
- Do NOT truncate or limit the output length — the UI handles overflow. Include all useful information.
- For the Message column (most important):
  - Extract the operation/method name from bracket prefixes like [ClassName,Method.cs(line) ...]
  - If there's an HTTP method+path+status, show: "GET /api/path → 200" or "POST /endpoint → 500 InternalServerError"
  - If there's an exception, show: "ExceptionType at ClassName.Method()"
  - Otherwise show: "OperationName: <key detail from the message>"
  - Strip GUIDs, correlation IDs, timestamps, and noise that repeats across rows
  - Include all meaningful content — do NOT cut off or add "..." unless the raw text is truly multi-line
- For GUIDs/correlation IDs: abbreviate to first 8 chars (e.g. "e7575c71…")
- For timestamps: show just the time portion "HH:MM:SS.mmm" (drop the date)
- Do NOT return HTML tags, do NOT return multi-line text
- Focus on what makes each row DIFFERENT from other rows — strip repetitive noise

Respond with ONLY a valid JSON object matching this schema:
\`\`\`json
{
  "columns": [
    { "name": "ColumnName", "visible": true, "order": 0, "width": 200 }
  ],
  "formatters": [
    { "column": "ColumnName", "description": "What this formatter does", "jsFunction": "function(text) { return text; }" }
  ]
}
\`\`\`

IMPORTANT:
- Include ALL columns in the columns array, even hidden ones (with visible: false)
- Order determines display position (0 = leftmost)
- Only provide formatters for columns that genuinely benefit from formatting
- Width is optional — omit if the default is fine`;

// ==================== Chat Session ====================

interface ChatQueryContext {
  endpoint: string;
  namespace: string;
  events: string[];
  startTime: string;
  endTime: string;
  serverQuery: string;
  clientQuery: string;
}

interface ChatSession {
  id: string;
  dgrepSessionId: string;
  workspacePath: string;
  sourceRepoPath: string | null;
  serviceName: string | null;
  queryContext: ChatQueryContext | null;
  memoryKey: string;
  // Claude SDK: message queue for multi-turn
  messageQueue: string[];
  messageReady: (() => void) | null;
  closed: boolean;
  // Copilot SDK fallback
  copilotSession: any | null;
  // Shared
  messages: DGrepChatMessage[];
  currentMessageId: string | null;
}

// ==================== Service ====================

export class DGrepAIService extends EventEmitter {
  private client: CopilotClient | null = null;
  private chatSessions = new Map<string, ChatSession>();
  private provider: 'claude-sdk' | 'copilot-sdk' = 'copilot-sdk';
  private sourceRepoPath: string | null = null;

  setProvider(provider: 'claude-sdk' | 'copilot-sdk'): void {
    this.provider = provider;
  }

  setSourceRepo(repoPath: string | null): void {
    this.sourceRepoPath = repoPath || null;
  }

  private async getClient(): Promise<CopilotClient> {
    if (!this.client) {
      this.client = new CopilotClient();
      await this.client.start();
    }
    return this.client;
  }

  // ==================== Summarize Logs (Agent Executor) ====================

  async summarizeLogs(
    sessionId: string,
    columns: string[],
    rows: Record<string, any>[],
    patterns: any[],
    metadata: AnalysisMetadata
  ): Promise<void> {
    const logger = getLogger();
    logger.info(LOG_CATEGORY, 'Starting log summarization', {
      sessionId, rowCount: rows.length, provider: this.provider,
    });

    try {
      // 1. Create workspace, write CSV + patterns + metadata
      const workspace = createAnalysisWorkspace(sessionId, columns, rows, patterns, metadata);

      // 2. Build prompt
      const prompt = buildSummaryPrompt(workspace, this.sourceRepoPath ?? undefined);
      fs.writeFileSync(workspace.promptPath, prompt, 'utf-8');

      // 3. Determine cwd (source repo or workspace)
      const cwd = this.sourceRepoPath || workspace.basePath;

      // 4. Execute with chosen provider
      if (this.provider === 'claude-sdk') {
        await this.executeWithClaude(sessionId, prompt, cwd, workspace.summaryOutputPath, 'summary');
      } else {
        // Copilot can't read files — build inline prompt with truncated data
        const inlinePrompt = this.buildCopilotInlinePrompt(columns, rows, patterns, metadata, 'summary');
        await this.executeWithCopilot(sessionId, inlinePrompt, cwd, workspace.summaryOutputPath, 'summary');
      }
    } catch (err: any) {
      logger.error(LOG_CATEGORY, 'Summarization failed', { sessionId, error: err?.message });
      this.emit('ai:summary-complete', { sessionId, error: err?.message || 'Summarization failed' });
    }
  }

  // ==================== Root Cause Analysis (Agent Executor) ====================

  async analyzeRootCause(
    sessionId: string,
    targetRow: Record<string, any>,
    targetIndex: number,
    contextRows: Record<string, any>[],
    columns: string[],
    metadata: AnalysisMetadata
  ): Promise<void> {
    const logger = getLogger();
    logger.info(LOG_CATEGORY, 'Starting root cause analysis', {
      sessionId, provider: this.provider,
    });

    try {
      // 1. Create workspace (reuse same session workspace if exists)
      const workspace = createAnalysisWorkspace(sessionId + '-rca', columns, contextRows, [], metadata);

      // 2. Build prompt
      const prompt = buildRCAPrompt(workspace, targetRow, targetIndex, this.sourceRepoPath ?? undefined);
      fs.writeFileSync(workspace.promptPath, prompt, 'utf-8');

      // 3. Determine cwd
      const cwd = this.sourceRepoPath || workspace.basePath;

      // 4. Execute with chosen provider
      if (this.provider === 'claude-sdk') {
        await this.executeWithClaude(sessionId, prompt, cwd, workspace.rcaOutputPath, 'rca');
      } else {
        // Copilot can't read files — build inline prompt with truncated data
        const inlinePrompt = this.buildCopilotRCAInlinePrompt(columns, contextRows, targetRow, targetIndex, metadata);
        await this.executeWithCopilot(sessionId, inlinePrompt, cwd, workspace.rcaOutputPath, 'rca');
      }
    } catch (err: any) {
      logger.error(LOG_CATEGORY, 'RCA failed', { sessionId, error: err?.message });
      this.emit('ai:rca-complete', { sessionId, error: err?.message || 'Root cause analysis failed' });
    }
  }

  // ==================== Improve Display (Agent Executor) ====================

  async improveDisplay(
    sessionId: string,
    columns: string[],
    rows: Record<string, any>[],
    metadata: AnalysisMetadata,
  ): Promise<void> {
    const logger = getLogger();
    logger.info(LOG_CATEGORY, 'Starting improve display analysis', {
      sessionId, rowCount: rows.length, provider: this.provider,
    });

    try {
      const workspace = createAnalysisWorkspace(sessionId + '-display', columns, rows, [], metadata);
      const outputPath = path.join(workspace.basePath, 'improve-display-output.json');

      if (this.provider === 'claude-sdk') {
        await this.executeImproveDisplayClaude(sessionId, workspace, outputPath);
      } else {
        await this.executeImproveDisplayCopilot(sessionId, workspace, outputPath);
      }
    } catch (err: any) {
      logger.error(LOG_CATEGORY, 'Improve display failed', { sessionId, error: err?.message });
      this.emit('ai:improve-display-complete', { sessionId, error: err?.message || 'Improve display analysis failed' });
    }
  }

  /** Read a slice of lines from a data file. Shared by Claude and Copilot tool handlers. */
  private readFileLines(filePath: string, offset = 0, limit = 200): string {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const start = offset;
    const end = Math.min(start + limit, lines.length);
    return `Lines ${start}-${end - 1} of ${lines.length} total:\n${lines.slice(start, end).join('\n')}`;
  }

  /** Search a data file for lines matching a regex. Shared by Claude and Copilot tool handlers. */
  private searchFileLines(filePath: string, pattern: string, maxResults = 50): string {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const regex = new RegExp(pattern, 'i');
    const matches: string[] = [];
    for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
      if (regex.test(lines[i])) {
        matches.push(`[line ${i}] ${lines[i]}`);
      }
    }
    return `${matches.length} matches for /${pattern}/i:\n${matches.join('\n')}`;
  }

  private async executeImproveDisplayClaude(
    sessionId: string,
    workspace: AnalysisWorkspace,
    outputPath: string,
  ): Promise<void> {
    const dataPath = workspace.dataPath.replace(/\\/g, '/');
    const outPath = outputPath.replace(/\\/g, '/');

    const prompt = `${IMPROVE_DISPLAY_SYSTEM_PROMPT}

## Workspace
- CSV data file: \`${dataPath}\`
- Write your JSON output to: \`${outPath}\`

## Instructions
1. Use the read_file tool to examine the CSV data. Start by reading the first 50-100 lines to understand columns and data shape.
2. If needed, use search_file to look for patterns in specific columns (e.g., multi-line content, HTTP status codes, JSON blobs).
3. Read more of the file if needed to understand value distributions.
4. Decide which columns to show/hide and their order.
5. For columns with complex values, write JavaScript formatter functions.
6. Write the final JSON to \`${outPath}\`.`;

    const mcpServer = createSdkMcpServer({
      name: 'dgrep-display',
      version: '1.0.0',
      tools: [
        tool(
          'read_file',
          'Read lines from the CSV data file. Use offset and limit to read in chunks.',
          {
            offset: z.number().optional().default(0).describe('Line number to start reading from (0-based)'),
            limit: z.number().optional().default(200).describe('Max number of lines to read'),
          },
          workspace.scrubLayer.wrapSdkToolHandler(async (args: { offset?: number; limit?: number }) => {
            try {
              const text = this.readFileLines(workspace.dataPath, args.offset, args.limit);
              return { content: [{ type: 'text' as const, text }] };
            } catch (err: any) {
              return { content: [{ type: 'text' as const, text: `Error: ${err?.message}` }], isError: true };
            }
          })
        ),
        tool(
          'search_file',
          'Search the CSV data file for lines matching a regex pattern.',
          {
            pattern: z.string().describe('Regex pattern to search for'),
            max_results: z.number().optional().default(50).describe('Max matching lines to return'),
          },
          workspace.scrubLayer.wrapSdkToolHandler(async (args: { pattern: string; max_results?: number }) => {
            try {
              const text = this.searchFileLines(workspace.dataPath, args.pattern, args.max_results);
              return { content: [{ type: 'text' as const, text }] };
            } catch (err: any) {
              return { content: [{ type: 'text' as const, text: `Error: ${err?.message}` }], isError: true };
            }
          })
        ),
      ],
    });

    const response = query({
      prompt,
      options: {
        model: 'opus',
        maxTurns: 20,
        cwd: workspace.basePath,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        mcpServers: { 'dgrep-display': mcpServer },
      },
    });

    for await (const message of response) {
      if (message.type === 'assistant') {
        const text = this.extractTextContent(message);
        if (text) {
          this.emit('ai:improve-display-progress', { sessionId, text });
        }
        const toolUses = this.extractToolUses(message);
        for (const t of toolUses) {
          const summary = this.summarizeToolUse(t);
          this.emit('ai:improve-display-progress', { sessionId, text: summary });
        }
      }
      if (message.type === 'result' && (message as any).is_error) {
        const errorMsg = (message as any).error || 'Agent execution failed';
        this.emit('ai:improve-display-complete', { sessionId, error: errorMsg });
        return;
      }
    }

    this.readAndEmitImproveDisplayOutput(sessionId, outputPath);
  }

  private async executeImproveDisplayCopilot(
    sessionId: string,
    workspace: AnalysisWorkspace,
    outputPath: string,
  ): Promise<void> {
    const client = await this.getClient();
    let errorEmitted = false;

    const session = await client.createSession({
      model: 'gpt-5.3-codex',
      streaming: true,
      systemMessage: {
        mode: 'append',
        content: IMPROVE_DISPLAY_SYSTEM_PROMPT,
      },
      tools: [
        {
          name: 'read_file',
          description: 'Read lines from the CSV data file. Use offset and limit to read in chunks.',
          parameters: {
            type: 'object',
            properties: {
              offset: { type: 'number', description: 'Line number to start from (0-based)', default: 0 },
              limit: { type: 'number', description: 'Max lines to read', default: 200 },
            },
          },
          handler: workspace.scrubLayer.wrapCopilotToolHandler(async (args: any) => {
            try {
              return this.readFileLines(workspace.dataPath, args.offset ?? 0, args.limit ?? 200);
            } catch (err: any) {
              return `Error: ${err?.message}`;
            }
          }),
        },
        {
          name: 'search_file',
          description: 'Search the CSV for lines matching a regex pattern.',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string', description: 'Regex pattern to search for' },
              max_results: { type: 'number', description: 'Max matches to return', default: 50 },
            },
            required: ['pattern'],
          },
          handler: workspace.scrubLayer.wrapCopilotToolHandler(async (args: any) => {
            try {
              return this.searchFileLines(workspace.dataPath, args.pattern, args.max_results ?? 50);
            } catch (err: any) {
              return `Error: ${err?.message}`;
            }
          }),
        },
      ],
    });

    let fullContent = '';

    await new Promise<void>((resolve) => {
      session.on((event: any) => {
        switch (event.type) {
          case 'assistant.message_delta': {
            const delta = event.data?.deltaContent || '';
            fullContent += delta;
            if (delta) this.emit('ai:improve-display-progress', { sessionId, text: delta });
            break;
          }
          case 'assistant.message': {
            fullContent = event.data?.content || fullContent;
            break;
          }
          case 'tool.execution_start': {
            const toolName = event.data?.toolName || event.data?.name || 'tool';
            this.emit('ai:improve-display-progress', { sessionId, text: `[Tool] ${toolName}` });
            break;
          }
          case 'tool.execution_end': {
            this.emit('ai:improve-display-progress', { sessionId, text: '[Tool done]' });
            break;
          }
          case 'session.idle': {
            session.destroy().catch(() => {});
            resolve();
            break;
          }
          case 'session.error': {
            const error = event.data?.message || 'Unknown error';
            errorEmitted = true;
            this.emit('ai:improve-display-complete', { sessionId, error });
            session.destroy().catch(() => {});
            resolve();
            break;
          }
        }
      });

      session.send({
        prompt: `Analyze the CSV data file at ${workspace.dataPath.replace(/\\/g, '/')} and provide display improvement recommendations. Use the read_file and search_file tools to explore the data. Return your final answer as the JSON object described in your instructions.`,
      }).catch((err: any) => {
        errorEmitted = true;
        this.emit('ai:improve-display-complete', { sessionId, error: err?.message || 'Send failed' });
        resolve();
      });
    });

    if (errorEmitted) return;

    if (fullContent) {
      const parsed = this.tryParseJSON(fullContent);
      if (parsed) {
        try { fs.writeFileSync(outputPath, JSON.stringify(parsed, null, 2), 'utf-8'); } catch { /* ignore */ }
      }
    }

    this.readAndEmitImproveDisplayOutput(sessionId, outputPath);
  }

  private readAndEmitImproveDisplayOutput(sessionId: string, outputPath: string): void {
    const logger = getLogger();
    try {
      if (!fs.existsSync(outputPath)) {
        this.emit('ai:improve-display-complete', { sessionId, error: 'Agent did not produce output' });
        return;
      }
      const raw = fs.readFileSync(outputPath, 'utf-8');
      const result = JSON.parse(raw);
      if (!Array.isArray(result?.columns) || !Array.isArray(result?.formatters)) {
        this.emit('ai:improve-display-complete', { sessionId, error: 'Invalid output format: missing columns or formatters array' });
        return;
      }

      // Compile and execute formatters on the backend (Node.js has no CSP restrictions)
      // Pre-format unique values per column and send a lookup map to the frontend
      const formattedLookup: Record<string, Record<string, string>> = {};
      const dgrepService = getDGrepService();
      const sessionResults = dgrepService.getResults(sessionId);
      const rows = sessionResults?.rows || [];

      for (const fmt of result.formatters) {
        try {
          // Extract function body
          let body = fmt.jsFunction.trim();
          const funcMatch = body.match(/^function\s*\([^)]*\)\s*\{([\s\S]*)\}$/);
          if (funcMatch) body = funcMatch[1];
          const fn = new Function('text', body) as (text: string) => string;

          // Build lookup: rawValue → formattedValue (deduplicated)
          const lookup: Record<string, string> = {};
          for (const row of rows) {
            const rawVal = String(row[fmt.column] ?? '');
            if (rawVal in lookup) continue; // already formatted this value
            try {
              lookup[rawVal] = fn(rawVal);
            } catch {
              lookup[rawVal] = rawVal; // fallback to raw on error
            }
          }
          formattedLookup[fmt.column] = lookup;
        } catch (err: any) {
          logger.warn(LOG_CATEGORY, `Failed to compile formatter for ${fmt.column}`, { error: err?.message });
        }
      }

      result.formattedLookup = formattedLookup;
      this.emit('ai:improve-display-complete', { sessionId, result });
      logger.info(LOG_CATEGORY, 'Improve display complete', {
        sessionId,
        formattedColumns: Object.keys(formattedLookup).length,
        totalUniqueValues: Object.values(formattedLookup).reduce((sum, m) => sum + Object.keys(m).length, 0),
      });
    } catch (err: any) {
      logger.error(LOG_CATEGORY, 'Failed to read improve display output', { sessionId, error: err?.message });
      this.emit('ai:improve-display-complete', { sessionId, error: `Failed to read output: ${err?.message}` });
    }
  }

  // ==================== Copilot Inline Prompts (Copilot can't read files) ====================

  private buildCopilotInlinePrompt(
    columns: string[],
    rows: Record<string, any>[],
    _patterns: any[],
    metadata: AnalysisMetadata,
    _taskType: string
  ): string {
    // Compute severity counts from ALL rows to give Copilot full picture
    const severityCounts: Record<string, number> = {};
    const errorRows: Array<Record<string, any> & { _idx: number }> = [];
    const sevCol = columns.find(c => /^severity/i.test(c)) || columns.find(c => /^level$/i.test(c));
    const msgCol = columns.find(c => /^message$/i.test(c)) || columns.find(c => /^msg$/i.test(c));

    for (let i = 0; i < rows.length; i++) {
      const sev = sevCol ? String(rows[i][sevCol] ?? '').toLowerCase() : '';
      severityCounts[sev] = (severityCounts[sev] || 0) + 1;
      if (sev === 'error' || sev === 'warning' || sev === 'critical' || sev === 'fatal') {
        errorRows.push({ ...rows[i], _idx: i });
      }
    }

    // Send error/warning rows (up to 100) + a sample of other rows (up to 200)
    const errorSample = errorRows.slice(0, 100);
    const otherSample = rows.slice(0, 200);
    const severityReport = Object.entries(severityCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  ${k || '(empty)'}: ${v}`)
      .join('\n');

    return `You are analyzing service logs. Separate real failures from noise.

## Context
- Namespace: ${metadata.namespace}, Events: ${metadata.events.join(', ')}
- Time: ${metadata.startTime} to ${metadata.endTime}
- Total rows: ${rows.length}

## Severity Distribution (computed from ALL ${rows.length} rows)
${severityReport}

## Columns
${columns.join(', ')}

## Error/Warning Rows (${errorSample.length} of ${errorRows.length} total)
${JSON.stringify(errorSample, null, 0)}

## Sample Rows (first ${otherSample.length})
${JSON.stringify(otherSample, null, 0)}

## Task
Analyze and respond with ONLY a JSON object:
\`\`\`json
{
  "errorBreakdown": [{ "errorType": "string", "count": 0, "severity": "critical|error|warning|info", "sampleMessage": "string" }],
  "topPatterns": [{ "pattern": "string", "count": 0, "trend": "increasing|stable|decreasing", "firstSeen": "ISO", "lastSeen": "ISO", "percentage": 0 }],
  "timeCorrelations": [{ "description": "string", "startTime": "ISO", "endTime": "ISO", "affectedRows": 0 }],
  "narrative": "What happened — real issues vs noise",
  "recommendations": ["actionable items"],
  "totalRowsAnalyzed": ${rows.length},
  "timeRange": { "start": "${metadata.startTime}", "end": "${metadata.endTime}" }
}
\`\`\``;
  }

  private buildCopilotRCAInlinePrompt(
    columns: string[],
    contextRows: Record<string, any>[],
    targetRow: Record<string, any>,
    targetIndex: number,
    metadata: AnalysisMetadata,
  ): string {
    const truncated = contextRows.slice(0, 200);

    return `You are an expert root cause analyst for Microsoft service logs from Geneva DGrep.

## Target Error (Row ${targetIndex})
\`\`\`json
${JSON.stringify(targetRow, null, 2)}
\`\`\`

## Context Rows (${truncated.length} rows)
Columns: ${columns.join(', ')}
${JSON.stringify(truncated, null, 0)}

## Query Context
- Namespace: ${metadata.namespace}, Events: ${metadata.events.join(', ')}
- Time: ${metadata.startTime} to ${metadata.endTime}

## Task
Perform root cause analysis. Respond with ONLY a JSON object:
\`\`\`json
{
  "rootCause": "Clear explanation",
  "confidence": 0.85,
  "severity": "critical|high|medium|low",
  "evidenceTimeline": [{ "timestamp": "ISO", "description": "string", "rowIndex": 0, "relevance": "direct|contributing|context" }],
  "linkedRows": [0],
  "recommendation": "What to do",
  "additionalFindings": "Extra context"
}
\`\`\``;
  }

  // ==================== Agent Executors ====================

  private async executeWithClaude(
    sessionId: string,
    prompt: string,
    cwd: string,
    outputPath: string,
    taskType: 'summary' | 'rca'
  ): Promise<void> {
    const logger = getLogger();
    logger.info(LOG_CATEGORY, 'Executing with Claude SDK', { sessionId, taskType, cwd });

    const response = query({
      prompt,
      options: {
        model: 'opus',
        maxTurns: 100,
        cwd,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      },
    });

    for await (const message of response) {
      if (message.type === 'assistant') {
        // Stream assistant text as progress
        const text = this.extractTextContent(message);
        if (text) {
          this.emit(`ai:${taskType}-progress`, { sessionId, text });
        }
        // Stream tool use with a short summary of what it's doing
        const toolUses = this.extractToolUses(message);
        for (const tool of toolUses) {
          const summary = this.summarizeToolUse(tool);
          this.emit(`ai:${taskType}-progress`, { sessionId, text: summary });
        }
      }
      if (message.type === 'result') {
        if (message.is_error) {
          const errorMsg = (message as any).error || 'Agent execution failed';
          logger.error(LOG_CATEGORY, 'Claude SDK error', { sessionId, error: errorMsg });
          this.emit(`ai:${taskType}-complete`, { sessionId, error: errorMsg });
          return;
        }
      }
    }

    // Read output JSON
    this.readAndEmitOutput(sessionId, outputPath, taskType);
  }

  private async executeWithCopilot(
    sessionId: string,
    prompt: string,
    _cwd: string,
    outputPath: string,
    taskType: 'summary' | 'rca'
  ): Promise<void> {
    const logger = getLogger();
    logger.info(LOG_CATEGORY, 'Executing with Copilot SDK', { sessionId, taskType });

    const client = await this.getClient();

    const session = await client.createSession({
      model: 'gpt-5.3-codex',
      streaming: true,
      systemMessage: {
        mode: 'append',
        content: `You are a log analysis agent. Follow the instructions exactly and respond with ONLY a valid JSON object as specified.`,
      },
    });

    let fullContent = '';

    await new Promise<void>((resolve) => {
      session.on((event: any) => {
        switch (event.type) {
          case 'assistant.message_delta': {
            const delta = event.data?.deltaContent || '';
            fullContent += delta;
            if (delta) this.emit(`ai:${taskType}-progress`, { sessionId, text: delta });
            break;
          }
          case 'assistant.message': {
            fullContent = event.data?.content || fullContent;
            break;
          }
          case 'tool.execution_start': {
            const toolName = event.data?.toolName || event.data?.name || 'tool';
            this.emit(`ai:${taskType}-progress`, { sessionId, text: `[Copilot tool] ${toolName}` });
            break;
          }
          case 'tool.execution_end': {
            this.emit(`ai:${taskType}-progress`, { sessionId, text: `[Tool done]` });
            break;
          }
          case 'session.idle': {
            session.destroy().catch(() => {});
            resolve();
            break;
          }
          case 'session.error': {
            const error = event.data?.message || 'Unknown error';
            this.emit(`ai:${taskType}-complete`, { sessionId, error });
            session.destroy().catch(() => {});
            resolve();
            break;
          }
        }
      });

      session.send({ prompt }).catch((err: any) => {
        this.emit(`ai:${taskType}-complete`, { sessionId, error: err?.message || 'Send failed' });
        resolve();
      });
    });

    // Copilot can't write files, so try to parse from response content
    if (fullContent) {
      const parsed = this.tryParseJSON(fullContent);
      if (parsed) {
        // Write the output so the pattern is consistent
        try {
          fs.writeFileSync(outputPath, JSON.stringify(parsed, null, 2), 'utf-8');
        } catch { /* ignore write errors */ }
      }
    }

    this.readAndEmitOutput(sessionId, outputPath, taskType);
  }

  private readAndEmitOutput(sessionId: string, outputPath: string, taskType: 'summary' | 'rca'): void {
    const logger = getLogger();

    try {
      if (!fs.existsSync(outputPath)) {
        logger.warn(LOG_CATEGORY, 'Output file not found', { outputPath, taskType });
        this.emit(`ai:${taskType}-complete`, { sessionId, error: 'Agent did not write output file' });
        return;
      }

      const raw = fs.readFileSync(outputPath, 'utf-8');
      const output = JSON.parse(raw);

      if (taskType === 'summary') {
        this.emit('ai:summary-complete', { sessionId, summary: output, raw });
      } else {
        this.emit('ai:rca-complete', { sessionId, analysis: output, raw });
      }

      logger.info(LOG_CATEGORY, `${taskType} complete`, { sessionId });
    } catch (err: any) {
      logger.error(LOG_CATEGORY, `Failed to read ${taskType} output`, { sessionId, error: err?.message });
      this.emit(`ai:${taskType}-complete`, { sessionId, error: `Failed to read output: ${err?.message}` });
    }
  }

  private extractTextContent(message: any): string {
    // SDK yields { type: 'assistant', message: { content: [...] } }
    const content = message.message?.content || message.content;
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('');
    }
    return '';
  }

  private extractToolUses(message: any): Array<{ name: string; input?: any }> {
    const content = message.message?.content || message.content;
    if (!content || !Array.isArray(content)) return [];
    return content
      .filter((c: any) => c.type === 'tool_use')
      .map((c: any) => ({ name: c.name || 'unknown', input: c.input }));
  }

  private summarizeToolUse(tool: { name: string; input?: any }): string {
    const inp = tool.input || {};
    switch (tool.name) {
      case 'Read':
        return `[Reading] ${inp.file_path || ''}`;
      case 'Write':
        return `[Writing] ${inp.file_path || ''}`;
      case 'Edit':
        return `[Editing] ${inp.file_path || ''}`;
      case 'Grep':
        return `[Searching] "${inp.pattern || ''}" ${inp.path ? 'in ' + inp.path : ''}`;
      case 'Glob':
        return `[Finding files] ${inp.pattern || ''}`;
      case 'Bash': {
        const cmd = String(inp.command || '').substring(0, 150);
        return `[Running] ${cmd}`;
      }
      case 'Task':
        return `[Launching subagent] ${inp.description || ''}`;
      default:
        return `[${tool.name}]`;
    }
  }

  // ==================== Natural Language to KQL (lightweight, no workspace) ====================

  async naturalLanguageToKQL(
    prompt: string,
    columns: string[],
    sampleRows: Record<string, any>[]
  ): Promise<DGrepNLToKQLResult> {
    const logger = getLogger();
    logger.info(LOG_CATEGORY, 'NL to KQL conversion', { prompt: prompt.substring(0, 100) });

    const client = await this.getClient();

    const fullPrompt = [
      `## Available Columns`,
      columns.join(', '),
      `\n## Sample Data (first 5 rows)`,
      JSON.stringify(sampleRows.slice(0, 5), null, 2),
      `\n## User Request`,
      prompt,
      `\nConvert this to a KQL query.`,
    ].join('\n');

    const session = await client.createSession({
      model: 'gpt-5.3-codex',
      streaming: false,
      systemMessage: {
        mode: 'append',
        content: NL_TO_KQL_SYSTEM_PROMPT,
      },
    });

    try {
      const response = await new Promise<string>((resolve, reject) => {
        let content = '';

        session.on((event: any) => {
          switch (event.type) {
            case 'assistant.message':
              content = event.data?.content || '';
              break;
            case 'assistant.message_delta':
              content += event.data?.deltaContent || '';
              break;
            case 'session.idle':
              resolve(content);
              break;
            case 'session.error':
              reject(new Error(event.data?.message || 'NL to KQL failed'));
              break;
          }
        });

        session.send({ prompt: fullPrompt }).catch(reject);
      });

      const parsed = this.tryParseJSON<DGrepNLToKQLResult>(response);
      if (parsed) {
        return parsed;
      }

      return { kql: response.trim(), explanation: 'Generated from natural language query' };
    } finally {
      await session.destroy();
    }
  }

  // ==================== Anomaly Detection (lightweight) ====================

  async detectAnomalies(
    sessionId: string,
    columns: string[],
    rows: Record<string, any>[]
  ): Promise<DGrepAnomalyResult | null> {
    const logger = getLogger();
    logger.info(LOG_CATEGORY, 'Starting anomaly detection', { sessionId, rowCount: rows.length });

    const client = await this.getClient();

    const limitedRows = rows.slice(0, 1000);

    const prompt = [
      `## Log Data`,
      `Columns: ${columns.join(', ')}`,
      `Total rows: ${rows.length} (analyzing first ${limitedRows.length})`,
      `\n## Rows (JSON)`,
      JSON.stringify(limitedRows.slice(0, 300), null, 0),
      limitedRows.length > 300 ? `\n... (${limitedRows.length - 300} more rows)` : '',
      `\nDetect anomalies in these logs.`,
    ].join('\n');

    const session = await client.createSession({
      model: 'gpt-5.3-codex',
      streaming: false,
      systemMessage: {
        mode: 'append',
        content: ANOMALY_SYSTEM_PROMPT,
      },
    });

    try {
      const response = await new Promise<string>((resolve, reject) => {
        let content = '';

        session.on((event: any) => {
          switch (event.type) {
            case 'assistant.message':
              content = event.data?.content || '';
              break;
            case 'assistant.message_delta':
              content += event.data?.deltaContent || '';
              break;
            case 'session.idle':
              resolve(content);
              break;
            case 'session.error':
              reject(new Error(event.data?.message || 'Anomaly detection failed'));
              break;
          }
        });

        session.send({ prompt }).catch(reject);
      });

      return this.tryParseJSON<DGrepAnomalyResult>(response);
    } finally {
      await session.destroy();
    }
  }

  // ==================== Chat Sessions ====================

  /** Shared setup for chat and learning sessions: create workspace, metadata, and ChatSession. */
  private initChatSession(
    chatSessionId: string,
    dgrepSessionId: string,
    workspaceId: string,
    columns: string[],
    rows: Record<string, any>[],
    sourceRepoPath?: string,
    serviceName?: string,
    queryContext?: ChatQueryContext,
  ): { ws: string; workspace: AnalysisWorkspace } {
    const metadata: AnalysisMetadata = {
      endpoint: queryContext?.endpoint || '',
      namespace: queryContext?.namespace || '',
      events: queryContext?.events || [],
      startTime: queryContext?.startTime || '',
      endTime: queryContext?.endTime || '',
      totalRows: rows.length,
      serverQuery: queryContext?.serverQuery,
      clientQuery: queryContext?.clientQuery,
    };
    const workspace = createAnalysisWorkspace(workspaceId, columns, rows, [], metadata);
    const ws = workspace.basePath.replace(/\\/g, '/');

    // Write chatSessionId into metadata so tools can read it
    const metaContent = toonDecode(fs.readFileSync(workspace.metadataPath, 'utf-8')) as Record<string, any>;
    metaContent.chatSessionId = chatSessionId;
    fs.writeFileSync(workspace.metadataPath, toonEncode(metaContent), 'utf-8');

    const chatSession: ChatSession = {
      id: chatSessionId,
      dgrepSessionId,
      workspacePath: ws,
      sourceRepoPath: sourceRepoPath || null,
      serviceName: serviceName || null,
      queryContext: queryContext || null,
      memoryKey: resolveMemoryKey(serviceName, queryContext?.namespace),
      messageQueue: [],
      messageReady: null,
      closed: false,
      copilotSession: null,
      messages: [],
      currentMessageId: null,
    };
    this.chatSessions.set(chatSessionId, chatSession);

    return { ws, workspace };
  }

  /** Create an initial assistant message placeholder for streaming responses. */
  private createAssistantPlaceholder(chatSessionId: string): void {
    const session = this.chatSessions.get(chatSessionId);
    if (!session) return;
    const assistantMsgId = uuidv4();
    session.currentMessageId = assistantMsgId;
    session.messages.push({
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      status: 'streaming',
    });
  }

  async createChatSession(
    dgrepSessionId: string,
    columns: string[],
    rows: Record<string, any>[],
    sourceRepoPath?: string,
    serviceName?: string,
    queryContext?: ChatQueryContext
  ): Promise<string> {
    const chatSessionId = uuidv4();
    const { ws } = this.initChatSession(
      chatSessionId, dgrepSessionId, `chat-${chatSessionId}`,
      columns, rows, sourceRepoPath, serviceName, queryContext,
    );

    if (this.provider === 'claude-sdk') {
      this.startClaudeChatSession(chatSessionId, ws, sourceRepoPath, serviceName, queryContext);
    } else {
      await this.startCopilotChatSession(chatSessionId, columns, rows);
    }

    getLogger().info(LOG_CATEGORY, 'Chat session created', {
      chatSessionId, dgrepSessionId, provider: this.provider, workspace: ws,
    });
    return chatSessionId;
  }

  private startClaudeChatSession(
    chatSessionId: string,
    ws: string,
    sourceRepoPath?: string,
    serviceName?: string,
    queryContext?: ChatQueryContext
  ): void {
    const initialPrompt = this.buildChatPrompt(ws, sourceRepoPath, serviceName, queryContext);
    this.launchClaudeStreamingSession(chatSessionId, initialPrompt, sourceRepoPath || ws);
  }

  /**
   * Shared launcher for Claude SDK streaming sessions (chat and learning).
   * Creates a message stream generator, MCP tool server, and processes the
   * response stream in the background, emitting chat events.
   */
  private launchClaudeStreamingSession(
    chatSessionId: string,
    initialPrompt: string,
    cwd: string,
  ): void {
    const self = this;

    // Async generator that yields the initial prompt, then waits for queued user messages
    async function* messageStream(): AsyncGenerator<any, void> {
      yield {
        type: 'user' as const,
        message: { role: 'user' as const, content: initialPrompt },
        session_id: '',
        parent_tool_use_id: null,
      };

      const session = self.chatSessions.get(chatSessionId);
      if (!session) return;

      while (!session.closed) {
        if (session.messageQueue.length === 0) {
          await new Promise<void>(resolve => { session.messageReady = resolve; });
          session.messageReady = null;
        }
        if (session.closed) break;

        const queued = session.messageQueue.splice(0);
        if (queued.length === 0) continue;

        yield {
          type: 'user' as const,
          message: { role: 'user' as const, content: queued.join('\n\n') },
          session_id: '',
          parent_tool_use_id: null,
        };
      }
    }

    const response = query({
      prompt: messageStream(),
      options: {
        model: 'opus',
        maxTurns: 200,
        cwd,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        mcpServers: { dgrep: this.createChatToolServer(chatSessionId) },
      },
    });

    this.processClaudeResponseStream(chatSessionId, response);
  }

  /** Process a Claude SDK response stream in the background, emitting chat events. */
  private processClaudeResponseStream(
    chatSessionId: string,
    response: AsyncIterable<any>,
  ): void {
    (async () => {
      try {
        for await (const message of response) {
          const session = this.chatSessions.get(chatSessionId);
          if (!session || session.closed) break;

          if (message.type === 'assistant') {
            const text = this.extractTextContent(message);
            if (text) {
              const msgId = session.currentMessageId;
              const currentMsg = session.messages.find(m => m.id === msgId);
              if (currentMsg) currentMsg.content += text;
              this.emitChatEvent({ chatSessionId, type: 'delta', messageId: msgId || undefined, deltaContent: text });
            }
            for (const t of this.extractToolUses(message)) {
              this.emitChatEvent({ chatSessionId, type: 'tool_call', toolName: this.summarizeToolUse(t) });
            }
          }

          if (message.type === 'result') {
            const s = this.chatSessions.get(chatSessionId);
            if (s) {
              const msgId = s.currentMessageId;
              const currentMsg = s.messages.find(m => m.id === msgId);
              if (currentMsg) currentMsg.status = 'complete';
              s.currentMessageId = null;
              this.emitChatEvent({ chatSessionId, type: 'idle', messageId: msgId || undefined });
            }
          }
        }
      } catch (err: any) {
        getLogger().error(LOG_CATEGORY, 'Claude stream error', { chatSessionId, error: err?.message });
        this.emitChatEvent({ chatSessionId, type: 'error', error: err?.message || 'Stream failed' });
      }
    })();
  }

  private async startCopilotChatSession(
    chatSessionId: string,
    columns: string[],
    rows: Record<string, any>[]
  ): Promise<void> {
    const client = await this.getClient();
    const sampleRows = rows.slice(0, 50);
    const contextInfo = [
      `\n## Current Log Dataset`,
      `Columns: ${columns.join(', ')}`,
      `Total rows: ${rows.length}`,
      `\n## Sample Rows (first 50)`,
      JSON.stringify(sampleRows, null, 0),
    ].join('\n');

    const self = this;
    const copilotChatSession = this.chatSessions.get(chatSessionId);
    const scrubLayer = copilotChatSession ? ScrubLayer.load(copilotChatSession.workspacePath) : ScrubLayer.createDefault();

    const session = await client.createSession({
      model: 'gpt-5.3-codex',
      streaming: true,
      systemMessage: {
        mode: 'append',
        content: CHAT_SYSTEM_PROMPT + contextInfo,
      },
      tools: [
        {
          name: 'run_client_query',
          description: `Execute a KQL client query against the full DGrep server results. Two modes:
- Silent (silent=true, default): runs in background without changing the user's UI. Use for your own exploration.
- Show (silent=false): updates the user's UI with the query results. Only use when the user asks to show/display results.
Both modes save filtered results to a CSV and return the path + line count.`,
          parameters: {
            type: 'object',
            properties: {
              kql: { type: 'string', description: 'The KQL query, e.g. "source | where Message contains \'error\'"' },
              silent: { type: 'boolean', description: 'If true (default), run in background without updating the UI. Set to false to update the user\'s UI with the query results.', default: true },
            },
            required: ['kql'],
          },
          handler: scrubLayer.wrapCopilotToolHandler(async (args: any) => {
            try {
              const result = await self.runChatClientQuery(chatSessionId, args.kql, args.silent ?? true);
              const mode = args.silent ? ' (silent — UI not updated)' : '';
              return `Client query completed. ${result.lineCount} lines filtered.${mode}\nCSV path: ${result.csvPath}`;
            } catch (err: any) {
              return `Client query failed: ${err?.message || String(err)}`;
            }
          }),
        },
        {
          name: 'read_memory',
          description: `Read saved memories/learnings about this service's logs. Returns all previously saved insights, patterns, corrections, and knowledge. IMPORTANT: Always call this via a subagent (Task tool) to filter the returned memories down to what is relevant for your current question.`,
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Optional: a topic or question to help the subagent filter relevant memories' },
            },
          },
          handler: scrubLayer.wrapCopilotToolHandler(async (_args: any) => {
            const session = self.chatSessions.get(chatSessionId);
            if (!session) return 'No session found.';
            const memories = readMemories(session.memoryKey);
            if (memories.length === 0) return 'No memories saved yet for this service.';
            return `${memories.length} memories for "${session.memoryKey}":\n\n${memories.map((m: string, i: number) => `${i + 1}. ${m}`).join('\n')}`;
          }),
        },
        {
          name: 'add_memory',
          description: `Save a learning or insight about this service's logs for future sessions. Use this to remember error patterns, user corrections, service-specific knowledge, thresholds, or any insight you'd want next time.`,
          parameters: {
            type: 'object',
            properties: {
              memory: { type: 'string', description: 'The learning/insight to save. Be specific and actionable.' },
            },
            required: ['memory'],
          },
          handler: scrubLayer.wrapCopilotToolHandler(async (args: any) => {
            const session = self.chatSessions.get(chatSessionId);
            if (!session) return 'No session found.';
            const result = addMemory(session.memoryKey, args.memory);
            if (!result.added) return 'Memory already exists (duplicate). Total: ' + result.total;
            return `Memory saved. Total memories for "${session.memoryKey}": ${result.total}`;
          }),
        },
      ],
    });

    const chatSession = this.chatSessions.get(chatSessionId);
    if (chatSession) chatSession.copilotSession = session;

    session.on((event: any) => {
      this.handleCopilotChatEvent(chatSessionId, event);
    });
  }

  private createChatToolServer(chatSessionId: string): ReturnType<typeof createSdkMcpServer> {
    const self = this;
    const chatSession = this.chatSessions.get(chatSessionId);
    const scrubLayer = chatSession ? ScrubLayer.load(chatSession.workspacePath) : ScrubLayer.createDefault();

    return createSdkMcpServer({
      name: 'dgrep',
      version: '1.0.0',
      tools: [
        tool(
          'run_client_query',
          `Execute a KQL client query against the full DGrep server results. Two modes:
- Silent (silent=true, default): runs the query in the background without changing the user's UI. Use for your own exploration.
- Show (silent=false): updates the user's UI with the query results. Only use when the user asks to show/display results.

Both modes save filtered results to a CSV and return the path + line count.
Read kql-guidelines.md in the workspace before writing KQL queries.`,
          {
            kql: z.string().describe('The KQL query to execute, e.g. "source | where Message contains \'error\'"'),
            silent: z.boolean().optional().default(true).describe('If true (default), run in background without updating the UI. Set to false to update the user\'s UI with the query results.'),
          },
          scrubLayer.wrapSdkToolHandler(async (args: { kql: string; silent?: boolean }) => {
            try {
              const result = await self.runChatClientQuery(chatSessionId, args.kql, args.silent ?? true);
              const mode = args.silent ? ' (silent — UI not updated)' : '';
              return {
                content: [{
                  type: 'text' as const,
                  text: `Client query completed. ${result.lineCount} lines filtered.${mode}\nCSV path: ${result.csvPath}`,
                }],
              };
            } catch (err: any) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `Client query failed: ${err?.message || String(err)}`,
                }],
                isError: true,
              };
            }
          })
        ),
        tool(
          'read_memory',
          `Read saved memories/learnings about this service's logs. Returns all previously saved insights, patterns, corrections, and knowledge.

IMPORTANT: Always call this via a subagent (Task tool) to filter the returned memories down to what is relevant for your current question. Do not read memories directly — launch a subagent that reads them and returns only the relevant ones.`,
          {
            query: z.string().optional().describe('Optional: a topic or question to help the subagent filter relevant memories'),
          },
          scrubLayer.wrapSdkToolHandler(async (_args: { query?: string }) => {
            const session = self.chatSessions.get(chatSessionId);
            if (!session) return { content: [{ type: 'text' as const, text: 'No session found.' }], isError: true };
            const memories = readMemories(session.memoryKey);
            if (memories.length === 0) {
              return { content: [{ type: 'text' as const, text: 'No memories saved yet for this service.' }] };
            }
            return {
              content: [{
                type: 'text' as const,
                text: `${memories.length} memories for "${session.memoryKey}":\n\n${memories.map((m, i) => `${i + 1}. ${m}`).join('\n')}`,
              }],
            };
          })
        ),
        tool(
          'add_memory',
          `Save a learning or insight about this service's logs for future sessions. Use this to remember:
- Error patterns and their root causes
- Corrections from the user (e.g. "X is actually noise, not a real error")
- Service-specific knowledge (e.g. "retry errors from ServiceX are always noise")
- Important thresholds or baselines
- Any insight you would want to know next time you analyze this service's logs`,
          {
            memory: z.string().describe('The learning/insight to save. Be specific and actionable.'),
          },
          scrubLayer.wrapSdkToolHandler(async (args: { memory: string }) => {
            const session = self.chatSessions.get(chatSessionId);
            if (!session) return { content: [{ type: 'text' as const, text: 'No session found.' }], isError: true };
            const result = addMemory(session.memoryKey, args.memory);
            if (!result.added) {
              return { content: [{ type: 'text' as const, text: 'Memory already exists (duplicate). Total: ' + result.total }] };
            }
            return {
              content: [{
                type: 'text' as const,
                text: `Memory saved. Total memories for "${session.memoryKey}": ${result.total}`,
              }],
            };
          })
        ),
      ],
    });
  }

  private buildChatPrompt(ws: string, sourceRepoPath?: string, serviceName?: string, queryContext?: ChatQueryContext | null): string {
    const queryCtxSection = queryContext ? `
## Query Context
- Endpoint: ${queryContext.endpoint || 'N/A'}
- Namespace: ${queryContext.namespace || 'N/A'}
- Events: ${queryContext.events?.join(', ') || 'N/A'}
- Time range: ${queryContext.startTime || '?'} to ${queryContext.endTime || '?'}
- Server query: ${queryContext.serverQuery || 'none'}
- Active client query: ${queryContext.clientQuery || 'none'}
` : '';

    return `You are a log analysis assistant. The user is looking at service logs and will ask you questions about them. Answer thoroughly using the tools available.
${queryCtxSection}
## Workspace: ${ws}
- \`data.csv\` — Log data with \`_row\` column. **Do NOT read this file end-to-end.** Use the query tool.
- \`query-logs.mjs\` — CSV-aware search tool (run via Bash).
- \`kql-guidelines.md\` — KQL language reference for DGrep.
- \`metadata.toon\` — Query parameters.

## Query Tool Usage
\`\`\`
node ${ws}/query-logs.mjs "pattern"              Search rows matching regex
node ${ws}/query-logs.mjs "pattern" --count       Count matches
node ${ws}/query-logs.mjs --row 100 --context 10  Context around a row
node ${ws}/query-logs.mjs --rows 50-60            Row range
node ${ws}/query-logs.mjs --head 5                First few rows
\`\`\`

## Client Query Tool — \`run_client_query\`
You have a \`run_client_query\` tool to execute KQL client queries against the full DGrep server results. Two modes:

**Silent (silent=true, default for your own analysis):** Runs the query in the background without changing the user's UI. Use this whenever you need to search, filter, or aggregate data as part of your analysis.
**Show (silent=false):** Runs the query AND updates the user's UI — the client query editor and results table refresh live so the user immediately sees the filtered results. Only use this when the user explicitly asks to see, show, or display filtered results.

Both modes save filtered results to a CSV file and return the path + line count.

**Read \`${ws}/kql-guidelines.md\` before writing KQL queries** to understand the supported DGrep KQL syntax.
${sourceRepoPath ? `
## Source Code
${serviceName ? `**${serviceName}**` : 'Service'} source code is at \`${sourceRepoPath}\`.
Read source files to trace error origins, understand retry/fallback logic, and correlate log messages with code paths.
` : ''}
## Memory
You have \`read_memory\` and \`add_memory\` tools to persist learnings across sessions.
- **At the start of a new topic**, use \`read_memory\` via a subagent to fetch relevant past learnings before diving in.
- **When you discover something worth remembering**, use \`add_memory\` — error patterns, root causes, noise vs real failures, user corrections, service quirks, thresholds.
- If the user corrects you ("that's not an error, it's expected"), save that correction so you don't repeat the mistake.

## Instructions
- Start by running \`node ${ws}/query-logs.mjs --head 3\` to understand the data shape.
- **Use \`run_client_query\` with silent=true freely** for your own exploration — counting errors, filtering by severity, aggregating by column, etc. This does not affect the user's view.
- Only use \`run_client_query\` with silent=false when the user asks you to show, display, or apply a filter to their results view.
- Use the query-logs.mjs tool for quick regex searches on the local CSV data.
- Be specific — reference row numbers, timestamps, and correlation IDs.
- When the user asks about an error, get the context around it.
- When the user asks to trace something, grep for the correlation/request ID.`;
  }

  async sendChatMessage(chatSessionId: string, message: string): Promise<void> {
    const chatSession = this.chatSessions.get(chatSessionId);
    if (!chatSession) throw new Error(`Chat session not found: ${chatSessionId}`);

    // Add user message to history
    const userMsg: DGrepChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
      status: 'complete',
    };
    chatSession.messages.push(userMsg);

    // Prepare assistant message placeholder
    const assistantMsgId = uuidv4();
    chatSession.currentMessageId = assistantMsgId;
    chatSession.messages.push({
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      status: 'streaming',
    });

    if (chatSession.copilotSession) {
      // Copilot SDK: send directly
      await chatSession.copilotSession.send({ prompt: message });
    } else {
      // Claude SDK: push to queue, generator will pick it up
      chatSession.messageQueue.push(message);
      chatSession.messageReady?.();
    }
  }

  getChatHistory(chatSessionId: string): DGrepChatMessage[] {
    const chatSession = this.chatSessions.get(chatSessionId);
    if (!chatSession) return [];
    return [...chatSession.messages];
  }

  async destroyChatSession(chatSessionId: string): Promise<void> {
    const chatSession = this.chatSessions.get(chatSessionId);
    if (!chatSession) return;

    chatSession.closed = true;
    chatSession.messageReady?.(); // unblock generator if waiting

    try {
      await chatSession.copilotSession?.destroy();
    } catch {
      // Ignore destroy errors
    }
    this.chatSessions.delete(chatSessionId);
  }

  // ==================== Client Query from Chat ====================

  async runChatClientQuery(chatSessionId: string, kql: string, silent = false): Promise<{ csvPath: string; lineCount: number }> {
    const logger = getLogger();
    const chatSession = this.chatSessions.get(chatSessionId);
    if (!chatSession) throw new Error(`Chat session not found: ${chatSessionId}`);

    const dgrepSessionId = chatSession.dgrepSessionId;
    logger.info(LOG_CATEGORY, 'Running client query from chat', { chatSessionId, dgrepSessionId, kql: kql.substring(0, 200), silent });

    const dgrepService = getDGrepService();
    let columns: string[];
    let rows: Record<string, any>[];

    if (silent) {
      // Silent mode: run query without updating session state or UI
      const result = await dgrepService.runClientQueryDetached(dgrepSessionId, kql);
      columns = result.columns;
      rows = result.rows;
    } else {
      // Normal mode: update UI (client query editor + results table)
      this.emit('ai:client-query-update', { chatSessionId, dgrepSessionId, kql });
      await dgrepService.runClientQuery(dgrepSessionId, kql);
      const results = dgrepService.getResults(dgrepSessionId);
      columns = results?.columns || [];
      rows = results?.rows || [];
    }

    // Write filtered results to CSV in the workspace (even if empty — include headers)
    const csvFileName = `client-query-results-${Date.now()}.csv`;
    const csvPath = `${chatSession.workspacePath}/${csvFileName}`;
    const header = columns.map(c => csvEscapeField(c)).join(',');
    const csvRows = rows.map(row =>
      columns.map(c => csvEscapeField(String(row[c] ?? ''))).join(',')
    );
    fs.writeFileSync(csvPath, [header, ...csvRows].join('\n'), 'utf-8');

    logger.info(LOG_CATEGORY, 'Client query CSV saved', { chatSessionId, csvPath, lineCount: rows.length });

    return { csvPath, lineCount: rows.length };
  }

  getChatSession(chatSessionId: string): ChatSession | undefined {
    return this.chatSessions.get(chatSessionId);
  }

  // ==================== Shadow Mode ====================

  /** Save a CSV snapshot of results for shadow mode. Returns the file path. */
  saveShadowCsv(
    shadowId: string,
    stepIndex: number,
    columns: string[],
    rows: Record<string, any>[]
  ): string {
    const dir = path.join(os.homedir(), '.taskdock', 'dgrep', 'analysis', `shadow-${shadowId}`);
    fs.mkdirSync(dir, { recursive: true });

    const csvPath = path.join(dir, `step-${stepIndex}.csv`).replace(/\\/g, '/');
    const header = columns.map(c => csvEscapeField(c)).join(',');
    const csvRows = rows.map(row =>
      columns.map(c => csvEscapeField(String(row[c] ?? ''))).join(',')
    );
    fs.writeFileSync(csvPath, [header, ...csvRows].join('\n'), 'utf-8');
    return csvPath;
  }

  /** Create a learning session that analyzes the user's shadow mode actions. */
  async createLearningSession(
    dgrepSessionId: string,
    columns: string[],
    rows: Record<string, any>[],
    shadowLog: any[],
    sourceRepoPath?: string,
    serviceName?: string,
    queryContext?: ChatQueryContext
  ): Promise<string> {
    const chatSessionId = uuidv4();
    const { ws, workspace } = this.initChatSession(
      chatSessionId, dgrepSessionId, `learning-${chatSessionId}`,
      columns, rows, sourceRepoPath, serviceName, queryContext,
    );

    // Write shadow actions log
    const actionsPath = path.join(workspace.basePath, 'shadow-actions.toon');
    fs.writeFileSync(actionsPath, toonEncode({ steps: shadowLog }), 'utf-8');

    const learningPrompt = this.buildLearningPrompt(ws, shadowLog, sourceRepoPath, serviceName);

    if (this.provider === 'claude-sdk') {
      this.startLearningClaudeSession(chatSessionId, learningPrompt, sourceRepoPath || ws);
    } else {
      await this.startLearningCopilotSession(chatSessionId, learningPrompt);
    }

    getLogger().info(LOG_CATEGORY, 'Learning session created', { chatSessionId, dgrepSessionId, steps: shadowLog.length });
    return chatSessionId;
  }

  private buildLearningPrompt(ws: string, shadowLog: any[], sourceRepoPath?: string, serviceName?: string): string {
    const stepsSummary = shadowLog.map((action: any, i: number) => {
      const expanded = action.expandedLines?.length
        ? ` | Rows inspected: ${action.expandedLines.join(', ')}`
        : '';
      return `${i + 1}. [${action.timestamp}] **${action.type}**: ${action.description} → ${action.resultCount} results${expanded} (CSV: ${action.csvPath})`;
    }).join('\n');

    return `You are analyzing a user's DGrep log investigation workflow to learn from their actions.

## What happened
The user enabled shadow mode and performed the following actions while investigating ${serviceName ? `**${serviceName}**` : 'service'} logs:

${stepsSummary}

## Workspace: ${ws}
- \`shadow-actions.toon\` — Full action log with parameters and expandedLines
- \`data.csv\` — Final result set
- \`query-logs.mjs\` — CSV search tool
- \`kql-guidelines.md\` — KQL reference
- Each step has a CSV snapshot at the path listed above

## Understanding the data

Each action in shadow-actions.toon has an \`expandedLines\` array — these are the row indices the user clicked on to open the detail panel and inspect closely. This tells you which specific log entries the user was interested in. **Read these rows** to understand what caught the user's attention.

## Your Task

1. **Read \`${ws}/shadow-actions.toon\`** to get the full details of each step (query parameters, KQL, expandedLines, etc.)
2. **For each step**, read the CSV snapshot. Pay special attention to the \`expandedLines\` rows — these are the entries the user inspected in detail
3. **Analyze the user's intent** — what were they investigating? What patterns were they following? What did each query narrow down? Why did they inspect those specific rows?
4. **Present your understanding** to the user as a clear numbered list:
   - What the user was looking for
   - What each query step accomplished
   - What the user found or concluded
   - Any patterns or techniques the user used
5. **Wait for the user's response** — they may correct your understanding or confirm it
6. **Once the user validates**, convert each confirmed insight into a memory using the \`add_memory\` tool. Focus on:
   - Investigation techniques specific to this service
   - Error patterns and what they mean
   - Which queries are useful for what purposes
   - What is noise vs real issues
   - Any service-specific knowledge
${sourceRepoPath ? `\n## Source Code\n${serviceName ? `**${serviceName}**` : 'Service'} source code is at \`${sourceRepoPath}\`.` : ''}

## Important
- Be thorough but concise in your analysis
- Do NOT save memories until the user explicitly confirms your understanding
- If you're unsure about something, ask the user rather than guessing`;
  }

  private startLearningClaudeSession(
    chatSessionId: string,
    learningPrompt: string,
    cwd: string,
  ): void {
    this.createAssistantPlaceholder(chatSessionId);
    this.launchClaudeStreamingSession(chatSessionId, learningPrompt, cwd);
  }

  private async startLearningCopilotSession(
    chatSessionId: string,
    learningPrompt: string,
  ): Promise<void> {
    this.createAssistantPlaceholder(chatSessionId);

    const client = await this.getClient();
    const self = this;
    const chatSession = this.chatSessions.get(chatSessionId);
    const scrubLayer = chatSession ? ScrubLayer.load(chatSession.workspacePath) : ScrubLayer.createDefault();

    const session = await client.createSession({
      model: 'gpt-5.3-codex',
      streaming: true,
      systemMessage: {
        mode: 'append',
        content: learningPrompt,
      },
      tools: [
        {
          name: 'read_memory',
          description: 'Read saved memories for this service.',
          parameters: { type: 'object', properties: {} },
          handler: scrubLayer.wrapCopilotToolHandler(async () => {
            const cs = self.chatSessions.get(chatSessionId);
            if (!cs) return 'No session.';
            const memories = readMemories(cs.memoryKey);
            if (memories.length === 0) return 'No memories saved yet.';
            return memories.map((m: string, i: number) => `${i + 1}. ${m}`).join('\n');
          }),
        },
        {
          name: 'add_memory',
          description: 'Save a learning about this service for future sessions.',
          parameters: { type: 'object', properties: { memory: { type: 'string' } }, required: ['memory'] },
          handler: scrubLayer.wrapCopilotToolHandler(async (args: any) => {
            const cs = self.chatSessions.get(chatSessionId);
            if (!cs) return 'No session.';
            const result = addMemory(cs.memoryKey, args.memory);
            if (!result.added) return 'Duplicate. Total: ' + result.total;
            return `Saved. Total: ${result.total}`;
          }),
        },
      ],
    });

    const copilotChatSession = this.chatSessions.get(chatSessionId);
    if (copilotChatSession) copilotChatSession.copilotSession = session;

    session.on((event: any) => {
      this.handleCopilotChatEvent(chatSessionId, event);
    });

    // Send initial message to start analysis
    await session.send({ prompt: 'Analyze the shadow actions and present your understanding.' });
  }

  // ==================== Disposal ====================

  async dispose(): Promise<void> {
    const ids = [...this.chatSessions.keys()];
    for (const id of ids) {
      await this.destroyChatSession(id);
    }
    if (this.client) {
      await this.client.stop().catch(() => {});
      this.client = null;
    }
    this.removeAllListeners();
  }

  // ==================== Chat Event Handling ====================

  private handleCopilotChatEvent(chatSessionId: string, event: any): void {
    const chatSession = this.chatSessions.get(chatSessionId);
    if (!chatSession) return;

    const msgId = chatSession.currentMessageId;
    const currentMsg = chatSession.messages.find(m => m.id === msgId);

    switch (event.type) {
      case 'assistant.message_delta': {
        const delta = event.data?.deltaContent || '';
        if (currentMsg) {
          currentMsg.content += delta;
        }
        this.emitChatEvent({
          chatSessionId,
          type: 'delta',
          messageId: msgId || undefined,
          deltaContent: delta,
        });
        break;
      }

      case 'assistant.message': {
        const fullContent = event.data?.content || '';
        if (currentMsg) {
          currentMsg.content = fullContent;
        }
        this.emitChatEvent({
          chatSessionId,
          type: 'complete',
          messageId: msgId || undefined,
          fullContent,
        });
        break;
      }

      case 'tool.execution_start': {
        const toolName = event.data?.toolName || event.data?.name || 'unknown';
        this.emitChatEvent({
          chatSessionId,
          type: 'tool_call',
          toolName,
        });
        break;
      }

      case 'tool.execution_end': {
        this.emitChatEvent({
          chatSessionId,
          type: 'tool_result',
        });
        break;
      }

      case 'session.idle': {
        if (currentMsg) {
          currentMsg.status = 'complete';
        }
        chatSession.currentMessageId = null;
        this.emitChatEvent({
          chatSessionId,
          type: 'idle',
          messageId: msgId || undefined,
        });
        break;
      }

      case 'session.error': {
        const errorMessage = event.data?.message || 'Unknown error';
        if (currentMsg) {
          currentMsg.status = 'error';
          if (!currentMsg.content) {
            currentMsg.content = `Error: ${errorMessage}`;
          }
        }
        chatSession.currentMessageId = null;
        this.emitChatEvent({
          chatSessionId,
          type: 'error',
          error: errorMessage,
        });
        break;
      }
    }
  }

  private emitChatEvent(event: DGrepChatEvent): void {
    this.emit('ai:chat-event', event);
  }

  // ==================== JSON Parsing ====================

  private tryParseJSON<T>(text: string): T | null {
    let jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
    if (!jsonMatch) {
      jsonMatch = text.match(/```\s*(\{[\s\S]*?\})\s*```/);
    }
    if (!jsonMatch) {
      jsonMatch = text.match(/(\{[\s\S]*\})/);
    }

    if (!jsonMatch) return null;

    const jsonStr = jsonMatch[1].trim();

    try {
      return JSON.parse(jsonStr) as T;
    } catch {
      // Try to fix truncated JSON
    }

    let fixed = jsonStr;
    const openBraces = (jsonStr.match(/\{/g) || []).length;
    const closeBraces = (jsonStr.match(/\}/g) || []).length;
    const openBrackets = (jsonStr.match(/\[/g) || []).length;
    const closeBrackets = (jsonStr.match(/\]/g) || []).length;

    for (let i = 0; i < openBrackets - closeBrackets; i++) fixed += ']';
    for (let i = 0; i < openBraces - closeBraces; i++) fixed += '}';

    try {
      return JSON.parse(fixed) as T;
    } catch {
      return null;
    }
  }
}

// ==================== Helpers ====================

function csvEscapeField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

// ==================== Singleton ====================

let instance: DGrepAIService | null = null;

export function getDGrepAIService(): DGrepAIService {
  if (!instance) {
    instance = new DGrepAIService();
  }
  return instance;
}

export function disposeDGrepAIService(): void {
  if (instance) {
    instance.dispose();
    instance = null;
  }
}
