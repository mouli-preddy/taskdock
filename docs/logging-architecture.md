# Logging Architecture

## Overview

TaskDock uses a high-performance, structured logging system designed for production use and LLM troubleshooting. All logs are written to files with automatic rotation, making it easy to diagnose issues.

## Architecture

### 1. Tauri (Rust) Logging

**Library**: `tauri-plugin-log`

**Configuration**: `src-tauri/src/lib.rs`

**Features**:
- Logs to both stdout and file
- File location: OS-specific log directory (e.g., `%APPDATA%\com.taskdock.dev\logs` on Windows)
- Automatic rotation at 50MB
- Keeps all rotated files
- Debug level in development, Info level in production

**Usage in Rust**:
```rust
log::info!("Starting backend from project root: {:?}", project_root);
log::error!("Failed to start backend: {}", e);
```

### 2. Backend (Node.js) Logging

**Library**: Pino + pino-roll (5x faster than Winston)

**Service**: `src/main/services/logger-service.ts`

**Features**:
- Structured JSON logging for machine parsing
- Async I/O for minimal performance impact
- Automatic rotation:
  - Daily rotation (new file each day)
  - Size-based rotation (100MB)
- Keeps 30 days of logs
- File format: `taskdock-YYYY-MM-DD.log`
- Location: `~/.taskdock/logs/`

**Usage in Backend**:
```typescript
import { getLogger } from './services/logger-service';

const logger = getLogger();

logger.info('Backend', 'Backend bridge starting', { port: PORT });
logger.error('ADO', 'Failed to fetch PR', { prId, error });
logger.debug('Cache', 'File cached', { filePath, size });
```

### 3. Frontend (Browser) Logging

**Service**: `src/renderer/logger.ts`

**Features**:
- Sends logs to backend via WebSocket
- Batched logging (flushes every 1 second)
- Immediate flush on errors
- Also logs to browser console for development
- Graceful degradation if backend unavailable

**Usage in Frontend**:
```typescript
import { logger } from './logger';

logger.info('UI', 'User logged in', { userId: 123 });
logger.error('API', 'Failed to load PR', { prId, error: err.message });
logger.debug('Rendering', 'Component mounted', { componentName });
```

## Log Locations

### Development
- **Tauri logs**: Console + `%APPDATA%\com.taskdock.dev\logs\`
- **Backend logs**: Console + `~/.taskdock/logs/taskdock-YYYY-MM-DD.log`
- **Frontend logs**: Browser console + Backend logs (via WebSocket)

### Production
- **Tauri logs**: `%APPDATA%\com.taskdock.dev\logs\taskdock.log` (rotated at 50MB)
- **Backend logs**: `~/.taskdock/logs/taskdock-YYYY-MM-DD.log` (rotated daily/100MB)
- **Frontend logs**: Same as backend (sent via WebSocket)

## Log Format

### Backend/Frontend (Pino JSON)
```json
{
  "level": "INFO",
  "time": "2026-01-29T10:30:45.123Z",
  "category": "Backend",
  "msg": "Backend bridge starting",
  "port": 5198
}
```

### Tauri (Text)
```
[2026-01-29T10:30:45Z INFO taskdock_lib] Starting backend from project root: "C:\tools\samples"
```

## Viewing Logs

### From the Application
1. Open Developer Tools
2. Use the Logger API:
   ```typescript
   // Get last 100 log entries
   const logs = await tauriAPI.loggerGetLogs(100);

   // Get log file path
   const logPath = await tauriAPI.loggerGetLogPath();

   // Open log folder in file explorer
   await tauriAPI.loggerOpenLogFolder();
   ```

### From File System
- **Windows**: `%USERPROFILE%\.taskdock\logs\`
- **macOS**: `~/Library/Application Support/com.taskdock.dev/logs/`
- **Linux**: `~/.local/share/taskdock/logs/`

## Troubleshooting with LLM

The structured logging format makes it easy to troubleshoot with LLMs like Claude:

1. **Retrieve logs**:
   ```typescript
   const logs = await tauriAPI.loggerGetLogs(1000);
   ```

2. **Send to LLM**:
   ```
   Here are the application logs showing the error:
   [paste logs]

   Can you help diagnose what's causing the issue?
   ```

3. **Benefits for LLMs**:
   - Structured JSON format is easy to parse
   - Timestamps show event sequence
   - Categories show which component failed
   - Contextual data provides debugging info
   - Error stack traces included

## Performance Considerations

### Pino Performance
- **5x faster** than Winston
- **Async I/O**: Non-blocking writes
- **Minimal overhead**: ~1-2ms per log
- **Batched writes**: Buffered for efficiency

### Best Practices
- ✅ Use appropriate log levels (debug for verbose, error for failures)
- ✅ Include contextual data (IDs, paths, relevant state)
- ✅ Log errors with full context
- ❌ Avoid logging in tight loops (causes I/O overhead)
- ❌ Don't log sensitive data (passwords, tokens, PII)
- ❌ Avoid excessive logging on happy path

## Configuration

### Backend Log Level
Set via environment variable:
```bash
LOG_LEVEL=debug npm run dev:backend
LOG_LEVEL=info npm run dev:backend
```

### Tauri Log Level
Configured in `src-tauri/src/lib.rs`:
- Debug in development (`cfg!(debug_assertions)`)
- Info in production

### Log Retention
Configured in `logger-service.ts`:
```typescript
limit: {
  count: 30,  // Keep 30 days of logs
}
```

## API Reference

### Backend Logger
```typescript
interface LoggerService {
  initialize(): void;
  setMinLevel(level: 'debug' | 'info' | 'warn' | 'error'): void;
  debug(category: string, message: string, data?: unknown): void;
  info(category: string, message: string, data?: unknown): void;
  warn(category: string, message: string, data?: unknown): void;
  error(category: string, message: string, data?: unknown): void;
  getLogFilePath(): string;
  getLogDir(): string;
  getRecentLogs(lines: number): Promise<string>;
  flush(): Promise<void>;
  close(): void;
}
```

### Frontend Logger
```typescript
export const logger = {
  debug: (category: string, message: string, data?: unknown) => void;
  info: (category: string, message: string, data?: unknown) => void;
  warn: (category: string, message: string, data?: unknown) => void;
  error: (category: string, message: string, data?: unknown) => void;
};
```

## Resources

- [Pino Documentation](https://getpino.io/)
- [Pino vs Winston Comparison](https://betterstack.com/community/comparisons/pino-vs-winston/)
- [Tauri Plugin Log](https://v2.tauri.app/plugin/logging/)
- [Logging Best Practices](https://betterstack.com/community/guides/logging/best-nodejs-logging-libraries/)
