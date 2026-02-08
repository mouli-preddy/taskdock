// Import tauri-api to ensure window.electronAPI is set up before use
import './tauri-api';

import type {
  PullRequest,
  PullRequestIteration,
  IterationChange,
  CommentThread,
  FileChange,
  ChangeType,
  PollingSettings,
  CommentAnalysis,
} from '../shared/types.js';
import type {
  AIReviewComment,
  AIReviewSession,
  AIReviewOptions,
  PRContext,
  AIProvider,
  AIProviderType,
  AIReviewRequest,
  AIProgressEvent,
  CodeWalkthrough,
  SavedReviewInfo,
  SavedWalkthroughInfo,
  WalkthroughProgressEvent,
  WalkthroughCompleteEvent,
  WalkthroughErrorEvent,
} from '../shared/ai-types.js';
import type { TerminalSession } from '../shared/terminal-types.js';
import type { WorkItem, SavedQuery } from '../shared/workitem-types.js';
import { DiffViewer } from './components/diff-viewer.js';
import { FileTree } from './components/file-tree.js';
import { CommentsPanel } from './components/comments-panel.js';
import { AICommentsPanel, type AICommentsPanelState } from './components/ai-comments-panel.js';
import { WalkthroughUI } from './components/walkthrough-ui.js';
import { WalkthroughsView } from './components/walkthroughs-view.js';
import { ApplyChangesPanel, type ApplyChangesPanelState } from './components/apply-changes-panel.js';
import { CopilotChatPanel } from './components/copilot-chat-panel.js';
import { showReviewDialog } from './components/review-dialog.js';
import { showWalkthroughDialog } from './components/walkthrough-dialog.js';
import { Toast } from './components/toast.js';
import { SectionSidebar, SectionId } from './components/section-sidebar.js';
import { TabBar, Tab } from './components/tab-bar.js';
import { SettingsView, ReviewSettings } from './components/settings-view.js';
import { PRHomeView } from './components/pr-home-view.js';
import { TerminalsView } from './components/terminals-view.js';
import { AboutView } from './components/about-view.js';
import { WorkItemsListView, WorkItemViewType } from './components/workitems-list-view.js';
import { WorkItemQueryBuilder } from './components/workitem-query-builder.js';
import { WorkItemDetailView } from './components/workitem-detail-view.js';
import { ResizablePanels, setupResizablePanels } from './components/resizable-panels.js';
import { icons, iconHtml, getIcon, getIconByName, MessageSquare, Bot, BookOpen, Globe, Columns, FileText, ChevronLeft, ChevronRight, ChevronDown, X, File, FileCode, ArrowRight, Link, CheckCircle, Check, Clock, XCircle, Circle, Home, LayoutGrid, Settings, ChevronsLeft, Sparkles, Eye, EyeOff, RefreshCw, Terminal } from './utils/icons.js';
import { renderMarkdownSync } from './utils/markdown-renderer.js';
import { PRPollingService, type PollResult, type PollingState } from './services/pr-polling-service.js';
import { PluginTabRenderer } from './components/plugin-tab-renderer.js';
import type { LoadedPlugin, PluginToastEvent, PluginUIUpdateEvent } from '../shared/plugin-types.js';
import { initDeepLinkHandler } from './deep-link-handler.js';
import { notificationService } from './services/notification-service.js';

// Tab type definitions
interface ReviewTab {
  id: string;
  type: 'home' | 'pr';
  label: string;
  closeable: boolean;
  prState?: PRTabState;
}

interface SettingsTab {
  id: string;
  type: 'review';
  label: string;
  closeable: boolean;
}

interface WorkItemTab {
  id: string;
  type: 'list' | 'detail';
  label: string;
  closeable: boolean;
  workItemId?: number;
}

interface PRTabState {
  org: string;
  project: string;
  repoId: string;
  repoName: string;
  prId: number;
  pullRequest: PullRequest | null;
  iterations: PullRequestIteration[];
  selectedIteration: number | null;
  fileChanges: FileChange[];
  selectedFile: string | null;
  /** All threads from the API (includes deleted/system). Use filterVisibleThreads() for display counts. */
  threads: CommentThread[];
  diffViewMode: 'split' | 'unified' | 'preview';
  // Context path for disk-based storage
  prContextKey: string | null;
  // Actual context path on disk (for chat panel and other tools)
  contextPath: string | null;
  // AI Review state
  aiSessionId: string | null;
  aiReviewInProgress: boolean;
  hasSavedReview: boolean;
  hasSavedWalkthrough: boolean;
  savedReviewInfo: SavedReviewInfo | null;
  savedWalkthroughInfo: SavedWalkthroughInfo | null;
  // AI Panel state (for saving/restoring when switching tabs)
  aiPanelState?: AICommentsPanelState;
  // Polling state
  pollingState: PollingState | null;
  hasNewVersion: boolean;
  // Apply Changes state
  applyChangesPanelState?: ApplyChangesPanelState;
  // Chat Panel state
  copilotChatPanelOpen: boolean;
  copilotChatAI: 'copilot' | 'claude';
}

/** Filter out deleted threads and threads with only system/deleted comments */
function filterVisibleThreads(threads: CommentThread[]): CommentThread[] {
  return threads.filter(t =>
    !t.isDeleted && t.comments.some(c => c.commentType !== 'system' && !c.isDeleted)
  );
}

class PRReviewApp {
  // Global state
  private organization = '';
  private project = '';

  // Section/Tab state
  private sectionSidebar!: SectionSidebar;
  private reviewTabBar!: TabBar;
  private settingsTabBar!: TabBar;
  private settingsView!: SettingsView;
  private prHomeView!: PRHomeView;
  private terminalsView!: TerminalsView;
  private aboutView!: AboutView;
  private workItemsListView!: WorkItemsListView;
  private workItemQueryBuilder!: WorkItemQueryBuilder;
  private workItemDetailViews: Map<string, WorkItemDetailView> = new Map();

  private activeSection: SectionId = 'review';
  private reviewTabs: ReviewTab[] = [];
  private activeReviewTabId: string = 'home';
  private settingsTabs: SettingsTab[] = [];
  private activeSettingsTabId: string = 'review';
  private workItemsTabs: WorkItemTab[] = [];
  private activeWorkItemsTabId: string = 'list';
  private savedQueries: SavedQuery[] = [];

  // PR tab states map (tabId -> PRTabState)
  private prTabStates: Map<string, PRTabState> = new Map();

  // Event listener cleanup for tabs (tabId -> AbortController)
  private tabEventListeners: Map<string, AbortController> = new Map();

  // Current active PR tab components (shared across tabs, re-used)
  private diffViewer: DiffViewer;
  private fileTree: FileTree;
  private commentsPanel: CommentsPanel;
  private aiCommentsPanel: AICommentsPanel;
  private walkthroughUI: WalkthroughUI;
  private applyChangesPanel: ApplyChangesPanel;
  private copilotChatPanel: CopilotChatPanel;

  // WalkthroughsView instances per tab (tabId -> WalkthroughsView)
  private walkthroughsViews: Map<string, WalkthroughsView> = new Map();

  // ResizablePanels instances per tab (tabId -> ResizablePanels)
  private resizablePanels: Map<string, ResizablePanels> = new Map();

  // Plugin renderers
  private pluginRenderers: Map<string, PluginTabRenderer> = new Map();

  // Plugin hook buttons for built-in tabs
  private pluginHookButtons: Array<{
    pluginId: string;
    tab: string;
    location: string;
    label: string;
    icon: string;
    trigger: string;
    position: string;
  }> = [];

  // PR lists
  private myPRs: PullRequest[] = [];
  private createdPRs: PullRequest[] = [];

  // Cached generated file patterns from settings
  private generatedFilePatterns: string[] = [];

  // Cached enableWorkIQ setting
  private enableWorkIQ: boolean = true;

  // Preferred diff view mode (loaded from saved settings)
  private preferredDiffViewMode: 'split' | 'unified' = 'split';

  // Polling service
  private pollingService: PRPollingService;

  // Fix tracking: map source comment IDs to queue item IDs
  private commentToQueueItemMap: Map<string, { itemId: string; source: 'ai' | 'ado'; filePath: string; startLine: number; prId: number }> = new Map();

  // Elements
  private loadingOverlay!: HTMLElement;


  constructor() {
    // Initialize shared components
    this.diffViewer = new DiffViewer();
    this.fileTree = new FileTree();
    this.commentsPanel = new CommentsPanel();
    this.aiCommentsPanel = new AICommentsPanel();
    this.walkthroughUI = new WalkthroughUI();
    this.applyChangesPanel = new ApplyChangesPanel();
    this.copilotChatPanel = new CopilotChatPanel();

    // Initialize polling service
    this.pollingService = new PRPollingService();
    this.pollingService.onPollResult((tabId, result) => this.handlePollResult(tabId, result));

    this.initElements();
    this.initSections();
    this.initEventListeners();
    this.initAIListeners();
    this.initTerminalListeners();
    this.initTheme();
    this.initPlugins();

    // Load notification settings
    notificationService.loadSettings();

    // Check if first launch
    this.checkFirstLaunch();

    initDeepLinkHandler(this).catch(e => {
      console.error('[deep-link] Failed to initialize:', e);
    });
  }

  private initElements() {
    this.loadingOverlay = document.getElementById('loadingOverlay')!;
  }

  private initSections() {
    // Initialize sidebar
    this.sectionSidebar = new SectionSidebar();
    this.sectionSidebar.onSelect((section) => this.switchSection(section));

    // Initialize review tab bar
    this.reviewTabBar = new TabBar('tabBar');
    this.reviewTabBar.onSelect((tabId) => this.switchReviewTab(tabId));
    this.reviewTabBar.onClose((tabId) => this.closeReviewTab(tabId));

    // Initialize settings view
    this.settingsView = new SettingsView('settingsTabPanel');
    this.settingsView.onSave(async (settings) => this.saveSettings(settings));
    this.settingsView.onTest(async (settings) => this.testConnection(settings));
    this.settingsView.onConsoleSettingsSaved((settings) => this.onConsoleSettingsChanged(settings));
    this.settingsView.onPollingSettingsSaved((settings) => this.onPollingSettingsChanged(settings));
    this.settingsView.onNotificationSettingsSaved((settings) => {
      notificationService.updateSettings(settings);
    });

    // Initialize PR home view
    this.prHomeView = new PRHomeView('homeTabPanel');
    this.prHomeView.onOpenPR((pr) => this.openPRTab(pr));
    this.prHomeView.onOpenPRByUrl((org, project, prId) => this.openPRByUrl(org, project, prId));
    this.prHomeView.onRefresh(() => this.loadPRLists());

    // Initialize terminals view
    this.terminalsView = new TerminalsView('terminalsView');
    this.aboutView = new AboutView('aboutTabPanel');
    this.terminalsView.onClose(async (sessionId, isChat) => {
      await this.closeTerminalSession(sessionId, isChat);
    });

    // Initialize work items views
    this.workItemsListView = new WorkItemsListView('workItemsListPanel');
    this.workItemsListView.onSelect((item) => this.openWorkItemTab(item));
    this.workItemsListView.onRefresh(() => this.refreshWorkItems());
    this.workItemsListView.onNewQuery(() => this.showQueryBuilder());
    this.workItemsListView.onImportAdoQuery(() => this.showImportAdoQueryModal());
    this.workItemsListView.onEditQuery((query) => this.showQueryBuilder(query));
    this.workItemsListView.onDeleteQuery((queryId) => this.deleteQuery(queryId));
    this.workItemsListView.onRunQuery((query) => this.runCustomQuery(query));

    this.workItemQueryBuilder = new WorkItemQueryBuilder();
    this.workItemQueryBuilder.onSave((query) => this.saveQuery(query));

    // Initialize tabs
    this.reviewTabs = [
      { id: 'home', type: 'home', label: 'Home', closeable: false },
    ];
    this.settingsTabs = [
      { id: 'review', type: 'review', label: 'Review', closeable: false },
    ];
    this.workItemsTabs = [
      { id: 'list', type: 'list', label: 'Work Items', closeable: false },
    ];

    // Set initial state
    this.updateTabBar();
    this.showHomeTab();
  }

  private async initPlugins() {
    try {
      const plugins: LoadedPlugin[] = await window.electronAPI.pluginGetPlugins();

      for (const plugin of plugins) {
        if (!plugin.enabled || !plugin.ui) continue;

        // Add sidebar section
        this.sectionSidebar.addSection({
          id: `plugin-${plugin.id}`,
          icon: getIconByName(plugin.ui.tab.icon, 20) || `<span class="plugin-icon-text">\uD83D\uDD0C</span>`,
          label: plugin.ui.tab.label,
        });

        // Create container
        const container = document.createElement('div');
        container.className = 'section-content hidden';
        container.id = `pluginSection-${plugin.id}`;
        container.innerHTML = '<div class="tab-panel active plugin-tab-content"></div>';
        document.getElementById('pluginSectionContents')?.appendChild(container);

        // Create renderer
        const renderer = new PluginTabRenderer(
          container.querySelector('.plugin-tab-content')!,
          plugin
        );
        renderer.onTrigger((triggerId, input) => {
          window.electronAPI.pluginExecuteTrigger(plugin.id, triggerId, input);
        });
        renderer.render();
        this.pluginRenderers.set(plugin.id, renderer);
      }

      // Collect hooks from all enabled plugins and render them
      this.renderPluginHooks(plugins.filter(p => p.enabled));

      // Subscribe to plugin events
      window.electronAPI.onPluginUIUpdate((event: PluginUIUpdateEvent) => {
        const renderer = this.pluginRenderers.get(event.pluginId);
        if (renderer) renderer.updateComponent(event.componentId, event.data);
      });

      window.electronAPI.onPluginUIToast((event: PluginToastEvent) => {
        switch (event.level) {
          case 'success': Toast.success(event.message); break;
          case 'error': Toast.error(event.message); break;
          case 'warning': Toast.warning(event.message); break;
          default: Toast.info(event.message);
        }
      });

      window.electronAPI.onPluginUIInject((event: any) => {
        // Handle dynamic injection of components into core tabs
        console.log('Plugin UI inject:', event);
      });

      window.electronAPI.onPluginNavigate((event: { pluginId: string; section: string }) => {
        this.switchSection(event.section as SectionId);
      });

      window.electronAPI.onPluginsReloaded(() => {
        // Remove existing plugin sections and re-init
        for (const [pluginId] of this.pluginRenderers) {
          this.sectionSidebar.removeSection(`plugin-${pluginId}`);
          document.getElementById(`pluginSection-${pluginId}`)?.remove();
        }
        this.pluginRenderers.clear();
        this.pluginHookButtons = [];
        this.initPlugins();
      });
    } catch (err) {
      console.error('Failed to initialize plugins:', err);
    }
  }

  private renderPluginHooks(plugins: LoadedPlugin[]): void {
    // Collect all hooks from enabled plugins
    for (const plugin of plugins) {
      if (!plugin.manifest.hooks) continue;

      // PR Review toolbar hooks
      const prReviewHooks = plugin.manifest.hooks['pr-review'];
      if (prReviewHooks?.toolbar) {
        for (const hook of prReviewHooks.toolbar) {
          // Store hook info so we can render it when PR tabs are created
          this.pluginHookButtons.push({
            pluginId: plugin.id,
            tab: 'pr-review',
            location: 'toolbar',
            label: hook.label,
            icon: hook.icon,
            trigger: hook.trigger,
            position: hook.position || 'right',
          });
        }
      }
    }
  }

  private initEventListeners() {
    // View toggle in PR review
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const view = target.dataset.view as 'split' | 'unified' | 'preview';
        this.setDiffViewMode(view);
      });
    });

    // File tree selection
    this.fileTree.onSelect((path) => this.selectFile(path));

    // File review toggle
    this.fileTree.onReview((path, reviewed) => {
      this.updateReviewProgress();
    });

    // Comments panel
    this.commentsPanel.onReply(async (threadId, content) => {
      await this.replyToThread(threadId, content);
    });

    this.commentsPanel.onStatusChange(async (threadId, status) => {
      await this.updateThreadStatus(threadId, status);
    });

    // Diff viewer add comment
    this.diffViewer.onAddComment(async (filePath, startLine, endLine, content) => {
      await this.createComment(filePath, startLine, endLine, content);
    });

    // Diff viewer comment badge click
    this.diffViewer.onCommentBadgeClick((threadIds) => {
      if (threadIds.length > 0) {
        this.commentsPanel.scrollToThread(threadIds[0]);
      }
    });

    // Comments panel click - scroll to line
    this.commentsPanel.onScrollToLine((filePath, line) => {
      const state = this.getCurrentPRState();
      if (!state) return;
      if (state.selectedFile !== filePath) {
        this.selectFile(filePath);
        setTimeout(() => this.diffViewer.scrollToLine(line), 100);
      } else {
        this.diffViewer.scrollToLine(line);
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyboard(e));

    // Theme change from system
    window.electronAPI.onThemeChange((isDark) => {
      this.setTheme(isDark ? 'dark' : 'light');
    });

    // Setup modal "Go to Settings" button
    document.getElementById('goToSettingsBtn')?.addEventListener('click', () => {
      document.getElementById('setupModalBackdrop')?.classList.add('hidden');
      this.switchSection('settings');
    });

    // Apply Changes Panel callbacks
    this.applyChangesPanel.onClose(() => {
      document.getElementById(`reviewScreen-${this.activeReviewTabId}`)?.classList.remove('apply-changes-open');
      this.updatePanelButtonState('applyChangesBtn', false);
    });

    this.applyChangesPanel.onPause(async () => {
      const state = this.getCurrentPRState();
      if (state && window.electronAPI.applyChangesPause) {
        await window.electronAPI.applyChangesPause(state.prId);
      }
    });

    this.applyChangesPanel.onResume(async () => {
      const state = this.getCurrentPRState();
      if (state && window.electronAPI.applyChangesResume) {
        await window.electronAPI.applyChangesResume(state.prId);
      }
    });

    this.applyChangesPanel.onRetry(async (itemId) => {
      const state = this.getCurrentPRState();
      if (state && window.electronAPI.applyChangesRetry) {
        await window.electronAPI.applyChangesRetry(state.prId, itemId);
      }
    });

    this.applyChangesPanel.onSkip(async (itemId) => {
      const state = this.getCurrentPRState();
      if (state && window.electronAPI.applyChangesSkip) {
        await window.electronAPI.applyChangesSkip(state.prId, itemId);
      }
    });

    this.applyChangesPanel.onRemove(async (itemId) => {
      const state = this.getCurrentPRState();
      if (state && window.electronAPI.applyChangesRemove) {
        await window.electronAPI.applyChangesRemove(state.prId, itemId);
      }
    });

    this.applyChangesPanel.onClearCompleted(async () => {
      const state = this.getCurrentPRState();
      if (state && window.electronAPI.applyChangesClearCompleted) {
        await window.electronAPI.applyChangesClearCompleted(state.prId);
      }
    });

    this.applyChangesPanel.onNavigate((filePath, line) => {
      this.navigateToFile(filePath, line);
    });

    // CommentsPanel apply callback
    this.commentsPanel.onApply(async (threadId, content, filePath, line, customMessage) => {
      const state = this.getCurrentPRState();
      if (!state) return;

      if (!window.electronAPI.applyChangesQueue) {
        Toast.error('Apply Changes feature not available');
        return;
      }

      // Set applying state immediately
      this.commentsPanel.setApplyingThread(threadId, true);

      try {
        await window.electronAPI.applyChangesQueue({
          prId: state.prId,
          source: 'ado',
          sourceId: threadId.toString(),
          filePath,
          lineNumber: line,
          commentContent: content,
          customMessage,
        });

        document.getElementById(`reviewScreen-${this.activeReviewTabId}`)?.classList.add('apply-changes-open');
        this.updatePanelButtonState('applyChangesBtn', true);
        await this.refreshApplyChangesState(state.prId);

        // Find the queue item ID that was just created
        const queueState = this.applyChangesPanel.getState().queueState;
        if (queueState) {
          const item = queueState.items.find(i => i.source === 'ado' && i.sourceId === threadId.toString());
          if (item) {
            this.commentToQueueItemMap.set(threadId.toString(), {
              itemId: item.id,
              source: 'ado',
              filePath,
              startLine: line,
              prId: state.prId,
            });
          }
        }

        Toast.success('Added to apply queue');
      } catch (error) {
        this.commentsPanel.setApplyingThread(threadId, false);
        Toast.error('Failed to add to apply queue');
        console.error('Failed to queue ADO comment:', error);
      }
    });

    // Comment Analysis callbacks
    this.commentsPanel.onAnalyze(async (threadIds) => {
      await this.analyzeComments(threadIds);
    });

    this.commentsPanel.onReanalyze(async (threadId) => {
      await this.reanalyzeComment(threadId);
    });

    this.commentsPanel.onApplyAnalysisFix(async (threadId, analysis, customMessage) => {
      await this.applyAnalysisFix(threadId, analysis, customMessage);
    });

    this.commentsPanel.onPostAnalysisReply(async (threadId, content) => {
      await this.postAnalysisReply(threadId, content);
    });
  }

  private initAIListeners() {
    // AI Comments Panel callbacks
    this.aiCommentsPanel.onPublish(async (comment) => {
      await this.publishAIComment(comment);
    });

    this.aiCommentsPanel.onPublishAll(async (comments) => {
      for (const comment of comments) {
        await this.publishAIComment(comment);
      }
    });

    this.aiCommentsPanel.onDismiss((commentId) => {
      const state = this.getCurrentPRState();
      if (state?.aiSessionId) {
        window.electronAPI.aiDismissComment(state.aiSessionId, commentId);
      }
    });

    this.aiCommentsPanel.onNavigate((filePath, line) => {
      const state = this.getCurrentPRState();
      if (!state) return;
      if (state.selectedFile !== filePath) {
        this.selectFile(filePath);
        setTimeout(() => this.diffViewer.scrollToLine(line), 100);
      } else {
        this.diffViewer.scrollToLine(line);
      }
    });

    this.aiCommentsPanel.onSave(async () => {
      await this.saveCurrentReview();
    });

    // AICommentsPanel apply callback
    this.aiCommentsPanel.onApply(async (comment, customMessage) => {
      const state = this.getCurrentPRState();
      if (!state) return;

      if (!window.electronAPI.applyChangesQueue) {
        Toast.error('Apply Changes feature not available');
        return;
      }

      // Set applying state immediately
      this.aiCommentsPanel.setApplyingComment(comment.id, true);

      try {
        const content = `${comment.title}\n\n${comment.content}${comment.suggestedFix ? `\n\nSuggested fix:\n${comment.suggestedFix}` : ''}`;

        await window.electronAPI.applyChangesQueue({
          prId: state.prId,
          source: 'ai',
          sourceId: comment.id,
          filePath: comment.filePath,
          lineNumber: comment.startLine,
          commentContent: content,
          customMessage,
        });

        document.getElementById(`reviewScreen-${this.activeReviewTabId}`)?.classList.add('apply-changes-open');
        this.updatePanelButtonState('applyChangesBtn', true);
        await this.refreshApplyChangesState(state.prId);

        // Find the queue item ID that was just created
        const queueState = this.applyChangesPanel.getState().queueState;
        if (queueState) {
          const item = queueState.items.find(i => i.source === 'ai' && i.sourceId === comment.id);
          if (item) {
            this.commentToQueueItemMap.set(comment.id, {
              itemId: item.id,
              source: 'ai',
              filePath: comment.filePath,
              startLine: comment.startLine,
              prId: state.prId,
            });
          }
        }

        Toast.success('Added to apply queue');
      } catch (error) {
        this.aiCommentsPanel.setApplyingComment(comment.id, false);
        Toast.error('Failed to add to apply queue');
        console.error('Failed to queue AI comment:', error);
      }
    });

    // AICommentsPanel tab callbacks for multiple reviews
    this.aiCommentsPanel.onTabSelect(async (sessionId, isSaved) => {
      await this.handleReviewTabSelect(sessionId, isSaved);
    });

    this.aiCommentsPanel.onTabClose(async (sessionId, isSaved) => {
      await this.handleReviewTabClose(sessionId, isSaved);
    });

    this.aiCommentsPanel.onNewReview(async () => {
      await this.startNewReview();
    });

    // Walkthrough UI callbacks
    this.walkthroughUI.onNavigate((filePath, line) => {
      const state = this.getCurrentPRState();
      if (!state) return;
      if (state.selectedFile !== filePath) {
        this.selectFile(filePath);
        setTimeout(() => this.diffViewer.scrollToLine(line), 100);
      } else {
        this.diffViewer.scrollToLine(line);
      }
    });

    this.walkthroughUI.onClose(() => {
      // Clear the active walkthrough highlight when overlay is closed
      const walkthroughsView = this.walkthroughsViews.get(this.activeReviewTabId);
      if (walkthroughsView) {
        walkthroughsView.setActiveSession(null);
      }
    });

    // AI Event listeners from main process
    window.electronAPI.onAIProgress((event) => {
      this.handleAIProgress(event);
    });

    window.electronAPI.onAIComment((event) => {
      this.handleAIComment(event);
    });

    window.electronAPI.onAIWalkthrough((event) => {
      this.handleAIWalkthrough(event);
    });

    window.electronAPI.onAIError((event) => {
      this.handleAIError(event);
    });

    // Walkthrough event listeners from main process
    window.electronAPI.onWalkthroughProgress((event: WalkthroughProgressEvent) => {
      this.handleWalkthroughProgress(event);
    });

    window.electronAPI.onWalkthroughComplete((event: WalkthroughCompleteEvent) => {
      this.handleWalkthroughComplete(event);
    });

    window.electronAPI.onWalkthroughError((event: WalkthroughErrorEvent) => {
      this.handleWalkthroughError(event);
    });

    // Apply Changes progress listener
    if (typeof window.electronAPI.onApplyChangesProgress === 'function') {
      window.electronAPI.onApplyChangesProgress(async (event) => {
        const state = this.getCurrentPRState();
        if (state && event.prId === state.prId) {
          await this.refreshApplyChangesState(state.prId);

          // Handle fix tracking based on status
          if (event.status === 'success') {
            const mapping = Array.from(this.commentToQueueItemMap.entries())
              .find(([, v]) => v.itemId === event.itemId);

            if (mapping) {
              const [commentSourceId, { source, filePath, startLine }] = mapping;

              // Mark as fixed in persistent storage
              if (window.electronAPI.fixTrackerMarkFixed) {
                try {
                  await window.electronAPI.fixTrackerMarkFixed(state.prId, state.org, state.project, {
                    commentId: commentSourceId,
                    commentType: source,
                    fixedAt: new Date().toISOString(),
                    filePath,
                    startLine,
                  });
                } catch (error) {
                  console.error('Failed to persist fix:', error);
                }
              }

              // Update UI based on source type
              if (source === 'ai') {
                this.aiCommentsPanel.markCommentFixed(commentSourceId);
              } else {
                this.commentsPanel.markThreadFixed(parseInt(commentSourceId, 10));
              }

              // Clean up mapping
              this.commentToQueueItemMap.delete(commentSourceId);
            }
          } else if (event.status === 'failed') {
            // Reset applying state on failure
            const mapping = Array.from(this.commentToQueueItemMap.entries())
              .find(([, v]) => v.itemId === event.itemId);

            if (mapping) {
              const [commentSourceId, { source }] = mapping;
              if (source === 'ai') {
                this.aiCommentsPanel.setApplyingComment(commentSourceId, false);
              } else {
                this.commentsPanel.setApplyingThread(parseInt(commentSourceId, 10), false);
              }
              // Clean up mapping on failure
              this.commentToQueueItemMap.delete(commentSourceId);
            }
          }
        }
      });
    }
  }

  private findSourceIdByQueueItem(itemId: string, source: 'ai' | 'ado'): string | null {
    const queueState = this.applyChangesPanel.getState().queueState;
    if (!queueState) return null;

    const item = queueState.items.find(i => i.id === itemId && i.source === source);
    return item?.sourceId || null;
  }

  private initTerminalListeners() {
    // Terminal session created events
    window.electronAPI.onTerminalSessionCreated((event) => {
      console.log('[Renderer] Received terminal:session-created:', event.session?.id, event.session?.label);
      this.terminalsView.addSession(event.session);
    });

    // Terminal data events
    window.electronAPI.onTerminalData((event) => {
      this.terminalsView.writeToTerminal(event.sessionId, event.data);
    });

    // Terminal exit events
    window.electronAPI.onTerminalExit((event) => {
      this.terminalsView.updateSession(event.sessionId, { status: 'completed' });
    });

    // Terminal status change events
    window.electronAPI.onTerminalStatusChange((event) => {
      this.terminalsView.updateSession(event.sessionId, { status: event.status as any });
    });

    // Terminal review complete events
    window.electronAPI.onTerminalReviewComplete(async (event) => {
      await this.handleTerminalReviewComplete(event);
    });

    // Chat terminal events (for plugin-launched AI terminals)
    window.electronAPI.onChatTerminalSessionCreated((event) => {
      console.log('[Renderer] Received chat-terminal:session-created:', event.session?.id);
      // Add to terminals view so it's visible in the Terminals tab
      this.terminalsView.addSession({
        id: event.session.id,
        label: `AI Chat (${event.session.ai})`,
        status: event.session.status || 'running',
        prId: 0,
        organization: '',
        project: '',
        workingDir: event.session.workingDir || '',
        contextPath: event.session.contextPath || '',
        createdAt: event.session.createdAt || new Date().toISOString(),
      }, true /* isChat */);
    });

    // Chat terminal data listener
    window.electronAPI.onChatTerminalData((event) => {
      // Forward to copilot chat panel if it owns this session
      if (event.sessionId === this.copilotChatPanel.getSessionId()) {
        this.copilotChatPanel.writeToTerminal(event.data);
      }
      // Also forward to terminals view (for plugin-launched chat terminals)
      this.terminalsView.writeToTerminal(event.sessionId, event.data);
    });

    window.electronAPI.onChatTerminalExit((event) => {
      this.terminalsView.updateSession(event.sessionId, { status: 'completed' });
    });

    window.electronAPI.onChatTerminalStatusChange((event) => {
      this.terminalsView.updateSession(event.sessionId, { status: event.status as any });
    });
  }

  private async handleTerminalReviewComplete(event: { sessionId: string; result: any }) {
    const { sessionId, result } = event;

    // Get the session to find context path and PR info
    const session = await window.electronAPI.terminalGetSession(sessionId);
    if (!session) {
      Toast.error('Could not find terminal session');
      return;
    }

    // Check if there was an error in the review
    if (result.status === 'error') {
      Toast.error(`Review failed: ${result.error || 'Unknown error'}`);
      return;
    }

    // Read the output files
    const { review, walkthrough } = await window.electronAPI.consoleReviewReadOutput(session.contextPath);

    // Find the corresponding PR tab
    const tabId = `pr-${session.prId}`;
    const state = this.prTabStates.get(tabId);

    let aiComments: AIReviewComment[] = [];

    if (state) {
      // Populate AI comments
      if (review?.comments && review.comments.length > 0) {
        // Map console review comments to AIReviewComment format
        aiComments = review.comments.map((c: any) => ({
          id: c.id || `console-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          filePath: c.filePath,
          startLine: c.startLine,
          endLine: c.endLine,
          severity: c.severity || 'minor',
          category: c.category || 'other',
          title: c.title || 'Review Comment',
          content: c.content || '',
          suggestedFix: c.suggestedFix,
          confidence: c.confidence || 0.8,
          published: false,
        }));

        this.aiCommentsPanel.clear();
        this.aiCommentsPanel.setComments(aiComments);

        // Add markers to diff viewer if viewing this PR
        if (this.activeReviewTabId === tabId) {
          for (const comment of aiComments) {
            this.diffViewer.addAICommentMarker(comment);
          }
        }

        // Auto-save review comments (same as walkthrough)
        try {
          await window.electronAPI.aiSaveReviewComments(
            state.org,
            state.project,
            state.prId,
            aiComments
          );
          state.hasSavedReview = true;
          state.savedReviewInfo = {
            exists: true,
            savedAt: new Date().toISOString(),
            commentCount: aiComments.length,
          };
        } catch (error) {
          console.error('Failed to auto-save review:', error);
        }
      }

      // Populate and save walkthrough
      if (walkthrough) {
        // Convert to CodeWalkthrough format
        const steps = (walkthrough.steps || []).map((s: any, index: number) => ({
          stepNumber: s.stepNumber || s.order || (index + 1),
          filePath: s.filePath || '',
          startLine: s.startLine || 0,
          endLine: s.endLine || 0,
          title: s.title || '',
          description: s.description || '',
          relatedFiles: s.relatedFiles,
          diagram: s.diagram,
        }));

        const codeWalkthrough: CodeWalkthrough = {
          id: `console-${sessionId}`,
          prId: session.prId,
          summary: walkthrough.summary || '',
          architectureDiagram: walkthrough.architectureDiagram,
          steps,
          totalSteps: steps.length,
          estimatedReadTime: Math.max(1, Math.ceil(steps.length * 0.5)), // ~30 seconds per step
        };

        // Only show walkthrough if user is on this PR's tab
        if (this.activeReviewTabId === tabId) {
          this.walkthroughUI.show(codeWalkthrough, tabId);
        }

        // Auto-save walkthrough with session-based filename
        const walkthroughSessionId = `console-${sessionId}`;
        try {
          await window.electronAPI.aiSaveWalkthroughSession(
            state.org,
            state.project,
            state.prId,
            walkthroughSessionId,
            'Deep Review Walkthrough',
            'claude-terminal',
            codeWalkthrough
          );
          state.hasSavedWalkthrough = true;
          state.savedWalkthroughInfo = {
            exists: true,
            savedAt: new Date().toISOString(),
          };
        } catch (error) {
          console.error('Failed to save walkthrough:', error);
        }

        // Add to walkthroughs sidebar
        const walkthroughsView = this.walkthroughsViews.get(this.activeReviewTabId);
        if (walkthroughsView) {
          walkthroughsView.addSession({
            id: walkthroughSessionId,
            prId: state.prId,
            name: 'Deep Review Walkthrough',
            provider: 'claude-terminal',
            showTerminal: false,
            status: 'complete',
            createdAt: new Date().toISOString(),
            walkthrough: codeWalkthrough,
          });
        }
      }

      // Update saved data buttons
    }

    // Get settings to check auto-close behavior
    const settings = await window.electronAPI.getConsoleReviewSettings();

    // Show notification
    if (settings.showNotification) {
      const commentCount = aiComments.length;
      Toast.success(`Deep review completed: ${commentCount} comment${commentCount !== 1 ? 's' : ''} found`);
      if (state) {
        notificationService.notify(
          'aiReviewComplete',
          'PR Review Complete',
          `${commentCount} comment${commentCount !== 1 ? 's' : ''} found on PR #${state.prId}`
        );
      }
    }

    // Auto-close terminal if enabled
    if (settings.autoCloseTerminal) {
      // Remove the terminal session (kills process and removes from backend)
      await window.electronAPI.terminalRemove(sessionId);
      // Remove from view after a short delay to allow any final output
      setTimeout(() => {
        this.terminalsView.removeSession(sessionId);
      }, 500);
    }

    // Cleanup context (temp files) based on settings
    // Only cleanup after terminal is closed to ensure files aren't needed
    if (settings.worktreeCleanup === 'auto' && settings.autoCloseTerminal) {
      setTimeout(async () => {
        try {
          await window.electronAPI.consoleReviewCleanup(session.contextPath);
        } catch (error) {
          console.error('Failed to cleanup review context:', error);
        }
      }, 1000);
    }

    // Switch to review section if we have results
    if (state && (aiComments.length > 0 || walkthrough)) {
      // Switch to the PR tab
      this.switchSection('review');
      this.switchReviewTab(tabId);

    }
  }

  private initTheme() {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.setTheme(prefersDark ? 'dark' : 'light');
  }

  private setTheme(theme: 'light' | 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  }

  // Section switching
  public switchSection(section: SectionId) {
    this.activeSection = section;
    this.sectionSidebar.setActive(section);

    // Hide walkthrough when leaving review section
    if (section !== 'review' && this.walkthroughUI.isVisible()) {
      this.walkthroughUI.hide();
    }

    // Show/hide section content
    document.getElementById('reviewSectionContent')?.classList.toggle('hidden', section !== 'review');
    document.getElementById('settingsSectionContent')?.classList.toggle('hidden', section !== 'settings');
    document.getElementById('terminalsSectionContent')?.classList.toggle('hidden', section !== 'terminals');
    document.getElementById('workItemsSectionContent')?.classList.toggle('hidden', section !== 'workItems');
    document.getElementById('aboutSectionContent')?.classList.toggle('hidden', section !== 'about');

    // Hide/show plugin sections
    const pluginContents = document.getElementById('pluginSectionContents');
    if (pluginContents) {
      for (const child of Array.from(pluginContents.children)) {
        (child as HTMLElement).classList.add('hidden');
      }
      const pluginSection = document.getElementById(`pluginSection-${section.replace('plugin-', '')}`);
      if (pluginSection) {
        pluginSection.classList.remove('hidden');
      }
    }

    // Refresh terminals list when switching to terminals
    if (section === 'terminals') {
      this.terminalsView.refresh();
    }

    // Load work items when switching to work items section
    if (section === 'workItems') {
      this.refreshWorkItems();
      this.loadSavedQueries();
    }

    // Update tab bar
    this.updateTabBar();
  }

  // Tab management
  private updateTabBar() {
    if (this.activeSection === 'review') {
      const tabs: Tab[] = this.reviewTabs.map(t => ({
        id: t.id,
        label: t.label,
        closeable: t.closeable,
        icon: t.type === 'home' ? getIcon(Home, 14) : undefined,
      }));
      this.reviewTabBar.setTabs(tabs);
      this.reviewTabBar.setActive(this.activeReviewTabId);
    } else if (this.activeSection === 'about') {
      // About section has no tabs - hide the tab bar
      this.reviewTabBar.setTabs([]);
    } else if (this.activeSection === 'settings') {
      const tabs: Tab[] = this.settingsTabs.map(t => ({
        id: t.id,
        label: t.label,
        closeable: t.closeable,
        icon: getIcon(Settings, 14),
      }));
      this.reviewTabBar.setTabs(tabs);
      this.reviewTabBar.setActive(this.activeSettingsTabId);
    } else if (this.activeSection.startsWith('plugin-')) {
      // Plugin sections have no tab bar
      this.reviewTabBar.setTabs([]);
    } else {
      // Default: show settings tabs for other sections (workItems, terminals)
      const tabs: Tab[] = this.settingsTabs.map(t => ({
        id: t.id,
        label: t.label,
        closeable: t.closeable,
        icon: getIcon(Settings, 14),
      }));
      this.reviewTabBar.setTabs(tabs);
      this.reviewTabBar.setActive(this.activeSettingsTabId);
    }
  }

  private switchReviewTab(tabId: string) {
    // Save current tab state before switching
    this.saveCurrentTabState();

    // Close chat panel when switching tabs
    if (this.copilotChatPanel.isVisible()) {
      this.closeCopilotChatPanel();
    }

    this.activeReviewTabId = tabId;
    this.reviewTabBar.setActive(tabId);

    // Hide walkthrough if it doesn't belong to the new tab
    this.walkthroughUI.hideIfNotOnTab(tabId);

    // Show appropriate panel
    if (tabId === 'home') {
      this.showHomeTab();
    } else {
      this.showPRTab(tabId);
    }
  }

  private closeReviewTab(tabId: string) {
    const tab = this.reviewTabs.find(t => t.id === tabId);
    if (!tab || !tab.closeable) return;

    // Remove tab
    const index = this.reviewTabs.findIndex(t => t.id === tabId);
    this.reviewTabs.splice(index, 1);

    // Stop polling for this tab
    this.pollingService.stopPolling(tabId);

    // Clean up event listeners
    const controller = this.tabEventListeners.get(tabId);
    if (controller) {
      controller.abort();
      this.tabEventListeners.delete(tabId);
    }

    // Clean up WalkthroughsView
    this.walkthroughsViews.delete(tabId);

    // Clean up ResizablePanels
    const resizer = this.resizablePanels.get(tabId);
    if (resizer) {
      resizer.destroy();
      this.resizablePanels.delete(tabId);
    }

    // Clean up chat panel if this is the active tab with chat open
    if (tabId === this.activeReviewTabId && this.copilotChatPanel.isVisible()) {
      this.closeCopilotChatPanel();
    }

    // Get state before cleanup for cache eviction
    const state = this.prTabStates.get(tabId);

    // Clean up fix tracking mappings for this tab's PR
    if (state?.prId) {
      for (const [key, mapping] of this.commentToQueueItemMap.entries()) {
        if (mapping.prId === state.prId) {
          this.commentToQueueItemMap.delete(key);
        }
      }
    }

    // Evict from memory cache (keeps files on disk)
    if (state?.prContextKey) {
      window.electronAPI.evictPRFromCache(state.prContextKey).catch(console.warn);
    }

    // Remove tab state
    this.prTabStates.delete(tabId);

    // Remove tab panel
    const panel = document.getElementById(`prTabPanel-${tabId}`);
    panel?.remove();

    // Switch to another tab if this was active
    if (this.activeReviewTabId === tabId) {
      const newIndex = Math.min(index, this.reviewTabs.length - 1);
      const newTab = this.reviewTabs[newIndex];
      if (newTab) {
        this.switchReviewTab(newTab.id);
      }
    }

    this.updateTabBar();
  }

  private showHomeTab() {
    // Hide walkthrough overlay (it belongs to a PR, not the home tab)
    this.walkthroughUI.hide();

    // Hide all PR panels
    document.querySelectorAll('.pr-review-panel').forEach(panel => {
      panel.classList.add('hidden');
    });

    // Hide PR panels container
    document.getElementById('prTabPanelsContainer')?.classList.add('hidden');

    // Show home panel
    document.getElementById('homeTabPanel')?.classList.remove('hidden');
    document.getElementById('homeTabPanel')?.classList.add('active');
  }

  private showPRTab(tabId: string) {
    // Hide home panel
    document.getElementById('homeTabPanel')?.classList.add('hidden');
    document.getElementById('homeTabPanel')?.classList.remove('active');

    // Show PR panels container
    document.getElementById('prTabPanelsContainer')?.classList.remove('hidden');

    // Hide all other PR panels
    document.querySelectorAll('.pr-review-panel').forEach(panel => {
      panel.classList.add('hidden');
    });

    // Get or create panel for this tab
    let panel = document.getElementById(`prTabPanel-${tabId}`);
    if (!panel) {
      panel = this.createPRTabPanel(tabId);
    }
    panel.classList.remove('hidden');
    panel.classList.add('active');

    // Restore tab state
    this.restoreTabState(tabId);
  }

  private createPRTabPanel(tabId: string): HTMLElement {
    const panel = document.createElement('div');
    panel.id = `prTabPanel-${tabId}`;
    panel.className = 'tab-panel pr-review-panel hidden';
    panel.innerHTML = `
      <div class="review-screen" id="reviewScreen-${tabId}">
        <!-- PR Header -->
        <div class="pr-header">
          <div class="pr-header-main">
            <div class="pr-header-title">
              <span class="pr-id" id="prIdMini-${tabId}">PR #---</span>
              <h1 class="pr-title" id="prTitle-${tabId}">Loading...</h1>
              <span class="pr-status-badge" id="prStatus-${tabId}">active</span>
            </div>
            <div class="pr-meta">
              <div class="pr-branch-info">
                <span class="branch-name" id="sourceBranch-${tabId}">source</span>
                ${getIcon(ArrowRight, 16)}
                <span class="branch-name" id="targetBranch-${tabId}">target</span>
              </div>
              <span class="pr-linked-badge hidden" id="prLinkedBadge-${tabId}" title="">
                ${getIcon(Link, 12)}
                <span class="pr-linked-text"></span>
              </span>
              <span class="pr-meta-divider">|</span>
              <div class="pr-author">
                <span id="authorAvatarContainer-${tabId}" class="avatar-container"></span>
                <span id="authorName-${tabId}">Author</span>
              </div>
              <span class="pr-meta-divider">|</span>
              <span id="prDate-${tabId}">Date</span>
            </div>
          </div>
          <div class="vote-dropdown-container">
            <button class="btn btn-primary" id="voteBtn-${tabId}">
              Vote
              ${getIcon(ChevronDown, 14)}
            </button>
            <div class="vote-dropdown" id="voteDropdown-${tabId}">
              <button class="vote-option" data-vote="10">
                ${iconHtml(CheckCircle, { size: 16, color: '#107c10' })}
                Approve
              </button>
              <button class="vote-option" data-vote="5">
                ${iconHtml(Check, { size: 16, color: '#498205' })}
                Approve with suggestions
              </button>
              <button class="vote-option" data-vote="0">
                ${iconHtml(Circle, { size: 16, color: '#605e5c' })}
                No vote
              </button>
              <button class="vote-option" data-vote="-5">
                ${iconHtml(Clock, { size: 16, color: '#ffaa44' })}
                Wait for author
              </button>
              <button class="vote-option" data-vote="-10">
                ${iconHtml(XCircle, { size: 16, color: '#d13438' })}
                Reject
              </button>
            </div>
          </div>
        </div>

        <!-- New Version Banner -->
        <div class="pr-update-banner hidden" id="prUpdateBanner-${tabId}">
          <div class="banner-content">
            ${iconHtml(RefreshCw, { size: 16, class: 'banner-icon' })}
            <span class="banner-text">A new version of this PR is available</span>
          </div>
          <div class="banner-actions">
            <button class="btn btn-sm btn-primary" id="refreshPRBtn-${tabId}">
              Refresh PR
            </button>
            <button class="btn btn-sm btn-ghost" id="dismissBannerBtn-${tabId}">
              ${getIcon(X, 14)}
            </button>
          </div>
        </div>

        <!-- Reviewers Row -->
        <div class="reviewers-section">
          <span class="reviewers-label">Reviewers:</span>
          <div class="reviewers-row" id="reviewersRow-${tabId}"></div>
        </div>

        <!-- PR Description -->
        <div class="pr-description-section hidden" id="prDescription-${tabId}">
          <div class="pr-description-header">
            ${iconHtml(ChevronRight, { size: 14, class: 'pr-description-chevron' })}
            <span>Description</span>
          </div>
          <div class="pr-description-content" id="prDescriptionContent-${tabId}"></div>
        </div>

        <!-- Toolbar -->
        <div class="toolbar">
          <div class="toolbar-left">
            <select class="iteration-select" id="iterationSelect-${tabId}">
              <option>Loading iterations...</option>
            </select>
            <div class="toolbar-stats">
              <span class="stat">
                ${getIcon(FileCode, 14)}
                <span id="fileCount-${tabId}">0</span> files
              </span>
              <span class="stat">
                ${getIcon(MessageSquare, 14)}
                <span id="commentCount-${tabId}">0</span> comments
              </span>
              <div class="review-progress hidden" id="reviewProgress-${tabId}">
                <div class="review-progress-bar">
                  <div class="review-progress-fill" id="reviewProgressBar-${tabId}"></div>
                </div>
                <span class="review-progress-text" id="reviewProgressText-${tabId}">0/0</span>
              </div>
            </div>
          </div>
          <div class="toolbar-right">
            <div class="change-nav">
              <button class="btn btn-icon" id="prevChangeBtn-${tabId}" title="Previous change ([)">
                ${icons.nav.prev()}
              </button>
              <span class="change-nav-info" id="changeNavInfo-${tabId}"></span>
              <button class="btn btn-icon" id="nextChangeBtn-${tabId}" title="Next change (])">
                ${icons.nav.next()}
              </button>
            </div>
            <div class="view-toggle">
              <button class="view-btn${this.preferredDiffViewMode === 'split' ? ' active' : ''}" data-view="split" title="Split view">
                ${iconHtml(Columns, { size: 18 })}
              </button>
              <button class="view-btn${this.preferredDiffViewMode === 'unified' ? ' active' : ''}" data-view="unified" title="Unified view">
                ${iconHtml(FileText, { size: 18 })}
              </button>
              <button class="view-btn preview-btn hidden" data-view="preview" title="Preview markdown">
                ${iconHtml(Eye, { size: 18 })}
              </button>
            </div>
            <div class="toolbar-actions" id="toolbarActions-${tabId}">
              <button class="btn btn-icon" id="toggleCommentsBtn-${tabId}" title="Toggle Comments (c)">
                ${icons.toolbar.comments()}
              </button>
              <button class="btn btn-icon" id="toggleAICommentsBtn-${tabId}" title="Toggle AI Comments (a)">
                ${icons.toolbar.aiComments()}
              </button>
              <button class="btn btn-icon copilot-chat-btn" id="copilotChatBtn-${tabId}" title="AI Chat Terminal">
                ${iconHtml(Terminal, { size: 18 })}
              </button>
              <button class="btn btn-icon" id="walkthroughBtn-${tabId}" title="Code Walkthrough">
                ${icons.toolbar.walkthrough()}
              </button>
              <button class="btn btn-icon" id="applyChangesBtn-${tabId}" title="Toggle Apply Changes">
                ${icons.toolbar.applyChanges()}
              </button>
              <button class="btn btn-icon" id="openInBrowserBtn-${tabId}" title="Open in Browser">
                ${icons.toolbar.openInBrowser()}
              </button>
            </div>
          </div>
        </div>

        <!-- Main Content -->
        <div class="review-content">
          <!-- Sidebar -->
          <aside class="sidebar" id="sidebar-${tabId}">
            <div class="sidebar-header">
              <h3>Files</h3>
              <div class="sidebar-actions">
                <button class="btn generated-files-toggle hidden" id="generatedFilesToggle-${tabId}" title="Toggle generated files visibility">
                  ${iconHtml(EyeOff, { size: 14 })}
                  <span class="generated-count"></span>
                </button>
                <button class="btn btn-icon" id="viewModeToggle-${tabId}" title="Toggle view mode">Tree</button>
                <button class="btn btn-icon" id="collapseBtn-${tabId}" title="Collapse sidebar">
                  ${getIcon(ChevronsLeft, 16)}
                </button>
              </div>
            </div>
            <div class="file-tree" id="fileTree-${tabId}"></div>
          </aside>

          <!-- Diff Viewer -->
          <main class="diff-container">
            <div class="diff-viewer" id="diffViewer-${tabId}">
              <div class="diff-placeholder">
                Select a file to view changes
              </div>
            </div>
          </main>

          <!-- Comments Panel -->
          <aside class="comments-panel" id="commentsPanel-${tabId}">
            <div class="comments-panel-header">
              <h3>Comments</h3>
              <div class="comments-scope-toggle">
                <label class="toggle-switch" title="Show all PR comments">
                  <input type="checkbox" id="showAllComments-${tabId}">
                  <span class="toggle-slider"></span>
                </label>
                <span class="toggle-label">All</span>
              </div>
              <button class="btn btn-icon" id="closeCommentsBtn-${tabId}" title="Close">
                ${icons.panel.close()}
              </button>
            </div>
            <div class="comments-content" id="commentsContent-${tabId}"></div>
          </aside>

          <!-- AI Comments Panel -->
          <aside class="ai-comments-panel" id="aiCommentsPanel-${tabId}">
            <div class="ai-comments-panel-header">
              <div class="ai-comments-title">
                ${iconHtml(Bot, { size: 16, class: 'robot-icon' })}
                <span>AI Review</span>
              </div>
              <button class="btn btn-icon" id="closeAICommentsBtn-${tabId}" title="Close">
                ${icons.panel.close()}
              </button>
            </div>
            <div class="ai-comments-content" id="aiCommentsContent-${tabId}"></div>
          </aside>

          <!-- Walkthroughs Panel -->
          <aside class="walkthroughs-panel" id="walkthroughsPanel-${tabId}">
            <div class="walkthroughs-section" id="walkthroughsSection-${tabId}"></div>
          </aside>

          <!-- Apply Changes Panel -->
          <div id="applyChangesPanel-${tabId}" class="side-panel apply-changes-panel"></div>
        </div>
      </div>
    `;

    document.getElementById('prTabPanelsContainer')?.appendChild(panel);

    // Attach event listeners for this panel
    this.attachPRPanelEventListeners(tabId);

    // Initialize WalkthroughsView for this tab
    this.initWalkthroughsViewForTab(tabId);

    return panel;
  }

  private initWalkthroughsViewForTab(tabId: string): void {
    const containerId = `walkthroughsSection-${tabId}`;
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
      const walkthroughsView = new WalkthroughsView(containerId);

      // Wire up callbacks
      walkthroughsView.onSelect(async (sessionId, isSaved) => {
        await this.handleWalkthroughSelect(sessionId, isSaved);
      });

      walkthroughsView.onClose(async (sessionId, isSaved) => {
        await this.handleWalkthroughClose(sessionId, isSaved);
      });

      walkthroughsView.onNew(async () => {
        await this.startNewWalkthrough();
      });

      walkthroughsView.onClosePanel(() => {
        document.getElementById(`reviewScreen-${tabId}`)?.classList.remove('walkthroughs-open');
        this.updatePanelButtonState('walkthroughBtn', false);
      });

      this.walkthroughsViews.set(tabId, walkthroughsView);
    } catch (error) {
      console.error(`Failed to initialize WalkthroughsView for tab ${tabId}:`, error);
    }
  }

  private attachPRPanelEventListeners(tabId: string) {
    const panel = document.getElementById(`prTabPanel-${tabId}`);
    if (!panel) return;

    // Create AbortController for this tab's listeners
    const controller = new AbortController();
    this.tabEventListeners.set(tabId, controller);

    // Description toggle
    const descSection = document.getElementById(`prDescription-${tabId}`);
    const descHeader = descSection?.querySelector('.pr-description-header');
    descHeader?.addEventListener('click', () => {
      descSection!.classList.toggle('expanded');
    }, { signal: controller.signal });

    // Vote dropdown
    const voteBtn = document.getElementById(`voteBtn-${tabId}`);
    const voteDropdown = document.getElementById(`voteDropdown-${tabId}`);

    voteBtn?.addEventListener('click', () => {
      voteDropdown?.classList.toggle('open');
    }, { signal: controller.signal });

    voteDropdown?.querySelectorAll('.vote-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const vote = parseInt(target.dataset.vote || '0');
        this.submitVote(vote);
        voteDropdown?.classList.remove('open');
      }, { signal: controller.signal });
    });

    // Close dropdown on outside click (global listener that needs cleanup)
    document.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.vote-dropdown-container')) {
        voteDropdown?.classList.remove('open');
      }
    }, { signal: controller.signal });

    // New version banner buttons
    document.getElementById(`refreshPRBtn-${tabId}`)?.addEventListener('click', async () => {
      await this.refreshPRForTab(tabId);
    }, { signal: controller.signal });

    document.getElementById(`dismissBannerBtn-${tabId}`)?.addEventListener('click', () => {
      const state = this.prTabStates.get(tabId);
      if (state) {
        state.hasNewVersion = false;
      }
      this.hideNewVersionBanner(tabId);
    }, { signal: controller.signal });

    // Iteration selector
    document.getElementById(`iterationSelect-${tabId}`)?.addEventListener('change', (e) => {
      const select = e.target as HTMLSelectElement;
      this.loadIteration(parseInt(select.value));
    }, { signal: controller.signal });

    // Change navigation
    document.getElementById(`prevChangeBtn-${tabId}`)?.addEventListener('click', () => {
      this.navigateToNextChange(-1);
    }, { signal: controller.signal });
    document.getElementById(`nextChangeBtn-${tabId}`)?.addEventListener('click', () => {
      this.navigateToNextChange(1);
    }, { signal: controller.signal });

    // Open in browser
    document.getElementById(`openInBrowserBtn-${tabId}`)?.addEventListener('click', () => {
      this.openInBrowser();
    }, { signal: controller.signal });

    // View toggle
    document.querySelectorAll(`#reviewScreen-${tabId} .view-btn`).forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const view = target.dataset.view as 'split' | 'unified' | 'preview';
        this.setDiffViewMode(view);
      }, { signal: controller.signal });
    });

    // Sidebar collapse
    document.getElementById(`collapseBtn-${tabId}`)?.addEventListener('click', () => {
      document.getElementById(`sidebar-${tabId}`)?.classList.toggle('collapsed');
    }, { signal: controller.signal });

    // View mode toggle
    document.getElementById(`viewModeToggle-${tabId}`)?.addEventListener('click', () => {
      const newMode = this.fileTree.toggleViewMode();
      const modeLabels: Record<string, string> = {
        'tree': 'Tree',
        'grouped': 'Type',
        'flat': 'Flat',
      };
      document.getElementById(`viewModeToggle-${tabId}`)!.textContent = modeLabels[newMode] || newMode;
    }, { signal: controller.signal });

    // Generated files toggle
    document.getElementById(`generatedFilesToggle-${tabId}`)?.addEventListener('click', () => {
      const isShowing = this.fileTree.toggleShowGeneratedFiles();
      this.updateGeneratedFilesToggle(tabId);
    }, { signal: controller.signal });

    // Comments panel toggle
    document.getElementById(`toggleCommentsBtn-${tabId}`)?.addEventListener('click', () => {
      this.toggleCommentsPanel();
    }, { signal: controller.signal });
    document.getElementById(`closeCommentsBtn-${tabId}`)?.addEventListener('click', () => {
      document.getElementById(`reviewScreen-${tabId}`)?.classList.remove('comments-open');
      this.updatePanelButtonState('toggleCommentsBtn', false);
    }, { signal: controller.signal });

    // Show all comments toggle
    document.getElementById(`showAllComments-${tabId}`)?.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      this.commentsPanel.setShowAllComments(checked);
    }, { signal: controller.signal });

    // AI Comments panel toggle
    document.getElementById(`toggleAICommentsBtn-${tabId}`)?.addEventListener('click', () => {
      this.toggleAICommentsPanel();
    }, { signal: controller.signal });
    document.getElementById(`closeAICommentsBtn-${tabId}`)?.addEventListener('click', () => {
      document.getElementById(`reviewScreen-${tabId}`)?.classList.remove('ai-comments-open');
      this.updatePanelButtonState('toggleAICommentsBtn', false);
    }, { signal: controller.signal });

    // Walkthrough button - toggles the walkthroughs panel
    document.getElementById(`walkthroughBtn-${tabId}`)?.addEventListener('click', () => {
      this.toggleWalkthroughsPanel();
    }, { signal: controller.signal });

    // Apply Changes panel toggle
    document.getElementById(`applyChangesBtn-${tabId}`)?.addEventListener('click', () => {
      this.toggleApplyChangesPanel();
    }, { signal: controller.signal });

    // Copilot Chat button
    document.getElementById(`copilotChatBtn-${tabId}`)?.addEventListener('click', () => {
      this.toggleCopilotChatPanel();
    }, { signal: controller.signal });

    // Setup resizable panels
    const resizer = setupResizablePanels(tabId);
    this.resizablePanels.set(tabId, resizer);
  }

  private saveCurrentTabState() {
    if (this.activeReviewTabId === 'home') return;

    const state = this.prTabStates.get(this.activeReviewTabId);
    if (state) {
      // Save AI panel state for this PR tab
      state.aiPanelState = this.aiCommentsPanel.getState();
      // Save Apply Changes panel state for this PR tab
      state.applyChangesPanelState = this.applyChangesPanel.getState();
    }
  }

  private restoreTabState(tabId: string) {
    const state = this.prTabStates.get(tabId);
    if (!state) return;

    // Hide walkthrough overlay when switching tabs (it belongs to the previous PR)
    this.walkthroughUI.hide();

    // Re-attach components to this tab's DOM elements
    this.fileTree.setContainer(document.getElementById(`fileTree-${tabId}`)!);
    this.diffViewer.setContainer(document.getElementById(`diffViewer-${tabId}`)!);
    this.commentsPanel.setContainer(
      document.getElementById(`commentsPanel-${tabId}`)!,
      document.getElementById(`commentsContent-${tabId}`)!
    );
    this.aiCommentsPanel.setContainer(document.getElementById(`aiCommentsContent-${tabId}`)!);
    this.applyChangesPanel.setContainer(document.getElementById(`applyChangesPanel-${tabId}`)!);

    // Restore AI panel state for this PR tab
    if (state.aiPanelState) {
      this.aiCommentsPanel.setState(state.aiPanelState);
    } else {
      // No saved state - clear the panel (this PR hasn't been reviewed yet)
      this.aiCommentsPanel.clearAll();
    }

    // Restore Apply Changes panel state for this PR tab
    if (state.applyChangesPanelState) {
      this.applyChangesPanel.setState(state.applyChangesPanelState);
    } else {
      // Refresh state from backend (async, don't block)
      this.refreshApplyChangesState(state.prId).catch(console.warn);
    }

    // Restore file tree with generated file patterns
    this.fileTree.setGeneratedFilePatterns(this.generatedFilePatterns);
    this.fileTree.setFiles(state.fileChanges);
    this.fileTree.setPrId(`${state.org}-${state.project}-${state.prId}`);
    this.updateGeneratedFilesToggle(tabId);

    // Restore comments (must be before setFileThreads since setThreads clears file-specific threads)
    this.commentsPanel.setThreads(state.threads);

    // Sync view toggle buttons with current diff view mode
    document.querySelectorAll(`#reviewScreen-${tabId} .view-btn`).forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.view === state.diffViewMode);
    });

    // Restore selected file
    if (state.selectedFile) {
      this.fileTree.setSelected(state.selectedFile);
      const file = state.fileChanges.find(f => f.path === state.selectedFile);
      if (file) {
        this.diffViewer.render(file, state.diffViewMode);
        this.commentsPanel.setFileThreads(file.threads);
      }
    }

    // Update UI elements
    this.updatePRHeaderForState(state, tabId);
    this.updateIterationSelectorForState(state, tabId);
    this.updateCommentCountForState(state, tabId);
    this.updateFileCountForState(state, tabId);
    this.updateReviewProgress();
  }

  private getCurrentPRState(): PRTabState | null {
    if (this.activeReviewTabId === 'home') return null;
    return this.prTabStates.get(this.activeReviewTabId) || null;
  }

  private navigateToFile(filePath: string, line: number): void {
    const state = this.getCurrentPRState();
    if (!state) return;
    if (state.selectedFile !== filePath) {
      this.selectFile(filePath);
      setTimeout(() => this.diffViewer.scrollToLine(line), 100);
    } else {
      this.diffViewer.scrollToLine(line);
    }
  }

  private async refreshApplyChangesState(prId: number): Promise<void> {
    // Safety check: API might not be available in older builds
    if (!window.electronAPI.applyChangesGetState || !window.electronAPI.applyChangesCanApply) {
      console.warn('[App] Apply Changes API not available');
      return;
    }
    const queueState = await window.electronAPI.applyChangesGetState(prId);
    const canApply = (await window.electronAPI.applyChangesCanApply(prId)).canApply;
    this.applyChangesPanel.setState({ queueState, canApply });
  }

  // First launch flow
  private async checkFirstLaunch() {
    const isConfigured = await window.electronAPI.isConfigured();

    // Load saved diff view mode preference
    try {
      const settings = await window.electronAPI.getSettings() as Record<string, unknown> | null;
      if (settings?.diffViewMode === 'split' || settings?.diffViewMode === 'unified') {
        this.preferredDiffViewMode = settings.diffViewMode;
      }
    } catch { /* use default */ }

    // Load generated file patterns from console review settings
    await this.loadGeneratedFilePatterns();

    if (!isConfigured) {
      // Show setup modal
      document.getElementById('setupModalBackdrop')?.classList.remove('hidden');
    } else {
      // Load config and initialize
      const config = await window.electronAPI.loadConfig();
      if (config) {
        this.organization = config.ado.organization;
        this.project = config.ado.project;
        this.settingsView.setSettings(config.ado);
        await this.loadPRLists();
      }
    }
  }

  private async loadGeneratedFilePatterns() {
    try {
      const settings = await window.electronAPI.getConsoleReviewSettings();
      this.generatedFilePatterns = settings.generatedFilePatterns || [];
      this.enableWorkIQ = settings.enableWorkIQ ?? true;
      this.fileTree.setGeneratedFilePatterns(this.generatedFilePatterns);
    } catch (error) {
      console.warn('Failed to load generated file patterns:', error);
      this.generatedFilePatterns = [];
      this.enableWorkIQ = true;
    }
  }

  private onConsoleSettingsChanged(settings: import('../shared/terminal-types.js').ConsoleReviewSettings) {
    // Update generated file patterns
    this.generatedFilePatterns = settings.generatedFilePatterns || [];
    this.enableWorkIQ = settings.enableWorkIQ ?? true;
    this.fileTree.setGeneratedFilePatterns(this.generatedFilePatterns);

    // Update the toggle button for the current tab
    if (this.activeReviewTabId !== 'home') {
      this.updateGeneratedFilesToggle(this.activeReviewTabId);
    }

    // Update monitored repos on home view and reload their PRs
    const monitoredRepos = settings.monitoredRepositories || [];
    this.prHomeView.setMonitoredRepos(monitoredRepos);
    this.loadMonitoredPRs(monitoredRepos);
  }

  private onPollingSettingsChanged(settings: PollingSettings) {
    // Update polling service settings
    this.pollingService.setSettings(settings);

    // Restart polling for all active PR tabs with new settings
    for (const [tabId, state] of this.prTabStates) {
      if (state.pollingState) {
        this.pollingService.stopPolling(tabId);
        if (settings.enabled) {
          this.pollingService.startPolling({
            tabId,
            org: state.org,
            project: state.project,
            repoId: state.repoId,
            prId: state.prId,
            state: state.pollingState,
          });
        }
      }
    }
  }

  // Settings handlers
  private async saveSettings(settings: ReviewSettings): Promise<void> {
    await window.electronAPI.saveConfig({
      ado: {
        organization: settings.organization,
        project: settings.project,
        pat: settings.pat,
      },
    });

    this.organization = settings.organization;
    this.project = settings.project;

    // Reload PR lists
    await this.loadPRLists();

    // Switch to review section
    this.switchSection('review');
  }

  private async testConnection(settings: ReviewSettings): Promise<boolean> {
    // Debug logging
    console.log('testConnection called');
    console.log('window.electronAPI exists?', typeof window.electronAPI);
    console.log('window.electronAPI.testConnection exists?', typeof window.electronAPI?.testConnection);
    
    if (!window.electronAPI) {
      throw new Error('Backend API not initialized. Make sure the backend bridge is running.');
    }
    
    const result = await window.electronAPI.testConnection(
      settings.organization,
      settings.project,
      settings.pat || undefined
    );
    if (!result.success && result.error) {
      throw new Error(result.error);
    }
    return result.success;
  }

  // PR list loading
  private async loadPRLists() {
    console.log('loadPRLists called', { org: this.organization, project: this.project });
    if (!this.organization || !this.project) {
      console.log('Missing org or project, not loading PRs');
      return;
    }

    this.showLoading('Loading pull requests...');

    try {
      // Load settings for monitored repos
      const settings = await window.electronAPI.getConsoleReviewSettings();
      const monitoredRepos = settings.monitoredRepositories || [];

      // Set monitored repos on home view (for tab visibility)
      this.prHomeView.setMonitoredRepos(monitoredRepos);

      const [reviewPRs, createdPRs] = await Promise.all([
        window.electronAPI.getMyPRs(this.organization, this.project),
        window.electronAPI.getCreatedPRs(this.organization, this.project),
      ]);

      this.myPRs = reviewPRs;
      this.createdPRs = createdPRs;

      await this.prHomeView.setPRs(this.myPRs, this.createdPRs);
      this.prHomeView.setSubtitle(`${this.organization} / ${this.project}`);

      // Load PRs from monitored repositories
      await this.loadMonitoredPRs(monitoredRepos);
    } finally {
      this.hideLoading();
    }
  }

  private async loadMonitoredPRs(monitoredRepos: import('../shared/terminal-types.js').MonitoredRepository[]) {
    if (monitoredRepos.length === 0) {
      return;
    }

    // Fetch PRs from each monitored repository in parallel and update each tab
    await Promise.all(monitoredRepos.map(async (repo) => {
      try {
        const prs = await window.electronAPI.getRepoPRs(repo.organization, repo.project, repo.repository);
        // Sort by creation date (newest first)
        prs.sort((a: PullRequest, b: PullRequest) =>
          new Date(b.creationDate).getTime() - new Date(a.creationDate).getTime()
        );
        await this.prHomeView.setMonitoredRepoPRs(repo, prs);
      } catch (error) {
        console.warn(`Failed to load PRs from ${repo.organization}/${repo.project}/${repo.repository}:`, error);
        await this.prHomeView.setMonitoredRepoPRs(repo, []);
      }
    }));
  }

  // Open PR in new tab
  private async openPRTab(pr: PullRequest) {
    const tabId = `pr-${pr.pullRequestId}`;
    const existingTab = this.reviewTabs.find(t => t.id === tabId);

    if (existingTab) {
      // Switch to existing tab
      this.switchReviewTab(tabId);
    } else {
      // Create new tab
      const tab: ReviewTab = {
        id: tabId,
        type: 'pr',
        label: `${pr.repository.name}/#${pr.pullRequestId}`,
        closeable: true,
      };
      this.reviewTabs.push(tab);

      // Create initial state
      const state: PRTabState = {
        org: this.organization,
        project: this.project,
        repoId: pr.repository.id,
        repoName: pr.repository.name,
        prId: pr.pullRequestId,
        pullRequest: null,
        iterations: [],
        selectedIteration: null,
        fileChanges: [],
        selectedFile: null,
        threads: [],
        diffViewMode: this.preferredDiffViewMode,
        prContextKey: null,
        contextPath: null,
        aiSessionId: null,
        aiReviewInProgress: false,
        hasSavedReview: false,
        hasSavedWalkthrough: false,
        savedReviewInfo: null,
        savedWalkthroughInfo: null,
        pollingState: null,
        hasNewVersion: false,
        copilotChatPanelOpen: false,
        copilotChatAI: 'copilot', // Will be overridden from settings
      };
      this.prTabStates.set(tabId, state);

      this.updateTabBar();
      this.switchReviewTab(tabId);

      // Load PR content
      await this.loadPullRequest(state, tabId);
    }
  }

  public async openPRByUrl(org: string, project: string, prId: number) {
    const tabId = `pr-${org}-${project}-${prId}`;
    const existingTab = this.reviewTabs.find(t => t.id === tabId);

    if (existingTab) {
      this.switchReviewTab(tabId);
    } else {
      const tab: ReviewTab = {
        id: tabId,
        type: 'pr',
        label: `PR #${prId}`,
        closeable: true,
      };
      this.reviewTabs.push(tab);

      const state: PRTabState = {
        org,
        project,
        repoId: '',
        repoName: '',
        prId,
        pullRequest: null,
        iterations: [],
        selectedIteration: null,
        fileChanges: [],
        selectedFile: null,
        threads: [],
        diffViewMode: this.preferredDiffViewMode,
        prContextKey: null,
        contextPath: null,
        aiSessionId: null,
        aiReviewInProgress: false,
        hasSavedReview: false,
        hasSavedWalkthrough: false,
        savedReviewInfo: null,
        savedWalkthroughInfo: null,
        pollingState: null,
        hasNewVersion: false,
        copilotChatPanelOpen: false,
        copilotChatAI: 'copilot',
      };
      this.prTabStates.set(tabId, state);

      this.updateTabBar();
      this.switchReviewTab(tabId);

      await this.loadPullRequest(state, tabId);
    }
  }

  private async loadPullRequest(state: PRTabState, tabId: string) {
    this.showLoading('Loading pull request...');

    try {
      // Load PR details
      state.pullRequest = await window.electronAPI.loadPR(
        state.org,
        state.project,
        state.prId
      );

      // Populate repoId/repoName from response if not set (e.g. opened by URL)
      if (!state.repoId && state.pullRequest) {
        state.repoId = state.pullRequest.repository.id;
        state.repoName = state.pullRequest.repository.name;
        // Update tab label
        const tab = this.reviewTabs.find(t => t.id === tabId);
        if (tab) {
          tab.label = `${state.repoName}/#${state.prId}`;
          this.updateTabBar();
        }
      }

      // Set PR ID for file tree review tracking
      this.fileTree.setPrId(`${state.org}-${state.project}-${state.prId}`);

      // Update UI with PR info
      this.updatePRHeaderForState(state, tabId);

      // Load iterations
      state.iterations = await window.electronAPI.getIterations(
        state.org,
        state.project,
        state.repoId,
        state.prId
      );

      this.updateIterationSelectorForState(state, tabId);

      // Check canApply early so Apply buttons show immediately when comments render
      if (window.electronAPI.applyChangesCanApply) {
        const canApplyResult = await window.electronAPI.applyChangesCanApply(state.prId);
        this.commentsPanel.setCanApply(canApplyResult.canApply);
        this.aiCommentsPanel.setCanApply(canApplyResult.canApply);
        console.log('[App] Early canApply check:', canApplyResult.canApply, 'reason:', canApplyResult.reason || 'none');
      }

      // Load threads
      state.threads = await window.electronAPI.getThreads(
        state.org,
        state.project,
        state.repoId,
        state.prId
      );
      console.log('[App] Loaded threads from API:', state.threads?.length, 'threads');

      this.commentsPanel.setThreads(state.threads);
      this.updateCommentCountForState(state, tabId);

      // Load latest iteration
      if (state.iterations.length > 0) {
        const latestIteration = state.iterations[state.iterations.length - 1];
        state.selectedIteration = latestIteration.id;
        await this.loadIterationForState(state, tabId, latestIteration.id);
      }

      // Check for saved AI review data
      await this.checkForSavedReviewData(state);

      // Load fix tracker state and apply to panels
      await this.loadFixTrackerState(state);

      // Load saved comment analyses
      try {
        const savedAnalyses = await window.electronAPI.commentAnalysisLoad(
          state.prId,
          state.org,
          state.project
        );
        if (savedAnalyses?.analyses?.length > 0) {
          this.commentsPanel.setAnalyses(savedAnalyses.analyses);
        }
      } catch (e) {
        console.warn('Failed to load saved analyses:', e);
      }

      // Initialize polling state and start polling
      state.pollingState = PRPollingService.createInitialState(state.iterations, state.threads);
      state.hasNewVersion = false;
      this.pollingService.startPolling({
        tabId,
        org: state.org,
        project: state.project,
        repoId: state.repoId,
        prId: state.prId,
        state: state.pollingState,
      });
    } finally {
      this.hideLoading();
    }
  }

  /**
   * Load fix tracker state and apply to panels
   */
  private async loadFixTrackerState(state: PRTabState): Promise<void> {
    if (!window.electronAPI.fixTrackerLoad) {
      console.warn('[App] Fix tracker API not available');
      return;
    }

    try {
      const fixTracker = await window.electronAPI.fixTrackerLoad(state.prId, state.org, state.project);
      if (fixTracker && fixTracker.fixes && fixTracker.fixes.length > 0) {
        // Separate AI and ADO fixes
        const aiFixedIds = new Set<string>();
        const adoFixedIds = new Set<string>();

        for (const fix of fixTracker.fixes) {
          if (fix.commentType === 'ai') {
            aiFixedIds.add(fix.commentId);
          } else {
            adoFixedIds.add(fix.commentId);
          }
        }

        // Apply to panels
        this.aiCommentsPanel.setFixedComments(aiFixedIds);
        this.commentsPanel.setFixedThreads(adoFixedIds);

        console.log(`[App] Loaded fix tracker: ${aiFixedIds.size} AI fixes, ${adoFixedIds.size} ADO fixes`);
      }
    } catch (error) {
      console.error('Failed to load fix tracker:', error);
    }
  }

  /**
   * Handle poll results from the polling service
   */
  private handlePollResult(tabId: string, result: PollResult): void {
    const state = this.prTabStates.get(tabId);
    if (!state) return;

    // Handle new version detection
    if (result.hasNewVersion) {
      state.hasNewVersion = true;
      this.showNewVersionBanner(tabId);
      notificationService.notify(
        'newIterations',
        'New Commits',
        `New push detected on PR #${state.prId}`
      );
    }

    // Handle comment changes (silent update)
    if (result.hasCommentChanges && result.updatedThreads) {
      // Detect new threads before updating (for auto-analyze)
      const newThreadIds = this.activeReviewTabId === tabId
        ? this.commentsPanel.getNewThreadIds(result.updatedThreads)
        : [];

      state.threads = result.updatedThreads;

      // Update comments panel if this is the active tab
      if (this.activeReviewTabId === tabId) {
        this.commentsPanel.setThreads(state.threads);
        this.updateCommentCountForState(state, tabId);

        // Update all files' thread counts
        for (const file of state.fileChanges) {
          file.threads = filterVisibleThreads(
            state.threads.filter(t => t.threadContext?.filePath === file.path)
          );
        }
        this.fileTree.setFiles(state.fileChanges);

        // Re-render diff viewer if a file is selected
        if (state.selectedFile) {
          const file = state.fileChanges.find(f => f.path === state.selectedFile);
          if (file) {
            this.diffViewer.render(file, state.diffViewMode);
            this.commentsPanel.setFileThreads(file.threads);
          }
        }

        // Auto-analyze new threads if enabled
        if (newThreadIds.length > 0 && this.commentsPanel.isAutoAnalyzeEnabled()) {
          console.log(`[App] Auto-analyzing ${newThreadIds.length} new comment threads`);
          this.analyzeComments(newThreadIds);
        }
      }

      console.log(`[App] Comments updated for tab ${tabId}: ${result.updatedThreads.length} threads`);
      notificationService.notify(
        'newComments',
        'New Comments',
        `Comments updated on PR #${state.prId}`
      );
    }
  }

  /**
   * Show the new version banner for a PR tab
   */
  private showNewVersionBanner(tabId: string): void {
    const banner = document.getElementById(`prUpdateBanner-${tabId}`);
    if (banner) {
      banner.classList.remove('hidden');
    }
  }

  /**
   * Hide the new version banner for a PR tab
   */
  private hideNewVersionBanner(tabId: string): void {
    const banner = document.getElementById(`prUpdateBanner-${tabId}`);
    if (banner) {
      banner.classList.add('hidden');
    }
  }

  /**
   * Refresh PR and reset polling state (used by banner refresh button)
   */
  private async refreshPRForTab(tabId: string): Promise<void> {
    const state = this.prTabStates.get(tabId);
    if (!state) return;

    // Stop polling during refresh
    this.pollingService.stopPolling(tabId);

    // Hide banner
    state.hasNewVersion = false;
    this.hideNewVersionBanner(tabId);

    // Reload PR content
    await this.loadPullRequest(state, tabId);

    // Polling is restarted in loadPullRequest after data is loaded
  }

  private async updatePRHeaderForState(state: PRTabState, tabId: string) {
    if (!state.pullRequest) return;

    const pr = state.pullRequest;

    document.getElementById(`prIdMini-${tabId}`)!.textContent = `PR #${pr.pullRequestId}`;
    document.getElementById(`prTitle-${tabId}`)!.textContent = pr.title;

    const statusBadge = document.getElementById(`prStatus-${tabId}`)!;
    statusBadge.textContent = pr.status;
    statusBadge.className = `pr-status-badge ${pr.status}`;

    const sourceBranch = pr.sourceRefName.replace('refs/heads/', '');
    const targetBranch = pr.targetRefName.replace('refs/heads/', '');

    document.getElementById(`sourceBranch-${tabId}`)!.textContent = sourceBranch;
    document.getElementById(`targetBranch-${tabId}`)!.textContent = targetBranch;

    // Show normalized repository URL (and indicate if linked)
    const linkedBadge = document.getElementById(`prLinkedBadge-${tabId}`);
    if (linkedBadge) {
      // Construct remote URL if not available (ADO API doesn't always include it)
      const repoUrl = pr.repository.remoteUrl ||
        `https://dev.azure.com/${state.org}/${state.project}/_git/${pr.repository.name}`;
      try {
        const normalized = await window.electronAPI.gitNormalizeAdoUrl(repoUrl);
        const linkedRepo = await window.electronAPI.gitFindLinkedRepo(repoUrl);

        // Always show the badge with normalized URL
        linkedBadge.classList.remove('hidden');
        const textSpan = linkedBadge.querySelector('.pr-linked-text');
        if (textSpan) textSpan.textContent = normalized;

        if (linkedRepo) {
          // Linked - show green with path in tooltip
          linkedBadge.classList.add('linked');
          linkedBadge.classList.remove('not-linked');
          linkedBadge.title = `Linked: ${linkedRepo.path}`;
        } else {
          // Not linked - show muted
          linkedBadge.classList.add('not-linked');
          linkedBadge.classList.remove('linked');
          linkedBadge.title = 'Repository not linked in settings';
        }
      } catch (err) {
        console.error('[PR Linked] Error:', err);
        linkedBadge.classList.add('hidden');
      }
    }

    document.getElementById(`authorName-${tabId}`)!.textContent = pr.createdBy.displayName;

    // Author avatar
    const authorContainer = document.getElementById(`authorAvatarContainer-${tabId}`)!;
    const initials = this.getInitials(pr.createdBy.displayName);
    const hasImage = pr.createdBy.imageUrl && pr.createdBy.imageUrl.trim();

    authorContainer.innerHTML = hasImage
      ? `<img class="avatar" src="${pr.createdBy.imageUrl}" alt="${initials}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="avatar-placeholder" style="display:none">${initials}</span>`
      : `<span class="avatar-placeholder">${initials}</span>`;

    const date = new Date(pr.creationDate);
    document.getElementById(`prDate-${tabId}`)!.textContent = date.toLocaleDateString();

    // Reviewers
    const reviewersRow = document.getElementById(`reviewersRow-${tabId}`)!;
    reviewersRow.innerHTML = pr.reviewers.map(reviewer => {
      const voteClass = this.getVoteClass(reviewer.vote);
      const rInitials = this.getInitials(reviewer.displayName);
      const avatarHtml = reviewer.imageUrl && reviewer.imageUrl.trim()
        ? `<img class="reviewer-avatar" src="${reviewer.imageUrl}" alt="${rInitials}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="reviewer-avatar-placeholder" style="display:none">${rInitials}</span>`
        : `<span class="reviewer-avatar-placeholder">${rInitials}</span>`;
      return `
        <div class="reviewer-item">
          ${avatarHtml}
          <span class="reviewer-name">${this.escapeHtml(reviewer.displayName)}</span>
          <span class="reviewer-vote ${voteClass}"></span>
        </div>
      `;
    }).join('');

    // Description
    const descSection = document.getElementById(`prDescription-${tabId}`);
    if (descSection) {
      if (pr.description && pr.description.trim()) {
        descSection.classList.remove('hidden');
        document.getElementById(`prDescriptionContent-${tabId}`)!.innerHTML = renderMarkdownSync(pr.description);
      } else {
        descSection.classList.add('hidden');
      }
    }
  }

  private getVoteClass(vote: number): string {
    if (vote === 10) return 'approved';
    if (vote === 5) return 'approved-suggestions';
    if (vote === -5) return 'waiting';
    if (vote === -10) return 'rejected';
    return 'no-vote';
  }

  private updateIterationSelectorForState(state: PRTabState, tabId: string) {
    const select = document.getElementById(`iterationSelect-${tabId}`) as HTMLSelectElement;
    select.innerHTML = state.iterations.map((iter, index) => `
      <option value="${iter.id}">
        Iteration ${index + 1} - ${new Date(iter.createdDate).toLocaleDateString()}
      </option>
    `).join('');

    if (state.iterations.length > 0) {
      select.value = state.iterations[state.iterations.length - 1].id.toString();
    }
  }

  private async loadIteration(iterationId: number) {
    const state = this.getCurrentPRState();
    if (!state) return;
    await this.loadIterationForState(state, this.activeReviewTabId, iterationId);
  }

  private async loadIterationForState(state: PRTabState, tabId: string, iterationId: number) {
    if (!state.pullRequest) return;

    this.showLoading('Loading changes...');
    state.selectedIteration = iterationId;

    try {
      // Ensure generated file patterns are loaded
      await this.loadGeneratedFilePatterns();

      const changes = await window.electronAPI.getChanges(
        state.org,
        state.project,
        state.repoId,
        state.prId,
        iterationId
      );

      await this.processChanges(state, changes);
      this.fileTree.setGeneratedFilePatterns(this.generatedFilePatterns);
      this.fileTree.setFiles(state.fileChanges);
      this.updateFileCountForState(state, tabId);
      this.updateReviewProgress();
      this.updateGeneratedFilesToggle(tabId);

      // Auto-select first visible file (skips generated files when hidden)
      if (state.fileChanges.length > 0 && !state.selectedFile) {
        const visibleFiles = this.fileTree.getVisibleFiles();
        if (visibleFiles.length > 0) {
          this.selectFile(visibleFiles[0].path);
        }
      }
    } finally {
      this.hideLoading();
    }
  }

  private async processChanges(state: PRTabState, changes: IterationChange[]) {
    const targetBranch = state.pullRequest!.targetRefName.replace('refs/heads/', '');

    // Get the commit ID from the selected iteration
    const selectedIteration = state.iterations.find(iter => iter.id === state.selectedIteration);
    const lastCommitId = selectedIteration?.sourceRefCommit?.commitId || '';

    // Phase 1: Build file metadata (no content fetching - backend will fetch)
    const fileMetadata = changes.map(change => {
      // For deleted files, item.path may be null - use originalPath as fallback
      const filePath = change.item?.path || change.originalPath || '';
      const fileThreads = filterVisibleThreads(
        state.threads.filter(t => t.threadContext?.filePath === filePath)
      );

      return {
        path: filePath,
        changeType: change.changeType as ChangeType,
        objectId: change.item?.objectId,
        originalObjectId: change.item?.originalObjectId,
        originalPath: change.originalPath,
        threads: fileThreads,
      };
    }).filter(f => f.path);

    // Phase 2: Let backend fetch files and write to disk via ensurePRContext
    try {
      const prContext = {
        prId: state.prId,
        title: state.pullRequest!.title,
        description: state.pullRequest!.description || '',
        sourceBranch: state.pullRequest!.sourceRefName.replace('refs/heads/', ''),
        targetBranch,
        repository: state.repoName,
        org: state.org,
        project: state.project,
      };

      // Send only metadata - backend will fetch file contents directly
      const result = await window.electronAPI.ensurePRContext(
        prContext,
        fileMetadata,
        state.threads,
        lastCommitId,
        state.repoId
      );

      state.prContextKey = result.prContextKey;
      state.contextPath = result.contextPath;

      // Log whether context was refreshed due to PR update (lastCommitId changed)
      if (!result.reused) {
        console.log(`[App] PR context refreshed (PR updated): ${result.prContextKey}`);
      } else {
        console.log(`[App] PR context reused: ${result.prContextKey}`);
      }

      // Background cache warmup (non-blocking)
      const filesToWarm = fileMetadata.slice(0, 5).map(f => ({
        path: f.path,
        objectId: f.objectId,
        originalObjectId: f.originalObjectId,
      }));
      window.electronAPI.warmCache(result.prContextKey, filesToWarm).catch(console.warn);

      // Store metadata only - content will be lazy loaded
      state.fileChanges = fileMetadata.map(f => ({
        path: f.path,
        changeType: f.changeType,
        objectId: f.objectId,
        originalObjectId: f.originalObjectId,
        threads: f.threads,
        // Content intentionally omitted - will be lazy loaded via selectFile()
      }));

      // Initialize Apply Changes service (always, even without worktree - worktree created on demand)
      if (window.electronAPI.applyChangesInitialize) {
        const prMetadata = {
          org: state.org,
          project: state.project,
          repository: state.pullRequest?.repository?.name || '',
          sourceBranch: state.pullRequest?.sourceRefName?.replace('refs/heads/', '') || '',
        };
        await window.electronAPI.applyChangesInitialize(
          state.prId,
          result.contextPath,
          result.worktreePath,
          state.pullRequest?.title || `PR #${state.prId}`,
          prMetadata,
          result.hasLinkedRepo
        );
        console.log(`[App] Apply Changes initialized, hasLinkedRepo: ${result.hasLinkedRepo}, worktree: ${result.worktreePath || 'none'}`);
      }

      // Update canApply state for comment panels
      if (window.electronAPI.applyChangesCanApply) {
        const canApplyResult = await window.electronAPI.applyChangesCanApply(state.prId);
        this.commentsPanel.setCanApply(canApplyResult.canApply);
        this.aiCommentsPanel.setCanApply(canApplyResult.canApply);
        console.log(`[App] canApply: ${canApplyResult.canApply}, reason: ${canApplyResult.reason || 'none'}`);
      }

    } catch (error) {
      console.error('[App] Failed to create PR context:', error);
      // Fallback: Fetch files in renderer if backend fails
      console.log('[App] Falling back to renderer-side file fetching...');
      await this.processChangesWithFallback(state, changes);
    }
  }

  /**
   * Fallback method for when backend file fetching fails.
   * Fetches files in the renderer (original behavior).
   */
  private async processChangesWithFallback(state: PRTabState, changes: IterationChange[]) {
    const processedChanges = (await Promise.all(
      changes.map(async (change): Promise<FileChange | null> => {
        // For deleted files, item.path may be null - use originalPath as fallback
        const filePath = change.item?.path || change.originalPath;
        if (!filePath) return null;

        const fileThreads = filterVisibleThreads(
          state.threads.filter(t => t.threadContext?.filePath === filePath)
        );

        let originalContent: string | null = null;
        let modifiedContent: string | null = null;

        // Load file contents for diff
        if (change.item?.objectId && change.changeType !== 'delete') {
          try {
            modifiedContent = await window.electronAPI.getFileContent(
              state.org,
              state.project,
              state.repoId,
              change.item.objectId
            ) || null;
          } catch (e) {
            console.warn('Failed to load modified content:', e);
          }
        }

        if (['edit', 'delete', 'rename'].includes(change.changeType)) {
          if (change.item?.originalObjectId) {
            try {
              originalContent = await window.electronAPI.getFileContent(
                state.org,
                state.project,
                state.repoId,
                change.item.originalObjectId
              ) || null;
            } catch (e) {
              console.warn('Failed to load original content:', e);
            }
          } else {
            console.warn('No originalObjectId for', filePath, '- skipping original');
          }
        }

        return {
          path: filePath,
          changeType: change.changeType as ChangeType,
          originalContent: originalContent ?? undefined,
          modifiedContent: modifiedContent ?? undefined,
          objectId: change.item?.objectId,
          originalObjectId: change.item?.originalObjectId,
          threads: fileThreads,
        };
      })
    )).filter((f): f is FileChange => f !== null);

    // Keep content in memory (no disk storage in fallback mode)
    state.fileChanges = processedChanges;
    state.prContextKey = null;
    state.contextPath = null;

    // No worktree in fallback mode - disable Apply buttons
    this.commentsPanel.setCanApply(false);
    this.aiCommentsPanel.setCanApply(false);
  }

  private async selectFile(path: string) {
    const state = this.getCurrentPRState();
    if (!state) return;

    state.selectedFile = path;
    this.fileTree.setSelected(path);
    this.updatePreviewButtonVisibility(path);

    const file = state.fileChanges.find(f => f.path === path);
    if (!file) return;

    // Check if content is already in memory (backwards compatibility)
    if (file.originalContent !== undefined || file.modifiedContent !== undefined) {
      this.diffViewer.render(file, state.diffViewMode);
      this.commentsPanel.setFileThreads(file.threads);
      setTimeout(() => this.updateChangeNavigation(), 50);
      return;
    }

    // Lazy load from cache/disk
    if (!state.prContextKey) {
      this.diffViewer.showError('File content not available');
      return;
    }

    this.diffViewer.showLoading(path);

    try {
      const [originalContent, modifiedContent] = await Promise.all([
        file.originalObjectId
          ? window.electronAPI.getCachedFileContent(
              state.prContextKey,
              file.path,
              'original',
              file.originalObjectId,
              state.org,
              state.project,
              state.repoId
            )
          : Promise.resolve(null),
        file.objectId
          ? window.electronAPI.getCachedFileContent(
              state.prContextKey,
              file.path,
              'modified',
              file.objectId,
              state.org,
              state.project,
              state.repoId
            )
          : Promise.resolve(null),
      ]);

      // Update the file in state with loaded content so it persists for view switching
      file.originalContent = originalContent || undefined;
      file.modifiedContent = modifiedContent || undefined;

      this.diffViewer.render(file, state.diffViewMode);
      this.commentsPanel.setFileThreads(file.threads);
      setTimeout(() => this.updateChangeNavigation(), 50);

    } catch (error) {
      console.error('[App] Failed to load file content:', error);
      this.diffViewer.showError(`Failed to load file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private setDiffViewMode(mode: 'split' | 'unified' | 'preview') {
    const state = this.getCurrentPRState();
    if (!state) return;

    state.diffViewMode = mode;

    // Update buttons
    document.querySelectorAll(`#reviewScreen-${this.activeReviewTabId} .view-btn`).forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.view === mode);
    });

    if (state.selectedFile) {
      const file = state.fileChanges.find(f => f.path === state.selectedFile);
      if (file) {
        this.diffViewer.render(file, mode);
      }
    }

    // Don't persist 'preview' to settings - it's contextual
    if (mode !== 'preview') {
      this.preferredDiffViewMode = mode;
      // Apply to all other open PR tabs so switching tabs uses the same mode
      for (const [tabId, tabState] of this.prTabStates) {
        if (tabId !== this.activeReviewTabId) {
          tabState.diffViewMode = mode;
        }
      }
      window.electronAPI.saveSettings({ diffViewMode: mode });
    }
  }

  private isMarkdownFile(path: string): boolean {
    const ext = path.split('.').pop()?.toLowerCase();
    return ext === 'md' || ext === 'markdown';
  }

  private updatePreviewButtonVisibility(filePath: string | null) {
    const previewBtn = document.querySelector(`#reviewScreen-${this.activeReviewTabId} .preview-btn`);
    if (!previewBtn) return;

    const isMarkdown = filePath ? this.isMarkdownFile(filePath) : false;
    previewBtn.classList.toggle('hidden', !isMarkdown);

    // If in preview mode but switched to non-markdown file, revert to split
    const state = this.getCurrentPRState();
    if (state?.diffViewMode === 'preview' && !isMarkdown) {
      this.setDiffViewMode('split');
    }
  }

  private async submitVote(vote: number) {
    const state = this.getCurrentPRState();
    if (!state?.pullRequest) return;

    try {
      await window.electronAPI.submitVote(
        state.org,
        state.project,
        state.repoId,
        state.prId,
        vote
      );

      Toast.success('Vote submitted successfully');

      // Reload PR to update reviewers
      state.pullRequest = await window.electronAPI.loadPR(
        state.org,
        state.project,
        state.prId
      );
      this.updatePRHeaderForState(state, this.activeReviewTabId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to submit vote';
      Toast.error(message);
    }
  }

  private async createComment(filePath: string, startLine: number, endLine: number, content: string) {
    const state = this.getCurrentPRState();
    if (!state?.pullRequest) return;

    try {
      const thread = await window.electronAPI.createComment(
        state.org,
        state.project,
        state.repoId,
        state.prId,
        filePath,
        startLine,
        endLine,
        content
      );

      state.threads.push(thread);
      this.commentsPanel.addThread(thread);
      this.updateCommentCountForState(state, this.activeReviewTabId);

      // Update file threads (rebuild from master list to stay consistent with filterVisibleThreads)
      const file = state.fileChanges.find(f => f.path === filePath);
      if (file) {
        file.threads = filterVisibleThreads(
          state.threads.filter(t => t.threadContext?.filePath === filePath)
        );
        this.diffViewer.addCommentMarker(thread);
        this.fileTree.setFiles(state.fileChanges);
      }

      Toast.success('Comment added');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to add comment';
      Toast.error(message);
    }
  }

  private async replyToThread(threadId: number, content: string) {
    const state = this.getCurrentPRState();
    if (!state?.pullRequest) return;

    try {
      const comment = await window.electronAPI.replyToThread(
        state.org,
        state.project,
        state.repoId,
        state.prId,
        threadId,
        content
      );

      const thread = state.threads.find(t => t.id === threadId);
      if (thread) {
        thread.comments.push(comment);
        this.commentsPanel.updateThread(thread);
      }

      Toast.success('Reply added');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to add reply';
      Toast.error(message);
    }
  }

  private async analyzeComments(threadIds: number[]) {
    const state = this.getCurrentPRState();
    if (!state) return;

    const threads = state.threads.filter(t => threadIds.includes(t.id));
    if (threads.length === 0) return;

    this.commentsPanel.setAnalyzing(true);

    try {
      // Get settings for provider configuration
      const settings = await window.electronAPI.getConsoleReviewSettings();
      const analyzeSettings = settings.analyzeComments || { provider: 'claude-sdk' };

      // Get file contents for context
      const fileContents: Record<string, string> = {};
      for (const thread of threads) {
        const filePath = thread.threadContext?.filePath;
        if (filePath && !fileContents[filePath]) {
          const fileChange = state.fileChanges.find(f => f.path === filePath);
          if (fileChange?.modifiedContent) {
            fileContents[filePath] = fileChange.modifiedContent;
          }
        }
      }

      const context = {
        prId: state.prId,
        org: state.org,
        project: state.project,
      };

      await window.electronAPI.commentAnalysisAnalyze(
        threads,
        context,
        analyzeSettings.provider,
        fileContents,
        analyzeSettings.showTerminal
      );

      // Reload all analyses from backend (it merges new with existing)
      const allAnalyses = await window.electronAPI.commentAnalysisLoad(
        state.prId,
        state.org,
        state.project
      );
      this.commentsPanel.setAnalyses(allAnalyses?.analyses || []);
      Toast.success('Analysis complete');
      notificationService.notify(
        'aiAnalysisComplete',
        'Comment Analysis Complete',
        `${threads.length} comment${threads.length !== 1 ? 's' : ''} analyzed on PR #${state.prId}`
      );

      // Auto-fix if enabled - apply fixes for all 'fix' recommendations
      if (this.commentsPanel.isAutoFixEnabled()) {
        const fixAnalyses = this.commentsPanel.getFixAnalyses();
        if (fixAnalyses.length > 0) {
          console.log(`[App] Auto-fixing ${fixAnalyses.length} comment(s) with 'fix' recommendation`);
          for (const analysis of fixAnalyses) {
            // Apply fix without custom message (auto mode)
            await this.applyAnalysisFix(analysis.threadId, analysis, '');
          }
        }
      }
    } catch (error: any) {
      Toast.error(`Analysis failed: ${error.message}`);
    } finally {
      this.commentsPanel.setAnalyzing(false);
    }
  }

  private async reanalyzeComment(threadId: number) {
    const state = this.getCurrentPRState();
    if (!state) return;

    const thread = state.threads.find(t => t.id === threadId);
    if (!thread) return;

    try {
      // Get settings for provider configuration
      const settings = await window.electronAPI.getConsoleReviewSettings();
      const analyzeSettings = settings.analyzeComments || { provider: 'claude-sdk' };

      const filePath = thread.threadContext?.filePath;
      const fileContents: Record<string, string> = {};
      if (filePath) {
        const fileChange = state.fileChanges.find(f => f.path === filePath);
        if (fileChange?.modifiedContent) {
          fileContents[filePath] = fileChange.modifiedContent;
        }
      }

      const context = {
        prId: state.prId,
        org: state.org,
        project: state.project,
      };

      const analysis = await window.electronAPI.commentAnalysisReanalyze(
        thread,
        context,
        analyzeSettings.provider,
        fileContents,
        analyzeSettings.showTerminal
      );

      if (analysis) {
        this.commentsPanel.updateAnalysis(analysis);
        Toast.success('Comment re-analyzed');
      }
    } catch (error: any) {
      Toast.error(`Re-analysis failed: ${error.message}`);
    }
  }

  private async applyAnalysisFix(threadId: number, analysis: CommentAnalysis, customMessage: string) {
    const state = this.getCurrentPRState();
    if (!state) return;

    const thread = state.threads.find(t => t.id === threadId);
    if (!thread || !thread.threadContext?.filePath) return;

    // Build enriched content for apply changes
    let content = thread.comments
      .filter(c => c.commentType !== 'system' && !c.isDeleted)
      .map(c => c.content)
      .join('\n\n');

    content += `\n\n---\nAI Analysis: ${analysis.reasoning}`;
    if (analysis.fixDescription) {
      content += `\n\nFix: ${analysis.fixDescription}`;
    }
    if (analysis.suggestedCode) {
      content += `\n\nSuggested code:\n\`\`\`\n${analysis.suggestedCode}\n\`\`\``;
    }

    const filePath = thread.threadContext.filePath;
    const line = thread.threadContext.rightFileStart?.line || thread.threadContext.leftFileStart?.line || 0;

    // Use existing apply flow
    this.commentsPanel.setApplyingThread(threadId, true);

    try {
      await window.electronAPI.applyChangesQueue({
        prId: state.prId,
        source: 'ado',
        sourceId: threadId.toString(),
        filePath,
        lineNumber: line,
        commentContent: content,
        customMessage,
      });

      document.getElementById(`reviewScreen-${this.activeReviewTabId}`)?.classList.add('apply-changes-open');
      this.updatePanelButtonState('applyChangesBtn', true);
      await this.refreshApplyChangesState(state.prId);
      Toast.success('Added to apply queue');
    } catch (error) {
      this.commentsPanel.setApplyingThread(threadId, false);
      Toast.error('Failed to add to apply queue');
    }
  }

  private async postAnalysisReply(threadId: number, content: string) {
    const state = this.getCurrentPRState();
    if (!state) return;

    try {
      await window.electronAPI.replyToThread(
        state.org,
        state.project,
        state.repoId,
        state.prId,
        threadId,
        content
      );

      this.commentsPanel.markAnalysisPosted(threadId);
      Toast.success('Reply posted to ADO');

      // Refresh threads to show new reply
      await this.refreshThreadsForState(state);
    } catch (error: any) {
      Toast.error(`Failed to post reply: ${error.message}`);
    }
  }

  private async refreshThreadsForState(state: PRTabState) {
    const threads = await window.electronAPI.getThreads(
      state.org,
      state.project,
      state.repoId,
      state.prId
    );
    state.threads = threads;
    this.commentsPanel.setThreads(threads);
  }

  private async updateThreadStatus(threadId: number, status: string) {
    const state = this.getCurrentPRState();
    if (!state?.pullRequest) return;

    try {
      await window.electronAPI.updateThreadStatus(
        state.org,
        state.project,
        state.repoId,
        state.prId,
        threadId,
        status
      );

      const thread = state.threads.find(t => t.id === threadId);
      if (thread) {
        thread.status = status as any;
        this.commentsPanel.updateThread(thread);
      }

      Toast.success('Status updated');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update status';
      Toast.error(message);
    }
  }

  private updateCommentCountForState(state: PRTabState, tabId: string) {
    const userThreads = filterVisibleThreads(state.threads);
    const el = document.getElementById(`commentCount-${tabId}`);
    if (el) el.textContent = userThreads.length.toString();
  }

  private updateFileCountForState(state: PRTabState, tabId: string) {
    const el = document.getElementById(`fileCount-${tabId}`);
    if (el) el.textContent = state.fileChanges.length.toString();
  }

  private updateReviewProgress() {
    const state = this.getCurrentPRState();
    if (!state) return;

    const tabId = this.activeReviewTabId;
    const progress = this.fileTree.getReviewProgress();
    const progressEl = document.getElementById(`reviewProgress-${tabId}`);
    const progressBar = document.getElementById(`reviewProgressBar-${tabId}`);
    const progressText = document.getElementById(`reviewProgressText-${tabId}`);

    if (progressEl && progressBar && progressText) {
      if (progress.total > 0) {
        progressEl.classList.remove('hidden');
        const percent = Math.round((progress.reviewed / progress.total) * 100);
        progressBar.style.width = `${percent}%`;
        progressText.textContent = `${progress.reviewed}/${progress.total}`;
      } else {
        progressEl.classList.add('hidden');
      }
    }
  }

  private handleKeyboard(e: KeyboardEvent) {
    // Only handle keyboard shortcuts when in a PR review tab
    if (this.activeSection !== 'review' || this.activeReviewTabId === 'home') return;

    // c or Ctrl/Cmd + / to toggle comments panel
    if (e.key === 'c' && !this.isInputFocused()) {
      this.toggleCommentsPanel();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      this.toggleCommentsPanel();
    }

    // a to toggle AI comments panel
    if (e.key === 'a' && !this.isInputFocused()) {
      this.toggleAICommentsPanel();
    }

    // j/k for file navigation
    if (e.key === 'j' && !this.isInputFocused()) {
      this.navigateFiles(1);
    }
    if (e.key === 'k' && !this.isInputFocused()) {
      this.navigateFiles(-1);
    }

    // n/p for comment navigation
    if (e.key === 'n' && !this.isInputFocused()) {
      this.diffViewer.navigateComments(1);
    }
    if (e.key === 'p' && !this.isInputFocused()) {
      this.diffViewer.navigateComments(-1);
    }

    // ]/[ for change navigation
    if (e.key === ']' && !this.isInputFocused()) {
      e.preventDefault();
      this.navigateToNextChange(1);
    }
    if (e.key === '[' && !this.isInputFocused()) {
      e.preventDefault();
      this.navigateToNextChange(-1);
    }

    // Escape to close modals
    if (e.key === 'Escape') {
      const state = this.getCurrentPRState();
      if (state) {
        const voteDropdown = document.getElementById(`voteDropdown-${this.activeReviewTabId}`);
        voteDropdown?.classList.remove('open');
      }
      this.diffViewer.cancelComment();
    }
  }

  private isInputFocused(): boolean {
    const active = document.activeElement;
    return active instanceof HTMLInputElement ||
           active instanceof HTMLTextAreaElement ||
           active instanceof HTMLSelectElement;
  }

  private navigateFiles(direction: number) {
    const state = this.getCurrentPRState();
    if (!state?.selectedFile || state.fileChanges.length === 0) return;

    // Use ordered visible files so navigation matches file explorer order
    const visibleFiles = this.fileTree.getOrderedVisibleFiles();
    if (visibleFiles.length === 0) return;

    const currentIndex = visibleFiles.findIndex(f => f.path === state.selectedFile);
    const newIndex = Math.max(0, Math.min(visibleFiles.length - 1, currentIndex + direction));

    if (newIndex !== currentIndex) {
      this.selectFile(visibleFiles[newIndex].path);
    }
  }

  private navigateToNextChange(direction: number) {
    const state = this.getCurrentPRState();
    if (!state) return;

    const navigated = this.diffViewer.navigateChanges(direction);

    if (!navigated && state.selectedFile) {
      // Use ordered visible files so cross-file navigation matches file explorer order
      const visibleFiles = this.fileTree.getOrderedVisibleFiles();
      const currentIndex = visibleFiles.findIndex(f => f.path === state.selectedFile);
      const newIndex = currentIndex + direction;

      if (newIndex >= 0 && newIndex < visibleFiles.length) {
        this.selectFile(visibleFiles[newIndex].path);
        setTimeout(() => {
          if (direction > 0) {
            this.diffViewer.navigateChanges(1);
          } else {
            while (this.diffViewer.navigateChanges(1)) {}
          }
        }, 100);
      }
    }

    this.updateChangeNavigation();
  }

  private updateChangeNavigation() {
    const stats = this.diffViewer.getChangeStats();
    const navInfo = document.getElementById(`changeNavInfo-${this.activeReviewTabId}`);
    if (navInfo) {
      if (stats.total > 0) {
        navInfo.textContent = `${stats.current || '-'}/${stats.total}`;
      } else {
        navInfo.textContent = '';
      }
    }
  }

  private async openInBrowser() {
    const state = this.getCurrentPRState();
    if (!state?.pullRequest) {
      Toast.error('No pull request loaded');
      return;
    }

    try {
      const org = encodeURIComponent(state.org);
      const proj = encodeURIComponent(state.project);
      const repoName = encodeURIComponent(state.pullRequest.repository.name);
      const url = `https://dev.azure.com/${org}/${proj}/_git/${repoName}/pullrequest/${state.prId}`;
      await window.electronAPI.openExternal(url);
    } catch (error) {
      console.error('Failed to open in browser:', error);
      Toast.error('Failed to open in browser');
    }
  }

  private toggleCommentsPanel() {
    const reviewScreen = document.getElementById(`reviewScreen-${this.activeReviewTabId}`);
    const isOpen = reviewScreen?.classList.toggle('comments-open');
    this.updatePanelButtonState('toggleCommentsBtn', isOpen ?? false);
  }

  private toggleAICommentsPanel() {
    const state = this.getCurrentPRState();
    const reviewScreen = document.getElementById(`reviewScreen-${this.activeReviewTabId}`);
    const isOpen = reviewScreen?.classList.toggle('ai-comments-open');
    this.updatePanelButtonState('toggleAICommentsBtn', isOpen ?? false);

    // Reload comments from session when opening
    if (isOpen && state?.aiSessionId) {
      (async () => {
        try {
          const comments = await window.electronAPI.aiGetComments(state.aiSessionId!);
          if (comments && comments.length > 0) {
            this.aiCommentsPanel.setComments(comments);
            for (const comment of comments) {
              this.diffViewer.addAICommentMarker(comment);
            }
          }
        } catch (error) {
          console.error('Failed to reload AI comments:', error);
        }
      })();
    }
  }

  private toggleWalkthroughsPanel() {
    const reviewScreen = document.getElementById(`reviewScreen-${this.activeReviewTabId}`);
    const isOpen = reviewScreen?.classList.toggle('walkthroughs-open');
    this.updatePanelButtonState('walkthroughBtn', isOpen ?? false);
  }

  private toggleApplyChangesPanel() {
    const reviewScreen = document.getElementById(`reviewScreen-${this.activeReviewTabId}`);
    const isOpen = reviewScreen?.classList.toggle('apply-changes-open');
    this.updatePanelButtonState('applyChangesBtn', isOpen ?? false);
  }

  private async toggleCopilotChatPanel(): Promise<void> {
    const prState = this.getCurrentPRState();
    if (!prState) return;

    if (this.copilotChatPanel.isVisible()) {
      this.closeCopilotChatPanel();
    } else {
      await this.openCopilotChatPanel();
    }
  }

  private async openCopilotChatPanel(): Promise<void> {
    const prState = this.getCurrentPRState();
    if (!prState) return;

    // Get default AI from settings
    const settings = await window.electronAPI.getConsoleReviewSettings();
    const ai = (settings as any).defaultChatAI || 'copilot';
    prState.copilotChatAI = ai;
    prState.copilotChatPanelOpen = true;

    // Determine working directory (use contextPath from the PR context)
    const workingDir = prState.contextPath;

    if (!workingDir) {
      Toast.error('No PR context available. Please reload the PR.');
      return;
    }

    // Build initial prompt
    let initialPrompt = `You are helping the user with PR #${prState.prId}: "${prState.pullRequest?.title || 'PR'}".

First, gather all available context:
1. Read the PR context files in ./context/ directory (pr.json, comments.json, files.json)
2. You do not have to read all the files, you may read them when the user asks a question.`;

    // Add WorkIQ instructions if enabled
    if (this.enableWorkIQ) {
      initialPrompt += `
3. **Important**: If workiq tool: ask_work_iq tools is available, first use it to gather context from recent meetings related to this PR`;
    }

    initialPrompt += `

After this, respond with a simple text response to greet the user and ask them what they would like to know.`;

    // Create terminal session
    const sessionId = await window.electronAPI.chatTerminalCreate({
      ai,
      workingDir,
      contextPath: workingDir,
      initialPrompt,
    });

    // Open panel
    this.copilotChatPanel.setAI(ai);
    this.copilotChatPanel.open(sessionId);

    // Add panel to layout
    this.addChatPanelToLayout();

    // Update button state
    this.updatePanelButtonState('copilotChatBtn', true);

    // Set up panel callbacks
    this.copilotChatPanel.onClose(() => this.closeCopilotChatPanel());
    this.copilotChatPanel.onSwitchAI((newAI) => this.switchChatAI(newAI));
  }

  private closeCopilotChatPanel(): void {
    const prState = this.getCurrentPRState();
    if (prState) {
      prState.copilotChatPanelOpen = false;
    }

    // Kill the chat terminal session before closing panel
    const sessionId = this.copilotChatPanel.getSessionId();
    if (sessionId) {
      window.electronAPI.chatTerminalKill(sessionId);
    }

    this.copilotChatPanel.close();
    this.removeChatPanelFromLayout();
    this.updatePanelButtonState('copilotChatBtn', false);
  }

  private async switchChatAI(newAI: 'copilot' | 'claude'): Promise<void> {
    this.closeCopilotChatPanel();

    const prState = this.getCurrentPRState();
    if (prState) {
      prState.copilotChatAI = newAI;
    }

    await this.openCopilotChatPanel();
  }

  private addChatPanelToLayout(): void {
    const reviewScreen = document.getElementById(`reviewScreen-${this.activeReviewTabId}`);
    if (reviewScreen) {
      reviewScreen.classList.add('chat-panel-open');
      // Add panel to .review-content (same level as ai-comments-panel, etc.)
      const reviewContent = reviewScreen.querySelector('.review-content');
      const panelElement = this.copilotChatPanel.getElement();

      if (reviewContent && !reviewContent.querySelector('.copilot-chat-panel')) {
        // Set ID for resize handle targeting
        panelElement.id = `copilotChatPanel-${this.activeReviewTabId}`;
        reviewContent.appendChild(panelElement);
      }

      // Setup resize handle if not already set up (check for existing handle)
      if (!panelElement.querySelector('.resize-handle')) {
        const resizer = this.resizablePanels.get(this.activeReviewTabId);
        if (resizer) {
          resizer.setupPanel({
            element: panelElement,
            minWidth: 300,
            maxWidth: 700,
            defaultWidth: 400,
            storageKey: 'panel-width-copilot-chat',
            handlePosition: 'left',
          });
        }
      }
    }
  }

  private removeChatPanelFromLayout(): void {
    const reviewScreen = document.getElementById(`reviewScreen-${this.activeReviewTabId}`);
    if (reviewScreen) {
      reviewScreen.classList.remove('chat-panel-open');
    }
  }

  private updatePanelButtonState(buttonIdPrefix: string, isActive: boolean) {
    const btn = document.getElementById(`${buttonIdPrefix}-${this.activeReviewTabId}`);
    if (btn) {
      btn.classList.toggle('active', isActive);
    }
  }

  private updateGeneratedFilesToggle(tabId: string) {
    const toggleBtn = document.getElementById(`generatedFilesToggle-${tabId}`);
    if (!toggleBtn) return;

    const generatedCount = this.fileTree.getGeneratedFilesCount();
    if (generatedCount === 0) {
      toggleBtn.classList.add('hidden');
      return;
    }

    toggleBtn.classList.remove('hidden');
    const isShowing = this.fileTree.getShowGeneratedFiles();

    if (isShowing) {
      toggleBtn.innerHTML = `${iconHtml(Eye, { size: 14 })}<span>${generatedCount} gen</span>`;
      toggleBtn.title = `${generatedCount} generated files shown - click to hide`;
      toggleBtn.classList.remove('files-hidden');
      toggleBtn.classList.add('files-visible');
    } else {
      toggleBtn.innerHTML = `${iconHtml(EyeOff, { size: 14 })}<span>+${generatedCount} gen</span>`;
      toggleBtn.title = `${generatedCount} generated files hidden - click to show`;
      toggleBtn.classList.remove('files-visible');
      toggleBtn.classList.add('files-hidden');
    }
  }

  private showLoading(message = 'Loading...') {
    document.querySelector('.loading-text')!.textContent = message;
    this.loadingOverlay.classList.remove('hidden');
  }

  private hideLoading() {
    this.loadingOverlay.classList.add('hidden');
  }

  // AI Review Methods
  private async showAIReviewDialog() {
    const state = this.getCurrentPRState();
    if (!state?.pullRequest || state.fileChanges.length === 0) {
      Toast.error('No PR loaded or no file changes available');
      return;
    }

    const providers = await window.electronAPI.aiGetProviders();

    // Build provider options with all three providers
    const providerOptions = [
      { value: 'claude-sdk', label: 'Claude SDK', available: providers.some(p => p.provider === 'claude-sdk' && p.available) },
      { value: 'claude-terminal', label: 'Claude Terminal', available: true }, // Always available
      { value: 'copilot-sdk', label: 'GitHub Copilot SDK', available: providers.some(p => p.provider === 'copilot-sdk' && p.available) },
    ];

    const availableOptions = providerOptions.filter(p => p.available);

    if (availableOptions.length === 0) {
      Toast.error('No AI providers available.');
      return;
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'ai-review-dialog-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'ai-review-dialog';
    dialog.innerHTML = `
      <div class="ai-review-dialog-header">
        <div class="ai-review-dialog-title">
          ${iconHtml(Bot, { size: 20, class: 'robot-icon' })}
          <span>AI Code Review</span>
        </div>
        <button class="btn btn-icon close-dialog-btn">
          ${getIcon(X, 20)}
        </button>
      </div>
      <div class="ai-review-dialog-content">
        <div class="ai-review-option">
          <label for="aiProvider">AI Provider</label>
          <select id="aiProvider">
            ${availableOptions.map(p => `
              <option value="${p.value}">${p.label}</option>
            `).join('')}
          </select>
        </div>
        <div class="ai-review-option show-terminal-option" style="display: none;">
          <label>
            <input type="checkbox" id="showTerminal">
            Show Terminal
          </label>
        </div>
        <div class="ai-review-option">
          <label for="aiDepth">Review Depth</label>
          <select id="aiDepth">
            <option value="quick">Quick - Critical issues only</option>
            <option value="standard" selected>Standard - Bugs, security, performance</option>
            <option value="thorough">Thorough - Full review with best practices</option>
          </select>
        </div>
        <div class="ai-review-option">
          <label>Focus Areas (optional)</label>
          <div class="ai-review-checkboxes">
            <label><input type="checkbox" name="focusArea" value="security"> Security</label>
            <label><input type="checkbox" name="focusArea" value="performance"> Performance</label>
            <label><input type="checkbox" name="focusArea" value="bugs"> Bugs</label>
            <label><input type="checkbox" name="focusArea" value="style"> Style</label>
          </div>
        </div>
        <div class="ai-review-option">
          <label>
            <input type="checkbox" id="includeWalkthrough" checked>
            Generate code walkthrough
          </label>
        </div>
      </div>
      <div class="ai-review-dialog-footer">
        <button class="btn btn-secondary cancel-btn">Cancel</button>
        <button class="btn btn-primary start-review-btn">Start Review</button>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(dialog);

    const closeDialog = () => {
      backdrop.remove();
      dialog.remove();
    };

    // Toggle "Show Terminal" checkbox visibility based on provider
    const providerSelect = dialog.querySelector('#aiProvider') as HTMLSelectElement;
    const showTerminalOption = dialog.querySelector('.show-terminal-option') as HTMLElement;
    const updateShowTerminalVisibility = () => {
      showTerminalOption.style.display = providerSelect.value === 'claude-terminal' ? 'block' : 'none';
    };
    providerSelect.addEventListener('change', updateShowTerminalVisibility);
    updateShowTerminalVisibility(); // Set initial visibility

    backdrop.addEventListener('click', closeDialog);
    dialog.querySelector('.close-dialog-btn')?.addEventListener('click', closeDialog);
    dialog.querySelector('.cancel-btn')?.addEventListener('click', closeDialog);

    dialog.querySelector('.start-review-btn')?.addEventListener('click', async () => {
      const provider = (dialog.querySelector('#aiProvider') as HTMLSelectElement).value as AIProviderType;
      const depth = (dialog.querySelector('#aiDepth') as HTMLSelectElement).value as 'quick' | 'standard' | 'thorough';
      const focusAreas = Array.from(dialog.querySelectorAll('input[name="focusArea"]:checked'))
        .map(el => (el as HTMLInputElement).value) as ('security' | 'performance' | 'bugs' | 'style')[];
      const includeWalkthrough = (dialog.querySelector('#includeWalkthrough') as HTMLInputElement).checked;
      const showTerminal = (dialog.querySelector('#showTerminal') as HTMLInputElement).checked;

      closeDialog();
      await this.startAIReview({
        prId: state.prId,
        provider,
        depth,
        focusAreas,
        generateWalkthrough: includeWalkthrough,
        showTerminal: (provider === 'claude-terminal' || provider === 'copilot-terminal') ? showTerminal : undefined,
      });
    });
  }

  private async startAIReview(request: AIReviewRequest) {
    const state = this.getCurrentPRState();
    if (!state?.pullRequest || state.fileChanges.length === 0) {
      return;
    }

    state.aiReviewInProgress = true;
    this.aiCommentsPanel.clear();
    this.aiCommentsPanel.showProgress('Running AI review...');

    // Open AI comments panel
    document.getElementById(`reviewScreen-${this.activeReviewTabId}`)?.classList.add('ai-comments-open');
    this.updatePanelButtonState('toggleAICommentsBtn', true);

    const prContext: PRContext = {
      prId: state.pullRequest.pullRequestId,
      title: state.pullRequest.title,
      description: state.pullRequest.description || '',
      sourceBranch: state.pullRequest.sourceRefName.replace('refs/heads/', ''),
      targetBranch: state.pullRequest.targetRefName.replace('refs/heads/', ''),
      repository: state.pullRequest.repository.name,
      org: state.org,
      project: state.project,
    };

    // Build file contents map
    const fileContents: Record<string, { original: string | null; modified: string | null }> = {};
    for (const file of state.fileChanges) {
      fileContents[file.path] = {
        original: file.originalContent || null,
        modified: file.modifiedContent || null,
      };
    }

    try {
      // Add generated file patterns and enableWorkIQ to the request
      const requestWithPatterns = {
        ...request,
        generatedFilePatterns: this.generatedFilePatterns,
        enableWorkIQ: this.enableWorkIQ,
      };

      // Pass prContextKey to reuse the existing PR context on disk
      state.aiSessionId = await window.electronAPI.aiStartReview(
        state.org,
        state.project,
        prContext,
        state.fileChanges,
        state.threads,
        requestWithPatterns,
        fileContents,
        state.prContextKey || undefined
      );

      // If terminal provider with showTerminal, switch to terminals section
      if ((request.provider === 'claude-terminal' || request.provider === 'copilot-terminal') && request.showTerminal) {
        this.switchSection('terminals');
      }

      Toast.success('AI review started');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to start AI review';
      Toast.error(message);
      state.aiReviewInProgress = false;
      this.aiCommentsPanel.hideProgress();
    }
  }

  private async handleAIProgress(event: AIProgressEvent) {
    const state = this.getCurrentPRState();
    if (!state || event.sessionId !== state.aiSessionId) {
      return;
    }

    // Auto-save when complete
    if (event.status === 'complete') {
      state.aiReviewInProgress = false;
      this.aiCommentsPanel.hideProgress(event.sessionId);
      await this.autoSaveReview();
    } else if (event.status === 'error' || event.status === 'cancelled') {
      state.aiReviewInProgress = false;
      this.aiCommentsPanel.hideProgress(event.sessionId);
    } else if (event.statusText) {
      // Update progress message with status text
      this.aiCommentsPanel.showProgress(event.statusText, event.sessionId);
    }
  }

  private async autoSaveReview() {
    const state = this.getCurrentPRState();

    if (!state?.aiSessionId || !state.prId || state.hasSavedReview) {
      return;
    }

    try {
      // Save review immediately like we do for walkthrough (don't check comments.length)
      await this.saveCurrentReview(true);
    } catch (error) {
      console.error('Failed to auto-save review:', error);
    }
  }

  private handleAIComment(event: any) {
    const state = this.getCurrentPRState();
    if (!state || event.sessionId !== state.aiSessionId) return;

    this.aiCommentsPanel.addComment(event.comment);
    this.diffViewer.addAICommentMarker(event.comment);
  }

  private async handleAIWalkthrough(event: any) {
    const state = this.getCurrentPRState();
    // Only check that we have a state and the walkthrough is for the current PR
    // Don't check aiSessionId since multiple reviews can run concurrently
    if (!state || event.walkthrough?.prId !== state.prId) {
      return;
    }

    // Only show walkthrough if user is on this PR's tab
    const tabId = `pr-${state.prId}`;
    if (this.activeReviewTabId === tabId) {
      this.walkthroughUI.show(event.walkthrough, tabId);
      Toast.success('Walkthrough generated');
    }

    // Get review session info for metadata
    const reviewSession = await window.electronAPI.aiGetSession(event.sessionId);
    const walkthroughSessionId = `review-wt-${event.sessionId}`;
    const displayName = event.walkthrough.displayName || reviewSession?.displayName || 'Review Walkthrough';
    const provider = reviewSession?.provider || 'claude-sdk';

    // Add to walkthroughs sidebar - this is a walkthrough from a review session
    const walkthroughsView = this.walkthroughsViews.get(this.activeReviewTabId);
    if (walkthroughsView && event.walkthrough) {
      walkthroughsView.addSession({
        id: walkthroughSessionId,
        prId: state.prId,
        name: displayName,
        provider: provider,
        showTerminal: false,
        status: 'complete',
        preset: reviewSession?.preset,
        customPrompt: reviewSession?.customPrompt,
        createdAt: new Date().toISOString(),
        walkthrough: event.walkthrough,
      });
    }

    // Save the walkthrough with session-based filename
    if (state.prId) {
      try {
        await window.electronAPI.aiSaveWalkthroughSession(
          state.org,
          state.project,
          state.prId,
          walkthroughSessionId,
          displayName,
          provider,
          event.walkthrough,
          reviewSession?.preset,
          reviewSession?.customPrompt
        );
        state.hasSavedWalkthrough = true;
        state.savedWalkthroughInfo = {
          exists: true,
          savedAt: new Date().toISOString(),
        };
      } catch (error) {
        console.error('Failed to save walkthrough from review:', error);
      }
    }
  }

  private handleAIError(event: any) {
    const state = this.getCurrentPRState();
    if (!state || event.sessionId !== state.aiSessionId) return;

    state.aiReviewInProgress = false;
    Toast.error(event.error);
  }

  // Multiple reviews tab handlers
  private async handleReviewTabSelect(sessionId: string, isSaved: boolean): Promise<void> {
    const state = this.getCurrentPRState();
    if (!state) return;

    if (isSaved) {
      // Load saved review
      const savedReview = await window.electronAPI.aiLoadReviewSession(
        state.org,
        state.project,
        state.prId,
        sessionId
      );
      if (savedReview) {
        this.aiCommentsPanel.setComments(savedReview.comments);

        // Add markers to diff viewer
        this.diffViewer.clearAIComments();
        for (const comment of savedReview.comments) {
          this.diffViewer.addAICommentMarker(comment);
        }
      }
    } else {
      // Load from active session
      const comments = await window.electronAPI.aiGetComments(sessionId);
      this.aiCommentsPanel.setComments(comments);

      // Add markers to diff viewer
      this.diffViewer.clearAIComments();
      for (const comment of comments) {
        this.diffViewer.addAICommentMarker(comment);
      }
    }
  }

  private async handleReviewTabClose(sessionId: string, isSaved: boolean): Promise<void> {
    const state = this.getCurrentPRState();
    if (!state) return;

    if (isSaved) {
      // Delete saved review
      await window.electronAPI.aiDeleteReviewSession(
        state.org,
        state.project,
        state.prId,
        sessionId
      );
    } else {
      // Remove active session
      await window.electronAPI.aiRemoveSession(sessionId);
    }

    this.aiCommentsPanel.removeTab(sessionId);
  }

  private async startNewReview(): Promise<void> {
    const state = this.getCurrentPRState();
    if (!state?.pullRequest || state.fileChanges.length === 0) {
      Toast.error('No PR loaded or no file changes available');
      return;
    }

    const presets = await window.electronAPI.presetsGetReviewPresets();
    const providers = await window.electronAPI.aiGetProviders();

    // Check if at least one provider is available
    const hasAvailableProvider = providers.some(p => p.available);
    if (!hasAvailableProvider) {
      Toast.warning('No AI providers are available. Please install Claude CLI or Copilot CLI, or configure API credentials.');
    }

    const result = await showReviewDialog({ presets, availableProviders: providers });
    if (!result) return;

    const prContext: PRContext = {
      prId: state.pullRequest.pullRequestId,
      title: state.pullRequest.title,
      description: state.pullRequest.description || '',
      sourceBranch: state.pullRequest.sourceRefName.replace('refs/heads/', ''),
      targetBranch: state.pullRequest.targetRefName.replace('refs/heads/', ''),
      repository: state.pullRequest.repository.name,
      org: state.org,
      project: state.project,
    };

    // Build file contents map
    const fileContents: Record<string, { original: string | null; modified: string | null }> = {};
    for (const file of state.fileChanges) {
      fileContents[file.path] = {
        original: file.originalContent || null,
        modified: file.modifiedContent || null,
      };
    }

    try {
      const displayName = result.preset?.name || (result.customPrompt ? `Custom: ${result.customPrompt.substring(0, 30)}...` : 'Review');

      // Start the review
      const sessionId = await window.electronAPI.aiStartReview(
        state.org,
        state.project,
        prContext,
        state.fileChanges,
        state.threads,
        {
          prId: prContext.prId,
          provider: result.provider,
          depth: result.depth,
          focusAreas: result.focusAreas,
          generateWalkthrough: result.generateWalkthrough,
          showTerminal: result.showTerminal,
          preset: result.preset,
          customPrompt: result.customPrompt,
          displayName,
        },
        fileContents,
        state.prContextKey || undefined
      );

      // Add tab for the new review
      this.aiCommentsPanel.addTab({
        sessionId,
        displayName,
        status: 'preparing',
        isSaved: false,
      });

      state.aiSessionId = sessionId;
      state.aiReviewInProgress = true;
      this.aiCommentsPanel.clear();
      this.aiCommentsPanel.showProgress('Running AI review...');

      // Open AI comments panel
      document.getElementById(`reviewScreen-${this.activeReviewTabId}`)?.classList.add('ai-comments-open');
      this.updatePanelButtonState('toggleAICommentsBtn', true);

      // If terminal provider with showTerminal, switch to terminals section
      if ((result.provider === 'claude-terminal' || result.provider === 'copilot-terminal') && result.showTerminal) {
        this.switchSection('terminals');
      }

      Toast.success('AI review started');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to start AI review';
      Toast.error(message);
    }
  }

  // Walkthrough handlers
  private async handleWalkthroughSelect(sessionId: string, isSaved: boolean): Promise<void> {
    const state = this.getCurrentPRState();
    if (!state) return;

    const tabId = this.activeReviewTabId;

    // Review-generated walkthroughs have IDs starting with 'review-wt-' and are always saved
    const isReviewWalkthrough = sessionId.startsWith('review-wt-');

    if (isSaved || isReviewWalkthrough) {
      // Load saved walkthrough from storage
      const saved = await window.electronAPI.aiLoadWalkthroughSession(
        state.org,
        state.project,
        state.prId,
        sessionId
      );
      if (saved?.walkthrough) {
        this.walkthroughUI.show({
          ...saved.walkthrough,
          displayName: saved.displayName,
          preset: saved.preset,
          customPrompt: saved.customPrompt,
        }, tabId);
      }
    } else {
      // Get from active standalone walkthrough session
      const session = await window.electronAPI.walkthroughGetSession(sessionId);
      if (session?.walkthrough) {
        this.walkthroughUI.show({
          ...session.walkthrough,
          displayName: session.name,
          preset: session.preset,
          customPrompt: session.customPrompt,
        }, tabId);
      }
    }
  }

  private async handleWalkthroughClose(sessionId: string, isSaved: boolean): Promise<void> {
    const state = this.getCurrentPRState();
    if (!state) return;

    const walkthroughsView = this.walkthroughsViews.get(this.activeReviewTabId);
    if (!walkthroughsView) return;

    if (isSaved) {
      // Delete saved walkthrough
      await window.electronAPI.aiDeleteWalkthroughSession(
        state.org,
        state.project,
        state.prId,
        sessionId
      );
    } else {
      // Remove active session
      await window.electronAPI.walkthroughRemoveSession(sessionId);
    }

    walkthroughsView.removeSession(sessionId);
  }

  private async startNewWalkthrough(): Promise<void> {
    const state = this.getCurrentPRState();
    if (!state?.pullRequest || state.fileChanges.length === 0) {
      Toast.error('No PR loaded or no file changes available');
      return;
    }

    const presets = await window.electronAPI.presetsGetWalkthroughPresets();
    const providers = await window.electronAPI.aiGetProviders();

    const result = await showWalkthroughDialog({ presets, availableProviders: providers });
    if (!result) return;

    const prContext: PRContext = {
      prId: state.pullRequest.pullRequestId,
      title: state.pullRequest.title,
      description: state.pullRequest.description || '',
      sourceBranch: state.pullRequest.sourceRefName.replace('refs/heads/', ''),
      targetBranch: state.pullRequest.targetRefName.replace('refs/heads/', ''),
      repository: state.pullRequest.repository.name,
      org: state.org,
      project: state.project,
    };

    // Build file contents map
    const fileContents: Record<string, { original: string | null; modified: string | null }> = {};
    for (const file of state.fileChanges) {
      fileContents[file.path] = {
        original: file.originalContent || null,
        modified: file.modifiedContent || null,
      };
    }

    try {
      // Start the walkthrough - pass prContextKey to reuse the existing PR context on disk
      const sessionId = await window.electronAPI.walkthroughStart(
        state.org,
        state.project,
        prContext,
        state.fileChanges,
        state.threads,
        {
          prId: prContext.prId,
          provider: result.provider,
          showTerminal: result.showTerminal,
          preset: result.preset,
          customPrompt: result.customPrompt,
          displayName: result.displayName,
          generatedFilePatterns: this.generatedFilePatterns,
          enableWorkIQ: this.enableWorkIQ,
        },
        fileContents,
        state.prContextKey || undefined
      );

      // Add to sidebar
      const walkthroughsView = this.walkthroughsViews.get(this.activeReviewTabId);
      if (walkthroughsView) {
        walkthroughsView.addSession({
          id: sessionId,
          prId: prContext.prId,
          name: result.displayName,
          provider: result.provider,
          showTerminal: result.showTerminal,
          status: 'preparing',
          preset: result.preset,
          customPrompt: result.customPrompt,
          createdAt: new Date().toISOString(),
        });
      }

      // If terminal provider with showTerminal, switch to terminals section
      if ((result.provider === 'claude-terminal' || result.provider === 'copilot-terminal') && result.showTerminal) {
        this.switchSection('terminals');
      }

      Toast.success('Walkthrough generation started');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to start walkthrough';
      Toast.error(message);
    }
  }

  // Walkthrough event handlers
  private handleWalkthroughProgress(event: WalkthroughProgressEvent): void {
    const walkthroughsView = this.walkthroughsViews.get(this.activeReviewTabId);
    if (!walkthroughsView) return;

    walkthroughsView.updateSession(event.sessionId, {
      status: event.status,
      statusText: event.statusText,
    });
  }

  private async handleWalkthroughComplete(event: WalkthroughCompleteEvent): Promise<void> {
    const state = this.getCurrentPRState();
    const tabId = this.activeReviewTabId;
    const walkthroughsView = this.walkthroughsViews.get(tabId);
    if (!walkthroughsView) return;

    // Update session with status AND walkthrough data (for metadata display)
    walkthroughsView.updateSession(event.sessionId, {
      status: 'complete',
      walkthrough: event.walkthrough,
    });

    // Only show walkthrough if user is on the correct PR tab
    const expectedTabId = state ? `pr-${state.prId}` : null;
    if (expectedTabId && tabId === expectedTabId) {
      this.walkthroughUI.show(event.walkthrough, tabId);
      Toast.success('Walkthrough generated');
    }

    // Save the walkthrough with session-based filename
    if (state?.prId) {
      try {
        // Get session info for metadata
        const session = await window.electronAPI.walkthroughGetSession(event.sessionId);
        const displayName = session?.name || 'Walkthrough';
        const provider = session?.provider || 'claude-sdk';

        await window.electronAPI.aiSaveWalkthroughSession(
          state.org,
          state.project,
          state.prId,
          event.sessionId,
          displayName,
          provider,
          event.walkthrough,
          session?.preset,
          session?.customPrompt
        );
        state.hasSavedWalkthrough = true;
        state.savedWalkthroughInfo = {
          exists: true,
          savedAt: new Date().toISOString(),
        };
      } catch (error) {
        console.error('Failed to save standalone walkthrough:', error);
      }
    }
  }

  private handleWalkthroughError(event: WalkthroughErrorEvent): void {
    const walkthroughsView = this.walkthroughsViews.get(this.activeReviewTabId);
    if (!walkthroughsView) return;

    walkthroughsView.updateSession(event.sessionId, {
      status: 'error',
      error: event.error,
    });

    Toast.error(`Walkthrough failed: ${event.error}`);
  }

  private async publishAIComment(comment: AIReviewComment) {
    const state = this.getCurrentPRState();
    if (!state?.pullRequest) return;

    try {
      const content = this.formatAICommentForADO(comment);

      const thread = await window.electronAPI.createComment(
        state.org,
        state.project,
        state.repoId,
        state.prId,
        comment.filePath,
        comment.startLine,
        comment.endLine,
        content
      );

      if (state.aiSessionId) {
        await window.electronAPI.aiMarkCommentPublished(state.aiSessionId, comment.id, thread.id);
      }

      this.aiCommentsPanel.updateComment(comment.id, { published: true, adoThreadId: thread.id });

      state.threads.push(thread);
      this.commentsPanel.addThread(thread);

      Toast.success('Comment published to ADO');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to publish comment';
      Toast.error(message);
    }
  }

  private formatAICommentForADO(comment: AIReviewComment): string {
    const severityEmoji: Record<string, string> = {
      critical: '🔴',
      major: '🟡',
      minor: '🔵',
      trivial: '⚪',
    };

    let content = `${severityEmoji[comment.severity]} **[${comment.severity.toUpperCase()}]** ${comment.title}\n\n`;
    content += `${comment.content}\n\n`;

    if (comment.suggestedFix) {
      content += `**Suggested fix:**\n\`\`\`\n${comment.suggestedFix}\n\`\`\`\n\n`;
    }

    content += `_Category: ${comment.category} | Confidence: ${Math.round(comment.confidence * 100)}%_\n\n`;
    content += `_Generated by TaskDock's AI Review Agent_`;

    return content;
  }

  // AI Review Persistence
  private async checkForSavedReviewData(state: PRTabState) {
    if (!state.prId) return;

    try {
      const [reviewInfo, walkthroughInfo, savedReviews, savedWalkthroughs] = await Promise.all([
        window.electronAPI.aiHasSavedReview(state.org, state.project, state.prId),
        window.electronAPI.aiHasSavedWalkthrough(state.org, state.project, state.prId),
        window.electronAPI.aiListReviews(state.org, state.project, state.prId),
        window.electronAPI.aiListWalkthroughs(state.org, state.project, state.prId),
      ]);

      state.hasSavedReview = reviewInfo.exists;
      state.savedReviewInfo = reviewInfo;
      state.hasSavedWalkthrough = walkthroughInfo.exists;
      state.savedWalkthroughInfo = walkthroughInfo;


      // Load saved reviews into tabs
      if (savedReviews && savedReviews.length > 0) {
        const reviewTabs = savedReviews.map((r: any) => ({
          sessionId: r.sessionId,
          displayName: r.displayName,
          status: 'complete' as const,
          isSaved: true,
        }));
        this.aiCommentsPanel.setTabs(reviewTabs);
      }

      // Load saved walkthroughs into panel
      const walkthroughsView = this.walkthroughsViews.get(this.activeReviewTabId);
      if (walkthroughsView && savedWalkthroughs && savedWalkthroughs.length > 0) {
        walkthroughsView.setSavedWalkthroughs(savedWalkthroughs);
      }

      // Load the first saved review if available (legacy behavior)
      if (reviewInfo.exists) {
        await this.loadSavedReview(state);
      }
      if (walkthroughInfo.exists) {
        await this.loadSavedWalkthrough(state);
      }
    } catch (error) {
      console.error('Failed to check for saved review data:', error);
    }
  }


  private async loadSavedReview(state: PRTabState) {
    if (!state.prId) return;

    try {
      const savedReview = await window.electronAPI.aiLoadReview(
        state.org,
        state.project,
        state.prId
      );

      if (savedReview) {
        this.aiCommentsPanel.clear();
        this.aiCommentsPanel.setComments(savedReview.comments);
        this.aiCommentsPanel.setSavedInfo(savedReview.savedAt);

        for (const comment of savedReview.comments) {
          this.diffViewer.addAICommentMarker(comment);
        }

        document.getElementById(`reviewScreen-${this.activeReviewTabId}`)?.classList.add('ai-comments-open');
        this.updatePanelButtonState('toggleAICommentsBtn', true);

        Toast.success(`Loaded ${savedReview.comments.length} saved AI comments`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load saved review';
      Toast.error(message);
    }
  }

  private async loadSavedWalkthrough(state: PRTabState) {
    if (!state.prId) return;

    try {
      const savedWalkthrough = await window.electronAPI.aiLoadWalkthrough(
        state.org,
        state.project,
        state.prId
      );

      if (savedWalkthrough) {
        this.walkthroughUI.show(savedWalkthrough.walkthrough, this.activeReviewTabId);
        Toast.success('Loaded saved walkthrough');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load saved walkthrough';
      Toast.error(message);
    }
  }

  private async saveCurrentReview(silent = false) {
    const state = this.getCurrentPRState();

    if (!state?.prId) {
      return;
    }

    try {
      let comments: any[];

      if (state.aiSessionId) {
        // Save via AI session (standard AI Review)
        await window.electronAPI.aiSaveReview(
          state.org,
          state.project,
          state.prId,
          state.aiSessionId
        );
        comments = await window.electronAPI.aiGetComments(state.aiSessionId);
      } else {
        // Save comments directly (Console/Deep Review)
        comments = this.aiCommentsPanel.getComments();
        if (comments.length === 0) {
          if (!silent) {
            Toast.error('No comments to save');
          }
          return;
        }
        await window.electronAPI.aiSaveReviewComments(
          state.org,
          state.project,
          state.prId,
          comments
        );
      }

      state.hasSavedReview = true;
      state.savedReviewInfo = {
        exists: true,
        savedAt: new Date().toISOString(),
        commentCount: comments.length,
      };

      this.aiCommentsPanel.setSavedInfo(state.savedReviewInfo.savedAt!);

      if (!silent) {
        Toast.success('Review saved');
      }
      console.log(`Review saved with ${comments.length} comments`);
    } catch (error: unknown) {
      if (!silent) {
        const message = error instanceof Error ? error.message : 'Failed to save review';
        Toast.error(message);
      }
      console.error('Failed to save review:', error);
    }
  }

  private async closeTerminalSession(sessionId: string, isChat = false) {
    if (isChat) {
      // Chat terminal (plugin-launched AI terminal) — simpler cleanup
      await window.electronAPI.chatTerminalRemove(sessionId);
      this.terminalsView.removeSession(sessionId);
      return;
    }

    // Regular terminal — get session for cleanup info
    const session = await window.electronAPI.terminalGetSession(sessionId);

    // Remove the terminal from backend (kills process)
    await window.electronAPI.terminalRemove(sessionId);

    // Remove from UI
    this.terminalsView.removeSession(sessionId);

    // Get cleanup settings
    const settings = await window.electronAPI.getConsoleReviewSettings();

    // Cleanup context files if we have the path
    if (session?.contextPath) {
      if (settings.worktreeCleanup === 'auto') {
        try {
          await window.electronAPI.consoleReviewCleanup(session.contextPath);
        } catch (error) {
          console.error('Failed to cleanup review context:', error);
        }
      }
    }

    // Cleanup worktree if we created it and setting allows
    if (session?.worktreeCreated && session?.mainRepoPath && session?.workingDir) {
      if (settings.worktreeCleanup === 'auto') {
        console.log('[closeTerminalSession] Cleaning up worktree:', session.workingDir);
        try {
          await window.electronAPI.consoleReviewCleanupWorktree({
            mainRepoPath: session.mainRepoPath,
            worktreePath: session.workingDir,
          });
          Toast.info('Worktree cleaned up');
        } catch (error) {
          console.error('Failed to cleanup worktree:', error);
        }
      } else if (settings.worktreeCleanup === 'never') {
        console.log('[closeTerminalSession] Keeping worktree (setting: never):', session.workingDir);
      }
    }
  }

  // ==================== Work Items Methods ====================

  private async refreshWorkItems() {
    if (!this.organization || !this.project) {
      this.workItemsListView.setWorkItems([]);
      this.workItemsListView.setSubtitle('Configure organization and project in settings');
      return;
    }

    this.workItemsListView.setLoading(true);

    try {
      const view = this.workItemsListView.getActiveView();
      const queryId = this.workItemsListView.getActiveQueryId();
      let items: WorkItem[];

      if (view === 'custom' && queryId) {
        const query = this.savedQueries.find(q => q.id === queryId);
        if (query) {
          // Use ADO query ID if available, otherwise fall back to WIQL
          const ids = query.adoQueryId
            ? await window.electronAPI.wiRunQueryById(this.organization, this.project, query.adoQueryId)
            : await window.electronAPI.wiQuery(this.organization, this.project, query.wiql);
          items = await window.electronAPI.wiGetItems(this.organization, this.project, ids.slice(0, 50));
        } else {
          items = [];
        }
      } else if (view === 'created') {
        items = await window.electronAPI.wiGetCreatedByMe(this.organization, this.project);
      } else {
        items = await window.electronAPI.wiGetMyItems(this.organization, this.project);
      }

      this.workItemsListView.setWorkItems(items);
      this.workItemsListView.setSubtitle(`${items.length} work items`);

      // Load query builder options (types, areas, iterations)
      this.loadQueryBuilderOptions();
    } catch (error) {
      console.error('Failed to load work items:', error);
      this.workItemsListView.setWorkItems([]);
      this.workItemsListView.setSubtitle('Failed to load work items');
      Toast.error('Failed to load work items');
    }
  }

  private async loadQueryBuilderOptions() {
    if (!this.organization || !this.project) return;

    try {
      const [types, areaPaths, iterationPaths] = await Promise.all([
        window.electronAPI.wiGetTypes(this.organization, this.project),
        window.electronAPI.wiGetAreaPaths(this.organization, this.project),
        window.electronAPI.wiGetIterationPaths(this.organization, this.project),
      ]);

      // Extract work item type names
      const typeNames = types.map((t: any) => t.name);

      // Extract area path names (flatten tree)
      const areaPathNames = this.flattenClassificationPaths(areaPaths);

      // Extract iteration path names (flatten tree)
      const iterationPathNames = this.flattenClassificationPaths(iterationPaths);

      // Common states
      const states = ['New', 'Active', 'Resolved', 'Closed', 'Removed', 'Done', 'In Progress', 'To Do', 'Approved', 'Committed'];

      this.workItemQueryBuilder.setOptions({
        workItemTypes: typeNames,
        states,
        areaPaths: areaPathNames,
        iterationPaths: iterationPathNames,
      });
    } catch (error) {
      console.error('Failed to load query builder options:', error);
    }
  }

  private flattenClassificationPaths(node: any, prefix = ''): string[] {
    const paths: string[] = [];
    if (node.name) {
      const path = prefix ? `${prefix}\\${node.name}` : node.name;
      paths.push(path);
      if (node.children) {
        for (const child of node.children) {
          paths.push(...this.flattenClassificationPaths(child, path));
        }
      }
    }
    return paths;
  }

  private async loadSavedQueries() {
    try {
      this.savedQueries = await window.electronAPI.wiGetSavedQueries();
      this.workItemsListView.setSavedQueries(this.savedQueries);
    } catch (error) {
      console.error('Failed to load saved queries:', error);
    }
  }

  private showQueryBuilder(query?: SavedQuery) {
    this.workItemQueryBuilder.show(query);
  }

  private async saveQuery(query: SavedQuery) {
    try {
      await window.electronAPI.wiSaveQuery(query);
      await this.loadSavedQueries();
      Toast.success('Query saved');
    } catch (error) {
      console.error('Failed to save query:', error);
      Toast.error('Failed to save query');
    }
  }

  private async deleteQuery(queryId: string) {
    try {
      await window.electronAPI.wiDeleteQuery(queryId);
      await this.loadSavedQueries();

      // If the deleted query was active, switch back to assigned view
      if (this.workItemsListView.getActiveQueryId() === queryId) {
        this.workItemsListView.setActiveView('assigned');
        this.refreshWorkItems();
      }

      Toast.success('Query deleted');
    } catch (error) {
      console.error('Failed to delete query:', error);
      Toast.error('Failed to delete query');
    }
  }

  private async runCustomQuery(query: SavedQuery) {
    // Update last used timestamp
    query.lastUsed = new Date().toISOString();
    await window.electronAPI.wiSaveQuery(query);

    this.workItemsListView.setActiveView('custom', query.id);
    this.refreshWorkItems();
  }

  private showImportAdoQueryModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal import-ado-query-modal">
        <header class="modal-header">
          <h2>Import ADO Query</h2>
          <button class="btn btn-icon close-modal-btn">
            ${getIcon(X, 20)}
          </button>
        </header>
        <div class="modal-body">
          <div class="form-field">
            <label for="adoQueryInput">Query ID or URL</label>
            <input type="text" id="adoQueryInput" class="form-input" placeholder="Paste query ID or ADO query URL">
            <small class="form-hint">Accepts a GUID or full ADO URL like https://dev.azure.com/org/project/_queries/query/...</small>
          </div>
          <div class="form-field">
            <label for="adoQueryName">Query Name</label>
            <input type="text" id="adoQueryName" class="form-input" placeholder="My ADO Query">
          </div>
          <div id="importValidationStatus" class="import-validation-status"></div>
        </div>
        <footer class="modal-footer">
          <button class="btn btn-secondary cancel-btn">Cancel</button>
          <button class="btn btn-secondary validate-btn">Validate</button>
          <button class="btn btn-primary import-btn" disabled>Import</button>
        </footer>
      </div>
    `;

    document.body.appendChild(modal);

    const inputEl = modal.querySelector('#adoQueryInput') as HTMLInputElement;
    const nameEl = modal.querySelector('#adoQueryName') as HTMLInputElement;
    const statusEl = modal.querySelector('#importValidationStatus')!;
    const validateBtn = modal.querySelector('.validate-btn') as HTMLButtonElement;
    const importBtn = modal.querySelector('.import-btn') as HTMLButtonElement;

    let validatedQueryId: string | null = null;

    // Close handlers
    modal.querySelector('.close-modal-btn')?.addEventListener('click', () => modal.remove());
    modal.querySelector('.cancel-btn')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // Parse query ID from input (handles both GUID and URL formats)
    const parseQueryId = (input: string): string | null => {
      const trimmed = input.trim();

      // Check if it's a GUID format
      const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (guidRegex.test(trimmed)) {
        return trimmed;
      }

      // Try to extract from ADO URL
      // Format: https://dev.azure.com/org/project/_queries/query/GUID
      // Or: https://dev.azure.com/org/project/_queries/query-edit/GUID
      const urlRegex = /\/_queries\/(?:query|query-edit)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
      const match = trimmed.match(urlRegex);
      if (match) {
        return match[1];
      }

      return null;
    };

    // Validate button handler
    validateBtn.addEventListener('click', async () => {
      const queryId = parseQueryId(inputEl.value);
      if (!queryId) {
        statusEl.innerHTML = '<span class="validation-error">Invalid query ID or URL format</span>';
        importBtn.disabled = true;
        validatedQueryId = null;
        return;
      }

      statusEl.innerHTML = '<span class="validation-pending">Validating...</span>';
      validateBtn.disabled = true;

      try {
        const ids = await window.electronAPI.wiRunQueryById(this.organization, this.project, queryId);
        validatedQueryId = queryId;
        statusEl.innerHTML = `<span class="validation-success">Valid query - found ${ids.length} work items</span>`;
        importBtn.disabled = false;

        // Auto-populate name if empty
        if (!nameEl.value.trim()) {
          nameEl.value = `ADO Query ${queryId.substring(0, 8)}...`;
        }
      } catch (error) {
        statusEl.innerHTML = `<span class="validation-error">Failed to validate: ${(error as Error).message}</span>`;
        importBtn.disabled = true;
        validatedQueryId = null;
      } finally {
        validateBtn.disabled = false;
      }
    });

    // Import button handler
    importBtn.addEventListener('click', async () => {
      if (!validatedQueryId || !nameEl.value.trim()) {
        return;
      }

      const query: SavedQuery = {
        id: crypto.randomUUID(),
        name: nameEl.value.trim(),
        wiql: '', // Not used for ADO queries
        adoQueryId: validatedQueryId,
        createdAt: new Date().toISOString(),
      };

      try {
        await window.electronAPI.wiSaveQuery(query);
        await this.loadSavedQueries();
        Toast.success('Query imported');
        modal.remove();
      } catch (error) {
        Toast.error('Failed to import query: ' + (error as Error).message);
      }
    });

    // Focus input
    inputEl.focus();
  }

  private async openWorkItemTab(item: WorkItem) {
    const tabId = `wi-${item.id}`;

    // Check if tab already exists
    const existingTab = this.workItemsTabs.find(t => t.id === tabId);
    if (existingTab) {
      this.switchWorkItemsTab(tabId);
      return;
    }

    // Create new tab
    const tab: WorkItemTab = {
      id: tabId,
      type: 'detail',
      label: `#${item.id}`,
      closeable: true,
      workItemId: item.id,
    };

    this.workItemsTabs.push(tab);

    // Create tab panel container
    const container = document.getElementById('workItemTabPanelsContainer')!;
    const panel = document.createElement('div');
    panel.id = `workItemPanel-${tabId}`;
    panel.className = 'tab-panel workitem-detail-panel';
    container.appendChild(panel);

    // Create detail view
    const detailView = new WorkItemDetailView(panel, {
      organization: this.organization,
      project: this.project,
    });
    detailView.onOpenRelated((id) => this.openWorkItemById(id));
    detailView.onOpenInBrowser((url) => window.electronAPI.openExternal(url));
    detailView.onWorkItemUpdated((updatedItem) => {
      // Update the tab title if title changed
      const tabBtn = document.querySelector(`[data-tab-id="${tabId}"]`);
      if (tabBtn) {
        const titleSpan = tabBtn.querySelector('.workitems-tab-title');
        if (titleSpan) {
          titleSpan.textContent = `#${updatedItem.id} ${updatedItem.fields['System.Title']}`;
        }
      }
      // Refresh the list view to show updated state
      this.refreshWorkItems();
    });
    detailView.onRefreshRequest(async () => {
      // Reload the work item to show updated attachments/links
      try {
        const refreshedItem = await window.electronAPI.wiGetItem(this.organization, this.project, item.id);
        detailView.setWorkItem(refreshedItem);
      } catch (error) {
        console.error('Failed to refresh work item:', error);
      }
    });
    this.workItemDetailViews.set(tabId, detailView);

    // Load full work item data
    detailView.setLoading(true);
    try {
      const [fullItem, updates] = await Promise.all([
        window.electronAPI.wiGetItem(this.organization, this.project, item.id),
        window.electronAPI.wiGetUpdates(this.organization, this.project, item.id),
      ]);

      detailView.setWorkItem(fullItem);
      detailView.setUpdates(updates);

      // Load related items
      if (fullItem.relations?.length > 0) {
        const relatedIds = fullItem.relations
          .map((rel: any) => {
            const match = rel.url.match(/workItems\/(\d+)/);
            return match ? parseInt(match[1]) : null;
          })
          .filter((id: number | null): id is number => id !== null);

        if (relatedIds.length > 0) {
          const relatedItems = await window.electronAPI.wiGetItems(this.organization, this.project, relatedIds);
          detailView.setRelatedItems(relatedItems);
        }
      }
    } catch (error) {
      console.error('Failed to load work item:', error);
      Toast.error('Failed to load work item');
    }

    this.switchWorkItemsTab(tabId);
    this.updateWorkItemsTabBar();
  }

  private async openWorkItemById(id: number) {
    if (!this.organization || !this.project) return;

    try {
      const item = await window.electronAPI.wiGetItem(this.organization, this.project, id);
      this.openWorkItemTab(item);
    } catch (error) {
      console.error('Failed to load work item:', error);
      Toast.error('Failed to load work item');
    }
  }

  private switchWorkItemsTab(tabId: string) {
    this.activeWorkItemsTabId = tabId;

    // Show/hide panels
    const listPanel = document.getElementById('workItemsListPanel');
    if (listPanel) {
      listPanel.classList.toggle('active', tabId === 'list');
      listPanel.style.display = tabId === 'list' ? '' : 'none';
    }

    this.workItemDetailViews.forEach((_, id) => {
      const panel = document.getElementById(`workItemPanel-wi-${id.replace('wi-', '')}`);
      if (panel) {
        panel.classList.toggle('active', id === tabId);
        panel.style.display = id === tabId ? '' : 'none';
      }
    });

    // Explicitly show the active detail panel
    const activePanel = document.getElementById(`workItemPanel-${tabId}`);
    if (activePanel) {
      activePanel.classList.add('active');
      activePanel.style.display = '';
    }

    this.updateWorkItemsTabBar();
  }

  private closeWorkItemsTab(tabId: string) {
    const index = this.workItemsTabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    // Remove tab
    this.workItemsTabs.splice(index, 1);

    // Remove detail view
    this.workItemDetailViews.delete(tabId);

    // Remove panel
    const panel = document.getElementById(`workItemPanel-${tabId}`);
    panel?.remove();

    // Switch to another tab if we closed the active one
    if (this.activeWorkItemsTabId === tabId) {
      const newTab = this.workItemsTabs[Math.max(0, index - 1)];
      if (newTab) {
        this.switchWorkItemsTab(newTab.id);
      }
    }

    this.updateWorkItemsTabBar();
  }

  private updateWorkItemsTabBar() {
    // For now, we'll just show tabs inline in the work items section
    // A more sophisticated implementation would use a separate TabBar component
    const tabs: Tab[] = this.workItemsTabs.map(t => ({
      id: t.id,
      label: t.label,
      closeable: t.closeable,
      icon: t.type === 'list' ? getIcon(LayoutGrid, 14) : undefined,
    }));

    // Update the tab bar in the work items section (if we have more than one tab)
    if (this.workItemsTabs.length > 1) {
      this.renderWorkItemsTabs(tabs);
    } else {
      this.hideWorkItemsTabs();
    }
  }

  private renderWorkItemsTabs(tabs: Tab[]) {
    const container = document.getElementById('workItemsSectionContent');
    if (!container) return;

    let tabBar = container.querySelector('.workitems-tab-bar') as HTMLElement;
    if (!tabBar) {
      tabBar = document.createElement('div');
      tabBar.className = 'workitems-tab-bar';
      container.insertBefore(tabBar, container.firstChild);
    }

    tabBar.innerHTML = tabs.map(tab => `
      <button class="workitems-tab-btn ${tab.id === this.activeWorkItemsTabId ? 'active' : ''}" data-tab-id="${tab.id}">
        ${tab.icon || ''}
        <span>${tab.label}</span>
        ${tab.closeable ? `<span class="workitems-tab-close" data-tab-id="${tab.id}">&times;</span>` : ''}
      </button>
    `).join('');

    // Attach event listeners
    tabBar.querySelectorAll('.workitems-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('workitems-tab-close')) {
          e.stopPropagation();
          const tabId = target.dataset.tabId!;
          this.closeWorkItemsTab(tabId);
        } else {
          const tabId = (btn as HTMLElement).dataset.tabId!;
          this.switchWorkItemsTab(tabId);
        }
      });
    });
  }

  private hideWorkItemsTabs() {
    const container = document.getElementById('workItemsSectionContent');
    if (!container) return;

    const tabBar = container.querySelector('.workitems-tab-bar');
    tabBar?.remove();
  }

  // Utility methods
  private getInitials(name: string): string {
    const parts = name.split(/[\s\\]+/).filter(p => p.length > 0);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  new PRReviewApp();
});
