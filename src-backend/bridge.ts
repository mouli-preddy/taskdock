/**
 * TaskDock Backend Bridge
 * 
 * This is a Node.js sidecar process that handles complex operations
 * that require Node.js capabilities (node-pty, etc.)
 * 
 * Communication: WebSocket on port 5198
 */

import { WebSocketServer, WebSocket } from 'ws';
import { AdoApiClient } from '../src/main/ado-api.js';
import { IcmApiClient } from '../src/main/icm-api.js';
import { IcmAuthService } from '../src/main/icm-auth.js';
import {
  getAIReviewService,
  disposeAIReviewService,
} from '../src/main/ai/ai-review-service.js';
import { getAIStorageService } from '../src/main/ai/ai-storage-service.js';
import { getTerminalManager, disposeTerminalManager } from '../src/main/terminal/terminal-manager.js';
import { getChatTerminalService, disposeChatTerminalService, type CreateChatTerminalOptions } from '../src/main/terminal/chat-terminal-service.js';
import { getReviewContextService } from '../src/main/ai/review-context-service.js';
import { getPRFileCacheService } from '../src/main/services/pr-file-cache-service.js';
import { getPresetService } from '../src/main/ai/preset-service.js';
import { getWalkthroughService, disposeWalkthroughService } from '../src/main/ai/walkthrough-service.js';
import { getReviewExecutorService } from '../src/main/ai/review-executor-service.js';
import { getApplyChangesService, disposeApplyChangesService } from '../src/main/ai/apply-changes-service.js';
import { getFixTrackerService } from '../src/main/ai/fix-tracker-service.js';
import { getCommentAnalysisService } from '../src/main/ai/comment-analysis-service.js';
import { initializeLogger, getLogger, disposeLogger } from '../src/main/services/logger-service.js';
import { getWorktreeService, WorktreeService } from '../src/main/git/worktree-service.js';
import { getPluginEngine, disposePluginEngine } from '../src/main/plugins/plugin-engine.js';
import { getCfvService, disposeCfvService, getCfvChatService, disposeCfvChatService, getCfvFilterService } from '../src/main/cfv/index.js';
import { getDGrepService, disposeDGrepService } from '../src/main/dgrep/dgrep-service.js';
import type { LogId } from '../src/shared/dgrep-types.js';
import { buildReviewPrompt } from '../src/main/terminal/review-prompt.js';
import type { ConsoleReviewSettings } from '../src/shared/terminal-types.js';
import { DEFAULT_CONSOLE_REVIEW_SETTINGS } from '../src/shared/terminal-types.js';
import type { PollingSettings } from '../src/shared/types.js';
import { DEFAULT_POLLING_SETTINGS } from '../src/shared/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PORT = 5198;
const CONFIG_DIR = path.join(os.homedir(), '.taskdock');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

interface AppConfig {
  ado: {
    organization: string;
    project: string;
    pat: string;
  };
}

const adoClient = new AdoApiClient();
const icmAuthService = new IcmAuthService();
const icmClient = new IcmApiClient(icmAuthService);

// Helper to load settings from store file (for bridge-side operations)
// This is temporary - settings are being migrated to Tauri storage
function loadStoreData(): any {
  const storeFile = path.join(CONFIG_DIR, 'store.json');
  try {
    if (fs.existsSync(storeFile)) {
      return JSON.parse(fs.readFileSync(storeFile, 'utf-8'));
    }
  } catch (error) {
    console.error('Failed to load store:', error);
  }
  return {
    organization: '',
    project: '',
    theme: 'system',
    diffViewMode: 'unified',
    sidebarCollapsed: false,
    windowBounds: { width: 1400, height: 900 },
    consoleReview: DEFAULT_CONSOLE_REVIEW_SETTINGS,
    polling: DEFAULT_POLLING_SETTINGS,
    workItems: {
      savedQueries: [],
      lastView: 'assigned',
    },
  };
}

function saveStoreData(data: any): void {
  const storeFile = path.join(CONFIG_DIR, 'store.json');
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(storeFile, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Failed to save store:', error);
  }
}

// Track connected clients
const clients = new Set<WebSocket>();

// Track session context
const sessionContextMap = new Map<string, {
  organization: string;
  project: string;
  prId: number;
  reviewSaved?: boolean;
  walkthroughSaved?: boolean;
}>();

function loadConfig(): AppConfig | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (error) {
    console.error('Failed to load config:', error);
  }
  return null;
}

function saveConfig(config: AppConfig): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Failed to save config:', error);
    throw error;
  }
}

function isConfigured(): boolean {
  const config = loadConfig();
  return !!(config?.ado?.organization && config?.ado?.project);
}

// Broadcast event to all connected clients
function broadcast(event: string, data: any): void {
  const message = JSON.stringify({ type: 'event', event, data });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Initialize services
initializeLogger();
getLogger().info('Backend', 'Backend bridge starting', { port: PORT });

const aiService = getAIReviewService();
const storageService = getAIStorageService();
const terminalManager = getTerminalManager();
const chatTerminalService = getChatTerminalService();
const presetService = getPresetService();
const walkthroughService = getWalkthroughService();
const reviewContextService = getReviewContextService();
const applyChangesService = getApplyChangesService();

// Initialize plugin engine
const pluginEngine = getPluginEngine();
pluginEngine.initialize();

// Initialize CFV service
const cfvService = getCfvService();
cfvService.on('progress', (event) => broadcast('cfv:progress', event));
cfvService.on('token-progress', (event) => broadcast('cfv:token-progress', event));
cfvService.on('token-result', (event) => broadcast('cfv:token-result', event));

// Initialize CFV Chat service
const cfvChatService = getCfvChatService();
cfvChatService.on('chat-event', (event) => broadcast('cfv:chat-event', event));

// Set up event forwarding
aiService.onProgress((event) => {
  broadcast('ai:progress', event);
  if (event.status === 'complete') {
    pluginEngine.emitAppEvent('review:completed', { sessionId: event.sessionId });
  }
});
aiService.onComment((event) => broadcast('ai:comment', event));
aiService.onWalkthrough((event) => broadcast('ai:walkthrough', event));
aiService.onError((event) => broadcast('ai:error', event));

walkthroughService.onProgress((event) => broadcast('walkthrough:progress', event));
walkthroughService.onComplete((event) => broadcast('walkthrough:complete', event));
walkthroughService.onError((event) => broadcast('walkthrough:error', event));

terminalManager.on('session-created', (event) => {
  broadcast('terminal:session-created', event);
  pluginEngine.emitAppEvent('terminal:created', { sessionId: event?.sessionId ?? event?.id });
});
terminalManager.on('data', (event) => broadcast('terminal:data', event));
terminalManager.on('exit', (event) => {
  broadcast('terminal:exit', event);
  pluginEngine.emitAppEvent('terminal:exited', { sessionId: event?.sessionId ?? event?.id, exitCode: event?.exitCode });
});
terminalManager.on('status-change', (event) => broadcast('terminal:status-change', event));
terminalManager.on('review-complete', (event) => broadcast('terminal:review-complete', event));

// Chat Terminal events
chatTerminalService.on('session-created', (event) => broadcast('chat-terminal:session-created', event));
chatTerminalService.on('data', (event) => broadcast('chat-terminal:data', event));
chatTerminalService.on('exit', (event) => broadcast('chat-terminal:exit', event));
chatTerminalService.on('status-change', (event) => broadcast('chat-terminal:status-change', event));

applyChangesService.onProgress((event) => broadcast('apply-changes:progress', event));

const commentAnalysisService = getCommentAnalysisService();
commentAnalysisService.onProgress((event) => broadcast('comment-analysis:progress', event));

// Plugin engine events
pluginEngine.on('ui:update', (event) => broadcast('plugin:ui-update', event));
pluginEngine.on('ui:inject', (event) => broadcast('plugin:ui-inject', event));
pluginEngine.on('ui:toast', (event) => broadcast('plugin:ui-toast', event));
pluginEngine.on('plugin:log', (event) => broadcast('plugin:log', event));
pluginEngine.on('execution:complete', (event) => broadcast('plugin:execution-complete', event));
pluginEngine.on('plugin:reloaded', (event) => broadcast('plugin:reloaded', event));
pluginEngine.on('plugins:reloaded', () => broadcast('plugin:plugins-reloaded', {}));
pluginEngine.on('plugin:state-changed', (event) => broadcast('plugin:state-changed', event));
pluginEngine.on('ui:navigate', (event) => broadcast('plugin:ui-navigate', event));

// Handle plugin AI terminal launch requests
pluginEngine.on('ai:launch-terminal', (event) => {
  const { pluginId, ai, prompt, show, callback } = event;
  try {
    const contextPath = path.join(os.homedir(), '.taskdock', 'plugins', '_runtime', `terminal-${Date.now()}`);
    fs.mkdirSync(contextPath, { recursive: true });
    const sessionId = chatTerminalService.createSession({
      ai,
      workingDir: process.cwd(),
      contextPath,
      initialPrompt: prompt,
    });
    if (show) {
      broadcast('plugin:ui-navigate', { pluginId, section: 'terminals' });
    }
    callback(sessionId);
  } catch (err: any) {
    callback('', err.message);
  }
});

// DGrep service
const dgrepService = getDGrepService();
dgrepService.on('progress', (event) => broadcast('dgrep:progress', event));
dgrepService.on('complete', (event) => broadcast('dgrep:complete', event));
dgrepService.on('error', (event) => broadcast('dgrep:error', event));
dgrepService.on('intermediate-results', (event) => broadcast('dgrep:intermediate-results', event));

// Warm up provider cache asynchronously at startup
// This runs in the background so dialogs open instantly
const reviewExecutorService = getReviewExecutorService();
reviewExecutorService.warmupProviderCache().then(() => {
  getLogger().info('Backend', 'AI provider cache warmed up');
}).catch((err) => {
  getLogger().warn('Backend', 'Failed to warm up provider cache', { error: err?.message });
});

// Auto-retry ICM calls on token errors (refresh + retry once)
async function icmCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    const msg = e?.message || '';
    if (msg.includes('401') || msg.includes('ICM_TOKEN_EXPIRED') || msg.includes('Unauthorized')) {
      await icmAuthService.refreshToken();
      return await fn();
    }
    throw e;
  }
}

// Handle incoming RPC calls
async function handleRpc(method: string, params: any[]): Promise<any> {
  switch (method) {
    // ADO API
    case 'ado:get-token':
      return adoClient.getToken();
    case 'ado:load-pr': {
      const result = await adoClient.getPullRequest(params[0], params[1], params[2]);
      pluginEngine.emitAppEvent('pr:opened', { pr: result });
      return result;
    }
    case 'ado:get-iterations':
      return adoClient.getIterations(params[0], params[1], params[2], params[3]);
    case 'ado:get-changes':
      return adoClient.getIterationChanges(params[0], params[1], params[2], params[3], params[4]);
    case 'ado:get-threads': {
      const threads = await adoClient.getThreads(params[0], params[1], params[2], params[3]);
      console.log('[Bridge] getThreads returned', threads?.length, 'threads');
      return threads;
    }
    case 'ado:get-file-content':
      return adoClient.getFileContent(params[0], params[1], params[2], params[3]);
    case 'ado:get-file-from-branch':
      return adoClient.getFileFromBranch(params[0], params[1], params[2], params[3], params[4]);
    case 'ado:create-comment': {
      const result = await adoClient.createFileComment(params[0], params[1], params[2], params[3], params[4], params[5], params[6], params[7]);
      pluginEngine.emitAppEvent('pr:comment-created', { pr: { org: params[0], project: params[1], prId: params[2] }, threadId: result?.id, filePath: params[4], comment: result });
      return result;
    }
    case 'ado:reply-to-thread': {
      const result = await adoClient.replyToThread(params[0], params[1], params[2], params[3], params[4], params[5]);
      pluginEngine.emitAppEvent('pr:comment-replied', { pr: { org: params[0], project: params[1], prId: params[3] }, threadId: params[4], comment: result });
      return result;
    }
    case 'ado:update-thread-status': {
      const result = await adoClient.updateThreadStatus(params[0], params[1], params[2], params[3], params[4], params[5]);
      pluginEngine.emitAppEvent('pr:thread-status-changed', { pr: { org: params[0], project: params[1], prId: params[3] }, threadId: params[4], status: params[5] });
      return result;
    }
    case 'ado:submit-vote': {
      const result = await adoClient.submitVote(params[0], params[1], params[2], params[3], params[4]);
      pluginEngine.emitAppEvent('pr:vote-submitted', { pr: { org: params[0], project: params[1], prId: params[3] }, vote: params[4] });
      return result;
    }
    case 'ado:get-my-prs':
      return adoClient.getPullRequestsForReviewer(params[0], params[1]);
    case 'ado:get-created-prs':
      return adoClient.getPullRequestsCreatedByMe(params[0], params[1]);
    case 'ado:get-repo-prs':
      return adoClient.getPullRequestsForRepository(params[0], params[1], params[2]);

    // Work Items
    case 'wi:query':
      return adoClient.queryWorkItems(params[0], params[1], params[2]);
    case 'wi:run-query-by-id':
      return adoClient.runQueryById(params[0], params[1], params[2]);
    case 'wi:get-items':
      return adoClient.getWorkItems(params[0], params[1], params[2]);
    case 'wi:get-item': {
      const result = await adoClient.getWorkItem(params[0], params[1], params[2]);
      pluginEngine.emitAppEvent('workitem:opened', { workItem: result });
      return result;
    }
    case 'wi:get-my-items':
      return adoClient.getMyWorkItems(params[0], params[1]);
    case 'wi:get-created-by-me':
      return adoClient.getCreatedByMeWorkItems(params[0], params[1]);
    case 'wi:get-updates':
      return adoClient.getWorkItemUpdates(params[0], params[1], params[2]);
    case 'wi:get-types':
      return adoClient.getWorkItemTypes(params[0], params[1]);
    case 'wi:get-area-paths':
      return adoClient.getAreaPaths(params[0], params[1]);
    case 'wi:get-iteration-paths':
      return adoClient.getIterationPaths(params[0], params[1]);
    case 'wi:get-saved-queries':
      return loadStoreData().workItems?.savedQueries || [];
    case 'wi:save-query': {
      const storeData = loadStoreData();
      const queries = storeData.workItems?.savedQueries || [];
      const existing = queries.findIndex((q: any) => q.id === params[0].id);
      if (existing >= 0) {
        queries[existing] = params[0];
      } else {
        queries.push(params[0]);
      }
      storeData.workItems = { ...storeData.workItems, savedQueries: queries };
      saveStoreData(storeData);
      return;
    }
    case 'wi:delete-query': {
      const storeData = loadStoreData();
      const queries = storeData.workItems?.savedQueries || [];
      storeData.workItems = {
        ...storeData.workItems,
        savedQueries: queries.filter((q: any) => q.id !== params[0])
      };
      saveStoreData(storeData);
      return;
    }
    case 'wi:update': {
      const result = await adoClient.updateWorkItem(params[0], params[1], params[2], params[3]);
      pluginEngine.emitAppEvent('workitem:updated', { workItem: { org: params[0], project: params[1], id: params[2] }, changes: params[3] });
      return result;
    }
    case 'wi:get-comments':
      return adoClient.getWorkItemComments(params[0], params[1], params[2]);
    case 'wi:add-comment': {
      const result = await adoClient.addWorkItemComment(params[0], params[1], params[2], params[3]);
      pluginEngine.emitAppEvent('workitem:comment-added', { workItem: { org: params[0], project: params[1], id: params[2] }, comment: result });
      return result;
    }
    case 'wi:get-team-members':
      return adoClient.getTeamMembers(params[0], params[1]);
    case 'wi:get-type-states':
      return adoClient.getWorkItemTypeStates(params[0], params[1], params[2]);
    case 'wi:upload-attachment': {
      const content = Buffer.from(params[4], 'base64');
      const attachment = await adoClient.uploadAttachment(params[0], params[1], params[3], content);
      await adoClient.addWorkItemAttachment(params[0], params[1], params[2], attachment.url, params[5]);
      return attachment;
    }
    case 'wi:remove-attachment':
      return adoClient.removeWorkItemAttachment(params[0], params[1], params[2], params[3]);
    case 'wi:get-wikis':
      return adoClient.getWikis(params[0], params[1]);
    case 'wi:get-wiki-page':
      return adoClient.getWikiPage(params[0], params[1], params[2], params[3]);
    case 'wi:create-wiki-page':
      return adoClient.createOrUpdateWikiPage(params[0], params[1], params[2], params[3], params[4], params[5]);
    case 'wi:search-wiki':
      return adoClient.searchWikiPages(params[0], params[1], params[2]);
    case 'wi:add-hyperlink':
      return adoClient.addWorkItemHyperlink(params[0], params[1], params[2], params[3], params[4]);
    case 'wi:remove-hyperlink':
      return adoClient.removeWorkItemHyperlink(params[0], params[1], params[2], params[3]);

    // App Settings
    case 'app:get-settings': {
      const storeData = loadStoreData();
      const appConfig = loadConfig();
      return {
        organization: storeData.organization || appConfig?.ado?.organization || '',
        project: storeData.project || appConfig?.ado?.project || '',
        theme: storeData.theme,
        diffViewMode: storeData.diffViewMode,
        sidebarCollapsed: storeData.sidebarCollapsed,
      };
    }
    case 'app:save-settings': {
      const storeData = loadStoreData();
      for (const [key, value] of Object.entries(params[0])) {
        storeData[key] = value;
      }
      saveStoreData(storeData);
      return;
    }

    // AI Review
    case 'ai:get-providers':
      return aiService.getProviders();
    case 'ai:start-review': {
      const settings = loadStoreData().consoleReview;
      const contentsMap = new Map(Object.entries(params[6]));
      const prContextKey = params[7] as string | undefined;
      const sessionId = await aiService.startReview(
        params[2], params[3], params[4], params[5], settings, contentsMap as any, prContextKey
      );
      sessionContextMap.set(sessionId, { organization: params[0], project: params[1], prId: params[2].prId });
      pluginEngine.emitAppEvent('review:started', { sessionId });
      return sessionId;
    }
    case 'ai:cancel-review':
      aiService.cancelSession(params[0]);
      return;
    case 'ai:get-session':
      return aiService.getSession(params[0]);
    case 'ai:get-comments':
      return aiService.getComments(params[0]);
    case 'ai:mark-comment-published':
      aiService.markCommentPublished(params[0], params[1], params[2]);
      return;
    case 'ai:dismiss-comment':
      aiService.dismissComment(params[0], params[1]);
      return;
    case 'ai:get-walkthrough':
      return aiService.getWalkthrough(params[0]);
    case 'ai:save-review': {
      const session = aiService.getSession(params[3]);
      if (!session) throw new Error('Session not found');
      await storageService.saveReviewSession(
        params[0], params[1], params[2], params[3],
        session.displayName || 'Review', session.provider,
        session.comments, session.preset, session.customPrompt
      );
      return;
    }
    case 'ai:save-review-comments': {
      const consoleSessionId = `console-${Date.now()}`;
      await storageService.saveReviewSession(
        params[0], params[1], params[2], consoleSessionId,
        'Console Review', 'claude-sdk', params[3]
      );
      return;
    }
    case 'ai:load-review':
      return storageService.loadReview(params[0], params[1], params[2]);
    case 'ai:has-saved-review':
      return storageService.hasReview(params[0], params[1], params[2]);
    case 'ai:save-walkthrough':
      return storageService.saveWalkthrough(params[0], params[1], params[2], params[3]);
    case 'ai:load-walkthrough':
      return storageService.loadWalkthrough(params[0], params[1], params[2]);
    case 'ai:has-saved-walkthrough':
      return storageService.hasWalkthrough(params[0], params[1], params[2]);
    case 'ai:delete-saved-data':
      return storageService.deleteSavedData(params[0], params[1], params[2]);
    case 'ai:list-reviews':
      return storageService.listReviews(params[0], params[1], params[2]);
    case 'ai:load-review-session':
      return storageService.loadReviewSession(params[0], params[1], params[2], params[3]);
    case 'ai:delete-review-session':
      return storageService.deleteReviewSession(params[0], params[1], params[2], params[3]);
    case 'ai:list-walkthroughs':
      return storageService.listWalkthroughs(params[0], params[1], params[2]);
    case 'ai:save-walkthrough-session':
      return storageService.saveWalkthroughSession(
        params[0], params[1], params[2], params[3], params[4], params[5], params[6], params[7], params[8]
      );
    case 'ai:load-walkthrough-session':
      return storageService.loadWalkthroughSession(params[0], params[1], params[2], params[3]);
    case 'ai:delete-walkthrough-session':
      return storageService.deleteWalkthroughSession(params[0], params[1], params[2], params[3]);
    case 'ai:get-sessions-for-pr':
      return aiService.getSessionsForPR(params[0]);
    case 'ai:remove-session':
      aiService.removeSession(params[0]);
      return;

    // Presets
    case 'presets:get-review-presets':
      return presetService.getReviewPresets();
    case 'presets:save-review-preset':
      return presetService.saveReviewPreset(params[0]);
    case 'presets:update-review-preset':
      return presetService.updateReviewPreset(params[0], params[1]);
    case 'presets:delete-review-preset':
      return presetService.deleteReviewPreset(params[0]);
    case 'presets:get-walkthrough-presets':
      return presetService.getWalkthroughPresets();
    case 'presets:save-walkthrough-preset':
      return presetService.saveWalkthroughPreset(params[0]);
    case 'presets:update-walkthrough-preset':
      return presetService.updateWalkthroughPreset(params[0], params[1]);
    case 'presets:delete-walkthrough-preset':
      return presetService.deleteWalkthroughPreset(params[0]);

    // Walkthrough Service
    case 'walkthrough:start': {
      const settings = loadStoreData().consoleReview;
      const contentsMap = new Map(Object.entries(params[6]));
      return walkthroughService.startWalkthrough(params[2], params[3], params[4], params[5], settings, contentsMap as any);
    }
    case 'walkthrough:cancel':
      walkthroughService.cancelWalkthrough(params[0]);
      return;
    case 'walkthrough:get-session':
      return walkthroughService.getSession(params[0]);
    case 'walkthrough:get-sessions-for-pr':
      return walkthroughService.getSessionsForPR(params[0]);
    case 'walkthrough:remove-session':
      walkthroughService.removeSession(params[0]);
      return;

    // Config
    case 'config:test-connection':
      try {
        await adoClient.getPullRequestsForReviewer(params[0], params[1]);
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }

    // Terminal
    case 'terminal:list-sessions':
      return terminalManager.getAllSessions();
    case 'terminal:get-session':
      return terminalManager.getSession(params[0]);
    case 'terminal:write':
      terminalManager.writeToSession(params[0], params[1]);
      return;
    case 'terminal:resize':
      terminalManager.resizeSession(params[0], params[1], params[2]);
      return;
    case 'terminal:kill':
      terminalManager.killSession(params[0]);
      return;
    case 'terminal:remove':
      terminalManager.removeSession(params[0]);
      return;

    // Chat Terminal
    case 'chat-terminal:create':
      return chatTerminalService.createSession(params[0] as CreateChatTerminalOptions);
    case 'chat-terminal:get-session':
      return chatTerminalService.getSession(params[0]);
    case 'chat-terminal:write':
      chatTerminalService.writeToSession(params[0], params[1]);
      return;
    case 'chat-terminal:resize':
      chatTerminalService.resizeSession(params[0], params[1], params[2]);
      return;
    case 'chat-terminal:kill':
      chatTerminalService.killSession(params[0]);
      return;
    case 'chat-terminal:remove':
      chatTerminalService.removeSession(params[0]);
      return;

    // Console Review
    case 'console-review:prepare': {
      const settings = loadStoreData().consoleReview;
      const contentsMap = new Map(Object.entries(params[0].fileContents));
      return reviewContextService.prepareContext(
        params[0].prContext, params[0].files, params[0].threads, settings, contentsMap as any
      );
    }
    case 'console-review:start': {
      const prompt = buildReviewPrompt({
        guid: params[0].prepared.guid,
        contextPath: params[0].prepared.contextPath,
        outputPath: params[0].prepared.outputPath,
        hasRepoContext: params[0].prepared.hasRepoContext,
        repoPath: params[0].prepared.repoPath,
      });
      return terminalManager.createSession({
        prId: params[0].prId,
        organization: params[0].organization,
        project: params[0].project,
        label: params[0].label,
        workingDir: params[0].prepared.workingDir,
        contextPath: params[0].prepared.contextPath,
        outputPath: params[0].prepared.outputPath,
        prompt,
        completionGuid: params[0].prepared.guid,
        worktreeCreated: params[0].prepared.worktreeCreated,
        mainRepoPath: params[0].prepared.mainRepoPath,
      });
    }
    case 'console-review:cleanup':
      reviewContextService.cleanupContext(params[0]);
      return;
    case 'console-review:cleanup-worktree':
      reviewContextService.cleanupWorktree(params[0].mainRepoPath, params[0].worktreePath);
      return;

    // Git
    case 'app:get-linked-repositories': {
      const settings = loadStoreData().consoleReview;
      return (settings?.linkedRepositories || []).map((repo: any) => ({
        path: repo.path,
        originUrl: repo.originUrl,
        description: repo.description || '',
      }));
    }

    // Git
    case 'git:find-repo': {
      const settings = loadStoreData().consoleReview;
      const worktreeService = getWorktreeService(settings?.linkedRepositories || []);
      return worktreeService.findLocalRepo(params[0].repoUrl, params[0].repoName);
    }
    case 'git:list-worktrees': {
      const settings = loadStoreData().consoleReview;
      const worktreeService = getWorktreeService(settings?.linkedRepositories || []);
      return worktreeService.listWorktrees(params[0]);
    }
    case 'git:get-origin-url':
      return WorktreeService.getGitOriginUrl(params[0]);
    case 'git:is-repo':
      return WorktreeService.isGitRepo(params[0]);
    case 'git:find-linked-repo': {
      const settings = loadStoreData().consoleReview;
      const worktreeService = getWorktreeService(settings?.linkedRepositories || []);
      return worktreeService.findLinkedRepoByAdoUrl(params[0]);
    }
    case 'git:normalize-ado-url': {
      const worktreeService = getWorktreeService([]);
      return worktreeService.normalizeAdoUrl(params[0]);
    }

    // Logger
    case 'logger:get-logs':
      return getLogger().getRecentLogs(params[0] || 100);
    case 'logger:get-log-path':
      return getLogger().getLogFilePath();
    case 'logger:open-log-folder':
      return getLogger().getLogDir();
    case 'logger:log': {
      // Frontend logging - params: [level, category, message, data]
      const [level, category, message, data] = params;
      const logger = getLogger();
      switch (level) {
        case 'debug':
          logger.debug(category, message, data);
          break;
        case 'info':
          logger.info(category, message, data);
          break;
        case 'warn':
          logger.warn(category, message, data);
          break;
        case 'error':
          logger.error(category, message, data);
          break;
        default:
          logger.info(category, message, data);
      }
      return;
    }

    // PR Context (backend-side file fetching - no large payload over IPC)
    case 'context:ensure-pr-context': {
      const settings = loadStoreData().consoleReview;
      // params: [prContext, files, threads, lastCommitId, repoId]
      const prContext = params[0];
      const files = params[1];
      const threads = params[2];
      const lastCommitId = params[3];
      const repoId = params[4];

      // Create fetcher that uses ADO client (blob API only)
      const fetcher = {
        getFileContent: (objectId: string) =>
          adoClient.getFileContent(prContext.org, prContext.project, repoId, objectId),
      };

      const result = await reviewContextService.ensurePRContextWithFetch(
        prContext,
        files,
        threads,
        { linkedRepositories: settings?.linkedRepositories || [], whenRepoFound: 'tempOnly' },
        lastCommitId,
        repoId,
        fetcher
      );

      // Check if repo is linked (for Apply Changes availability)
      let worktreePath: string | undefined;
      let hasLinkedRepo = false;
      console.log('[Bridge] === Apply Changes Repo Matching Debug ===');
      console.log('[Bridge] PR Context:', {
        org: prContext.org,
        project: prContext.project,
        repository: prContext.repository,
        sourceBranch: prContext.sourceBranch,
      });
      console.log('[Bridge] Linked repositories count:', settings?.linkedRepositories?.length || 0);
      if (settings?.linkedRepositories?.length) {
        console.log('[Bridge] Linked repos:', settings.linkedRepositories.map(r => ({
          path: r.path,
          originUrl: r.originUrl
        })));
      }

      if (prContext.sourceBranch && settings?.linkedRepositories?.length > 0) {
        const worktreeService = getWorktreeService(settings.linkedRepositories);
        const repoUrl = `https://dev.azure.com/${prContext.org}/${prContext.project}/_git/${prContext.repository}`;
        console.log('[Bridge] Constructed repo URL:', repoUrl);
        const repoMatch = worktreeService.findLocalRepo(repoUrl, prContext.repository);
        console.log('[Bridge] Repo match result:', repoMatch ? `FOUND at ${repoMatch.path}` : 'NOT FOUND');

        if (repoMatch) {
          hasLinkedRepo = true;
          // Check for existing worktree (but don't create one yet)
          const existingWorktree = worktreeService.findWorktreeForBranch(repoMatch.path, prContext.sourceBranch);
          if (existingWorktree) {
            worktreePath = existingWorktree.path;
          }
        }
      }
      console.log('[Bridge] Final result: hasLinkedRepo =', hasLinkedRepo, ', worktreePath =', worktreePath || 'none');

      return {
        ...result,
        worktreePath,
        hasLinkedRepo,
      };
    }

    // PR File Cache
    case 'cache:get-file-content': {
      const cacheService = getPRFileCacheService();
      const [prContextKey, filePath, version, objectId, org, project, repoId] = params;

      // Create ADO fetcher for fallback - uses objectId which works for both versions
      // (caller passes originalObjectId for 'original' version, objectId for 'modified')
      const adoFetcher = async () => {
        return adoClient.getFileContent(org, project, repoId, objectId);
      };

      return cacheService.getFileContent(prContextKey, filePath, version, objectId, adoFetcher);
    }

    case 'cache:evict-pr': {
      const cacheService = getPRFileCacheService();
      cacheService.evictPRFromCache(params[0]);
      return;
    }

    case 'cache:warm': {
      const cacheService = getPRFileCacheService();
      await cacheService.warmCache(params[0], params[1], params[2]);
      return;
    }

    case 'cache:get-stats': {
      const cacheService = getPRFileCacheService();
      return cacheService.getStats();
    }

    // Apply Changes
    case 'apply-changes:initialize': {
      const settings = loadStoreData().consoleReview;
      applyChangesService.setSettings(settings);
      return applyChangesService.initializeForPR(
        params[0], // prId
        params[1], // contextDir
        params[2], // worktreePath
        params[3], // prTitle
        params[4], // prMetadata
        params[5]  // hasLinkedRepo
      );
    }
    case 'apply-changes:get-state':
      return applyChangesService.getQueueState(params[0]);
    case 'apply-changes:queue':
      return applyChangesService.queueItem(params[0]);
    case 'apply-changes:remove':
      return applyChangesService.removeItem(params[0], params[1]);
    case 'apply-changes:pause':
      return applyChangesService.pauseQueue(params[0]);
    case 'apply-changes:resume':
      return applyChangesService.resumeQueue(params[0]);
    case 'apply-changes:retry':
      return applyChangesService.retryItem(params[0], params[1]);
    case 'apply-changes:skip':
      return applyChangesService.skipItem(params[0], params[1]);
    case 'apply-changes:clear-completed':
      return applyChangesService.clearCompleted(params[0]);
    case 'apply-changes:can-apply':
      return applyChangesService.canApplyChanges(params[0]);

    // Fix Tracker API
    case 'fix-tracker:load':
      return getFixTrackerService().loadFixTracker(params[0], params[1], params[2]);

    case 'fix-tracker:mark-fixed':
      return getFixTrackerService().markFixed(params[0], params[1], params[2], params[3]);

    // Comment Analysis API
    case 'comment-analysis:analyze': {
      const [threads, context, provider, fileContentsObj, showTerminal] = params;
      const fileContents = new Map(Object.entries(fileContentsObj || {}));
      return commentAnalysisService.analyzeComments(threads, context, provider, fileContents, undefined, showTerminal ?? false);
    }
    case 'comment-analysis:load':
      return commentAnalysisService.loadAnalyses(params[0], params[1], params[2]);
    case 'comment-analysis:clear':
      return commentAnalysisService.clearAnalysis(params[0], params[1], params[2], params[3]);
    case 'comment-analysis:reanalyze': {
      const [thread, context, provider, fileContentsObj, showTerminal] = params;
      const fileContents = new Map(Object.entries(fileContentsObj || {}));
      return commentAnalysisService.reanalyzeComment(thread, context, provider, fileContents, showTerminal ?? false);
    }

    // CFV API
    case 'cfv:set-token':
      return cfvService.setToken(params[0]);
    case 'cfv:get-token-status':
      return cfvService.getTokenStatus();
    case 'cfv:fetch-call':
      return cfvService.fetchCall(params[0]);
    case 'cfv:list-cached-calls':
      return cfvService.listCachedCalls();
    case 'cfv:get-callflow-data':
      return cfvService.getCallFlowData(params[0]);
    case 'cfv:get-call-details':
      return cfvService.getCallDetailsData(params[0]);
    case 'cfv:get-raw-file':
      return cfvService.getRawFile(params[0], params[1]);
    case 'cfv:delete-call':
      return cfvService.deleteCall(params[0]);
    case 'cfv:acquire-token':
      // Fire-and-forget: acquireToken runs async, results come via events
      cfvService.acquireToken(params[0]).catch((err) => {
        console.error('Token acquisition error:', err);
      });
      return;
    case 'cfv:cancel-token-acquisition':
      cfvService.cancelTokenAcquisition();
      return;
    case 'cfv:list-edge-profiles':
      return cfvService.listEdgeProfiles();
    case 'cfv:check-playwright':
      return cfvService.checkPlaywrightAvailability();

    // CFV Chat API
    case 'cfv-chat:create': {
      const callOutputDir = cfvService.getCallOutputDir(params[0]);
      return cfvChatService.createSession(params[0], callOutputDir, params[1]);
    }
    case 'cfv-chat:send':
      await cfvChatService.send(params[0], params[1]);
      return;
    case 'cfv-chat:get-history':
      return cfvChatService.getHistory(params[0]);
    case 'cfv-chat:destroy':
      await cfvChatService.destroySession(params[0]);
      return;
    case 'cfv-chat:list-sessions': {
      const dir = cfvService.getCallOutputDir(params[0]);
      return cfvChatService.listPersistedSessions(dir);
    }
    case 'cfv-chat:load-session-messages': {
      const dir = cfvService.getCallOutputDir(params[0]);
      return cfvChatService.loadSessionMessages(dir, params[1]);
    }
    case 'cfv-chat:delete-session': {
      const dir = cfvService.getCallOutputDir(params[0]);
      return cfvChatService.deletePersistedSession(dir, params[1]);
    }

    // CFV Filter API
    case 'cfv-filter:save':
      return getCfvFilterService().saveCallFilters(params[0], params[1]);
    case 'cfv-filter:load':
      return getCfvFilterService().loadCallFilters(params[0]);
    case 'cfv-filter:list-presets':
      return getCfvFilterService().listFilterPresets();
    case 'cfv-filter:save-preset':
      return getCfvFilterService().saveFilterPreset(params[0]);
    case 'cfv-filter:delete-preset':
      return getCfvFilterService().deleteFilterPreset(params[0]);

    // Plugin Engine API
    case 'plugin:get-plugins':
      return pluginEngine.getPlugins();
    case 'plugin:get-plugin':
      return pluginEngine.getPlugin(params[0]);
    case 'plugin:execute-trigger':
      return pluginEngine.executeTrigger(params[0], params[1], params[2]);
    case 'plugin:set-enabled':
      pluginEngine.setPluginEnabled(params[0], params[1]);
      return;
    case 'plugin:save-config':
      pluginEngine.savePluginConfig(params[0], params[1]);
      return;
    case 'plugin:get-logs':
      return pluginEngine.getExecutionLogs(params[0]);
    case 'plugin:reload':
      return pluginEngine.reloadPlugin(params[0]);
    case 'plugin:reload-all':
      return pluginEngine.reloadAllPlugins();

    // ICM Auth
    case 'icm:acquire-token':
      return icmAuthService.acquireToken();
    case 'icm:has-valid-token':
      return icmAuthService.hasValidToken();

    // ICM API (wrapped with auto-retry on token errors)
    case 'icm:get-token':
      return icmClient.getToken();
    case 'icm:get-current-user':
      return icmCall(() => icmClient.getCurrentUser());
    case 'icm:get-permissions':
      return icmCall(() => icmClient.getPermissions());
    case 'icm:resolve-contacts':
      return icmCall(() => icmClient.resolveContacts(params[0]));
    case 'icm:query-incidents':
      return icmCall(() => icmClient.queryIncidents(params[0], params[1], params[2], params[3], params[4]));
    case 'icm:get-incident-count':
      return icmCall(() => icmClient.getIncidentCount(params[0]));
    case 'icm:get-incident':
      return icmCall(() => icmClient.getIncident(params[0]));
    case 'icm:get-incident-bridges':
      return icmCall(() => icmClient.getIncidentBridges(params[0]));
    case 'icm:acknowledge':
      return icmCall(() => icmClient.acknowledgeIncident(params[0]));
    case 'icm:transfer':
      return icmCall(() => icmClient.transferIncident(params[0], params[1]));
    case 'icm:mitigate':
      return icmCall(() => icmClient.mitigateIncident(params[0]));
    case 'icm:resolve':
      return icmCall(() => icmClient.resolveIncident(params[0]));
    case 'icm:get-discussion':
      return icmCall(() => icmClient.getDiscussionEntries(params[0]));
    case 'icm:add-discussion':
      return icmCall(() => icmClient.addDiscussionEntry(params[0], params[1]));
    case 'icm:get-favorite-queries':
      return icmCall(() => icmClient.getFavoriteQueries(params[0], params[1]));
    case 'icm:get-saved-queries':
      return icmCall(() => icmClient.getContactQueries(params[0]));
    case 'icm:get-shared-queries':
      return icmCall(() => icmClient.getSharedQueries(params[0]));
    case 'icm:get-teams':
      return icmCall(() => icmClient.getTeams(params[0]));
    case 'icm:search-teams':
      return icmCall(() => icmClient.searchTeams(params[0]));
    case 'icm:search-services':
      return icmCall(() => icmClient.searchServices(params[0]));
    case 'icm:get-alert-sources':
      return icmCall(() => icmClient.getAlertSources(params[0]));
    case 'icm:get-user-preferences':
      return icmCall(() => icmClient.getUserPreferences(params[0]));
    case 'icm:get-feature-flags':
      return icmCall(() => icmClient.getFeatureFlags(params[0], params[1]));
    case 'icm:get-teams-channel':
      return icmCall(() => icmClient.getTeamsChannel(params[0]));
    case 'icm:get-breaking-news':
      return icmCall(() => icmClient.getBreakingNews());
    case 'icm:get-property-groups':
      return icmCall(() => icmClient.getPropertyGroups());
    case 'icm:get-cloud-instances':
      return icmCall(() => icmClient.getCloudInstances());

    // DGrep API
    case 'dgrep:check-token-status':
      return dgrepService.getTokenStatus();
    case 'dgrep:acquire-tokens':
      return dgrepService.acquireTokens();
    case 'dgrep:search-by-log-id':
      return dgrepService.startSearchByLogId(
        params[0] as LogId,
        params[1],
        params[2],
        params[3] || {}
      );
    case 'dgrep:search':
      return dgrepService.startSearch(params[0]);
    case 'dgrep:cancel-search':
      dgrepService.cancelSearch(params[0]);
      return;
    case 'dgrep:get-session':
      return dgrepService.getSession(params[0]);
    case 'dgrep:get-all-sessions':
      return dgrepService.getAllSessions();
    case 'dgrep:get-results':
      return dgrepService.getResults(params[0]);
    case 'dgrep:remove-session':
      dgrepService.removeSession(params[0]);
      return;
    case 'dgrep:get-namespaces':
      return dgrepService.getNamespaces(params[0]);
    case 'dgrep:get-events':
      return dgrepService.getEvents(params[0], params[1]);
    case 'dgrep:generate-url':
      return dgrepService.generateQueryUrl(
        params[0] as LogId,
        params[1],
        params[2],
        params[3]
      );
    case 'dgrep:get-results-page':
      return dgrepService.getResultsPage(params[0], params[1], params[2]);
    case 'dgrep:run-client-query':
      dgrepService.runClientQuery(params[0], params[1]);
      return;
    case 'dgrep:get-monitoring-accounts':
      return dgrepService.getMonitoringAccounts();

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

// Create WebSocket server with increased payload limit for large PRs
const wss = new WebSocketServer({
  port: PORT,
  maxPayload: 500 * 1024 * 1024, // 500MB to handle large PRs with many files
});

wss.on('connection', (ws) => {
  console.log('Client connected');
  clients.add(ws);

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.type === 'rpc') {
        try {
          const result = await handleRpc(message.method, message.params || []);
          ws.send(JSON.stringify({
            type: 'rpc-response',
            id: message.id,
            result,
          }));
        } catch (error: any) {
          ws.send(JSON.stringify({
            type: 'rpc-response',
            id: message.id,
            error: error.message,
          }));
        }
      }
    } catch (error) {
      console.error('Failed to parse message:', error);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

console.log(`Backend bridge running on ws://localhost:${PORT}`);

// Cleanup on exit
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  disposeTerminalManager();
  disposeChatTerminalService();
  await disposeAIReviewService();
  await disposeWalkthroughService();
  disposeApplyChangesService();
  disposePluginEngine();
  disposeCfvChatService();
  disposeCfvService();
  disposeDGrepService();
  disposeLogger();
  wss.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  disposeTerminalManager();
  disposeChatTerminalService();
  await disposeAIReviewService();
  await disposeWalkthroughService();
  disposeApplyChangesService();
  disposePluginEngine();
  disposeCfvChatService();
  disposeCfvService();
  disposeDGrepService();
  disposeLogger();
  wss.close();
  process.exit(0);
});
