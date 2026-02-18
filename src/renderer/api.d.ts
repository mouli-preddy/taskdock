/**
 * Application API Interface
 * Exposed as window.electronAPI for backward compatibility
 * Implemented by tauri-api.ts (WebSocket bridge to Node.js backend)
 */
export interface ElectronAPI {
  // Clipboard access (needed for terminal paste/copy)
  readClipboard: () => string;
  writeClipboard: (text: string) => void;

  // ADO API methods
  getToken: () => Promise<string>;
  loadPR: (org: string, project: string, prId: number) => Promise<any>;
  getIterations: (org: string, project: string, repoId: string, prId: number) => Promise<any[]>;
  getChanges: (org: string, project: string, repoId: string, prId: number, iterationId: number) => Promise<any[]>;
  getThreads: (org: string, project: string, repoId: string, prId: number) => Promise<any[]>;
  getFileContent: (org: string, project: string, repoId: string, objectId: string) => Promise<string>;
  getFileFromBranch: (org: string, project: string, repoId: string, path: string, branch: string) => Promise<string | null>;
  createComment: (org: string, project: string, repoId: string, prId: number, filePath: string, startLine: number, endLine: number, content: string) => Promise<any>;
  replyToThread: (org: string, project: string, repoId: string, prId: number, threadId: number, content: string) => Promise<any>;
  updateThreadStatus: (org: string, project: string, repoId: string, prId: number, threadId: number, status: string) => Promise<void>;
  submitVote: (org: string, project: string, repoId: string, prId: number, vote: number) => Promise<void>;
  getMyPRs: (org: string, project: string) => Promise<any[]>;
  getCreatedPRs: (org: string, project: string) => Promise<any[]>;
  getRepoPRs: (org: string, project: string, repositoryName: string) => Promise<any[]>;

  // Work Item methods
  wiQuery: (org: string, project: string, wiql: string) => Promise<number[]>;
  wiRunQueryById: (org: string, project: string, queryId: string) => Promise<number[]>;
  wiGetItems: (org: string, project: string, ids: number[]) => Promise<any[]>;
  wiGetItem: (org: string, project: string, id: number) => Promise<any>;
  wiGetMyItems: (org: string, project: string) => Promise<any[]>;
  wiGetCreatedByMe: (org: string, project: string) => Promise<any[]>;
  wiGetUpdates: (org: string, project: string, id: number) => Promise<any[]>;
  wiGetTypes: (org: string, project: string) => Promise<any[]>;
  wiGetAreaPaths: (org: string, project: string) => Promise<any>;
  wiGetIterationPaths: (org: string, project: string) => Promise<any>;
  wiGetSavedQueries: () => Promise<any[]>;
  wiSaveQuery: (query: any) => Promise<void>;
  wiDeleteQuery: (queryId: string) => Promise<void>;

  // Edit Work Items
  wiUpdate: (org: string, project: string, id: number, operations: any[]) => Promise<any>;
  wiGetComments: (org: string, project: string, id: number) => Promise<any>;
  wiAddComment: (org: string, project: string, id: number, text: string) => Promise<any>;
  wiGetTeamMembers: (org: string, project: string) => Promise<any[]>;
  wiGetTypeStates: (org: string, project: string, workItemType: string) => Promise<any[]>;

  // Attachments
  wiUploadAttachment: (org: string, project: string, workItemId: number, fileName: string, contentBase64: string, comment?: string) => Promise<{ id: string; url: string }>;
  wiRemoveAttachment: (org: string, project: string, workItemId: number, attachmentUrl: string) => Promise<any>;

  // Wiki
  wiGetWikis: (org: string, project: string) => Promise<any[]>;
  wiGetWikiPage: (org: string, project: string, wikiId: string, path: string) => Promise<any>;
  wiCreateWikiPage: (org: string, project: string, wikiId: string, path: string, content: string, version?: string) => Promise<any>;
  wiSearchWiki: (org: string, project: string, searchText: string) => Promise<any[]>;
  wiAddHyperlink: (org: string, project: string, workItemId: number, url: string, comment?: string) => Promise<any>;
  wiRemoveHyperlink: (org: string, project: string, workItemId: number, hyperlinkUrl: string) => Promise<any>;

  // App settings
  getSettings: () => Promise<any>;
  saveSettings: (settings: Record<string, unknown>) => Promise<void>;
  onThemeChange: (callback: (isDark: boolean) => void) => () => void;
  openExternal: (url: string) => Promise<void>;

  // AI Review methods
  aiGetProviders: () => Promise<any[]>;
  aiStartReview: (org: string, project: string, prContext: any, files: any[], threads: any[], request: any, fileContents: any, prContextKey?: string) => Promise<string>;
  aiCancelReview: (sessionId: string) => Promise<void>;
  aiGetSession: (sessionId: string) => Promise<any>;
  aiGetComments: (sessionId: string) => Promise<any[]>;
  aiMarkCommentPublished: (sessionId: string, commentId: string, adoThreadId: number) => Promise<void>;
  aiDismissComment: (sessionId: string, commentId: string) => Promise<void>;
  aiGetWalkthrough: (sessionId: string) => Promise<any>;
  aiGenerateWalkthrough: (org: string, project: string, prContext: any, files: any[], provider: string) => Promise<any>;

  // AI Event listeners
  onAIProgress: (callback: (event: any) => void) => () => void;
  onAIComment: (callback: (event: any) => void) => () => void;
  onAIWalkthrough: (callback: (event: any) => void) => () => void;
  onAIError: (callback: (event: any) => void) => () => void;

  // AI Storage methods
  aiSaveReview: (org: string, project: string, prId: number, sessionId: string) => Promise<void>;
  aiSaveReviewComments: (org: string, project: string, prId: number, comments: any[]) => Promise<void>;
  aiLoadReview: (org: string, project: string, prId: number) => Promise<any>;
  aiHasSavedReview: (org: string, project: string, prId: number) => Promise<any>;
  aiSaveWalkthrough: (org: string, project: string, prId: number, walkthrough: any) => Promise<void>;
  aiLoadWalkthrough: (org: string, project: string, prId: number) => Promise<any>;
  aiHasSavedWalkthrough: (org: string, project: string, prId: number) => Promise<any>;
  aiDeleteSavedData: (org: string, project: string, prId: number) => Promise<void>;

  // Extended AI Storage for multi-session support
  aiListReviews: (org: string, project: string, prId: number) => Promise<any[]>;
  aiLoadReviewSession: (org: string, project: string, prId: number, sessionId: string) => Promise<any>;
  aiDeleteReviewSession: (org: string, project: string, prId: number, sessionId: string) => Promise<void>;
  aiListWalkthroughs: (org: string, project: string, prId: number) => Promise<any[]>;
  aiSaveWalkthroughSession: (
    org: string,
    project: string,
    prId: number,
    sessionId: string,
    displayName: string,
    provider: string,
    walkthrough: any,
    preset?: any,
    customPrompt?: string
  ) => Promise<void>;
  aiLoadWalkthroughSession: (org: string, project: string, prId: number, sessionId: string) => Promise<any>;
  aiDeleteWalkthroughSession: (org: string, project: string, prId: number, sessionId: string) => Promise<void>;
  aiGetSessionsForPR: (prId: number) => Promise<any[]>;
  aiRemoveSession: (sessionId: string) => Promise<void>;

  // Presets
  presetsGetReviewPresets: () => Promise<any[]>;
  presetsSaveReviewPreset: (preset: any) => Promise<any>;
  presetsUpdateReviewPreset: (id: string, updates: any) => Promise<any>;
  presetsDeleteReviewPreset: (id: string) => Promise<boolean>;
  presetsGetWalkthroughPresets: () => Promise<any[]>;
  presetsSaveWalkthroughPreset: (preset: any) => Promise<any>;
  presetsUpdateWalkthroughPreset: (id: string, updates: any) => Promise<any>;
  presetsDeleteWalkthroughPreset: (id: string) => Promise<boolean>;

  // Walkthrough Service
  walkthroughStart: (org: string, project: string, prContext: any, files: any[], threads: any[], request: any, fileContents: any, prContextKey?: string) => Promise<string>;
  walkthroughCancel: (sessionId: string) => Promise<void>;
  walkthroughGetSession: (sessionId: string) => Promise<any>;
  walkthroughGetSessionsForPR: (prId: number) => Promise<any[]>;
  walkthroughRemoveSession: (sessionId: string) => Promise<void>;

  // Walkthrough events
  onWalkthroughProgress: (callback: (event: any) => void) => () => void;
  onWalkthroughComplete: (callback: (event: any) => void) => () => void;
  onWalkthroughError: (callback: (event: any) => void) => () => void;

  // Config API
  loadConfig: () => Promise<{
    ado: {
      organization: string;
      project: string;
      pat: string;
    };
  } | null>;
  saveConfig: (config: {
    ado: {
      organization: string;
      project: string;
      pat: string;
    };
  }) => Promise<void>;
  isConfigured: () => Promise<boolean>;
  testConnection: (org: string, project: string, pat?: string) => Promise<{ success: boolean; error?: string }>;

  // Terminal API
  terminalListSessions: () => Promise<any[]>;
  terminalGetSession: (sessionId: string) => Promise<any>;
  terminalWrite: (sessionId: string, data: string) => void;
  terminalResize: (sessionId: string, cols: number, rows: number) => void;
  terminalKill: (sessionId: string) => Promise<void>;
  terminalRemove: (sessionId: string) => Promise<void>;
  onTerminalSessionCreated: (callback: (event: { session: any }) => void) => () => void;
  onTerminalData: (callback: (event: { sessionId: string; data: string }) => void) => () => void;
  onTerminalExit: (callback: (event: { sessionId: string; exitCode: number }) => void) => () => void;
  onTerminalStatusChange: (callback: (event: { sessionId: string; status: string }) => void) => () => void;
  onTerminalReviewComplete: (callback: (event: { sessionId: string; result: any }) => void) => () => void;

  // Chat Terminal API
  chatTerminalCreate: (options: {
    ai: 'copilot' | 'claude';
    workingDir: string;
    contextPath: string;
    initialPrompt: string;
  }) => Promise<string>;
  chatTerminalGetSession: (sessionId: string) => Promise<{
    id: string;
    ai: 'copilot' | 'claude';
    workingDir: string;
    contextPath: string;
    status: 'starting' | 'running' | 'completed' | 'error';
    createdAt: string;
    error?: string;
  } | null>;
  chatTerminalWrite: (sessionId: string, data: string) => void;
  chatTerminalResize: (sessionId: string, cols: number, rows: number) => void;
  chatTerminalKill: (sessionId: string) => Promise<void>;
  chatTerminalRemove: (sessionId: string) => Promise<void>;
  onChatTerminalSessionCreated: (callback: (event: { session: any }) => void) => () => void;
  onChatTerminalData: (callback: (event: { sessionId: string; data: string }) => void) => () => void;
  onChatTerminalExit: (callback: (event: { sessionId: string; exitCode: number }) => void) => () => void;
  onChatTerminalStatusChange: (callback: (event: { sessionId: string; status: string; error?: string }) => void) => () => void;

  // Console review API
  consoleReviewPrepare: (params: {
    prContext: any;
    files: any[];
    threads: any[];
    fileContents: Record<string, { original: string | null; modified: string | null }>;
  }) => Promise<{
    guid: string;
    contextPath: string;
    workingDir: string;
    hasRepoContext: boolean;
    repoPath?: string;
  }>;
  consoleReviewStart: (params: {
    prepared: any;
    prId: number;
    organization: string;
    project: string;
    label: string;
  }) => Promise<string>;
  consoleReviewCleanup: (contextPath: string) => Promise<void>;
  consoleReviewCleanupWorktree: (params: { mainRepoPath: string; worktreePath: string }) => Promise<void>;
  consoleReviewReadOutput: (contextPath: string) => Promise<{
    review: {
      comments: Array<{
        id: string;
        filePath: string;
        startLine: number;
        endLine: number;
        severity: 'critical' | 'major' | 'minor' | 'trivial';
        category: 'security' | 'bug' | 'performance' | 'style' | 'logic' | 'compliance' | 'recommendation' | 'nitpick' | 'other';
        title: string;
        content: string;
        suggestedFix?: string;
        confidence: number;
      }>;
    } | null;
    walkthrough: {
      summary: string;
      architectureDiagram?: string;
      steps: Array<{
        order: number;
        filePath: string;
        startLine: number;
        endLine: number;
        title: string;
        description: string;
      }>;
    } | null;
  }>;

  // Git API
  gitFindRepo: (repoUrl: string, repoName: string) => Promise<{
    path: string;
    remote: string;
    isExactMatch: boolean;
  } | null>;
  gitListWorktrees: (repoPath: string) => Promise<{
    path: string;
    branch: string;
    head: string;
  }[]>;
  gitGetOriginUrl: (repoPath: string) => Promise<string | null>;
  gitIsRepo: (repoPath: string) => Promise<boolean>;
  gitFindLinkedRepo: (repoUrl: string) => Promise<{
    path: string;
    originUrl: string;
  } | null>;
  gitNormalizeAdoUrl: (url: string) => Promise<string>;

  // Console review settings
  getConsoleReviewSettings: () => Promise<{
    linkedRepositories: { path: string; originUrl: string }[];
    monitoredRepositories: { url: string; name: string; organization: string; project: string; repository: string }[];
    whenRepoFound: 'ask' | 'worktree' | 'tempOnly';
    whenRepoNotFound: 'ask' | 'immediate' | 'clone';
    autoCloseTerminal: boolean;
    showNotification: boolean;
    worktreeCleanup: 'ask' | 'auto' | 'never';
    defaultChatAI: 'copilot' | 'claude';
    generatedFilePatterns: string[];
    enableWorkIQ: boolean;
    applyChanges: {
      provider: 'claude-sdk' | 'claude-terminal' | 'copilot-sdk' | 'copilot-terminal';
      showTerminal: boolean;
      timeoutMinutes: number;
    };
    analyzeComments: {
      provider: 'claude-sdk' | 'claude-terminal' | 'copilot-sdk' | 'copilot-terminal';
      showTerminal: boolean;
      timeoutMinutes: number;
    };
  }>;
  setConsoleReviewSettings: (settings: {
    linkedRepositories: { path: string; originUrl: string }[];
    monitoredRepositories: { url: string; name: string; organization: string; project: string; repository: string }[];
    whenRepoFound: 'ask' | 'worktree' | 'tempOnly';
    whenRepoNotFound: 'ask' | 'immediate' | 'clone';
    autoCloseTerminal: boolean;
    showNotification: boolean;
    worktreeCleanup: 'ask' | 'auto' | 'never';
    defaultChatAI: 'copilot' | 'claude';
    generatedFilePatterns: string[];
    enableWorkIQ: boolean;
    applyChanges: {
      provider: 'claude-sdk' | 'claude-terminal' | 'copilot-sdk' | 'copilot-terminal';
      showTerminal: boolean;
      timeoutMinutes: number;
    };
    analyzeComments: {
      provider: 'claude-sdk' | 'claude-terminal' | 'copilot-sdk' | 'copilot-terminal';
      showTerminal: boolean;
      timeoutMinutes: number;
    };
  }) => Promise<void>;
  browseFolder: () => Promise<string | null>;

  // Logger API
  loggerGetLogs: (lines?: number) => Promise<string>;
  loggerGetLogPath: () => Promise<string>;
  loggerOpenLogFolder: () => Promise<string>;

  // Apply Changes API
  applyChangesInitialize: (prId: number, contextDir: string, worktreePath: string | undefined, prTitle: string, prMetadata?: { org: string; project: string; repository: string; sourceBranch: string }, hasLinkedRepo?: boolean) => Promise<void>;
  applyChangesGetState: (prId: number) => Promise<any>;
  applyChangesQueue: (request: any) => Promise<string>;
  applyChangesRemove: (prId: number, itemId: string) => Promise<void>;
  applyChangesPause: (prId: number) => Promise<void>;
  applyChangesResume: (prId: number) => Promise<void>;
  applyChangesRetry: (prId: number, itemId: string) => Promise<void>;
  applyChangesSkip: (prId: number, itemId: string) => Promise<void>;
  applyChangesClearCompleted: (prId: number) => Promise<void>;
  applyChangesCanApply: (prId: number) => Promise<{ canApply: boolean; reason?: string }>;
  onApplyChangesProgress: (callback: (event: any) => void) => () => void;

  // Fix Tracker API
  fixTrackerLoad: (prId: number, org: string, project: string) => Promise<any>;
  fixTrackerMarkFixed: (prId: number, org: string, project: string, fix: any) => Promise<void>;

  // Polling settings
  getPollingSettings: () => Promise<{
    enabled: boolean;
    intervalSeconds: number;
  }>;
  setPollingSettings: (settings: {
    enabled: boolean;
    intervalSeconds: number;
  }) => Promise<void>;

  // Notification settings
  getNotificationSettings: () => Promise<{
    enabled: boolean;
    aiReviewComplete: boolean;
    aiAnalysisComplete: boolean;
    newComments: boolean;
    newIterations: boolean;
  }>;
  setNotificationSettings: (settings: {
    enabled: boolean;
    aiReviewComplete: boolean;
    aiAnalysisComplete: boolean;
    newComments: boolean;
    newIterations: boolean;
  }) => Promise<void>;

  // PR file cache API
  ensurePRContext: (
    prContext: any,
    files: any[],
    threads: any[],
    lastCommitId: string,
    repoId: string
  ) => Promise<any>;
  getCachedFileContent: (
    prContextKey: string,
    filePath: string,
    version: 'original' | 'modified',
    objectId: string,
    org: string,
    project: string,
    repoId: string
  ) => Promise<string | null>;
  evictPRFromCache: (prContextKey: string) => Promise<void>;
  warmCache: (prContextKey: string, files: Array<{ path: string; objectId?: string; originalObjectId?: string }>, maxFiles?: number) => Promise<void>;
  getCacheStats: () => Promise<any>;

  // Comment Analysis API
  commentAnalysisAnalyze: (
    threads: any[],
    context: { prId: number; org: string; project: string; repoPath?: string },
    provider: string,
    fileContents: Record<string, string>,
    showTerminal?: boolean
  ) => Promise<any>;
  commentAnalysisLoad: (prId: number, org: string, project: string) => Promise<any>;
  commentAnalysisClear: (prId: number, org: string, project: string, threadId: number) => Promise<void>;
  commentAnalysisReanalyze: (
    thread: any,
    context: { prId: number; org: string; project: string; repoPath?: string },
    provider: string,
    fileContents: Record<string, string>,
    showTerminal?: boolean
  ) => Promise<any>;
  onCommentAnalysisProgress: (callback: (event: { prId: number; status: string }) => void) => () => void;

  // CFV API
  cfvSetToken: (token: string) => Promise<void>;
  cfvGetTokenStatus: () => Promise<{ valid: boolean; hasToken: boolean }>;
  cfvFetchCall: (callId: string) => Promise<{ callId: string; outputDir: string; rawFiles: string[]; stats: { callflowMessages: number; diagnosticFiles: number } }>;
  cfvListCachedCalls: () => Promise<Array<{ callId: string; fetchedAt: string; outputDir: string; messageCount: number; diagnosticFiles: number }>>;
  cfvGetCallFlowData: (callId: string) => Promise<any>;
  cfvGetCallDetails: (callId: string) => Promise<any>;
  cfvGetRawFile: (callId: string, filename: string) => Promise<string | null>;
  cfvDeleteCall: (callId: string) => Promise<void>;
  cfvAcquireToken: (options?: { forceVisible?: boolean; timeout?: number }) => Promise<void>;
  cfvCancelTokenAcquisition: () => Promise<void>;
  cfvCheckPlaywright: () => Promise<{ available: boolean; reason?: string }>;
  onCfvProgress: (callback: (event: any) => void) => () => void;
  onCfvTokenProgress: (callback: (event: { status: string; message: string; headless?: boolean; tokenLength?: number; error?: string }) => void) => () => void;
  onCfvTokenResult: (callback: (event: { success: boolean; tokenLength?: number; error?: string }) => void) => () => void;

  // CFV Chat API
  cfvChatCreate: (callId: string, persistentSessionId?: string) => Promise<{ sdkSessionId: string; persistentSessionId: string }>;
  cfvChatSend: (sessionId: string, message: string) => Promise<void>;
  cfvChatGetHistory: (sessionId: string) => Promise<import('../shared/cfv-types.js').CfvChatMessage[]>;
  cfvChatDestroy: (sessionId: string) => Promise<void>;
  cfvChatListSessions: (callId: string) => Promise<{ sessions: import('../shared/cfv-types.js').CfvChatSessionInfo[]; lastActiveSessionId: string | null }>;
  cfvChatLoadSessionMessages: (callId: string, persistentSessionId: string) => Promise<import('../shared/cfv-types.js').CfvChatMessage[]>;
  cfvChatDeleteSession: (callId: string, persistentSessionId: string) => Promise<void>;
  onCfvChatEvent: (callback: (event: import('../shared/cfv-types.js').CfvChatEvent) => void) => () => void;

  // CFV Filter API
  cfvSaveCallFilters: (callId: string, state: import('../shared/cfv-filter-types.js').CallFilterState) => Promise<void>;
  cfvLoadCallFilters: (callId: string) => Promise<import('../shared/cfv-filter-types.js').CallFilterState | null>;
  cfvListFilterPresets: () => Promise<import('../shared/cfv-filter-types.js').FilterPreset[]>;
  cfvSaveFilterPreset: (preset: import('../shared/cfv-filter-types.js').FilterPreset) => Promise<void>;
  cfvDeleteFilterPreset: (presetId: string) => Promise<void>;

  // Plugin API
  pluginGetPlugins: () => Promise<any[]>;
  pluginGetPlugin: (pluginId: string) => Promise<any>;
  pluginExecuteTrigger: (pluginId: string, triggerId: string, input?: any) => Promise<any>;
  pluginSetEnabled: (pluginId: string, enabled: boolean) => Promise<void>;
  pluginSaveConfig: (pluginId: string, config: Record<string, any>) => Promise<void>;
  pluginGetLogs: (pluginId: string) => Promise<any[]>;

  // Plugin Event listeners
  onPluginUIUpdate: (callback: (event: any) => void) => () => void;
  onPluginUIInject: (callback: (event: any) => void) => () => void;
  onPluginUIToast: (callback: (event: any) => void) => () => void;
  onPluginLog: (callback: (event: any) => void) => () => void;
  onPluginExecutionComplete: (callback: (event: any) => void) => () => void;
  onPluginReloaded: (callback: (event: any) => void) => () => void;
  onPluginsReloaded: (callback: (event: any) => void) => () => void;
  onPluginStateChanged: (callback: (event: any) => void) => () => void;
  onPluginNavigate: (callback: (event: { pluginId: string; section: string }) => void) => () => void;

  // ICM Auth methods
  icmAcquireToken: () => Promise<string>;
  icmHasValidToken: () => Promise<boolean>;

  // ICM API methods
  icmGetToken: () => Promise<string>;
  icmGetCurrentUser: () => Promise<any>;
  icmGetPermissions: () => Promise<any>;
  icmResolveContacts: (emails: string[]) => Promise<any[]>;
  icmQueryIncidents: (filter?: string, top?: number, select?: string, expand?: string, orderby?: string) => Promise<any>;
  icmGetIncidentCount: (filter: string) => Promise<number>;
  icmGetIncident: (id: number) => Promise<any>;
  icmGetIncidentBridges: (id: number) => Promise<any[]>;
  icmAcknowledge: (id: number) => Promise<void>;
  icmTransfer: (id: number, teamId: number) => Promise<void>;
  icmMitigate: (id: number) => Promise<void>;
  icmResolve: (id: number) => Promise<void>;
  icmGetDiscussion: (incidentId: number) => Promise<any[]>;
  icmAddDiscussion: (incidentId: number, text: string) => Promise<void>;
  icmGetFavoriteQueries: (ownerId: number, ownerType?: string) => Promise<any[]>;
  icmGetSavedQueries: (contactId: number) => Promise<any[]>;
  icmGetSharedQueries: (contactId: number) => Promise<any[]>;
  icmGetTeams: (ids: number[]) => Promise<any[]>;
  icmSearchTeams: (id: number) => Promise<any[]>;
  icmSearchServices: (id: number) => Promise<any[]>;
  icmGetAlertSources: (alertSourceId: string) => Promise<any>;
  icmGetUserPreferences: (alias: string) => Promise<any>;
  icmGetFeatureFlags: (scope: string, alias: string) => Promise<any>;
  icmGetTeamsChannel: (incidentId: number) => Promise<any>;
  icmGetBreakingNews: () => Promise<any[]>;
  icmGetPropertyGroups: () => Promise<any[]>;
  icmGetCloudInstances: () => Promise<any[]>;

  // DGrep API
  dgrepSearchByLogId: (logId: string, startTime: string, endTime: string, options?: any) => Promise<string>;
  dgrepSearch: (params: any) => Promise<string>;
  dgrepCancelSearch: (sessionId: string) => Promise<void>;
  dgrepGetSession: (sessionId: string) => Promise<any>;
  dgrepGetAllSessions: () => Promise<any[]>;
  dgrepGetResults: (sessionId: string) => Promise<{ columns: string[]; rows: Record<string, any>[] } | undefined>;
  dgrepGetResultsPage: (sessionId: string, offset: number, limit: number) => Promise<{ columns: string[]; rows: Record<string, any>[]; totalCount: number } | undefined>;
  dgrepRunClientQuery: (sessionId: string, clientQuery: string) => Promise<void>;
  dgrepRemoveSession: (sessionId: string) => Promise<void>;
  dgrepGetNamespaces: (endpoint: string) => Promise<string[]>;
  dgrepGetEvents: (endpoint: string, namespace: string) => Promise<string[]>;
  dgrepGenerateUrl: (logId: string, timeCenter: string, serverQuery: string, options?: any) => Promise<string>;
  dgrepGetMonitoringAccounts: () => Promise<any>;

  // DGrep event listeners
  onDgrepProgress: (callback: (event: any) => void) => () => void;
  onDgrepComplete: (callback: (event: any) => void) => () => void;
  onDgrepError: (callback: (event: any) => void) => () => void;
  onDgrepIntermediateResults: (callback: (event: any) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
