import * as pty from '@lydell/node-pty';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { TerminalSession, CreateTerminalOptions } from '../../shared/terminal-types.js';

interface IPtyProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (exitInfo: { exitCode: number }) => void): void;
}

interface SessionInternal extends TerminalSession {
  ptyProcess: IPtyProcess | null;
  completionWatcher: fs.FSWatcher | null;
  startupTimeout: NodeJS.Timeout | null;
  completionGuid: string; // The guid to watch for in the done.json filename
  cliCommand: string; // The CLI command to run
  cliArgs: string[]; // Additional CLI arguments
}

export class TerminalManager extends EventEmitter {
  private sessions: Map<string, SessionInternal> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  getShell(): string {
    return process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
  }

  createSession(options: CreateTerminalOptions): string {
    const id = uuidv4();
    // Use the completionGuid from options if provided, otherwise fall back to session id
    const completionGuid = options.completionGuid || id;
    // Default to 'claude' CLI with --dangerously-skip-permissions
    const cliCommand = options.cliCommand || 'claude';
    const cliArgs = options.cliArgs || ['--dangerously-skip-permissions'];
    const session: SessionInternal = {
      id,
      label: options.label,
      status: 'starting',
      prId: options.prId,
      organization: options.organization,
      project: options.project,
      workingDir: options.workingDir,
      contextPath: options.contextPath,
      createdAt: new Date().toISOString(),
      ptyProcess: null,
      completionWatcher: null,
      startupTimeout: null,
      completionGuid,
      worktreeCreated: options.worktreeCreated,
      mainRepoPath: options.mainRepoPath,
      cliCommand,
      cliArgs,
    };

    this.sessions.set(id, session);

    // Emit session-created event with public session data (without internal fields)
    const { ptyProcess: _, completionWatcher: __, startupTimeout: ___, ...publicSession } = session;
    console.log('[TerminalManager] Emitting session-created event:', publicSession.id, publicSession.label);
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
      session.status = exitCode === 0 ? 'completed' : 'error';
      session.completedAt = new Date().toISOString();
      this.emit('exit', { sessionId: id, exitCode });
      this.emit('status-change', { sessionId: id, status: session.status });
    });

    // Start completion file watcher using the completionGuid
    this.startCompletionWatcher(id, options.outputPath, completionGuid);

    // Launch CLI after shell initializes
    session.startupTimeout = setTimeout(() => {
      if (session.ptyProcess) {
        // Write prompt to a file to avoid command injection vulnerabilities
        const promptFile = path.join(options.outputPath, 'prompt.txt');
        try {
          fs.writeFileSync(promptFile, options.prompt, 'utf-8');
        } catch (error) {
          session.status = 'error';
          session.error = `Failed to write prompt file: ${error}`;
          this.emit('status-change', { sessionId: id, status: 'error', error: session.error });
          return;
        }
        // Safe: promptFile path is controlled (UUID in userData directory)
        // The user's prompt content is in the file, never passed through shell expansion
        const safeInstruction = `Follow the instructions in: ${promptFile}`;
        // Build CLI command with args
        const argsStr = session.cliArgs.length > 0 ? session.cliArgs.join(' ') + ' ' : '';
        session.ptyProcess.write(`${session.cliCommand} ${argsStr}"${safeInstruction.replace(/"/g, '\\"')}"\r`);
        session.status = 'running';
        this.emit('status-change', { sessionId: id, status: 'running' });
      }
    }, 500);

    return id;
  }

  private startCompletionWatcher(sessionId: string, outputPath: string, completionGuid: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const completionFile = path.join(outputPath, `${completionGuid}.done.json`);

    // Ensure output directory exists
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }

    const checkCompletion = () => {
      if (fs.existsSync(completionFile)) {
        try {
          const content = fs.readFileSync(completionFile, 'utf-8');
          const result = JSON.parse(content);
          this.emit('review-complete', { sessionId, result });

          // Stop watcher - use unwatchFile for fs.watchFile
          fs.unwatchFile(completionFile);
          session.completionWatcher = null;
        } catch (error) {
          console.error('Error reading completion file:', error);
        }
      }
    };

    // Use fs.watchFile which works for files that don't exist yet (polls)
    // This is more reliable than fs.watch on Windows for detecting new file creation
    try {
      fs.watchFile(completionFile, { interval: 500 }, (curr, prev) => {
        // File was created or modified (curr.size > 0 means file exists and has content)
        if (curr.size > 0 && (prev.size === 0 || curr.mtime !== prev.mtime)) {
          // Debounce
          const existing = this.debounceTimers.get(sessionId);
          if (existing) clearTimeout(existing);

          this.debounceTimers.set(sessionId, setTimeout(() => {
            checkCompletion();
            this.debounceTimers.delete(sessionId);
          }, 300));
        }
      });

      // Store a marker that we're using watchFile (we'll use unwatchFile to stop it)
      session.completionWatcher = { close: () => fs.unwatchFile(completionFile) } as fs.FSWatcher;

      console.log(`[Terminal] Watching for completion file: ${completionFile}`);
    } catch (error) {
      console.error('Error starting completion watcher:', error);
    }
  }

  getSession(id: string): TerminalSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;

    // Return without internal fields
    const { ptyProcess, completionWatcher, startupTimeout, ...publicSession } = session;
    return publicSession;
  }

  getAllSessions(): TerminalSession[] {
    return Array.from(this.sessions.values()).map(s => {
      const { ptyProcess, completionWatcher, startupTimeout, ...publicSession } = s;
      return publicSession;
    });
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
    const session = this.sessions.get(id);
    if (session) {
      if (session.startupTimeout) {
        clearTimeout(session.startupTimeout);
        session.startupTimeout = null;
      }
      if (session.ptyProcess) {
        session.ptyProcess.kill();
      }
      if (session.completionWatcher) {
        session.completionWatcher.close();
        session.completionWatcher = null;
      }
      const timer = this.debounceTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        this.debounceTimers.delete(id);
      }
      session.status = 'completed';
      session.completedAt = new Date().toISOString();
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

let terminalManager: TerminalManager | null = null;

export function getTerminalManager(): TerminalManager {
  if (!terminalManager) {
    terminalManager = new TerminalManager();
  }
  return terminalManager;
}

export function disposeTerminalManager(): void {
  if (terminalManager) {
    terminalManager.dispose();
    terminalManager = null;
  }
}
