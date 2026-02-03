import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import * as pty from '@lydell/node-pty';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let ptyProcess = null;
let fileWatcher = null;
let debounceTimer = null;
const DEBOUNCE_MS = 300; // Debounce file change events
const INITIAL_PROMPT = '/superpowers:brainstorm think of a new feature for this repo';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#1e1e1e',
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Open DevTools in development mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

function getShell() {
  return process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
}

function startFileWatcher() {
  const watchFile = path.join(process.cwd(), 'update-timestamp.txt');

  // Stop existing watcher if any
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
  }

  // Check if file exists, if not create it
  if (!fs.existsSync(watchFile)) {
    fs.writeFileSync(watchFile, new Date().toISOString(), 'utf8');
  }

  // Debounced restart function to handle multiple rapid events
  const debouncedRestart = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      console.log('[File Watcher] update-timestamp.txt changed, restarting Claude Code...');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal-data', '\r\n\x1b[33m[File Watcher]\x1b[0m Detected update-timestamp.txt change, restarting...\r\n');
      }
      startClaudeCode();
      debounceTimer = null;
    }, DEBOUNCE_MS);
  };

  // Watch for file changes
  // Note: fs.watch behavior varies by platform:
  // - Windows: fires 'change' for modifications
  // - macOS: may fire 'rename' for some modifications
  // - Linux: fires 'change' for modifications
  try {
    fileWatcher = fs.watch(watchFile, (eventType, filename) => {
      // Handle both 'change' and 'rename' events for cross-platform support
      // 'rename' can occur on macOS when file is replaced
      if (eventType === 'change' || eventType === 'rename') {
        // Verify file still exists (rename could mean deletion)
        if (fs.existsSync(watchFile)) {
          debouncedRestart();
        }
      }
    });

    fileWatcher.on('error', (error) => {
      console.error('[File Watcher] Error:', error.message);
      // Try to restart the watcher after a delay
      setTimeout(() => {
        if (!fileWatcher) {
          startFileWatcher();
        }
      }, 1000);
    });

    console.log(`[File Watcher] Watching: ${watchFile}`);
  } catch (error) {
    console.error('[File Watcher] Failed to start:', error.message);
  }
}

function startClaudeCode() {
  // Kill existing process if any
  if (ptyProcess) {
    ptyProcess.kill();
    ptyProcess = null;
  }

  const shell = getShell();
  const cwd = process.cwd();

  // Create a new pseudo-terminal
  ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });

  // Send data from PTY to renderer
  ptyProcess.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-data', data);
    }
  });

  // Handle PTY exit
  ptyProcess.onExit(({ exitCode }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-exit', exitCode);
    }
  });

  // Launch Claude Code after a brief delay to let the shell initialize
  setTimeout(() => {
    if (ptyProcess) {
      // Escape the prompt for shell safety
      const escapedPrompt = INITIAL_PROMPT.replace(/"/g, '\\"');
      ptyProcess.write(`claude --dangerously-skip-permissions "${escapedPrompt}"\r`);
    }
  }, 500);

  return true;
}

// IPC Handlers
ipcMain.handle('start-claude', () => {
  return startClaudeCode();
});

ipcMain.handle('restart-claude', () => {
  return startClaudeCode();
});

ipcMain.on('terminal-input', (event, data) => {
  if (ptyProcess) {
    ptyProcess.write(data);
  }
});

ipcMain.on('terminal-resize', (event, { cols, rows }) => {
  if (ptyProcess) {
    ptyProcess.resize(cols, rows);
  }
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  startFileWatcher();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (ptyProcess) {
    ptyProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  if (fileWatcher) {
    fileWatcher.close();
  }
  if (ptyProcess) {
    ptyProcess.kill();
  }
});
