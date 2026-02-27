# Scrub Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a transparent middleware that tokenizes sensitive values (GUIDs, emails, etc.) before they reach AI agents, and restores them when rendering agent output in the UI.

**Architecture:** A `ScrubLayer` class with dual in-memory Maps for O(1) bidirectional lookup. Intercepts at both tool level (wrapping SDK tool handlers) and message level (wrapping event emission). Persisted as JSON per analysis session.

**Tech Stack:** TypeScript, Node.js Map, JSON for persistence. No external dependencies.

**Design doc:** `docs/plans/2026-02-25-scrub-layer-design.md`

---

### Task 1: Create ScrubLayer Core Class

**Files:**
- Create: `src/main/dgrep/scrub-layer.ts`

**Step 1: Create the file with core data structures and pattern management**

```typescript
/**
 * ScrubLayer — Transparent token-based data scrubbing for agent pipelines.
 * Replaces sensitive values (GUIDs, emails, etc.) with short tokens like scrub_g1,
 * and restores them on agent output. O(1) bidirectional lookup via dual Maps.
 */

import fs from 'fs';
import path from 'path';

export interface ScrubPattern {
  name: string;
  letter: string;
  regex: RegExp;
}

interface TokenMapFile {
  version: number;
  patterns: Record<string, { letter: string; regex: string }>;
  mappings: Array<{ value: string; token: string }>;
}

const TOKEN_MAP_FILENAME = 'token-map.json';

export class ScrubLayer {
  private valueToToken = new Map<string, string>();
  private tokenToValue = new Map<string, string>();
  private counters = new Map<string, number>();
  private patterns: ScrubPattern[] = [];
  private scrubRegex: RegExp | null = null;
  private static readonly UNSCRUB_REGEX = /\bscrub_[a-z]\d+\b/g;

  /** Register a pattern type. Letter must be a single lowercase character. */
  addPattern(name: string, letter: string, regex: RegExp): void {
    if (letter.length !== 1 || !/^[a-z]$/.test(letter)) {
      throw new Error(`Pattern letter must be a single lowercase char, got "${letter}"`);
    }
    if (this.patterns.some(p => p.letter === letter)) {
      throw new Error(`Pattern letter "${letter}" already registered`);
    }
    this.patterns.push({ name, letter, regex });
    if (!this.counters.has(letter)) this.counters.set(letter, 0);
    this.rebuildScrubRegex();
  }

  /** Rebuild the combined scrub regex from all registered patterns. */
  private rebuildScrubRegex(): void {
    if (this.patterns.length === 0) {
      this.scrubRegex = null;
      return;
    }
    // Combine all pattern regexes into one with named groups
    // We use a union: (pattern1)|(pattern2)|...
    // Then check which group matched to determine the letter
    const parts = this.patterns.map((p, i) => `(?<p${i}>${p.regex.source})`);
    this.scrubRegex = new RegExp(parts.join('|'), 'gi');
  }

  /** Get or create a token for a matched value. */
  private getOrCreateToken(value: string, letter: string): string {
    const existing = this.valueToToken.get(value);
    if (existing) return existing;
    const count = (this.counters.get(letter) ?? 0) + 1;
    this.counters.set(letter, count);
    const token = `scrub_${letter}${count}`;
    this.valueToToken.set(value, token);
    this.tokenToValue.set(token, value);
    return token;
  }

  /** Replace all pattern matches in text with tokens. */
  scrubText(input: string): string {
    if (!this.scrubRegex || this.patterns.length === 0) return input;
    // Reset lastIndex for global regex
    this.scrubRegex.lastIndex = 0;
    return input.replace(this.scrubRegex, (match, ...args) => {
      // args: captured groups..., offset, fullString, namedGroups
      const groups = args[args.length - 1] as Record<string, string>;
      for (let i = 0; i < this.patterns.length; i++) {
        if (groups[`p${i}`] !== undefined) {
          return this.getOrCreateToken(match, this.patterns[i].letter);
        }
      }
      return match; // shouldn't happen
    });
  }

  /** Replace all tokens in text with original values. */
  unscrubText(input: string): string {
    return input.replace(ScrubLayer.UNSCRUB_REGEX, (token) => {
      return this.tokenToValue.get(token) ?? token;
    });
  }

  /** Number of stored mappings. */
  get size(): number {
    return this.valueToToken.size;
  }

  /** Save token map to a workspace directory. */
  save(workspacePath: string): void {
    const data: TokenMapFile = {
      version: 1,
      patterns: {},
      mappings: [],
    };
    for (const p of this.patterns) {
      data.patterns[p.name] = { letter: p.letter, regex: p.regex.source };
    }
    for (const [value, token] of this.valueToToken) {
      data.mappings.push({ value, token });
    }
    fs.writeFileSync(
      path.join(workspacePath, TOKEN_MAP_FILENAME),
      JSON.stringify(data, null, 2),
      'utf-8'
    );
  }

  /** Load token map from a workspace directory. Returns new ScrubLayer with defaults if file missing. */
  static load(workspacePath: string): ScrubLayer {
    const layer = new ScrubLayer();
    const filePath = path.join(workspacePath, TOKEN_MAP_FILENAME);
    if (!fs.existsSync(filePath)) {
      layer.addPattern('GUID', 'g', /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
      return layer;
    }
    const data: TokenMapFile = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    // Restore patterns
    for (const [name, { letter, regex }] of Object.entries(data.patterns)) {
      layer.addPattern(name, letter, new RegExp(regex));
    }
    // Restore mappings and rebuild counters
    for (const { value, token } of data.mappings) {
      layer.valueToToken.set(value, token);
      layer.tokenToValue.set(token, value);
      // Parse counter from token: "scrub_g5" → letter "g", count 5
      const match = token.match(/^scrub_([a-z])(\d+)$/);
      if (match) {
        const [, letter, countStr] = match;
        const count = parseInt(countStr, 10);
        const current = layer.counters.get(letter) ?? 0;
        if (count > current) layer.counters.set(letter, count);
      }
    }
    return layer;
  }

  /** Create a new ScrubLayer with default GUID pattern. */
  static createDefault(): ScrubLayer {
    const layer = new ScrubLayer();
    layer.addPattern('GUID', 'g', /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
    return layer;
  }
}
```

**Step 2: Verify the file compiles**

Run: `npx tsc --noEmit src/main/dgrep/scrub-layer.ts`
Expected: No errors (or run the project build to verify)

**Step 3: Commit**

```bash
git add src/main/dgrep/scrub-layer.ts
git commit -m "feat(scrub): add ScrubLayer core class with bidirectional token mapping"
```

---

### Task 2: Add Tool Wrapping Methods

**Files:**
- Modify: `src/main/dgrep/scrub-layer.ts`

**Step 1: Add tool wrapper methods to ScrubLayer class**

Add these methods to the `ScrubLayer` class, after the `unscrubText` method:

```typescript
  /**
   * Wrap a Claude Agent SDK tool — scrub handler return, unscrub handler args.
   * Works with tools created via tool() from @anthropic-ai/claude-agent-sdk.
   */
  wrapSdkToolHandler<T>(
    handler: (args: T) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>
  ): (args: T) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    return async (args: T) => {
      // Unscrub args in case agent passed tokens as arguments
      const unscrubbed = JSON.parse(this.unscrubText(JSON.stringify(args))) as T;
      const result = await handler(unscrubbed);
      // Scrub the response text before agent sees it
      return {
        ...result,
        content: result.content.map(c =>
          c.type === 'text' ? { ...c, text: this.scrubText(c.text) } : c
        ),
      };
    };
  }

  /**
   * Wrap a Copilot SDK tool handler — scrub return, unscrub args.
   * Works with tool handlers that return plain strings.
   */
  wrapCopilotToolHandler(
    handler: (args: any) => Promise<string>
  ): (args: any) => Promise<string> {
    return async (args: any) => {
      const unscrubbed = JSON.parse(this.unscrubText(JSON.stringify(args)));
      const result = await handler(unscrubbed);
      return this.scrubText(result);
    };
  }
```

**Step 2: Verify compilation**

Run project build or `npx tsc --noEmit` to confirm no type errors.

**Step 3: Commit**

```bash
git add src/main/dgrep/scrub-layer.ts
git commit -m "feat(scrub): add SDK tool handler wrappers for Claude and Copilot"
```

---

### Task 3: Integrate ScrubLayer into Analysis Workspace

**Files:**
- Modify: `src/main/dgrep/dgrep-analysis-workspace.ts` (lines 16-25, 43-84)

**Step 1: Add ScrubLayer to workspace creation**

In `dgrep-analysis-workspace.ts`, add the import and modify `createAnalysisWorkspace`:

```typescript
// Add import at top
import { ScrubLayer } from './scrub-layer.js';
```

Add `scrubLayer` to the `AnalysisWorkspace` interface:

```typescript
export interface AnalysisWorkspace {
  basePath: string;
  dataPath: string;
  queryToolPath: string;
  kqlGuidelinesPath: string;
  metadataPath: string;
  summaryOutputPath: string;
  rcaOutputPath: string;
  promptPath: string;
  scrubLayer: ScrubLayer;
}
```

In `createAnalysisWorkspace`, after building the CSV content (line 59) but before `writeFileSync` (line 60), scrub the CSV:

```typescript
  // Build CSV content
  const csvContent = [header, ...csvRows].join('\n');

  // Scrub sensitive values before writing
  const scrubLayer = ScrubLayer.createDefault();
  const scrubbedCsv = scrubLayer.scrubText(csvContent);
  fs.writeFileSync(dataPath, scrubbedCsv, 'utf-8');
```

Add `scrubLayer` to the return object:

```typescript
  return {
    basePath,
    dataPath,
    // ... existing fields ...
    scrubLayer,
  };
```

**Step 2: Add a `loadAnalysisWorkspace` helper** (or update existing loading code)

If there's existing workspace loading logic, integrate `ScrubLayer.load(basePath)`. If not, add:

```typescript
/** Load a ScrubLayer for an existing workspace. */
export function loadScrubLayer(basePath: string): ScrubLayer {
  return ScrubLayer.load(basePath);
}
```

**Step 3: Verify compilation**

Run project build. Fix any type errors from the new `scrubLayer` field in `AnalysisWorkspace`.

**Step 4: Commit**

```bash
git add src/main/dgrep/dgrep-analysis-workspace.ts
git commit -m "feat(scrub): integrate ScrubLayer into analysis workspace creation"
```

---

### Task 4: Wrap Tool Handlers in DGrep AI Service

**Files:**
- Modify: `src/main/dgrep/dgrep-ai-service.ts`

This is the core integration. The scrub layer must wrap every tool handler in both SDK paths.

**Step 1: Import ScrubLayer**

Add at top of file:

```typescript
import { ScrubLayer } from './scrub-layer.js';
```

**Step 2: Wrap Claude Agent SDK tools**

In the `improveDisplay` method (around lines 352-389), where tools are created with `tool()`, wrap each handler. The workspace already has a `scrubLayer` from Task 3.

For the `read_file` tool handler (line ~358):

```typescript
tool(
  'read_file',
  'Read lines from the CSV data file...',
  { offset: z.number()..., limit: z.number()... },
  workspace.scrubLayer.wrapSdkToolHandler(async (args: { offset?: number; limit?: number }) => {
    try {
      const text = this.readFileLines(workspace.dataPath, args.offset, args.limit);
      return { content: [{ type: 'text' as const, text }] };
    } catch (err: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${err?.message}` }], isError: true };
    }
  })
),
```

Apply the same wrapping pattern to all other tools in the Claude SDK path.

**Step 3: Wrap Copilot SDK tools**

In the Copilot `improveDisplay` path (around lines 440-478), wrap each `handler`:

```typescript
{
  name: 'read_file',
  description: '...',
  parameters: { ... },
  handler: workspace.scrubLayer.wrapCopilotToolHandler(async (args: any) => {
    try {
      return this.readFileLines(workspace.dataPath, args.offset ?? 0, args.limit ?? 200);
    } catch (err: any) {
      return `Error: ${err?.message}`;
    }
  }),
},
```

Apply to all Copilot tools.

**Step 4: Wrap chat session tools**

In `createChatToolServer` (lines ~1334-1423) and the Copilot chat tools (lines ~1263-1323), wrap handlers the same way. The chat session needs a scrub layer — get it from the workspace:

```typescript
// In chat session creation, load the scrub layer for the session's workspace
const scrubLayer = workspace?.scrubLayer ?? ScrubLayer.createDefault();
```

**Step 5: Verify compilation and run the app**

Run build. Verify no type errors. Test that DGrep analysis still works.

**Step 6: Commit**

```bash
git add src/main/dgrep/dgrep-ai-service.ts
git commit -m "feat(scrub): wrap all SDK tool handlers with ScrubLayer"
```

---

### Task 5: Unscrub Agent Output in Event Emission

**Files:**
- Modify: `src/main/dgrep/dgrep-ai-service.ts`

**Step 1: Unscrub text in extractTextContent**

In `extractTextContent` (lines ~862-874), apply unscrubbing to text going to the UI. This requires the scrub layer to be accessible. Pass it as a parameter or store it on the class:

Add a field to track the active scrub layer per session:

```typescript
private scrubLayers = new Map<string, ScrubLayer>();
```

When a session starts (workspace created), store the scrub layer:

```typescript
this.scrubLayers.set(sessionId, workspace.scrubLayer);
```

**Step 2: Unscrub progress events**

In the response processing loop (lines ~728-750), before emitting progress events:

```typescript
const scrubLayer = this.scrubLayers.get(sessionId);
const text = this.extractTextContent(message);
if (text) {
  const displayText = scrubLayer ? scrubLayer.unscrubText(text) : text;
  this.emit(`ai:${taskType}-progress`, { sessionId, text: displayText });
}
```

**Step 3: Unscrub completion events**

For `complete` events that contain final results (summary JSON, RCA JSON), unscrub the serialized result before emitting:

```typescript
// When emitting completion
const result = JSON.parse(rawResult);
const unscrubbed = scrubLayer
  ? JSON.parse(scrubLayer.unscrubText(JSON.stringify(result)))
  : result;
this.emit(`ai:${taskType}-complete`, { sessionId, result: unscrubbed });
```

**Step 4: Unscrub chat events**

In `handleCopilotChatEvent` (lines ~1770-1854), unscrub `deltaContent` and `fullContent`:

```typescript
case 'assistant.message_delta': {
  let delta = event.data?.deltaContent || '';
  const scrubLayer = this.scrubLayers.get(chatSessionId);
  if (scrubLayer) delta = scrubLayer.unscrubText(delta);
  // ... rest of handler
}
```

**Step 5: Save scrub layer on session close**

When a session/analysis completes or the chat is destroyed, save the scrub layer:

```typescript
// In destroyChatSession or analysis completion
const scrubLayer = this.scrubLayers.get(sessionId);
if (scrubLayer && workspace) {
  scrubLayer.save(workspace.basePath);
  this.scrubLayers.delete(sessionId);
}
```

**Step 6: Verify compilation and test**

Run build. Test that agent progress text shows real GUIDs, not tokens.

**Step 7: Commit**

```bash
git add src/main/dgrep/dgrep-ai-service.ts
git commit -m "feat(scrub): unscrub agent output in event emission to UI"
```

---

### Task 6: Integrate with CFV Converter

**Files:**
- Modify: `src/main/cfv/cfv-converter.ts`

**Step 1: Import and create ScrubLayer**

```typescript
import { ScrubLayer } from '../dgrep/scrub-layer.js';
```

At the start of the conversion function, create a scrub layer:

```typescript
const scrubLayer = ScrubLayer.createDefault();
```

**Step 2: Scrub CSV index content**

Before writing `index.csv` (line ~93), scrub the content:

```typescript
const csvContent = csvLines.join('\n');
writePromises.push(
  writeFile(join(callflowDir, 'index.csv'), scrubLayer.scrubText(csvContent), 'utf-8')
);
```

**Step 3: Scrub TOON message content**

Before encoding TOON message details (line ~88), scrub string fields:

```typescript
// Scrub string values in messageDetail before encoding
const scrubbedDetail = JSON.parse(scrubLayer.scrubText(JSON.stringify(messageDetail)));
writePromises.push(writeFile(msgPath, encode(scrubbedDetail), 'utf-8'));
```

**Step 4: Save the scrub layer alongside CFV data**

```typescript
scrubLayer.save(callflowDir);
```

**Step 5: Commit**

```bash
git add src/main/cfv/cfv-converter.ts
git commit -m "feat(scrub): integrate ScrubLayer with CFV converter"
```

---

### Task 7: Add Shared Types

**Files:**
- Modify: `src/shared/dgrep-ai-types.ts`

**Step 1: Add scrub-related types for the frontend**

```typescript
/** Token mapping entry for display in UI */
export interface ScrubTokenEntry {
  token: string;
  originalValue: string;
  patternType: string;
}

/** Scrub layer summary sent to frontend */
export interface ScrubLayerInfo {
  tokenCount: number;
  patterns: Array<{ name: string; letter: string }>;
  tokens?: ScrubTokenEntry[];
}
```

**Step 2: Add scrubInfo to relevant event types**

If needed, add an optional `scrubInfo` field to completion events so the frontend knows scrubbing is active:

```typescript
// In existing completion event types, add:
scrubInfo?: ScrubLayerInfo;
```

**Step 3: Commit**

```bash
git add src/shared/dgrep-ai-types.ts
git commit -m "feat(scrub): add shared types for scrub layer info"
```

---

### Task 8: End-to-End Verification

**Files:**
- No new files. Manual testing.

**Step 1: Build the project**

Run: `npm run build` (or project build command)
Expected: Clean build, no errors.

**Step 2: Test DGrep analysis with GUIDs**

1. Open TaskDock
2. Run a DGrep query that returns rows with GUIDs
3. Trigger AI analysis (summary or RCA)
4. Verify in `~/.taskdock/dgrep/analysis/{sessionId}/data.csv` that GUIDs are replaced with `scrub_g1`, `scrub_g2`, etc.
5. Verify agent progress text in UI shows real GUIDs (unscrubbed)
6. Verify `token-map.json` exists in the workspace

**Step 3: Test session persistence**

1. Close and reopen TaskDock
2. Resume an analysis session
3. Verify token mappings are restored (same GUID gets same token)

**Step 4: Test chat flow**

1. Open DGrep chat
2. Ask agent about specific data — verify it uses tokens internally
3. Verify chat output in UI shows real values

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(scrub): address integration issues from e2e testing"
```
