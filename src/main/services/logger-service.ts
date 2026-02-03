/**
 * Logger Service
 * High-performance file-based logging using Pino
 *
 * Pino is 5x faster than Winston with async I/O and structured JSON logging.
 * Log files are automatically rotated daily and by size (100MB).
 *
 * Uses rotating-file-stream instead of pino-roll because pino.transport()
 * uses worker threads that don't bundle correctly with pkg.
 */

import pino from 'pino';
import * as path from 'path';
import * as fs from 'fs';
import * as rfs from 'rotating-file-stream';
import { getAppDataPath } from '../utils/app-paths.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class LoggerService {
  private logger: pino.Logger | null = null;
  private logDir: string = '';
  private initialized: boolean = false;
  private stream: rfs.RotatingFileStream | null = null;

  /**
   * Initialize the logger (call after app is ready)
   */
  initialize(): void {
    if (this.initialized) return;

    this.logDir = path.join(getAppDataPath(), 'logs');
    this.ensureLogDir();

    // Use rotating-file-stream which works in the main thread
    // (unlike pino.transport() which uses worker threads that don't bundle with pkg)
    this.stream = rfs.createStream('taskdock.log', {
      path: this.logDir,
      size: '100M',           // Rotate at 100MB
      interval: '1d',         // Rotate daily
      maxFiles: 30,           // Keep 30 days of logs
      compress: false,        // Don't compress (keep logs readable)
    });

    this.logger = pino({
      level: process.env.LOG_LEVEL || 'debug',
      formatters: {
        level: (label) => ({ level: label.toUpperCase() }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    }, this.stream);

    this.initialized = true;
    this.info('Logger', 'Logger initialized', { logDir: this.logDir });
  }

  /**
   * Set minimum log level
   */
  setMinLevel(level: LogLevel): void {
    if (this.logger) {
      this.logger.level = level;
    }
  }

  /**
   * Log a debug message
   */
  debug(category: string, message: string, data?: unknown): void {
    if (!this.logger) return;
    this.logger.debug({ category, ...this.normalizeData(data) }, message);
  }

  /**
   * Log an info message
   */
  info(category: string, message: string, data?: unknown): void {
    if (!this.logger) return;
    this.logger.info({ category, ...this.normalizeData(data) }, message);
  }

  /**
   * Log a warning message
   */
  warn(category: string, message: string, data?: unknown): void {
    if (!this.logger) return;
    this.logger.warn({ category, ...this.normalizeData(data) }, message);
  }

  /**
   * Log an error message
   */
  error(category: string, message: string, data?: unknown): void {
    if (!this.logger) return;
    // Handle Error objects properly
    if (data instanceof Error) {
      this.logger.error({ category, err: data }, message);
    } else {
      this.logger.error({ category, ...this.normalizeData(data) }, message);
    }
  }

  /**
   * Get the path to the current log file
   */
  getLogFilePath(): string {
    return path.join(this.logDir, 'taskdock.log');
  }

  /**
   * Get the logs directory path
   */
  getLogDir(): string {
    return this.logDir;
  }

  /**
   * Read recent log entries (last N lines)
   */
  async getRecentLogs(lines: number = 100): Promise<string> {
    const logFile = this.getLogFilePath();
    if (!fs.existsSync(logFile)) {
      return '';
    }

    try {
      const content = await fs.promises.readFile(logFile, 'utf-8');
      const allLines = content.trim().split('\n');
      return allLines.slice(-lines).join('\n');
    } catch {
      return '';
    }
  }

  /**
   * Flush all pending log writes
   */
  async flush(): Promise<void> {
    if (this.logger) {
      await new Promise<void>((resolve) => {
        this.logger!.flush(() => resolve());
      });
    }
  }

  /**
   * Close the logger
   */
  close(): void {
    if (this.logger) {
      this.logger.flush();
      this.logger = null;
    }
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
    this.initialized = false;
  }

  /**
   * Normalize data for structured logging
   */
  private normalizeData(data: unknown): Record<string, unknown> {
    if (!data) return {};
    if (typeof data === 'object' && data !== null) {
      return data as Record<string, unknown>;
    }
    return { data };
  }

  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }
}

// Singleton instance
let loggerInstance: LoggerService | null = null;

export function getLogger(): LoggerService {
  if (!loggerInstance) {
    loggerInstance = new LoggerService();
  }
  return loggerInstance;
}

export function initializeLogger(): void {
  getLogger().initialize();
}

export async function disposeLogger(): Promise<void> {
  if (loggerInstance) {
    await loggerInstance.flush();
    loggerInstance.close();
    loggerInstance = null;
  }
}
