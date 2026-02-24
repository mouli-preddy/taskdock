// DGrep AI Analysis Types

// ==================== Pattern Trends ====================

export type PatternTrendDirection = 'increasing' | 'decreasing' | 'periodic' | 'stable' | 'stopped';

export interface DGrepPatternTrend {
  pattern: string;
  count: number;
  trend: PatternTrendDirection;
  firstSeen: string;
  lastSeen: string;
  /** Percentage of total rows matching this pattern */
  percentage: number;
}

// ==================== AI Summary ====================

export interface DGrepAISummary {
  /** High-level narrative in markdown */
  narrative: string;
  /** Breakdown of error types found */
  errorBreakdown: Array<{
    errorType: string;
    count: number;
    severity: 'critical' | 'error' | 'warning' | 'info';
    sampleMessage: string;
  }>;
  /** Top recurring patterns with trend analysis */
  topPatterns: DGrepPatternTrend[];
  /** Time-based correlations found in the logs */
  timeCorrelations: Array<{
    description: string;
    startTime: string;
    endTime: string;
    affectedRows: number;
  }>;
  /** Total rows analyzed */
  totalRowsAnalyzed: number;
  /** Time range of the analyzed data */
  timeRange: { start: string; end: string };
  /** Investigated issues with brief root cause and link to detailed analysis */
  issues?: Array<{
    id: string;
    title: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    occurrences: number;
    briefRootCause: string;
    detailedAnalysisPath: string;
  }>;
}

// ==================== Root Cause Analysis ====================

export interface DGrepRootCauseAnalysis {
  /** The identified root cause */
  rootCause: string;
  /** Confidence level 0-1 */
  confidence: number;
  /** Severity classification */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Evidence timeline leading to the root cause */
  evidenceTimeline: Array<{
    timestamp: string;
    description: string;
    rowIndex: number;
    relevance: 'direct' | 'contributing' | 'context';
  }>;
  /** Indices of rows linked to this analysis */
  linkedRows: number[];
  /** Recommended actions */
  recommendation: string;
  /** Additional context from tool-use exploration */
  additionalFindings?: string;
}

// ==================== Anomaly Detection ====================

export interface DGrepAnomalyResult {
  /** Indices of anomalous rows */
  anomalyIndices: number[];
  /** Explanations for each anomaly */
  explanations: Array<{
    rowIndex: number;
    reason: string;
    anomalyType: 'timing' | 'frequency' | 'content' | 'sequence' | 'missing';
    severity: 'high' | 'medium' | 'low';
  }>;
  /** Summary of anomaly patterns */
  summary: string;
}

// ==================== Chat ====================

export interface DGrepChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  status?: 'streaming' | 'complete' | 'error';
}

export interface DGrepChatEvent {
  chatSessionId: string;
  type: 'delta' | 'complete' | 'idle' | 'error' | 'tool_call' | 'tool_result';
  messageId?: string;
  deltaContent?: string;
  fullContent?: string;
  toolName?: string;
  error?: string;
}

// ==================== NL-to-KQL ====================

export interface DGrepNLToKQLResult {
  kql: string;
  explanation: string;
}

// ==================== Saved Queries ====================

export interface DGrepSavedQuery {
  id: string;
  name: string;
  description?: string;
  endpoint: string;
  namespaces: string[];
  eventNames: string[];
  serverQuery?: string;
  clientQuery?: string;
  createdAt: string;
  updatedAt: string;
}

// ==================== Improve Display ====================

export interface ImproveDisplayColumn {
  name: string;
  visible: boolean;
  order: number;
  width?: number;
}

export interface ImproveDisplayFormatter {
  column: string;
  description: string;
  jsFunction: string; // function body: (text) => html string
}

export interface ImproveDisplayResult {
  columns: ImproveDisplayColumn[];
  formatters: ImproveDisplayFormatter[];
  /** Pre-formatted values computed on the backend. Maps column name → { rawValue → formattedText } */
  formattedLookup?: Record<string, Record<string, string>>;
}
