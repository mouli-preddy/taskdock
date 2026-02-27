# CFV Filter System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a comprehensive filter/mark system to the CFV call flow sequence diagram with persistence and reusable presets.

**Architecture:** Frontend-driven filter engine with backend file I/O for persistence. Filter toolbar overlays the sequence diagram, filter builder opens as a dropdown panel. All filter evaluation happens client-side for instant feedback.

**Tech Stack:** TypeScript, vanilla DOM (matching existing CFV components pattern — no frameworks), WebSocket RPC bridge for backend persistence.

---

### Task 1: Create shared filter types

**Files:**
- Create: `src/shared/cfv-filter-types.ts`

**Step 1: Write the types file**

Create `src/shared/cfv-filter-types.ts` with all filter data model types. Copy exactly from the design doc Section 1 — `FilterCondition`, `FilterGroup`, `FilterRule`, `FilterPreset`, `CallFilterState`, plus the `FILTER_COLORS` palette and a `FILTER_FIELDS` array for UI dropdowns.

```typescript
// src/shared/cfv-filter-types.ts

export type FilterField = 'label' | 'from' | 'to' | 'any';

export type FilterCondition =
  | { type: 'text-contains'; field: FilterField; value: string; caseSensitive?: boolean }
  | { type: 'text-not-contains'; field: FilterField; value: string; caseSensitive?: boolean }
  | { type: 'regex'; field: FilterField; pattern: string }
  | { type: 'seq-range'; from: number; to: number }
  | { type: 'time-range'; from: string; to: string }
  | { type: 'service'; column: string; direction: 'from' | 'to' | 'either' }
  | { type: 'status'; operator: 'eq' | 'gte' | 'lt'; code: number }
  | { type: 'failure'; failureOnly: boolean };

export interface FilterGroup {
  operator: 'and' | 'or';
  conditions: (FilterCondition | FilterGroup)[];
  negate?: boolean;
}

export interface FilterRule {
  id: string;
  name?: string;
  mode: 'mark' | 'filter';
  color: string;
  group: FilterGroup;
  enabled: boolean;
}

export interface FilterPreset {
  id: string;
  name: string;
  rules: FilterRule[];
}

export interface CallFilterState {
  rules: FilterRule[];
  showMatchedOnly: boolean;
}

export const FILTER_COLORS = [
  '#4A9EFF', // blue
  '#FF6B6B', // red
  '#51CF66', // green
  '#FFD43B', // yellow
  '#CC5DE8', // purple
  '#FF922B', // orange
  '#20C997', // teal
  '#F06595', // pink
] as const;

export const FILTER_CONDITION_TYPES = [
  'text-contains', 'text-not-contains', 'regex',
  'seq-range', 'time-range', 'service', 'status', 'failure',
] as const;

export const FILTER_FIELDS: { value: FilterField; label: string }[] = [
  { value: 'any', label: 'Any Field' },
  { value: 'label', label: 'Description' },
  { value: 'from', label: 'From Service' },
  { value: 'to', label: 'To Service' },
];

export function isFilterGroup(node: FilterCondition | FilterGroup): node is FilterGroup {
  return 'operator' in node;
}

export function createEmptyFilterState(): CallFilterState {
  return { rules: [], showMatchedOnly: false };
}

export function generateFilterId(): string {
  return `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultFilterRule(colorIndex: number): FilterRule {
  return {
    id: generateFilterId(),
    mode: 'filter',
    color: FILTER_COLORS[colorIndex % FILTER_COLORS.length],
    group: { operator: 'and', conditions: [{ type: 'text-contains', field: 'any', value: '' }] },
    enabled: true,
  };
}

/** Build a human-readable summary of a FilterRule for chip display */
export function summarizeRule(rule: FilterRule): string {
  if (rule.name) return rule.name;
  const conditions = rule.group.conditions;
  if (conditions.length === 0) return '(empty)';
  const first = conditions[0];
  if (isFilterGroup(first)) {
    return `${rule.group.operator.toUpperCase()} group (${conditions.length})`;
  }
  const desc = summarizeCondition(first);
  if (conditions.length === 1) return desc;
  return `${desc} +${conditions.length - 1}`;
}

function summarizeCondition(c: FilterCondition): string {
  switch (c.type) {
    case 'text-contains': return `${c.field} ~ "${truncate(c.value, 15)}"`;
    case 'text-not-contains': return `${c.field} !~ "${truncate(c.value, 15)}"`;
    case 'regex': return `${c.field} /${truncate(c.pattern, 15)}/`;
    case 'seq-range': return `#${c.from}-${c.to}`;
    case 'time-range': return `${c.from}-${c.to}`;
    case 'service': return `${c.direction} ${c.column}`;
    case 'status': return `status ${c.operator} ${c.code}`;
    case 'failure': return 'failures';
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}
```

**Step 2: Commit**

```bash
git add src/shared/cfv-filter-types.ts
git commit -m "feat(cfv): add shared filter type definitions"
```

---

### Task 2: Create the filter engine

**Files:**
- Create: `src/renderer/components/cfv/cfv-filter-engine.ts`

**Step 1: Write the filter engine**

This is a pure module — no DOM, no side effects. It evaluates `FilterRule[]` against `CallFlowMessage[]` and returns a results map.

```typescript
// src/renderer/components/cfv/cfv-filter-engine.ts

import type { CallFlowMessage } from '../../../main/cfv/cfv-types.js';
import type { FilterCondition, FilterGroup, FilterRule, CallFilterState } from '../../../shared/cfv-filter-types.js';
import { isFilterGroup } from '../../../shared/cfv-filter-types.js';

export interface FilterResult {
  visible: boolean;
  marks: { color: string; ruleId: string }[];
}

/**
 * Evaluate all filter rules against all messages.
 * Returns a Map keyed by message index.
 */
export function evaluateFilters(
  messages: CallFlowMessage[],
  state: CallFilterState
): Map<number, FilterResult> {
  const results = new Map<number, FilterResult>();
  const enabledRules = state.rules.filter(r => r.enabled);
  const filterRules = enabledRules.filter(r => r.mode === 'filter');
  const markRules = enabledRules.filter(r => r.mode === 'mark');
  const hasFilterRules = filterRules.length > 0;

  for (const msg of messages) {
    const marks: { color: string; ruleId: string }[] = [];

    // Check mark rules
    for (const rule of markRules) {
      if (evaluateGroup(rule.group, msg)) {
        marks.push({ color: rule.color, ruleId: rule.id });
      }
    }

    // Check filter rules — message is visible if ANY filter rule matches
    let passesFilter = true;
    if (hasFilterRules) {
      passesFilter = filterRules.some(rule => evaluateGroup(rule.group, msg));
    }

    // showMatchedOnly hides rows with no marks and no filter match
    let visible = passesFilter;
    if (state.showMatchedOnly && marks.length === 0 && !hasFilterRules) {
      visible = false;
    }
    if (state.showMatchedOnly && hasFilterRules && marks.length === 0 && !passesFilter) {
      visible = false;
    }

    results.set(msg.index, { visible, marks });
  }

  return results;
}

export function evaluateGroup(group: FilterGroup, msg: CallFlowMessage): boolean {
  if (group.conditions.length === 0) return true;
  const result = group.operator === 'and'
    ? group.conditions.every(c => evaluateNode(c, msg))
    : group.conditions.some(c => evaluateNode(c, msg));
  return group.negate ? !result : result;
}

function evaluateNode(node: FilterCondition | FilterGroup, msg: CallFlowMessage): boolean {
  if (isFilterGroup(node)) return evaluateGroup(node, msg);
  return evaluateCondition(node, msg);
}

function evaluateCondition(cond: FilterCondition, msg: CallFlowMessage): boolean {
  switch (cond.type) {
    case 'text-contains': {
      const text = resolveField(cond.field, msg);
      const value = cond.caseSensitive ? cond.value : cond.value.toLowerCase();
      const target = cond.caseSensitive ? text : text.toLowerCase();
      return target.includes(value);
    }
    case 'text-not-contains': {
      const text = resolveField(cond.field, msg);
      const value = cond.caseSensitive ? cond.value : cond.value.toLowerCase();
      const target = cond.caseSensitive ? text : text.toLowerCase();
      return !target.includes(value);
    }
    case 'regex': {
      try {
        const text = resolveField(cond.field, msg);
        const re = new RegExp(cond.pattern, 'i');
        return re.test(text);
      } catch {
        return false; // invalid regex
      }
    }
    case 'seq-range':
      return msg.index >= cond.from && msg.index <= cond.to;
    case 'time-range': {
      const msgMs = parseTimeToMs(msg.reqTime || msg.time || '');
      if (msgMs === -1) return false;
      const fromMs = parseTimeToMs(cond.from);
      const toMs = parseTimeToMs(cond.to);
      if (fromMs === -1 || toMs === -1) return false;
      return msgMs >= fromMs && msgMs <= toMs;
    }
    case 'service': {
      const from = (msg.from || '').toLowerCase();
      const to = (msg.to || '').toLowerCase();
      const col = cond.column.toLowerCase();
      if (cond.direction === 'from') return from.includes(col);
      if (cond.direction === 'to') return to.includes(col);
      return from.includes(col) || to.includes(col);
    }
    case 'status': {
      const statusNum = parseInt(msg.status, 10);
      if (isNaN(statusNum)) return false;
      if (cond.operator === 'eq') return statusNum === cond.code;
      if (cond.operator === 'gte') return statusNum >= cond.code;
      if (cond.operator === 'lt') return statusNum < cond.code;
      return false;
    }
    case 'failure':
      if (cond.failureOnly) {
        const statusNum = parseInt(msg.status, 10);
        return msg.isFailure || (!isNaN(statusNum) && statusNum >= 400);
      }
      return true;
  }
}

function resolveField(field: string, msg: CallFlowMessage): string {
  switch (field) {
    case 'label': return msg.label || '';
    case 'from': return msg.from || '';
    case 'to': return msg.to || '';
    case 'any': return [msg.label, msg.from, msg.to, msg.req, msg.resp].filter(Boolean).join(' ');
    default: return '';
  }
}

/** Parse time string (ISO or HH:MM:SS.mmm) to milliseconds since midnight */
function parseTimeToMs(timeStr: string): number {
  if (!timeStr) return -1;
  // Try HH:MM:SS.mmm format first
  const short = timeStr.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
  if (short) {
    return (
      parseInt(short[1]) * 3600000 +
      parseInt(short[2]) * 60000 +
      parseInt(short[3]) * 1000 +
      parseInt(short[4])
    );
  }
  // Try ISO format — extract time part
  const iso = timeStr.match(/T(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
  if (iso) {
    return (
      parseInt(iso[1]) * 3600000 +
      parseInt(iso[2]) * 60000 +
      parseInt(iso[3]) * 1000 +
      parseInt(iso[4])
    );
  }
  return -1;
}
```

**Step 2: Commit**

```bash
git add src/renderer/components/cfv/cfv-filter-engine.ts
git commit -m "feat(cfv): add pure filter evaluation engine"
```

---

### Task 3: Create filter persistence backend

**Files:**
- Create: `src/main/cfv/cfv-filter-service.ts`
- Modify: `src/main/cfv/index.ts` — add export
- Modify: `src-backend/bridge.ts:814-855` — add RPC handlers
- Modify: `src/renderer/tauri-api.ts:554-575` — add API methods
- Modify: `src/renderer/api.d.ts:399-419` — add type declarations

**Step 1: Write the filter service**

Create `src/main/cfv/cfv-filter-service.ts`:

```typescript
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { CallFilterState, FilterPreset } from '../../shared/cfv-filter-types.js';

const DEFAULT_OUTPUT_BASE = join(
  process.env.LOCALAPPDATA || join(process.env.HOME || '', 'AppData', 'Local'),
  'BrainBot',
  'cfv_calls'
);

const PRESETS_FILE = join(
  process.env.LOCALAPPDATA || join(process.env.HOME || '', 'AppData', 'Local'),
  'BrainBot',
  'cfv_filter_presets.json'
);

export class CfvFilterService {
  private outputBase: string;

  constructor(outputBase?: string) {
    this.outputBase = outputBase ?? DEFAULT_OUTPUT_BASE;
  }

  async saveCallFilters(callId: string, state: CallFilterState): Promise<void> {
    const filePath = join(this.outputBase, callId, 'filters.json');
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  async loadCallFilters(callId: string): Promise<CallFilterState | null> {
    try {
      const filePath = join(this.outputBase, callId, 'filters.json');
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as CallFilterState;
    } catch {
      return null;
    }
  }

  async listFilterPresets(): Promise<FilterPreset[]> {
    try {
      const content = await readFile(PRESETS_FILE, 'utf-8');
      return JSON.parse(content) as FilterPreset[];
    } catch {
      return [];
    }
  }

  async saveFilterPreset(preset: FilterPreset): Promise<void> {
    const presets = await this.listFilterPresets();
    const idx = presets.findIndex(p => p.id === preset.id);
    if (idx >= 0) {
      presets[idx] = preset;
    } else {
      presets.push(preset);
    }
    await mkdir(dirname(PRESETS_FILE), { recursive: true });
    await writeFile(PRESETS_FILE, JSON.stringify(presets, null, 2), 'utf-8');
  }

  async deleteFilterPreset(presetId: string): Promise<void> {
    const presets = await this.listFilterPresets();
    const filtered = presets.filter(p => p.id !== presetId);
    await writeFile(PRESETS_FILE, JSON.stringify(filtered, null, 2), 'utf-8');
  }
}

let instance: CfvFilterService | null = null;
export function getCfvFilterService(): CfvFilterService {
  if (!instance) instance = new CfvFilterService();
  return instance;
}
```

**Step 2: Add export to `src/main/cfv/index.ts`**

Append:
```typescript
export { getCfvFilterService } from './cfv-filter-service.js';
```

**Step 3: Add RPC handlers to `src-backend/bridge.ts`**

After the existing CFV Chat cases (around line 855), before the Plugin Engine section, add:

```typescript
    // CFV Filter API
    case 'cfv-filter:save': {
      const { getCfvFilterService } = await import('../src/main/cfv/cfv-filter-service.js');
      return getCfvFilterService().saveCallFilters(params[0], params[1]);
    }
    case 'cfv-filter:load': {
      const { getCfvFilterService } = await import('../src/main/cfv/cfv-filter-service.js');
      return getCfvFilterService().loadCallFilters(params[0]);
    }
    case 'cfv-filter:list-presets': {
      const { getCfvFilterService } = await import('../src/main/cfv/cfv-filter-service.js');
      return getCfvFilterService().listFilterPresets();
    }
    case 'cfv-filter:save-preset': {
      const { getCfvFilterService } = await import('../src/main/cfv/cfv-filter-service.js');
      return getCfvFilterService().saveFilterPreset(params[0]);
    }
    case 'cfv-filter:delete-preset': {
      const { getCfvFilterService } = await import('../src/main/cfv/cfv-filter-service.js');
      return getCfvFilterService().deleteFilterPreset(params[0]);
    }
```

**Step 4: Add API methods to `src/renderer/tauri-api.ts`**

After the existing CFV Chat API section (around line 575), add:

```typescript
  // CFV Filter API
  cfvSaveCallFilters: (callId: string, state: any) => invoke('cfv-filter:save', callId, state),
  cfvLoadCallFilters: (callId: string) => invoke('cfv-filter:load', callId),
  cfvListFilterPresets: () => invoke('cfv-filter:list-presets'),
  cfvSaveFilterPreset: (preset: any) => invoke('cfv-filter:save-preset', preset),
  cfvDeleteFilterPreset: (presetId: string) => invoke('cfv-filter:delete-preset', presetId),
```

**Step 5: Add type declarations to `src/renderer/api.d.ts`**

After the existing CFV Chat declarations (around line 419), add:

```typescript
  // CFV Filter API
  cfvSaveCallFilters: (callId: string, state: import('../shared/cfv-filter-types.js').CallFilterState) => Promise<void>;
  cfvLoadCallFilters: (callId: string) => Promise<import('../shared/cfv-filter-types.js').CallFilterState | null>;
  cfvListFilterPresets: () => Promise<import('../shared/cfv-filter-types.js').FilterPreset[]>;
  cfvSaveFilterPreset: (preset: import('../shared/cfv-filter-types.js').FilterPreset) => Promise<void>;
  cfvDeleteFilterPreset: (presetId: string) => Promise<void>;
```

**Step 6: Commit**

```bash
git add src/main/cfv/cfv-filter-service.ts src/main/cfv/index.ts src-backend/bridge.ts src/renderer/tauri-api.ts src/renderer/api.d.ts
git commit -m "feat(cfv): add filter persistence backend and API bindings"
```

---

### Task 4: Create the filter toolbar component

**Files:**
- Create: `src/renderer/components/cfv/cfv-filter-toolbar.ts`

**Step 1: Write the filter toolbar**

This component renders the toolbar bar with filter chips, "Add Filter" button, "Show matched only" toggle, and "Presets" button. It emits callbacks for all user interactions.

The toolbar is a plain class (not a web component) that takes a container element, matching the pattern used by `CfvCallFlowPanel`, `CfvDrillDownPanel`, etc.

Key behaviors:
- `render()` rebuilds the toolbar HTML
- Chips show: color dot, summary text, mode icon, enabled toggle (checkbox), remove X
- Clicking a chip emits `onEditRule(ruleId)` to open the builder
- "Add Filter" button emits `onAddRule()`
- "Show matched only" toggle emits `onToggleShowMatchedOnly()`
- "Presets" button emits `onOpenPresets()`

```typescript
// Structure:
// <div class="cfv-filter-toolbar">
//   <div class="cfv-filter-toolbar-left">
//     <button class="cfv-filter-add-btn">+ Filter</button>
//     <div class="cfv-filter-chips">
//       [chip] [chip] [chip]...
//     </div>
//   </div>
//   <div class="cfv-filter-toolbar-right">
//     <label class="cfv-filter-matched-toggle">
//       <input type="checkbox" /> Show matched only
//     </label>
//     <button class="cfv-filter-presets-btn">Presets</button>
//   </div>
// </div>
```

Each chip:
```html
<div class="cfv-filter-chip" data-rule-id="...">
  <span class="cfv-filter-chip-dot" style="background:COLOR"></span>
  <span class="cfv-filter-chip-text">summary</span>
  <span class="cfv-filter-chip-mode" title="Filter/Mark">ICON</span>
  <input type="checkbox" class="cfv-filter-chip-toggle" checked />
  <button class="cfv-filter-chip-remove">×</button>
</div>
```

Implement callbacks:
- `onAddRule: () => void`
- `onEditRule: (ruleId: string) => void`
- `onRemoveRule: (ruleId: string) => void`
- `onToggleRule: (ruleId: string, enabled: boolean) => void`
- `onToggleShowMatchedOnly: (value: boolean) => void`
- `onOpenPresets: () => void`

**Step 2: Commit**

```bash
git add src/renderer/components/cfv/cfv-filter-toolbar.ts
git commit -m "feat(cfv): add filter toolbar with chips UI"
```

---

### Task 5: Create the filter builder component

**Files:**
- Create: `src/renderer/components/cfv/cfv-filter-builder.ts`

**Step 1: Write the filter builder**

This is the dropdown panel that opens below the toolbar for creating/editing a filter rule. It renders the recursive group builder UI.

Key behaviors:
- Opens as an absolutely-positioned overlay below the toolbar
- Takes an optional `FilterRule` for editing (or creates a new one)
- Renders the rule header: name input, color picker, mode toggle (mark/filter)
- Renders the recursive group tree with condition rows
- Each condition row: field selector, operator selector (changes based on type), value input, remove button
- Group controls: operator label (AND/OR), add condition button, add sub-group button, negate checkbox
- Bottom: Cancel and Apply buttons

For the recursive group rendering, use a function `renderGroup(group, depth, path)` where path tracks position in the tree for updates.

Condition type determines the row layout:
- `text-contains` / `text-not-contains`: [field ▼] [contains/not contains ▼] [text input]
- `regex`: [field ▼] [matches regex] [pattern input]
- `seq-range`: [from #] [to #] (two number inputs)
- `time-range`: [from time] [to time] (two time inputs HH:MM:SS.mmm)
- `service`: [column ▼] [from/to/either ▼]
- `status`: [operator ▼] [code number]
- `failure`: [failures only checkbox]

When user changes condition type via dropdown, the row re-renders with appropriate inputs.

Color picker: row of 8 color dots, click to select.

Implement callbacks:
- `onApply: (rule: FilterRule) => void`
- `onCancel: () => void`

**Step 2: Commit**

```bash
git add src/renderer/components/cfv/cfv-filter-builder.ts
git commit -m "feat(cfv): add filter builder with recursive group UI"
```

---

### Task 6: Add filter CSS styles

**Files:**
- Modify: `src/renderer/styles/cfv.css:1420` — append new styles

**Step 1: Add all filter-related styles**

Append to `src/renderer/styles/cfv.css` after the existing content (line 1420):

```css
/* --------------------------------------------------------------------------
   Filter Toolbar
   -------------------------------------------------------------------------- */
.cfv-filter-toolbar { ... }
.cfv-filter-toolbar-left { ... }
.cfv-filter-toolbar-right { ... }
.cfv-filter-add-btn { ... }
.cfv-filter-chips { ... }
.cfv-filter-chip { ... }
.cfv-filter-chip-dot { ... }
.cfv-filter-chip-text { ... }
.cfv-filter-chip-mode { ... }
.cfv-filter-chip-toggle { ... }
.cfv-filter-chip-remove { ... }
.cfv-filter-matched-toggle { ... }
.cfv-filter-presets-btn { ... }

/* Filter Builder Dropdown */
.cfv-filter-builder-overlay { ... }
.cfv-filter-builder { ... }
.cfv-filter-builder-header { ... }
.cfv-filter-builder-body { ... }
.cfv-filter-builder-footer { ... }
.cfv-filter-color-picker { ... }
.cfv-filter-color-dot { ... }
.cfv-filter-mode-toggle { ... }
.cfv-filter-group { ... }
.cfv-filter-group-header { ... }
.cfv-filter-condition-row { ... }
.cfv-filter-condition-field { ... }
.cfv-filter-condition-op { ... }
.cfv-filter-condition-value { ... }
.cfv-filter-condition-remove { ... }

/* Mark highlights on rows */
.cfv-seq-row .cfv-mark-borders { ... }
.cfv-seq-row.marked { ... }

/* Presets dropdown */
.cfv-filter-presets-dropdown { ... }
.cfv-filter-preset-item { ... }
```

Use existing CSS variable patterns from the file (`--space-*`, `--text-*`, `--bg-*`, `--border-color`, `--accent-blue`, `--radius-*`, `--transition-fast`).

Key style details:
- Toolbar: 32px height, flex row, `border-bottom: 1px solid var(--border-color)`, `background: var(--bg-secondary)`
- Chips: inline-flex, pill-shaped (`border-radius: 12px`), small padding, `font-size: var(--text-xs)`
- Builder overlay: `position: absolute; top: 100%; left: 0; right: 0; z-index: 10;`
- Builder: `max-height: 400px; overflow-y: auto; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: var(--radius-md); box-shadow: 0 4px 16px rgba(0,0,0,0.2);`
- Group nesting: left border colored by group operator (`--accent-blue` for AND, `var(--warning)` for OR), `padding-left: var(--space-3)`, `margin-left: var(--space-2)`
- Mark border on rows: `position: absolute; left: 0; top: 0; bottom: 0; width: Npx;` where N = 2px per mark color stacked

**Step 2: Commit**

```bash
git add src/renderer/styles/cfv.css
git commit -m "feat(cfv): add filter toolbar, builder, and mark highlight styles"
```

---

### Task 7: Integrate filter system into CfvCallFlowPanel

**Files:**
- Modify: `src/renderer/components/cfv/cfv-callflow-panel.ts` — major changes

**Step 1: Add filter state and toolbar integration**

This is the core integration task. Modify `CfvCallFlowPanel` to:

1. Add imports for `CfvFilterToolbar`, `CfvFilterBuilder`, `cfv-filter-engine`, and filter types
2. Add private state:
   - `filterState: CallFilterState` — current filters
   - `filterResults: Map<number, FilterResult>` — cached results
   - `visibleMessages: CallFlowMessage[]` — filtered subset
   - `toolbar: CfvFilterToolbar`
   - `builder: CfvFilterBuilder | null`
   - `saveDebounceTimer: number | null`
   - `callId: string` — for persistence
3. Modify `setData(messages, callId?)` to accept callId and load persisted filters
4. Modify `render()`:
   - Insert toolbar between header and body:
     ```html
     <div class="cfv-sequence-header">...</div>
     <div class="cfv-filter-toolbar-container" id="cfvFilterToolbar"></div>
     <div class="cfv-sequence-body" id="cfvSeqBody"></div>
     ```
   - Instantiate toolbar in the container
5. Add `applyFilters()` method:
   - Calls `evaluateFilters(this.messages, this.filterState)`
   - Computes `this.visibleMessages` from results
   - Updates `totalPages` based on visible count
   - Calls `renderPage()` and toolbar update
6. Modify `renderPage()`:
   - Use `visibleMessages` instead of `messages` for pagination
   - Keep original `msg.index` for the `#` column
   - Add mark borders to marked rows
   - Update pagination text: "Showing X of Y messages (N filters active)"
7. Add filter action handlers:
   - `addRule()` — creates rule, opens builder
   - `editRule(ruleId)` — opens builder for existing rule
   - `removeRule(ruleId)` — removes and re-evaluates
   - `toggleRule(ruleId, enabled)` — toggles and re-evaluates
   - `toggleShowMatchedOnly(value)` — updates state and re-evaluates
   - `applyBuilderResult(rule)` — saves rule to state, closes builder, re-evaluates
   - `persistFilters()` — debounced 500ms, calls `cfvSaveCallFilters`
8. Modify `showMessageModal()` to show matched filter dots

**Step 2: Add mark border rendering to row HTML**

In the row template, add a mark border container before the sequence number:

```html
<div class="cfv-seq-row${failClass}${markClass}" data-seq="${msg.index}" style="${markBgStyle}">
  <div class="cfv-mark-borders">${markBordersHtml}</div>
  <div class="cfv-seq-num">...</div>
  ...
</div>
```

Where `markBordersHtml` is a series of `<span style="background:COLOR">` for each matching mark color, and `markBgStyle` sets `background: rgba(R,G,B,0.08)` for the first mark color.

**Step 3: Commit**

```bash
git add src/renderer/components/cfv/cfv-callflow-panel.ts
git commit -m "feat(cfv): integrate filter toolbar and engine into call flow panel"
```

---

### Task 8: Add presets UI

**Files:**
- Modify: `src/renderer/components/cfv/cfv-filter-toolbar.ts` — add presets dropdown

**Step 1: Add presets dropdown to toolbar**

When user clicks "Presets" button, show a dropdown overlay with:
- List of saved presets (name + rule count), each with "Apply" button
- "Save current as preset" option (opens name input inline)
- "Delete" button on each preset (with confirmation)

The toolbar needs to load presets via `cfvListFilterPresets()` when dropdown opens.

Callbacks to add:
- `onApplyPreset: (preset: FilterPreset) => void`
- `onSavePreset: (name: string) => void`
- `onDeletePreset: (presetId: string) => void`

The parent (`CfvCallFlowPanel`) handles these by:
- `applyPreset`: copies preset rules into current state, re-evaluates
- `savePreset`: creates a `FilterPreset` from current rules, calls `cfvSaveFilterPreset`
- `deletePreset`: calls `cfvDeleteFilterPreset`

**Step 2: Commit**

```bash
git add src/renderer/components/cfv/cfv-filter-toolbar.ts src/renderer/components/cfv/cfv-callflow-panel.ts
git commit -m "feat(cfv): add filter presets UI with save/apply/delete"
```

---

### Task 9: Polish and edge cases

**Files:**
- Various CFV files

**Step 1: Handle edge cases**

- Empty filter state: toolbar shows "No filters" placeholder, no filtering applied
- All rules disabled: equivalent to no filters
- Invalid regex: `evaluateCondition` catches and returns false (already handled)
- Zero visible messages after filter: show "No messages match current filters" instead of empty body
- Filter builder validation: disable "Apply" button if any condition has empty required values
- Time range inputs: validate HH:MM:SS.mmm format, show red border on invalid
- Seq range inputs: validate numbers, ensure from <= to
- Builder open + page navigation: close builder on page change
- Click outside builder: close it (backdrop click handler)
- Escape key: close builder

**Step 2: Add filter count to pagination**

Update pagination text to: `Page X of Y · Showing Z of N messages (K filters)` when filters are active.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(cfv): polish filter system edge cases and validation"
```

---

## Summary of all files

**New files (5):**
1. `src/shared/cfv-filter-types.ts`
2. `src/renderer/components/cfv/cfv-filter-engine.ts`
3. `src/renderer/components/cfv/cfv-filter-toolbar.ts`
4. `src/renderer/components/cfv/cfv-filter-builder.ts`
5. `src/main/cfv/cfv-filter-service.ts`

**Modified files (5):**
1. `src/renderer/components/cfv/cfv-callflow-panel.ts`
2. `src/renderer/styles/cfv.css`
3. `src-backend/bridge.ts`
4. `src/renderer/tauri-api.ts`
5. `src/renderer/api.d.ts`
6. `src/main/cfv/index.ts`
