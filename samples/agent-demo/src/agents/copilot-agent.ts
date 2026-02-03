/**
 * GitHub Copilot SDK wrapper for code generation tasks.
 * Used for code completion, implementation suggestions, and code-focused tasks.
 */

import { CopilotClient } from '@github/copilot-sdk';

/** Event types emitted by Copilot */
export type CopilotEventType =
  | 'assistant.message'
  | 'assistant.message_delta'
  | 'tool.execution_start'
  | 'tool.execution_end'
  | 'session.idle'
  | 'session.error';

export interface CopilotMessage {
  type: CopilotEventType;
  content: string;
  toolName?: string;
}

/** MCP Server configuration */
export interface McpServerConfig {
  type: 'local' | 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  tools: string | string[];
  timeout?: number;
  env?: Record<string, string>;
  cwd?: string;
  headers?: Record<string, string>;
}

/** Options for Copilot sessions */
export interface CopilotAgentOptions {
  /** The prompt/request for code generation */
  prompt: string;
  /** Model to use */
  model?: 'gpt-5' | 'claude-sonnet-4.5';
  /** Enable streaming responses */
  streaming?: boolean;
  /** File attachments for context */
  attachments?: Array<{
    type: 'file' | 'directory';
    path: string;
    displayName?: string;
  }>;
  /** Available tools whitelist */
  availableTools?: string[];
  /** System message to guide behavior */
  systemMessage?: string;
  /** MCP servers to connect */
  mcpServers?: Record<string, McpServerConfig>;
}

/** Singleton client instance */
let clientInstance: CopilotClient | null = null;

/**
 * Gets or creates the Copilot client singleton.
 */
async function getClient(): Promise<CopilotClient> {
  if (!clientInstance) {
    clientInstance = new CopilotClient();
    await clientInstance.start();
  }
  return clientInstance;
}

/**
 * Stops the Copilot client and releases resources.
 */
export async function stopCopilotClient(): Promise<void> {
  if (clientInstance) {
    await clientInstance.stop();
    clientInstance = null;
  }
}

/**
 * Runs a Copilot code generation session.
 *
 * @param options - Session configuration
 * @yields CopilotMessage objects as the session progresses
 */
export async function* runCopilotAgent(options: CopilotAgentOptions): AsyncGenerator<CopilotMessage> {
  const {
    prompt,
    model = 'gpt-5',
    streaming = true,
    attachments,
    availableTools = ['Read', 'Write', 'Bash'],
    systemMessage,
    mcpServers
  } = options;

  const client = await getClient();

  // Create session with configuration
  const session = await client.createSession({
    model,
    streaming,
    availableTools,
    systemMessage: systemMessage ? {
      mode: 'append',
      content: systemMessage
    } : undefined,
    mcpServers
  });

  // Set up event handling with generator
  const messageQueue: CopilotMessage[] = [];
  let resolveNext: ((value: CopilotMessage | null) => void) | null = null;
  let isComplete = false;

  session.on((event) => {
    let message: CopilotMessage | null = null;

    switch (event.type) {
      case 'assistant.message':
        message = {
          type: 'assistant.message',
          content: event.data.content
        };
        break;
      case 'assistant.message_delta':
        message = {
          type: 'assistant.message_delta',
          content: event.data.deltaContent
        };
        break;
      case 'tool.execution_start':
        message = {
          type: 'tool.execution_start',
          content: `Starting: ${event.data.toolName}`,
          toolName: event.data.toolName
        };
        break;
      case 'tool.execution_end':
        message = {
          type: 'tool.execution_end',
          content: event.data.result ? `Result: ${JSON.stringify(event.data.result).slice(0, 500)}...` : `Completed: ${event.data.toolName}`,
          toolName: event.data.toolName
        };
        break;
      case 'session.idle':
        isComplete = true;
        if (resolveNext) {
          resolveNext(null);
          resolveNext = null;
        }
        break;
      case 'session.error':
        message = {
          type: 'session.error',
          content: event.data.message
        };
        isComplete = true;
        break;
    }

    if (message) {
      if (resolveNext) {
        resolveNext(message);
        resolveNext = null;
      } else {
        messageQueue.push(message);
      }
    }
  });

  // Send the message
  await session.send({
    prompt,
    attachments
  });

  // Yield messages as they arrive
  while (!isComplete || messageQueue.length > 0) {
    if (messageQueue.length > 0) {
      yield messageQueue.shift()!;
    } else if (!isComplete) {
      const nextMessage = await new Promise<CopilotMessage | null>((resolve) => {
        resolveNext = resolve;
      });
      if (nextMessage) {
        yield nextMessage;
      }
    }
  }

  // Clean up session
  await session.destroy();
}

/**
 * Simple helper to get a code completion from Copilot.
 *
 * @param prompt - The code generation prompt
 * @param filePath - Optional file path for context
 * @returns The generated code response
 */
export async function generateCode(prompt: string, filePath?: string): Promise<string> {
  const attachments = filePath ? [{
    type: 'file' as const,
    path: filePath,
    displayName: 'Context File'
  }] : undefined;

  let result = '';

  for await (const message of runCopilotAgent({
    prompt,
    model: 'gpt-5',
    attachments,
    systemMessage: `You are a code generation assistant. Generate clean, well-documented code.
Focus on:
- Following existing code patterns
- Adding appropriate error handling
- Including type annotations
- Writing clear comments for complex logic`
  })) {
    if (message.type === 'assistant.message') {
      result = message.content;
    }
  }

  return result;
}
