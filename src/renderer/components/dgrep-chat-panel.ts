import { escapeHtml } from '../utils/html-utils.js';
import { MessageCircle, X, Send, Loader2 } from '../utils/icons.js';
import { iconHtml } from '../utils/icons.js';
import type { DGrepChatMessage, DGrepChatEvent } from '../../shared/dgrep-ai-types.js';

const SUGGESTIONS = [
  'What errors are most frequent?',
  'Show timeline of failures',
  'Explain the error spike',
];

export class DGrepChatPanel {
  private container: HTMLElement;
  private el: HTMLElement;
  private visible = false;
  private isStreaming = false;
  private chatSessionId: string | null = null;
  private messages: DGrepChatMessage[] = [];

  onCreateSession: ((columns: string[], rows: any[]) => Promise<string>) | null = null;
  onSendMessage: ((chatSessionId: string, message: string) => void) | null = null;
  onDestroySession: ((chatSessionId: string) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.container = parent;
    this.el = document.createElement('div');
    this.el.className = 'dgrep-chat-panel';
    this.el.style.display = 'none';
    this.container.appendChild(this.el);
    this.render();
  }

  show() {
    this.visible = true;
    this.el.style.display = '';
  }

  hide() {
    this.visible = false;
    this.el.style.display = 'none';
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Initialize a chat session with the current data */
  async initSession(columns: string[], rows: any[]) {
    if (this.chatSessionId) return; // already have a session
    if (!this.onCreateSession) return;

    try {
      this.chatSessionId = await this.onCreateSession(columns, rows);
    } catch (err) {
      this.showError(`Failed to create chat session: ${err}`);
    }
  }

  /** Handle chat events from the backend */
  handleChatEvent(event: DGrepChatEvent) {
    if (event.chatSessionId !== this.chatSessionId) return;

    const messagesArea = this.el.querySelector('.dgrep-chat-messages') as HTMLElement;
    if (!messagesArea) return;

    switch (event.type) {
      case 'delta': {
        let bubble = messagesArea.querySelector('.dgrep-chat-msg-assistant.streaming') as HTMLElement;
        if (!bubble) {
          bubble = document.createElement('div');
          bubble.className = 'dgrep-chat-msg-assistant streaming';
          bubble.dataset.messageId = event.messageId || '';
          messagesArea.appendChild(bubble);
        }
        const current = bubble.getAttribute('data-raw') || '';
        const updated = current + (event.deltaContent || '');
        bubble.setAttribute('data-raw', updated);
        bubble.innerHTML = this.renderMarkdown(updated);
        this.scrollToBottom();
        break;
      }

      case 'complete': {
        const bubble = messagesArea.querySelector('.dgrep-chat-msg-assistant.streaming') as HTMLElement;
        if (bubble && event.fullContent) {
          bubble.setAttribute('data-raw', event.fullContent);
          bubble.innerHTML = this.renderMarkdown(event.fullContent);
        }
        break;
      }

      case 'tool_call': {
        const toolName = event.toolName || 'data';
        this.showToolStatus(`Searching ${toolName}...`);
        break;
      }

      case 'tool_result': {
        this.removeToolStatus();
        break;
      }

      case 'idle': {
        const bubble = messagesArea.querySelector('.dgrep-chat-msg-assistant.streaming') as HTMLElement;
        if (bubble) bubble.classList.remove('streaming');
        this.removeToolStatus();
        this.isStreaming = false;
        this.updateSendButton();
        this.scrollToBottom();
        break;
      }

      case 'error': {
        const bubble = messagesArea.querySelector('.dgrep-chat-msg-assistant.streaming') as HTMLElement;
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

  /** Destroy the session on cleanup */
  async dispose() {
    if (this.chatSessionId && this.onDestroySession) {
      try {
        this.onDestroySession(this.chatSessionId);
      } catch {
        // ignore cleanup errors
      }
      this.chatSessionId = null;
    }
    this.messages = [];
    this.el.remove();
  }

  /** Reset session (e.g., when search results change) */
  resetSession() {
    if (this.chatSessionId && this.onDestroySession) {
      try {
        this.onDestroySession(this.chatSessionId);
      } catch {
        // ignore
      }
    }
    this.chatSessionId = null;
    this.messages = [];
    this.isStreaming = false;
    this.render();
  }

  private render() {
    this.el.innerHTML = `
      <div class="dgrep-chat-header">
        <span class="dgrep-chat-header-title">${iconHtml(MessageCircle, { size: 14 })} Log Assistant</span>
        <button class="btn btn-ghost btn-xs dgrep-chat-close-btn">${iconHtml(X, { size: 14 })}</button>
      </div>
      <div class="dgrep-chat-messages">
        <div class="dgrep-chat-welcome">
          <div class="dgrep-chat-welcome-title">Ask about these logs</div>
          <div class="dgrep-chat-welcome-subtitle">AI can analyze patterns, errors, and trends in your search results.</div>
          <div class="dgrep-chat-suggestions">
            ${SUGGESTIONS.map(s => `<button class="dgrep-chat-suggestion-chip">${escapeHtml(s)}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="dgrep-chat-input-area">
        <textarea class="dgrep-chat-input" placeholder="Ask about the logs..." rows="1"></textarea>
        <button class="btn btn-primary btn-xs dgrep-chat-send-btn" disabled>${iconHtml(Send, { size: 14 })}</button>
      </div>
    `;

    this.attachListeners();
  }

  private attachListeners() {
    const closeBtn = this.el.querySelector('.dgrep-chat-close-btn');
    closeBtn?.addEventListener('click', () => this.hide());

    const sendBtn = this.el.querySelector('.dgrep-chat-send-btn') as HTMLButtonElement;
    sendBtn?.addEventListener('click', () => this.handleSend());

    const input = this.el.querySelector('.dgrep-chat-input') as HTMLTextAreaElement;
    input?.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      this.updateSendButton();
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (input.value.trim() && !this.isStreaming) {
          this.handleSend();
        }
      }
    });

    // Suggestion chips
    this.el.querySelectorAll('.dgrep-chat-suggestion-chip').forEach(btn => {
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

  private async handleSend(text?: string) {
    const input = this.el.querySelector('.dgrep-chat-input') as HTMLTextAreaElement;
    const message = text || input?.value.trim();
    if (!message || this.isStreaming) return;

    // Clear input
    if (input) {
      input.value = '';
      input.style.height = 'auto';
    }

    // Remove welcome
    const welcome = this.el.querySelector('.dgrep-chat-welcome');
    if (welcome) welcome.remove();

    // Add user bubble
    this.addMessageBubble({ id: '', role: 'user', content: message, timestamp: new Date().toISOString(), status: 'complete' });

    this.isStreaming = true;
    this.updateSendButton();

    if (!this.chatSessionId) {
      this.showError('No chat session. Please open the chat panel after running a search.');
      this.isStreaming = false;
      this.updateSendButton();
      return;
    }

    try {
      if (this.onSendMessage) {
        this.onSendMessage(this.chatSessionId, message);
      }
    } catch (error) {
      this.isStreaming = false;
      this.updateSendButton();
      this.showError(`Failed to send: ${error}`);
    }
  }

  private addMessageBubble(msg: DGrepChatMessage) {
    const messagesArea = this.el.querySelector('.dgrep-chat-messages') as HTMLElement;
    if (!messagesArea) return;

    const bubble = document.createElement('div');
    bubble.className = msg.role === 'user' ? 'dgrep-chat-msg-user' : 'dgrep-chat-msg-assistant';

    if (msg.role === 'user') {
      bubble.textContent = msg.content;
    } else {
      bubble.innerHTML = this.renderMarkdown(msg.content);
    }

    messagesArea.appendChild(bubble);
    this.messages.push(msg);
    this.scrollToBottom();
  }

  private showError(message: string) {
    const messagesArea = this.el.querySelector('.dgrep-chat-messages') as HTMLElement;
    if (!messagesArea) return;

    const bubble = document.createElement('div');
    bubble.className = 'dgrep-chat-msg-assistant error';
    bubble.textContent = message;
    messagesArea.appendChild(bubble);
    this.scrollToBottom();
  }

  private showToolStatus(text: string) {
    this.removeToolStatus();
    const messagesArea = this.el.querySelector('.dgrep-chat-messages') as HTMLElement;
    if (!messagesArea) return;

    const status = document.createElement('div');
    status.className = 'dgrep-chat-tool-status';
    status.innerHTML = `${iconHtml(Loader2, { size: 12, class: 'animate-spin' })} ${escapeHtml(text)}`;
    messagesArea.appendChild(status);
    this.scrollToBottom();
  }

  private removeToolStatus() {
    const status = this.el.querySelector('.dgrep-chat-tool-status');
    if (status) status.remove();
  }

  private updateSendButton() {
    const sendBtn = this.el.querySelector('.dgrep-chat-send-btn') as HTMLButtonElement;
    const input = this.el.querySelector('.dgrep-chat-input') as HTMLTextAreaElement;
    if (sendBtn) {
      sendBtn.disabled = this.isStreaming || !input?.value.trim();
    }
  }

  private scrollToBottom() {
    const messagesArea = this.el.querySelector('.dgrep-chat-messages') as HTMLElement;
    if (messagesArea) {
      messagesArea.scrollTop = messagesArea.scrollHeight;
    }
  }

  private renderMarkdown(text: string): string {
    let html = escapeHtml(text);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => `<pre><code>${code}</code></pre>`);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/^[\s]*[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    html = html.replace(/^[\s]*\d+\.\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/\n\n/g, '</p><p>');
    html = `<p>${html}</p>`;
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/(?<!>)\n(?!<)/g, '<br>');
    return html;
  }
}
