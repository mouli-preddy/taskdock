const { contextBridge, ipcRenderer, clipboard } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Clipboard access
  readClipboard: () => clipboard.readText(),
  writeClipboard: (text) => clipboard.writeText(text),

  // Start Claude Code
  startClaude: () => ipcRenderer.invoke('start-claude'),

  // Restart Claude Code (kills existing and starts new)
  restartClaude: () => ipcRenderer.invoke('restart-claude'),

  // Send input to terminal
  sendInput: (data) => ipcRenderer.send('terminal-input', data),

  // Resize terminal
  resizeTerminal: (cols, rows) => ipcRenderer.send('terminal-resize', { cols, rows }),

  // Listen for terminal data
  onTerminalData: (callback) => {
    ipcRenderer.on('terminal-data', (event, data) => callback(data));
  },

  // Listen for terminal exit
  onTerminalExit: (callback) => {
    ipcRenderer.on('terminal-exit', (event, exitCode) => callback(exitCode));
  },

  // Remove listeners (for cleanup)
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
