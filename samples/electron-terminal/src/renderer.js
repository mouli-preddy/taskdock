// Terminal and FitAddon are loaded via script tags and available globally

class ClaudeTerminal {
  constructor() {
    this.terminal = null;
    this.fitAddon = null;
    this.isRunning = false;

    this.init();
  }

  init() {
    this.setupTerminal();
    this.setupEventListeners();
    this.startClaude();
  }

  setupTerminal() {
    // Create terminal with a dark theme
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

    // Add fit addon
    this.fitAddon = new FitAddon.FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // Open terminal in container
    const container = document.getElementById('terminal');
    this.terminal.open(container);

    // Fit terminal to container
    this.fitAddon.fit();

    // Handle window resize
    window.addEventListener('resize', () => {
      this.fitAddon.fit();
      this.sendResize();
    });

    // Handle terminal input
    this.terminal.onData((data) => {
      window.electronAPI.sendInput(data);
    });

    // Handle terminal resize
    this.terminal.onResize(({ cols, rows }) => {
      window.electronAPI.resizeTerminal(cols, rows);
    });

    // Custom key handler for clipboard operations
    this.terminal.attachCustomKeyEventHandler((event) => {
      // Handle paste: Ctrl+V (Windows/Linux) or Cmd+V (macOS)
      if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
        this.handlePaste();
        return false; // Prevent default xterm handling
      }
      // Handle copy: Ctrl+C with selection or Cmd+C (macOS)
      if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
        const selection = this.terminal.getSelection();
        if (selection) {
          window.electronAPI.writeClipboard(selection);
          return false; // Prevent default xterm handling
        }
        // If no selection, let Ctrl+C pass through as SIGINT
      }
      return true; // Let xterm handle other keys
    });

    // Right-click context menu paste
    const terminalContainer = document.getElementById('terminal');
    terminalContainer.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.handlePaste();
    });
  }

  async handlePaste() {
    try {
      const text = await window.electronAPI.readClipboard();
      if (text) {
        window.electronAPI.sendInput(text);
      }
    } catch (error) {
      console.error('Paste failed:', error);
    }
  }

  setupEventListeners() {
    // Restart button
    const restartBtn = document.getElementById('restart-btn');
    restartBtn.addEventListener('click', () => this.restartClaude());

    // Receive terminal data from main process
    window.electronAPI.onTerminalData((data) => {
      this.terminal.write(data);
    });

    // Handle terminal exit
    window.electronAPI.onTerminalExit((exitCode) => {
      this.setStatus('stopped', `Exited (${exitCode})`);
      this.isRunning = false;
    });
  }

  async startClaude() {
    this.setStatus('starting', 'Starting...');
    this.terminal.clear();
    this.terminal.writeln('\x1b[36m[Claude Code Terminal]\x1b[0m Starting Claude Code...\r\n');

    try {
      await window.electronAPI.startClaude();
      this.isRunning = true;
      this.setStatus('running', 'Running');
      this.sendResize();
    } catch (error) {
      this.setStatus('stopped', 'Error');
      this.terminal.writeln(`\x1b[31mError: ${error.message}\x1b[0m`);
    }
  }

  async restartClaude() {
    const restartBtn = document.getElementById('restart-btn');
    restartBtn.disabled = true;

    this.setStatus('starting', 'Restarting...');
    this.terminal.clear();
    this.terminal.writeln('\x1b[33m[Claude Code Terminal]\x1b[0m Closing current session...\r\n');

    try {
      await window.electronAPI.restartClaude();
      this.isRunning = true;
      this.setStatus('running', 'Running');
      this.terminal.writeln('\x1b[36m[Claude Code Terminal]\x1b[0m Starting new Claude Code instance...\r\n');
      this.sendResize();
    } catch (error) {
      this.setStatus('stopped', 'Error');
      this.terminal.writeln(`\x1b[31mError: ${error.message}\x1b[0m`);
    } finally {
      restartBtn.disabled = false;
    }
  }

  sendResize() {
    if (this.terminal) {
      const { cols, rows } = this.terminal;
      window.electronAPI.resizeTerminal(cols, rows);
    }
  }

  setStatus(state, text) {
    const statusEl = document.getElementById('status');
    const statusText = statusEl.querySelector('.status-text');

    statusEl.className = 'status-indicator ' + state;
    statusText.textContent = text;
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new ClaudeTerminal();
});
