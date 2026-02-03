# TaskDock

A modern Electron-based desktop productivity application with multiple tools for developers.

## Features

### PR Review Tab
Full-featured Azure DevOps Pull Request reviewer:
- **Full PR Details**: View complete pull request information including title, description, author, reviewers, and status
- **File Changes**: Browse all changed files in a tree or flat view
- **Diff Viewer**: Side-by-side or unified diff views with syntax highlighting
- **Comments**: View, create, and reply to comment threads
- **Voting**: Submit review votes (Approve, Approve with suggestions, Wait for author, Reject)
- **AI Code Review**: Get AI-powered code review comments using Claude or GitHub Copilot

### UI Features
- **Modern Design**: Clean, professional interface
- **Dark/Light Theme**: Automatic theme detection with manual override
- **Syntax Highlighting**: 30+ programming languages supported via highlight.js
- **Responsive Layout**: Collapsible sidebar and comments panel
- **Keyboard Shortcuts**: Navigate quickly with keyboard

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `j` | Next file |
| `k` | Previous file |
| `n` | Next comment |
| `p` | Previous comment |
| `Ctrl/Cmd + /` | Toggle comments panel |
| `Escape` | Close dialogs/cancel actions |
| `Ctrl/Cmd + Enter` | Submit comment |

## Prerequisites

- Node.js 20+
- Azure CLI (`az`) installed and logged in
- Access to Azure DevOps organization

## Installation

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Run production build
npm run start
```

## Authentication

The app uses Azure CLI for authentication. Make sure you're logged in:

```bash
# Login to Azure
az login

# Verify access
az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798
```

Alternatively, set a Personal Access Token:
```bash
export AZURE_DEVOPS_PAT=your_pat_here
```

## Usage

1. Launch the application
2. Enter your Azure DevOps organization, project, and PR number
3. Click "Connect"
4. Browse files, view diffs, and add comments

## Project Structure

```
taskdock/
├── src/
│   ├── main/              # Electron main process
│   │   ├── main.ts        # App entry point
│   │   ├── ado-api.ts     # Azure DevOps API client
│   │   ├── ai/            # AI providers for code review
│   │   └── preload.ts     # Context bridge
│   ├── renderer/          # Frontend (Vite)
│   │   ├── index.html     # Main HTML
│   │   ├── app.ts         # Main app logic
│   │   ├── components/    # UI components
│   │   │   ├── diff-viewer.ts
│   │   │   ├── file-tree.ts
│   │   │   ├── comments-panel.ts
│   │   │   ├── ai-comments-panel.ts
│   │   │   ├── walkthrough-ui.ts
│   │   │   └── toast.ts
│   │   ├── utils/         # Utility functions
│   │   └── styles/        # CSS files
│   └── shared/            # Shared types
│       ├── types.ts
│       └── ai-types.ts
├── package.json
├── tsconfig.json
├── tsconfig.main.json
└── vite.config.ts
```

## Technology Stack

- **Electron**: Desktop application framework
- **TypeScript**: Type-safe JavaScript
- **Vite**: Fast frontend build tool
- **diff**: Text diff computation
- **highlight.js**: Syntax highlighting
- **electron-store**: Persistent settings storage
- **Claude SDK**: AI-powered code review
- **GitHub Copilot SDK**: Alternative AI provider

## License

MIT
