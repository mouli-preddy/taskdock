# Copilot Chat Panel Design

## Overview

Add a new right-side panel to the PR tab that embeds an interactive terminal chat session with Copilot or Claude. The chat is primed with PR context data to assist with code review discussions.

## Requirements

- Interactive terminal chat embedded in a right-side panel
- Default to Copilot terminal, with quick toggle to Claude terminal
- Primed with PR context (metadata, comments, file changes)
- Opens in worktree when available, otherwise temp folder
- Fresh session each time panel opens (no persistence)

## Panel Architecture

### New Components

**`CopilotChatPanel`** (`src/ui/components/copilot-chat-panel.ts`)
- Right-side panel similar to AI Comments panel
- Header bar with:
  - Title: "Copilot Chat" or "Claude Chat" (reflects current AI)
  - AI toggle icon button (switch between Copilot/Claude)
  - Close button
- Embedded xterm.js terminal filling panel body
- Resize handle (reuses `ResizablePanels` pattern)

**Panel Button**
- Added to PR tab button bar alongside AI Review, Walkthrough buttons
- Icon: chat/message bubble
- Tooltip: "Copilot Chat"
- Toggle behavior: click opens, click again closes

### State in PRTabState

```typescript
copilotChatPanelOpen: boolean        // Panel visibility
copilotChatAI: 'copilot' | 'claude'  // Which terminal to spawn
```

## Session Lifecycle

### Opening the Panel

1. User clicks Copilot Chat button
2. Panel determines working directory:
   - If worktree exists for PR → use worktree path
   - Otherwise → create temp context folder (like AI Review)
3. Context files prepared in working directory:
   - `context/pr.json` - PR metadata (title, description, author, reviewers)
   - `context/comments.json` - Existing thread comments
   - `context/files.json` - Changed files with diffs
4. Terminal spawned with working directory set
5. Initial prompt injected to prime the LLM

### Initial Prompt

```
You are reviewing PR #{prId}: "{title}".
Context files are available in ./context/ directory.
The user wants to discuss this PR with you.
```

### Closing the Panel

- Terminal process killed (SIGTERM)
- Session discarded (no persistence)
- Temp context folder cleaned up (if not using worktree)

### Switching Tabs

- Same as closing: terminal killed, fresh session when returning

## SDK Toggle & Settings

### Settings

- New setting: `defaultChatAI: 'copilot' | 'claude'` (default: `'copilot'`)
- UI in settings view for default selection

### Toggle Button Behavior

1. User clicks toggle icon in panel header
2. Current terminal session killed
3. `copilotChatAI` state updated
4. New terminal spawned with selected AI
5. Context re-primed (fresh session)

### Availability Check

- Before spawning, verify selected AI CLI is available
- If unavailable, show error in panel and suggest switching

## Terminal Management

### Terminal Component

- xterm.js instance created when panel opens
- Destroyed when panel closes
- Auto-resizes with panel dimensions

### Process Spawning

- Copilot: spawn `copilot` CLI in working directory
- Claude: spawn `claude` CLI in working directory
- stdin/stdout/stderr piped to xterm instance

### Service Integration

**`ChatTerminalService`** (`src/services/chat-terminal-service.ts`)
- `spawnInteractiveTerminal(ai: 'copilot' | 'claude', workingDir: string, initialPrompt: string)`
- Returns process handle for lifecycle management
- Reuses patterns from existing terminal executors

### Cleanup

- Panel close: SIGTERM to process, dispose xterm
- App close: ensure all chat processes terminated
- Tab switch: same as panel close

## File Structure

### New Files

| File | Purpose |
|------|---------|
| `src/ui/components/copilot-chat-panel.ts` | Panel component with terminal |
| `src/services/chat-terminal-service.ts` | Terminal spawning and lifecycle |

### Modified Files

| File | Changes |
|------|---------|
| `src/ui/app.ts` | Add panel state, button, toggle logic |
| `src/ui/components/pr-review-tab.ts` | Integrate panel into layout |
| `src/shared/settings.ts` | Add `defaultChatAI` setting |
| `src/ui/views/settings-view.ts` | Add setting UI |

### Reused Patterns

- `ResizablePanels` - resize handle
- `ReviewContextService` - context file preparation
- `WorktreeService` - worktree path resolution
- Terminal executor patterns - process spawning

## Dependencies

- xterm.js (already in project)
- node-pty (check existing terminal implementation)
