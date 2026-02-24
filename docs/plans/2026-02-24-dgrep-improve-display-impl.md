# DGrep "Improve Display" Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an AI-powered "Improve Display" toggle to the DGrep results table that analyzes log data and applies smart column visibility, ordering, and custom cell formatters.

**Architecture:** Agent-based (Copilot/Claude SDK) with workspace tools (`read_file`, `search_file`). Backend writes CSV, agent explores data, returns JSON with column config + JS formatter functions. Frontend compiles formatters via `new Function()`, sanitizes output HTML, and applies to virtual scroller cells. Cached per session — toggle ON/OFF is instant after first analysis.

**Tech Stack:** TypeScript, Copilot SDK / Claude Agent SDK, virtual scroller cell rendering, HTML sanitization.

---

### Task 1: Add `ImproveDisplayResult` type to `dgrep-ai-types.ts`

**Files:**
- Modify: `src/shared/dgrep-ai-types.ts`

**Step 1: Add type at end of file**

Add after the last interface in the file:

```typescript
// ==================== Improve Display ====================

export interface ImproveDisplayColumn {
  name: string;
  visible: boolean;
  order: number;
  width?: number;
}

export interface ImproveDisplayFormatter {
  column: string;
  description: string;
  jsFunction: string; // function body: (text) => html string
}

export interface ImproveDisplayResult {
  columns: ImproveDisplayColumn[];
  formatters: ImproveDisplayFormatter[];
}
```

**Step 2: Commit**

```bash
git add src/shared/dgrep-ai-types.ts
git commit -m "feat(dgrep): add ImproveDisplayResult type"
```

---

### Task 2: Add `improveDisplay` method to `dgrep-ai-service.ts`

**Files:**
- Modify: `src/main/dgrep/dgrep-ai-service.ts`

**Step 1: Add the improve display system prompt**

After the `CHAT_SYSTEM_PROMPT` constant (around line 99), add:

```typescript
const IMPROVE_DISPLAY_SYSTEM_PROMPT = `You are an expert at analyzing log data and improving its display for readability.

You have tools to read and search a CSV log file. Use them to understand the data shape, column contents, and value patterns.

Your job is to return a JSON object that tells the UI:
1. Which columns to show, in what order (hide noisy/internal columns, prioritize useful ones)
2. For columns with complex/multi-line/long values, provide a JavaScript function that formats the cell text into cleaner HTML.

Formatter function guidelines:
- The function receives the raw cell text as a string parameter named "text"
- Return an HTML string that will be placed inside a <div> cell
- Use <span> with inline styles for coloring, bolding, badges
- For multi-line content: extract a meaningful summary as the first line
- For HTTP request/response logs: extract method, path, status code as colored badges
- For stack traces: show the top frame with the exception type highlighted
- For JSON blobs: show a compact key=value summary
- For GUIDs/correlation IDs: abbreviate to first 8 chars with a dimmed style
- Keep the output concise — the cell is typically 150-500px wide
- Use colors sparingly: red for errors/5xx, green for success/2xx, amber for warnings/4xx, blue for info
- Do NOT use any external libraries or DOM APIs — just string concatenation returning HTML

Respond with ONLY a valid JSON object matching this schema:
\`\`\`json
{
  "columns": [
    { "name": "ColumnName", "visible": true, "order": 0, "width": 200 }
  ],
  "formatters": [
    { "column": "ColumnName", "description": "What this formatter does", "jsFunction": "function(text) { return text; }" }
  ]
}
\`\`\`

IMPORTANT:
- Include ALL columns in the columns array, even hidden ones (with visible: false)
- Order determines display position (0 = leftmost)
- Only provide formatters for columns that genuinely benefit from formatting
- Width is optional — omit if the default is fine`;
```

**Step 2: Add the `improveDisplay` method**

Add a new section in the service class after the RCA section (after `analyzeRootCause` method, around line 233):

```typescript
// ==================== Improve Display (Agent Executor) ====================

async improveDisplay(
  sessionId: string,
  columns: string[],
  rows: Record<string, any>[],
  metadata: AnalysisMetadata,
): Promise<void> {
  const logger = getLogger();
  logger.info(LOG_CATEGORY, 'Starting improve display analysis', {
    sessionId, rowCount: rows.length, provider: this.provider,
  });

  try {
    // 1. Create workspace and write CSV
    const workspace = createAnalysisWorkspace(sessionId + '-display', columns, rows, [], metadata);

    // 2. Execute with chosen provider
    const outputPath = path.join(workspace.basePath, 'improve-display-output.json');

    if (this.provider === 'claude-sdk') {
      await this.executeImproveDisplayClaude(sessionId, workspace, outputPath);
    } else {
      await this.executeImproveDisplayCopilot(sessionId, workspace, columns, rows, outputPath);
    }
  } catch (err: any) {
    logger.error(LOG_CATEGORY, 'Improve display failed', { sessionId, error: err?.message });
    this.emit('ai:improve-display-complete', { sessionId, error: err?.message || 'Improve display analysis failed' });
  }
}

private async executeImproveDisplayClaude(
  sessionId: string,
  workspace: AnalysisWorkspace,
  outputPath: string,
): Promise<void> {
  const logger = getLogger();
  const ws = workspace.basePath.replace(/\\/g, '/');
  const dataPath = workspace.dataPath.replace(/\\/g, '/');
  const outPath = outputPath.replace(/\\/g, '/');

  const prompt = `${IMPROVE_DISPLAY_SYSTEM_PROMPT}

## Workspace
- CSV data file: \`${dataPath}\`
- Write your JSON output to: \`${outPath}\`

## Instructions
1. Use the read_file tool to examine the CSV data. Start by reading the first 50-100 lines to understand columns and data shape.
2. If needed, use search_file to look for patterns in specific columns (e.g., multi-line content, HTTP status codes, JSON blobs).
3. Read more of the file if needed to understand value distributions.
4. Decide which columns to show/hide and their order.
5. For columns with complex values, write JavaScript formatter functions.
6. Write the final JSON to \`${outPath}\`.`;

  const mcpServer = createSdkMcpServer({
    name: 'dgrep-display',
    version: '1.0.0',
    tools: [
      tool(
        'read_file',
        'Read lines from the CSV data file. Use offset and limit to read in chunks.',
        {
          offset: z.number().optional().default(0).describe('Line number to start reading from (0-based)'),
          limit: z.number().optional().default(200).describe('Max number of lines to read'),
        },
        async (args: { offset?: number; limit?: number }) => {
          try {
            const content = fs.readFileSync(workspace.dataPath, 'utf-8');
            const lines = content.split('\n');
            const start = args.offset ?? 0;
            const end = Math.min(start + (args.limit ?? 200), lines.length);
            const slice = lines.slice(start, end);
            return {
              content: [{
                type: 'text' as const,
                text: `Lines ${start}-${end - 1} of ${lines.length} total:\n${slice.join('\n')}`,
              }],
            };
          } catch (err: any) {
            return { content: [{ type: 'text' as const, text: `Error: ${err?.message}` }], isError: true };
          }
        }
      ),
      tool(
        'search_file',
        'Search the CSV data file for lines matching a regex pattern.',
        {
          pattern: z.string().describe('Regex pattern to search for'),
          max_results: z.number().optional().default(50).describe('Max matching lines to return'),
        },
        async (args: { pattern: string; max_results?: number }) => {
          try {
            const content = fs.readFileSync(workspace.dataPath, 'utf-8');
            const lines = content.split('\n');
            const regex = new RegExp(args.pattern, 'i');
            const matches: string[] = [];
            for (let i = 0; i < lines.length && matches.length < (args.max_results ?? 50); i++) {
              if (regex.test(lines[i])) {
                matches.push(`[line ${i}] ${lines[i]}`);
              }
            }
            return {
              content: [{
                type: 'text' as const,
                text: `${matches.length} matches for /${args.pattern}/i:\n${matches.join('\n')}`,
              }],
            };
          } catch (err: any) {
            return { content: [{ type: 'text' as const, text: `Error: ${err?.message}` }], isError: true };
          }
        }
      ),
    ],
  });

  const response = query({
    prompt,
    options: {
      model: 'opus',
      maxTurns: 20,
      cwd: workspace.basePath,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      mcpServers: { 'dgrep-display': mcpServer },
    },
  });

  for await (const message of response) {
    if (message.type === 'assistant') {
      const text = this.extractTextContent(message);
      if (text) {
        this.emit('ai:improve-display-progress', { sessionId, text });
      }
      const toolUses = this.extractToolUses(message);
      for (const t of toolUses) {
        const summary = this.summarizeToolUse(t);
        this.emit('ai:improve-display-progress', { sessionId, text: summary });
      }
    }
    if (message.type === 'result' && (message as any).is_error) {
      const errorMsg = (message as any).error || 'Agent execution failed';
      this.emit('ai:improve-display-complete', { sessionId, error: errorMsg });
      return;
    }
  }

  // Read output
  this.readAndEmitImproveDisplayOutput(sessionId, outputPath);
}

private async executeImproveDisplayCopilot(
  sessionId: string,
  workspace: AnalysisWorkspace,
  columns: string[],
  rows: Record<string, any>[],
  outputPath: string,
): Promise<void> {
  const logger = getLogger();
  const client = await this.getClient();
  const self = this;

  // For Copilot, we provide tools so the agent can read the CSV
  const session = await client.createSession({
    model: 'gpt-5.3-codex',
    streaming: true,
    systemMessage: {
      mode: 'append',
      content: IMPROVE_DISPLAY_SYSTEM_PROMPT,
    },
    tools: [
      {
        name: 'read_file',
        description: 'Read lines from the CSV data file. Use offset and limit to read in chunks.',
        parameters: {
          type: 'object',
          properties: {
            offset: { type: 'number', description: 'Line number to start from (0-based)', default: 0 },
            limit: { type: 'number', description: 'Max lines to read', default: 200 },
          },
        },
        handler: async (args: any) => {
          try {
            const content = fs.readFileSync(workspace.dataPath, 'utf-8');
            const lines = content.split('\n');
            const start = args.offset ?? 0;
            const end = Math.min(start + (args.limit ?? 200), lines.length);
            const slice = lines.slice(start, end);
            return `Lines ${start}-${end - 1} of ${lines.length} total:\n${slice.join('\n')}`;
          } catch (err: any) {
            return `Error: ${err?.message}`;
          }
        },
      },
      {
        name: 'search_file',
        description: 'Search the CSV for lines matching a regex pattern.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Regex pattern to search for' },
            max_results: { type: 'number', description: 'Max matches to return', default: 50 },
          },
          required: ['pattern'],
        },
        handler: async (args: any) => {
          try {
            const content = fs.readFileSync(workspace.dataPath, 'utf-8');
            const lines = content.split('\n');
            const regex = new RegExp(args.pattern, 'i');
            const matches: string[] = [];
            for (let i = 0; i < lines.length && matches.length < (args.max_results ?? 50); i++) {
              if (regex.test(lines[i])) {
                matches.push(`[line ${i}] ${lines[i]}`);
              }
            }
            return `${matches.length} matches for /${args.pattern}/i:\n${matches.join('\n')}`;
          } catch (err: any) {
            return `Error: ${err?.message}`;
          }
        },
      },
    ],
  });

  let fullContent = '';

  await new Promise<void>((resolve) => {
    session.on((event: any) => {
      switch (event.type) {
        case 'assistant.message_delta': {
          const delta = event.data?.deltaContent || '';
          fullContent += delta;
          if (delta) self.emit('ai:improve-display-progress', { sessionId, text: delta });
          break;
        }
        case 'assistant.message': {
          fullContent = event.data?.content || fullContent;
          break;
        }
        case 'tool.execution_start': {
          const toolName = event.data?.toolName || event.data?.name || 'tool';
          self.emit('ai:improve-display-progress', { sessionId, text: `[Tool] ${toolName}` });
          break;
        }
        case 'tool.execution_end': {
          self.emit('ai:improve-display-progress', { sessionId, text: '[Tool done]' });
          break;
        }
        case 'session.idle': {
          session.destroy().catch(() => {});
          resolve();
          break;
        }
        case 'session.error': {
          const error = event.data?.message || 'Unknown error';
          self.emit('ai:improve-display-complete', { sessionId, error });
          session.destroy().catch(() => {});
          resolve();
          break;
        }
      }
    });

    session.send({
      prompt: `Analyze the CSV data file at ${workspace.dataPath.replace(/\\/g, '/')} and provide display improvement recommendations. Use the read_file and search_file tools to explore the data. Return your final answer as the JSON object described in your instructions.`,
    }).catch((err: any) => {
      self.emit('ai:improve-display-complete', { sessionId, error: err?.message || 'Send failed' });
      resolve();
    });
  });

  // Copilot can't write files — parse from response
  if (fullContent) {
    const parsed = this.tryParseJSON(fullContent);
    if (parsed) {
      try { fs.writeFileSync(outputPath, JSON.stringify(parsed, null, 2), 'utf-8'); } catch { /* ignore */ }
    }
  }

  this.readAndEmitImproveDisplayOutput(sessionId, outputPath);
}

private readAndEmitImproveDisplayOutput(sessionId: string, outputPath: string): void {
  const logger = getLogger();
  try {
    if (!fs.existsSync(outputPath)) {
      this.emit('ai:improve-display-complete', { sessionId, error: 'Agent did not produce output' });
      return;
    }
    const raw = fs.readFileSync(outputPath, 'utf-8');
    const result = JSON.parse(raw);
    this.emit('ai:improve-display-complete', { sessionId, result });
    logger.info(LOG_CATEGORY, 'Improve display complete', { sessionId });
  } catch (err: any) {
    logger.error(LOG_CATEGORY, 'Failed to read improve display output', { sessionId, error: err?.message });
    this.emit('ai:improve-display-complete', { sessionId, error: `Failed to read output: ${err?.message}` });
  }
}
```

**Step 3: Commit**

```bash
git add src/main/dgrep/dgrep-ai-service.ts
git commit -m "feat(dgrep): add improveDisplay agent method with read_file/search_file tools"
```

---

### Task 3: Wire up bridge RPC and events

**Files:**
- Modify: `src-backend/bridge.ts`

**Step 1: Add event forwarding**

After the existing AI event forwards (around line 272, after `ai:client-query-update`), add:

```typescript
dgrepAIService.on('ai:improve-display-progress', (event) => broadcast('dgrep:ai:improve-display-progress', event));
dgrepAIService.on('ai:improve-display-complete', (event) => broadcast('dgrep:ai:improve-display-complete', event));
```

**Step 2: Add RPC handler**

In the switch statement, after the `dgrep-ai:detect-anomalies` case (around line 1255), add:

```typescript
case 'dgrep-ai:improve-display': {
  // params: [sessionId, columns, rows, metadata]
  const idMetadata = params[3] || {};
  const idSettings = loadStoreData().consoleReview?.dgrepAnalysis;
  if (idSettings) {
    dgrepAIService.setProvider(idSettings.provider);
  }
  const idSourceRepo = idMetadata.sourceRepoPath || idSettings?.sourceRepository || null;
  dgrepAIService.setSourceRepo(idSourceRepo);
  // Use full rows from session cache
  const idFullResults = dgrepService.getResults(params[0]);
  const idColumns = idFullResults?.columns || params[1];
  const idRows = idFullResults?.rows || params[2];
  dgrepAIService.improveDisplay(params[0], idColumns, idRows, idMetadata);
  return;
}
```

**Step 3: Commit**

```bash
git add src-backend/bridge.ts
git commit -m "feat(dgrep): wire improve-display RPC and events in bridge"
```

---

### Task 4: Add API types and frontend bridge

**Files:**
- Modify: `src/renderer/api.d.ts`
- Modify: `src/renderer/tauri-api.ts`

**Step 1: Add to `api.d.ts`**

After the `dgrepAIDetectAnomalies` declaration (around line 547), add:

```typescript
dgrepAIImproveDisplay: (sessionId: string, columns: string[], rows: any[], metadata: any) => Promise<void>;
```

After the `onDgrepAIClientQueryUpdate` declaration (around line 560), add:

```typescript
onDgrepAIImproveDisplayProgress: (callback: (event: { sessionId: string; text: string }) => void) => () => void;
onDgrepAIImproveDisplayComplete: (callback: (event: { sessionId: string; result?: import('../shared/dgrep-ai-types.js').ImproveDisplayResult; error?: string }) => void) => () => void;
```

**Step 2: Add to `tauri-api.ts`**

After the `dgrepAIDetectAnomalies` implementation (around line 725), add:

```typescript
dgrepAIImproveDisplay: (sessionId: string, columns: string[], rows: any[], metadata: any) =>
  invoke('dgrep-ai:improve-display', sessionId, columns, rows, metadata),
```

After the `onDgrepAIClientQueryUpdate` subscription (around line 743), add:

```typescript
onDgrepAIImproveDisplayProgress: (callback: (event: any) => void) => subscribe('dgrep:ai:improve-display-progress', callback),
onDgrepAIImproveDisplayComplete: (callback: (event: any) => void) => subscribe('dgrep:ai:improve-display-complete', callback),
```

**Step 3: Commit**

```bash
git add src/renderer/api.d.ts src/renderer/tauri-api.ts
git commit -m "feat(dgrep): add improve-display API types and frontend bridge"
```

---

### Task 5: Add `setCellFormatters` to `dgrep-virtual-scroller.ts`

**Files:**
- Modify: `src/renderer/components/dgrep-virtual-scroller.ts`

**Step 1: Add formatter state**

In the class properties area (around line 40-60, after the existing state fields), add:

```typescript
private cellFormatters: Map<string, (text: string) => string> = new Map();
```

**Step 2: Add setter method**

After `setActiveColumnFilters` (around line 176), add:

```typescript
/** Set custom cell formatter functions (column name → fn that returns HTML) */
setCellFormatters(formatters: Map<string, (text: string) => string>): void {
  this.cellFormatters = formatters;
  this.clearRenderedRows();
  this.renderVisibleRows();
}
```

**Step 3: Modify cell rendering to use formatters**

In the `renderRow` method, find the cell rendering block (around line 315-341). After the line:
```typescript
const escaped = this.escapeHtml(display);
cell.innerHTML = this.highlightMatch(escaped);
```

Replace those 2 lines with:

```typescript
const formatter = this.cellFormatters.get(col);
if (formatter) {
  try {
    cell.innerHTML = formatter(str);
  } catch {
    const escaped = this.escapeHtml(display);
    cell.innerHTML = this.highlightMatch(escaped);
  }
} else {
  const escaped = this.escapeHtml(display);
  cell.innerHTML = this.highlightMatch(escaped);
}
```

**Step 4: Commit**

```bash
git add src/renderer/components/dgrep-virtual-scroller.ts
git commit -m "feat(dgrep): add setCellFormatters to virtual scroller for custom cell rendering"
```

---

### Task 6: Add improve display state and toggle to `dgrep-results-table.ts`

**Files:**
- Modify: `src/renderer/components/dgrep-results-table.ts`

**Step 1: Add import**

At the top of the file, add the import:

```typescript
import type { ImproveDisplayResult } from '../../shared/dgrep-ai-types.js';
```

**Step 2: Add state fields**

In the class properties area (after `private activePreset`, around line 139), add:

```typescript
// Improve Display state
private improveDisplayResult: ImproveDisplayResult | null = null;
private improveDisplayActive = false;
private preImproveColumns: { visibleColumns: Set<string>; columnWidths: Map<string, number>; columnOrder: string[]; activePreset: 'essential' | 'all' | 'custom' } | null = null;
private compiledFormatters: Map<string, (text: string) => string> = new Map();
private improveDisplayLoading = false;
private improveDisplayProgressEl: HTMLElement | null = null;
```

**Step 3: Add callback**

After the `onRowExpandCallback` declaration (around line 181), add:

```typescript
private onImproveDisplayRequestCallback: (() => void) | null = null;
```

**Step 4: Add public method to register callback**

After the `onRowExpand` method (around line 243), add:

```typescript
/** Register callback to request improve display analysis from backend */
onImproveDisplayRequest(cb: () => void): void {
  this.onImproveDisplayRequestCallback = cb;
}
```

**Step 5: Add public method to receive results**

```typescript
/** Called when improve display analysis completes */
setImproveDisplayResult(result: ImproveDisplayResult): void {
  this.improveDisplayResult = result;
  this.improveDisplayLoading = false;
  this.hideImproveDisplayProgress();
  if (this.improveDisplayActive) {
    this.applyImproveDisplay();
  }
}

/** Called when improve display analysis fails */
setImproveDisplayError(error: string): void {
  this.improveDisplayLoading = false;
  this.improveDisplayActive = false;
  this.hideImproveDisplayProgress();
  this.renderToolbar();
}

/** Called to show streaming progress text */
showImproveDisplayProgress(text: string): void {
  if (!this.improveDisplayProgressEl) return;
  // Keep only last 2 lines of progress
  const existing = this.improveDisplayProgressEl.querySelector('.dgrep-improve-display-text');
  if (existing) {
    // Append and keep last line
    const clean = text.replace(/\n/g, ' ').trim();
    if (clean) existing.textContent = clean;
  }
}
```

**Step 6: Add the toggle handler and apply/revert methods**

```typescript
private onImproveDisplayToggle(): void {
  if (this.improveDisplayLoading) return;

  this.improveDisplayActive = !this.improveDisplayActive;
  this.renderToolbar();

  if (this.improveDisplayActive) {
    if (this.improveDisplayResult) {
      // Cached — apply instantly
      this.applyImproveDisplay();
    } else {
      // First time — request from backend
      this.improveDisplayLoading = true;
      this.showImproveDisplayProgressBar();
      this.onImproveDisplayRequestCallback?.();
    }
  } else {
    this.revertImproveDisplay();
  }
}

private showImproveDisplayProgressBar(): void {
  // Insert progress bar between toolbar and content
  if (this.improveDisplayProgressEl) return;
  const el = document.createElement('div');
  el.className = 'dgrep-improve-display-progress';
  el.innerHTML = `
    <span class="dgrep-improve-display-icon">&#10024;</span>
    <span class="dgrep-improve-display-text">Analyzing log structure...</span>
    <span class="dgrep-ai-loading-dots"></span>
  `;
  // Insert after toolbar
  this.toolbarEl.insertAdjacentElement('afterend', el);
  this.improveDisplayProgressEl = el;
}

private hideImproveDisplayProgress(): void {
  if (this.improveDisplayProgressEl) {
    this.improveDisplayProgressEl.remove();
    this.improveDisplayProgressEl = null;
  }
}

private applyImproveDisplay(): void {
  const result = this.improveDisplayResult;
  if (!result) return;

  // Save current state
  this.preImproveColumns = {
    visibleColumns: new Set(this.visibleColumns),
    columnWidths: new Map(this.columnWidths),
    columnOrder: [...this.columns],
    activePreset: this.activePreset,
  };

  // Apply column visibility and order
  const newVisible = new Set<string>();
  const orderedCols = result.columns
    .filter(c => c.visible)
    .sort((a, b) => a.order - b.order)
    .map(c => c.name);

  for (const c of orderedCols) {
    if (this.columns.includes(c)) newVisible.add(c);
  }
  // Add any columns not in result as hidden
  this.visibleColumns = newVisible;

  // Reorder columns array to match AI recommendation
  const reordered: string[] = [];
  for (const name of orderedCols) {
    if (this.columns.includes(name)) reordered.push(name);
  }
  // Append remaining columns not in the AI list
  for (const c of this.columns) {
    if (!reordered.includes(c)) reordered.push(c);
  }
  this.columns = reordered;

  // Apply widths
  for (const col of result.columns) {
    if (col.width && this.columns.includes(col.name)) {
      this.columnWidths.set(col.name, col.width);
    }
  }

  // Compile formatters
  this.compiledFormatters.clear();
  for (const fmt of result.formatters) {
    try {
      const fn = new Function('text', fmt.jsFunction.replace(/^function\s*\([^)]*\)\s*\{/, '').replace(/\}$/, '')) as (text: string) => string;
      // Wrap with sanitization
      this.compiledFormatters.set(fmt.column, (text: string) => {
        const raw = fn(text);
        return this.sanitizeFormatterHtml(raw);
      });
    } catch {
      // Skip invalid formatters
    }
  }

  this.activePreset = 'custom';
  this.scroller.setCellFormatters(this.compiledFormatters);
  this.updateScroller();
  this.renderToolbar();
}

private revertImproveDisplay(): void {
  if (!this.preImproveColumns) return;

  this.visibleColumns = this.preImproveColumns.visibleColumns;
  this.columnWidths = this.preImproveColumns.columnWidths;
  this.columns = this.preImproveColumns.columnOrder;
  this.activePreset = this.preImproveColumns.activePreset;
  this.preImproveColumns = null;

  this.compiledFormatters.clear();
  this.scroller.setCellFormatters(this.compiledFormatters);
  this.updateScroller();
  this.renderToolbar();
}

private sanitizeFormatterHtml(html: string): string {
  // Strip dangerous elements and attributes
  const div = document.createElement('div');
  div.innerHTML = html;

  // Remove script, iframe, object, embed, form
  for (const tag of ['script', 'iframe', 'object', 'embed', 'form', 'link', 'meta']) {
    for (const el of div.querySelectorAll(tag)) el.remove();
  }

  // Remove event handler attributes and javascript: URLs
  const allEls = div.querySelectorAll('*');
  for (const el of allEls) {
    const attrs = [...el.attributes];
    for (const attr of attrs) {
      if (attr.name.startsWith('on') || attr.value.includes('javascript:')) {
        el.removeAttribute(attr.name);
      }
    }
  }

  return div.innerHTML;
}
```

**Step 7: Add toggle button to `renderToolbar`**

In the `renderToolbar` method (around line 968, after the Essential/All preset buttons), add the Improve Display toggle:

```html
<button class="btn btn-xs btn-secondary dgrep-improve-display-btn${this.improveDisplayActive ? ' active' : ''}${this.improveDisplayLoading ? ' loading' : ''}" title="AI-powered display improvements">
  &#10024; Improve Display
</button>
```

**Step 8: Wire toggle event in `attachToolbarEvents`**

In the `attachToolbarEvents` method, add:

```typescript
this.toolbarEl.querySelector('.dgrep-improve-display-btn')?.addEventListener('click', () => {
  this.onImproveDisplayToggle();
});
```

**Step 9: Clear cache on new data**

In `setData` method, inside the `if (isNewQuery)` block (around line 253), add:

```typescript
// Clear improve display cache on new query
this.improveDisplayResult = null;
this.improveDisplayActive = false;
this.preImproveColumns = null;
this.compiledFormatters.clear();
this.scroller.setCellFormatters(this.compiledFormatters);
this.hideImproveDisplayProgress();
```

**Step 10: Commit**

```bash
git add src/renderer/components/dgrep-results-table.ts
git commit -m "feat(dgrep): add Improve Display toggle with apply/revert and HTML sanitization"
```

---

### Task 7: Wire events in `dgrep-search-view.ts` and `app.ts`

**Files:**
- Modify: `src/renderer/components/dgrep-search-view.ts`
- Modify: `src/renderer/app.ts`

**Step 1: Add handler methods in `dgrep-search-view.ts`**

After the existing AI event handlers (around line 334), add:

```typescript
handleAIImproveDisplayProgress(event: { sessionId: string; text: string }): void {
  if (event.sessionId === this.activeSessionId) {
    this.resultsTable?.showImproveDisplayProgress(event.text);
  }
}

handleAIImproveDisplayComplete(event: { sessionId: string; result?: ImproveDisplayResult; error?: string }): void {
  if (event.sessionId !== this.activeSessionId) return;
  if (event.error) {
    this.resultsTable?.setImproveDisplayError(event.error);
  } else if (event.result) {
    this.resultsTable?.setImproveDisplayResult(event.result);
  }
}
```

**Step 2: Register the callback in search view initialization**

Where the results table is initialized (find where `this.resultsTable = new DGrepResultsTable(...)` is called), add after it:

```typescript
this.resultsTable.onImproveDisplayRequest(() => {
  if (!this.activeSessionId) return;
  const columns = this.resultsTable.getColumns();
  const rows = this.resultsTable.getAllRows();
  const metadata = this.buildMetadata();
  window.electronAPI.dgrepAIImproveDisplay(this.activeSessionId, columns, rows, metadata);
});
```

**Step 3: Add import for `ImproveDisplayResult` in search view**

At the top of `dgrep-search-view.ts`, add to the existing dgrep-ai-types import:

```typescript
import type { ..., ImproveDisplayResult } from '../../shared/dgrep-ai-types.js';
```

**Step 4: Wire events in `app.ts`**

After the existing DGrep AI event listeners (around line 1126), add:

```typescript
window.electronAPI.onDgrepAIImproveDisplayProgress((event: any) => {
  this.dgrepSearchView.handleAIImproveDisplayProgress(event);
});
window.electronAPI.onDgrepAIImproveDisplayComplete((event: any) => {
  this.dgrepSearchView.handleAIImproveDisplayComplete(event);
});
```

**Step 5: Commit**

```bash
git add src/renderer/components/dgrep-search-view.ts src/renderer/app.ts
git commit -m "feat(dgrep): wire improve-display events through search view and app"
```

---

### Task 8: Add CSS for progress bar and toggle

**Files:**
- Modify: `src/renderer/styles/dgrep.css`

**Step 1: Add styles**

At the end of the file (or near the existing AI progress styles around line 3220), add:

```css
/* Improve Display progress bar */
.dgrep-improve-display-progress {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 4px var(--space-3);
  background: color-mix(in srgb, var(--accent-blue) 8%, var(--bg-secondary));
  border-bottom: 1px solid var(--border-color-muted);
  font-size: 11px;
  color: var(--text-secondary);
  min-height: 24px;
  flex-shrink: 0;
}

.dgrep-improve-display-icon {
  font-size: 12px;
}

.dgrep-improve-display-text {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Improve Display toggle button states */
.dgrep-improve-display-btn.active {
  background: color-mix(in srgb, var(--accent-blue) 20%, var(--bg-secondary));
  border-color: var(--accent-blue);
  color: var(--accent-blue);
}

.dgrep-improve-display-btn.loading {
  opacity: 0.7;
  pointer-events: none;
}
```

**Step 2: Commit**

```bash
git add src/renderer/styles/dgrep.css
git commit -m "feat(dgrep): add Improve Display CSS for progress bar and toggle states"
```

---

### Task 9: Integration test — verify full flow manually

**Step 1: Build the project**

```bash
npm run build
```

**Step 2: Run and test**

1. Open TaskDock, navigate to DGrep
2. Run a log search
3. Click "Improve Display" toggle
4. Verify: progress bar appears with streaming text
5. Verify: after analysis completes, columns reorder and formatters apply
6. Verify: toggle OFF reverts to original view
7. Verify: toggle ON again re-applies instantly (no new LLM call)
8. Verify: new search clears the cache

**Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(dgrep): integration fixes for improve display"
```
