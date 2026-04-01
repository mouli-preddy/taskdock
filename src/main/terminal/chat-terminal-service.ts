/**
 * Chat Terminal Service
 * Manages interactive terminal sessions for AI chat in PR panels.
 * Unlike review terminals, these are purely interactive (no completion file).
 */

import * as pty from '@lydell/node-pty';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
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
  autoExit?: boolean; // If true, shell exits automatically after the CLI finishes
  logFile?: string;  // If set, capture terminal output and write a .md session log here
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str
    .replace(/\x1b\[[0-9;?<>]*[a-zA-Z]/g, '')  // CSI sequences incl. DEC private (?), <, >
    .replace(/\x1b\][^\x07]*\x07/g, '')          // OSC sequences
    .replace(/\x1b[@-Z\\-_]/g, '')               // other two-char ESC sequences
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n');                 // collapse runs of blank lines
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

    // autoExit sessions (phased tasks) run the CLI directly via spawn — no PTY.
    // This avoids PTY escape codes, shell startup noise, and \r overwrites in the log file.
    if (options.autoExit) {
      const promptFile = path.join(options.contextPath, 'chat-prompt.txt');
      try {
        fs.writeFileSync(promptFile, options.initialPrompt, 'utf-8');
      } catch (error) {
        logger.error(LOG_CATEGORY, 'Failed to write prompt file', { error });
        session.status = 'error';
        session.error = `Failed to write prompt file: ${error}`;
        this.emit('status-change', { sessionId: id, status: 'error', error: session.error });
        return id;
      }

      const cliCommand = options.ai === 'copilot' ? 'copilot' : 'claude';
      const instruction = `Follow the instructions in: ${promptFile}`;
      const cliArgs = options.ai === 'copilot'
        ? ['--allow-all', '--add-dir', options.contextPath, '-i', instruction]
        : ['--dangerously-skip-permissions', '--print', '--verbose', instruction];

      logger.info(LOG_CATEGORY, 'Launching CLI (direct spawn, autoExit)', { cliCommand });

      const child = spawn(cliCommand, cliArgs, {
        cwd: options.workingDir,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
        shell: true,
      });

      // Mock ptyProcess so kill/resize calls don't throw
      session.ptyProcess = {
        write: () => {},
        resize: () => {},
        kill: () => { child.kill(); },
        onData: () => {},
        onExit: () => {},
      };

      const outputChunks: string[] = [];

      child.stdout?.on('data', (chunk: Buffer) => {
        const str = chunk.toString();
        outputChunks.push(str);
        this.emit('data', { sessionId: id, data: str });
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        // Forward stderr to terminal display but exclude from log file
        this.emit('data', { sessionId: id, data: chunk.toString() });
      });

      child.on('error', (err) => {
        logger.error(LOG_CATEGORY, 'Failed to spawn CLI process', { error: err });
        session.status = 'error';
        session.error = err.message;
        this.emit('status-change', { sessionId: id, status: 'error', error: session.error });
      });

      child.on('exit', (exitCode: number | null) => {
        logger.info(LOG_CATEGORY, 'Auto-exit process exited', { sessionId: id, exitCode });

        if (options.logFile) {
          try {
            const clean = outputChunks.join('').replace(/\n{3,}/g, '\n\n');
            const date = new Date().toLocaleString();
            const content = `# Task Run — ${date}\n\n## Prompt\n\n${options.initialPrompt}\n\n---\n\n## Output\n\n${clean}\n`;
            fs.writeFileSync(options.logFile, content, 'utf-8');
          } catch (e) {
            logger.warn(LOG_CATEGORY, 'Failed to write session log', { logFile: options.logFile, error: e });
          }
        }

        session.status = (exitCode ?? 1) === 0 ? 'completed' : 'error';
        this.emit('exit', { sessionId: id, exitCode: exitCode ?? 1 });
        this.emit('status-change', { sessionId: id, status: session.status });
      });

      session.status = 'running';
      this.emit('status-change', { sessionId: id, status: 'running' });
      return id;
    }

    // Interactive sessions use a PTY (full terminal with ANSI support)
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

        const cliCommand = options.ai === 'copilot' ? 'copilot' : 'claude';
        const cliArgs = ['--dangerously-skip-permissions'];
        const safeInstruction = `Follow the instructions in: ${promptFile}`;
        const argsStr = cliArgs.join(' ');

        logger.info(LOG_CATEGORY, 'Launching CLI (PTY, interactive)', { cliCommand, argsStr });
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
