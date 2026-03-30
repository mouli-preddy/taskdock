# TaskDock

A modern Tauri-based desktop productivity application with multiple tools for developers.

## Features

### PR Review Tab
Full-featured Azure DevOps Pull Request reviewer:
- **Full PR Details**: View PR title, description, author, status, reviewers, labels, and metadata
- **PR Iterations**: Browse different iterations with change history
- **File Tree View**: Browse files in tree, flat, or grouped view modes
- **Diff Viewer**: Side-by-side, unified, or preview diff views with syntax highlighting
- **Comments**: View, create, reply, edit, and delete comment threads
- **Comment Status**: Track status (active, fixed, won't fix, closed, by design, pending)
- **Voting**: Submit review votes (Approve, Approve with suggestions, Wait for author, Reject)
- **Reviewed File Tracking**: Mark files as reviewed with persistent state
- **Generated Files Filtering**: Hide/show generated files based on glob patterns

### AI-Powered Review
- **AI Code Review**: Generate review comments using Claude or GitHub Copilot
- **Review Presets**: Built-in profiles (Quick Scan, Security Audit, Performance Review, Bug Hunt, Code Style)
- **Custom Review Prompts**: Define custom review instructions
- **Review Depth**: Quick, Standard, or Thorough review levels
- **Focus Areas**: Filter by security, performance, bugs, or style
- **Comment Severity**: Critical, Warning, Suggestion, Praise levels
- **Suggested Code Fixes**: View and apply AI-suggested code changes
- **Publish AI Comments**: Convert AI comments to official PR comments

### AI Walkthrough
- **Guided Walkthroughs**: Step-by-step AI-guided explanation of changes
- **Architecture Diagrams**: Mermaid diagrams rendered in walkthroughs
- **Walkthrough Presets**: Full Overview, Architecture Changes, Data Flow, Testing Strategy
- **Custom Walkthrough Prompts**: Define custom generation instructions
- **Floating UI**: Draggable, resizable walkthrough panel
- **Read Time Estimation**: Estimated time to complete walkthrough

### PR Comment Analysis & Auto-Fix
- **Auto-analyze Comments**: AI-powered analysis of PR comments
- **Comment Analysis Dashboard**: Recommended actions (fix, reply, clarify)
- **Auto-fix from Comments**: Automatic code fixes based on PR feedback
- **Apply Changes Queue**: Queue system with status tracking
- **Commit Creation**: Auto-generate git commits for applied fixes

### PR Chat
- **Copilot Chat Panel**: Interactive AI chat for PR questions
- **Claude Chat Panel**: Alternative AI chat provider
- **Context-Aware Chat**: Chat understands full PR context
- **Switch Providers**: Toggle between Copilot and Claude mid-chat

### PR Home
- **My PRs**: List of PRs assigned to you for review
- **Created PRs**: List of PRs you created
- **Monitored Repositories**: Track PRs from selected repositories
- **Auto-polling**: Automatic PR refresh at configurable intervals

### Work Items Tab
- **My Assigned Items**: View work items assigned to you
- **Items Created By Me**: View work items you created
- **Custom Queries**: Build and save custom WIQL queries
- **Query Builder**: Visual interface to build queries
- **Import ADO Queries**: Import queries from Azure DevOps
- **Work Item Details**: Full item view with description, comments, attachments, relations
- **Wiki Integration**: Browse, search, create, and edit project wikis

### Terminals Tab
- **Multiple Terminal Sessions**: Open and manage multiple terminal tabs
- **AI Review Sessions**: Run AI reviews in console for detailed output
- **Linked Repositories**: Monitor linked git repositories
- **Worktree Support**: Automatic worktree creation for isolated reviews

### Settings
- **Azure DevOps Connection**: Configure organization, project, and authentication
- **AI Configuration**: Choose default providers for chat, analysis, and fixes
- **Generated Files Patterns**: Define glob patterns for files to exclude
- **Polling Settings**: Configure auto-refresh interval
- **WorkIQ Integration**: Enable Microsoft 365 data for context

### UI Features
- **Modern Design**: Clean, professional interface
- **Dark/Light Theme**: Automatic theme detection with manual override
- **Syntax Highlighting**: 30+ programming languages supported via highlight.js
- **Mermaid Diagrams**: Render mermaid diagrams in markdown
- **Resizable Panels**: Resize sidebar, diff viewer, and comments panels
- **Collapsible Sidebar**: Hide/show left navigation
- **Toast Notifications**: Temporary messages for user feedback

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
| Double-click resize handle | Reset panel to default width |

## Prerequisites

- Node.js 20+
- Rust (install from [rust-lang.org](https://rust-lang.org/tools/install/))
- Azure CLI (`az`) installed and logged in
- Access to Azure DevOps organization

## Developer Tools Setup (Windows)

### Azure CLI

The Azure CLI is required for authentication with Azure DevOps.

```powershell
winget install --exact --id Microsoft.AzureCLI
```

Verify installation:
```powershell
az version
```

For more details, see the [Azure CLI documentation](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-windows).

### Rust

Rust is required to build the Tauri backend. Install it from [https://rust-lang.org/tools/install/](https://rust-lang.org/tools/install/).

Verify installation:
```powershell
rustc --version
cargo --version
```

### Claude Code

Claude Code is Anthropic's agentic coding tool for your terminal.

```powershell
irm https://claude.ai/install.ps1 | iex
```

After installation, authenticate with your Claude Pro/Max subscription or Anthropic Console credentials:
```powershell
claude
```

Run `claude doctor` to troubleshoot any issues.

For more details, see the [Claude Code setup guide](https://code.claude.com/docs/en/setup).

### GitHub Copilot CLI

GitHub Copilot CLI brings the power of Copilot directly to your terminal.

**Prerequisites:** Active GitHub Copilot subscription (Pro, Pro+, Business, or Enterprise)

```powershell
winget install GitHub.Copilot
```

Launch and authenticate:
```powershell
copilot
```

On first launch, use the `/login` command to authenticate with GitHub.

For more details, see the [GitHub Copilot CLI documentation](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli).

### WorkIQ

[WorkIQ](https://github.com/microsoft/work-iq-mcp) connects AI assistants to your Microsoft 365 Copilot data (emails, meetings, documents, Teams messages, etc.).

**Prerequisites:** Admin consent required for Microsoft 365 tenant access

**Install for GitHub Copilot CLI:**
```powershell
copilot
# Then run these commands inside Copilot CLI:
/plugin marketplace add github/copilot-plugins
/plugin install workiq@copilot-plugins
```

**Install for Claude Code:**
```powershell
claude mcp add --transport stdio workiq -- npx -y @microsoft/workiq mcp
```

On first use, open Claude Code and ask it to "use workiq to accept eula".

Restart your CLI after installation. You can then query your M365 data naturally:
- "What are my upcoming meetings this week?"
- "Summarize emails from Sarah about the budget"
- "Find documents I worked on yesterday"

For more details, see the [WorkIQ documentation](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/workiq-overview).

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

## Technology Stack

- **Tauri**: Desktop application framework
- **TypeScript**: Type-safe JavaScript
- **Vite**: Fast frontend build tool
- **diff**: Text diff computation
- **highlight.js**: Syntax highlighting
- **Claude SDK**: AI-powered code review
- **GitHub Copilot SDK**: Alternative AI provider

## Publishing & Auto-Updates

TaskDock uses `tauri-plugin-updater` for automatic updates. When a new version is released, running instances will detect it on startup (and every 24 hours) and show an "Install & Restart" toast. Users can also check manually via **Settings → Updates → Check for Updates**.

### One-Time Setup

**1. Generate a signing keypair** (only needed once per repo):

```bash
npm run tauri -- signer generate -w ~/.tauri/taskdock.key
```

This creates `~/.tauri/taskdock.key` (private) and `~/.tauri/taskdock.key.pub` (public).

**2. Update `src-tauri/tauri.conf.json`** with the public key and your GitHub repo:

```json
"updater": {
  "pubkey": "<contents of taskdock.key.pub>",
  "endpoints": [
    "https://github.com/OWNER/REPO/releases/latest/download/latest.json"
  ],
  "dialog": false
}
```

**3. Add two GitHub Secrets** at `https://github.com/OWNER/REPO/settings/secrets/actions`:

| Secret | Value |
|--------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `~/.tauri/taskdock.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password used during keygen (leave empty if none) |

Or use the GitHub CLI:
```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY -R OWNER/REPO --body "$(cat ~/.tauri/taskdock.key)"
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R OWNER/REPO --body ""
```

### Releasing a New Version

**1. Bump the version** across all manifests (`tauri.conf.json`, `Cargo.toml`, `package.json`):

```bash
npm run version:bump 0.0.7
```

**2. Commit and push the version bump:**

```bash
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml package.json
git commit -m "chore: bump version to 0.0.7"
git push
```

**3. Build and publish the release locally:**

```bash
npm run publish-release
```

This script (`scripts/publish-release.ps1`):
- Builds the renderer, sidecar, and Tauri app
- Signs the installers using `~/.tauri/taskdock.key`
- Creates a GitHub Release with the NSIS installer, MSI installer, and `latest.json` update manifest

Running instances on older versions will detect the update automatically.

## License

MIT