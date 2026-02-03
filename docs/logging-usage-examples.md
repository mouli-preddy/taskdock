# Logging Usage Examples

## Quick Start

### Frontend (React/TypeScript)
```typescript
import { logger } from './renderer/logger';

// In a component
function MyComponent() {
  const handleClick = async () => {
    logger.info('UI', 'Button clicked', { buttonId: 'submit' });

    try {
      await api.doSomething();
      logger.debug('UI', 'Action completed successfully');
    } catch (error) {
      logger.error('UI', 'Action failed', { error: error.message, stack: error.stack });
    }
  };

  return <button onClick={handleClick}>Submit</button>;
}
```

### Backend (Node.js)
```typescript
import { getLogger } from './services/logger-service';

const logger = getLogger();

// API calls
async function fetchPullRequest(prId: number) {
  logger.info('ADO', 'Fetching pull request', { prId });

  try {
    const pr = await adoClient.getPullRequest(org, project, prId);
    logger.debug('ADO', 'PR fetched successfully', {
      prId,
      title: pr.title,
      author: pr.createdBy.displayName
    });
    return pr;
  } catch (error) {
    logger.error('ADO', 'Failed to fetch PR', {
      prId,
      error: error.message,
      statusCode: error.statusCode
    });
    throw error;
  }
}
```

### Tauri (Rust)
```rust
use log::{info, error, debug, warn};

fn spawn_backend() -> Result<Child, std::io::Error> {
    info!("Spawning backend process");

    match Command::new("npx").spawn() {
        Ok(child) => {
            info!("Backend spawned successfully with PID: {}", child.id());
            Ok(child)
        }
        Err(e) => {
            error!("Failed to spawn backend: {}", e);
            Err(e)
        }
    }
}
```

## Common Patterns

### 1. API Request Logging
```typescript
async function apiCall(endpoint: string, params: any) {
  const requestId = uuid();
  logger.info('API', 'Request started', { requestId, endpoint, params });

  const startTime = Date.now();
  try {
    const result = await fetch(endpoint, params);
    const duration = Date.now() - startTime;

    logger.info('API', 'Request completed', {
      requestId,
      endpoint,
      duration,
      status: result.status
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('API', 'Request failed', {
      requestId,
      endpoint,
      duration,
      error
    });
    throw error;
  }
}
```

### 2. State Changes
```typescript
function updatePRState(prId: number, newState: string) {
  logger.debug('State', 'PR state changing', {
    prId,
    oldState: currentState,
    newState
  });

  // Update state
  currentState = newState;

  logger.info('State', 'PR state updated', { prId, newState });
}
```

### 3. User Actions
```typescript
function handleUserLogin(username: string) {
  logger.info('Auth', 'User login attempt', { username });

  try {
    const token = await authenticate(username);
    logger.info('Auth', 'User logged in successfully', {
      username,
      tokenExpiry: token.expiresAt
    });
  } catch (error) {
    logger.warn('Auth', 'Login failed', {
      username,
      reason: error.message
    });
  }
}
```

### 4. Background Jobs
```typescript
async function syncPRs() {
  logger.info('Sync', 'PR sync started');

  try {
    const prs = await fetchAllPRs();
    logger.debug('Sync', 'PRs fetched', { count: prs.length });

    for (const pr of prs) {
      logger.debug('Sync', 'Processing PR', { prId: pr.id });
      await processPR(pr);
    }

    logger.info('Sync', 'PR sync completed', { totalProcessed: prs.length });
  } catch (error) {
    logger.error('Sync', 'PR sync failed', { error });
  }
}
```

### 5. Performance Tracking
```typescript
async function expensiveOperation() {
  const startTime = performance.now();
  logger.debug('Perf', 'Starting expensive operation');

  try {
    const result = await doExpensiveWork();
    const duration = performance.now() - startTime;

    logger.info('Perf', 'Operation completed', {
      duration: `${duration.toFixed(2)}ms`,
      success: true
    });

    return result;
  } catch (error) {
    const duration = performance.now() - startTime;
    logger.error('Perf', 'Operation failed', {
      duration: `${duration.toFixed(2)}ms`,
      error
    });
    throw error;
  }
}
```

### 6. WebSocket Events
```typescript
ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    logger.debug('WebSocket', 'Message received', {
      type: message.type,
      size: data.length
    });

    handleMessage(message);
  } catch (error) {
    logger.error('WebSocket', 'Failed to parse message', {
      error,
      rawData: data.toString().substring(0, 100)
    });
  }
});
```

## Log Levels Guide

### DEBUG
- Detailed diagnostic information
- Variable values, state dumps
- Step-by-step execution flow
- **Use when**: Debugging specific issues
- **Example**: `logger.debug('Cache', 'File cached', { path, size, ttl })`

### INFO
- Normal application events
- State transitions
- Successful operations
- **Use when**: Tracking normal application flow
- **Example**: `logger.info('Backend', 'Server started', { port: 5198 })`

### WARN
- Recoverable errors
- Deprecated usage
- Unexpected but handled situations
- **Use when**: Something unusual happened but we can continue
- **Example**: `logger.warn('Cache', 'Cache miss', { key })`

### ERROR
- Error conditions
- Failed operations
- Exceptions
- **Use when**: Something went wrong and needs attention
- **Example**: `logger.error('DB', 'Connection failed', { error, retries: 3 })`

## Anti-Patterns (Don't Do This)

### ❌ Logging Sensitive Data
```typescript
// BAD
logger.info('Auth', 'Token received', { token: '12345abc' });
logger.debug('User', 'Password check', { password: 'secret123' });

// GOOD
logger.info('Auth', 'Token received', { tokenLength: token.length });
logger.debug('User', 'Password check', { userId: user.id });
```

### ❌ Logging in Tight Loops
```typescript
// BAD
for (const item of items) {
  logger.debug('Loop', 'Processing item', { item }); // Called 10,000 times!
  processItem(item);
}

// GOOD
logger.info('Batch', 'Processing items', { count: items.length });
for (const item of items) {
  processItem(item);
}
logger.info('Batch', 'Items processed', { count: items.length });
```

### ❌ Vague Messages
```typescript
// BAD
logger.error('Error', 'Something went wrong');

// GOOD
logger.error('API', 'Failed to fetch PR', { prId: 123, error: err.message });
```

### ❌ Not Using Categories
```typescript
// BAD
logger.info('', 'User logged in');

// GOOD
logger.info('Auth', 'User logged in', { userId: user.id });
```

## Viewing Logs for Debugging

### During Development
```typescript
// Open log folder
await tauriAPI.loggerOpenLogFolder();

// Get recent logs
const recentLogs = await tauriAPI.loggerGetLogs(100);
console.log(recentLogs);
```

### With LLM Assistance
1. Export logs:
   ```typescript
   const logs = await tauriAPI.loggerGetLogs(500);
   // Copy logs
   ```

2. Provide to LLM:
   ```
   I'm encountering an error when loading PRs. Here are the relevant logs:

   [paste logs]

   Can you help identify the root cause?
   ```

3. LLM can analyze:
   - Sequence of events
   - Error patterns
   - State at time of failure
   - Performance bottlenecks

## Testing with Logs

```typescript
describe('PR Service', () => {
  beforeEach(() => {
    // Optional: capture logs during tests
    const mockLogger = jest.fn();
    jest.spyOn(getLogger(), 'error').mockImplementation(mockLogger);
  });

  it('should log error on API failure', async () => {
    await expect(fetchPR(999)).rejects.toThrow();

    // Verify error was logged
    expect(getLogger().error).toHaveBeenCalledWith(
      'API',
      'Failed to fetch PR',
      expect.objectContaining({ prId: 999 })
    );
  });
});
```
