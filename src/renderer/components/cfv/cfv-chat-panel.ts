import { escapeHtml } from '../../utils/html-utils.js';
import type { CfvChatMessage, CfvChatEvent, CfvChatAction, CfvChatSessionInfo } from '../../../shared/cfv-types.js';

const SUGGESTIONS = [
  'Summarize this call — what happened and why?',
  'Find any failures or errors in the call flow',
  'Highlight all messages involving the CC service',
];

export type ChatActionHandler = (action: CfvChatAction) => void;

export class CfvChatPanel {
  private container: HTMLElement;
  private callId: string;
  private sessionId: string | null = null;
  private persistentSessionId: string | null = null;
  private sessions: CfvChatSessionInfo[] = [];
  private messages: CfvChatMessage[] = [];
  private unsubscribe: (() => void) | null = null;
  private isStreaming = false;
  private onClose: () => void;
  private onAction: ChatActionHandler | null;

  constructor(container: HTMLElement, callId: string, onClose: () => void, onAction?: ChatActionHandler) {
    this.container = container;
    this.callId = callId;
    this.onClose = onClose;
    this.onAction = onAction || null;
    this.render();
    this.initialize();
  }

  private render() {
    this.container.innerHTML = `
      <div class="cfv-chat-panel">
        <div class="cfv-chat-header">
          <span class="cfv-chat-header-title">AI Chat</span>
          <div class="cfv-chat-header-actions">
            <select class="cfv-chat-session-select" title="Switch session" style="display:none"></select>
            <button class="cfv-chat-new-btn" title="New chat">+ New</button>
            <button class="cfv-chat-close-btn" title="Close chat">&times;</button>
          </div>
        </div>
        <div class="cfv-chat-messages" id="cfvChatMessages">
          <div class="cfv-chat-welcome">
            <div class="cfv-chat-welcome-title">Ask about this call</div>
            <div class="cfv-chat-welcome-subtitle">AI can read call flow data, diagnostics, and QoE metrics to answer your questions.</div>
            <div class="cfv-chat-suggestions">
              ${SUGGESTIONS.map(s => `<button class="cfv-chat-suggestion">${escapeHtml(s)}</button>`).join('')}
            </div>
          </div>
        </div>
        <div class="cfv-chat-input-area">
          <textarea class="cfv-chat-input" placeholder="Ask about the call..." rows="1"></textarea>
          <button class="cfv-chat-send-btn" disabled>Send</button>
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  private attachEventListeners() {
    // Close button
    const closeBtn = this.container.querySelector('.cfv-chat-close-btn');
    closeBtn?.addEventListener('click', () => this.onClose());

    // New chat button
    const newChatBtn = this.container.querySelector('.cfv-chat-new-btn');
    newChatBtn?.addEventListener('click', () => this.loadSession());

    // Session selector
    const sessionSelect = this.container.querySelector('.cfv-chat-session-select') as HTMLSelectElement;
    sessionSelect?.addEventListener('change', () => {
      if (sessionSelect.value !== this.persistentSessionId) {
        this.loadSession(sessionSelect.value);
      }
    });

    // Send button
    const sendBtn = this.container.querySelector('.cfv-chat-send-btn') as HTMLButtonElement;
    sendBtn?.addEventListener('click', () => this.handleSend());

    // Input area
    const input = this.container.querySelector('.cfv-chat-input') as HTMLTextAreaElement;
    input?.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      if (sendBtn) {
        sendBtn.disabled = !input.value.trim() || this.isStreaming;
      }
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (input.value.trim() && !this.isStreaming) {
          this.handleSend();
        }
      }
    });

    // Suggestion buttons
    this.attachSuggestionListeners();
  }

  private attachSuggestionListeners() {
    const input = this.container.querySelector('.cfv-chat-input') as HTMLTextAreaElement;
    this.container.querySelectorAll('.cfv-chat-suggestion').forEach(btn => {
      btn.addEventListener('click', () => {
        const text = btn.textContent || '';
        if (input) {
          input.value = text;
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        }
        this.handleSend(text);
      });
    });
  }

  private async initialize() {
    try {
      const api = (window as any).electronAPI;
      const { sessions, lastActiveSessionId } = await api.cfvChatListSessions(this.callId);
      this.sessions = sessions;

      // Find last active session, or most recent, or create new
      let targetId: string | undefined;
      if (lastActiveSessionId && sessions.some((s: CfvChatSessionInfo) => s.id === lastActiveSessionId)) {
        targetId = lastActiveSessionId;
      } else if (sessions.length > 0) {
        targetId = sessions[sessions.length - 1].id;
      }

      await this.loadSession(targetId);
    } catch (error) {
      this.showError(`Failed to initialize chat: ${error}`);
    }
  }

  /**
   * Load a persistent session (or create a new one if no ID provided).
   * Tears down any existing SDK session, renders messages, creates new SDK session.
   */
  private async loadSession(persistentId?: string) {
    const api = (window as any).electronAPI;

    // Tear down existing SDK session
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.sessionId) {
      try { await api.cfvChatDestroy(this.sessionId); } catch { /* ignore */ }
      this.sessionId = null;
    }

    // Reset state
    this.messages = [];
    this.isStreaming = false;

    // Clear messages area
    const messagesArea = this.container.querySelector('#cfvChatMessages') as HTMLElement;
    if (messagesArea) messagesArea.innerHTML = '';

    // Load messages if resuming an existing session
    if (persistentId) {
      const messages: CfvChatMessage[] = await api.cfvChatLoadSessionMessages(this.callId, persistentId);
      if (messages.length > 0) {
        this.messages = messages;
        for (const msg of messages) {
          this.addMessageBubble(msg);
        }
      } else {
        this.showWelcome();
      }
    } else {
      this.showWelcome();
    }

    // Create SDK session (backend auto-creates persistent session if persistentId is undefined)
    const result = await api.cfvChatCreate(this.callId, persistentId);
    this.sessionId = result.sdkSessionId;
    this.persistentSessionId = result.persistentSessionId;

    // If new session, add it to the local list
    if (!persistentId) {
      this.sessions.push({
        id: result.persistentSessionId,
        title: 'New chat',
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        messageCount: 0,
      });
    }

    this.updateSessionDropdown();

    // Subscribe to events
    this.unsubscribe = api.onCfvChatEvent((event: CfvChatEvent) => {
      if (event.sessionId === this.sessionId) {
        this.handleChatEvent(event);
      }
    });

    this.updateSendButton();
  }

  private showWelcome() {
    const messagesArea = this.container.querySelector('#cfvChatMessages') as HTMLElement;
    if (!messagesArea) return;
    messagesArea.innerHTML = `
      <div class="cfv-chat-welcome">
        <div class="cfv-chat-welcome-title">Ask about this call</div>
        <div class="cfv-chat-welcome-subtitle">AI can read call flow data, diagnostics, and QoE metrics to answer your questions.</div>
        <div class="cfv-chat-suggestions">
          ${SUGGESTIONS.map(s => `<button class="cfv-chat-suggestion">${escapeHtml(s)}</button>`).join('')}
        </div>
      </div>
    `;
    this.attachSuggestionListeners();
  }

  private updateSessionDropdown() {
    const select = this.container.querySelector('.cfv-chat-session-select') as HTMLSelectElement;
    if (!select) return;

    select.style.display = this.sessions.length > 1 ? '' : 'none';
    select.innerHTML = '';

    // Newest sessions first
    const sorted = [...this.sessions].reverse();
    for (const session of sorted) {
      const option = document.createElement('option');
      option.value = session.id;
      option.textContent = session.title;
      option.selected = session.id === this.persistentSessionId;
      select.appendChild(option);
    }
  }

  private async handleSend(text?: string) {
    const input = this.container.querySelector('.cfv-chat-input') as HTMLTextAreaElement;
    const message = text || input?.value.trim();
    if (!message || !this.sessionId || this.isStreaming) return;

    // Clear input
    if (input) {
      input.value = '';
      input.style.height = 'auto';
    }

    // Remove welcome state
    const welcome = this.container.querySelector('.cfv-chat-welcome');
    if (welcome) welcome.remove();

    // Update session title locally on first user message
    const session = this.sessions.find(s => s.id === this.persistentSessionId);
    if (session && session.title === 'New chat') {
      session.title = message.length > 50 ? message.slice(0, 50) + '...' : message;
      this.updateSessionDropdown();
    }

    // Add user message
    this.addMessageBubble({ id: '', role: 'user', content: message, timestamp: new Date().toISOString(), status: 'complete' });

    // Disable send button
    this.isStreaming = true;
    this.updateSendButton();

    try {
      const api = (window as any).electronAPI;
      await api.cfvChatSend(this.sessionId, message);
    } catch (error) {
      this.isStreaming = false;
      this.updateSendButton();
      this.showError(`Failed to send message: ${error}`);
    }
  }

  private handleChatEvent(event: CfvChatEvent) {
    const messagesArea = this.container.querySelector('#cfvChatMessages') as HTMLElement;
    if (!messagesArea) return;

    switch (event.type) {
      case 'delta': {
        let bubble = messagesArea.querySelector('.cfv-chat-msg.assistant.streaming') as HTMLElement;
        if (!bubble) {
          bubble = document.createElement('div');
          bubble.className = 'cfv-chat-msg assistant streaming';
          bubble.dataset.messageId = event.messageId || '';
          messagesArea.appendChild(bubble);
        }
        // Append delta content
        const current = bubble.getAttribute('data-raw') || '';
        const updated = current + (event.deltaContent || '');
        bubble.setAttribute('data-raw', updated);
        bubble.innerHTML = this.renderMarkdown(updated);
        this.scrollToBottom();
        break;
      }

      case 'complete': {
        const bubble = messagesArea.querySelector('.cfv-chat-msg.assistant.streaming') as HTMLElement;
        if (bubble && event.fullContent) {
          bubble.setAttribute('data-raw', event.fullContent);
          bubble.innerHTML = this.renderMarkdown(event.fullContent);
        }
        break;
      }

      case 'tool_call': {
        const toolName = event.toolName || 'files';
        const statusText = this.getToolStatusText(toolName);
        this.showToolStatus(statusText);
        break;
      }

      case 'tool_result': {
        this.removeToolStatus();
        break;
      }

      case 'action': {
        if (event.chatAction && this.onAction) {
          this.onAction(event.chatAction);
        }
        break;
      }

      case 'idle': {
        // Mark streaming complete
        const bubble = messagesArea.querySelector('.cfv-chat-msg.assistant.streaming') as HTMLElement;
        if (bubble) {
          bubble.classList.remove('streaming');
        }
        this.removeToolStatus();
        this.isStreaming = false;
        this.updateSendButton();
        this.scrollToBottom();
        break;
      }

      case 'error': {
        const bubble = messagesArea.querySelector('.cfv-chat-msg.assistant.streaming') as HTMLElement;
        if (bubble) {
          bubble.classList.remove('streaming');
          bubble.classList.add('error');
          if (!bubble.getAttribute('data-raw')) {
            bubble.textContent = `Error: ${event.error || 'Unknown error'}`;
          }
        } else {
          this.showError(event.error || 'Unknown error');
        }
        this.removeToolStatus();
        this.isStreaming = false;
        this.updateSendButton();
        break;
      }
    }
  }

  private addMessageBubble(msg: CfvChatMessage) {
    const messagesArea = this.container.querySelector('#cfvChatMessages') as HTMLElement;
    if (!messagesArea) return;

    const bubble = document.createElement('div');
    bubble.className = `cfv-chat-msg ${msg.role}`;

    if (msg.role === 'user') {
      bubble.textContent = msg.content;
    } else {
      bubble.innerHTML = this.renderMarkdown(msg.content);
    }

    messagesArea.appendChild(bubble);
    this.scrollToBottom();
  }

  private showError(message: string) {
    const messagesArea = this.container.querySelector('#cfvChatMessages') as HTMLElement;
    if (!messagesArea) return;

    const bubble = document.createElement('div');
    bubble.className = 'cfv-chat-msg assistant error';
    bubble.textContent = message;
    messagesArea.appendChild(bubble);
    this.scrollToBottom();
  }

  private showToolStatus(text: string) {
    this.removeToolStatus();
    const messagesArea = this.container.querySelector('#cfvChatMessages') as HTMLElement;
    if (!messagesArea) return;

    const status = document.createElement('div');
    status.className = 'cfv-chat-tool-status';
    status.innerHTML = `<div class="loading-spinner small"></div> ${escapeHtml(text)}`;
    messagesArea.appendChild(status);
    this.scrollToBottom();
  }

  private removeToolStatus() {
    const status = this.container.querySelector('.cfv-chat-tool-status');
    if (status) status.remove();
  }

  private getToolStatusText(toolName: string): string {
    switch (toolName) {
      case 'navigate_to_line': return 'Navigating to message...';
      case 'set_filter': return 'Applying filter...';
      case 'clear_filters': return 'Clearing filters...';
      default: return `Reading ${toolName}...`;
    }
  }

  private updateSendButton() {
    const sendBtn = this.container.querySelector('.cfv-chat-send-btn') as HTMLButtonElement;
    const input = this.container.querySelector('.cfv-chat-input') as HTMLTextAreaElement;
    if (sendBtn) {
      sendBtn.disabled = this.isStreaming || !input?.value.trim();
    }
  }

  private scrollToBottom() {
    const messagesArea = this.container.querySelector('#cfvChatMessages') as HTMLElement;
    if (messagesArea) {
      messagesArea.scrollTop = messagesArea.scrollHeight;
    }
  }

  private renderMarkdown(text: string): string {
    // Lightweight inline markdown renderer
    let html = escapeHtml(text);

    // Code blocks: ```lang\n...\n```
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
      return `<pre><code>${code}</code></pre>`;
    });

    // Inline code: `...`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold: **...**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic: *...*
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

    // Unordered lists: lines starting with - or *
    html = html.replace(/^[\s]*[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // Ordered lists: lines starting with number.
    html = html.replace(/^[\s]*\d+\.\s+(.+)$/gm, '<li>$1</li>');

    // Paragraphs: double newlines
    html = html.replace(/\n\n/g, '</p><p>');
    html = `<p>${html}</p>`;

    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');

    // Single newlines to <br> within paragraphs
    html = html.replace(/(?<!>)\n(?!<)/g, '<br>');

    return html;
  }

  async dispose() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    if (this.sessionId) {
      try {
        const api = (window as any).electronAPI;
        await api.cfvChatDestroy(this.sessionId);
      } catch {
        // Ignore cleanup errors
      }
      this.sessionId = null;
    }

    this.container.innerHTML = '';
  }
}
