/**
 * Frontend Logger
 * Sends logs to the backend for centralized, performant file logging
 */

import { tauriAPI } from './tauri-api';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class FrontendLogger {
  private queue: Array<{
    level: LogLevel;
    category: string;
    message: string;
    data?: unknown;
  }> = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private isConnected = true;

  constructor() {
    // Flush logs every 1 second (batch for performance)
    this.flushInterval = setInterval(() => this.flush(), 1000);

    // Flush on page unload
    window.addEventListener('beforeunload', () => this.flush());
  }

  debug(category: string, message: string, data?: unknown): void {
    this.log('debug', category, message, data);
  }

  info(category: string, message: string, data?: unknown): void {
    this.log('info', category, message, data);
  }

  warn(category: string, message: string, data?: unknown): void {
    this.log('warn', category, message, data);
  }

  error(category: string, message: string, data?: unknown): void {
    this.log('error', category, message, data);
  }

  private log(level: LogLevel, category: string, message: string, data?: unknown): void {
    // Also log to browser console for development
    const consoleMethod =
      level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    consoleMethod(`[${level.toUpperCase()}] [${category}] ${message}`, data !== undefined ? data : '');

    // Queue for backend logging
    this.queue.push({ level, category, message, data });

    // If error, flush immediately
    if (level === 'error') {
      this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.queue.length === 0 || !this.isConnected) return;

    const logsToSend = [...this.queue];
    this.queue = [];

    try {
      // Send all queued logs to backend
      await Promise.all(
        logsToSend.map((log) =>
          tauriAPI.loggerLog(log.level, log.category, log.message, log.data).catch((err) => {
            // If backend is not available, log to console only
            console.warn('Failed to send log to backend:', err);
          })
        )
      );
    } catch (error) {
      // If flush fails, re-queue logs
      this.queue.unshift(...logsToSend);
    }
  }

  dispose(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
  }
}

// Singleton instance
let loggerInstance: FrontendLogger | null = null;

export function getLogger(): FrontendLogger {
  if (!loggerInstance) {
    loggerInstance = new FrontendLogger();
  }
  return loggerInstance;
}

// Convenience exports
export const logger = {
  debug: (category: string, message: string, data?: unknown) =>
    getLogger().debug(category, message, data),
  info: (category: string, message: string, data?: unknown) =>
    getLogger().info(category, message, data),
  warn: (category: string, message: string, data?: unknown) =>
    getLogger().warn(category, message, data),
  error: (category: string, message: string, data?: unknown) =>
    getLogger().error(category, message, data),
};
