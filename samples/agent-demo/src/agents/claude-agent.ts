/**
 * Claude Agent SDK wrapper with WorkIQ MCP integration.
 * Uses Claude for reasoning, planning, and design document generation.
 * WorkIQ MCP provides enterprise context from meetings, documents, and emails.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config.js';

/** Message types emitted by the Claude agent */
export type AgentMessageType = 'assistant' | 'system' | 'tool_use' | 'tool_result';

export interface AgentMessage {
  type: AgentMessageType;
  content: string;
  toolName?: string;
  subtype?: string;
}

/** Options for running the Claude agent */
export interface ClaudeAgentOptions {
  /** The user's prompt/request */
  prompt: string;
  /** System prompt to guide Claude's behavior */
  systemPrompt?: string;
  /** Whether to enable WorkIQ MCP for enterprise context */
  useWorkIQ?: boolean;
  /** Model to use (default: sonnet) */
  model?: 'sonnet' | 'opus' | 'haiku';
  /** Additional tools to enable */
  tools?: string[];
  /** Permission mode for tool execution */
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions';
}

/** Default system prompt for design tasks */
const DESIGN_SYSTEM_PROMPT = `You are a senior software architect helping design features and create work items.

IMPORTANT: When using the ask_work_iq tool, make ONE query at a time and wait for the response before making the next query. Do NOT make multiple parallel queries.

Your workflow:
1. **Gather Context**: Use the ask_work_iq tool to search for relevant information ONE QUERY AT A TIME:
   - First: "What meetings, emails, or documents discuss [topic]? Include any decisions made."
   - Wait for response, then if needed ask follow-up questions

2. **Ask Clarifying Questions**: Based on the context gathered, ask the user clarifying questions to fill gaps.

3. **Generate Design Document**: Create a comprehensive design document in markdown format including:
   - Overview and goals
   - Architecture decisions (cite sources from WorkIQ)
   - Components and their responsibilities
   - API contracts (if applicable)
   - Security considerations
   - Testing strategy

4. **Generate Work Items**: Break down the design into a hierarchy:
   - Epic (high-level initiative)
   - Features (major capabilities)
   - User Stories (user-facing functionality)
   - Tasks (implementation work)

Always cite your sources when referencing information from meetings or documents.`;

/** Default system prompt for planning tasks */
const PLANNING_SYSTEM_PROMPT = `You are a project planning assistant that creates well-structured Azure DevOps work items.

IMPORTANT: When using the ask_work_iq tool, make ONE query at a time and wait for the response before making the next query. Do NOT make multiple parallel queries.

Your workflow:
1. **Gather Context**: Use the ask_work_iq tool ONE QUERY AT A TIME to understand:
   - First query: "What existing work items, standards, and conventions relate to [topic]?"
   - Wait for response before any follow-up queries

2. **Create Work Item Structure**: Generate the work items in JSON format

3. **Output Format**: Provide the work items as JSON (see PLANNING_SYSTEM_PROMPT_NO_WORKIQ for format)`;

/** System prompt for planning without WorkIQ */
const PLANNING_SYSTEM_PROMPT_NO_WORKIQ = `You are a project planning assistant. Generate Azure DevOps work items for the requested feature.

Create a comprehensive work item hierarchy in JSON format:

\`\`\`json
{
  "epic": {
    "title": "Epic title",
    "description": "Business value and scope"
  },
  "features": [
    { "title": "Feature 1", "description": "..." },
    { "title": "Feature 2", "description": "..." }
  ],
  "stories": [
    {
      "title": "As a [user], I want [goal] so that [benefit]",
      "description": "Detailed description",
      "acceptanceCriteria": ["AC1", "AC2", "AC3"],
      "featureIndex": 0
    }
  ],
  "tasks": [
    {
      "title": "Implementation task",
      "description": "Technical details",
      "storyIndex": 0
    }
  ]
}
\`\`\`

IMPORTANT:
- featureIndex links stories to their parent feature (0-based index into features array)
- storyIndex links tasks to their parent story (0-based index into stories array)
- Include 3-5 acceptance criteria per story
- Break down stories into 2-4 tasks each

Generate the complete work item hierarchy now.`;

/**
 * Runs the Claude agent with optional WorkIQ MCP integration.
 *
 * @param options - Agent configuration options
 * @yields AgentMessage objects as the agent processes
 */
export async function* runClaudeAgent(options: ClaudeAgentOptions): AsyncGenerator<AgentMessage> {
  const {
    prompt,
    systemPrompt,
    useWorkIQ = true,
    model = 'sonnet',
    tools = ['Read', 'Glob', 'Grep'],
    permissionMode = 'default'
  } = options;

  // Build MCP servers configuration
  const mcpServers: Record<string, { command: string; args: string[] }> = {};

  // Build allowed tools list - include MCP tools if WorkIQ is enabled
  let allowedTools = [...tools];

  if (useWorkIQ) {
    mcpServers['workiq'] = {
      command: 'npx',
      args: ['-y', '@microsoft/workiq', 'mcp']
    };
    // Add WorkIQ MCP tool to allowed tools
    allowedTools.push('mcp__workiq__ask_work_iq', 'mcp__workiq__accept_eula');
  }

  // Build the full prompt - combine system prompt into user prompt to avoid tool use issues
  const fullPrompt = systemPrompt
    ? `<instructions>\n${systemPrompt}\n</instructions>\n\n<request>\n${prompt}\n</request>\n\nGenerate the complete response now. Do not use any tools.`
    : prompt;

  // If no tools, use maxTurns: 1 to avoid concurrency issues
  const maxTurns = allowedTools.length === 0 ? 1 : undefined;

  const response = query({
    prompt: fullPrompt,
    options: {
      model,
      allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
      permissionMode,
      maxTurns,
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      workingDirectory: config.workingDirectory
    }
  });

  // Stream messages from the agent
  for await (const message of response) {
    if (message.type === 'assistant' && message.message?.content) {
      // Extract text from content blocks
      const textContent = message.message.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');

      if (textContent) {
        yield {
          type: 'assistant',
          content: textContent
        };
      }

      // Also check for tool_use blocks
      const toolUseBlocks = message.message.content.filter((b: any) => b.type === 'tool_use');
      for (const toolBlock of toolUseBlocks) {
        yield {
          type: 'tool_use',
          content: JSON.stringify(toolBlock.input || {}),
          toolName: toolBlock.name
        };
      }
    } else if (message.type === 'system') {
      yield {
        type: 'system',
        content: message.message || '',
        subtype: message.subtype
      };
    } else if (message.type === 'user' && message.message?.content) {
      // Tool results come as user messages
      const toolResults = message.message.content.filter((b: any) => b.type === 'tool_result');
      for (const result of toolResults) {
        yield {
          type: 'tool_result',
          content: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
          toolName: result.tool_use_id
        };
      }
    } else if (message.type === 'result') {
      // Final result message
      if (message.is_error) {
        yield {
          type: 'system',
          content: `Error: ${message.error}`,
          subtype: 'error'
        };
      }
    }
  }
}

/**
 * Runs a design session using Claude with WorkIQ context gathering.
 *
 * @param topic - The topic/feature to design
 * @yields AgentMessage objects as the agent processes
 */
export async function* runDesignSession(topic: string, useWorkIQ: boolean = true): AsyncGenerator<AgentMessage> {
  const systemPrompt = useWorkIQ ? DESIGN_SYSTEM_PROMPT : DESIGN_SYSTEM_PROMPT_NO_WORKIQ;

  yield* runClaudeAgent({
    prompt: topic,
    systemPrompt,
    useWorkIQ,
    model: 'sonnet',
    tools: useWorkIQ ? ['Read', 'Glob', 'Grep'] : [], // Disable tools when no WorkIQ to avoid concurrency issues
    permissionMode: 'bypassPermissions'
  });
}

/** System prompt for design tasks without WorkIQ */
const DESIGN_SYSTEM_PROMPT_NO_WORKIQ = `You are a senior software architect. Generate a complete design document for the requested feature.

Generate a comprehensive design document in markdown format with the following sections:

# [Feature Name] Design Document

## 1. Overview
- Brief description of the feature
- Goals and objectives
- Key stakeholders

## 2. Requirements
- Functional requirements
- Non-functional requirements (security, performance, scalability)
- Constraints and assumptions

## 3. Architecture
- High-level architecture diagram (describe in text)
- Component breakdown
- Data flow

## 4. Technical Design
- Technology choices with rationale
- API contracts (if applicable)
- Database schema (if applicable)
- Security considerations

## 5. Implementation Plan
- Phases and milestones
- Dependencies

## 6. Work Items (JSON)
At the end, include a JSON block with work items:
\`\`\`json
{
  "epic": { "title": "...", "description": "..." },
  "features": [{ "title": "...", "description": "..." }],
  "stories": [{ "title": "...", "description": "...", "acceptanceCriteria": ["..."], "featureIndex": 0 }],
  "tasks": [{ "title": "...", "description": "...", "storyIndex": 0 }]
}
\`\`\`

Generate the complete document now based on common best practices.`;

/**
 * Runs a planning session to create work items using Claude with WorkIQ context.
 *
 * @param topic - The topic/feature to plan
 * @yields AgentMessage objects as the agent processes
 */
export async function* runPlanningSession(topic: string, useWorkIQ: boolean = true): AsyncGenerator<AgentMessage> {
  const systemPrompt = useWorkIQ ? PLANNING_SYSTEM_PROMPT : PLANNING_SYSTEM_PROMPT_NO_WORKIQ;

  yield* runClaudeAgent({
    prompt: topic,
    systemPrompt,
    useWorkIQ,
    model: 'sonnet',
    tools: useWorkIQ ? ['Read', 'Glob', 'Grep'] : [],
    permissionMode: 'bypassPermissions'
  });
}
