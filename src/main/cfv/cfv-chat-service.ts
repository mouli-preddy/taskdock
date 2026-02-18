import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { readFile, writeFile, unlink, mkdir, stat } from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { CopilotClient } from '@github/copilot-sdk';
import type { Tool } from '@github/copilot-sdk';
import type { CfvChatMessage, CfvChatEvent, CfvChatAction, CfvChatSessionInfo } from '../../shared/cfv-types.js';
import type { FilterRule, FilterCondition } from '../../shared/cfv-filter-types.js';
import { generateFilterId, FILTER_COLORS } from '../../shared/cfv-filter-types.js';

const CFV_SYSTEM_PROMPT = `You are an AI assistant specialized in analyzing Microsoft Teams call flow data.

You have access to call data files in the working directory. The file structure is:
- raw/callFlow.json — Full call flow with sequence messages between services
- raw/callDetails.json — Per-user call legs, endpoints, errors, and diagnostics
- raw/events_qoe.json — Quality of Experience metrics
- raw/callSummary.json — AI-generated call summary from CFV
- diagnostics/*.toon — Diagnostic data in TOON format
- metadata.toon — Call metadata

When the user asks about the call, use the Read tool to examine relevant files.
Provide concise, actionable answers. Use markdown formatting for clarity.
When referencing specific data points, cite the file and relevant fields.

## UI Action Tools

You also have tools to interact with the call flow UI:

- **navigate_to_line**: Scroll the call flow view to a specific message by its sequence number (the # column). Use this when you want to direct the user's attention to a specific message. The tool returns the message details so you can discuss them.

- **set_filter**: Apply a filter or highlight rule to the call flow. Use this to help the user focus on relevant messages. Filter modes:
  - "mark" (default): Highlights matching rows with a colored border — messages remain visible
  - "filter": Hides all non-matching rows, showing only matches
  Condition types: text-contains, text-not-contains, service, failure, seq-range, status

- **clear_filters**: Remove all active filters and marks from the call flow view.

## Filtering Best Practices

When highlighting or filtering call flow messages, follow these rules:

1. **Always use precise line ranges.** When you identify relevant messages, use seq-range filters with exact line numbers (e.g. from: 42, to: 58) rather than broad ranges. Read the data first to find the exact sequence numbers, then filter to only those lines.

2. **Never show unnecessary lines.** Avoid large seq-range spans that include irrelevant messages between the ones that matter. If relevant messages are scattered (e.g. lines 12, 35, and 78), use multiple targeted filters or use text/service conditions instead of a single wide range.

3. **Use separate filters with different colors for distinct flows.** When the user asks about multiple things (e.g. "show me the INVITE flow and the BYE flow"), create a separate set_filter call for each flow so they get different colors. This makes it easy to visually distinguish them in the UI. Give each filter a descriptive name.

4. **Always navigate to the most relevant line.** After applying filters, call navigate_to_line to scroll to the first or most important matching message so the user sees the result immediately.

5. **Prefer specific conditions over broad ones.** Use text-contains, service, or status filters when they precisely match the intent, rather than seq-range which may accidentally include unrelated messages.

## Thoroughness & Verification

You must be thorough and verify your own work before presenting results:

1. **Read the data first, always.** Before answering any question about the call, read the relevant files. Never guess or assume — base every claim on actual data you have read.

2. **Verify line numbers before filtering.** After identifying messages of interest, re-read the data to confirm the exact sequence numbers, service names, and labels are correct before calling set_filter or navigate_to_line. Wrong line numbers waste the user's time.

3. **Cross-check your analysis.** After forming an initial conclusion, look for contradicting evidence. Check related files (e.g. if you found an error in callFlow.json, also check callDetails.json for the corresponding leg). Mention if evidence is inconclusive.

4. **Verify filters after applying them.** After applying filters, use navigate_to_line on a few of the matched messages to confirm the filter is actually capturing the right data. If a filter turns out to be too broad or too narrow, clear it and apply a corrected one.

5. **Be exhaustive when asked to find things.** When the user asks "find all errors" or "show me failures", scan the entire dataset — do not stop at the first match. Report the complete picture: how many were found, where they are, and what they have in common.

6. **Show your reasoning.** Briefly explain what you checked, what you found, and why you drew your conclusion. This helps the user trust and verify the analysis.`;

interface ChatSession {
  id: string;
  persistentId: string;
  callId: string;
  callOutputDir: string;
  session: any; // CopilotClient session
  messages: CfvChatMessage[];
  currentMessageId: string | null;
  isFirstMessage: boolean;
  filterColorIndex: number;
}

interface SessionIndex {
  sessions: CfvChatSessionInfo[];
  lastActiveSessionId: string | null;
}

export class CfvChatService extends EventEmitter {
  private sessions = new Map<string, ChatSession>();
  private client: CopilotClient | null = null;

  private async getClient(): Promise<CopilotClient> {
    if (!this.client) {
      this.client = new CopilotClient();
      await this.client.start();
    }
    return this.client;
  }

  async createSession(
    callId: string,
    callOutputDir: string,
    persistentSessionId?: string,
  ): Promise<{ sdkSessionId: string; persistentSessionId: string }> {
    const client = await this.getClient();
    const sdkSessionId = uuidv4();

    // Resolve persistent session: resume existing or create new
    let persistentId: string;
    let persistedMessages: CfvChatMessage[] = [];

    if (persistentSessionId) {
      persistentId = persistentSessionId;
      persistedMessages = await this.loadSessionMessages(callOutputDir, persistentId);
    } else {
      // Create a new persistent session entry
      const info = await this.createPersistedSession(callOutputDir);
      persistentId = info.id;
    }

    // Mark as last active
    await this.setLastActiveSessionId(callOutputDir, persistentId);

    const chatSession: ChatSession = {
      id: sdkSessionId,
      persistentId,
      callId,
      callOutputDir,
      session: null,
      messages: persistedMessages,
      currentMessageId: null,
      isFirstMessage: true, // Always true — SDK session is always fresh
      filterColorIndex: 0,
    };

    // Must register session before creating SDK session, since tool handlers reference it
    this.sessions.set(sdkSessionId, chatSession);

    const tools = this.createTools(sdkSessionId);

    // If resuming a session with prior messages, include conversation history
    // in the system message so the model has full context.
    let systemContent = CFV_SYSTEM_PROMPT;
    if (persistedMessages.length > 0) {
      const historyLines: string[] = [
        '',
        '## Previous Conversation',
        'The user is resuming a prior chat session. Here is the conversation so far:',
        '',
      ];
      for (const msg of persistedMessages) {
        if (msg.role === 'user') {
          historyLines.push(`User: ${msg.content}`);
        } else if (msg.role === 'assistant' && msg.content) {
          historyLines.push(`Assistant: ${msg.content}`);
        }
        historyLines.push('');
      }
      historyLines.push('Continue the conversation from where it left off. Do not repeat or summarize the previous messages unless asked.');
      systemContent += '\n' + historyLines.join('\n');
    }

    const session = await client.createSession({
      model: 'gpt-4o',
      streaming: true,
      workingDirectory: callOutputDir,
      systemMessage: {
        mode: 'append',
        content: systemContent,
      },
      tools,
    });

    chatSession.session = session;

    // Wire up event handlers
    session.on((event: any) => {
      this.handleSessionEvent(sdkSessionId, event);
    });

    return { sdkSessionId, persistentSessionId: persistentId };
  }

  async send(sessionId: string, message: string): Promise<void> {
    const chatSession = this.sessions.get(sessionId);
    if (!chatSession) throw new Error(`Chat session not found: ${sessionId}`);

    // Add user message to history
    const userMsg: CfvChatMessage = {
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
    const assistantMsg: CfvChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      status: 'streaming',
    };
    chatSession.messages.push(assistantMsg);

    // Build attachments for first message
    const sendOptions: any = { prompt: message };
    if (chatSession.isFirstMessage) {
      const attachments: Array<{ type: string; path: string }> = [];
      const filesToAttach = [
        join(chatSession.callOutputDir, 'raw', 'callFlow.json'),
        join(chatSession.callOutputDir, 'raw', 'callDetails.json'),
        join(chatSession.callOutputDir, 'raw', 'callSummary.json'),
      ];

      for (const filePath of filesToAttach) {
        try {
          const s = await stat(filePath);
          if (s.isFile()) {
            attachments.push({ type: 'file', path: filePath });
          }
        } catch {
          // File doesn't exist, skip
        }
      }

      if (attachments.length > 0) {
        sendOptions.attachments = attachments;
      }
      chatSession.isFirstMessage = false;
    }

    await chatSession.session.send(sendOptions);
  }

  getHistory(sessionId: string): CfvChatMessage[] {
    const chatSession = this.sessions.get(sessionId);
    if (!chatSession) return [];
    return [...chatSession.messages];
  }

  // ---------------------------------------------------------------------------
  // Multi-session persistence — stored in {callOutputDir}/chat-sessions/
  // ---------------------------------------------------------------------------

  private sessionsDir(callOutputDir: string): string {
    return join(callOutputDir, 'chat-sessions');
  }

  private sessionIndexPath(callOutputDir: string): string {
    return join(this.sessionsDir(callOutputDir), 'index.json');
  }

  private sessionFilePath(callOutputDir: string, persistentId: string): string {
    return join(this.sessionsDir(callOutputDir), `${persistentId}.json`);
  }

  private async loadSessionIndex(callOutputDir: string): Promise<SessionIndex> {
    try {
      const raw = await readFile(this.sessionIndexPath(callOutputDir), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { sessions: [], lastActiveSessionId: null };
    }
  }

  private async saveSessionIndex(callOutputDir: string, index: SessionIndex): Promise<void> {
    try {
      const dir = this.sessionsDir(callOutputDir);
      await mkdir(dir, { recursive: true });
      await writeFile(this.sessionIndexPath(callOutputDir), JSON.stringify(index, null, 2), 'utf-8');
    } catch {
      // Ignore write errors
    }
  }

  async listPersistedSessions(callOutputDir: string): Promise<{ sessions: CfvChatSessionInfo[]; lastActiveSessionId: string | null }> {
    const index = await this.loadSessionIndex(callOutputDir);
    return { sessions: index.sessions, lastActiveSessionId: index.lastActiveSessionId };
  }

  async loadSessionMessages(callOutputDir: string, persistentId: string): Promise<CfvChatMessage[]> {
    try {
      const raw = await readFile(this.sessionFilePath(callOutputDir, persistentId), 'utf-8');
      const data = JSON.parse(raw);
      return Array.isArray(data.messages) ? data.messages : [];
    } catch {
      return [];
    }
  }

  private async createPersistedSession(callOutputDir: string): Promise<CfvChatSessionInfo> {
    const index = await this.loadSessionIndex(callOutputDir);
    const info: CfvChatSessionInfo = {
      id: uuidv4(),
      title: 'New chat',
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      messageCount: 0,
    };
    index.sessions.push(info);
    index.lastActiveSessionId = info.id;
    await this.saveSessionIndex(callOutputDir, index);
    return info;
  }

  private async setLastActiveSessionId(callOutputDir: string, persistentId: string): Promise<void> {
    const index = await this.loadSessionIndex(callOutputDir);
    index.lastActiveSessionId = persistentId;
    await this.saveSessionIndex(callOutputDir, index);
  }

  private async persistMessages(sessionId: string): Promise<void> {
    const chatSession = this.sessions.get(sessionId);
    if (!chatSession) return;

    const { callOutputDir, persistentId, messages } = chatSession;

    // Write session messages file
    try {
      const dir = this.sessionsDir(callOutputDir);
      await mkdir(dir, { recursive: true });
      await writeFile(
        this.sessionFilePath(callOutputDir, persistentId),
        JSON.stringify({ messages }, null, 2),
        'utf-8',
      );
    } catch {
      return; // If we can't write messages, skip index update too
    }

    // Update index entry (title, messageCount, lastUpdated)
    const index = await this.loadSessionIndex(callOutputDir);
    const entry = index.sessions.find(s => s.id === persistentId);
    if (entry) {
      entry.messageCount = messages.length;
      entry.lastUpdated = new Date().toISOString();
      // Auto-title from first user message
      if (entry.title === 'New chat') {
        const firstUserMsg = messages.find(m => m.role === 'user');
        if (firstUserMsg) {
          entry.title = firstUserMsg.content.length > 50
            ? firstUserMsg.content.slice(0, 50) + '...'
            : firstUserMsg.content;
        }
      }
      await this.saveSessionIndex(callOutputDir, index);
    }
  }

  async deletePersistedSession(callOutputDir: string, persistentId: string): Promise<void> {
    // Remove messages file
    try {
      await unlink(this.sessionFilePath(callOutputDir, persistentId));
    } catch { /* may not exist */ }

    // Remove from index
    const index = await this.loadSessionIndex(callOutputDir);
    index.sessions = index.sessions.filter(s => s.id !== persistentId);
    if (index.lastActiveSessionId === persistentId) {
      index.lastActiveSessionId = index.sessions.length > 0
        ? index.sessions[index.sessions.length - 1].id
        : null;
    }
    await this.saveSessionIndex(callOutputDir, index);
  }

  async destroySession(sessionId: string): Promise<void> {
    const chatSession = this.sessions.get(sessionId);
    if (!chatSession) return;

    try {
      await chatSession.session?.destroy();
    } catch {
      // Ignore destroy errors
    }
    this.sessions.delete(sessionId);
  }

  async dispose(): Promise<void> {
    const ids = [...this.sessions.keys()];
    for (const id of ids) {
      await this.destroySession(id);
    }
    if (this.client) {
      await this.client.stop().catch(() => {});
      this.client = null;
    }
    this.removeAllListeners();
  }

  // ---------------------------------------------------------------------------
  // Tool definitions
  // ---------------------------------------------------------------------------

  private createTools(sessionId: string): Tool[] {
    return [
      {
        name: 'navigate_to_line',
        description: 'Navigate the call flow UI to a specific message by its sequence number. Returns the message details.',
        parameters: {
          type: 'object',
          properties: {
            lineNumber: {
              type: 'number',
              description: 'The sequence number (# column) of the call flow message to navigate to',
            },
          },
          required: ['lineNumber'],
        },
        handler: async (args: any) => {
          const { lineNumber } = args;
          return this.handleNavigateToLine(sessionId, lineNumber);
        },
      },
      {
        name: 'set_filter',
        description: 'Apply a filter or highlight rule to the call flow UI. Use mode "mark" to highlight matching rows or "filter" to hide non-matching rows.',
        parameters: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['text-contains', 'text-not-contains', 'service', 'failure', 'seq-range', 'status'],
              description: 'The type of filter condition to apply',
            },
            mode: {
              type: 'string',
              enum: ['mark', 'filter'],
              description: 'mark = highlight matches with colored border (default), filter = hide non-matching rows',
            },
            name: {
              type: 'string',
              description: 'Optional human-readable name for this filter rule',
            },
            field: {
              type: 'string',
              enum: ['any', 'label', 'from', 'to'],
              description: 'Which field to search (for text-contains/text-not-contains). Default: any',
            },
            value: {
              type: 'string',
              description: 'The text to search for (for text-contains/text-not-contains)',
            },
            column: {
              type: 'string',
              description: 'Service column name (for service filter), e.g. "CC", "MC", "Originator"',
            },
            direction: {
              type: 'string',
              enum: ['from', 'to', 'either'],
              description: 'Match direction for service filter. Default: either',
            },
            from: {
              type: 'number',
              description: 'Start of range (for seq-range: sequence number)',
            },
            to: {
              type: 'number',
              description: 'End of range (for seq-range: sequence number)',
            },
            statusOperator: {
              type: 'string',
              enum: ['eq', 'gte', 'lt'],
              description: 'Comparison operator for status filter',
            },
            statusCode: {
              type: 'number',
              description: 'HTTP status code to compare (for status filter)',
            },
          },
          required: ['type'],
        },
        handler: async (args: any) => {
          return this.handleSetFilter(sessionId, args);
        },
      },
      {
        name: 'clear_filters',
        description: 'Remove all active filters and marks from the call flow view.',
        parameters: {
          type: 'object',
          properties: {},
        },
        handler: async () => {
          return this.handleClearFilters(sessionId);
        },
      },
    ];
  }

  // ---------------------------------------------------------------------------
  // Tool handlers
  // ---------------------------------------------------------------------------

  private async handleNavigateToLine(sessionId: string, lineNumber: number): Promise<string> {
    const chatSession = this.sessions.get(sessionId);
    if (!chatSession) return 'Session not found';

    // Emit action to frontend
    this.emitChatEvent({
      sessionId,
      type: 'action',
      chatAction: { action: 'navigate_to_line', lineNumber },
    });

    // Read call flow data to return message details
    try {
      const callFlowPath = join(chatSession.callOutputDir, 'raw', 'callFlow.json');
      const raw = await readFile(callFlowPath, 'utf-8');
      const data = JSON.parse(raw);
      const messages = data?.nrtStreamingIndexAugmentedCall?.fullCallFlow?.messages || [];
      const msg = messages.find((m: any) => m.index === lineNumber);
      if (!msg) {
        return `No message found at line ${lineNumber}. Valid range: 0-${messages.length - 1}.`;
      }
      return [
        `Navigated to message #${lineNumber}:`,
        `  From: ${msg.from || 'N/A'}`,
        `  To: ${msg.to || 'N/A'}`,
        `  Label: ${msg.label || 'N/A'}`,
        `  Time: ${msg.reqTime || msg.time || 'N/A'}`,
        `  Status: ${msg.status || 'N/A'}${msg.isFailure ? ' (FAILURE)' : ''}`,
        `  Latency: ${msg.latency || 'N/A'}`,
        msg.error ? `  Error: ${msg.error}` : '',
      ].filter(Boolean).join('\n');
    } catch {
      // If we can't read the data, still emit the navigation action
      return `Navigated to line ${lineNumber}.`;
    }
  }

  private handleSetFilter(sessionId: string, args: any): string {
    const chatSession = this.sessions.get(sessionId);
    if (!chatSession) return 'Session not found';

    const { type, mode = 'mark', name } = args;

    // Build the filter condition
    let condition: FilterCondition;
    switch (type) {
      case 'text-contains':
        condition = { type: 'text-contains', field: args.field || 'any', value: args.value || '' };
        break;
      case 'text-not-contains':
        condition = { type: 'text-not-contains', field: args.field || 'any', value: args.value || '' };
        break;
      case 'service':
        condition = { type: 'service', column: args.column || '', direction: args.direction || 'either' };
        break;
      case 'failure':
        condition = { type: 'failure', failureOnly: true };
        break;
      case 'seq-range':
        condition = { type: 'seq-range', from: args.from ?? 0, to: args.to ?? 999999 };
        break;
      case 'status':
        condition = { type: 'status', operator: args.statusOperator || 'gte', code: args.statusCode ?? 400 };
        break;
      default:
        return `Unknown filter type: ${type}`;
    }

    const colorIndex = chatSession.filterColorIndex++;
    const rule: FilterRule = {
      id: generateFilterId(),
      name: name || undefined,
      mode: mode === 'filter' ? 'filter' : 'mark',
      color: FILTER_COLORS[colorIndex % FILTER_COLORS.length],
      group: { operator: 'and', conditions: [condition] },
      enabled: true,
    };

    // Emit action to frontend
    this.emitChatEvent({
      sessionId,
      type: 'action',
      chatAction: { action: 'set_filter', filterRule: rule },
    });

    const modeDesc = mode === 'filter' ? 'Filtering' : 'Highlighting';
    return `${modeDesc} applied: ${this.describeCondition(condition)}`;
  }

  private handleClearFilters(sessionId: string): string {
    this.emitChatEvent({
      sessionId,
      type: 'action',
      chatAction: { action: 'clear_filters' },
    });
    return 'All filters and marks have been cleared.';
  }

  private describeCondition(c: FilterCondition): string {
    switch (c.type) {
      case 'text-contains': return `messages where ${c.field} contains "${c.value}"`;
      case 'text-not-contains': return `messages where ${c.field} does not contain "${c.value}"`;
      case 'regex': return `messages matching /${c.pattern}/`;
      case 'service': return `messages ${c.direction} service "${c.column}"`;
      case 'failure': return 'failure messages';
      case 'seq-range': return `messages #${c.from} to #${c.to}`;
      case 'time-range': return `messages from ${c.from} to ${c.to}`;
      case 'status': return `messages with status ${c.operator} ${c.code}`;
    }
  }

  // ---------------------------------------------------------------------------
  // Session event handling
  // ---------------------------------------------------------------------------

  private handleSessionEvent(sessionId: string, event: any): void {
    const chatSession = this.sessions.get(sessionId);
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
          sessionId,
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
          sessionId,
          type: 'complete',
          messageId: msgId || undefined,
          fullContent,
        });
        break;
      }

      case 'tool.call': {
        const toolName = event.data?.name || event.data?.toolName || 'unknown';
        this.emitChatEvent({
          sessionId,
          type: 'tool_call',
          toolName,
        });
        break;
      }

      case 'tool.result': {
        this.emitChatEvent({
          sessionId,
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
          sessionId,
          type: 'idle',
          messageId: msgId || undefined,
        });
        // Persist messages to disk after each completed exchange
        this.persistMessages(sessionId);
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
          sessionId,
          type: 'error',
          error: errorMessage,
        });
        break;
      }
    }
  }

  private emitChatEvent(event: CfvChatEvent): void {
    this.emit('chat-event', event);
  }
}

// Singleton pattern
let instance: CfvChatService | null = null;

export function getCfvChatService(): CfvChatService {
  if (!instance) {
    instance = new CfvChatService();
  }
  return instance;
}

export function disposeCfvChatService(): void {
  if (instance) {
    instance.dispose();
    instance = null;
  }
}
