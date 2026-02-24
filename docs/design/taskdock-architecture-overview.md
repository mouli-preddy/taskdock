# TaskDock - Architecture & Design Overview

**Document Version:** 1.0
**Date:** February 20, 2026
**Author:** TaskDock Engineering
**Audience:** Partner Architect Review

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Technology Stack](#4-technology-stack)
5. [System Architecture Deep Dive](#5-system-architecture-deep-dive)
6. [Core Feature Modules](#6-core-feature-modules)
7. [AI Integration Architecture](#7-ai-integration-architecture)
8. [Plugin Extensibility Framework](#8-plugin-extensibility-framework)
9. [Security & Authentication](#9-security--authentication)
10. [Data Flow & State Management](#10-data-flow--state-management)
11. [Build, Packaging & Distribution](#11-build-packaging--distribution)
12. [Integration Points & External Services](#12-integration-points--external-services)
13. [Scalability & Performance Considerations](#13-scalability--performance-considerations)
14. [Future Roadmap](#14-future-roadmap)

---

## 1. Executive Summary

**TaskDock** is a modern desktop productivity application built for software engineers working within the Microsoft/Azure DevOps ecosystem. It consolidates pull request review, work item management, AI-powered code analysis, incident management, distributed log searching, and call flow visualization into a single, extensible desktop experience.

### Key Differentiators

- **Multi-provider AI code review** — Supports both Claude (Anthropic) and GitHub Copilot for code review, walkthrough generation, comment analysis, and auto-fix capabilities
- **Plugin extensibility framework** — File-based plugin system designed to be authored by LLMs or humans, with declarative UI, workflow scripting, and hook injection into core tabs
- **Deep Azure DevOps integration** — Full PR lifecycle management, WIQL work item queries, wiki integration, and comment analysis with auto-fix commit generation
- **Cloud diagnostics tooling** — Integrated DGrep (distributed log search), CFV (call flow visualization), ICM (incident management), and Geneva metrics
- **Native desktop performance** — Tauri/Rust shell with a Node.js service backend, delivering near-native performance with full system access

---

## 2. Problem Statement

Software engineers at Microsoft and Azure DevOps-centric organizations operate across a fragmented toolset:

| Activity | Current Tool(s) | Pain Point |
|---|---|---|
| PR review | Azure DevOps web UI | No AI assistance, slow for large PRs |
| Work items | ADO Boards web UI | Context switching from code review |
| Log analysis | DGrep web portal | Separate auth, no integration with PR context |
| Incident mgmt | ICM web portal | Manual cross-referencing with code changes |
| Call flow analysis | Separate CFV tools | No unified view with PR or incidents |
| AI code review | Manual copy/paste to ChatGPT | No structured output, no ADO integration |

TaskDock unifies these workflows into a single application with shared context, enabling engineers to review code, query logs, analyze incidents, and leverage AI assistance without context switching.

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          TaskDock Desktop App                       │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Tauri Runtime (Rust)                       │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │  │
│  │  │ Window   │  │ File I/O │  │ Storage  │  │ Deep Link   │ │  │
│  │  │ Mgmt     │  │ Commands │  │ (SQLite) │  │ Handler     │ │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └─────────────┘ │  │
│  └───────────────────────┬──────────────────────────────────────┘  │
│                          │ spawns & manages                        │
│  ┌───────────────────────▼──────────────────────────────────────┐  │
│  │               Backend Bridge (Node.js Sidecar)               │  │
│  │                    WebSocket RPC :5198                        │  │
│  │                                                              │  │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐ │  │
│  │  │ ADO API    │ │ AI Review  │ │ Plugin     │ │ Terminal  │ │  │
│  │  │ Client     │ │ Service    │ │ Engine     │ │ Manager   │ │  │
│  │  └────────────┘ └────────────┘ └────────────┘ └──────────┘ │  │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐ │  │
│  │  │ CFV        │ │ DGrep      │ │ ICM API    │ │ Geneva   │ │  │
│  │  │ Service    │ │ Service    │ │ Client     │ │ Service  │ │  │
│  │  └────────────┘ └────────────┘ └────────────┘ └──────────┘ │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                          │ WebSocket                               │
│  ┌───────────────────────▼──────────────────────────────────────┐  │
│  │                   Frontend (Vite + TypeScript)                │  │
│  │                                                              │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │  Tab System: PR Review | Work Items | Terminals |      │  │  │
│  │  │             CFV | DGrep | ICM | Settings | Plugins     │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │  │
│  │  │ Diff Viewer  │ │ Comment      │ │ Plugin Tab Renderer  │ │  │
│  │  │ (CodeMirror) │ │ System       │ │ (Component Catalog)  │ │  │
│  │  └──────────────┘ └──────────────┘ └──────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐
   │ Azure    │  │ Claude   │  │ GitHub   │  │ Microsoft    │
   │ DevOps   │  │ API      │  │ Copilot  │  │ Internal     │
   │ REST API │  │          │  │ SDK      │  │ (ICM/Geneva/ │
   └──────────┘  └──────────┘  └──────────┘  │  DGrep/CFV)  │
                                              └──────────────┘
```

### Architectural Pattern

TaskDock follows a **three-tier desktop architecture**:

1. **Presentation Tier** — TypeScript/HTML frontend rendered in Tauri's WebView, with a component-based tab system
2. **Service Tier** — Node.js backend bridge process providing WebSocket RPC, orchestrating all business logic, API calls, and plugin execution
3. **Runtime Tier** — Tauri/Rust shell managing window lifecycle, file I/O, storage, process management, and OS integration (deep links, notifications)

---

## 4. Technology Stack

### Runtime & Packaging

| Layer | Technology | Rationale |
|---|---|---|
| Desktop Shell | **Tauri 2.10** (Rust) | Lightweight native window, ~5MB overhead vs Electron's ~100MB. Secure by default with capability-based permissions |
| Service Backend | **Node.js 20+** (TypeScript) | Rich ecosystem for Azure/AI SDKs, PTY terminal emulation, and HTTP clients |
| Backend Bundling | **pkg** (Node.js → single binary) | Ships as a self-contained sidecar binary alongside the Tauri executable |
| Frontend | **Vite 6** (TypeScript, HTML, CSS) | Fast HMR in development, tree-shaken production bundles |

### Key Libraries

| Category | Libraries |
|---|---|
| AI Providers | `@anthropic-ai/sdk`, `@anthropic-ai/claude-agent-sdk`, `@github/copilot-sdk` |
| Code Editor | CodeMirror 6 (diff viewer, syntax highlighting) |
| Terminal | xterm.js + `@lydell/node-pty` |
| Diagrams | Mermaid.js (architecture/flow diagrams in walkthroughs) |
| Logging | Pino (structured JSON logging) + rotating-file-stream |
| Browser Automation | Playwright Core (auth flows requiring browser interaction) |

### Language Distribution

| Language | Scope |
|---|---|
| TypeScript | ~95% — Frontend, backend bridge, plugins, shared types |
| Rust | ~5% — Tauri commands, window management, process spawning |

---

## 5. System Architecture Deep Dive

### 5.1 Process Model

```
┌─────────────────────────┐
│    Tauri Main Process    │  (Rust)
│    - Window management   │
│    - Storage (SQLite)    │
│    - Deep link handling  │
│    - Sidecar spawning    │
└────────────┬────────────┘
             │ spawn_backend()
             ▼
┌─────────────────────────┐
│  Backend Bridge Process  │  (Node.js, packaged via pkg)
│  - WebSocket server :5198│
│  - All business logic    │
│  - Plugin engine         │
│  - Terminal PTY sessions │
└────────────┬────────────┘
             │ WebSocket JSON-RPC
             ▼
┌─────────────────────────┐
│    WebView Renderer      │  (HTML/CSS/JS via Vite)
│  - Tab-based UI          │
│  - Component rendering   │
│  - User interactions     │
└─────────────────────────┘
```

**Process supervision:** The Tauri main process monitors the backend bridge with a health-check thread (5-second interval). If the backend crashes, it is automatically restarted. Port 5198 availability is checked before spawning to prevent duplicate instances.

### 5.2 Communication Protocol

All frontend-to-backend communication uses **WebSocket JSON-RPC** over `ws://localhost:5198`:

```
Frontend → Backend (Request):
{
  "method": "getPR",
  "params": { "org": "msft", "project": "teams", "prId": 12345 },
  "requestId": "abc-123"
}

Backend → Frontend (Response):
{
  "requestId": "abc-123",
  "result": { "id": 12345, "title": "Fix auth flow", ... }
}

Backend → Frontend (Event Push):
{
  "event": "ai:progress",
  "data": { "sessionId": "s1", "message": "Analyzing file 3/15..." }
}
```

**Why WebSocket over Tauri IPC?** The backend bridge runs as a separate process (sidecar), not as a Tauri plugin. WebSocket provides bidirectional streaming needed for real-time events (AI review progress, terminal output, polling updates) without the overhead of Tauri's command serialization.

### 5.3 Service Architecture (Backend)

Services follow a **lazy singleton pattern** — instantiated on first use and reused for the session lifetime:

```
bridge.ts (Entry Point / WebSocket RPC Router)
│
├── AdoApiClient           — Azure DevOps REST API wrapper
├── AIReviewService        — Orchestrates multi-provider AI reviews
│   ├── ReviewContextService   — Prepares code context, chunking
│   ├── ReviewExecutorService  — Dispatches to provider executors
│   │   ├── ClaudeSdkExecutor      — Direct Anthropic SDK calls
│   │   ├── ClaudeTerminalExecutor — CLI-based Claude interaction
│   │   ├── CopilotSdkExecutor     — GitHub Copilot SDK calls
│   │   └── CopilotTerminalExecutor— CLI-based Copilot interaction
│   ├── WalkthroughService     — AI-generated PR walkthroughs
│   ├── CommentAnalysisService — Analyze & act on PR comments
│   └── ApplyChangesService    — Parse & apply AI-suggested fixes
├── PluginEngine           — Plugin lifecycle, execution, hooks
│   ├── PluginLoader           — Manifest validation, hot-reload
│   ├── PluginScheduler        — Polling/cron trigger management
│   └── PluginScriptRunner     — Sandboxed workflow execution
├── TerminalManager        — PTY session management
├── CfvService             — Call flow visualization & analysis
├── DGrepService           — Distributed log searching
├── IcmApiClient           — Incident management API
└── GenevaTokenService     — Azure diagnostics token management
```

---

## 6. Core Feature Modules

### 6.1 PR Review System

The PR review module is the primary feature of TaskDock, providing a complete PR review experience:

```
┌─────────────────────────────────────────────────────────────┐
│                      PR Review Tab                          │
│                                                             │
│  ┌──────────┐  ┌──────────────────────┐  ┌──────────────┐  │
│  │ File     │  │    Diff Viewer       │  │  Comments    │  │
│  │ Tree     │  │  (Side-by-side /     │  │  Panel       │  │
│  │          │  │   Unified / Preview) │  │              │  │
│  │ Tree /   │  │                      │  │  Threads     │  │
│  │ Flat /   │  │  CodeMirror-based    │  │  Create      │  │
│  │ Grouped  │  │  Syntax highlighting │  │  Reply       │  │
│  │          │  │  30+ languages       │  │  Status      │  │
│  │          │  │                      │  │              │  │
│  │ Reviewed │  │  AI comments overlay │  │  AI Review   │  │
│  │ tracking │  │  Inline fix preview  │  │  findings    │  │
│  └──────────┘  └──────────────────────┘  └──────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Toolbar: Vote | AI Review | Walkthrough | Chat      │   │
│  │          Apply Fixes | Comment Analysis | Plugins    │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Key Capabilities:**
- PR iteration browsing with change-set comparison
- Three diff view modes with CodeMirror syntax highlighting for 30+ languages
- Persistent reviewed-file tracking across sessions
- Generated-file filtering via configurable glob patterns
- Full comment lifecycle: create, reply, edit, delete, status transitions
- Review voting: Approve / Approve with suggestions / Wait for author / Reject

### 6.2 AI-Powered Code Review Pipeline

```
User triggers review
        │
        ▼
┌──────────────────┐     ┌────────────────────┐
│ ReviewContext     │────▶│ ReviewExecutor     │
│ Service           │     │ Service             │
│                   │     │                     │
│ - Fetch file diffs│     │ - Select provider   │
│ - Chunk by size   │     │ - SDK or Terminal   │
│ - Build prompts   │     │ - Stream results    │
│ - Cache contents  │     │                     │
└──────────────────┘     └──────────┬─────────┘
                                    │
                         ┌──────────▼─────────┐
                         │  AI Provider        │
                         │  (Claude / Copilot) │
                         │                     │
                         │  Returns structured: │
                         │  - Comments          │
                         │  - Severity levels   │
                         │  - Code fix diffs    │
                         └──────────┬─────────┘
                                    │
                         ┌──────────▼─────────┐
                         │  Post-Processing    │
                         │                     │
                         │  - Parse findings    │
                         │  - Map to files      │
                         │  - Generate fixes    │
                         │  - Update UI         │
                         └─────────────────────┘
```

**Review Presets:**

| Preset | Focus | Depth |
|---|---|---|
| Quick Scan | All categories | Quick — top-level issues only |
| Security Audit | Vulnerabilities, injection, auth | Thorough — line-by-line |
| Performance Review | N+1 queries, memory, algorithms | Standard |
| Bug Hunt | Logic errors, edge cases, null refs | Thorough |
| Code Style | Naming, patterns, readability | Quick |

**AI Comment Severity Levels:** Critical, Warning, Suggestion, Praise

**Auto-Fix Pipeline:**
1. AI generates code fix diffs alongside review comments
2. User reviews fixes in an apply queue with diff preview
3. On approval, `ApplyChangesService` applies patches to the PR branch
4. Git commit is auto-generated with the fix description
5. Fix status is tracked (pending → applied → committed)

### 6.3 Work Item Management

- WIQL (Work Item Query Language) support with visual query builder
- Import saved queries from Azure DevOps
- Full detail view: description, comments, attachments, relations, history
- Wiki integration: browse, search, create, and edit project wikis

### 6.4 Integrated Diagnostics (Microsoft Internal)

| Tool | Purpose | Integration |
|---|---|---|
| **DGrep** | Distributed log search across 13 endpoints | KQL queries, multiple log types (rb, scx, cs, ts, cc, etc.) |
| **CFV** | Call flow visualization from trace events | Sequence diagrams, QoE analysis, AI-powered call analysis |
| **ICM** | Incident management | Incident viewing, AI analysis, cross-referencing with PRs |
| **Geneva** | Azure metrics and diagnostics | Token-managed dashboard access |

---

## 7. AI Integration Architecture

### 7.1 Multi-Provider Strategy

TaskDock abstracts AI capabilities behind a provider-agnostic interface, supporting both SDK-based and terminal-based execution modes:

```
┌──────────────────────────────────────────────────────────┐
│                    AI Provider Layer                      │
│                                                          │
│  ┌────────────────────┐  ┌─────────────────────────────┐│
│  │   SDK Executors     │  │   Terminal Executors        ││
│  │                     │  │                             ││
│  │  ┌──────────────┐  │  │  ┌────────────────────────┐ ││
│  │  │ Claude SDK   │  │  │  │ Claude Terminal         │ ││
│  │  │ (Anthropic   │  │  │  │ (claude-code CLI)       │ ││
│  │  │  API direct) │  │  │  │                         │ ││
│  │  └──────────────┘  │  │  └────────────────────────┘ ││
│  │  ┌──────────────┐  │  │  ┌────────────────────────┐ ││
│  │  │ Copilot SDK  │  │  │  │ Copilot Terminal       │ ││
│  │  │ (GitHub      │  │  │  │ (GitHub Copilot CLI)   │ ││
│  │  │  Copilot API)│  │  │  │                         │ ││
│  │  └──────────────┘  │  │  └────────────────────────┘ ││
│  └────────────────────┘  └─────────────────────────────┘│
│                                                          │
│  All implement IAIProvider interface:                     │
│  - review(context, options) → AsyncGenerator<AIComment>  │
│  - supports streaming progress events                    │
└──────────────────────────────────────────────────────────┘
```

**Why two execution modes?**

| Mode | Pros | Cons |
|---|---|---|
| **SDK** | Structured output, streaming, model selection | Requires API key configuration |
| **Terminal** | Uses existing CLI auth, visible execution | Less structured output, requires CLI installed |

### 7.2 Claude Agent SDK Integration

TaskDock integrates the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) for agent-powered features:

- `review_pr()` — Enables external agents (e.g., Claude Code) to trigger PR reviews programmatically
- Exposes repository metadata and PR context as agent-accessible skills
- Supports the `get_repos` skill for discovering linked repositories

### 7.3 AI Features Matrix

| Feature | Claude SDK | Claude Terminal | Copilot SDK | Copilot Terminal |
|---|---|---|---|---|
| Code Review | Yes | Yes | Yes | Yes |
| Walkthrough Generation | Yes | Yes | Yes | Yes |
| Comment Analysis | Yes | — | Yes | — |
| Auto-Fix Generation | Yes | — | Yes | — |
| PR Chat | Yes | — | Yes | — |
| Plugin `ctx.ai` | Yes | — | Yes | — |
| CFV Call Analysis | Yes | — | — | — |

---

## 8. Plugin Extensibility Framework

### 8.1 Design Philosophy

The plugin system is designed around four principles:

1. **LLM-generatable** — Plugin format is simple and declarative enough that AI tools (Claude Code, Copilot CLI) can reliably generate correct plugins from natural language
2. **File-based distribution** — Drop a folder into `~/.taskdock/plugins/`, no package registry needed
3. **Native look and feel** — Plugins use a declarative component catalog that inherits TaskDock's design system automatically
4. **No sandboxing** — Trusted developer desktop tool; plugins have full system access (shell, HTTP, file I/O)

### 8.2 Plugin Structure

```
~/.taskdock/plugins/
├── _schema/                    # SDK reference for LLM generation
│   ├── plugin-schema.json      # JSON Schema for manifest validation
│   ├── plugin-sdk.d.ts         # TypeScript type definitions
│   └── README.md               # Plugin authoring guide
│
├── my-plugin/                  # Example plugin
│   ├── manifest.json           # Metadata, config, triggers, hooks
│   ├── ui.json                 # Declarative UI definition
│   └── workflows/              # TypeScript workflow scripts
│       ├── analyze.ts
│       └── poll-data.ts
```

### 8.3 Manifest Schema

The `manifest.json` defines a plugin's identity, configuration, triggers, and hook points:

```jsonc
{
  "id": "incident-manager",           // Unique identifier
  "name": "Incident Manager",         // Display name
  "version": "1.0.0",                 // Semver
  "description": "Monitor and analyze ICM incidents",

  "config": {                          // User-configurable settings
    "endpoint": { "type": "string", "label": "API Endpoint", "required": true },
    "teamId":   { "type": "number", "label": "Team ID" },
    "apiToken": { "type": "string", "label": "Token", "secret": true }
  },

  "triggers": [                        // Workflow execution triggers
    { "type": "manual",    "id": "analyze",  "workflow": "workflows/analyze.ts" },
    { "type": "polling",   "id": "poll",     "workflow": "workflows/poll-data.ts",    "interval": "30s" },
    { "type": "scheduled", "id": "summary",  "workflow": "workflows/daily.ts",        "cron": "0 9 * * 1-5" },
    { "type": "hook",      "id": "on-pr",    "workflow": "workflows/on-pr-opened.ts", "event": "pr:opened" }
  ],

  "hooks": {                           // UI injection into core tabs
    "pr-review": {
      "toolbar": [
        { "label": "Scan", "icon": "shield", "trigger": "analyze" }
      ]
    }
  }
}
```

### 8.4 Trigger Types

```
┌────────────────────────────────────────────────────────┐
│                    Trigger System                       │
│                                                        │
│  ┌──────────┐  User clicks button in plugin tab        │
│  │ Manual   │  or hooked button in core tab             │
│  └──────────┘                                          │
│                                                        │
│  ┌──────────┐  Fixed interval (e.g., every 30s)        │
│  │ Polling  │  Interval supports config references:     │
│  └──────────┘  "{{config.pollInterval}}s"              │
│                                                        │
│  ┌──────────┐  Cron expression                         │
│  │Scheduled │  e.g., "0 9 * * 1-5" (weekdays at 9am)  │
│  └──────────┘                                          │
│                                                        │
│  ┌──────────┐  App events (fire-and-forget):           │
│  │  Hook    │  pr:opened, pr:vote-submitted,            │
│  │ (Event)  │  review:completed, terminal:created, etc. │
│  └──────────┘                                          │
└────────────────────────────────────────────────────────┘
```

### 8.5 Workflow SDK (`PluginContext`)

Every workflow script receives a `PluginContext` object providing access to all TaskDock capabilities:

```typescript
export default async function(ctx: PluginContext) {
  // Access Azure DevOps data
  const pr = await ctx.ado.getPR();

  // Call AI providers
  const analysis = await ctx.ai.claude("Analyze this code for security issues...");

  // Make HTTP requests
  const data = await ctx.http.get("https://api.example.com/data");

  // Run shell commands
  const result = await ctx.shell.run("az pipelines runs list --top 1");

  // Update plugin UI
  await ctx.ui.update('results-table', data);
  await ctx.ui.toast('Analysis complete', 'success');

  // Inject into core tabs
  await ctx.ui.inject('pr-review', 'bottom-panel', {
    type: 'card', label: 'Results', content: analysis, renderAs: 'markdown'
  });

  // Persistent storage
  await ctx.store.set('lastRun', Date.now());

  // Chain workflows
  await ctx.run('followUpWorkflow', { data });
}
```

**Full SDK Namespace Reference:**

| Namespace | Capabilities |
|---|---|
| `ctx.ado` | `getPR()`, `postComment()`, `getWorkItems()`, `updateStatus()` |
| `ctx.ai` | `claude(prompt)`, `copilot(prompt)`, `launchTerminal(opts)` |
| `ctx.http` | `get()`, `post()`, `put()`, `delete()` with headers |
| `ctx.shell` | `run(command)` with cwd, timeout options |
| `ctx.ui` | `update()`, `toast()`, `inject()`, `navigate()` |
| `ctx.store` | `get(key)`, `set(key, value)`, `delete(key)` |
| `ctx.events` | `on(event, callback)`, `emit(event, data)` |
| `ctx.log` | `info()`, `warn()`, `error()`, `debug()` |
| `ctx.run` | Invoke another workflow in the same plugin |
| `ctx.config` | Direct access to user-configured values |
| `ctx.input` | Trigger payload (button click context, event data) |

### 8.6 Declarative UI System (Component Catalog)

Plugins define their UI in `ui.json` using a component catalog that renders natively in TaskDock's design system:

```
┌────────────────────────────────────────────────────────┐
│              Component Catalog                          │
│                                                        │
│  Layout:    split-panel, tabs                           │
│  Data:      table, key-value, timeline, detail-panel   │
│  Content:   card, markdown, header, empty-state         │
│  Actions:   button-group, form                          │
│  Feedback:  status-badge, toast                         │
│                                                        │
│  All components:                                        │
│  - Inherit dark/light theme via CSS variables           │
│  - Support data binding from workflow outputs           │
│  - Wire actions to manifest trigger IDs                 │
│  - Support polling for auto-refresh                     │
└────────────────────────────────────────────────────────┘
```

**Example: Incident Manager UI**

```jsonc
{
  "tab": { "id": "incidents", "label": "Incidents", "icon": "alert-triangle" },
  "layout": {
    "type": "split-panel",
    "sizes": [40, 60],
    "children": [
      {
        "type": "table",
        "id": "incident-list",
        "dataSource": "getIncidents",
        "columns": [
          { "key": "id", "label": "ID", "width": 80 },
          { "key": "severity", "label": "Sev", "component": "status-badge",
            "colorMap": { "0": "red", "1": "orange", "2": "yellow" } }
        ],
        "onRowClick": "selectIncident",
        "polling": { "interval": 30000 }
      },
      {
        "type": "detail-panel",
        "id": "incident-detail",
        "sections": [
          { "type": "header", "title": "{{title}}" },
          { "type": "card", "label": "AI Analysis", "content": "{{aiAnalysis}}", "renderAs": "markdown" },
          { "type": "button-group", "buttons": [
            { "label": "Run Analysis", "icon": "sparkles", "action": "runAnalysis" }
          ]}
        ]
      }
    ]
  }
}
```

### 8.7 Hook System — Injecting into Core Tabs

Plugins can inject buttons and panels into TaskDock's built-in tabs without modifying core code:

```
┌─────────────────────────────────────────────────┐
│  Available Hook Points                           │
│                                                  │
│  pr-review:                                      │
│    ├── toolbar          (top action bar)          │
│    ├── file-context-menu (right-click on file)    │
│    ├── comments-toolbar  (comments panel header)  │
│    └── bottom-panel      (below diff viewer)      │
│                                                  │
│  pr-home:                                        │
│    ├── toolbar          (top action bar)          │
│    └── row-actions      (per-PR row buttons)      │
│                                                  │
│  workitems:                                      │
│    ├── toolbar          (top action bar)          │
│    └── row-actions      (per-item row buttons)    │
│                                                  │
│  terminals:                                      │
│    └── toolbar          (top action bar)          │
└─────────────────────────────────────────────────┘
```

**Context passed to hooked workflows:** When a hook fires, the workflow receives full contextual data in `ctx.input` — the current PR, selected file, diff content, comment threads, etc.

### 8.8 Plugin Engine Architecture

```
┌────────────────────────────────────────────────────────────┐
│                     Plugin Engine                           │
│                                                            │
│  ┌──────────────┐                                          │
│  │   Loader     │  Scans ~/.taskdock/plugins/              │
│  │              │  Validates manifest.json against schema   │
│  │              │  Watches for file changes (hot-reload)    │
│  └──────┬───────┘                                          │
│         │                                                  │
│  ┌──────▼───────┐  ┌────────────────┐                      │
│  │  Scheduler   │  │  Hook Registry │                      │
│  │              │  │                │                      │
│  │  setInterval │  │  Map<event,    │                      │
│  │  for polling │  │    handler[]>  │                      │
│  │              │  │                │                      │
│  │  Cron parser │  │  Built at init │                      │
│  │  for sched.  │  │  Rebuilt on    │                      │
│  └──────┬───────┘  │  hot-reload    │                      │
│         │          └────────┬───────┘                      │
│  ┌──────▼───────────────────▼───────┐                      │
│  │        Script Runner             │                      │
│  │                                  │                      │
│  │  - Executes .ts via tsx          │                      │
│  │  - Builds PluginContext per run  │                      │
│  │  - Wraps in try/catch           │                      │
│  │  - Enforces timeout             │                      │
│  │  - Logs execution (last 50/plugin)                      │
│  └──────────────────────────────────┘                      │
└────────────────────────────────────────────────────────────┘
```

### 8.9 Plugin Lifecycle

| Stage | Action | User Experience |
|---|---|---|
| **Install** | Drop plugin folder into `~/.taskdock/plugins/` | Auto-detected via file watcher |
| **Configure** | Plugin appears in Settings with config fields | Form auto-generated from `manifest.config` |
| **Activate** | Tab appears in sidebar, triggers start | Immediate — no restart required |
| **Execute** | Workflows run on trigger | Progress shown in plugin log panel |
| **Disable** | Toggle off in Settings | All triggers stop, tab hidden |
| **Update** | Modify files in plugin folder | Hot-reloaded automatically |
| **Uninstall** | Delete the plugin folder | Removed from UI immediately |

### 8.10 LLM Plugin Generation Flow

```
User: "Create a TaskDock plugin that monitors ICM incidents
       for team X and runs AI analysis on new ones"
                    │
                    ▼
         ┌──────────────────┐
         │  AI Tool reads:   │
         │  - plugin-schema  │   ~/.taskdock/plugins/_schema/
         │  - plugin-sdk.d.ts│
         │  - Example plugins│   ~/.taskdock/plugins/_examples/
         └────────┬─────────┘
                  │
                  ▼
         ┌──────────────────┐
         │  AI generates:    │
         │  - manifest.json  │   ~/.taskdock/plugins/my-plugin/
         │  - ui.json        │
         │  - workflows/*.ts │
         └────────┬─────────┘
                  │
                  ▼
         ┌──────────────────┐
         │  TaskDock detects  │
         │  new plugin folder │
         │  Hot-reloads       │
         │  Plugin live!      │
         └──────────────────┘
```

---

## 9. Security & Authentication

### 9.1 Authentication Flows

```
┌──────────────────────────────────────────────────────────┐
│               Authentication Strategy                     │
│                                                          │
│  Azure DevOps ──────────────────────────────────────────│
│  │  Priority 1: AZURE_DEVOPS_PAT env variable            │
│  │  Priority 2: Azure CLI token acquisition              │
│  │     az account get-access-token                       │
│  │     --resource 499b84ac-1321-427f-aa17-267ca6975798   │
│  │  Token cached with 1-min-before-expiry refresh        │
│  │                                                       │
│  Microsoft Internal Services (ICM, Geneva) ─────────────│
│  │  Edge browser profile picker for token acquisition    │
│  │  Fallback: visible browser automation (Playwright)    │
│  │                                                       │
│  AI Providers ──────────────────────────────────────────│
│  │  Claude: Anthropic API key or CLI authentication      │
│  │  Copilot: GitHub token via CLI                        │
└──────────────────────────────────────────────────────────┘
```

### 9.2 Security Model

| Layer | Control |
|---|---|
| **Network** | All WebSocket communication is localhost-only (127.0.0.1:5198) |
| **Tauri Capabilities** | Capability-based permission manifests restrict Tauri API access |
| **Token Storage** | Tokens cached in memory with short TTL; refreshed before expiry |
| **Plugin Trust** | Plugins run with full user permissions (trusted desktop tool model) |
| **Config Storage** | `~/.taskdock/config.json` — user-readable, standard file permissions |
| **Deep Links** | `taskdock://` URL scheme validates parameters before processing |

---

## 10. Data Flow & State Management

### 10.1 State Layers

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: In-Memory (Frontend)                       │
│  - Current tab, selected PR, selected file           │
│  - Comment threads, AI review session state          │
│  - UI panel sizes, scroll positions                  │
│  Lifecycle: Current session only                     │
├─────────────────────────────────────────────────────┤
│  Layer 2: In-Memory (Backend)                        │
│  - Session context (org, project, PR ID)             │
│  - Service singleton instances                       │
│  - WebSocket client connections                      │
│  - Plugin execution logs (last 50 per plugin)        │
│  Lifecycle: Current session only                     │
├─────────────────────────────────────────────────────┤
│  Layer 3: Tauri Store (Persistent)                   │
│  - User settings (theme, polling interval, etc.)     │
│  - Window bounds and position                        │
│  - Reviewed file tracking                            │
│  Storage: SQLite via Tauri store plugin              │
├─────────────────────────────────────────────────────┤
│  Layer 4: File System (Persistent)                   │
│  - Config: ~/.taskdock/config.json                   │
│  - AI reviews: saved review outputs                  │
│  - Plugin data: per-plugin store files               │
│  - Logs: rotating structured JSON logs               │
└─────────────────────────────────────────────────────┘
```

### 10.2 Event Flow for Real-Time Updates

```
Backend Service Event               Frontend Subscriber
─────────────────────               ──────────────────

ai:progress ──────────────────────▶ Review progress bar
ai:comment  ──────────────────────▶ New finding in comments panel
ai:walkthrough ───────────────────▶ Walkthrough step rendered
terminal:data ────────────────────▶ Terminal output stream
cfv:progress ─────────────────────▶ CFV analysis progress
plugin:ui-update ─────────────────▶ Plugin component re-render
plugin:toast ─────────────────────▶ Toast notification display
pr:polling-update ────────────────▶ PR list refresh
```

---

## 11. Build, Packaging & Distribution

### 11.1 Build Pipeline

```
Source Code
    │
    ├──▶ Frontend Build (Vite)
    │    TypeScript → JavaScript bundle
    │    Output: dist/renderer/
    │
    ├──▶ Backend Build (esbuild + pkg)
    │    TypeScript → CommonJS bundle → Node.js binary
    │    Output: src-tauri/binaries/bridge-x86_64-pc-windows-msvc.exe
    │
    └──▶ Tauri Build (Cargo + NSIS)
         Rust compilation + asset bundling → Windows installer
         Output: src-tauri/target/release/bundle/nsis/TaskDock_x.x.x_x64-setup.exe
```

### 11.2 Artifact Sizes (Approximate)

| Component | Size |
|---|---|
| Tauri shell (Rust) | ~5 MB |
| Frontend bundle | ~3 MB |
| Backend sidecar (Node.js + deps) | ~60 MB |
| **Total installer** | **~70 MB** |

Compare: Equivalent Electron app would be ~200+ MB.

### 11.3 Development Workflow

```bash
npm run dev
# Starts three concurrent processes:
# 1. Vite dev server (HMR) on :5199
# 2. Backend bridge via tsx (auto-reload) on :5198
# 3. Tauri dev window pointing to :5199
```

---

## 12. Integration Points & External Services

```
┌──────────────────────────────────────────────────────────────┐
│                   TaskDock Integration Map                     │
│                                                              │
│  ┌─────────────────┐                                         │
│  │  Azure DevOps    │  REST API v7.0                          │
│  │  - PRs, Iterations, Threads, Votes                        │
│  │  - Work Items (WIQL queries)                              │
│  │  - Wikis (browse, search, edit)                           │
│  │  - Repositories and branches                              │
│  └─────────────────┘                                         │
│                                                              │
│  ┌─────────────────┐                                         │
│  │  Anthropic       │  Claude SDK / Agent SDK                 │
│  │  - Code review generation                                 │
│  │  - Walkthrough generation                                 │
│  │  - Comment analysis                                       │
│  │  - Plugin AI calls                                        │
│  └─────────────────┘                                         │
│                                                              │
│  ┌─────────────────┐                                         │
│  │  GitHub Copilot  │  Copilot SDK                            │
│  │  - Code review generation                                 │
│  │  - PR chat                                                │
│  │  - Plugin AI calls                                        │
│  └─────────────────┘                                         │
│                                                              │
│  ┌─────────────────┐                                         │
│  │  Microsoft       │  Internal APIs                          │
│  │  Internal        │                                        │
│  │  - DGrep: Distributed log search (13 endpoints)           │
│  │  - CFV: Call flow visualization (Geneva traces)           │
│  │  - ICM: Incident management                               │
│  │  - Geneva: Metrics and diagnostics                        │
│  └─────────────────┘                                         │
│                                                              │
│  ┌─────────────────┐                                         │
│  │  Azure CLI       │  Token acquisition                      │
│  │  - az account get-access-token                            │
│  └─────────────────┘                                         │
│                                                              │
│  ┌─────────────────┐                                         │
│  │  Git             │  Local operations                       │
│  │  - Apply code fixes to branches                           │
│  │  - Create commits from AI suggestions                     │
│  │  - Worktree management                                    │
│  └─────────────────┘                                         │
│                                                              │
│  ┌─────────────────┐                                         │
│  │  WorkIQ (MCP)    │  Future integration point               │
│  │  - Microsoft 365 data (emails, meetings, docs)            │
│  │  - Context enrichment for AI reviews                      │
│  └─────────────────┘                                         │
└──────────────────────────────────────────────────────────────┘
```

---

## 13. Scalability & Performance Considerations

### 13.1 Performance Optimizations

| Area | Strategy |
|---|---|
| **Large PRs** | File content caching in `ReviewContextService`; chunked processing to stay within AI token limits |
| **Diff rendering** | CodeMirror virtual scrolling; deferred rendering for files > 10K lines |
| **Memory** | Lazy service initialization; file content eviction after review completion |
| **WebSocket** | Message batching for rapid event sequences (e.g., terminal output) |
| **Polling** | Configurable intervals; smart diff-based updates (only re-render on change) |
| **Plugin isolation** | Workflow scripts execute with per-trigger timeouts (default 60s) |

### 13.2 Reliability

| Concern | Mitigation |
|---|---|
| Backend crash | Auto-restart via Tauri monitoring thread (5s check interval) |
| Token expiry | Proactive refresh 1 minute before expiration |
| Plugin failure | Try/catch wrapper, error logged, toast shown, trigger paused after 2 failures |
| Network issues | Graceful error handling with retry guidance in UI |
| Log rotation | 50MB max log file size with rotating-file-stream |

---

## 14. Future Roadmap

| Phase | Planned Capabilities |
|---|---|
| **Near-term** | DGrep deep integration, enhanced CFV analysis, multi-repo PR context |
| **Mid-term** | MCP server for TaskDock (expose skills to external AI agents), plugin marketplace/sharing, collaborative review sessions |
| **Long-term** | Cross-platform (macOS/Linux) via Tauri's multi-platform support, GitHub integration (beyond ADO), extensible diagnostics framework |

---

## Appendix A: Key File Locations

| File | Purpose |
|---|---|
| `src-tauri/src/main.rs` | Tauri entry point, window setup, backend spawning |
| `src-tauri/src/commands/` | Rust-side Tauri commands (storage, config, file I/O) |
| `src-backend/bridge.ts` | Backend entry point, WebSocket RPC router |
| `src/main/ado/ado-api.ts` | Azure DevOps REST API client |
| `src/main/ai/` | AI review services, executors, walkthroughs |
| `src/main/plugins/` | Plugin engine, loader, scheduler, script runner |
| `src/main/plugins/schema/` | Plugin SDK types and JSON schema |
| `src/renderer/app.ts` | Frontend application entry, tab management |
| `src/shared/` | Shared TypeScript types between frontend and backend |

## Appendix B: Plugin SDK Quick Reference

```typescript
interface PluginContext {
  input: Record<string, any>;       // Trigger payload
  config: Record<string, any>;      // User settings

  ado: { getPR(), postComment(), getWorkItems(), updateStatus() };
  ai:  { claude(prompt), copilot(prompt), launchTerminal(opts) };
  http: { get(), post(), put(), delete() };
  shell: { run(command, opts?) };
  ui:  { update(), toast(), inject(), navigate() };
  store: { get(key), set(key, value), delete(key) };
  events: { on(event, callback), emit(event, data) };
  log: { info(), warn(), error(), debug() };
  run(triggerId, input?): Promise<void>;
}
```

## Appendix C: Event Hook Catalog

| Event | Fired When |
|---|---|
| `pr:opened` | User loads a PR |
| `pr:comment-created` | New file comment posted |
| `pr:comment-replied` | Reply added to thread |
| `pr:thread-status-changed` | Thread resolved/activated |
| `pr:vote-submitted` | Review vote cast |
| `workitem:opened` | Work item viewed |
| `workitem:updated` | Work item field changed |
| `workitem:comment-added` | Comment on work item |
| `terminal:created` | Terminal session started |
| `terminal:exited` | Terminal session ended |
| `review:started` | AI review initiated |
| `review:completed` | AI review finished |
