import type { CallFlowData, CallDetailsData, CallFlowMessage } from '../../../main/cfv/cfv-types.js';
import type { CfvChatAction } from '../../../shared/cfv-types.js';
import { escapeHtml } from '../../utils/html-utils.js';
import { getIcon, MessageSquare } from '../../utils/icons.js';
import { CfvCallFlowPanel } from './cfv-callflow-panel.js';
import { CfvDrillDownPanel } from './cfv-drilldown-panel.js';
import { CfvRawEventsPanel } from './cfv-raw-events-panel.js';
import { CfvQoePanel } from './cfv-qoe-panel.js';
import { CfvChatPanel } from './cfv-chat-panel.js';

type SubTab = 'callflow' | 'drilldown' | 'rawevents' | 'qoe';

export class CfvCallView {
  private container: HTMLElement;
  private callId: string;
  private activeSubTab: SubTab = 'callflow';
  private loading = true;
  private chatOpen = false;
  private chatPanel: CfvChatPanel | null = null;

  private callFlowPanel: CfvCallFlowPanel | null = null;
  private drillDownPanel: CfvDrillDownPanel | null = null;
  private rawEventsPanel: CfvRawEventsPanel | null = null;
  private qoePanel: CfvQoePanel | null = null;

  private callFlowData: CallFlowData | null = null;
  private callDetailsData: CallDetailsData | null = null;
  private rawFilesData: Record<string, unknown> = {};

  constructor(container: HTMLElement, callId: string) {
    this.container = container;
    this.callId = callId;
    this.render();
    this.loadData();
  }

  private render() {
    const shortId = this.callId.length > 20 ? this.callId.slice(0, 8) + '...' + this.callId.slice(-4) : this.callId;

    this.container.innerHTML = `
      <div class="cfv-call-view">
        <div class="cfv-call-main">
          <div class="cfv-call-toolbar">
            <span class="cfv-call-toolbar-id" title="${escapeHtml(this.callId)}">${escapeHtml(shortId)}</span>
            <div class="cfv-subtab-group">
              <button class="cfv-subtab-btn active" data-subtab="callflow">Call Flow</button>
              <button class="cfv-subtab-btn" data-subtab="drilldown">Drill Down</button>
              <button class="cfv-subtab-btn" data-subtab="rawevents">Raw Events</button>
              <button class="cfv-subtab-btn" data-subtab="qoe">QoE</button>
            </div>
            <div class="spacer"></div>
            <button class="cfv-subtab-btn" id="cfvChatToggle" title="AI Chat">
              ${getIcon(MessageSquare, 14)} Chat
            </button>
          </div>
          <div class="cfv-call-content">
            <div class="cfv-subpanel active" id="cfvSubCallflow"></div>
            <div class="cfv-subpanel" id="cfvSubDrilldown"></div>
            <div class="cfv-subpanel" id="cfvSubRawevents"></div>
            <div class="cfv-subpanel" id="cfvSubQoe"></div>
            <div class="cfv-subpanel" id="cfvSubLoading" style="display:flex;align-items:center;justify-content:center">
              <div class="loading-spinner"></div>
              <p style="margin-left:12px;color:var(--text-secondary)">Loading call data...</p>
            </div>
          </div>
        </div>
        <div class="cfv-chat-container" id="cfvChatContainer"></div>
      </div>
    `;

    if (this.loading) {
      this.hideAllSubPanels();
      const loadingPanel = this.container.querySelector('#cfvSubLoading') as HTMLElement;
      if (loadingPanel) {
        loadingPanel.style.display = 'flex';
        loadingPanel.classList.add('active');
      }
    }

    this.attachEventListeners();
  }

  private async loadData() {
    try {
      const api = (window as any).electronAPI;

      const [callFlow, callDetails] = await Promise.all([
        api.cfvGetCallFlowData(this.callId),
        api.cfvGetCallDetails(this.callId),
      ]);

      this.callFlowData = callFlow;
      this.callDetailsData = callDetails;

      // Also load raw files for raw events panel
      const rawFilesData: Record<string, unknown> = {};
      if (callFlow) rawFilesData['callFlow'] = callFlow;

      // Try to load events_qoe
      try {
        const qoeRaw = await api.cfvGetRawFile(this.callId, 'events_qoe.json');
        if (qoeRaw) rawFilesData['events_qoe'] = JSON.parse(qoeRaw);
      } catch { /* no events_qoe */ }

      // Try to load callSummary
      try {
        const summaryRaw = await api.cfvGetRawFile(this.callId, 'callSummary.json');
        if (summaryRaw) rawFilesData['callSummary'] = JSON.parse(summaryRaw);
      } catch { /* no callSummary */ }

      // Try to load chatAssistant
      try {
        const chatRaw = await api.cfvGetRawFile(this.callId, 'chatAssistant.json');
        if (chatRaw) rawFilesData['chatAssistant'] = JSON.parse(chatRaw);
      } catch { /* no chatAssistant */ }

      this.rawFilesData = rawFilesData;
      this.loading = false;

      // Hide loading, show active tab
      const loadingPanel = this.container.querySelector('#cfvSubLoading') as HTMLElement;
      if (loadingPanel) {
        loadingPanel.style.display = 'none';
        loadingPanel.classList.remove('active');
      }

      // Initialize and show the active sub-panel
      this.switchSubTab(this.activeSubTab);
    } catch (error) {
      this.loading = false;
      const loadingPanel = this.container.querySelector('#cfvSubLoading') as HTMLElement;
      if (loadingPanel) {
        loadingPanel.innerHTML = `
          <div class="cfv-no-data">
            <p>Failed to load call data</p>
            <p style="font-size:11px;color:var(--text-tertiary)">${escapeHtml(String(error))}</p>
          </div>
        `;
      }
    }
  }

  private hideAllSubPanels() {
    this.container.querySelectorAll('.cfv-subpanel').forEach(panel => {
      (panel as HTMLElement).classList.remove('active');
      (panel as HTMLElement).style.display = 'none';
    });
  }

  private switchSubTab(tab: SubTab) {
    this.activeSubTab = tab;

    // Update button states
    this.container.querySelectorAll('.cfv-subtab-group .cfv-subtab-btn').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.subtab === tab);
    });

    // Hide all sub-panels
    this.hideAllSubPanels();

    // Show active panel and lazy-create its component
    const panelId = `cfvSub${tab.charAt(0).toUpperCase() + tab.slice(1)}`;
    const panel = this.container.querySelector(`#${panelId}`) as HTMLElement;
    if (panel) {
      panel.classList.add('active');
      panel.style.display = '';
    }

    if (this.loading) return; // Don't render until data is loaded

    switch (tab) {
      case 'callflow':
        if (!this.callFlowPanel && panel) {
          this.callFlowPanel = new CfvCallFlowPanel(panel);
        }
        if (this.callFlowPanel && this.callFlowData) {
          const messages = (this.callFlowData?.nrtStreamingIndexAugmentedCall?.fullCallFlow?.messages ?? []) as CallFlowMessage[];
          this.callFlowPanel.setData(messages, this.callId);
        }
        break;

      case 'drilldown':
        if (!this.drillDownPanel && panel) {
          this.drillDownPanel = new CfvDrillDownPanel(panel);
        }
        if (this.drillDownPanel) {
          this.drillDownPanel.setData(this.callDetailsData);
        }
        break;

      case 'rawevents':
        if (!this.rawEventsPanel && panel) {
          this.rawEventsPanel = new CfvRawEventsPanel(panel);
        }
        if (this.rawEventsPanel) {
          this.rawEventsPanel.setData(this.rawFilesData);
        }
        break;

      case 'qoe':
        if (!this.qoePanel && panel) {
          this.qoePanel = new CfvQoePanel(panel);
        }
        if (this.qoePanel) {
          this.qoePanel.setData(this.callDetailsData);
        }
        break;
    }
  }

  private attachEventListeners() {
    this.container.querySelectorAll('.cfv-subtab-group .cfv-subtab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const subtab = (btn as HTMLElement).dataset.subtab as SubTab;
        if (subtab) this.switchSubTab(subtab);
      });
    });

    // Chat toggle button
    const chatToggle = this.container.querySelector('#cfvChatToggle');
    chatToggle?.addEventListener('click', () => this.toggleChat());
  }

  private toggleChat() {
    const callView = this.container.querySelector('.cfv-call-view') as HTMLElement;
    const chatContainer = this.container.querySelector('#cfvChatContainer') as HTMLElement;
    const chatToggle = this.container.querySelector('#cfvChatToggle') as HTMLElement;
    if (!callView || !chatContainer) return;

    if (this.chatOpen) {
      // Close chat — just hide, keep session alive
      this.chatOpen = false;
      callView.classList.remove('chat-open');
      chatToggle?.classList.remove('active');
    } else {
      // Open chat
      this.chatOpen = true;
      callView.classList.add('chat-open');
      chatToggle?.classList.add('active');
      // Create panel only once; reuse on subsequent opens
      if (!this.chatPanel) {
        this.chatPanel = new CfvChatPanel(
          chatContainer,
          this.callId,
          () => this.toggleChat(),
          (action) => this.handleChatAction(action),
        );
      }
    }
  }

  private handleChatAction(action: CfvChatAction) {
    // Ensure call flow panel exists and is initialized
    this.ensureCallFlowPanel();

    switch (action.action) {
      case 'navigate_to_line':
        if (action.lineNumber != null) {
          // Switch to callflow tab if not already there
          if (this.activeSubTab !== 'callflow') {
            this.switchSubTab('callflow');
          }
          this.callFlowPanel?.navigateToLine(action.lineNumber);
        }
        break;

      case 'set_filter':
        if (action.filterRule) {
          // Switch to callflow tab if not already there
          if (this.activeSubTab !== 'callflow') {
            this.switchSubTab('callflow');
          }
          this.callFlowPanel?.addFilterRule(action.filterRule);
        }
        break;

      case 'clear_filters':
        this.callFlowPanel?.clearFilters();
        break;
    }
  }

  private ensureCallFlowPanel() {
    if (this.callFlowPanel || this.loading) return;
    const panel = this.container.querySelector('#cfvSubCallflow') as HTMLElement;
    if (panel) {
      this.callFlowPanel = new CfvCallFlowPanel(panel);
      if (this.callFlowData) {
        const messages = (this.callFlowData?.nrtStreamingIndexAugmentedCall?.fullCallFlow?.messages ?? []) as CallFlowMessage[];
        this.callFlowPanel.setData(messages, this.callId);
      }
    }
  }

  dispose() {
    this.chatPanel?.dispose();
    this.chatPanel = null;
    this.callFlowPanel?.dispose();
    this.drillDownPanel?.dispose();
    this.rawEventsPanel?.dispose();
    this.qoePanel?.dispose();
    this.callFlowPanel = null;
    this.drillDownPanel = null;
    this.rawEventsPanel = null;
    this.qoePanel = null;
  }
}
