/**
 * DGrep AI Service
 * AI-powered log analysis using agent executor pattern.
 *
 * Summary and RCA: Workspace-based agent execution using Claude SDK query()
 * or Copilot SDK CopilotClient. Writes data to workspace files, launches
 * agent with prompt, reads structured JSON output.
 *
 * NL-to-KQL, chat, anomaly detection: Lightweight CopilotClient sessions.
 */

import { EventEmitter } from 'node:events';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { CopilotClient } from '@github/copilot-sdk';
import {
  createAnalysisWorkspace,
  buildSummaryPrompt,
  buildRCAPrompt,
  type AnalysisMetadata,
  type AnalysisWorkspace,
} from './dgrep-analysis-workspace.js';
import { getDGrepService } from './dgrep-service.js';
import { getLogger } from '../services/logger-service.js';
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

// ==================== Chat Session ====================

interface ChatSession {
  id: string;
  dgrepSessionId: string;
  columns: string[];
  rows: Record<string, any>[];
  session: any; // CopilotClient session
  messages: DGrepChatMessage[];
  currentMessageId: string | null;
  isFirstMessage: boolean;
}

// ==================== Service ====================

export class DGrepAIService extends EventEmitter {
  private client: CopilotClient | null = null;
  private chatSessions = new Map<string, ChatSession>();
  private provider: 'claude-sdk' | 'copilot-sdk' = 'claude-sdk';
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

  // ==================== Copilot Inline Prompts (Copilot can't read files) ====================

  private buildCopilotInlinePrompt(
    columns: string[],
    rows: Record<string, any>[],
    patterns: any[],
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
        model: 'sonnet',
        maxTurns: 50,
        cwd,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      },
    });

    for await (const message of response) {
      // Stream assistant thoughts/text as progress
      if (message.type === 'assistant') {
        const text = this.extractTextContent(message);
        if (text) {
          this.emit(`ai:${taskType}-progress`, { sessionId, text });
        }
        // Also emit tool use info so user can see what the agent is doing
        const toolUses = this.extractToolUses(message);
        for (const tool of toolUses) {
          this.emit(`ai:${taskType}-progress`, { sessionId, text: `[Using ${tool.name}]` });
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
      model: 'gpt-4o',
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
            const delta = event.data?.deltaContent || event.data?.content || '';
            fullContent += delta;
            this.emit(`ai:${taskType}-progress`, { sessionId, text: delta });
            break;
          }
          case 'assistant.message': {
            fullContent = event.data?.content || fullContent;
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
    if (!message.content) return '';
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('');
    }
    return '';
  }

  private extractToolUses(message: any): Array<{ name: string; input?: any }> {
    if (!message.content || !Array.isArray(message.content)) return [];
    return message.content
      .filter((c: any) => c.type === 'tool_use')
      .map((c: any) => ({ name: c.name || 'unknown', input: c.input }));
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
      model: 'gpt-4o',
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
      model: 'gpt-4o',
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

  async createChatSession(
    dgrepSessionId: string,
    columns: string[],
    rows: Record<string, any>[]
  ): Promise<string> {
    const logger = getLogger();
    const chatSessionId = uuidv4();

    const client = await this.getClient();

    const sampleRows = rows.slice(0, 50);
    const contextInfo = [
      `\n## Current Log Dataset`,
      `Columns: ${columns.join(', ')}`,
      `Total rows: ${rows.length}`,
      `\n## Sample Rows (first 50)`,
      JSON.stringify(sampleRows, null, 0),
    ].join('\n');

    const chatSession: ChatSession = {
      id: chatSessionId,
      dgrepSessionId,
      columns,
      rows,
      session: null,
      messages: [],
      currentMessageId: null,
      isFirstMessage: true,
    };

    this.chatSessions.set(chatSessionId, chatSession);

    const session = await client.createSession({
      model: 'gpt-4o',
      streaming: true,
      systemMessage: {
        mode: 'append',
        content: CHAT_SYSTEM_PROMPT + contextInfo,
      },
    });

    chatSession.session = session;

    session.on((event: any) => {
      this.handleChatSessionEvent(chatSessionId, event);
    });

    logger.info(LOG_CATEGORY, 'Chat session created', { chatSessionId, dgrepSessionId });
    return chatSessionId;
  }

  async sendChatMessage(chatSessionId: string, message: string): Promise<void> {
    const chatSession = this.chatSessions.get(chatSessionId);
    if (!chatSession) throw new Error(`Chat session not found: ${chatSessionId}`);

    const userMsg: DGrepChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
      status: 'complete',
    };
    chatSession.messages.push(userMsg);

    const assistantMsgId = uuidv4();
    chatSession.currentMessageId = assistantMsgId;
    const assistantMsg: DGrepChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      status: 'streaming',
    };
    chatSession.messages.push(assistantMsg);

    await chatSession.session.send({ prompt: message });
  }

  getChatHistory(chatSessionId: string): DGrepChatMessage[] {
    const chatSession = this.chatSessions.get(chatSessionId);
    if (!chatSession) return [];
    return [...chatSession.messages];
  }

  async destroyChatSession(chatSessionId: string): Promise<void> {
    const chatSession = this.chatSessions.get(chatSessionId);
    if (!chatSession) return;

    try {
      await chatSession.session?.destroy();
    } catch {
      // Ignore destroy errors
    }
    this.chatSessions.delete(chatSessionId);
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

  private handleChatSessionEvent(chatSessionId: string, event: any): void {
    const chatSession = this.chatSessions.get(chatSessionId);
    if (!chatSession) return;

    const msgId = chatSession.currentMessageId;
    const currentMsg = chatSession.messages.find(m => m.id === msgId);

    switch (event.type) {
      case 'assistant.message_delta': {
        const delta = event.data?.deltaContent || event.data?.content || '';
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

      case 'tool.call': {
        const toolName = event.data?.name || event.data?.toolName || 'unknown';
        this.emitChatEvent({
          chatSessionId,
          type: 'tool_call',
          toolName,
        });
        break;
      }

      case 'tool.result': {
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
