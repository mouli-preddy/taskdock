# Vertical Tab Sections UI Restructure

## Overview

Restructure the TaskDock client from screen-based navigation to a section-based tabbed interface with vertical section sidebar and horizontal tab bars.

## Layout Structure

```
┌─────────────────────────────────────────────────────────┐
│ [≡] │  Tab1  │  Tab2  │  Tab3  │              [x][x][x] │
├─────┼───────────────────────────────────────────────────┤
│     │                                                   │
│ 📋  │                                                   │
│     │                                                   │
│ ⚙️  │              Content Area                         │
│     │                                                   │
│     │                                                   │
│     │                                                   │
└─────┴───────────────────────────────────────────────────┘
```

- **Section Sidebar** (left): Collapsible, icons by default (~48px), expands on hover (~180px) to show labels
- **Tab Bar** (top): Horizontal tabs for the active section
- **Content Area**: Displays the active tab's content

## Sections

### Review Section
- **Home Tab**: PR List (For Review / Created by Me). Cannot be closed.
- **PR Tabs**: Opened when clicking a PR. Label format: `repo/#1234`. Closeable. Unlimited tabs allowed.

Each PR tab maintains its own state:
- Selected file
- Diff view mode (split/unified)
- Comments panel open/closed
- AI comments panel open/closed
- Scroll position

### Settings Section
- **Review Tab**: ADO configuration (organization, project, PAT). Cannot be closed.

## Configuration Storage

Location: `C:\Users\kirmadi\AppData\Roaming\taskdock\config.json`

```json
{
  "ado": {
    "organization": "https://dev.azure.com/myorg",
    "project": "MyProject",
    "pat": "token-value"
  }
}
```

## First Launch Flow

1. App starts, checks if config exists and is valid
2. If not configured: show modal "Welcome! Please configure your Azure DevOps connection to get started."
3. Modal "Go to Settings" button navigates to Settings > Review tab
4. After saving valid config: dismiss modal, switch to Review section

## Tab Interactions

- Click: Switch to tab
- Middle-click: Close tab (if closeable)
- Right-click: Context menu (Close, Close Others, Close All)
- Close button (×): Close tab (if closeable)

## Component Architecture

### New Components

1. **SectionSidebar** (`src/renderer/components/section-sidebar.ts`)
   - Vertical icon list for sections
   - Expand/collapse on hover
   - Events: `onSectionSelect(section: 'review' | 'settings')`

2. **TabBar** (`src/renderer/components/tab-bar.ts`)
   - Horizontal tabs for active section
   - Close buttons, middle-click support
   - Events: `onTabSelect(tabId)`, `onTabClose(tabId)`

3. **TabManager** (`src/renderer/components/tab-manager.ts`)
   - Manages tab state per section
   - Tab creation, removal, state preservation
   - Stores: open tabs, active tab, tab order

4. **SettingsView** (`src/renderer/components/settings-view.ts`)
   - Settings form UI
   - Save/test connection functionality
   - IPC to main process for config persistence

### Modified Components

- **PRReviewApp** (`src/renderer/app.ts`): Orchestrates sections/tabs instead of screens
- **Main process**: Config loading/saving via IPC

### State Structure

```typescript
interface AppState {
  activeSection: 'review' | 'settings';
  review: {
    tabs: ReviewTab[];
    activeTabId: string;
  };
  settings: {
    tabs: SettingsTab[];
    activeTabId: string;
  };
}

interface ReviewTab {
  id: string;
  type: 'home' | 'pr';
  label: string;
  closeable: boolean;
  // PR-specific state (if type === 'pr')
  prState?: {
    org: string;
    project: string;
    repoName: string;
    prId: number;
    selectedFile: string | null;
    diffViewMode: 'split' | 'unified';
    commentsOpen: boolean;
    aiCommentsOpen: boolean;
    scrollPosition: number;
  };
}

interface SettingsTab {
  id: string;
  type: 'review';  // More types can be added later
  label: string;
  closeable: boolean;
}
```

## CSS Changes

- New styles for section sidebar (collapsed/expanded states)
- New styles for tab bar (tabs, close buttons, active state)
- Update main layout grid to accommodate new structure
