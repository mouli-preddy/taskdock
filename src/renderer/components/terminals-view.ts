import type { TerminalSession } from '../../shared/terminal-types.js';
import { escapeHtml } from '../utils/html-utils.js';
import { getIcon, Square, X, Terminal as TerminalIcon } from '../utils/icons.js';

declare const Terminal: any;
declare const FitAddon: any;

export class TerminalsView {
  private container: HTMLElement;
  private sessions: TerminalSession[] = [];
  private activeSessionId: string | null = null;
  private terminals: Map<string, any> = new Map();
  private fitAddons: Map<string, any> = new Map();
  private chatSessionIds: Set<string> = new Set(); // Track chat terminal sessions
  private dataBuffers: Map<string, string[]> = new Map(); // Buffer output per session for replay after re-renders
  private pendingRafs: Map<string, number> = new Map(); // Cancel stale deferred inits

  private selectCallback?: (sessionId: string) => void;
  private closeCallback?: (sessionId: string, isChat: boolean) => void;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.render();
  }

  getTerminalCount(): number { return this.terminals.size; }

  onSelect(callback: (sessionId: string) => void): void {
    this.selectCallback = callback;
  }

  onClose(callback: (sessionId: string, isChat: boolean) => void): void {
    this.closeCallback = callback;
  }

  setSessions(sessions: TerminalSession[]): void {
    this.sessions = sessions;
    this.render();
  }

  setActiveSession(sessionId: string | null): void {
    if (this.activeSessionId !== sessionId) {
      this.activeSessionId = sessionId;
      this.render(); // Re-render to show the new session's terminal
    }
  }

  refresh(): void {
    // If the active session already has a live terminal, skip full re-render.
    // Re-rendering would destroy the working xterm instance; a duplicate event
    // (e.g. two WS clients) would then trigger a second open() on the same container
    // which causes an xterm internal crash (stale setTimeout from the first open fires
    // after dispose and reads a null _renderService).
    if (this.activeSessionId && this.terminals.has(this.activeSessionId)) {
      const activeId = this.activeSessionId;
      setTimeout(() => {
        const fitAddon = this.fitAddons.get(activeId);
        const container = document.getElementById(`terminal-${activeId}`);
        if (fitAddon) {
          fitAddon.fit();
          const terminal = this.terminals.get(activeId);
          if (terminal) {
            const { cols, rows } = terminal;
            if (this.chatSessionIds.has(activeId)) {
              window.electronAPI.chatTerminalResize(activeId, cols, rows);
            } else {
              window.electronAPI.terminalResize(activeId, cols, rows);
            }
          }
        }
      }, 0);
      return;
    }
    this.render();
    // After render, refit any active terminal (fixes visibility after section switch)
    if (this.activeSessionId) {
      const activeId = this.activeSessionId;
      // Use setTimeout to ensure DOM is ready after section becomes visible
      setTimeout(() => {
        const fitAddon = this.fitAddons.get(activeId);
        if (fitAddon) {
          fitAddon.fit();
          // Also send resize to PTY to sync dimensions
          const terminal = this.terminals.get(activeId);
          if (terminal) {
            const { cols, rows } = terminal;
            if (this.chatSessionIds.has(activeId)) {
              window.electronAPI.chatTerminalResize(activeId, cols, rows);
            } else {
              window.electronAPI.terminalResize(activeId, cols, rows);
            }
          }
        }
      }, 0);
    }
  }

  addSession(session: TerminalSession, isChat = false): void {
    if (this.sessions.some(s => s.id === session.id)) return; // already present, skip
    this.sessions.push(session);
    if (isChat) this.chatSessionIds.add(session.id);
    this.activeSessionId = session.id; // Set before render so container is created
    this.render();
  }

  updateSession(sessionId: string, updates: Partial<TerminalSession>): void {
    const session = this.sessions.find(s => s.id === sessionId);
    if (session) {
      Object.assign(session, updates);
      // Targeted DOM update — avoid full re-render which destroys the live xterm instance
      this.patchSessionDOM(sessionId);
    }
  }

  private patchSessionDOM(sessionId: string): void {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return;

    // Update sidebar item class (status dot color)
    const item = this.container.querySelector(`.terminal-item[data-id="${sessionId}"]`) as HTMLElement | null;
    if (item) {
      item.className = `terminal-item ${sessionId === this.activeSessionId ? 'active' : ''} ${session.status}`;
      const label = item.querySelector('.terminal-label');
      if (label) label.textContent = session.label;
    }

    // Update status bar and toolbar title if this is the active session
    if (sessionId === this.activeSessionId) {
      const indicator = this.container.querySelector('.status-indicator');
      if (indicator) {
        indicator.className = `status-indicator ${session.status}`;
        const text = indicator.querySelector('.status-text');
        if (text) text.textContent = this.getStatusText(session.status);
      }
      const title = this.container.querySelector('.terminal-title');
      if (title) title.textContent = session.label;
    }
  }

  removeSession(sessionId: string): void {
    // Cancel any pending deferred init for this session
    const pendingRaf = this.pendingRafs.get(sessionId);
    if (pendingRaf !== undefined) {
      cancelAnimationFrame(pendingRaf);
      this.pendingRafs.delete(sessionId);
    }
    this.sessions = this.sessions.filter(s => s.id !== sessionId);
    this.terminals.delete(sessionId);
    this.fitAddons.delete(sessionId);
    this.chatSessionIds.delete(sessionId);
    this.dataBuffers.delete(sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = this.sessions[0]?.id || null;
    }
    this.render();
  }

  writeToTerminal(sessionId: string, data: string): void {
    // Buffer data so it can be replayed if the xterm instance is recreated
    if (!this.dataBuffers.has(sessionId)) {
      this.dataBuffers.set(sessionId, []);
    }
    this.dataBuffers.get(sessionId)!.push(data);

    const terminal = this.terminals.get(sessionId);
    if (terminal) {
      terminal.write(data);
    }
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="terminals-view">
        <div class="terminals-sidebar">
          <div class="terminals-header">
            <span>Terminals</span>
            <span class="terminal-count">${this.sessions.length}</span>
          </div>
          <div class="terminals-list">
            ${this.sessions.length === 0 ? `
              <div class="terminals-empty">
                <p>No active terminals</p>
                <p class="hint">Start a Deep Review to open a terminal</p>
              </div>
            ` : this.sessions.map(s => this.renderSessionItem(s)).join('')}
          </div>
        </div>
        <div class="terminal-panel">
          ${this.activeSessionId ? `
            <div class="terminal-toolbar">
              <span class="terminal-title">${this.getActiveSession()?.label || ''}</span>
              <div class="terminal-actions">
                <button class="btn btn-icon kill-btn" title="Stop">
                  ${getIcon(Square, 16)}
                </button>
                <button class="btn btn-icon close-btn" title="Close">
                  ${getIcon(X, 16)}
                </button>
              </div>
            </div>
            <div class="terminal-container">
              <div id="terminal-${this.activeSessionId}" class="terminal-inner"></div>
            </div>
            <div class="terminal-status-bar">
              <span class="status-indicator ${this.getActiveSession()?.status || ''}">
                <span class="status-dot"></span>
                <span class="status-text">${this.getStatusText(this.getActiveSession()?.status)}</span>
              </span>
            </div>
          ` : `
            <div class="terminal-placeholder">
              ${getIcon(TerminalIcon, 48)}
              <p>Select a terminal or start a Deep Review</p>
            </div>
          `}
        </div>
      </div>
    `;

    this.attachEventListeners();

    if (this.activeSessionId) {
      this.initTerminal(this.activeSessionId);
    }
  }

  private renderSessionItem(session: TerminalSession): string {
    const isActive = session.id === this.activeSessionId;
    return `
      <div class="terminal-item ${isActive ? 'active' : ''} ${session.status}" data-id="${session.id}">
        <span class="terminal-status-dot"></span>
        <span class="terminal-label">${escapeHtml(session.label)}</span>
        <button class="terminal-close-btn" data-id="${session.id}" title="Close">
          ${getIcon(X, 12)}
        </button>
      </div>
    `;
  }

  private getActiveSession(): TerminalSession | undefined {
    return this.sessions.find(s => s.id === this.activeSessionId);
  }

  private getStatusText(status?: string): string {
    switch (status) {
      case 'starting': return 'Starting...';
      case 'running': return 'Running';
      case 'completed': return 'Completed';
      case 'error': return 'Error';
      default: return 'Unknown';
    }
  }

  private initTerminal(sessionId: string): void {
    // Cancel any stale deferred init — this call supersedes it
    const pendingRaf = this.pendingRafs.get(sessionId);
    if (pendingRaf !== undefined) {
      cancelAnimationFrame(pendingRaf);
      this.pendingRafs.delete(sessionId);
    }

    const container = document.getElementById(`terminal-${sessionId}`);
    if (!container) {
      return;
    }

    // Dispose and recreate terminal since DOM was replaced on re-render
    if (this.terminals.has(sessionId)) {
      const oldTerminal = this.terminals.get(sessionId);
      try {
        oldTerminal.dispose();
      } catch (e) {
        // Ignore disposal errors
      }
      this.terminals.delete(sessionId);
      this.fitAddons.delete(sessionId);
    }

    // If container has zero dimensions, defer — but only one rAF per session at a time
    if (container.offsetWidth === 0 || container.offsetHeight === 0) {
      const rafId = requestAnimationFrame(() => {
        this.pendingRafs.delete(sessionId);
        this.initTerminal(sessionId);
      });
      this.pendingRafs.set(sessionId, rafId);
      return;
    }

    // Check if xterm is available (globals from script tags)
    if (typeof Terminal === 'undefined' || typeof FitAddon === 'undefined') {
      return;
    }

    try {
      // Create new terminal (following electron-terminal sample pattern)
      const terminal = new Terminal({
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

      const fitAddon = new FitAddon.FitAddon();
      terminal.loadAddon(fitAddon);

      terminal.open(container);

      // Register the terminal immediately so data can be written even if fit() is delayed
      this.terminals.set(sessionId, terminal);
      this.fitAddons.set(sessionId, fitAddon);

      // Fit — may be a no-op if font metrics aren't ready yet; retry via setTimeout
      fitAddon.fit();
      if (terminal.cols <= 2 || terminal.rows <= 1) {
        setTimeout(() => { fitAddon.fit(); }, 100);
      }

      // Replay any buffered data that arrived before/during re-renders
      const buffered = this.dataBuffers.get(sessionId);
      if (buffered && buffered.length > 0) {
        terminal.write(buffered.join(''));
      }

      // Send initial resize to PTY
      const { cols, rows } = terminal;
      const isChat = this.chatSessionIds.has(sessionId);
      if (isChat) {
        window.electronAPI.chatTerminalResize(sessionId, cols, rows);
      } else {
        window.electronAPI.terminalResize(sessionId, cols, rows);
      }

      // Handle input
      terminal.onData((data: string) => {
        if (isChat) {
          window.electronAPI.chatTerminalWrite(sessionId, data);
        } else {
          window.electronAPI.terminalWrite(sessionId, data);
        }
      });

      // Handle resize
      terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        if (isChat) {
          window.electronAPI.chatTerminalResize(sessionId, cols, rows);
        } else {
          window.electronAPI.terminalResize(sessionId, cols, rows);
        }
      });

      // Custom key handler for clipboard operations (following electron-terminal sample)
      terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        // Handle paste: Ctrl+V (Windows/Linux) or Cmd+V (macOS)
        if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
          this.handlePaste(sessionId);
          return false; // Prevent default xterm handling
        }
        // Handle copy: Ctrl+C with selection or Cmd+C (macOS)
        if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
          const selection = terminal.getSelection();
          if (selection) {
            window.electronAPI.writeClipboard(selection);
            return false; // Prevent default xterm handling
          }
          // If no selection, let Ctrl+C pass through as SIGINT
        }
        return true; // Let xterm handle other keys
      });

      // Right-click context menu paste (following electron-terminal sample)
      container.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        this.handlePaste(sessionId);
      });

      // Window resize
      window.addEventListener('resize', () => {
        fitAddon.fit();
      });
    } catch (error) {
      console.error('[TerminalsView] initTerminal failed for', sessionId, error);
    }
  }

  private handlePaste(sessionId: string): void {
    const text = window.electronAPI.readClipboard();
    if (text) {
      if (this.chatSessionIds.has(sessionId)) {
        window.electronAPI.chatTerminalWrite(sessionId, text);
      } else {
        window.electronAPI.terminalWrite(sessionId, text);
      }
    }
  }

  private showTerminal(sessionId: string): void {
    // Hide all, show active
    this.terminals.forEach((terminal, id) => {
      const container = document.getElementById(`terminal-${id}`);
      if (container) {
        container.style.display = id === sessionId ? 'block' : 'none';
      }
    });
  }

  private updateActiveState(): void {
    this.container.querySelectorAll('.terminal-item').forEach(item => {
      const id = (item as HTMLElement).dataset.id;
      item.classList.toggle('active', id === this.activeSessionId);
    });
  }

  private attachEventListeners(): void {
    // Session item click
    this.container.querySelectorAll('.terminal-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.terminal-close-btn')) return;
        const id = (item as HTMLElement).dataset.id;
        if (id) {
          this.setActiveSession(id);
          this.selectCallback?.(id);
        }
      });
    });

    // Close buttons in list
    this.container.querySelectorAll('.terminal-close-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id;
        if (id) {
          this.closeCallback?.(id, this.chatSessionIds.has(id));
        }
      });
    });

    // Toolbar buttons
    this.container.querySelector('.kill-btn')?.addEventListener('click', () => {
      if (this.activeSessionId) {
        if (this.chatSessionIds.has(this.activeSessionId)) {
          window.electronAPI.chatTerminalKill(this.activeSessionId);
        } else {
          window.electronAPI.terminalKill(this.activeSessionId);
        }
      }
    });

    this.container.querySelector('.close-btn')?.addEventListener('click', () => {
      if (this.activeSessionId) {
        this.closeCallback?.(this.activeSessionId, this.chatSessionIds.has(this.activeSessionId));
      }
    });
  }

}
