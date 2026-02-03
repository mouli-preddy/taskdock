/**
 * Copilot Chat Panel
 * Right-side panel with embedded terminal for interactive AI chat.
 */

import { iconHtml, X, RefreshCw, Bot } from '../utils/icons.js';

declare const Terminal: any;
declare const FitAddon: any;

export class CopilotChatPanel {
  private container: HTMLElement;
  private terminal: any = null;
  private fitAddon: any = null;
  private sessionId: string | null = null;
  private currentAI: 'copilot' | 'claude' = 'copilot';
  private isOpen = false;

  private closeCallback?: () => void;
  private switchAICallback?: (ai: 'copilot' | 'claude') => void;
  private resizeHandler?: () => void;

  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'copilot-chat-panel';
    // CSS handles visibility via .review-screen.chat-panel-open class
  }

  getElement(): HTMLElement {
    return this.container;
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  onSwitchAI(callback: (ai: 'copilot' | 'claude') => void): void {
    this.switchAICallback = callback;
  }

  setAI(ai: 'copilot' | 'claude'): void {
    this.currentAI = ai;
    this.updateHeader();
  }

  getAI(): 'copilot' | 'claude' {
    return this.currentAI;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  open(sessionId: string): void {
    this.sessionId = sessionId;
    this.isOpen = true;
    // CSS handles visibility via .review-screen.chat-panel-open class
    this.render();
    this.initTerminal();
  }

  close(): void {
    this.isOpen = false;
    // CSS handles visibility via .review-screen.chat-panel-open class
    this.disposeTerminal();
    this.sessionId = null;
  }

  isVisible(): boolean {
    return this.isOpen;
  }

  writeToTerminal(data: string): void {
    if (this.terminal) {
      this.terminal.write(data);
    }
  }

  fit(): void {
    if (this.fitAddon && this.isOpen) {
      this.fitAddon.fit();
    }
  }

  getTerminalDimensions(): { cols: number; rows: number } | null {
    if (this.terminal) {
      return { cols: this.terminal.cols, rows: this.terminal.rows };
    }
    return null;
  }

  private render(): void {
    const aiLabel = this.currentAI === 'copilot' ? 'Copilot' : 'Claude';
    const otherAI = this.currentAI === 'copilot' ? 'Claude' : 'Copilot';

    this.container.innerHTML = `
      <div class="copilot-chat-header">
        <div class="copilot-chat-title">
          ${iconHtml(Bot, { size: 18 })}
          <span>${aiLabel} Chat</span>
        </div>
        <div class="copilot-chat-actions">
          <button class="btn btn-icon switch-ai-btn" title="Switch to ${otherAI}">
            ${iconHtml(RefreshCw, { size: 16 })}
          </button>
          <button class="btn btn-icon close-chat-btn" title="Close">
            ${iconHtml(X, { size: 18 })}
          </button>
        </div>
      </div>
      <div class="copilot-chat-terminal">
        <div id="copilot-chat-terminal-inner" class="terminal-inner"></div>
      </div>
      <div class="copilot-chat-status">
        <span class="status-indicator running">
          <span class="status-dot"></span>
          <span class="status-text">Connected</span>
        </span>
      </div>
    `;

    this.attachEventListeners();
  }

  private updateHeader(): void {
    const titleSpan = this.container.querySelector('.copilot-chat-title span');
    const switchBtn = this.container.querySelector('.switch-ai-btn');
    if (titleSpan) {
      const aiLabel = this.currentAI === 'copilot' ? 'Copilot' : 'Claude';
      titleSpan.textContent = `${aiLabel} Chat`;
    }
    if (switchBtn) {
      const otherAI = this.currentAI === 'copilot' ? 'Claude' : 'Copilot';
      switchBtn.setAttribute('title', `Switch to ${otherAI}`);
    }
  }

  private attachEventListeners(): void {
    this.container.querySelector('.close-chat-btn')?.addEventListener('click', () => {
      this.closeCallback?.();
    });

    this.container.querySelector('.switch-ai-btn')?.addEventListener('click', () => {
      const newAI = this.currentAI === 'copilot' ? 'claude' : 'copilot';
      this.switchAICallback?.(newAI);
    });
  }

  private initTerminal(): void {
    const container = this.container.querySelector('#copilot-chat-terminal-inner');
    if (!container) return;

    // Check if xterm is available
    if (typeof Terminal === 'undefined' || typeof FitAddon === 'undefined') {
      console.error('[CopilotChatPanel] xterm.js not loaded');
      return;
    }

    // Wait for container to have dimensions
    if (container.clientWidth === 0 || container.clientHeight === 0) {
      requestAnimationFrame(() => this.initTerminal());
      return;
    }

    try {
      this.terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: 14,
        fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, monospace',
        theme: {
          background: '#1e1e1e',
          foreground: '#cccccc',
          cursor: '#ffffff',
          cursorAccent: '#1e1e1e',
          selection: 'rgba(255, 255, 255, 0.3)',
          black: '#1e1e1e',
          red: '#f14c4c',
          green: '#23d18b',
          yellow: '#dcdcaa',
          blue: '#3794ff',
          magenta: '#bc89bd',
          cyan: '#29b8db',
          white: '#cccccc',
          brightBlack: '#666666',
          brightRed: '#f14c4c',
          brightGreen: '#23d18b',
          brightYellow: '#dcdcaa',
          brightBlue: '#3794ff',
          brightMagenta: '#bc89bd',
          brightCyan: '#29b8db',
          brightWhite: '#ffffff',
        },
        allowProposedApi: true,
      });

      this.fitAddon = new FitAddon.FitAddon();
      this.terminal.loadAddon(this.fitAddon);
      this.terminal.open(container);
      this.fitAddon.fit();

      // Send initial resize
      if (this.sessionId) {
        const { cols, rows } = this.terminal;
        window.electronAPI.chatTerminalResize(this.sessionId, cols, rows);
      }

      // Handle input
      this.terminal.onData((data: string) => {
        if (this.sessionId) {
          window.electronAPI.chatTerminalWrite(this.sessionId, data);
        }
      });

      // Handle resize
      this.terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        if (this.sessionId) {
          window.electronAPI.chatTerminalResize(this.sessionId, cols, rows);
        }
      });

      // Clipboard handling
      this.terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
          const text = window.electronAPI.readClipboard();
          if (text && this.sessionId) {
            window.electronAPI.chatTerminalWrite(this.sessionId, text);
          }
          return false;
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
          const selection = this.terminal.getSelection();
          if (selection) {
            window.electronAPI.writeClipboard(selection);
            return false;
          }
        }
        return true;
      });

      // Window resize - store handler for cleanup
      this.resizeHandler = () => this.fit();
      window.addEventListener('resize', this.resizeHandler);

    } catch (error) {
      console.error('[CopilotChatPanel] Failed to create terminal:', error);
    }
  }

  private disposeTerminal(): void {
    // Clean up window resize listener
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = undefined;
    }

    if (this.terminal) {
      try {
        this.terminal.dispose();
      } catch (e) {
        // Ignore disposal errors
      }
      this.terminal = null;
      this.fitAddon = null;
    }
  }
}
