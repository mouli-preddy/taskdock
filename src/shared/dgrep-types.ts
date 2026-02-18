// DGrep Log Search Types

// ==================== Endpoints ====================

export type DGrepEndpointName =
  | 'Firstparty PROD'
  | 'Diagnostics PROD'
  | 'CA Mooncake'
  | 'CA Fairfax'
  | 'Firstparty INT'
  | 'Diagnostics INT'
  | 'Blackforest'
  | 'USNat'
  | 'USSec'
  | 'RXNat'
  | 'RXSec'
  | 'MCGov'
  | 'MCDod';

export const DGREP_ENDPOINT_URLS: Record<DGrepEndpointName, string> = {
  'Firstparty PROD': 'https://firstparty.monitoring.windows.net/',
  'Diagnostics PROD': 'https://production.diagnostics.monitoring.core.windows.net/',
  'CA Mooncake': 'https://mooncake.diagnostics.monitoring.core.chinacloudapi.cn/',
  'CA Fairfax': 'https://fairfax.diagnostics.monitoring.core.usgovcloudapi.net/',
  'Firstparty INT': 'https://firstparty-int.monitoring.windows.net/',
  'Diagnostics INT': 'https://int.diagnostics.monitoring.core.windows.net/',
  'Blackforest': 'https://blackforest.diagnostics.monitoring.core.cloudapi.de/',
  'USNat': 'https://usnat.diagnostics.monitoring.core.eaglex.ic.gov/',
  'USSec': 'https://ussec.diagnostics.monitoring.core.microsoft.scloud/',
  'RXNat': 'https://rxnat.diagnostics.monitoring.core.eaglex.ic.gov/',
  'RXSec': 'https://rxsec.diagnostics.monitoring.core.microsoft.scloud/',
  'MCGov': 'https://mcgov.diagnostics.monitoring.core.usgovcloudapi.net/',
  'MCDod': 'https://mcdod.diagnostics.monitoring.core.usgovcloudapi.net/',
};

export const DGREP_FRONTEND_URLS: Record<string, string> = {
  'Firstparty PROD': 'https://dgrepv2-frontend-prod.trafficmanager.net',
  'Diagnostics PROD': 'https://dgrepv2-frontend-prod.trafficmanager.net',
  'CA Mooncake': 'https://dgrepv2-frontend-prod.trafficmanager.cn',
  'CA Fairfax': 'https://dgrepv2-frontend-prod.usgovtrafficmanager.net',
  Default: 'https://dgrepv2-frontend-prod.trafficmanager.net',
};

// ==================== Log Configs ====================

export type LogId = 'rb' | 'scx' | 'cs' | 'ts' | 'cc' | 'ccts' | 'css' | 'csmetrics' | 'tsmetrics';

export interface LogConfig {
  endpoint: string;
  endpointName: DGrepEndpointName;
  namespace: string;
  events: string;
  defaultClientQuery: string;
}

export const LOG_CONFIGS: Record<LogId, LogConfig> = {
  rb: {
    endpoint: 'https://firstparty.monitoring.windows.net/',
    endpointName: 'Firstparty PROD',
    namespace: 'SkypeRB',
    events: 'BroadcastLogs',
    defaultClientQuery: 'source\n| sort by PreciseTimeStamp asc',
  },
  scx: {
    endpoint: 'https://production.diagnostics.monitoring.core.windows.net/',
    endpointName: 'Diagnostics PROD',
    namespace: 'TeamsLiveEventsAttendee',
    events: 'AttendeeLogs',
    defaultClientQuery: 'source\n| sort by PreciseTimeStamp asc',
  },
  cs: {
    endpoint: 'https://production.diagnostics.monitoring.core.windows.net/',
    endpointName: 'Diagnostics PROD',
    namespace: 'SkypeCoreConv',
    events: 'ServiceTraces',
    defaultClientQuery: 'source\n| sort by PreciseTimeStamp asc',
  },
  ts: {
    endpoint: 'https://production.diagnostics.monitoring.core.windows.net/',
    endpointName: 'Diagnostics PROD',
    namespace: 'TeamsScheduler',
    events: 'ServiceTraces',
    defaultClientQuery: 'source\n| sort by PreciseTimeStamp asc',
  },
  cc: {
    endpoint: 'https://production.diagnostics.monitoring.core.windows.net/',
    endpointName: 'Diagnostics PROD',
    namespace: 'SkypeCoreCC',
    events: 'ServiceTraces',
    defaultClientQuery: 'source\n| sort by PreciseTimeStamp asc',
  },
  ccts: {
    endpoint: 'https://production.diagnostics.monitoring.core.windows.net/',
    endpointName: 'Diagnostics PROD',
    namespace: 'SkypeCCTS',
    events: 'ServiceTraces',
    defaultClientQuery: 'source\n| sort by PreciseTimeStamp asc',
  },
  css: {
    endpoint: 'https://production.diagnostics.monitoring.core.windows.net/',
    endpointName: 'Diagnostics PROD',
    namespace: 'SkypeContentSharing',
    events: 'ServiceTraces',
    defaultClientQuery: 'source\n| sort by PreciseTimeStamp asc',
  },
  csmetrics: {
    endpoint: 'https://production.diagnostics.monitoring.core.windows.net/',
    endpointName: 'Diagnostics PROD',
    namespace: 'SkypeCoreConv',
    events: 'Metrics',
    defaultClientQuery: 'source\n| sort by PreciseTimeStamp asc',
  },
  tsmetrics: {
    endpoint: 'https://production.diagnostics.monitoring.core.windows.net/',
    endpointName: 'Diagnostics PROD',
    namespace: 'TeamsScheduler',
    events: 'Metrics',
    defaultClientQuery: 'source\n| sort by PreciseTimeStamp asc',
  },
};

// ==================== Auth ====================

export interface DGrepTokens {
  cookie: string;
  csrf: string;
}

// ==================== Query Types ====================

export type QueryLanguage = 'KQL';

export type ScopingOperator =
  | 'contains'
  | '!contains'
  | '=='
  | '!='
  | 'equals any of'
  | 'contains any of';

export interface ScopingCondition {
  column: string;
  operator: ScopingOperator;
  value: string;
}

export type OffsetUnit = 'Minutes' | 'Hours' | 'Days';
export type OffsetSign = '+' | '-' | '~';

// ==================== API Request/Response ====================

export interface StartSearchRequest {
  endpoint: string;
  namespaces: string[];
  eventNames: string[];
  startTime: string; // ISO 8601
  endTime: string;   // ISO 8601
  identityColumns: Record<string, string[]>;
  queryID: string;
  queryType: number; // 1 = KQL
  query: string;     // server-side KQL
  searchCriteria: null;
  maxResults: number;
  shimMode: string;  // "Dgrep" — required by Geneva portal API
}

export interface SearchStatusResponse {
  Status: string;
  ResultCount: number;
  ProcessedBlobSize: number;
  ScheduledBlobSize: number;
  ErrorMessage?: string;
}

export interface SearchResultsResponse {
  Count: number;
  Columns: Record<string, number>; // column name → type index
  Rows: Record<string, any>[];
}

// ==================== Session State ====================

export type DGrepSearchStatus =
  | 'idle'
  | 'searching'
  | 'polling'
  | 'fetching'
  | 'complete'
  | 'error'
  | 'cancelled';

export interface DGrepSearchSession {
  sessionId: string;
  status: DGrepSearchStatus;
  statusText?: string;
  queryId?: string;
  endpoint?: string;
  namespaces?: string[];
  eventNames?: string[];
  startTime?: string;
  endTime?: string;
  maxResults?: number;
  resultCount?: number;
  results?: Record<string, any>[];
  columns?: string[];
  error?: string;
  createdAt: string;
}

// ==================== Events ====================

export interface DGrepProgressEvent {
  sessionId: string;
  status: DGrepSearchStatus;
  statusText?: string;
  resultCount?: number;
  progress?: number; // 0-100
}

export interface DGrepCompleteEvent {
  sessionId: string;
  resultCount: number;
  columns: string[];
}

export interface DGrepErrorEvent {
  sessionId: string;
  error: string;
}

// ==================== Options ====================

export interface QueryByLogIdOptions {
  serverQuery?: string;
  clientQuery?: string;
  maxResults?: number;
  limitLines?: number;
  identityColumns?: Record<string, string[]>;
}

export interface QueryOptions {
  endpoint: string;
  namespaces: string[];
  eventNames: string[];
  startTime: string; // ISO 8601
  endTime: string;   // ISO 8601
  serverQuery?: string;
  clientQuery?: string;
  maxResults?: number;
  identityColumns?: Record<string, string[]>;
}

// ==================== Constants ====================

export const DGREP_CONSTANTS = {
  PORTAL_URL: 'https://portal.microsoftgeneva.com',
  DEFAULT_MAX_RESULTS: 500_000,
  POLL_INTERVAL_MS: 1000,
  POLL_TIMEOUT_S: 300,
  MIN_COOKIE_LENGTH: 50,
} as const;
