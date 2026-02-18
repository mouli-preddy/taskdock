// Re-export backend types needed by renderer
export type { FetchProgress, FetchResult } from '../main/cfv/cfv-types.js';

export interface CfvCallSummary {
  callId: string;
  fetchedAt: string;
  outputDir: string;
  messageCount: number;
  diagnosticFiles: number;
}

export interface CfvCallTab {
  id: string;
  type: 'home' | 'call';
  label: string;
  closeable: boolean;
  callId?: string;
}

// 12 service columns from CFV sequence diagram
export const SERVICE_COLUMNS = [
  'Originator', 'Conv', 'CC', 'Target', 'MC', 'MPAAS',
  'MPaaS:IVR', 'PNH', 'PMA', 'Agent', 'Runtime API', 'External',
] as const;

export type ServiceColumn = typeof SERVICE_COLUMNS[number];

export interface CfvChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  status?: 'streaming' | 'complete' | 'error';
}

export interface CfvChatSessionInfo {
  id: string;
  title: string;
  createdAt: string;
  lastUpdated: string;
  messageCount: number;
}

export interface CfvChatAction {
  action: 'navigate_to_line' | 'set_filter' | 'clear_filters';
  lineNumber?: number;
  filterRule?: import('../shared/cfv-filter-types.js').FilterRule;
}

export interface CfvChatEvent {
  sessionId: string;
  type: 'delta' | 'complete' | 'tool_call' | 'tool_result' | 'idle' | 'error' | 'action';
  messageId?: string;
  deltaContent?: string;
  fullContent?: string;
  toolName?: string;
  error?: string;
  chatAction?: CfvChatAction;
}
