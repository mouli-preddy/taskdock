export interface CfvClientOptions {
  token: string;
  apiBase?: string;
  outputBase?: string;
}

export interface ApiResponse<T> {
  status: number;
  data?: T;
  raw?: string;
  error?: string;
}

export interface PollStatus {
  finished: boolean;
  failed: boolean;
  error?: string;
  data?: Record<string, unknown>;
  componentStatus?: Array<{ name: string; progress: number }>;
}

export interface CallFlowMessage {
  index: number;
  messageId: string;
  reqTime: string;
  respTime: string;
  time: string;
  from: string;
  to: string;
  req: string;
  resp: string;
  reqTitle: string;
  label: string;
  latency: string;
  protocol: string;
  isFailure: boolean;
  hasError: boolean;
  error: string;
  status: string;
  callId: string;
  ltid: string;
  randId: number;
  kind: number;
  associatedCallLegs: string[];
  associatedParticipantIds: string[];
}

export interface CallFlowData {
  callId?: string;
  callInfo?: Record<string, unknown>;
  nrtStreamingIndexAugmentedCall?: {
    fullCallFlow?: {
      messages?: CallFlowMessage[];
    };
  };
}

export interface CallDetailsData {
  finished?: boolean;
  failed?: boolean;
  error?: string;
  callDetails?: {
    id?: string;
    isNgInvolved?: boolean;
    isNgMultiparty?: boolean;
    nerFailureReason?: string;
    asrFailureReason?: string;
    legs?: Array<Record<string, unknown>>;
    qoe?: Array<Record<string, unknown>>;
    mdiag?: Array<Record<string, unknown>>;
    csamod?: Array<Record<string, unknown>>;
    modelCall?: {
      clientEndpoints?: Array<Record<string, unknown>>;
    };
  };
}

export interface FetchProgress {
  step: number;
  totalSteps: number;
  label: string;
  bytesDownloaded?: number;
  percentComplete?: number;
}

export interface FetchResult {
  callId: string;
  outputDir: string;
  rawFiles: string[];
  stats: {
    callflowMessages: number;
    diagnosticFiles: number;
  };
}
