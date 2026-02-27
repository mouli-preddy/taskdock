# CFV Log Links Integration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable any workspace subtab view to spawn sibling subtabs via a shared workspace context, and use this to add a "Logs" dropdown in the CFV call view that opens DGrep subtabs pre-populated with KQL queries derived from CFV log components.

**Architecture:** Introduce a `WorkspaceContext` object (workspace ID + `addSubtab` callback) passed to all subtab views. Add a `cfvLogComponentToFormState()` helper that converts CFV's MQL-based Geneva portal URLs into `DGrepFormState` objects with KQL `serverQuery`. Wire a "Logs" dropdown into `CfvCallView`'s toolbar that uses both pieces together.

**Tech Stack:** TypeScript, vanilla DOM (no framework), existing `DGrepFormState` / `DGrepSearchView.loadFormState()` APIs.

---

### Task 1: Define `WorkspaceContext` type and extend `DgrepSubtabState`

**Files:**
- Modify: `src/shared/workspace-types.ts`

**Step 1: Add `WorkspaceContext` interface and update `DgrepSubtabState`**

In `src/shared/workspace-types.ts`, add the context type and extend the dgrep state:

```typescript
import type { DGrepFormState } from './dgrep-ui-types.js';

export interface WorkspaceContext {
  workspaceId: string;
  addSubtab: (type: WorkspaceSubtabType, label: string, state: WorkspaceSubtabState) => void;
}
```

Update `DgrepSubtabState` to carry an optional pre-populated form:

```typescript
export interface DgrepSubtabState {
  searchQuery: string;
  timeRange: { start: string; end: string };
  formState?: DGrepFormState;
}
```

**Step 2: Commit**

```bash
git add src/shared/workspace-types.ts
git commit -m "feat(workspace): add WorkspaceContext type and DgrepSubtabState.formState"
```

---

### Task 2: Wire `WorkspaceContext` into all subtab views

**Files:**
- Modify: `src/renderer/components/workspace-section.ts`
- Modify: `src/renderer/components/cfv/cfv-call-view.ts`
- Modify: `src/renderer/components/dgrep-search-view.ts`
- Modify: `src/renderer/components/icm-incident-detail-view.ts`

**Step 1: Add `workspaceContext` property to each view class**

Each view gets a public settable property. No constructor changes — set it after construction (matches existing wiring pattern with `onWireDgrepView`, etc.).

In `cfv-call-view.ts`, add after the class fields (around line 28):
```typescript
workspaceContext: WorkspaceContext | null = null;
```

In `dgrep-search-view.ts`, add after the class fields (around line 117):
```typescript
workspaceContext: WorkspaceContext | null = null;
```

In `icm-incident-detail-view.ts`, add after the class fields (around line 12):
```typescript
workspaceContext: WorkspaceContext | null = null;
```

Import `WorkspaceContext` (and the necessary subtab types) in each file:
```typescript
import type { WorkspaceContext } from '../../shared/workspace-types.js';
```
(Adjust relative path per file — `../../../shared/workspace-types.js` for files in `cfv/`.)

**Step 2: Create and inject `WorkspaceContext` in `workspace-section.ts`**

In `createViewForSubtab()` (around line 371), after each view is instantiated, set the context. The workspace ID comes from `ws.id`:

```typescript
private createViewForSubtab(subtab: WorkspaceSubtab, panel: HTMLElement): void {
    const ws = this.getActiveWorkspace();
    const ctx: WorkspaceContext | null = ws ? {
      workspaceId: ws.id,
      addSubtab: (type, label, state) => this.addSubtab(ws.id, type, label, state),
    } : null;

    switch (subtab.type) {
      case 'cfv': {
        const state = subtab.state as CfvSubtabState;
        if (!state.callId) {
          this.renderCfvIdInput(subtab, panel);
        } else {
          const view = new CfvCallView(panel, state.callId);
          view.workspaceContext = ctx;
          this.viewInstances.set(subtab.id, view);
        }
        break;
      }
      case 'dgrep': {
        const view = new DGrepSearchView(panel.id);
        view.workspaceContext = ctx;
        this.onWireDgrepView?.(view);
        this.viewInstances.set(subtab.id, view);
        break;
      }
      case 'icm': {
        const state = subtab.state as IcmSubtabState;
        if (!state.incidentId) {
          this.renderIcmIdInput(subtab, panel);
        } else {
          const view = new IcmIncidentDetailView(panel);
          view.workspaceContext = ctx;
          this.onWireIcmView?.(view);
          view.setLoading(true);
          this.loadIcmIncidentIntoView(state.incidentId, view);
          this.viewInstances.set(subtab.id, view);
        }
        break;
      }
      case 'new': {
        this.renderNewTabPicker(subtab, panel);
        break;
      }
    }
  }
```

Import `WorkspaceContext` at the top of `workspace-section.ts`:
```typescript
import type { ..., WorkspaceContext } from '../../shared/workspace-types.js';
```

**Step 3: Wire `DgrepSubtabState.formState` into DGrep view creation**

Still in `createViewForSubtab`, after the DGrep view is wired, load the form state if present:

```typescript
case 'dgrep': {
    const state = subtab.state as DgrepSubtabState;
    const view = new DGrepSearchView(panel.id);
    view.workspaceContext = ctx;
    this.onWireDgrepView?.(view);
    if (state.formState) {
      // loadFormState is async — fire and forget since the view handles its own loading state
      view.loadFormState(state.formState);
    }
    this.viewInstances.set(subtab.id, view);
    break;
}
```

Import `DgrepSubtabState`:
```typescript
import type { ..., DgrepSubtabState } from '../../shared/workspace-types.js';
```

**Step 4: Commit**

```bash
git add src/renderer/components/workspace-section.ts src/renderer/components/cfv/cfv-call-view.ts src/renderer/components/dgrep-search-view.ts src/renderer/components/icm-incident-detail-view.ts
git commit -m "feat(workspace): inject WorkspaceContext into all subtab views"
```

---

### Task 3: Create `cfv-log-links.ts` helper

**Files:**
- Create: `src/shared/cfv-log-links.ts`

This is the pure function that converts CFV's MQL-based Geneva portal URLs into `DGrepFormState` objects with KQL.

**Step 1: Create the helper**

```typescript
/**
 * CFV Log Links Helper
 * Converts CFV LogComponent URLs (MQL conditions) to DGrepFormState (KQL serverQuery).
 */

import type { DGrepFormState } from './dgrep-ui-types.js';
import type { DGrepEndpointName, OffsetSign, OffsetUnit, ScopingCondition } from './dgrep-types.js';

export interface CfvLogComponent {
  name: string;
  location: string;  // Geneva portal URL with MQL conditions
}

/**
 * Convert a single CFV LogComponent URL to a DGrepFormState with KQL serverQuery.
 *
 * CFV URLs use:   &conditions=[["ActivityId","==","<id>"]]
 * We convert to:  serverQuery = 'source | where ActivityId == "<id>"'
 */
export function cfvLogComponentToFormState(logComponent: CfvLogComponent): DGrepFormState | null {
  try {
    const url = new URL(logComponent.location.replace(/ /g, '%20'));
    const params = url.searchParams;

    // Endpoint
    const endpoint = (params.get('ep') || 'Diagnostics PROD') as DGrepEndpointName;

    // Namespace and events
    const namespace = params.get('ns') || '';
    const enRaw = params.get('en') || '';
    const selectedEvents = enRaw.split(',').map(e => e.trim()).filter(Boolean);

    // Time
    const timeRaw = params.get('time') || '';
    let referenceTime = '';
    if (timeRaw) {
      const dt = new Date(timeRaw);
      if (!isNaN(dt.getTime())) {
        referenceTime = dt.toISOString().slice(0, 16);
      }
    }

    // Offset
    const offsetRaw = params.get('offset') || '+30';
    let offsetSign: OffsetSign = '+';
    let offsetStr = offsetRaw;
    if (offsetRaw.startsWith('~')) { offsetSign = '~'; offsetStr = offsetRaw.slice(1); }
    else if (offsetRaw.startsWith('+')) { offsetSign = '+'; offsetStr = offsetRaw.slice(1); }
    else if (offsetRaw.startsWith('-')) { offsetSign = '-'; offsetStr = offsetRaw.slice(1); }
    const offsetValue = parseInt(offsetStr, 10) || 30;

    // Offset unit — CFV uses "Mins", we normalize to "Minutes"
    const unitRaw = params.get('offsetUnit') || 'Minutes';
    let offsetUnit: OffsetUnit = 'Minutes';
    if (unitRaw.toLowerCase().startsWith('min')) offsetUnit = 'Minutes';
    else if (unitRaw.toLowerCase().startsWith('hour')) offsetUnit = 'Hours';
    else if (unitRaw.toLowerCase().startsWith('day')) offsetUnit = 'Days';

    // Scoping conditions (already JSON array)
    const scopingConditions: ScopingCondition[] = [];
    const scopingRaw = params.get('scopingConditions');
    if (scopingRaw) {
      try {
        const parsed = JSON.parse(scopingRaw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (Array.isArray(item) && item.length >= 2) {
              scopingConditions.push({
                column: item[0],
                operator: item.length >= 3 ? item[1] : '==',
                value: item.length >= 3 ? item[2] : item[1],
              });
            }
          }
        }
      } catch { /* ignore invalid JSON */ }
    }

    // Convert MQL conditions → KQL serverQuery
    const serverQuery = conditionsToKql(params.get('conditions'));

    // Convert clientQuery → KQL clientQuery
    const clientQueryRaw = params.get('clientQuery') || '';
    const clientQuery = clientQueryToKql(clientQueryRaw);

    return {
      endpoint,
      namespace,
      selectedEvents,
      referenceTime,
      offsetSign,
      offsetValue,
      offsetUnit,
      scopingConditions,
      serverQuery,
      clientQuery,
      maxResults: 10000,
      showSecurityEvents: false,
    };
  } catch {
    return null;
  }
}

/**
 * Convert CFV MQL conditions array to KQL serverQuery.
 *
 * Input:  [["ActivityId","==","<id>"]]
 *     or  [["Message","contains","<id>"]]
 *     or  [["AnyField","contains","<id>"]]
 *     or  [["cV","equals any of","cv1,cv2"]]
 *
 * Output: 'source | where ActivityId == "<id>"'
 */
function conditionsToKql(conditionsStr: string | null): string {
  if (!conditionsStr) return '';

  try {
    const conditions: string[][] = JSON.parse(decodeURIComponent(conditionsStr));
    if (!Array.isArray(conditions) || conditions.length === 0) return '';

    const whereClauses = conditions.map(cond => {
      if (!Array.isArray(cond) || cond.length < 3) return null;

      const [column, operator, value] = cond;

      // Decode %3D%3D → ==
      const op = decodeURIComponent(operator);

      if (column === 'AnyField') {
        // AnyField → wildcard search with *
        return `* ${mapOperator(op)} "${value}"`;
      }

      if (op === 'equals any of') {
        // Comma-separated list → KQL `in` operator
        const values = value.split(',').map(v => `"${v.trim()}"`).join(', ');
        return `${column} in (${values})`;
      }

      if (op === 'contains' || op === 'contains any of') {
        return `${column} contains "${value}"`;
      }

      return `${column} ${mapOperator(op)} "${value}"`;
    }).filter(Boolean);

    if (whereClauses.length === 0) return '';
    return `source | where ${whereClauses.join(' and ')}`;
  } catch {
    return '';
  }
}

function mapOperator(op: string): string {
  switch (op) {
    case '==':
    case '%3D%3D':
      return '==';
    case '!=':
      return '!=';
    case 'contains':
    case 'contains any of':
      return 'contains';
    case 'startswith':
      return 'startswith';
    default:
      return op;
  }
}

/**
 * Convert CFV client query (e.g. "orderby PreciseTimeStamp asc") to KQL format.
 * CFV uses non-standard "orderby" keyword; KQL uses "sort by".
 */
function clientQueryToKql(raw: string): string {
  if (!raw) return '';
  // Normalize "orderby" → "sort by"
  const kql = raw.replace(/\borderby\b/gi, 'sort by');
  return `source | ${kql}`;
}

/**
 * Extract log components from CFV raw callFlow data.
 * The data is at: nrtStreamingIndexAugmentedCall.logComponents[]
 */
export function extractLogComponents(callFlowData: Record<string, unknown>): CfvLogComponent[] {
  const nrt = (callFlowData?.nrtStreamingIndexAugmentedCall ?? {}) as Record<string, unknown>;
  const raw = nrt?.logComponents;
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((lc: any) => lc?.name && lc?.location)
    .map((lc: any) => ({
      name: String(lc.name),
      location: String(lc.location),
    }));
}
```

**Step 2: Commit**

```bash
git add src/shared/cfv-log-links.ts
git commit -m "feat(cfv): add cfv-log-links helper to convert MQL conditions to KQL"
```

---

### Task 4: Add "Logs" dropdown to `CfvCallView` toolbar

**Files:**
- Modify: `src/renderer/components/cfv/cfv-call-view.ts`
- Modify: `src/renderer/styles/cfv.css`

**Step 1: Add log components state and rendering**

In `cfv-call-view.ts`, add import:
```typescript
import type { WorkspaceContext } from '../../../shared/workspace-types.js';
import type { DGrepFormState } from '../../../shared/dgrep-ui-types.js';
import { extractLogComponents, cfvLogComponentToFormState } from '../../../shared/cfv-log-links.js';
import { getIcon, MessageSquare, FileText } from '../../utils/icons.js';
```

Add a field for log components (next to existing fields ~line 28):
```typescript
private logComponents: Array<{ name: string; formState: DGrepFormState }> = [];
```

In the toolbar HTML (around line 43), add a Logs dropdown button between the subtab group and the spacer:
```html
<div class="cfv-logs-dropdown-container">
  <button class="cfv-subtab-btn" id="cfvLogsBtn" title="Open service logs" disabled>
    ${getIcon(FileText, 14)} Logs
  </button>
  <div class="cfv-logs-dropdown" id="cfvLogsDropdown"></div>
</div>
```

So the toolbar becomes:
```typescript
this.container.innerHTML = `
  <div class="cfv-call-view">
    <div class="cfv-call-main">
      <div class="cfv-call-toolbar">
        <span class="cfv-call-toolbar-id" title="${escapeHtml(this.callId)}">${escapeHtml(shortId)}</span>
        <div class="cfv-subtab-group">
          <button class="cfv-subtab-btn active" data-subtab="callflow">Call Flow</button>
          <button class="cfv-subtab-btn" data-subtab="drilldown">Drill Down</button>
          <button class="cfv-subtab-btn" data-subtab="rawevents">Raw Events</button>
          <button class="cfv-subtab-btn" data-subtab="qoe">QoE</button>
        </div>
        <div class="cfv-logs-dropdown-container">
          <button class="cfv-subtab-btn" id="cfvLogsBtn" title="Open service logs" disabled>
            ${getIcon(FileText, 14)} Logs
          </button>
          <div class="cfv-logs-dropdown" id="cfvLogsDropdown"></div>
        </div>
        <div class="spacer"></div>
        <button class="cfv-subtab-btn" id="cfvChatToggle" title="AI Chat">
          ${getIcon(MessageSquare, 14)} Chat
        </button>
      </div>
      ...
`;
```

**Step 2: Populate log components after data loads**

In `loadData()`, after `this.callFlowData = callFlow;` and `this.loading = false;` (around line 118), extract and convert:

```typescript
// Extract log components and convert to DGrepFormState
if (this.callFlowData) {
  const raw = extractLogComponents(this.callFlowData as Record<string, unknown>);
  this.logComponents = raw
    .map(lc => {
      const formState = cfvLogComponentToFormState(lc);
      return formState ? { name: lc.name, formState } : null;
    })
    .filter((x): x is { name: string; formState: DGrepFormState } => x !== null);
  this.renderLogsDropdown();
}
```

**Step 3: Add the dropdown render and click handler methods**

```typescript
private renderLogsDropdown(): void {
  const btn = this.container.querySelector('#cfvLogsBtn') as HTMLButtonElement;
  const dropdown = this.container.querySelector('#cfvLogsDropdown') as HTMLElement;
  if (!btn || !dropdown) return;

  if (this.logComponents.length === 0) {
    btn.disabled = true;
    return;
  }

  btn.disabled = false;
  dropdown.innerHTML = this.logComponents.map((lc, i) =>
    `<button class="cfv-logs-dropdown-item" data-log-index="${i}">${escapeHtml(lc.name)}</button>`
  ).join('');

  // Toggle dropdown on button click
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  // Close dropdown on outside click
  document.addEventListener('click', () => {
    dropdown.classList.remove('open');
  });

  // Handle item click
  dropdown.querySelectorAll('.cfv-logs-dropdown-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt((item as HTMLElement).dataset.logIndex || '0', 10);
      const lc = this.logComponents[idx];
      if (lc) this.openLogSearch(lc.name, lc.formState);
      dropdown.classList.remove('open');
    });
  });
}

private openLogSearch(serviceName: string, formState: DGrepFormState): void {
  if (this.workspaceContext) {
    this.workspaceContext.addSubtab('dgrep', serviceName, {
      searchQuery: '',
      timeRange: { start: formState.referenceTime, end: '' },
      formState,
    });
  }
}
```

**Step 4: Add CSS for the logs dropdown**

In `src/renderer/styles/cfv.css`, add:

```css
.cfv-logs-dropdown-container {
  position: relative;
}

.cfv-logs-dropdown {
  display: none;
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 100;
  min-width: 220px;
  max-height: 400px;
  overflow-y: auto;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.cfv-logs-dropdown.open {
  display: flex;
  flex-direction: column;
}

.cfv-logs-dropdown-item {
  padding: 6px 12px;
  text-align: left;
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.cfv-logs-dropdown-item:hover {
  background: var(--bg-hover);
}
```

**Step 5: Commit**

```bash
git add src/renderer/components/cfv/cfv-call-view.ts src/renderer/styles/cfv.css
git commit -m "feat(cfv): add Logs dropdown to open DGrep subtabs from call view"
```

---

### Task 5: Verify `FileText` icon exists, add if needed

**Files:**
- Check: `src/renderer/utils/icons.ts`

**Step 1: Verify the `FileText` icon export exists**

Check `src/renderer/utils/icons.ts` for `FileText`. If it does not exist, add a simple SVG path for it. If using Lucide icons, `FileText` is standard. If the project uses a custom icon set, pick the closest equivalent or add:

```typescript
export const FileText = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>';
```

**Step 2: Commit if changed**

```bash
git add src/renderer/utils/icons.ts
git commit -m "feat(icons): add FileText icon"
```

---

### Task 6: Verify end-to-end integration

**Step 1: Build the project**

```bash
npm run build
```

Verify no TypeScript errors.

**Step 2: Manual test**

1. Open TaskDock, navigate to a workspace
2. Open a CFV call tab (e.g., paste a call ID)
3. Wait for call data to load
4. Click the "Logs" button in the toolbar
5. Verify the dropdown shows service names (Call Controller, Conversation Service, etc.)
6. Click one — verify a new DGrep subtab opens in the same workspace
7. Verify the DGrep form is pre-populated (endpoint, namespace, events, time, KQL server query, scoping)

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(workspace): CFV log links integration complete"
```
