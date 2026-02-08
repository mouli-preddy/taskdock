// AI-powered Code Review Types

export type AIProvider = 'claude' | 'copilot';

// New unified provider type
// Note: 'review' is a pseudo-provider used for walkthroughs generated during AI reviews
export type AIProviderType = 'claude-sdk' | 'claude-terminal' | 'copilot-sdk' | 'copilot-terminal' | 'review';

export interface AIReviewComment {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  severity: 'critical' | 'major' | 'minor' | 'trivial';
  category: 'bug' | 'security' | 'performance' | 'style' | 'logic' | 'compliance' | 'recommendation' | 'nitpick' | 'other';
  title: string;
  content: string;
  suggestedFix?: string;
  confidence: number;
  published: boolean;
  adoThreadId?: number;
  fixedByAI?: boolean;        // Whether this comment was fixed via Apply
  fixedAt?: string;           // When it was fixed
}

export interface ReviewChunk {
  chunkId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  diffContent: string;
  contextBefore?: string;
  contextAfter?: string;
  language: string;
}

export interface WalkthroughStep {
  stepNumber: number;
  title: string;
  description: string; // Supports markdown
  filePath: string;
  startLine: number;
  endLine: number;
  relatedFiles?: string[];
  diagram?: string; // Optional mermaid diagram for this step
}

export interface CodeWalkthrough {
  id: string;
  prId: number;
  summary: string; // Supports markdown
  architectureDiagram?: string; // Optional mermaid diagram showing overall architecture/flow
  steps: WalkthroughStep[];
  totalSteps: number;
  estimatedReadTime: number;
}

export interface AIReviewSession {
  sessionId: string;
  prId: number;
  provider: AIProviderType;
  showTerminal?: boolean; // Only applies to claude-terminal provider
  status: 'idle' | 'preparing' | 'reviewing' | 'complete' | 'error' | 'cancelled';
  statusText?: string;
  contextPath?: string;
  comments: AIReviewComment[];
  walkthrough?: CodeWalkthrough;
  error?: string;
  displayName?: string;
  preset?: ReviewPreset;
  customPrompt?: string;
  createdAt?: string;
  completedAt?: string;
}

// Review preset (built-in or user-created)
export interface ReviewPreset {
  id: string;
  name: string;
  description?: string;
  focusAreas: ('security' | 'performance' | 'bugs' | 'style')[];
  customPrompt?: string;
  isBuiltIn: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Walkthrough preset
export interface WalkthroughPreset {
  id: string;
  name: string;
  description?: string;
  customPrompt?: string;
  isBuiltIn: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Built-in review presets
export const BUILT_IN_REVIEW_PRESETS: ReviewPreset[] = [
  {
    id: 'quick-scan',
    name: 'Quick Scan',
    description: 'Fast overview of all areas',
    focusAreas: ['security', 'performance', 'bugs', 'style'],
    isBuiltIn: true,
  },
  {
    id: 'security-audit',
    name: 'Security Audit',
    description: 'Focus on security vulnerabilities',
    focusAreas: ['security'],
    customPrompt: 'Pay special attention to authentication, authorization, input validation, and data exposure.',
    isBuiltIn: true,
  },
  {
    id: 'performance-review',
    name: 'Performance Review',
    description: 'Focus on performance issues',
    focusAreas: ['performance'],
    customPrompt: 'Look for N+1 queries, unnecessary re-renders, memory leaks, and inefficient algorithms.',
    isBuiltIn: true,
  },
  {
    id: 'bug-hunt',
    name: 'Bug Hunt',
    description: 'Focus on potential bugs and edge cases',
    focusAreas: ['bugs'],
    customPrompt: 'Look for edge cases, null pointer issues, race conditions, and logic errors.',
    isBuiltIn: true,
  },
  {
    id: 'code-style',
    name: 'Code Style',
    description: 'Focus on style and maintainability',
    focusAreas: ['style'],
    customPrompt: 'Focus on code readability, naming conventions, and maintainability.',
    isBuiltIn: true,
  },
];

// Built-in walkthrough presets
export const BUILT_IN_WALKTHROUGH_PRESETS: WalkthroughPreset[] = [
  {
    id: 'full-overview',
    name: 'Full Overview',
    description: 'Complete PR walkthrough',
    isBuiltIn: true,
  },
  {
    id: 'architecture-changes',
    name: 'Architecture Changes',
    description: 'Focus on structural changes',
    customPrompt: 'Focus on explaining architectural decisions, component relationships, and structural changes.',
    isBuiltIn: true,
  },
  {
    id: 'data-flow',
    name: 'Data Flow',
    description: 'Explain how data moves through changes',
    customPrompt: 'Trace how data flows through the changed code, from input to output.',
    isBuiltIn: true,
  },
  {
    id: 'testing-strategy',
    name: 'Testing Strategy',
    description: 'Explain what tests cover',
    customPrompt: 'Explain the testing approach, what scenarios are covered, and any gaps.',
    isBuiltIn: true,
  },
];

// Walkthrough session for standalone walkthroughs
export interface WalkthroughSession {
  id: string;
  prId: number;
  name: string;
  provider: AIProviderType;
  showTerminal?: boolean;
  status: 'preparing' | 'generating' | 'complete' | 'error' | 'cancelled';
  statusText?: string;
  contextPath?: string;
  walkthrough?: CodeWalkthrough;
  preset?: WalkthroughPreset;
  customPrompt?: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

// Request for standalone walkthrough
export interface WalkthroughRequest {
  prId: number;
  provider: AIProviderType;
  preset?: WalkthroughPreset;
  customPrompt?: string;
  showTerminal?: boolean;
  displayName: string;
  generatedFilePatterns?: string[]; // Patterns for auto-generated files
  enableWorkIQ?: boolean; // Enable WorkIQ to gather recent related information
}

// Walkthrough progress event
export interface WalkthroughProgressEvent {
  sessionId: string;
  status: WalkthroughSession['status'];
  statusText?: string;
}

// Walkthrough complete event
export interface WalkthroughCompleteEvent {
  sessionId: string;
  walkthrough: CodeWalkthrough;
}

// Walkthrough error event
export interface WalkthroughErrorEvent {
  sessionId: string;
  error: string;
}

// Metadata types for listing saved reviews/walkthroughs
export interface SavedReviewMetadata {
  sessionId: string;
  displayName: string;
  provider: AIProviderType;
  preset?: ReviewPreset;
  customPrompt?: string;
  commentCount: number;
  createdAt: string;
  savedAt: string;
}

export interface SavedWalkthroughMetadata {
  sessionId: string;
  displayName: string;
  provider: AIProviderType;
  preset?: WalkthroughPreset;
  customPrompt?: string;
  stepCount: number;
  estimatedReadTime: number;
  createdAt: string;
  savedAt: string;
}

export interface AIReviewOptions {
  provider: AIProvider;
  reviewDepth: 'quick' | 'standard' | 'thorough';
  focusAreas?: ('security' | 'performance' | 'bugs' | 'style')[];
  includeWalkthrough?: boolean;
}

// Request from renderer to start a review
export interface AIReviewRequest {
  prId: number;
  provider: AIProviderType;
  depth: 'quick' | 'standard' | 'thorough';
  focusAreas: ('security' | 'performance' | 'bugs' | 'style')[];
  generateWalkthrough: boolean;
  showTerminal?: boolean; // Only applies to claude-terminal provider
  preset?: ReviewPreset;
  customPrompt?: string;
  displayName?: string;
  generatedFilePatterns?: string[]; // Patterns for auto-generated files
  enableWorkIQ?: boolean; // Enable WorkIQ to gather recent related information
}

// Context folder info passed to executors
export interface ReviewContextInfo {
  guid: string;
  contextPath: string;  // Where to READ files from (original/, modified/, context/)
  outputPath: string;   // Where to WRITE output (review.json, walkthrough.json)
  workingDir: string;   // Where to run Claude from (worktree or contextPath)
  hasRepoContext: boolean;
  repoPath?: string;
  worktreeCreated?: boolean;
  mainRepoPath?: string;
}

// Executor options
export interface ReviewExecutorOptions {
  depth: 'quick' | 'standard' | 'thorough';
  focusAreas: string[];
  generateWalkthrough: boolean;
  walkthroughOnly?: boolean; // When true, only generate walkthrough (no review comments)
  walkthroughPrompt?: string; // Custom prompt for walkthrough generation
  generatedFilePatterns?: string[]; // Patterns for auto-generated files (e.g., *.g.cs, *.json)
  enableWorkIQ?: boolean; // When true, use WorkIQ to gather recent related information
  onStatusChange?: (status: string) => void;
  customPrompt?: string; // When set, use this prompt instead of building review prompt
  customOutputFile?: string; // When set with customPrompt, read raw output from this file
}

// Result from executors
export interface ReviewExecutorResult {
  comments: AIReviewComment[];
  walkthrough?: CodeWalkthrough;
  error?: string;
  rawOutput?: string; // Raw output when using customPrompt
}

export interface PRContext {
  prId: number;
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
  repository: string;
  org?: string;
  project?: string;
}

export interface FileContext {
  path: string;
  language: string;
  fullContent?: string;
}

export interface ReviewContext {
  pr: PRContext;
  file: FileContext;
  depth: 'quick' | 'standard' | 'thorough';
  focusAreas?: ('security' | 'performance' | 'bugs' | 'style')[];
}

// Provider availability status
export interface AIProviderStatus {
  provider: AIProvider;
  available: boolean;
  error?: string;
}

// IPC Event types for AI features
export interface AIProgressEvent {
  sessionId: string;
  status: 'preparing' | 'reviewing' | 'complete' | 'error' | 'cancelled';
  statusText?: string;
}

export interface AICommentEvent {
  sessionId: string;
  comment: AIReviewComment;
}

export interface AIWalkthroughEvent {
  sessionId: string;
  walkthrough: CodeWalkthrough;
}

export interface AIErrorEvent {
  sessionId: string;
  error: string;
}

// Saved review/walkthrough info types
export interface SavedReviewInfo {
  exists: boolean;
  savedAt?: string;
  commentCount?: number;
}

export interface SavedWalkthroughInfo {
  exists: boolean;
  savedAt?: string;
}

export interface SavedReview {
  sessionId: string;
  prId: number;
  organization: string;
  project: string;
  provider: AIProvider;
  savedAt: string;
  comments: AIReviewComment[];
}

export interface SavedWalkthrough {
  walkthrough: CodeWalkthrough;
  organization: string;
  project: string;
  savedAt: string;
}

// Severity colors and icons
export const SEVERITY_CONFIG = {
  critical: {
    color: '#d13438',
    bgColor: '#d1343820',
    icon: 'alert-circle',
    label: 'Critical',
  },
  major: {
    color: '#ffaa44',
    bgColor: '#ffaa4420',
    icon: 'alert-triangle',
    label: 'Major',
  },
  minor: {
    color: '#0078d4',
    bgColor: '#0078d420',
    icon: 'lightbulb',
    label: 'Minor',
  },
  trivial: {
    color: '#888888',
    bgColor: '#88888820',
    icon: 'info',
    label: 'Trivial',
  },
} as const;

// Category labels
export const CATEGORY_LABELS: Record<AIReviewComment['category'], string> = {
  bug: 'Bug',
  security: 'Security',
  performance: 'Performance',
  style: 'Style',
  logic: 'Logic',
  compliance: 'Compliance',
  recommendation: 'Recommendation',
  nitpick: 'Nitpick',
  other: 'Other',
};

// Fix tracking types
export interface FixedComment {
  commentId: string;           // ID of the comment (AI comment ID or ADO thread ID)
  commentType: 'ai' | 'ado';   // Whether it's an AI comment or ADO thread
  fixedAt: string;             // ISO timestamp when fixed
  filePath: string;            // File where fix was applied
  startLine: number;           // Line number where fix was applied
}

export interface PRFixTracker {
  prId: number;
  organization: string;
  project: string;
  fixes: FixedComment[];       // All fixes applied for this PR
  lastUpdated: string;         // ISO timestamp of last update
}
