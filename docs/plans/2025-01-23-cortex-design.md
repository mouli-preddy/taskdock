# Cortex Design Document

**Product**: Cortex - AI-Native Desktop Platform for Azure DevOps
**Version**: 1.0
**Date**: 2025-01-23
**Status**: Draft - Pending Approval

---

## Table of Contents

1. [Product Vision & Overview](#1-product-vision--overview)
2. [User Personas & Dashboards](#2-user-personas--dashboards)
3. [Core Architecture](#3-core-architecture)
4. [AI Integration & Intelligent Routing](#4-ai-integration--intelligent-routing)
5. [Agent System Design](#5-agent-system-design)
6. [Claude Code Terminal Integration](#6-claude-code-terminal-integration)
7. [ADO Integration Layer](#7-ado-integration-layer)
8. [Roadmap & Planning Workbench](#8-roadmap--planning-workbench)
9. [Extensibility Platform](#9-extensibility-platform)
10. [Real-Time Updates & Notifications](#10-real-time-updates--notifications)
11. [Internal Tool Integrations](#11-internal-tool-integrations)
12. [Security & Authentication](#12-security--authentication)
13. [Technical Stack](#13-technical-stack)
14. [Success Metrics](#14-success-metrics)
15. [Implementation Phases](#15-implementation-phases)

---

## 1. Product Vision & Overview

**Cortex** is an AI-native desktop platform that transforms Azure DevOps workflows for entire development organizations—from individual contributors to engineering managers.

### The Problem

Development teams using Azure DevOps face compounding inefficiencies:
- **Fragmented experience**: Constant context-switching between ADO web UI, IDEs, terminals, and communication tools
- **Manual toil**: PR reviews are slow and inconsistent, work item updates are forgotten, status reports consume hours
- **AI gap**: Despite AI advances, enterprise ADO workflows remain disconnected from Claude and Copilot capabilities
- **Visibility silos**: Managers lack real-time insight, developers lack priority clarity, leads waste time in status meetings

### The Solution

Cortex sits as an intelligent layer on top of ADO, making it the **source of truth while adding an AI-powered brain**. It provides:

- **Unified workspace**: One app for code, PRs, work items, pipelines, and planning
- **Autonomous agents**: Eight specialized AI agents that watch, analyze, and act on your behalf
- **Intelligent routing**: Claude handles reasoning-heavy tasks; Copilot handles code completion—automatically
- **Role-optimized views**: Developers, leads, and managers each get tailored dashboards while sharing full platform capabilities

### Core Principle

ADO remains authoritative. Cortex never creates shadow data. Every action syncs back to ADO in real-time. Users can switch between Cortex and ADO web freely—Cortex enhances, it doesn't replace.

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Platform | Electron + React | Cross-platform, rich UI, familiar tech stack |
| Primary Persona | All roles from day one | Role-based dashboards, shared features |
| ADO Integration | Source of truth with AI layer | Respect enterprise governance, enhance UX |
| Authentication | OAuth + PAT fallback | Enterprise SSO + flexibility |
| AI Providers | Claude + Copilot (intelligent routing) | Best of both: reasoning + code completion |
| Agent Autonomy | User-configurable per action | Different comfort levels across teams |
| Offline | Online-only | Simplifies architecture, avoids sync conflicts |
| Telemetry | None | Maximum privacy, differentiator |

---

## 2. User Personas & Dashboards

Cortex serves three primary personas, each with a dedicated dashboard experience optimized for their workflow.

### 👨‍💻 Developer (Individual Contributor)

**Goals**: Ship code fast, stay unblocked, minimize context switching

**Dashboard features**:
- **My Work**: Active work items assigned to me, sorted by priority
- **My PRs**: PRs I authored (status, review progress, CI status) + PRs awaiting my review
- **Claude Terminal Tabs**: Context-aware AI sessions per work item or PR
- **Quick Actions**: Start work on item, create PR, run local build—one click
- **AI Inbox**: Agent suggestions, auto-drafted responses to PR comments, code fix proposals

**Key workflows**:
- Pick up work item → Claude helps break it down → Code with Copilot assistance → PR with AI-generated description → Agents handle review responses

### 👩‍💼 Tech Lead / Senior Developer

**Goals**: Maintain code quality, unblock team, balance coding with oversight

**Dashboard features**:
- **Team PRs**: All open PRs across repos I oversee, sorted by age and risk
- **Review Queue**: PRs needing my review with AI-generated summaries
- **Quality Alerts**: Agent-flagged issues (security, complexity, test gaps)
- **Blocked Items**: Work items stuck or at risk, with AI root-cause analysis
- **My Work**: Personal coding work (leads still code!)

**Key workflows**:
- Morning triage: AI summarizes overnight PR activity → Review high-risk PRs first → Unblock team with quick decisions

### 📊 Engineering Manager

**Goals**: Team velocity, roadmap delivery, stakeholder communication

**Dashboard features**:
- **Sprint Health**: Burndown, velocity trends, at-risk items (AI-flagged)
- **Team Status**: Who's working on what, blockers, availability
- **Roadmap View**: Timeline of epics/features with AI-predicted completion
- **Reports**: Auto-generated daily/weekly summaries ready to share
- **Escalations**: Items requiring manager decision or intervention

**Key workflows**:
- Generate stakeholder update in one click → AI drafts based on actual sprint data → Edit and send

---

## 3. Core Architecture

Cortex follows a layered architecture that separates concerns cleanly while enabling rich AI-powered workflows.

```
┌─────────────────────────────────────────────────────────────────┐
│                      PRESENTATION LAYER                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ Dev Dashboard│ │Lead Dashboard│ │   Manager Dashboard      │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │Claude Terminal│ │Planning View │ │   Shared Components      │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                       SERVICE LAYER                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │ AI Router   │ │Agent Manager│ │ Sync Engine │ │ Plugin    │ │
│  │ (Claude/    │ │ (8 agents)  │ │ (ADO ↔ App) │ │ Runtime   │ │
│  │  Copilot)   │ │             │ │             │ │           │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                     INTEGRATION LAYER                           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │ ADO Client  │ │Claude SDK   │ │Copilot SDK  │ │ Webhooks  │ │
│  │ (REST API)  │ │             │ │             │ │ Receiver  │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                       DATA LAYER                                │
│  ┌─────────────────────────┐ ┌────────────────────────────────┐ │
│  │  Local Cache (SQLite)   │ │   Secure Credential Store      │ │
│  │  - Work items, PRs      │ │   - OAuth tokens               │ │
│  │  - User preferences     │ │   - PATs (encrypted)           │ │
│  └─────────────────────────┘ └────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
              │                              │
              ▼                              ▼
    ┌──────────────────┐          ┌───────────────────┐
    │   Azure DevOps   │          │  Background Svc   │
    │   (Source of     │          │  (Notifications,  │
    │    Truth)        │          │   Agent Tasks)    │
    └──────────────────┘          └───────────────────┘
```

### Key Architectural Decisions

- **Electron main/renderer split**: Main process handles integrations, auth, background tasks. Renderer handles UI.
- **Local SQLite cache**: Fast reads without hammering ADO API. Cache invalidated via webhooks.
- **Sync Engine**: Bidirectional sync with conflict detection. ADO always wins on conflict.
- **Plugin isolation**: Plugins run in sandboxed contexts with defined API surface.

---

## 4. AI Integration & Intelligent Routing

Cortex uses both **Claude Code SDK** and **GitHub Copilot SDK**, routing tasks to the optimal AI based on task characteristics.

### AI Router Design

```
┌─────────────────────────────────────────────────────────────┐
│                      AI ROUTER                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Task Classification                     │   │
│  │  • Code completion? → Copilot                       │   │
│  │  • Complex reasoning? → Claude                      │   │
│  │  • Multi-step agent task? → Claude                  │   │
│  │  • Code explanation? → Either (prefer Claude)       │   │
│  │  • Natural language query? → Claude                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│         ┌────────────────┴────────────────┐                │
│         ▼                                 ▼                │
│  ┌─────────────────┐           ┌─────────────────┐        │
│  │  Claude Code    │           │ GitHub Copilot  │        │
│  │  SDK            │           │ SDK             │        │
│  │                 │           │                 │        │
│  │ • Agentic tasks │           │ • Completions   │        │
│  │ • PR analysis   │           │ • Inline edits  │        │
│  │ • Code review   │           │ • Suggestions   │        │
│  │ • Planning      │           │ • Docstrings    │        │
│  │ • Explanations  │           │                 │        │
│  │ • Conversations │           │                 │        │
│  └─────────────────┘           └─────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

### Routing Rules

| Task Type | Primary AI | Fallback | Rationale |
|-----------|------------|----------|-----------|
| Code completion | Copilot | Claude | Copilot optimized for inline completion |
| PR review & analysis | Claude | — | Complex reasoning, multi-file context |
| Work item breakdown | Claude | — | Planning and decomposition |
| Bug root cause analysis | Claude | — | Investigative reasoning |
| Code refactoring suggestions | Claude | Copilot | Architectural decisions need reasoning |
| Documentation generation | Claude | Copilot | Narrative coherence |
| Status report generation | Claude | — | Summarization and synthesis |
| Quick code explanation | Claude | Copilot | Either works, Claude slightly better |

### Context Management

Both SDKs receive relevant context automatically:
- **Repository context**: File structure, recent changes, related files
- **ADO context**: Work item details, PR comments, linked items
- **User context**: Role, preferences, recent activity
- **Conversation history**: Maintained per terminal tab/session

---

## 5. Agent System Design

Cortex deploys **eight specialized AI agents**, each with defined responsibilities, triggers, and configurable autonomy levels.

### Agent Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     AGENT MANAGER                               │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  Agent Lifecycle: Register → Configure → Trigger → Run    │ │
│  │  Autonomy Engine: Check permissions before each action    │ │
│  │  Audit Log: Every agent action recorded for review        │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### The Eight Agents

#### 1. PR Review Agent
- **Trigger**: New PR created, PR updated with new commits
- **Actions**: Analyze code changes, identify bugs/security issues/style violations, post inline comments
- **Output**: Structured review with severity ratings (critical/warning/suggestion)
- **Autonomy options**: Draft only | Post automatically | Request changes automatically

#### 2. PR Comment Responder Agent
- **Trigger**: New comment on PR from human reviewer
- **Actions**: Analyze comment intent, draft response or code fix, optionally push commit
- **Output**: Response text or code diff
- **Autonomy options**: Draft for approval | Respond automatically | Push fixes automatically

#### 3. Work Item Triage Agent
- **Trigger**: New work item created, work item moved to triage state
- **Actions**: Analyze description, suggest priority/severity, recommend assignee, link related items
- **Output**: Triage recommendation with confidence score
- **Autonomy options**: Suggest only | Auto-assign priority | Auto-assign owner

#### 4. Sprint Health Agent
- **Trigger**: Scheduled (daily), on-demand, sprint milestone dates
- **Actions**: Analyze velocity, identify at-risk items, predict completion likelihood
- **Output**: Health report with risk flags and recommendations
- **Autonomy options**: Report only | Alert on risk | Auto-escalate blockers

#### 5. Documentation Agent
- **Trigger**: PR merged, API changed, new public function added
- **Actions**: Detect documentation gaps, draft updates, update README/changelog
- **Output**: Documentation diff or new doc content
- **Autonomy options**: Suggest only | Create draft PR | Auto-merge doc updates

#### 6. Pipeline Failure Agent
- **Trigger**: CI/CD pipeline fails
- **Actions**: Analyze logs, identify root cause, suggest fix, detect flaky tests
- **Output**: Failure analysis with fix recommendation
- **Autonomy options**: Analyze only | Auto-retry flaky | Create fix PR

#### 7. Code Quality Agent
- **Trigger**: Scheduled (weekly), on-demand, pre-release
- **Actions**: Scan for tech debt, complexity hotspots, dependency vulnerabilities
- **Output**: Quality report with prioritized improvement suggestions
- **Autonomy options**: Report only | Create improvement work items | Auto-create PRs for simple fixes

#### 8. Status Report Agent
- **Trigger**: Scheduled (daily/weekly), on-demand
- **Actions**: Aggregate sprint data, summarize progress, highlight blockers
- **Output**: Formatted report (Markdown, HTML, Slack-ready)
- **Autonomy options**: Draft only | Auto-send to configured channels

### Autonomy Configuration

Users configure autonomy per agent, per action type:

```
┌─────────────────────────────────────────────────────────────┐
│  Agent Settings: PR Review Agent                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Post review comments:     ○ Draft  ● Auto  ○ Disabled     │
│  Request changes:          ● Draft  ○ Auto  ○ Disabled     │
│  Approve PR:               ● Draft  ○ Auto  ○ Disabled     │
│                                                             │
│  Scope: [All repos ▼]                                       │
│  Excluded paths: /vendor/*, /generated/*                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Claude Code Terminal Integration

The Claude Code terminal is the power-user heart of Cortex—a hybrid interface combining polished UI with raw terminal access, organized into context-aware tabs.

### Two Modes

#### Chat Mode (Default)
- Rich markdown rendering with syntax highlighting
- Inline code diffs with accept/reject buttons
- File tree visualization for multi-file changes
- Action buttons: "Apply Change", "Create PR", "Update Work Item"
- Image support for screenshots/diagrams
- Conversation history preserved per tab

#### Terminal Mode (Power User)
- Full Claude Code CLI experience
- Raw terminal input/output
- Direct access to all Claude Code commands
- Shell integration for running suggested commands
- Toggle back to Chat Mode anytime

### Context-Aware Tabs

Each tab is bound to a specific context that Claude automatically uses:

| Tab Type | Auto-Injected Context |
|----------|----------------------|
| Work Item Tab | Work item details, acceptance criteria, linked PRs, related items, discussion history |
| PR Tab | PR description, all file diffs, review comments, CI status, linked work items |
| Repo Tab | Repository structure, recent commits, branch info, README, key files |
| Freeform Tab | User-selected context or no specific context |

### Quick Actions from Chat

Claude can execute actions directly from conversation:

- **"Create a branch for this"** → Creates `feature/WI-1234-description`
- **"Make that change"** → Applies suggested code edit
- **"Commit this"** → Commits with AI-generated message
- **"Create PR"** → Opens PR with AI-generated description linked to work item
- **"Update work item status"** → Moves work item to appropriate state
- **"Run tests"** → Executes test command, shows results inline

---

## 7. ADO Integration Layer

Cortex treats Azure DevOps as the **source of truth** while providing a richer, AI-enhanced experience.

### ADO API Coverage

- **Work Items**: Query, get details, create, update, link, comment, manage attachments
- **Repositories**: List, get file contents, get commits, get branches, create branch, get diff
- **Pull Requests**: List, get details, create, update, get diff, post comments, add reviewers, vote, complete/abandon
- **Pipelines**: List, get build status, get logs, trigger build, cancel build, get test results
- **Boards & Sprints**: Get board columns, get sprint data, get velocity/burndown, move items
- **Wiki & Docs**: Get/update/create wiki pages

### Sync Engine

The Sync Engine maintains local cache consistency with ADO:

**Real-Time (Webhooks available)**:
- PR created/updated → immediate sync
- Work item changed → immediate sync
- Build completed → immediate sync
- Comment posted → immediate sync

**Polling Fallback (No webhooks)**:
- Active PRs: every 30 seconds
- Work items in sprint: every 60 seconds
- Pipeline status: every 30 seconds
- Other data: every 5 minutes

**Conflict Resolution**: ADO always wins. Local changes queue until confirmed. User notified of conflicts.

---

## 8. Roadmap & Planning Workbench — Research-Based Collaborative Model

All AI workflows in Cortex are **research-based and collaborative**. Instead of generating outputs instantly, Claude enters an interactive terminal session where it:
1. **Explores** the codebase
2. **Asks clarifying questions**
3. **Proposes options**
4. **Iterates with the user**
5. **Outputs structured JSON** that Cortex consumes

### The Collaborative Workflow Pattern

```
User Request
    │
    ▼
Cortex Launches Claude Terminal Session
(System prompt includes task goal + output schema)
    │
    ▼
RESEARCH PHASE — Claude Explores
(Reads relevant code files, analyzes existing patterns)
    │
    ▼
DIALOGUE PHASE — Claude Asks Questions
(Clarifies requirements, discusses options)
    │
    ▼
PROPOSAL PHASE — Claude Suggests Options
(User selects or asks for modifications)
    │
    ▼
OUTPUT PHASE — Claude Writes Structured JSON
(Writes to /tmp/cortex/output-{uuid}.json)
    │
    ▼
Cortex Consumes Output
(Parses JSON, displays in UI, user confirms → Creates in ADO)
```

### Output JSON Schema Example

```json
{
  "type": "feature_breakdown",
  "feature": {
    "title": "PDF Export for Reports",
    "description": "Allow users to export reports as PDF documents"
  },
  "stories": [
    {
      "title": "Set up PDF generation infrastructure",
      "description": "Add puppeteer or @react-pdf/renderer, create PdfService class",
      "acceptanceCriteria": [
        "PdfService can convert HTML to PDF",
        "Unit tests pass",
        "Works in CI environment"
      ],
      "estimate": 3,
      "tags": ["backend", "infrastructure"],
      "dependencies": []
    }
  ],
  "totalEstimate": 20,
  "risks": ["Large PDFs may hit memory limits"],
  "assumptions": ["Using existing Bull queue infrastructure"],
  "conversationSummary": "User chose async generation with Bull..."
}
```

### AI-Assisted Planning Features

1. **Feature Breakdown**: User describes feature, Claude breaks into stories with estimates
2. **Dependency Detection**: AI analyzes work items, identifies implicit dependencies
3. **Sprint Planning Assistant**: AI helps balance sprint capacity
4. **Completion Prediction**: AI analyzes velocity, provides delivery forecasts

---

## 9. Extensibility Platform

Cortex is a **platform**, not just a tool. Organizations extend it through three mechanisms.

### Three Extensibility Layers

#### Layer 1: Custom Agent Prompts
- Customize how built-in agents behave without writing code
- Organization-specific rules and standards
- No coding required

#### Layer 2: Code Plugins
- Full JavaScript/TypeScript SDK
- Custom UI components, agents, integrations
- Sandboxed execution environment

**Plugin Capabilities**:
- Custom Agents
- Dashboard Widgets
- Commands (command palette)
- Context Menu Items
- Settings
- Event Handlers
- Custom Views
- Terminal Prompts

#### Layer 3: No-Code Automation
- Visual workflow builder for non-developers
- "When X happens, do Y" rules
- Pre-built templates for common automations

**Available Triggers**: PR events, work item events, build events, schedule, manual, webhook

**Available Actions**: ADO actions, communication (Slack/Teams), AI actions, control flow

---

## 10. Real-Time Updates & Notifications

### Real-Time Architecture

**Webhook-based (preferred)**:
- ADO → Webhook → Cortex App
- Sub-second updates

**Polling fallback**:
- Cortex App → Poll ADO API → Detect Changes
- Used when webhooks unavailable

### Background Service

When app is closed, lightweight background service (~30MB):
- Receives webhooks / polls ADO
- Evaluates notification rules
- Displays system notifications
- Runs scheduled agent tasks
- Maintains agent autonomy

### Notification Types

- PR Review Requested
- PR Comment Response Ready (from agent)
- Build Failed (with agent analysis)
- Work Item Assigned
- Agent Needs Approval
- Incident Alert

### Agent Activity While Away

Agents work even when you're not watching:
- PR Comment Responder drafts responses
- Pipeline Failure Agent retries flaky tests
- Status Report Agent generates daily reports
- All queued for your review when you return

---

## 11. Internal Tool Integrations

### Your Internal Tool Ecosystem

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│    MDM      │    │   Jarvis    │    │   Geneva    │
│  (Metrics)  │    │ (Incidents) │    │   (Logs)    │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
                          ▼
                      CORTEX
              Incident Response Pipeline
```

### Incident-to-Resolution Workflow

**Step 1: Incident Detection**
- Jarvis Alert received
- Cortex creates incident work item in ADO
- Notifies on-call via Teams
- Launches AI investigation session

**Step 2: Automated Data Gathering**
- Claude executes: `mdm query`, `geneva logs`, `jarvis get-incident`
- Fetches recent ADO commits and deployments

**Step 3: AI Root Cause Analysis**
- Claude analyzes with full codebase context
- Correlates metrics, logs, and code changes
- Identifies root cause

**Step 4: Fix Generation**
- Claude proposes fix (research-based, collaborative)
- Iterates with user
- Generates code changes

**Step 5: PR Creation & Fast-Track**
- Creates PR linked to incident
- Auto-assigns reviewers
- AI-generated description with root cause analysis

**Step 6: Post-Deploy Verification**
- Claude monitors MDM for recovery
- Auto-resolves Jarvis incident
- Closes ADO work item with resolution notes

### Tool Configuration

Configure internal CLI tools so Cortex can execute them:
- **MDM**: `mdm query`, `mdm list-metrics`, `mdm dashboards`
- **Jarvis**: `jarvis get-incident`, `jarvis list-incidents`, `jarvis get-timeline`, `jarvis add-note`
- **Geneva**: `geneva logs`, `geneva trace`, `geneva search`, `geneva tail`

Each tool has configurable:
- CLI path
- Authentication method
- Allowed commands (for AI)
- Blocked commands (safety)

---

## 12. Security & Authentication

### Authentication

**Primary: Azure AD OAuth**
- User signs in with Microsoft account
- Supports MFA, Conditional Access
- Tokens used for: ADO API, Teams, Graph API

**Fallback: Personal Access Token**
- For environments without Azure AD
- User generates PAT in ADO with required scopes

### Credential Storage

Platform-native secure storage:
- **Windows**: Windows Credential Manager (DPAPI encrypted)
- **macOS**: Keychain Services (Secure Enclave)
- **Linux**: libsecret / Secret Service API

**NEVER stored**:
- Credentials in plain text files
- Credentials in local SQLite database
- Credentials in environment variables

### Permission Model

**Principle**: Cortex inherits user's ADO permissions (never has more access than the logged-in user)

**Agent Permission Escalation**:
- Agents act with user's permissions
- User configures which actions agents can perform
- High-risk actions always require explicit permission

### Security Boundaries

**AI Data Handling**:
- Only code user has permission to view sent to AI
- Sensitive patterns auto-redacted (connection strings, API keys, passwords)
- User can disable redaction for specific sessions

**Plugin Sandboxing**:
- Cannot access credentials directly
- Must declare permissions in manifest
- Network and filesystem access controlled

**Tool Execution Safety**:
- Only whitelisted commands allowed
- Every command logged with user/agent, timestamp, result

### Audit Logging

All security-relevant actions logged locally:
- AUTH, AGENT, TOOL, AI, ADO events
- 90 days retention
- Export available for compliance systems

---

## 13. Technical Stack

### Core Technology Stack

**Desktop Framework**: Electron 30+
- Chromium renderer for UI
- Node.js main process for integrations
- Auto-updater via electron-updater

**Frontend**:
- React 18+ with TypeScript 5+
- State Management: Zustand
- UI Components: shadcn/ui + Tailwind CSS
- Terminal Emulator: xterm.js

**Backend (Electron Main Process)**:
- Node.js 20+ LTS
- IPC: electron-trpc
- Database: better-sqlite3 (SQLCipher encrypted)
- Task Queue: BullMQ (in-memory mode)

### AI Integration SDKs

- **Claude Code SDK**: `@anthropic-ai/claude-code`
- **GitHub Copilot SDK**: `@github/copilot-sdk` (or LSP)

### Key Dependencies

- **HTTP**: axios, graphql-request, ws
- **Auth**: @azure/msal-node, keytar, electron-store
- **Terminal**: node-pty, xterm.js, execa
- **UI**: @radix-ui/*, @tanstack/react-query, @tanstack/react-table, react-markdown, @monaco-editor/react
- **Build**: vite, electron-builder, vitest, playwright

### Project Structure

```
cortex/
├── apps/
│   ├── desktop/                    # Electron app
│   │   ├── src/
│   │   │   ├── main/               # Electron main process
│   │   │   ├── renderer/           # React UI
│   │   │   └── preload/            # Preload scripts
│   │   └── resources/              # Icons, assets
│   └── background-service/         # Standalone background service
├── packages/
│   ├── sdk/                        # @cortex/sdk (plugin SDK)
│   ├── integrations/               # @cortex/integrations
│   ├── ui/                         # @cortex/ui (shared components)
│   └── shared/                     # @cortex/shared (types, utils)
├── plugins/                        # Built-in plugins
└── tools/                          # Build & dev tools
```

### Performance Targets

| Metric | Target |
|--------|--------|
| Cold start | < 3 seconds |
| Warm start | < 1 second |
| Idle memory | < 200 MB |
| Active memory | < 500 MB |
| Background service | < 50 MB |
| UI interactions | < 100ms |
| AI first token | < 1 second |

---

## 14. Success Metrics

### North Star Metric

**"Time from incident to resolution"**

Measures end-to-end value: faster incident response, AI-assisted debugging, automated fixes, streamlined PRs.

- Baseline: Measure current state before rollout
- Target: 50% reduction in mean time to resolution

### Adoption Metrics

| Metric | Target |
|--------|--------|
| Daily Active Users | 80% of team |
| Weekly Active Users | 95% of team |
| Claude Terminal usage | 90% of devs |
| Agent activation | 70% of devs |
| PR review via Cortex | 80% of PRs |
| Incident investigation | 90% of SEV1/2 |

### Efficiency Metrics

| Activity | Before | Target | Savings |
|----------|--------|--------|---------|
| PR review (initial) | 45 min | 15 min | 67% |
| PR review response cycle | 4 hours | 30 min | 88% |
| Work item breakdown | 2 hours | 20 min | 83% |
| Bug investigation | 3 hours | 45 min | 75% |
| Incident root cause | 2 hours | 15 min | 88% |
| Status report writing | 1 hour | 5 min | 92% |

### Quality Metrics

| Metric | Target |
|--------|--------|
| Bugs caught by AI review | > 30% of bugs |
| Security issues flagged pre-merge | > 90% |
| AI review accuracy | > 85% |
| AI root cause accuracy | > 75% |
| Post-merge defect rate | 25% reduction |

### Satisfaction Metrics

| Metric | Target |
|--------|--------|
| Overall satisfaction (1-5) | > 4.2 |
| Would recommend to colleague | > 80% |
| Prefer Cortex over ADO web UI | > 70% |
| AI helpfulness rating | > 4.0 |

---

## 15. Implementation Phases

### Phase Overview

```
Phase 0         Phase 1          Phase 2          Phase 3
Foundation      Core Dev         Full Platform    Enterprise
                Experience

• Electron      • Claude         • All 8          • Plugin
  shell           Terminal         Agents           marketplace
• Auth          • PR Review      • Planning       • Advanced
• ADO basic     • Work Items       Workbench        automation
• MDM/Jarvis/   • Basic          • Manager        • Multi-org
  Geneva          Agents           Dashboard        support
                • Incident       • Extensibility
                  Response         Platform

Internal        Internal         Internal +       External
Alpha           Beta             Pilot Teams      Rollout
```

### Phase 0: Foundation

**Deliverables**:
1. Electron App Shell (window management, system tray, auto-update)
2. Authentication (Azure AD OAuth, PAT fallback)
3. ADO Integration (Basic) (REST client, work items, PRs, repos, local cache)
4. Internal Tools Integration (MDM, Jarvis, Geneva CLI wrappers)
5. Basic UI Framework (component library, routing, theming)

**Exit Criteria**:
- Can authenticate and fetch ADO data
- Can execute MDM/Jarvis/Geneva commands
- 3 team members using daily for basic tasks

### Phase 1: Core Developer Experience

**Deliverables**:
1. Claude Terminal (Hybrid Mode) - xterm.js, context-aware tabs, JSON output
2. Developer Dashboard - My work items, My PRs, Quick actions, AI inbox
3. PR Review Agent - Auto-triggered, configurable autonomy
4. PR Comment Responder Agent - Draft responses with code fixes
5. Incident Response Workflow - Full MDM + Geneva + codebase analysis
6. Real-Time Updates - Webhooks, polling fallback
7. Background Service - System tray, notifications, agent execution

**Exit Criteria**:
- All developers on team using Cortex as primary tool
- 100% of PRs reviewed by AI
- Incident MTTR reduced by 30%
- Positive feedback (>4.0 satisfaction)

### Phase 2: Full Platform

**Deliverables**:
1. All 8 Agents (Triage, Sprint Health, Documentation, Pipeline Failure, Code Quality, Status Report)
2. Tech Lead Dashboard
3. Manager Dashboard
4. Planning Workbench (Timeline, hierarchy, AI breakdown, dependencies, sprint planning)
5. Extensibility Platform (Custom prompts, plugin SDK, no-code automation)
6. Built-in Integrations (Teams, Slack, GitHub)
7. Copilot Integration (AI Router implementation)

**Exit Criteria**:
- All personas actively using role-specific dashboards
- 80% of planning done through Cortex
- At least 3 custom plugins deployed
- Pilot expansion to 2-3 additional teams

### Phase 3: Enterprise Ready

**Deliverables**:
1. Multi-Organization Support
2. Advanced Automation (complex workflows, conditionals, scheduling)
3. Plugin Ecosystem (marketplace, version management)
4. Enterprise Administration (centralized config, policy enforcement, audit export)
5. Performance & Scale optimizations
6. Documentation & Onboarding
7. Stability & Polish (error handling, accessibility, performance)

**Exit Criteria**:
- Successfully deployed to 10+ teams
- All success metrics at target levels
- <5 critical bugs in 30 days
- Documentation complete

### Risk Mitigation

| Risk | Mitigation |
|------|------------|
| AI API reliability | Graceful degradation, retry logic, fallback to manual |
| AI response quality | User feedback loop, prompt tuning, human-in-the-loop |
| ADO API rate limits | Aggressive caching, request batching, backoff |
| User adoption resistance | Gradual rollout, champion users, quick wins |
| Scope creep | Strict phase gates, MVP focus, prioritization |
| Security concerns | Security review each phase, pen testing |
| Performance degradation | Performance budgets, monitoring, profiling gates |

---

## Summary

**Cortex** is an AI-native desktop platform that transforms Azure DevOps workflows by providing:

1. **Unified Experience**: One app for code, PRs, work items, incidents, and planning
2. **Intelligent AI Layer**: Claude + Copilot with smart routing for optimal results
3. **8 Autonomous Agents**: Watching, analyzing, and acting on your behalf
4. **Research-Based Collaboration**: AI explores, asks questions, and iterates with you
5. **Deep Internal Tool Integration**: MDM, Jarvis, Geneva for end-to-end incident response
6. **Full Extensibility**: Custom prompts, plugins, and no-code automation
7. **Role-Based Dashboards**: Optimized experiences for devs, leads, and managers

Built on Electron with React, TypeScript, and modern tooling. Phased rollout from internal dogfooding to enterprise-wide adoption.

---

**Document Status**: Draft - Ready for Review
**Next Steps**: Stakeholder review and approval, then Phase 0 kickoff
