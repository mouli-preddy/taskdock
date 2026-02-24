# DGrep "Improve Display" Feature Design

## Overview

Add an "Improve Display" toggle to the DGrep logs tab that uses the AI agent (Copilot/Claude SDK) to analyze log data and recommend column visibility, ordering, and custom JS cell formatters for improved readability.

## UX Flow

1. **Toggle button** in existing toolbar row (after column presets). Label: "Improve Display" with sparkle icon. Toggle style (pressed/unpressed).

2. **First toggle ON** (per log session):
   - Thin inline progress bar appears between toolbar and table (1-2 lines). Shows streaming text: "Reading log data..." -> "Analyzing column patterns..." -> tool call summaries.
   - Backend writes full CSV to workspace, launches agent with tools (`read_file`, `search_file`).
   - Agent explores data at its discretion, returns structured JSON.
   - Progress bar disappears. Table re-renders with LLM-recommended columns + cell formatters.

3. **Toggle OFF**: Instantly revert to previous column preset and normal cell rendering. No LLM call.

4. **Toggle ON again** (same session): Re-apply cached results instantly. No LLM call.

## Backend: `dgrep-ai-service.ts`

### New method: `improveDisplay(sessionId)`

- Writes full CSV to workspace (reuse `createAnalysisWorkspace` pattern)
- Adds `improve-display-output.json` path to workspace
- Builds prompt instructing agent to analyze log data and return column config + JS formatter functions
- Provides tools: `read_file`, `search_file`
- Executes with chosen provider (Copilot/Claude SDK), streams progress as `ai:improve-display-progress`
- Parses final JSON, emits `ai:improve-display-complete`

### Agent Tools

- **`read_file`**: Read CSV. Params: `{ offset?: number, limit?: number }`. Returns lines from CSV. Agent reads all or chunks.
- **`search_file`**: Search CSV for pattern. Params: `{ pattern: string, max_results?: number }`. Returns matching lines.

### Agent Output Schema

```typescript
interface ImproveDisplayResult {
  columns: Array<{
    name: string;
    visible: boolean;
    order: number;
    width?: number;
  }>;
  formatters: Array<{
    column: string;
    description: string;
    jsFunction: string; // function body: (text) => html string
  }>;
}
```

## Frontend: `dgrep-results-table.ts`

### State

- `improveDisplayResult: ImproveDisplayResult | null` — cached LLM result
- `improveDisplayActive: boolean` — current toggle state
- `preImproveColumnState` — saved column visibility/order before improve was applied
- `compiledFormatters: Map<string, Function>` — compiled JS functions keyed by column name

### Toggle Handler: `onImproveDisplayToggle()`

- If ON and no cached result: emit event to backend, show progress bar
- If ON and cached: call `applyImproveDisplay()`
- If OFF: call `revertImproveDisplay()`

### `applyImproveDisplay()`

1. Save current column visibility/order/widths
2. Apply LLM column config (visibility, order, widths)
3. Compile formatter functions via `new Function('text', fnBody)` and store in map
4. Re-render table

### `revertImproveDisplay()`

1. Restore saved column state
2. Clear compiled formatters map
3. Re-render table

### Cell Rendering

When `improveDisplayActive` and a formatter exists for the column:
1. Run formatter on cell text value
2. Sanitize output HTML
3. Set as `innerHTML` on cell element

## Progress Bar

Thin `div` between toolbar and table content:
- CSS class: `dgrep-improve-display-progress`
- Single line, `font-size: 11px`, secondary text color, blue accent for tool names
- Existing dot animation pattern
- Auto-hides on complete event

## Bridge Layer

### New RPC

- `dgrep:improve-display` — triggers analysis for a session

### New Events

- `dgrep:improve-display-progress` — streaming progress text
- `dgrep:improve-display-complete` — final `ImproveDisplayResult` payload

## HTML Sanitization

For `new Function()` formatter output:
- **Strip**: `<script>`, `<iframe>`, `on*` attributes, `javascript:` URLs
- **Allow**: `<span>`, `<div>`, `<br>`, `<b>`, `<i>`, `<code>`, `<pre>`, `style` attribute (color, background, font-weight, padding, margin, border-radius, display, white-space only)

## Caching

- Results cached per `sessionId` in `dgrep-results-table.ts`
- Cache cleared when new search results arrive (`setData()`)
- Toggle ON/OFF after first analysis is instant (no LLM call)
