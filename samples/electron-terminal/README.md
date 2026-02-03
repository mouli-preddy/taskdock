# Electron Claude Code Terminal

An Electron application that hosts a terminal running Claude Code with a button to restart the session.

## Features

- Full terminal emulator using xterm.js
- Automatically starts Claude Code on launch
- **Restart button** to close the current Claude Code session and start a new one
- Status indicator showing the current state (Starting, Running, Stopped)
- Dark theme optimized for code work
- Responsive terminal that resizes with the window

## Prerequisites

- Node.js 20+
- Claude Code CLI installed and available in PATH
- npm or yarn

## Installation

```bash
# Install dependencies
npm install

# Rebuild native modules for Electron
npm run postinstall
# Or manually: npx electron-rebuild
```

## Usage

```bash
# Start the application
npm start

# Start in development mode (with DevTools)
npm run dev
```

## How It Works

1. **Main Process** (`src/main.js`): Creates the Electron window and manages the pseudo-terminal (PTY) process using `node-pty`. Handles IPC communication between the renderer and the terminal process.

2. **Preload Script** (`src/preload.js`): Exposes a safe API to the renderer process via context bridge, allowing communication with the main process without exposing Node.js APIs directly.

3. **Renderer** (`src/renderer.js`): Manages the xterm.js terminal instance, handles user input, and communicates with the main process for terminal operations.

4. **Restart Functionality**: When the restart button is clicked:
   - The current PTY process is killed
   - A new shell is spawned
   - Claude Code is automatically launched in the new shell

## Project Structure

```
electron-terminal/
├── package.json
├── README.md
└── src/
    ├── main.js        # Electron main process
    ├── preload.js     # Preload script for IPC
    ├── renderer.js    # Frontend terminal logic
    ├── index.html     # UI markup
    └── styles.css     # Styling
```

## Customization

### Change the default shell

Edit `src/main.js` and modify the `getShell()` function:

```javascript
function getShell() {
  // Return your preferred shell
  return 'bash';
}
```

### Modify terminal appearance

Edit `src/renderer.js` to customize the terminal theme, font, or other options in the `setupTerminal()` method.

### Add keyboard shortcuts

You can add global shortcuts in `src/main.js` using Electron's `globalShortcut` module.

## Troubleshooting

### "node-pty" build errors

Make sure you have the build tools installed:
- **Windows**: `npm install --global windows-build-tools`
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Linux**: `build-essential` package

Then rebuild:
```bash
npx electron-rebuild
```

### Terminal not resizing properly

The fit addon should handle this automatically. If issues persist, try calling `fitAddon.fit()` after window resize events settle.

### Claude Code not starting

Ensure `claude` is available in your PATH. You can test by running `claude` in a regular terminal.
