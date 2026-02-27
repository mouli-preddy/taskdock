# Scrub Layer: Token-Based Data Scrubbing for Agent Pipelines

**Date:** 2026-02-25
**Status:** Approved

## Problem

When DGrep/CFV log data is fed to AI agents via tool calls, raw GUIDs, emails, and other sensitive identifiers are sent to the LLM. This is noisy (GUIDs waste tokens), leaks PII, and makes agent output harder to read.

## Solution

A transparent middleware layer (`ScrubLayer`) that sits between the agent and all data tool calls. It replaces sensitive values with short, deterministic tokens on the way in, and restores them on the way out.

## Token Format

Short, agent-safe prefixed identifiers: `scrub_<type_letter><counter>`

| Pattern | Letter | Examples |
|---------|--------|----------|
| GUID/UUID | `g` | `scrub_g1`, `scrub_g2` |
| Email | `e` | `scrub_e1`, `scrub_e2` |
| Tenant ID | `t` | `scrub_t1`, `scrub_t2` |
| Custom | user-defined | `scrub_x1`, `scrub_c1` |

**Detection regex:** `/\bscrub_[a-z]\d+\b/g`

The `scrub_` prefix makes all tokens unambiguously detectable in a single regex pass. The format looks like a natural variable name so agents treat it as atomic and don't attempt to modify or strip it.

## Architecture

```
┌──────────┐     ┌──────────────┐     ┌──────────┐
│  Agent   │ ←→  │  ScrubLayer  │ ←→  │  Tools   │
│  (LLM)   │     │ (middleware)  │     │  (data)  │
└──────────┘     └──────────────┘     └──────────┘
```

### Components

```
ScrubLayer
├── PatternRegistry     name → { letter, regex }
├── TokenStore          Two Maps for O(1) bidirectional lookup
│   ├── valueToToken    Map<string, string>  "e7575c71-..." → "scrub_g1"
│   └── tokenToValue    Map<string, string>  "scrub_g1" → "e7575c71-..."
├── counters            Map<string, number>  "g" → 2, "e" → 1
└── detectionRegex      /\bscrub_[a-z]\d+\b/g  (rebuilt when patterns change)
```

### Core API

```typescript
class ScrubLayer {
  // Pattern management
  addPattern(name: string, letter: string, regex: RegExp): void;

  // Scrubbing (value → token) — applied to tool responses before agent sees them
  scrubText(input: string): string;

  // Unscrubbing (token → value) — applied to agent output before UI renders it
  unscrubText(input: string): string;

  // Tool wrapping
  wrapTool(tool: AgentTool): AgentTool;           // Claude Agent SDK
  wrapCopilotTool(tool: CopilotTool): CopilotTool; // Copilot SDK

  // Persistence
  save(workspacePath: string): void;
  static load(workspacePath: string): ScrubLayer;
}
```

## Interception Points

### 1. Tool Level (structured data)

Wraps each tool function registered with the SDK:

- **Tool response → agent:** `scrubText(result)` replaces all pattern matches with tokens
- **Agent args → tool:** `unscrubText(args)` restores tokens back to real values (in case agent passes a token as a tool argument)

### 2. Message/Stream Level (free text)

Wraps the conversation stream between SDK and UI:

- **Agent text output → UI:** Detect tokens via `/\bscrub_[a-z]\d+\b/g`, replace each via O(1) `tokenToValue` Map lookup
- **System prompt / context → agent:** `scrubText()` ensures any injected context is also scrubbed

## Data Flow

```
1. Log data fetched from DGrep API (raw GUIDs)
       ↓
2. CSV built in dgrep-analysis-workspace.ts
       ↓
3. ScrubLayer.scrubText(csvContent)
   "e7575c71-abcd-1234-..." → "scrub_g1"
       ↓
4. Scrubbed CSV written to disk (data.csv)
       ↓
5. Agent tool reads CSV → sees scrub_g1, scrub_g2, scrub_e1
       ↓
6. Agent produces analysis with tokens in output
       ↓
7. ScrubLayer.unscrubText(agentOutput)
   "scrub_g1" → "e7575c71-abcd-1234-..."
       ↓
8. UI renders with real values restored
```

## Persistence

Per-session, stored in the analysis workspace:

```json
// ~/.taskdock/dgrep/analysis/{sessionId}/token-map.json
{
  "version": 1,
  "patterns": {
    "GUID": { "letter": "g", "regex": "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" },
    "Email": { "letter": "e", "regex": "[\\w.+-]+@[\\w-]+\\.[\\w.]+" }
  },
  "mappings": [
    { "value": "e7575c71-abcd-1234-5678-abcdef012345", "token": "scrub_g1" },
    { "value": "user@corp.com", "token": "scrub_e1" }
  ]
}
```

- **Load:** On session resume, iterate `mappings` array once to rebuild both Maps. O(n) rebuild.
- **Save:** On session save/close, serialize both Maps to the `mappings` array. No duplication on disk.
- **Storage location:** `~/.taskdock/dgrep/analysis/{sessionId}/token-map.json`

## Performance

- **Scrubbing:** Single pass per pattern regex over input text. For k patterns, k passes. Each new match → O(1) Map insert.
- **Unscrubbing:** Single regex pass (`/\bscrub_[a-z]\d+\b/g`) over text. Each match → O(1) Map lookup.
- **Memory:** 100K mappings ≈ 15MB (two Maps with string keys/values). Trivial.
- **Disk:** JSON serialization of 100K entries < 10ms.

## Built-in Patterns

| Name | Letter | Regex | Description |
|------|--------|-------|-------------|
| GUID | `g` | `[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}` | Standard UUID format |

Users can add custom patterns via configuration. Each pattern requires a unique single-letter code and a regex.

## Scope

- DGrep log analysis sessions
- CFV call flow data
- All agent tool calls via both Claude Agent SDK and Copilot SDK
- Agent free-text output rendered in UI
