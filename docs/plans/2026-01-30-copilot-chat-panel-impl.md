# Copilot Chat Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a right-side panel to PR tabs with embedded terminal for interactive AI chat (Copilot/Claude) primed with PR context.

**Architecture:** New panel component (`CopilotChatPanel`) with xterm.js terminal, controlled by `ChatTerminalService` backend. Panel state tracked in `PRTabState`. Settings default stored in `ConsoleReviewSettings`.

**Tech Stack:** TypeScript, xterm.js, node-pty, Tauri IPC

---

## Task 1: Add Settings for Default Chat AI

**Files:**
- Modify: `src/shared/terminal-types.ts`
- Modify: `src/renderer/components/settings-view.ts`

**Step 1: Add defaultChatAI to ConsoleReviewSettings type**

In `src/shared/terminal-types.ts`, add the setting to the interface:

```typescript
// After line 60 (after worktreeCleanup)
export interface ConsoleReviewSettings {
  // ... existing fields ...
  worktreeCleanup: 'ask' | 'auto' | 'never';
  /** Default AI for chat panel: copilot or claude */
  defaultChatAI: 'copilot' | 'claude';
  generatedFilePatterns: string[];
  // ... rest of fields ...
}
```

**Step 2: Add default value**

In `src/shared/terminal-types.ts`, update DEFAULT_CONSOLE_REVIEW_SETTINGS:

```typescript
export const DEFAULT_CONSOLE_REVIEW_SETTINGS: ConsoleReviewSettings = {
  // ... existing defaults ...
  worktreeCleanup: 'auto',
  defaultChatAI: 'copilot',
  generatedFilePatterns: [],
  // ... rest ...
};
```

**Step 3: Add UI for defaultChatAI setting**

In `src/renderer/components/settings-view.ts`, add a new form group in the "AI Providers" section (after line 265, before the closing `</div>` of ai-provider-cards):

```typescript
              <div class="ai-provider-card">
                <div class="ai-provider-header">
                  <div class="ai-provider-title-group">
                    <span class="ai-provider-icon">${getIcon(MessageSquare, 16)}</span>
                    <span class="ai-provider-title">Chat Panel Default</span>
                  </div>
                </div>
                <div class="ai-provider-settings">
                  <div class="ai-provider-row">
                    <select id="defaultChatAI" class="ai-provider-select">
                      <option value="copilot">Copilot</option>
                      <option value="claude">Claude</option>
                    </select>
                  </div>
                </div>
              </div>
```

**Step 4: Wire up save/load for defaultChatAI**

In `settings-view.ts` `handleSaveAll()` (around line 386), add:

```typescript
      const defaultChatAI = (this.container.querySelector('#defaultChatAI') as HTMLSelectElement).value as 'copilot' | 'claude';

      this.consoleReviewSettings = {
        ...this.consoleReviewSettings,
        // ... existing fields ...
        defaultChatAI,
      };
```

In `updateConsoleReviewFormValues()` (around line 575), add:

```typescript
    const defaultChatAI = this.container.querySelector('#defaultChatAI') as HTMLSelectElement;
    if (defaultChatAI) defaultChatAI.value = this.consoleReviewSettings.defaultChatAI || 'copilot';
```

**Step 5: Commit**

```bash
git add src/shared/terminal-types.ts src/renderer/components/settings-view.ts
git commit -m "feat: add defaultChatAI setting for chat panel"
```

---

## Task 2: Add PRTabState Fields for Chat Panel

**Files:**
- Modify: `src/renderer/app.ts`

**Step 1: Add chat panel state fields to PRTabState**

In `src/renderer/app.ts`, find the `PRTabState` interface (around line 78) and add:

```typescript
interface PRTabState {
  // ... existing fields ...
  // Apply Changes state
  applyChangesPanelState?: ApplyChangesPanelState;
  // Chat Panel state
  copilotChatPanelOpen: boolean;
  copilotChatAI: 'copilot' | 'claude';
}
```

**Step 2: Initialize chat panel state when creating PR tab**

Find where PRTabState is initialized (search for `prContextKey: null`) and add default values:

```typescript
  copilotChatPanelOpen: false,
  copilotChatAI: 'copilot', // Will be overridden from settings
```

**Step 3: Commit**

```bash
git add src/renderer/app.ts
git commit -m "feat: add chat panel state to PRTabState"
```

---

## Task 3: Create ChatTerminalService Backend

**Files:**
- Create: `src/main/terminal/chat-terminal-service.ts`

**Step 1: Create the chat terminal service file**

```typescript
/**
 * Chat Terminal Service
 * Manages interactive terminal sessions for AI chat in PR panels.
 * Unlike review terminals, these are purely interactive (no completion file).
 */

import * as pty from '@lydell/node-pty';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getLogger } from '../services/logger-service.js';

const LOG_CATEGORY = 'ChatTerminal';

interface IPtyProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (exitInfo: { exitCode: number }) => void): void;
}

export interface ChatTerminalSession {
  id: string;
  ai: 'copilot' | 'claude';
  workingDir: string;
  contextPath: string;
  status: 'starting' | 'running' | 'completed' | 'error';
  createdAt: string;
  error?: string;
}

interface SessionInternal extends ChatTerminalSession {
  ptyProcess: IPtyProcess | null;
  startupTimeout: NodeJS.Timeout | null;
}

export interface CreateChatTerminalOptions {
  ai: 'copilot' | 'claude';
  workingDir: string;
  contextPath: string;
  initialPrompt: string;
}

export class ChatTerminalService extends EventEmitter {
  private sessions: Map<string, SessionInternal> = new Map();

  private getShell(): string {
    return process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
  }

  createSession(options: CreateChatTerminalOptions): string {
    const logger = getLogger();
    const id = uuidv4();

    logger.info(LOG_CATEGORY, 'Creating chat terminal session', {
      id,
      ai: options.ai,
      workingDir: options.workingDir,
    });

    const session: SessionInternal = {
      id,
      ai: options.ai,
      workingDir: options.workingDir,
      contextPath: options.contextPath,
      status: 'starting',
      createdAt: new Date().toISOString(),
      ptyProcess: null,
      startupTimeout: null,
    };

    this.sessions.set(id, session);

    // Emit session-created event
    const { ptyProcess: _, startupTimeout: __, ...publicSession } = session;
    this.emit('session-created', { session: publicSession });

    // Spawn PTY
    let ptyProcess: IPtyProcess;
    try {
      ptyProcess = pty.spawn(this.getShell(), [], {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: options.workingDir,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        },
      }) as IPtyProcess;
      session.ptyProcess = ptyProcess;
    } catch (error) {
      logger.error(LOG_CATEGORY, 'Failed to spawn shell', { error });
      session.status = 'error';
      session.error = `Failed to spawn shell: ${error}`;
      this.emit('status-change', { sessionId: id, status: 'error', error: session.error });
      return id;
    }

    // Forward PTY data
    ptyProcess.onData((data: string) => {
      this.emit('data', { sessionId: id, data });
    });

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      logger.info(LOG_CATEGORY, 'PTY process exited', { sessionId: id, exitCode });
      session.status = exitCode === 0 ? 'completed' : 'error';
      this.emit('exit', { sessionId: id, exitCode });
      this.emit('status-change', { sessionId: id, status: session.status });
    });

    // Launch CLI after shell initializes
    session.startupTimeout = setTimeout(() => {
      if (session.ptyProcess) {
        // Write the initial prompt to a file
        const promptFile = path.join(options.contextPath, 'chat-prompt.txt');
        try {
          fs.writeFileSync(promptFile, options.initialPrompt, 'utf-8');
        } catch (error) {
          logger.error(LOG_CATEGORY, 'Failed to write prompt file', { error });
          session.status = 'error';
          session.error = `Failed to write prompt file: ${error}`;
          this.emit('status-change', { sessionId: id, status: 'error', error: session.error });
          return;
        }

        // Build CLI command
        const cliCommand = options.ai === 'copilot' ? 'copilot' : 'claude';
        const cliArgs = options.ai === 'copilot'
          ? ['--allow-all', '--add-dir', options.contextPath, '-i']
          : ['--dangerously-skip-permissions'];

        const safeInstruction = `Follow the instructions in: ${promptFile}`;
        const argsStr = cliArgs.join(' ');

        logger.info(LOG_CATEGORY, 'Launching CLI', { cliCommand, argsStr });
        session.ptyProcess.write(`${cliCommand} ${argsStr} "${safeInstruction.replace(/"/g, '\\"')}"\r`);
        session.status = 'running';
        this.emit('status-change', { sessionId: id, status: 'running' });
      }
    }, 500);

    return id;
  }

  getSession(id: string): ChatTerminalSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;

    const { ptyProcess, startupTimeout, ...publicSession } = session;
    return publicSession;
  }

  writeToSession(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (session?.ptyProcess) {
      session.ptyProcess.write(data);
    }
  }

  resizeSession(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (session?.ptyProcess) {
      session.ptyProcess.resize(cols, rows);
    }
  }

  killSession(id: string): void {
    const logger = getLogger();
    const session = this.sessions.get(id);
    if (session) {
      logger.info(LOG_CATEGORY, 'Killing chat terminal session', { id });

      if (session.startupTimeout) {
        clearTimeout(session.startupTimeout);
        session.startupTimeout = null;
      }
      if (session.ptyProcess) {
        session.ptyProcess.kill();
      }
      session.status = 'completed';
      this.emit('status-change', { sessionId: id, status: 'completed' });
    }
  }

  removeSession(id: string): void {
    this.killSession(id);
    this.sessions.delete(id);
  }

  dispose(): void {
    for (const [id] of this.sessions) {
      this.killSession(id);
    }
    this.sessions.clear();
  }
}

// Singleton
let chatTerminalService: ChatTerminalService | null = null;

export function getChatTerminalService(): ChatTerminalService {
  if (!chatTerminalService) {
    chatTerminalService = new ChatTerminalService();
  }
  return chatTerminalService;
}

export function disposeChatTerminalService(): void {
  if (chatTerminalService) {
    chatTerminalService.dispose();
    chatTerminalService = null;
  }
}
```

**Step 2: Commit**

```bash
git add src/main/terminal/chat-terminal-service.ts
git commit -m "feat: add ChatTerminalService for interactive AI chat"
```

---

## Task 4: Add IPC Handlers for Chat Terminal

**Files:**
- Modify: Main process IPC handlers file (find where `terminalWrite`, `terminalResize` are registered)
- Modify: `src/renderer/tauri-api.ts` (or equivalent API bridge)

**Step 1: Find and modify IPC registration**

Search for existing terminal IPC handlers (`terminalWrite`, `terminalResize`, `terminalKill`) and add parallel handlers for chat terminal:

```typescript
// Chat Terminal IPC handlers
ipcMain.handle('chatTerminalCreate', async (_, options: CreateChatTerminalOptions) => {
  const service = getChatTerminalService();
  return service.createSession(options);
});

ipcMain.handle('chatTerminalWrite', async (_, sessionId: string, data: string) => {
  const service = getChatTerminalService();
  service.writeToSession(sessionId, data);
});

ipcMain.handle('chatTerminalResize', async (_, sessionId: string, cols: number, rows: number) => {
  const service = getChatTerminalService();
  service.resizeSession(sessionId, cols, rows);
});

ipcMain.handle('chatTerminalKill', async (_, sessionId: string) => {
  const service = getChatTerminalService();
  service.killSession(sessionId);
});

// Forward chat terminal events to renderer
const chatService = getChatTerminalService();
chatService.on('data', ({ sessionId, data }) => {
  mainWindow?.webContents.send('chatTerminalData', sessionId, data);
});
chatService.on('status-change', ({ sessionId, status, error }) => {
  mainWindow?.webContents.send('chatTerminalStatusChange', sessionId, status, error);
});
```

**Step 2: Add to renderer API bridge**

In `src/renderer/tauri-api.ts`, add the chat terminal methods to `window.electronAPI`:

```typescript
  chatTerminalCreate: (options: { ai: 'copilot' | 'claude'; workingDir: string; contextPath: string; initialPrompt: string }) =>
    ipcRenderer.invoke('chatTerminalCreate', options),
  chatTerminalWrite: (sessionId: string, data: string) =>
    ipcRenderer.invoke('chatTerminalWrite', sessionId, data),
  chatTerminalResize: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('chatTerminalResize', sessionId, cols, rows),
  chatTerminalKill: (sessionId: string) =>
    ipcRenderer.invoke('chatTerminalKill', sessionId),
  onChatTerminalData: (callback: (sessionId: string, data: string) => void) => {
    ipcRenderer.on('chatTerminalData', (_, sessionId, data) => callback(sessionId, data));
  },
  onChatTerminalStatusChange: (callback: (sessionId: string, status: string, error?: string) => void) => {
    ipcRenderer.on('chatTerminalStatusChange', (_, sessionId, status, error) => callback(sessionId, status, error));
  },
```

**Step 3: Add types to api.d.ts if needed**

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add IPC handlers for chat terminal"
```

---

## Task 5: Create CopilotChatPanel Component

**Files:**
- Create: `src/renderer/components/copilot-chat-panel.ts`

**Step 1: Create the panel component**

```typescript
/**
 * Copilot Chat Panel
 * Right-side panel with embedded terminal for interactive AI chat.
 */

import { escapeHtml } from '../utils/html-utils.js';
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

  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'copilot-chat-panel';
    this.container.style.display = 'none';
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

  open(sessionId: string): void {
    this.sessionId = sessionId;
    this.isOpen = true;
    this.container.style.display = 'flex';
    this.render();
    this.initTerminal();
  }

  close(): void {
    this.isOpen = false;
    this.container.style.display = 'none';
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

      // Window resize
      window.addEventListener('resize', () => {
        this.fit();
      });

    } catch (error) {
      console.error('[CopilotChatPanel] Failed to create terminal:', error);
    }
  }

  private disposeTerminal(): void {
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
```

**Step 2: Commit**

```bash
git add src/renderer/components/copilot-chat-panel.ts
git commit -m "feat: add CopilotChatPanel component"
```

---

## Task 6: Add CSS Styles for Chat Panel

**Files:**
- Modify: Main CSS file (find where `.ai-comments-panel` styles are)

**Step 1: Add chat panel styles**

```css
/* Copilot Chat Panel */
.copilot-chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
  border-left: 1px solid var(--border-color);
}

.copilot-chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.copilot-chat-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  font-size: 14px;
}

.copilot-chat-actions {
  display: flex;
  gap: 4px;
}

.copilot-chat-terminal {
  flex: 1;
  overflow: hidden;
  padding: 4px;
}

.copilot-chat-terminal .terminal-inner {
  height: 100%;
}

.copilot-chat-status {
  padding: 4px 12px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
  font-size: 12px;
}

.copilot-chat-status .status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
}

.copilot-chat-status .status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-success);
}

.copilot-chat-status .status-indicator.running .status-dot {
  background: var(--color-success);
}

.copilot-chat-status .status-indicator.error .status-dot {
  background: var(--color-error);
}
```

**Step 2: Commit**

```bash
git add -A
git commit -m "style: add CSS for Copilot Chat panel"
```

---

## Task 7: Integrate Chat Panel into PR Tab

**Files:**
- Modify: `src/renderer/app.ts`

**Step 1: Import CopilotChatPanel**

Add import at top of file (around line 35):

```typescript
import { CopilotChatPanel } from './components/copilot-chat-panel.js';
```

**Step 2: Add chat panel instance**

In the class properties section (around line 145):

```typescript
  private copilotChatPanel: CopilotChatPanel;
```

**Step 3: Initialize in constructor**

In constructor (around line 178):

```typescript
    this.copilotChatPanel = new CopilotChatPanel();
```

**Step 4: Add chat panel button to PR tab toolbar**

Find where the AI Review button is rendered in the PR tab and add chat button next to it. Search for `ai-review-btn` or similar and add:

```typescript
<button class="btn btn-icon copilot-chat-btn" title="Copilot Chat">
  ${iconHtml(MessageSquare, { size: 18 })}
</button>
```

**Step 5: Add event listener for chat button**

In the event listener setup for PR tab:

```typescript
    // Copilot Chat button
    container.querySelector('.copilot-chat-btn')?.addEventListener('click', () => {
      this.toggleCopilotChatPanel();
    });
```

**Step 6: Add toggleCopilotChatPanel method**

```typescript
  private async toggleCopilotChatPanel(): Promise<void> {
    const prState = this.getCurrentPRTabState();
    if (!prState) return;

    if (this.copilotChatPanel.isVisible()) {
      // Close panel
      this.closeCopilotChatPanel();
    } else {
      // Open panel
      await this.openCopilotChatPanel();
    }
  }

  private async openCopilotChatPanel(): Promise<void> {
    const prState = this.getCurrentPRTabState();
    if (!prState) return;

    // Get default AI from settings
    const settings = await window.electronAPI.getConsoleReviewSettings();
    const ai = settings.defaultChatAI || 'copilot';
    prState.copilotChatAI = ai;
    prState.copilotChatPanelOpen = true;

    // Determine working directory (worktree or context path)
    let workingDir = prState.prContextKey
      ? await window.electronAPI.getPRContextPath(prState.prContextKey)
      : null;

    // TODO: Check for worktree, similar to AI review
    if (!workingDir) {
      Toast.error('No PR context available. Please reload the PR.');
      return;
    }

    // Build initial prompt
    const initialPrompt = `You are reviewing PR #${prState.prId}: "${prState.pullRequest?.title || 'PR'}".
Context files are available in ./context/ directory.
The user wants to discuss this PR with you.`;

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

    // Set up panel callbacks
    this.copilotChatPanel.onClose(() => this.closeCopilotChatPanel());
    this.copilotChatPanel.onSwitchAI((newAI) => this.switchChatAI(newAI));
  }

  private closeCopilotChatPanel(): void {
    const prState = this.getCurrentPRTabState();
    if (prState) {
      prState.copilotChatPanelOpen = false;
    }

    // Kill terminal session
    // Note: Need to track sessionId somewhere accessible
    this.copilotChatPanel.close();
    this.removeChatPanelFromLayout();
  }

  private async switchChatAI(newAI: 'copilot' | 'claude'): Promise<void> {
    // Close current session
    this.closeCopilotChatPanel();

    // Update state
    const prState = this.getCurrentPRTabState();
    if (prState) {
      prState.copilotChatAI = newAI;
    }

    // Reopen with new AI
    await this.openCopilotChatPanel();
  }

  private addChatPanelToLayout(): void {
    // Find the review screen container and add panel
    const reviewScreen = document.getElementById('reviewScreen');
    if (reviewScreen) {
      reviewScreen.classList.add('chat-panel-open');
      const panelContainer = reviewScreen.querySelector('.chat-panel-container');
      if (!panelContainer) {
        const container = document.createElement('div');
        container.className = 'chat-panel-container';
        container.appendChild(this.copilotChatPanel.getElement());
        reviewScreen.appendChild(container);
      }
    }
  }

  private removeChatPanelFromLayout(): void {
    const reviewScreen = document.getElementById('reviewScreen');
    if (reviewScreen) {
      reviewScreen.classList.remove('chat-panel-open');
    }
  }
```

**Step 7: Add chat terminal data listener**

In `initTerminalListeners()` or similar initialization:

```typescript
    // Chat terminal data listener
    window.electronAPI.onChatTerminalData((sessionId, data) => {
      this.copilotChatPanel.writeToTerminal(data);
    });
```

**Step 8: Handle tab switching - close chat panel**

In the tab switching logic, add:

```typescript
    // Close chat panel when switching tabs
    if (this.copilotChatPanel.isVisible()) {
      this.closeCopilotChatPanel();
    }
```

**Step 9: Commit**

```bash
git add src/renderer/app.ts
git commit -m "feat: integrate Copilot Chat panel into PR tab"
```

---

## Task 8: Add Layout CSS for Chat Panel Container

**Files:**
- Modify: Main CSS file

**Step 1: Add layout styles for chat panel integration**

```css
/* Review screen with chat panel */
#reviewScreen.chat-panel-open {
  display: grid;
  grid-template-columns: 1fr 400px;
}

#reviewScreen.chat-panel-open.ai-comments-open {
  grid-template-columns: 1fr 400px 350px;
}

.chat-panel-container {
  height: 100%;
  overflow: hidden;
}

/* Ensure proper sizing */
#reviewScreen .review-content {
  overflow: hidden;
}
```

**Step 2: Commit**

```bash
git add -A
git commit -m "style: add layout CSS for chat panel container"
```

---

## Task 9: Test and Fix Integration

**Step 1: Build the project**

```bash
npm run build
```

**Step 2: Test manually**

1. Open a PR tab
2. Click the Copilot Chat button
3. Verify panel opens on right side
4. Verify terminal connects and shows AI prompt
5. Type a message and verify response
6. Click switch AI button, verify session restarts with new AI
7. Close panel, verify cleanup
8. Switch tabs, verify panel closes

**Step 3: Fix any issues found**

**Step 4: Final commit**

```bash
git add -A
git commit -m "fix: resolve integration issues in Copilot Chat panel"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add defaultChatAI setting | terminal-types.ts, settings-view.ts |
| 2 | Add PRTabState fields | app.ts |
| 3 | Create ChatTerminalService | chat-terminal-service.ts (new) |
| 4 | Add IPC handlers | IPC files, tauri-api.ts |
| 5 | Create CopilotChatPanel | copilot-chat-panel.ts (new) |
| 6 | Add panel CSS | CSS file |
| 7 | Integrate into PR tab | app.ts |
| 8 | Add layout CSS | CSS file |
| 9 | Test and fix | Various |

---

**Plan complete and saved to `docs/plans/2026-01-30-copilot-chat-panel-impl.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session in worktree with executing-plans, batch execution with checkpoints

**Which approach?**
