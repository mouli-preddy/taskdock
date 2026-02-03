# Multiple Reviews & Walkthroughs Design

## Overview

A system that supports multiple concurrent code reviews and walkthroughs per PR, with customizable presets and user-defined focus areas.

## Key Features

### 1. Multiple Reviews (Tabbed Interface)
- Tab bar in AICommentsPanel for switching between reviews
- Each review runs independently with its own comments
- "+" button to start new reviews
- Auto-generated names from preset/custom prompt

### 2. Multiple Walkthroughs (Sidebar List)
- New "Walkthroughs" section in sidebar
- Click to open walkthrough in floating overlay
- Independent from reviews - can request walkthroughs separately

### 3. Custom Review Focus
- Preset dropdown: built-in presets (Security Audit, Performance, etc.)
- User-created presets saved for reuse
- Custom text field for specific instructions
- Inline preset management (add/edit/delete from dialog)

### 4. Custom Walkthrough Requests
- Dedicated "Request Walkthrough" dialog
- Same preset system as reviews
- Can request explanation of specific scenarios

### 5. Persistence
- All reviews and walkthroughs saved to disk
- Loaded on PR tab open (metadata only)
- User clicks to view - no auto-open
- Presets stored in user data directory

---

## Data Model

### New Types

```typescript
// Review preset (built-in or user-created)
interface ReviewPreset {
  id: string;
  name: string;           // e.g., "Security Audit"
  description?: string;   // Tooltip/help text
  focusAreas: string[];   // Existing focus areas to select
  customPrompt?: string;  // Additional instructions for the agent
  isBuiltIn: boolean;     // true = shipped with app, false = user-created
  createdAt?: string;
  updatedAt?: string;
}

// Walkthrough preset
interface WalkthroughPreset {
  id: string;
  name: string;           // e.g., "Architecture Overview"
  description?: string;
  customPrompt?: string;  // e.g., "Explain the authentication flow"
  isBuiltIn: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Extended session tracking (multiple per PR)
interface PRTabState {
  // ... existing fields ...
  reviewSessions: Map<string, AIReviewSession>;      // sessionId -> session
  walkthroughSessions: Map<string, WalkthroughSession>; // sessionId -> session
  activeReviewTab?: string;   // Currently selected review tab
}

interface WalkthroughSession {
  id: string;
  name: string;           // Auto-generated from preset/prompt
  status: 'preparing' | 'generating' | 'complete' | 'error' | 'cancelled';
  walkthrough?: CodeWalkthrough;
  preset?: WalkthroughPreset;
  customPrompt?: string;
  createdAt: string;
  completedAt?: string;
}
```

### Built-in Presets

**Review Presets:**
- "Quick Scan" - fast overview, all focus areas
- "Security Audit" - focus on security vulnerabilities
- "Performance Review" - focus on performance issues
- "Bug Hunt" - focus on potential bugs and edge cases
- "Code Style" - focus on style and maintainability

**Walkthrough Presets:**
- "Full Overview" - complete PR walkthrough
- "Architecture Changes" - focus on structural changes
- "Data Flow" - explain how data moves through changes
- "Testing Strategy" - explain what tests cover

---

## UI Design

### AICommentsPanel Tab Bar

Horizontal tab bar at the top of the comments panel:
- Each tab shows: `[icon] {Review Name} [×]`
  - Icon: status indicator (spinner=running, checkmark=complete, warning=error)
  - Name: auto-generated from preset or truncated custom prompt
  - ×: close button to remove the review tab
- "+" button at the end to start a new review
- Tabs are scrollable if many reviews exist

Each tab maintains its own:
- Comment list with existing filters (severity, published status)
- Progress indicator during review

### Review Dialog

```
┌─ Start Review ────────────────────────────┐
│                                           │
│ ┌─ Preset ─────────────────────────────┐  │
│ │ [Dropdown: Select preset...       v] │  │
│ │                                      │  │
│ │ ○ Quick Scan                         │  │
│ │ ○ Security Audit                     │  │
│ │ ○ Performance Review                 │  │
│ │ ○ Bug Hunt                           │  │
│ │ ○ Code Style                         │  │
│ │ ── User Presets ──                   │  │
│ │ ○ My Auth Review               [✎]   │  │
│ │ ── Custom ──                         │  │
│ │ ○ Custom... (opens text field)       │  │
│ │                                      │  │
│ │ [+ Save as Preset]  [Manage Presets] │  │
│ └──────────────────────────────────────┘  │
│                                           │
│ ┌─ Custom Instructions ────────────────┐  │
│ │ Focus on authentication error        │  │
│ │ handling and rate limiting...        │  │
│ └──────────────────────────────────────┘  │
│                                           │
│ AI Provider: [Claude Terminal       v]    │
│ Review Depth: [Standard             v]    │
│ Focus Areas: [✓] Security [✓] Bugs ...    │
│ Show Terminal: [✓]                        │
│                                           │
│           [Cancel]  [Start Review]        │
└───────────────────────────────────────────┘
```

### Walkthroughs Sidebar Section

New section below "Terminals":

```
┌─────────────────────────────────────┐
│ ▼ Walkthroughs (2)              [+] │
│   ○ Architecture Changes            │  ← gray = saved, not viewing
│     2 min read · 8 steps            │
│   ○ Custom: auth flow               │
│     3 min read · 12 steps           │
└─────────────────────────────────────┘
```

**Status Indicators:**
- `◐` (spinner) - generating
- `●` (green dot) - complete, currently viewing
- `●` (red dot) - error
- `○` (gray dot) - saved, not currently viewing

**Interactions:**
- Click item → opens WalkthroughUI overlay with that walkthrough
- Hover → shows `×` button to remove from list
- Currently viewing walkthrough highlighted in list

### Walkthrough Dialog

```
┌─ Request Walkthrough ─────────────────────┐
│                                           │
│ ┌─ Preset ─────────────────────────────┐  │
│ │ ○ Full Overview                      │  │
│ │ ○ Architecture Changes               │  │
│ │ ○ Data Flow                          │  │
│ │ ○ Testing Strategy                   │  │
│ │ ── User Presets ──                   │  │
│ │ ○ My API Walkthrough            [✎]  │  │
│ │ ── Custom ──                         │  │
│ │ ○ Custom...                          │  │
│ │                                      │  │
│ │ [+ Save as Preset]  [Manage Presets] │  │
│ └──────────────────────────────────────┘  │
│                                           │
│ ┌─ Custom Request ─────────────────────┐  │
│ │ Explain how user authentication      │  │
│ │ works from login to session mgmt...  │  │
│ └──────────────────────────────────────┘  │
│                                           │
│ AI Provider: [Claude Terminal       v]    │
│ Show Terminal: [✓]                        │
│                                           │
│        [Cancel]  [Generate Walkthrough]   │
└───────────────────────────────────────────┘
```

### WalkthroughUI Overlay Changes

- Add walkthrough name/title at the top
- Small subtitle showing source: "From preset" or "Custom request"

---

## Backend Architecture

### AIReviewService Changes

```typescript
class AIReviewService {
  // Change from single session to multiple per PR
  private sessions: Map<string, AIReviewSession>;  // sessionId -> session

  // New methods
  startReview(request: AIReviewRequest): string;  // returns sessionId
  getSessionsForPR(prId: number): AIReviewSession[];
  removeSession(sessionId: string): void;
}

interface AIReviewRequest {
  // ... existing fields ...
  preset?: ReviewPreset;       // Selected preset (if any)
  customPrompt?: string;       // Custom instructions
  generateWalkthrough: false;  // Always false now (separate flow)
  displayName?: string;        // Auto-generated for tab display
}
```

### New WalkthroughService

```typescript
class WalkthroughService extends EventEmitter {
  private sessions: Map<string, WalkthroughSession>;

  startWalkthrough(request: WalkthroughRequest): string;
  cancelWalkthrough(sessionId: string): void;
  getSession(sessionId: string): WalkthroughSession | undefined;
  getSessionsForPR(prId: number): WalkthroughSession[];
  removeSession(sessionId: string): void;

  // Events: 'progress', 'complete', 'error'
}

interface WalkthroughRequest {
  prId: number;
  organization: string;
  project: string;
  provider: AIProvider;
  preset?: WalkthroughPreset;
  customPrompt?: string;
  showTerminal?: boolean;
  displayName: string;  // Auto-generated
}
```

### New PresetService

```typescript
class PresetService {
  // Stores user presets in app data directory
  private userReviewPresets: ReviewPreset[];
  private userWalkthroughPresets: WalkthroughPreset[];

  // Review presets
  getReviewPresets(): ReviewPreset[];        // built-in + user
  saveReviewPreset(preset: ReviewPreset): void;
  updateReviewPreset(preset: ReviewPreset): void;
  deleteReviewPreset(id: string): void;

  // Walkthrough presets
  getWalkthroughPresets(): WalkthroughPreset[];
  saveWalkthroughPreset(preset: WalkthroughPreset): void;
  updateWalkthroughPreset(preset: WalkthroughPreset): void;
  deleteWalkthroughPreset(id: string): void;
}
```

### New IPC Handlers

```typescript
// Reviews - modified
'ai:start-review'         // Now supports multiple concurrent
'ai:get-sessions-for-pr'  // Get all review sessions for a PR
'ai:remove-session'       // Remove a review session

// Walkthroughs - new
'walkthrough:start'
'walkthrough:cancel'
'walkthrough:get-session'
'walkthrough:get-sessions-for-pr'
'walkthrough:remove-session'

// Presets - new
'presets:get-review-presets'
'presets:save-review-preset'
'presets:update-review-preset'
'presets:delete-review-preset'
'presets:get-walkthrough-presets'
'presets:save-walkthrough-preset'
'presets:update-walkthrough-preset'
'presets:delete-walkthrough-preset'
```

### Prompt Generation

```typescript
function buildReviewPrompt(context: ReviewContext, request: AIReviewRequest): string {
  let prompt = BASE_REVIEW_PROMPT;

  if (request.preset) {
    prompt += `\n\nFocus Areas: ${request.preset.focusAreas.join(', ')}`;
    if (request.preset.customPrompt) {
      prompt += `\n\nPreset Instructions: ${request.preset.customPrompt}`;
    }
  }

  if (request.customPrompt) {
    prompt += `\n\nAdditional Instructions from User:\n${request.customPrompt}`;
  }

  return prompt;
}
```

---

## Storage & Persistence

### Preset Storage

**Location:** `{userData}/presets/`
```
{userData}/
└── presets/
    ├── review-presets.json
    └── walkthrough-presets.json
```

**Format:**
```json
{
  "version": 1,
  "presets": [
    {
      "id": "user-preset-abc123",
      "name": "My Auth Review",
      "description": "Deep dive into authentication code",
      "focusAreas": ["security", "bugs"],
      "customPrompt": "Pay special attention to token handling",
      "isBuiltIn": false,
      "createdAt": "2026-01-26T...",
      "updatedAt": "2026-01-26T..."
    }
  ]
}
```

### Review & Walkthrough Storage

**Location:**
```
{userData}/
└── reviews/
    └── {org}/
        └── {project}/
            └── {prId}/
                ├── review-{sessionId}.json
                ├── walkthrough-{sessionId}.json
                └── ...
```

### Loading Behavior

**On PR Tab Open:**
1. Scan storage directory for saved reviews & walkthroughs
2. Load metadata only (name, status, date, sessionId)
3. Reviews: Populate tab bar with inactive tabs showing saved review names
4. Walkthroughs: Populate sidebar list with saved walkthrough items
5. **No tab/panel auto-selected** - user navigates and clicks to open

**On User Selection:**
- User clicks a review tab → load full comments from file, display in panel
- User clicks a walkthrough in sidebar → load full walkthrough, open overlay

**Visual States:**

| State | Review Tab | Walkthrough Item |
|-------|-----------|------------------|
| Saved, not loaded | Gray text | Gray dot `○` |
| Loaded, active | Blue highlight | Green dot `●`, highlighted |
| Running | Spinner icon | Spinner `◐` |
| Error | Red icon | Red dot `●` (red) |

---

## Files to Modify

### Main Process
- `src/main/ai/ai-review-service.ts` - multi-session support
- `src/main/ai/walkthrough-service.ts` - **new**
- `src/main/ai/preset-service.ts` - **new**
- `src/main/main.ts` - new IPC handlers
- `src/main/preload.ts` + `preload.cjs` - new APIs
- `src/shared/ai-types.ts` - new types

### Renderer
- `src/renderer/components/ai-comments-panel.ts` - tab bar
- `src/renderer/components/walkthrough-ui.ts` - header updates
- `src/renderer/components/walkthroughs-view.ts` - **new** sidebar section
- `src/renderer/components/review-dialog.ts` - preset UI (or update existing dialog code)
- `src/renderer/components/walkthrough-dialog.ts` - **new**
- `src/renderer/app.ts` - wire up new components
