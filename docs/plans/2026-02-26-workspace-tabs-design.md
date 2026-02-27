# Workspace Tabs Design

## Overview

Add a "Workspaces" section to the sidebar that lets users group related CFV calls, log searches, and ICM incidents into named investigation contexts. Each workspace contains mixed-type subtabs, allowing users to keep all artifacts of an investigation in one place.

## Requirements

- Workspaces is a new section in the existing sidebar (alongside CFV, DGrep, ICM, etc.)
- Each workspace has a user-editable name and contains a flat list of mixed-type subtabs
- Subtab types for v1: CFV calls, DGrep searches, ICM incidents
- Users move items to workspaces via right-click context menu on tabs in original sections
- Moving relocates the tab (removes from original section)
- Cross-references within a workspace subtab open as new subtabs in the same workspace
- Workspaces persist across app restarts
- Views stay mounted when switching subtabs (CSS hide/show)

## Architecture: Workspace as View Orchestrator

The workspace section manages a flat list of subtabs per workspace. Each subtab stores a `type` + `state` payload. When activated, the workspace instantiates the correct existing view component and passes it saved state. Existing view components are reused unchanged.

## Data Model

```typescript
interface Workspace {
  id: string;                    // uuid
  name: string;                  // user-editable label
  subtabs: WorkspaceSubtab[];
  activeSubtabId: string | null;
  createdAt: number;
}

interface WorkspaceSubtab {
  id: string;                    // uuid
  type: 'cfv' | 'dgrep' | 'icm';
  label: string;                 // e.g. "CFV abc123" or "INC-456"
  icon: string;                  // type-specific icon
  state: CfvSubtabState | DgrepSubtabState | IcmSubtabState;
}

interface CfvSubtabState {
  callId: string;
}

interface DgrepSubtabState {
  searchQuery: string;
  timeRange: { start: string; end: string };
}

interface IcmSubtabState {
  incidentId: number;
}
```

## UI Layout

```
┌──────────────────────────────────────────────────┐
│ Title Bar                                        │
├────┬─────────────────────────────────────────────┤
│    │ [Investigation 1] [INC-789] [+]             │  ← workspace tab bar
│ CFV├─────────────────────────────────────────────┤
│ Log│ [CFV-abc] [Logs] [INC-456]                  │  ← subtab bar (mixed types)
│ ICM├─────────────────────────────────────────────┤
│    │                                             │
│ WS │        Active subtab content                │
│    │        (full view component)                │
│    │                                             │
└────┴─────────────────────────────────────────────┘
```

### New Components

- **`workspace-section.ts`** - Section content container. Manages workspace tab bar + subtab bar + content panels.
- **`workspace-tab-bar.ts`** - Workspace-level tabs (may reuse existing TabBar with [+] button). Right-click for rename/delete.
- **`workspace.css`** - Workspace-specific styles.
- **`workspace-types.ts`** - Shared type definitions.

### Context Menu on Original Section Tabs

```
┌──────────────────────────┐
│ Move to Workspace ►      │
│  ├ New Workspace...      │
│  ├ Investigation 1       │
│  └ INC-789               │
└──────────────────────────┘
```

## View Lifecycle

### Moving a tab to a workspace

1. User right-clicks a tab → selects "Move to Workspace > [target]"
2. Extract the view's current state (call ID, search query, etc.)
3. Create a `WorkspaceSubtab` with type + state
4. Remove the tab from the original section (close, clean up DOM)
5. Add the subtab to the target workspace

### Activating a subtab

1. User clicks a subtab in the workspace
2. Hide current subtab's view (CSS `display: none`, not unmounted)
3. If the new subtab has an existing view instance → show it
4. If first time activating → instantiate the view component from saved state, mount into a new panel div

### Cross-reference navigation

When a workspace-hosted view triggers navigation (e.g. clicking a CFV link from an incident), a navigation interceptor redirects the call to the workspace's `addSubtab()` instead of the original section. This callback is passed to views when they're workspace-hosted.

## Persistence

### Storage

File: `~/.taskdock/workspaces.json`

```json
{
  "workspaces": [
    {
      "id": "ws-1",
      "name": "Investigation 1",
      "activeSubtabId": "st-2",
      "createdAt": 1740000000000,
      "subtabs": [
        { "id": "st-1", "type": "icm", "label": "INC-456", "state": { "incidentId": 456 } },
        { "id": "st-2", "type": "cfv", "label": "CFV abc123", "state": { "callId": "abc123" } }
      ]
    }
  ],
  "activeWorkspaceId": "ws-1"
}
```

### Save triggers

- Workspace created/renamed/deleted
- Subtab added/removed
- Active workspace or active subtab changes
- App shutdown

### Restoration

1. Load `workspaces.json` at startup
2. Rebuild workspace tab bar and subtab bars (lightweight - just labels/icons)
3. Lazy instantiation - views only created when user navigates to workspace section AND activates a subtab

### Minimum restorable state (v1)

- **CFV**: `callId` (re-fetched from service)
- **ICM**: `incidentId` (re-fetched)
- **DGrep**: `searchQuery` + `timeRange` (re-executed on open)

## Modified Files

- `src/renderer/app.ts` - add workspace section to sidebar, wire context menus, navigation interceptor
- `src/renderer/components/section-sidebar.ts` - add Workspaces entry
- CFV/DGrep/ICM tab bars - add context menu for "Move to Workspace"

## Out of Scope (v1)

- Drag-and-drop reordering
- Auto-populating from incidents
- Workspace sharing/export
- PR Review and Work Items subtab types
