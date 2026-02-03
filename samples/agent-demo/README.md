# Agent Demo

A sample application demonstrating the use of **Claude Code SDK** and **GitHub Copilot SDK** with **WorkIQ MCP** for enterprise context gathering and Azure DevOps work item creation.

## Overview

This demo shows how to build an AI-powered work item assistant that:

1. **Gathers Enterprise Context** - Uses WorkIQ MCP to query meetings, documents, emails, and existing work items
2. **Designs Features** - Claude synthesizes context and generates comprehensive design documents
3. **Creates Work Items** - Automatically creates Epic → Feature → Story → Task hierarchies in Azure DevOps

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Work Item Assistant                        │
├──────────────────────────────────────────────────────────────┤
│  CLI (commander)                                              │
│    ├── design command → Claude Agent + WorkIQ MCP            │
│    └── plan command   → Claude Agent + ADO CLI               │
├──────────────────────────────────────────────────────────────┤
│  Agents                                                       │
│    ├── Claude Agent SDK  → Reasoning, planning, design       │
│    └── Copilot SDK       → Code generation (future use)      │
├──────────────────────────────────────────────────────────────┤
│  MCP Servers                                                  │
│    └── WorkIQ MCP → Meetings, docs, emails, M365 data        │
└──────────────────────────────────────────────────────────────┘
```

## Prerequisites

- **Node.js** 20 or later
- **Azure CLI** with DevOps extension
- **Microsoft 365** account (for WorkIQ)

### Install Azure CLI & DevOps Extension

```bash
# Install Azure CLI (if not already installed)
# See: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli

# Add the Azure DevOps extension
az extension add --name azure-devops

# Login to Azure
az login
```

## Installation

```bash
cd samples/agent-demo
npm install
```

## Configuration

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Edit `.env` with your settings:

```bash
ADO_ORG_URL=https://dev.azure.com/your-organization
ADO_PROJECT=your-project-name
```

3. Accept the WorkIQ EULA (first-time only):

Visit https://github.com/microsoft/work-iq-mcp and follow the setup instructions.

## Usage

### Design Command

Generate a design document using Claude with enterprise context from WorkIQ:

```bash
# Basic design
npx tsx src/index.ts design "OAuth authentication system"

# With custom output path
npx tsx src/index.ts design "PDF export feature" --output ./docs/pdf-design.md

# Interactive mode (asks follow-up questions)
npx tsx src/index.ts design "Real-time notifications" --interactive

# Verbose mode (shows WorkIQ queries)
npx tsx src/index.ts design "User dashboard" --verbose
```

### Plan Command

Create work items in Azure DevOps:

```bash
# Dry run (preview without creating items)
npx tsx src/index.ts plan "OAuth authentication" --dry-run

# Create work items in specific project
npx tsx src/index.ts plan "PDF export feature" --project MyProject

# Verbose mode
npx tsx src/index.ts plan "User dashboard" --verbose
```

### Info Command

Show current configuration:

```bash
npx tsx src/index.ts info
```

### Setup Command

Interactive setup guide:

```bash
npx tsx src/index.ts setup
```

## How It Works

### 1. Context Gathering (WorkIQ MCP)

When you run a design or plan command, Claude uses the WorkIQ MCP to query:

- **Meetings** - "What meetings discussed authentication?"
- **Documents** - "Are there design docs about our auth standards?"
- **Emails** - "What decisions were made about SSO?"
- **Work Items** - "What existing items relate to authentication?"

### 2. Design Document Generation

Claude synthesizes the gathered context and generates a markdown design document:

- Overview and goals
- Architecture decisions (with citations)
- Component breakdown
- API contracts
- Security considerations

### 3. Work Item Creation

Claude generates a structured work item hierarchy:

```json
{
  "epic": { "title": "...", "description": "..." },
  "features": [...],
  "stories": [...],
  "tasks": [...]
}
```

The plan command then creates these items in ADO using the `az boards` CLI.

## Project Structure

```
samples/agent-demo/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── config.ts             # Configuration loader
│   ├── auth/
│   │   └── ado-token.ts      # ADO authentication
│   ├── agents/
│   │   ├── claude-agent.ts   # Claude SDK + WorkIQ MCP
│   │   └── copilot-agent.ts  # Copilot SDK
│   └── commands/
│       ├── design.ts         # Design document generation
│       └── plan.ts           # Work item creation
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## SDK References

- **Claude Code SDK**: [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
- **GitHub Copilot SDK**: [@github/copilot-sdk](https://www.npmjs.com/package/@github/copilot-sdk)
- **WorkIQ MCP**: [@microsoft/workiq](https://github.com/microsoft/work-iq-mcp)

## License

MIT
