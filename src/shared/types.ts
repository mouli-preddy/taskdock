// Azure DevOps API Types

export interface PullRequest {
  pullRequestId: number;
  title: string;
  description: string;
  status: 'active' | 'completed' | 'abandoned' | 'all';
  createdBy: Identity;
  creationDate: string;
  closedDate?: string;
  sourceRefName: string;
  targetRefName: string;
  mergeStatus: string;
  isDraft: boolean;
  repository: Repository;
  reviewers: Reviewer[];
  labels?: Label[];
  url: string;
  supportsIterations: boolean;
}

export interface Identity {
  id: string;
  displayName: string;
  uniqueName: string;
  imageUrl?: string;
  descriptor?: string;
}

export interface Repository {
  id: string;
  name: string;
  url: string;
  remoteUrl?: string;
  project: Project;
}

export interface Project {
  id: string;
  name: string;
  state: string;
}

export interface Reviewer {
  id: string;
  displayName: string;
  uniqueName: string;
  imageUrl?: string;
  vote: number;
  isRequired?: boolean;
  reviewerUrl?: string;
}

export interface Label {
  id: string;
  name: string;
  active: boolean;
}

export interface PullRequestIteration {
  id: number;
  description?: string;
  author: Identity;
  createdDate: string;
  updatedDate: string;
  sourceRefCommit: GitCommitRef;
  targetRefCommit: GitCommitRef;
  commonRefCommit: GitCommitRef;
  hasMoreCommits: boolean;
  reason: string;
}

export interface GitCommitRef {
  commitId: string;
  url?: string;
}

export interface IterationChange {
  changeId: number;
  changeTrackingId: number;
  item: GitItem;
  changeType: ChangeType;
  originalPath?: string;
}

export type ChangeType = 'add' | 'edit' | 'delete' | 'rename' | 'sourceRename' | 'targetRename';

export interface GitItem {
  objectId: string;
  originalObjectId?: string;
  gitObjectType: string;
  commitId?: string;
  path: string;
  isFolder?: boolean;
  url?: string;
}

export interface CommentThread {
  id: number;
  publishedDate: string;
  lastUpdatedDate: string;
  comments: Comment[];
  status: ThreadStatus;
  threadContext?: ThreadContext;
  properties?: Record<string, any>;
  isDeleted: boolean;
}

export type ThreadStatus = 'unknown' | 'active' | 'fixed' | 'wontFix' | 'closed' | 'byDesign' | 'pending';

export interface ThreadContext {
  filePath: string;
  rightFileStart?: FilePosition;
  rightFileEnd?: FilePosition;
  leftFileStart?: FilePosition;
  leftFileEnd?: FilePosition;
}

export interface FilePosition {
  line: number;
  offset: number;
}

export interface Comment {
  id: number;
  parentCommentId: number;
  author: Identity;
  content: string;
  publishedDate: string;
  lastUpdatedDate: string;
  lastContentUpdatedDate: string;
  commentType: 'text' | 'codeChange' | 'system' | 'unknown';
  usersLiked?: Identity[];
  isDeleted: boolean;
}

// App-specific types

export interface FileChange {
  path: string;
  changeType: ChangeType;
  originalContent?: string;
  modifiedContent?: string;
  objectId?: string;
  originalObjectId?: string;
  threads: CommentThread[];
  diffHtml?: string;
}

/**
 * FileChange without content - used for in-memory storage after lazy loading migration.
 * Content is loaded on-demand from disk via PRFileCacheService.
 */
export interface FileChangeMetadata {
  path: string;
  changeType: ChangeType;
  objectId?: string;
  originalObjectId?: string;
  threads: CommentThread[];
}

export interface AppState {
  organization: string;
  project: string;
  prId: number | null;
  pullRequest: PullRequest | null;
  iterations: PullRequestIteration[];
  selectedIteration: number | null;
  fileChanges: FileChange[];
  selectedFile: string | null;
  threads: CommentThread[];
  diffViewMode: 'split' | 'unified' | 'preview';
  theme: 'light' | 'dark' | 'system';
  sidebarCollapsed: boolean;
  loading: boolean;
  error: string | null;
}

export interface ReviewVote {
  vote: number;
  label: string;
  icon: string;
  color: string;
}

export const VOTE_OPTIONS: ReviewVote[] = [
  { vote: 10, label: 'Approve', icon: 'check-circle', color: '#107c10' },
  { vote: 5, label: 'Approve with suggestions', icon: 'check', color: '#498205' },
  { vote: 0, label: 'No vote', icon: 'circle', color: '#605e5c' },
  { vote: -5, label: 'Wait for author', icon: 'clock', color: '#ffaa44' },
  { vote: -10, label: 'Reject', icon: 'x-circle', color: '#d13438' },
];

export function getVoteInfo(vote: number): ReviewVote {
  return VOTE_OPTIONS.find(v => v.vote === vote) || VOTE_OPTIONS[2];
}

// Polling settings for PR tab auto-refresh
export interface PollingSettings {
  enabled: boolean;
  intervalSeconds: number;  // Default: 3600 (60 mins), min: 60, max: 3600
}

export const DEFAULT_POLLING_SETTINGS: PollingSettings = {
  enabled: true,
  intervalSeconds: 3600,
};

// Notification settings for native Windows toast notifications
export interface NotificationSettings {
  enabled: boolean;
  aiReviewComplete: boolean;
  aiAnalysisComplete: boolean;
  newComments: boolean;
  newIterations: boolean;
  taskComplete: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  aiReviewComplete: true,
  aiAnalysisComplete: true,
  newComments: true,
  newIterations: true,
  taskComplete: true,
};

// Apply Changes types
export type ApplyChangeItemStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface ApplyChangeItem {
  id: string;
  prId: number;
  source: 'ado' | 'ai';
  sourceId: string;           // ADO threadId or AI comment id
  filePath: string;
  lineNumber: number;
  commentContent: string;     // Full comment text for AI
  customMessage: string;      // User's additional instructions
  status: ApplyChangeItemStatus;
  commitSha?: string;         // Set on success
  errorMessage?: string;      // Set on failure
  summary?: string;           // AI-generated summary of what was done
  queuedAt: string;           // ISO date string
  startedAt?: string;
  completedAt?: string;
}

export interface ApplyChangesQueueState {
  items: ApplyChangeItem[];
  isPaused: boolean;
  isProcessing: boolean;
  currentItemId: string | null;
  lastUpdated: string;        // ISO date string
}

// Comment Analysis types
export type AnalysisRecommendation = 'fix' | 'reply' | 'clarify';

export interface CommentAnalysis {
  threadId: number;
  recommendation: AnalysisRecommendation;
  reasoning: string;
  fixDescription?: string;
  suggestedCode?: string;
  suggestedMessage?: string;
  analyzedAt: string;
  analyzedBy: string;
}

export interface PRCommentAnalyses {
  prId: number;
  organization: string;
  project: string;
  analyses: CommentAnalysis[];
  lastUpdated: string;
}
