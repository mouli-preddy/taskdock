# CFV Call Flow Filter & Mark System

## Overview

Add a comprehensive filtering and marking system to the CFV Call Flow sequence diagram. Users can create multiple filter/mark rules with different highlight colors, combine conditions with arbitrary AND/OR/NOT nesting, filter by text, sequence ranges, time ranges, services, and status codes. Filters persist per-call and can be saved as reusable presets.

## Data Model

```typescript
// Filter condition types
type FilterCondition =
  | { type: 'text-contains'; field: 'label' | 'from' | 'to' | 'any'; value: string; caseSensitive?: boolean }
  | { type: 'text-not-contains'; field: 'label' | 'from' | 'to' | 'any'; value: string; caseSensitive?: boolean }
  | { type: 'regex'; field: 'label' | 'from' | 'to' | 'any'; pattern: string }
  | { type: 'seq-range'; from: number; to: number }
  | { type: 'time-range'; from: string; to: string }  // HH:MM:SS.mmm
  | { type: 'service'; column: string; direction: 'from' | 'to' | 'either' }
  | { type: 'status'; operator: 'eq' | 'gte' | 'lt'; code: number }
  | { type: 'failure'; failureOnly: boolean }

// Recursive group for AND/OR nesting
interface FilterGroup {
  operator: 'and' | 'or'
  conditions: (FilterCondition | FilterGroup)[]
  negate?: boolean  // wraps the whole group in NOT
}

// A single filter rule (what appears as a chip)
interface FilterRule {
  id: string
  name?: string
  mode: 'mark' | 'filter'
  color: string          // from palette
  group: FilterGroup     // the actual conditions
  enabled: boolean       // toggle on/off without deleting
}

// Saved preset (reusable across calls)
interface FilterPreset {
  id: string
  name: string
  rules: FilterRule[]
}

// Per-call persisted state
interface CallFilterState {
  rules: FilterRule[]
  showMatchedOnly: boolean  // global toggle
}
```

Every filter chip is a `FilterRule` containing a recursive `FilterGroup` tree. This supports arbitrary nesting while keeping the top-level UI simple.

## Color Palette

```typescript
const FILTER_COLORS = [
  '#4A9EFF', // blue
  '#FF6B6B', // red
  '#51CF66', // green
  '#FFD43B', // yellow
  '#CC5DE8', // purple
  '#FF922B', // orange
  '#20C997', // teal
  '#F06595', // pink
]
```

## UI Design

### Filter Toolbar

Sits between the column headers and the message rows (~32px height):

- **Left side:** Filter icon + "Add Filter" button + active filter chips
- **Each chip shows:** color dot, rule summary text (truncated), mode icon (eye for filter, highlighter for mark), enabled toggle, X to remove
- **Right side:** "Show matched only" toggle switch + "Presets" dropdown button
- When no filters active, shows subtle "No filters" placeholder

### Filter Builder Dropdown

Opens below toolbar as an overlay (doesn't push content). Triggered by "Add Filter" or clicking a chip to edit. Max height ~400px, scrollable.

```
┌─────────────────────────────────────────────────┐
│ Rule Name: [optional text field]    Color: [●]  │
│ Mode: [Mark ○ | ● Filter]                       │
│─────────────────────────────────────────────────│
│ ┌─ AND ──────────────────────────── [+ | OR] ─┐ │
│ │ [label ▼] [contains ▼] [________] [× ]     │ │
│ │ [from  ▼] [equals   ▼] [________] [× ]     │ │
│ │ ┌─ OR ─────────────────────── [+ | AND] ─┐  │ │
│ │ │ [status ▼] [>=  ▼] [400     ] [× ]    │  │ │
│ │ │ [failure▼] [is  ▼] [true    ] [× ]    │  │ │
│ │ └────────────────────────────────────────┘  │ │
│ └─────────────────────────────────────────────┘ │
│                          [Cancel]  [Apply]      │
└─────────────────────────────────────────────────┘
```

- Each condition row: field selector, operator selector, value input, remove button
- Groups show operator (AND/OR) as label on left border
- "+" adds condition to current group
- "OR"/"AND" button wraps into nested sub-group
- Negate checkbox on each group for NOT logic

### Presets Dropdown

- Lists saved presets with "Apply" button each
- "Save current filters as preset" at bottom
- "Manage presets" to rename/delete

## Filter Engine

Pure functions that evaluate filter rules against messages.

```typescript
function evaluateGroup(group: FilterGroup, msg: CallFlowMessage): boolean {
  const result = group.operator === 'and'
    ? group.conditions.every(c => evaluateNode(c, msg))
    : group.conditions.some(c => evaluateNode(c, msg))
  return group.negate ? !result : result
}

function evaluateNode(node: FilterCondition | FilterGroup, msg): boolean {
  if ('operator' in node) return evaluateGroup(node, msg)
  return evaluateCondition(node, msg)
}
```

**Field resolution:** `'any'` searches across label + from + to + req + resp concatenated.

**Time range matching:** Parses `HH:MM:SS.mmm` from message `time` field, compares as milliseconds-since-midnight.

**Sequence range:** Compares against `msg.index`.

### Processing Pipeline

1. Start with all messages for the call (not just current page)
2. For each message, evaluate every enabled `FilterRule`
3. Build a `Map<number, { visible: boolean, marks: {color, ruleId}[] }>`
   - A message is **marked** if any mark-mode rule matches
   - A message is **filtered out** if no filter-mode rule matches (when filter rules exist)
   - If `showMatchedOnly` is on, also hide unmarked rows
4. Pass this map to the renderer for visibility + highlight colors
5. Pagination operates on visible rows; sequence numbers stay original

Performance: Filter engine runs on full message array (hundreds to low thousands) synchronously on every change.

## Rendering Changes

### Row Rendering

- Rows keep original `#` sequence number — gaps signal hidden rows
- Marked rows: left border stack (2px per mark color) + subtle background tint (~8% opacity of primary mark color)
- Multiple overlapping marks: stacked left borders, background uses first mark's color
- Hidden rows simply not rendered

### Pagination

- Pages over **visible** messages only (page 1 = first 50 visible, etc.)
- Status text: "Showing 23 of 847 messages (3 filters active)"
- Page count updates to reflect filtered count

### Detail Modal

- Show which filter rules matched the row (small colored dots at top of modal)

## Persistence

### Per-Call Filters

- Save `CallFilterState` to `%LOCALAPPDATA%/BrainBot/cfv_calls/{callId}/filters.json`
- Load on call open, save on every filter change (debounced 500ms)
- No backend API needed beyond simple file I/O

### Named Presets

- Stored at `%LOCALAPPDATA%/BrainBot/cfv_filter_presets.json`
- Array of `FilterPreset` objects
- "Apply preset" copies rules into current call (not linked)
- "Save as preset" snapshots current rules with user-provided name
- "Update preset" option when rules originated from a preset

### Backend API

```typescript
cfvSaveCallFilters(callId: string, state: CallFilterState): Promise<void>
cfvLoadCallFilters(callId: string): Promise<CallFilterState | null>
cfvListFilterPresets(): Promise<FilterPreset[]>
cfvSaveFilterPreset(preset: FilterPreset): Promise<void>
cfvDeleteFilterPreset(presetId: string): Promise<void>
```

## File Structure

### New Files

- `src/shared/cfv-filter-types.ts` — All types
- `src/renderer/components/cfv/cfv-filter-toolbar.ts` — Toolbar + chips + global toggle
- `src/renderer/components/cfv/cfv-filter-builder.ts` — Dropdown panel with recursive group builder
- `src/renderer/components/cfv/cfv-filter-engine.ts` — Pure evaluation functions
- `src/main/cfv/cfv-filter-service.ts` — Persistence (per-call + presets)

### Modified Files

- `src/renderer/components/cfv/cfv-callflow-panel.ts` — Integrate toolbar, apply filters, update pagination
- `src/renderer/styles/cfv.css` — Filter toolbar, chips, builder, mark highlight styles
- `src/shared/cfv-types.ts` — Filter API function signatures
- `src/renderer/tauri-api.ts` — Filter persistence API bindings
- `src-backend/bridge.ts` — Register filter commands

## Implementation Order

1. Types + filter engine (testable in isolation)
2. Backend persistence (simple file I/O)
3. Filter toolbar + chips (visible UI)
4. Filter builder dropdown (complex UI)
5. Integration into callflow panel (rendering + pagination)
6. Presets UI
7. Polish (colors, animations, edge cases)

## Out of Scope

- Filtering on other tabs (drill down, raw events, QoE)
- Keyboard shortcuts for filter operations
- Filter import/export
- Undo/redo for filter changes
