/**
 * Tauri API Bridge
 * 
 * This module replaces the Electron preload/contextBridge
 * and provides the same API via WebSocket to the Node.js backend.
 */

const WS_PORT = 5198;
let ws: WebSocket | null = null;
let messageId = 0;
const pendingCalls = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
const eventListeners = new Map<string, Set<(data: any) => void>>();
let connectionPromise: Promise<void> | null = null;
let reconnectTimeout: number | null = null;

function connect(): Promise<void> {
  if (connectionPromise) return connectionPromise;
  
  connectionPromise = new Promise((resolve, reject) => {
    const wsUrl = `ws://localhost:${WS_PORT}`;
    console.log('Connecting to backend bridge:', wsUrl);
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('Connected to backend bridge');
      resolve();
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        if (message.type === 'rpc-response') {
          const pending = pendingCalls.get(message.id);
          if (pending) {
            pendingCalls.delete(message.id);
            if (message.error) {
              pending.reject(new Error(message.error));
            } else {
              pending.resolve(message.result);
            }
          }
        } else if (message.type === 'event') {
          const listeners = eventListeners.get(message.event);
          if (listeners) {
            for (const listener of listeners) {
              try {
                listener(message.data);
              } catch (error) {
                console.error('Event listener error:', error);
              }
            }
          }
        }
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('Disconnected from backend bridge');
      ws = null;
      connectionPromise = null;
      
      // Attempt to reconnect after a delay
      if (!reconnectTimeout) {
        reconnectTimeout = window.setTimeout(() => {
          reconnectTimeout = null;
          connect().catch(console.error);
        }, 2000);
      }
    };

    // Timeout connection attempt
    setTimeout(() => {
      if (ws?.readyState !== WebSocket.OPEN) {
        reject(new Error('Connection timeout'));
      }
    }, 5000);
  });

  return connectionPromise;
}

async function invoke(method: string, ...params: any[]): Promise<any> {
  return invokeWithTimeout(60000, method, ...params);
}

async function invokeWithTimeout(timeoutMs: number, method: string, ...params: any[]): Promise<any> {
  await connect();

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('Not connected to backend');
  }

  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pendingCalls.set(id, { resolve, reject });

    ws!.send(JSON.stringify({
      type: 'rpc',
      id,
      method,
      params,
    }));

    setTimeout(() => {
      if (pendingCalls.has(id)) {
        pendingCalls.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }
    }, timeoutMs);
  });
}

function subscribe(event: string, callback: (data: any) => void): () => void {
  if (!eventListeners.has(event)) {
    eventListeners.set(event, new Set());
  }
  eventListeners.get(event)!.add(callback);
  
  return () => {
    eventListeners.get(event)?.delete(callback);
  };
}

// Export the same API shape as Electron's contextBridge
export const tauriAPI = {
  // Clipboard - use browser clipboard API
  readClipboard: async () => {
    return navigator.clipboard.readText();
  },
  writeClipboard: async (text: string) => {
    await navigator.clipboard.writeText(text);
  },

  // ADO API methods
  getToken: () => invoke('ado:get-token'),
  loadPR: (org: string, project: string, prId: number) =>
    invoke('ado:load-pr', org, project, prId),
  getIterations: (org: string, project: string, repoId: string, prId: number) =>
    invoke('ado:get-iterations', org, project, repoId, prId),
  getChanges: (org: string, project: string, repoId: string, prId: number, iterationId: number) =>
    invoke('ado:get-changes', org, project, repoId, prId, iterationId),
  getThreads: (org: string, project: string, repoId: string, prId: number) =>
    invoke('ado:get-threads', org, project, repoId, prId),
  getFileContent: (org: string, project: string, repoId: string, objectId: string) =>
    invoke('ado:get-file-content', org, project, repoId, objectId),
  getFileFromBranch: (org: string, project: string, repoId: string, path: string, branch: string) =>
    invoke('ado:get-file-from-branch', org, project, repoId, path, branch),
  createComment: (org: string, project: string, repoId: string, prId: number, filePath: string, startLine: number, endLine: number, content: string) =>
    invoke('ado:create-comment', org, project, repoId, prId, filePath, startLine, endLine, content),
  replyToThread: (org: string, project: string, repoId: string, prId: number, threadId: number, content: string) =>
    invoke('ado:reply-to-thread', org, project, repoId, prId, threadId, content),
  updateThreadStatus: (org: string, project: string, repoId: string, prId: number, threadId: number, status: string) =>
    invoke('ado:update-thread-status', org, project, repoId, prId, threadId, status),
  submitVote: (org: string, project: string, repoId: string, prId: number, vote: number) =>
    invoke('ado:submit-vote', org, project, repoId, prId, vote),

  // App settings
  getSettings: () => invoke('app:get-settings'),
  saveSettings: (settings: Record<string, unknown>) => invoke('app:save-settings', settings),

  // Theme listener - use CSS media queries
  onThemeChange: (callback: (isDark: boolean) => void) => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => callback(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  },

  // Open external URL - use Tauri shell plugin
  openExternal: async (url: string) => {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  },

  // PR list methods
  getMyPRs: (org: string, project: string) =>
    invoke('ado:get-my-prs', org, project),
  getCreatedPRs: (org: string, project: string) =>
    invoke('ado:get-created-prs', org, project),
  getCreatedPRsForRepo: (org: string, project: string, repositoryName: string) =>
    invoke('ado:get-created-prs-for-repo', org, project, repositoryName),
  getRepoPRs: (org: string, project: string, repositoryName: string) =>
    invoke('ado:get-repo-prs', org, project, repositoryName),

  // Work Item methods
  wiQuery: (org: string, project: string, wiql: string) =>
    invoke('wi:query', org, project, wiql),
  wiRunQueryById: (org: string, project: string, queryId: string) =>
    invoke('wi:run-query-by-id', org, project, queryId),
  wiGetItems: (org: string, project: string, ids: number[]) =>
    invoke('wi:get-items', org, project, ids),
  wiGetItem: (org: string, project: string, id: number) =>
    invoke('wi:get-item', org, project, id),
  // Tasks
  tasksGetAll: () =>
    invoke('tasks:get-all'),
  tasksSave: (task: any) =>
    invoke('tasks:save', task),
  tasksDelete: (id: string) =>
    invoke('tasks:delete', id),
  tasksParseRaw: (raw: string) =>
    invoke('tasks:parse-raw', raw),
  tasksRunNow: (id: string) =>
    invoke('tasks:run-now', id),
  tasksToggleAi: (id: string, enabled: boolean) =>
    invoke('tasks:toggle-ai', id, enabled),
  tasksReadLog: (logFile: string) =>
    invoke('tasks:read-log', logFile),
  tasksExport: (ids: string[]) =>
    invoke('tasks:export', ids),
  tasksImport: (jsonContent: string) =>
    invoke('tasks:import', jsonContent),

  wiGetMyItems: (org: string, project: string) =>
    invoke('wi:get-my-items', org, project),
  wiGetCreatedByMe: (org: string, project: string) =>
    invoke('wi:get-created-by-me', org, project),
  wiGetGroupedByType: (org: string, project: string, wiql: string) =>
    invoke('wi:get-grouped-by-type', org, project, wiql),
  wiGetUpdates: (org: string, project: string, id: number) =>
    invoke('wi:get-updates', org, project, id),
  wiGetTypes: (org: string, project: string) =>
    invoke('wi:get-types', org, project),
  wiGetAreaPaths: (org: string, project: string) =>
    invoke('wi:get-area-paths', org, project),
  wiGetIterationPaths: (org: string, project: string) =>
    invoke('wi:get-iteration-paths', org, project),
  wiGetSavedQueries: () =>
    invoke('wi:get-saved-queries'),
  wiSaveQuery: (query: any) =>
    invoke('wi:save-query', query),
  wiDeleteQuery: (queryId: string) =>
    invoke('wi:delete-query', queryId),

  // Edit Work Items
  wiUpdate: (org: string, project: string, id: number, operations: any[]) =>
    invoke('wi:update', org, project, id, operations),
  wiGetComments: (org: string, project: string, id: number) =>
    invoke('wi:get-comments', org, project, id),
  wiAddComment: (org: string, project: string, id: number, text: string) =>
    invoke('wi:add-comment', org, project, id, text),
  wiGetTeamMembers: (org: string, project: string) =>
    invoke('wi:get-team-members', org, project),
  wiGetTypeStates: (org: string, project: string, workItemType: string) =>
    invoke('wi:get-type-states', org, project, workItemType),

  // Attachments
  wiUploadAttachment: (org: string, project: string, workItemId: number, fileName: string, contentBase64: string, comment?: string) =>
    invoke('wi:upload-attachment', org, project, workItemId, fileName, contentBase64, comment),
  wiRemoveAttachment: (org: string, project: string, workItemId: number, attachmentUrl: string) =>
    invoke('wi:remove-attachment', org, project, workItemId, attachmentUrl),

  // Wiki
  wiGetWikis: (org: string, project: string) =>
    invoke('wi:get-wikis', org, project),
  wiGetWikiPage: (org: string, project: string, wikiId: string, path: string) =>
    invoke('wi:get-wiki-page', org, project, wikiId, path),
  wiCreateWikiPage: (org: string, project: string, wikiId: string, path: string, content: string, version?: string) =>
    invoke('wi:create-wiki-page', org, project, wikiId, path, content, version),
  wiSearchWiki: (org: string, project: string, searchText: string) =>
    invoke('wi:search-wiki', org, project, searchText),
  wiAddHyperlink: (org: string, project: string, workItemId: number, url: string, comment?: string) =>
    invoke('wi:add-hyperlink', org, project, workItemId, url, comment),
  wiRemoveHyperlink: (org: string, project: string, workItemId: number, hyperlinkUrl: string) =>
    invoke('wi:remove-hyperlink', org, project, workItemId, hyperlinkUrl),

  // AI Review methods
  aiGetProviders: () => invoke('ai:get-providers'),
  aiStartReview: (org: string, project: string, prContext: any, files: any[], threads: any[], request: any, fileContents: any, prContextKey?: string) =>
    invoke('ai:start-review', org, project, prContext, files, threads, request, fileContents, prContextKey),
  aiCancelReview: (sessionId: string) =>
    invoke('ai:cancel-review', sessionId),
  aiGetSession: (sessionId: string) =>
    invoke('ai:get-session', sessionId),
  aiGetComments: (sessionId: string) =>
    invoke('ai:get-comments', sessionId),
  aiMarkCommentPublished: (sessionId: string, commentId: string, adoThreadId: number) =>
    invoke('ai:mark-comment-published', sessionId, commentId, adoThreadId),
  aiDismissComment: (sessionId: string, commentId: string) =>
    invoke('ai:dismiss-comment', sessionId, commentId),
  aiGetWalkthrough: (sessionId: string) =>
    invoke('ai:get-walkthrough', sessionId),
  aiGenerateWalkthrough: (org: string, project: string, prContext: any, files: any[], provider: string) =>
    invoke('ai:generate-walkthrough', org, project, prContext, files, provider),

  // AI event listeners
  onAIProgress: (callback: (event: any) => void) => subscribe('ai:progress', callback),
  onAIComment: (callback: (event: any) => void) => subscribe('ai:comment', callback),
  onAIWalkthrough: (callback: (event: any) => void) => subscribe('ai:walkthrough', callback),
  onAIError: (callback: (event: any) => void) => subscribe('ai:error', callback),

  // AI Storage methods
  aiSaveReview: (org: string, project: string, prId: number, sessionId: string) =>
    invoke('ai:save-review', org, project, prId, sessionId),
  aiSaveReviewComments: (org: string, project: string, prId: number, comments: any[]) =>
    invoke('ai:save-review-comments', org, project, prId, comments),
  aiLoadReview: (org: string, project: string, prId: number) =>
    invoke('ai:load-review', org, project, prId),
  aiHasSavedReview: (org: string, project: string, prId: number) =>
    invoke('ai:has-saved-review', org, project, prId),
  aiSaveWalkthrough: (org: string, project: string, prId: number, walkthrough: any) =>
    invoke('ai:save-walkthrough', org, project, prId, walkthrough),
  aiLoadWalkthrough: (org: string, project: string, prId: number) =>
    invoke('ai:load-walkthrough', org, project, prId),
  aiHasSavedWalkthrough: (org: string, project: string, prId: number) =>
    invoke('ai:has-saved-walkthrough', org, project, prId),
  aiDeleteSavedData: (org: string, project: string, prId: number) =>
    invoke('ai:delete-saved-data', org, project, prId),

  // Extended storage API for multi-session support
  aiListReviews: (org: string, project: string, prId: number) =>
    invoke('ai:list-reviews', org, project, prId),
  aiLoadReviewSession: (org: string, project: string, prId: number, sessionId: string) =>
    invoke('ai:load-review-session', org, project, prId, sessionId),
  aiDeleteReviewSession: (org: string, project: string, prId: number, sessionId: string) =>
    invoke('ai:delete-review-session', org, project, prId, sessionId),
  aiListWalkthroughs: (org: string, project: string, prId: number) =>
    invoke('ai:list-walkthroughs', org, project, prId),
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
  ) =>
    invoke('ai:save-walkthrough-session', org, project, prId, sessionId, displayName, provider, walkthrough, preset, customPrompt),
  aiLoadWalkthroughSession: (org: string, project: string, prId: number, sessionId: string) =>
    invoke('ai:load-walkthrough-session', org, project, prId, sessionId),
  aiDeleteWalkthroughSession: (org: string, project: string, prId: number, sessionId: string) =>
    invoke('ai:delete-walkthrough-session', org, project, prId, sessionId),
  aiGetSessionsForPR: (prId: number) => invoke('ai:get-sessions-for-pr', prId),
  aiRemoveSession: (sessionId: string) => invoke('ai:remove-session', sessionId),

  // Preset API
  presetsGetReviewPresets: () => invoke('presets:get-review-presets'),
  presetsSaveReviewPreset: (preset: any) => invoke('presets:save-review-preset', preset),
  presetsUpdateReviewPreset: (id: string, updates: any) => invoke('presets:update-review-preset', id, updates),
  presetsDeleteReviewPreset: (id: string) => invoke('presets:delete-review-preset', id),
  presetsGetWalkthroughPresets: () => invoke('presets:get-walkthrough-presets'),
  presetsSaveWalkthroughPreset: (preset: any) => invoke('presets:save-walkthrough-preset', preset),
  presetsUpdateWalkthroughPreset: (id: string, updates: any) => invoke('presets:update-walkthrough-preset', id, updates),
  presetsDeleteWalkthroughPreset: (id: string) => invoke('presets:delete-walkthrough-preset', id),

  // Walkthrough Service API
  walkthroughStart: (org: string, project: string, prContext: any, files: any[], threads: any[], request: any, fileContents: any, prContextKey?: string) =>
    invoke('walkthrough:start', org, project, prContext, files, threads, request, fileContents, prContextKey),
  walkthroughCancel: (sessionId: string) => invoke('walkthrough:cancel', sessionId),
  walkthroughGetSession: (sessionId: string) => invoke('walkthrough:get-session', sessionId),
  walkthroughGetSessionsForPR: (prId: number) => invoke('walkthrough:get-sessions-for-pr', prId),
  walkthroughRemoveSession: (sessionId: string) => invoke('walkthrough:remove-session', sessionId),

  // Walkthrough event listeners
  onWalkthroughProgress: (callback: (event: any) => void) => subscribe('walkthrough:progress', callback),
  onWalkthroughComplete: (callback: (event: any) => void) => subscribe('walkthrough:complete', callback),
  onWalkthroughError: (callback: (event: any) => void) => subscribe('walkthrough:error', callback),

  // Config API
  loadConfig: async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('load_config');
  },
  saveConfig: async (config: any) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('save_config', { config });
  },
  isConfigured: async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('is_configured');
  },
  testConnection: (org: string, project: string, pat?: string) =>
    invoke('config:test-connection', org, project, pat),

  // Terminal API
  terminalListSessions: () => invoke('terminal:list-sessions'),
  terminalGetSession: (sessionId: string) => invoke('terminal:get-session', sessionId),
  terminalWrite: (sessionId: string, data: string) => invoke('terminal:write', sessionId, data),
  terminalResize: (sessionId: string, cols: number, rows: number) => invoke('terminal:resize', sessionId, cols, rows),
  terminalKill: (sessionId: string) => invoke('terminal:kill', sessionId),
  terminalRemove: (sessionId: string) => invoke('terminal:remove', sessionId),

  // Terminal event listeners
  onTerminalSessionCreated: (callback: (event: { session: any }) => void) =>
    subscribe('terminal:session-created', callback),
  onTerminalData: (callback: (event: { sessionId: string; data: string }) => void) =>
    subscribe('terminal:data', callback),
  onTerminalExit: (callback: (event: { sessionId: string; exitCode: number }) => void) =>
    subscribe('terminal:exit', callback),
  onTerminalStatusChange: (callback: (event: { sessionId: string; status: string }) => void) =>
    subscribe('terminal:status-change', callback),
  onTerminalReviewComplete: (callback: (event: { sessionId: string; result: any }) => void) =>
    subscribe('terminal:review-complete', callback),

  // Chat Terminal API
  chatTerminalCreate: (options: { ai: 'copilot' | 'claude'; workingDir: string; contextPath: string; initialPrompt: string }) =>
    invoke('chat-terminal:create', options),
  chatTerminalGetSession: (sessionId: string) =>
    invoke('chat-terminal:get-session', sessionId),
  chatTerminalWrite: (sessionId: string, data: string) =>
    invoke('chat-terminal:write', sessionId, data),
  chatTerminalResize: (sessionId: string, cols: number, rows: number) =>
    invoke('chat-terminal:resize', sessionId, cols, rows),
  chatTerminalKill: (sessionId: string) =>
    invoke('chat-terminal:kill', sessionId),
  chatTerminalRemove: (sessionId: string) =>
    invoke('chat-terminal:remove', sessionId),

  // Chat Terminal event listeners
  onChatTerminalSessionCreated: (callback: (event: { session: any }) => void) =>
    subscribe('chat-terminal:session-created', callback),
  onChatTerminalData: (callback: (event: { sessionId: string; data: string }) => void) =>
    subscribe('chat-terminal:data', callback),
  onChatTerminalExit: (callback: (event: { sessionId: string; exitCode: number }) => void) =>
    subscribe('chat-terminal:exit', callback),
  onChatTerminalStatusChange: (callback: (event: { sessionId: string; status: string; error?: string }) => void) =>
    subscribe('chat-terminal:status-change', callback),

  // Console review API
  consoleReviewPrepare: (params: { prContext: any; files: any[]; threads: any[]; fileContents: Record<string, { original: string | null; modified: string | null }> }) =>
    invoke('console-review:prepare', params),
  consoleReviewStart: (params: { prepared: any; prId: number; organization: string; project: string; label: string }) =>
    invoke('console-review:start', params),
  consoleReviewCleanup: (contextPath: string) =>
    invoke('console-review:cleanup', contextPath),
  consoleReviewCleanupWorktree: (params: { mainRepoPath: string; worktreePath: string }) =>
    invoke('console-review:cleanup-worktree', params),
  consoleReviewReadOutput: async (contextPath: string) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('read_review_output', { context_path: contextPath });
  },

  // Git API
  gitFindRepo: (repoUrl: string, repoName: string) =>
    invoke('git:find-repo', { repoUrl, repoName }),
  gitListWorktrees: (repoPath: string) =>
    invoke('git:list-worktrees', repoPath),
  gitGetOriginUrl: (repoPath: string) =>
    invoke('git:get-origin-url', repoPath),
  gitIsRepo: (repoPath: string) =>
    invoke('git:is-repo', repoPath),
  gitFindLinkedRepo: (repoUrl: string) =>
    invoke('git:find-linked-repo', repoUrl),
  gitNormalizeAdoUrl: (url: string) =>
    invoke('git:normalize-ado-url', url),

  // Console review settings
  getConsoleReviewSettings: async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_console_review_settings');
  },
  setConsoleReviewSettings: async (settings: any) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('set_console_review_settings', { settings });
  },
  browseFolder: async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({ directory: true });
    return result;
  },

  // Logger API
  loggerGetLogs: (lines?: number) => invoke('logger:get-logs', lines),
  loggerGetLogPath: () => invoke('logger:get-log-path'),
  loggerOpenLogFolder: async () => {
    const logDir = await invoke('logger:open-log-folder');
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(logDir);
    return logDir;
  },
  loggerLog: (level: 'debug' | 'info' | 'warn' | 'error', category: string, message: string, data?: unknown) =>
    invoke('logger:log', level, category, message, data),

  // PR File Cache API (backend fetches files directly to avoid large WebSocket payloads)
  ensurePRContext: (
    prContext: any,
    files: any[],
    threads: any[],
    lastCommitId: string,
    repoId: string
  ) => invoke('context:ensure-pr-context', prContext, files, threads, lastCommitId, repoId),
  getCachedFileContent: (
    prContextKey: string,
    filePath: string,
    version: 'original' | 'modified',
    objectId: string,
    org: string,
    project: string,
    repoId: string
  ) => invoke('cache:get-file-content', prContextKey, filePath, version, objectId, org, project, repoId),
  evictPRFromCache: (prContextKey: string) =>
    invoke('cache:evict-pr', prContextKey),
  warmCache: (prContextKey: string, files: Array<{ path: string; objectId?: string; originalObjectId?: string }>, maxFiles?: number) =>
    invoke('cache:warm', prContextKey, files, maxFiles),
  getCacheStats: () =>
    invoke('cache:get-stats'),

  // Polling settings
  getPollingSettings: async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_polling_settings');
  },
  setPollingSettings: async (settings: any) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('set_polling_settings', { settings });
  },

  // Notification settings
  getNotificationSettings: async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_notification_settings');
  },
  setNotificationSettings: async (settings: any) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('set_notification_settings', { settings });
  },

  // Autostart
  getAutostartEnabled: async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<boolean>('get_autostart_enabled');
  },
  setAutostartEnabled: async (enabled: boolean) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('set_autostart_enabled', { enabled });
  },

  // Services
  getServices: async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_services');
  },
  setServices: async (services: any) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('set_services', { services });
  },

  // Scrub Patterns
  getScrubPatterns: async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_scrub_patterns');
  },
  setScrubPatterns: async (patterns: any) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('set_scrub_patterns', { patterns });
  },

  // Apply Changes API
  applyChangesInitialize: (prId: number, contextDir: string, worktreePath: string, prTitle: string, prMetadata: any, hasLinkedRepo: boolean) =>
    invoke('apply-changes:initialize', prId, contextDir, worktreePath, prTitle, prMetadata, hasLinkedRepo),
  applyChangesGetState: (prId: number) =>
    invoke('apply-changes:get-state', prId),
  applyChangesQueue: (request: any) =>
    invoke('apply-changes:queue', request),
  applyChangesRemove: (prId: number, itemId: string) =>
    invoke('apply-changes:remove', prId, itemId),
  applyChangesPause: (prId: number) =>
    invoke('apply-changes:pause', prId),
  applyChangesResume: (prId: number) =>
    invoke('apply-changes:resume', prId),
  applyChangesRetry: (prId: number, itemId: string) =>
    invoke('apply-changes:retry', prId, itemId),
  applyChangesSkip: (prId: number, itemId: string) =>
    invoke('apply-changes:skip', prId, itemId),
  applyChangesClearCompleted: (prId: number) =>
    invoke('apply-changes:clear-completed', prId),
  applyChangesCanApply: (prId: number) =>
    invoke('apply-changes:can-apply', prId),

  // Apply Changes event listener
  onApplyChangesProgress: (callback: (event: any) => void) =>
    subscribe('apply-changes:progress', callback),

  // Fix Tracker API
  fixTrackerLoad: (prId: number, org: string, project: string) =>
    invoke('fix-tracker:load', prId, org, project),
  fixTrackerMarkFixed: (prId: number, org: string, project: string, fix: any) =>
    invoke('fix-tracker:mark-fixed', prId, org, project, fix),

  // Comment Analysis API
  commentAnalysisAnalyze: (
    threads: any[],
    context: { prId: number; org: string; project: string; repoPath?: string },
    provider: string,
    fileContents: Record<string, string>,
    showTerminal?: boolean
  ) => invoke('comment-analysis:analyze', threads, context, provider, fileContents, showTerminal ?? false),
  commentAnalysisLoad: (prId: number, org: string, project: string) =>
    invoke('comment-analysis:load', prId, org, project),
  commentAnalysisClear: (prId: number, org: string, project: string, threadId: number) =>
    invoke('comment-analysis:clear', prId, org, project, threadId),
  commentAnalysisReanalyze: (
    thread: any,
    context: { prId: number; org: string; project: string; repoPath?: string },
    provider: string,
    fileContents: Record<string, string>,
    showTerminal?: boolean
  ) => invoke('comment-analysis:reanalyze', thread, context, provider, fileContents, showTerminal ?? false),
  onCommentAnalysisProgress: (callback: (event: { prId: number; status: string }) => void) =>
    subscribe('comment-analysis:progress', callback),

  // CFV API
  cfvSetToken: (token: string) => invoke('cfv:set-token', token),
  cfvGetTokenStatus: () => invoke('cfv:get-token-status'),
  cfvFetchCall: (callId: string) => invoke('cfv:fetch-call', callId),
  cfvListCachedCalls: () => invoke('cfv:list-cached-calls'),
  cfvGetCallFlowData: (callId: string) => invoke('cfv:get-callflow-data', callId),
  cfvGetCallDetails: (callId: string) => invoke('cfv:get-call-details', callId),
  cfvGetRawFile: (callId: string, filename: string) => invoke('cfv:get-raw-file', callId, filename),
  cfvDeleteCall: (callId: string) => invoke('cfv:delete-call', callId),
  cfvAcquireToken: (options?: { forceVisible?: boolean; timeout?: number; edgeProfile?: string }) => invoke('cfv:acquire-token', options),
  cfvCancelTokenAcquisition: () => invoke('cfv:cancel-token-acquisition'),
  cfvListEdgeProfiles: () => invoke('cfv:list-edge-profiles'),
  cfvCheckPlaywright: () => invoke('cfv:check-playwright'),
  onCfvProgress: (callback: (event: any) => void) => subscribe('cfv:progress', callback),
  onCfvTokenProgress: (callback: (event: any) => void) => subscribe('cfv:token-progress', callback),
  onCfvTokenResult: (callback: (event: any) => void) => subscribe('cfv:token-result', callback),

  // CFV Chat API
  cfvChatCreate: (callId: string, persistentSessionId?: string) => invoke('cfv-chat:create', callId, persistentSessionId),
  cfvChatSend: (sessionId: string, message: string) => invoke('cfv-chat:send', sessionId, message),
  cfvChatGetHistory: (sessionId: string) => invoke('cfv-chat:get-history', sessionId),
  cfvChatDestroy: (sessionId: string) => invoke('cfv-chat:destroy', sessionId),
  cfvChatListSessions: (callId: string) => invoke('cfv-chat:list-sessions', callId),
  cfvChatLoadSessionMessages: (callId: string, persistentSessionId: string) => invoke('cfv-chat:load-session-messages', callId, persistentSessionId),
  cfvChatDeleteSession: (callId: string, persistentSessionId: string) => invoke('cfv-chat:delete-session', callId, persistentSessionId),
  onCfvChatEvent: (callback: (event: any) => void) => subscribe('cfv:chat-event', callback),

  // CFV Filter API
  cfvSaveCallFilters: (callId: string, state: any) => invoke('cfv-filter:save', callId, state),
  cfvLoadCallFilters: (callId: string) => invoke('cfv-filter:load', callId),
  cfvListFilterPresets: () => invoke('cfv-filter:list-presets'),
  cfvSaveFilterPreset: (preset: any) => invoke('cfv-filter:save-preset', preset),
  cfvDeleteFilterPreset: (presetId: string) => invoke('cfv-filter:delete-preset', presetId),

  // Plugin API
  pluginGetPlugins: () => invoke('plugin:get-plugins'),
  pluginGetPlugin: (pluginId: string) => invoke('plugin:get-plugin', pluginId),
  pluginExecuteTrigger: (pluginId: string, triggerId: string, input?: any) =>
    invoke('plugin:execute-trigger', pluginId, triggerId, input),
  pluginSetEnabled: (pluginId: string, enabled: boolean) =>
    invoke('plugin:set-enabled', pluginId, enabled),
  pluginSaveConfig: (pluginId: string, config: Record<string, any>) =>
    invoke('plugin:save-config', pluginId, config),
  pluginGetLogs: (pluginId: string) =>
    invoke('plugin:get-logs', pluginId),
  pluginReload: (pluginId: string) =>
    invoke('plugin:reload', pluginId),
  pluginReloadAll: () =>
    invoke('plugin:reload-all'),

  // Plugin event listeners
  onPluginUIUpdate: (callback: (event: any) => void) => subscribe('plugin:ui-update', callback),
  onPluginUIInject: (callback: (event: any) => void) => subscribe('plugin:ui-inject', callback),
  onPluginUIToast: (callback: (event: any) => void) => subscribe('plugin:ui-toast', callback),
  onPluginLog: (callback: (event: any) => void) => subscribe('plugin:log', callback),
  onPluginExecutionComplete: (callback: (event: any) => void) => subscribe('plugin:execution-complete', callback),
  onPluginReloaded: (callback: (event: any) => void) => subscribe('plugin:reloaded', callback),
  onPluginsReloaded: (callback: () => void) => subscribe('plugin:plugins-reloaded', callback),
  onPluginStateChanged: (callback: (event: any) => void) => subscribe('plugin:state-changed', callback),
  onPluginNavigate: (callback: (event: any) => void) => subscribe('plugin:ui-navigate', callback),
  onTriggerPRReview: (callback: (event: { org: string; project: string; prId: number }) => void) => subscribe('app:trigger-pr-review', callback),
  onAutoReviewStarted: (callback: (event: { org: string; project: string; prId: number; sessionId: string; displayName: string }) => void) => subscribe('app:auto-review-started', callback),

  // ICM Auth methods
  icmAcquireToken: () => invoke('icm:acquire-token'),
  icmHasValidToken: () => invoke('icm:has-valid-token'),

  // ICM API methods
  icmGetToken: () => invoke('icm:get-token'),
  icmGetCurrentUser: () => invoke('icm:get-current-user'),
  icmGetPermissions: () => invoke('icm:get-permissions'),
  icmResolveContacts: (emails: string[]) => invoke('icm:resolve-contacts', emails),
  icmQueryIncidents: (filter?: string, top?: number, select?: string, expand?: string, orderby?: string) =>
    invoke('icm:query-incidents', filter, top, select, expand, orderby),
  icmGetIncidentCount: (filter: string) => invoke('icm:get-incident-count', filter),
  icmGetIncident: (id: number) => invoke('icm:get-incident', id),
  icmGetIncidentBridges: (id: number) => invoke('icm:get-incident-bridges', id),
  icmAcknowledge: (id: number) => invoke('icm:acknowledge', id),
  icmTransfer: (id: number, teamId: number) => invoke('icm:transfer', id, teamId),
  icmMitigate: (id: number) => invoke('icm:mitigate', id),
  icmResolve: (id: number) => invoke('icm:resolve', id),
  icmGetDiscussion: (incidentId: number) => invoke('icm:get-discussion', incidentId),
  icmAddDiscussion: (incidentId: number, text: string) => invoke('icm:add-discussion', incidentId, text),
  icmGetFavoriteQueries: (ownerId: number, ownerType?: string) => invoke('icm:get-favorite-queries', ownerId, ownerType),
  icmGetSavedQueries: (contactId: number) => invoke('icm:get-saved-queries', contactId),
  icmGetSharedQueries: (contactId: number) => invoke('icm:get-shared-queries', contactId),
  icmGetTeams: (ids: number[]) => invoke('icm:get-teams', ids),
  icmSearchTeams: (id: number) => invoke('icm:search-teams', id),
  icmSearchServices: (id: number) => invoke('icm:search-services', id),
  icmGetAlertSources: (alertSourceId: string) => invoke('icm:get-alert-sources', alertSourceId),
  icmGetUserPreferences: (alias: string) => invoke('icm:get-user-preferences', alias),
  icmGetFeatureFlags: (scope: string, alias: string) => invoke('icm:get-feature-flags', scope, alias),
  icmGetTeamsChannel: (incidentId: number) => invoke('icm:get-teams-channel', incidentId),
  icmGetBreakingNews: () => invoke('icm:get-breaking-news'),
  icmGetPropertyGroups: () => invoke('icm:get-property-groups'),
  icmGetCloudInstances: () => invoke('icm:get-cloud-instances'),

  // DGrep API
  dgrepCheckTokenStatus: () => invoke('dgrep:check-token-status'),
  dgrepAcquireTokens: () => invoke('dgrep:acquire-tokens'),
  dgrepSearchByLogId: (logId: string, startTime: string, endTime: string, options?: any) =>
    invoke('dgrep:search-by-log-id', logId, startTime, endTime, options),
  dgrepSearch: (params: any) =>
    invoke('dgrep:search', params),
  dgrepCancelSearch: (sessionId: string) =>
    invoke('dgrep:cancel-search', sessionId),
  dgrepGetSession: (sessionId: string) =>
    invoke('dgrep:get-session', sessionId),
  dgrepGetAllSessions: () =>
    invoke('dgrep:get-all-sessions'),
  dgrepGetResults: (sessionId: string) =>
    invokeWithTimeout(300000, 'dgrep:get-results', sessionId),
  dgrepGetResultsPage: (sessionId: string, offset: number, limit: number) =>
    invoke('dgrep:get-results-page', sessionId, offset, limit),
  dgrepRunClientQuery: (sessionId: string, clientQuery: string) =>
    invoke('dgrep:run-client-query', sessionId, clientQuery),
  dgrepRemoveSession: (sessionId: string) =>
    invoke('dgrep:remove-session', sessionId),
  dgrepGetNamespaces: (endpoint: string) =>
    invokeWithTimeout(120000, 'dgrep:get-namespaces', endpoint),
  dgrepGetEvents: (endpoint: string, namespace: string) =>
    invoke('dgrep:get-events', endpoint, namespace),
  dgrepGenerateUrl: (logId: string, timeCenter: string, serverQuery: string, options?: any) =>
    invoke('dgrep:generate-url', logId, timeCenter, serverQuery, options),
  dgrepGetMonitoringAccounts: () =>
    invoke('dgrep:get-monitoring-accounts'),

  // DGrep event listeners
  onDgrepProgress: (callback: (event: any) => void) => subscribe('dgrep:progress', callback),
  onDgrepComplete: (callback: (event: any) => void) => subscribe('dgrep:complete', callback),
  onDgrepError: (callback: (event: any) => void) => subscribe('dgrep:error', callback),
  onDgrepIntermediateResults: (callback: (event: any) => void) => subscribe('dgrep:intermediate-results', callback),
  onDgrepLiveTailData: (callback: (event: any) => void) => subscribe('dgrep:live-tail-data', callback),

  // DGrep extra methods
  dgrepGetSurroundingDocs: (sessionId: string, rowIndex: number, count: number) =>
    invoke('dgrep-ai:get-surrounding-docs', sessionId, rowIndex, count),
  dgrepStartLiveTail: (sessionId: string, intervalMs?: number) =>
    invoke('dgrep:live-tail-start', sessionId, intervalMs),
  dgrepStopLiveTail: (sessionId: string) =>
    invoke('dgrep:live-tail-stop', sessionId),
  dgrepSaveQuery: (query: any) =>
    invoke('dgrep:save-query', query),
  dgrepLoadQueries: () =>
    invoke('dgrep:load-queries'),
  dgrepDeleteQuery: (queryId: string) =>
    invoke('dgrep:delete-query', queryId),

  // Workspaces API
  workspacesLoad: () =>
    invoke('workspaces:load'),
  workspacesSave: (data: any) =>
    invoke('workspaces:save', data),

  // DGrep AI API
  dgrepAISummarizeLogs: (sessionId: string, columns: string[], rows: any[], patterns: any[], metadata: any) =>
    invoke('dgrep-ai:summarize-logs', sessionId, columns, rows, patterns, metadata),
  dgrepAINLToKQL: (prompt: string, columns: string[], sampleRows: any[]) =>
    invoke('dgrep-ai:nl-to-kql', prompt, columns, sampleRows),
  dgrepAIAnalyzeRootCause: (sessionId: string, targetRow: any, targetIndex: number, contextRows: any[], columns: string[], metadata: any) =>
    invoke('dgrep-ai:analyze-root-cause', sessionId, targetRow, targetIndex, contextRows, columns, metadata),
  dgrepAIReadFile: (filePath: string) =>
    invoke('dgrep-ai:read-file', filePath),
  dgrepAIDetectAnomalies: (sessionId: string, columns: string[], rows: any[]) =>
    invoke('dgrep-ai:detect-anomalies', sessionId, columns, rows),
  dgrepAIImproveDisplay: (sessionId: string, columns: string[], rows: any[], metadata: any) =>
    invoke('dgrep-ai:improve-display', sessionId, columns, rows, metadata),
  dgrepAIChatCreate: (sessionId: string, columns: string[], rows: any[], sourceRepoPath?: string, serviceName?: string, queryContext?: any) =>
    invoke('dgrep-ai:chat-create', sessionId, columns, rows, sourceRepoPath, serviceName, queryContext),
  dgrepAIChatSend: (chatSessionId: string, message: string) =>
    invoke('dgrep-ai:chat-send', chatSessionId, message),
  dgrepAIChatDestroy: (chatSessionId: string) =>
    invoke('dgrep-ai:chat-destroy', chatSessionId),
  dgrepAIShadowSaveCsv: (shadowId: string, stepIndex: number, columns: string[], rows: any[]) =>
    invoke('dgrep-ai:shadow-save-csv', shadowId, stepIndex, columns, rows),
  dgrepAILearningCreate: (sessionId: string, columns: string[], rows: any[], shadowLog: any[], sourceRepoPath?: string, serviceName?: string, queryContext?: any) =>
    invoke('dgrep-ai:learning-create', sessionId, columns, rows, shadowLog, sourceRepoPath, serviceName, queryContext),

  // DGrep AI event listeners
  onDgrepAISummaryProgress: (callback: (event: any) => void) => subscribe('dgrep:ai:summary-progress', callback),
  onDgrepAISummaryComplete: (callback: (event: any) => void) => subscribe('dgrep:ai:summary-complete', callback),
  onDgrepAIRCAProgress: (callback: (event: any) => void) => subscribe('dgrep:ai:rca-progress', callback),
  onDgrepAIRCAComplete: (callback: (event: any) => void) => subscribe('dgrep:ai:rca-complete', callback),
  onDgrepAIChatEvent: (callback: (event: any) => void) => subscribe('dgrep:ai:chat-event', callback),
  onDgrepAIClientQueryUpdate: (callback: (event: any) => void) => subscribe('dgrep:ai:client-query-update', callback),
  onDgrepAIImproveDisplayProgress: (callback: (event: any) => void) => subscribe('dgrep:ai:improve-display-progress', callback),
  onDgrepAIImproveDisplayComplete: (callback: (event: any) => void) => subscribe('dgrep:ai:improve-display-complete', callback),

  // Auto-updater (Tauri native)
  checkForUpdate: async (): Promise<string | null> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string | null>('check_for_update');
  },
  installUpdate: async (): Promise<void> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('install_update');
  },
  onUpdateAvailable: (callback: (version: string) => void): (() => void) => {
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<string>('update-available', (event) => callback(event.payload));
    });
    return () => {};
  },

  // Task scheduler events
  onTaskRan: (callback: (event: any) => void) => subscribe('task:ran', callback),
  onTaskCompleted: (callback: (event: any) => void) => subscribe('task:completed', callback),
  onTaskError: (callback: (event: any) => void) => subscribe('task:error', callback),
  onTaskResult: (callback: (event: any) => void) => subscribe('task:result', callback),
  onTaskTerminalStarted: (callback: (event: any) => void) => subscribe('task:terminal-started', callback),
  tasksGetPendingApprovals: () => invoke('tasks:get-pending-approvals'),
  onTaskApprovalRequest: (callback: (event: any) => void) => subscribe('task:approval-request', callback),
  onTaskApprovalResolved: (callback: (event: any) => void) => subscribe('task:approval-resolved', callback),
  tasksRespondApproval: (approvalId: string, choice: string, instructions: string) =>
    invoke('tasks:respond-approval', { approvalId, choice, instructions }),
};

// Initialize connection when module loads
connect().catch(console.error);

// Expose as electronAPI for backward compatibility with existing code
// Type is defined in api.d.ts
(window as any).electronAPI = tauriAPI;
