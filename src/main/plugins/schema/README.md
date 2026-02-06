# TaskDock Plugin Format Reference

This document describes the TaskDock plugin format. It is designed to be read by LLMs generating plugins from natural language instructions.

## Plugin Directory Structure

A plugin is a folder placed in `~/.taskdock/plugins/<plugin-name>/`:

```
my-plugin/
├── manifest.json        # Required: metadata, config, triggers, hooks
├── ui.json              # Optional: custom tab with declarative UI
└── workflows/           # TypeScript workflow scripts
    ├── main-action.ts
    └── poll-data.ts
```

## manifest.json

The manifest defines the plugin identity, configuration fields, triggers, and hook points.

### Required Fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier, lowercase with hyphens (e.g. `my-plugin`) |
| `name` | string | Human-readable display name |
| `version` | string | Semver version (e.g. `1.0.0`) |
| `description` | string | Brief description of the plugin |
| `triggers` | array | At least one trigger (manual, polling, or scheduled) |

### Optional Fields

| Field | Type | Description |
|---|---|---|
| `config` | object | Configuration fields shown in plugin settings |
| `hooks` | object | Buttons injected into built-in tabs |

### Full Example

```json
{
  "id": "incident-manager",
  "name": "Incident Manager",
  "version": "1.0.0",
  "description": "Monitor and analyze incidents with AI",
  "config": {
    "apiEndpoint": {
      "type": "string",
      "label": "API Endpoint",
      "required": true
    },
    "teamId": {
      "type": "number",
      "label": "Team ID"
    },
    "pollInterval": {
      "type": "number",
      "label": "Poll interval (seconds)",
      "default": 30
    },
    "apiToken": {
      "type": "string",
      "label": "API Token",
      "secret": true
    }
  },
  "triggers": [
    {
      "type": "manual",
      "id": "runAnalysis",
      "workflow": "workflows/run-analysis.ts",
      "label": "Run Analysis"
    },
    {
      "type": "polling",
      "id": "pollData",
      "workflow": "workflows/poll-data.ts",
      "interval": "{{config.pollInterval}}s"
    },
    {
      "type": "scheduled",
      "id": "dailySummary",
      "workflow": "workflows/daily-summary.ts",
      "cron": "0 9 * * 1-5"
    }
  ],
  "hooks": {
    "pr-review": {
      "toolbar": [
        {
          "label": "Check Build",
          "icon": "play",
          "trigger": "checkBuild",
          "position": "right"
        }
      ]
    }
  }
}
```

### Config Field Types

Each key in `config` maps to an object with:

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | `"string"` \| `"number"` \| `"boolean"` | Yes | Data type |
| `label` | string | Yes | Display label in settings |
| `required` | boolean | No | Must be set before plugin runs |
| `default` | string \| number \| boolean | No | Default value |
| `secret` | boolean | No | Mask value in UI (for tokens) |

### Trigger Types

**Manual** -- Fired when a user clicks a button.

```json
{ "type": "manual", "id": "doSomething", "workflow": "workflows/do-something.ts", "label": "Do Something" }
```

**Polling** -- Runs at a fixed interval. The `interval` value supports config references.

```json
{ "type": "polling", "id": "poll", "workflow": "workflows/poll.ts", "interval": "30s" }
```

```json
{ "type": "polling", "id": "poll", "workflow": "workflows/poll.ts", "interval": "{{config.pollInterval}}s" }
```

**Scheduled** -- Runs on a cron schedule (minute hour day month weekday).

```json
{ "type": "scheduled", "id": "daily", "workflow": "workflows/daily.ts", "cron": "0 9 * * 1-5" }
```

All trigger types accept an optional `timeout` field (seconds, default: 60).

### Hook Points

Hooks inject buttons into built-in TaskDock tabs.

| Tab | Available Locations |
|---|---|
| `pr-review` | `toolbar`, `file-context-menu`, `comments-toolbar`, `bottom-panel` |
| `pr-home` | `toolbar`, `row-actions` |
| `workitems` | `toolbar`, `row-actions` |
| `terminals` | `toolbar` |

Each hook button has:

| Property | Type | Required | Description |
|---|---|---|---|
| `label` | string | Yes | Button text |
| `icon` | string | Yes | Lucide icon name |
| `trigger` | string | Yes | Trigger ID to invoke |
| `position` | `"left"` \| `"right"` | No | Toolbar position |

## ui.json -- Component Catalog

A plugin can define a custom tab by creating a `ui.json` file. The tab appears in the TaskDock sidebar.

### Structure

```json
{
  "tab": {
    "id": "my-tab",
    "label": "My Plugin",
    "icon": "layout-grid"
  },
  "layout": {
    "type": "split-panel",
    "sizes": [40, 60],
    "children": [
      { "type": "table", "id": "item-list", "columns": [...] },
      { "type": "detail-panel", "id": "item-detail", "sections": [...] }
    ]
  }
}
```

### Component Types

**table** -- Sortable, filterable data grid with row selection.

```json
{
  "type": "table",
  "id": "my-table",
  "dataSource": "getData",
  "columns": [
    { "key": "id", "label": "ID", "width": 80 },
    { "key": "name", "label": "Name" },
    { "key": "status", "label": "Status", "component": "status-badge", "colorMap": { "active": "green", "error": "red" } }
  ],
  "onRowClick": "selectItem",
  "polling": { "interval": 30000 },
  "sortable": true,
  "filterable": true
}
```

**detail-panel** -- Container for showing details of a selected item.

```json
{
  "type": "detail-panel",
  "id": "item-detail",
  "dataSource": "getItemDetail",
  "sections": [
    { "type": "header", "title": "{{title}}" },
    { "type": "key-value", "dataSource": "getFields" }
  ]
}
```

**card** -- Content block with optional label. Supports text, markdown, or code rendering.

```json
{ "type": "card", "label": "Summary", "content": "{{summary}}", "renderAs": "markdown" }
```

**split-panel** -- Resizable two-pane layout (horizontal or vertical).

```json
{
  "type": "split-panel",
  "sizes": [40, 60],
  "direction": "horizontal",
  "children": [{ ... }, { ... }]
}
```

**button-group** -- Row of action buttons wired to triggers.

```json
{
  "type": "button-group",
  "buttons": [
    { "label": "Analyze", "icon": "sparkles", "action": "runAnalysis" },
    { "label": "Refresh", "icon": "refresh-cw", "action": "refresh" }
  ]
}
```

**status-badge** -- Colored status indicator.

```json
{ "type": "status-badge", "value": "{{status}}", "colorMap": { "active": "green", "error": "red" } }
```

**key-value** -- Label-value pair list for displaying structured data.

```json
{ "type": "key-value", "dataSource": "getMetadata", "fields": [{ "key": "owner", "label": "Owner" }] }
```

**timeline** -- Chronological event list.

```json
{ "type": "timeline", "dataSource": "getEvents", "fields": { "time": "timestamp", "title": "event", "description": "details" } }
```

**tabs** -- Sub-tab navigation within a panel.

```json
{
  "type": "tabs",
  "items": [
    { "label": "Overview", "content": { "type": "key-value", "dataSource": "getOverview" } },
    { "label": "History", "content": { "type": "timeline", "dataSource": "getHistory" } }
  ]
}
```

**form** -- Input form for configuration or triggering actions.

```json
{
  "type": "form",
  "fields": [
    { "key": "query", "label": "Search Query", "type": "string", "required": true },
    { "key": "limit", "label": "Max Results", "type": "number" }
  ],
  "onSubmit": "runSearch"
}
```

**markdown** -- Rendered markdown block.

```json
{ "type": "markdown", "content": "{{analysisResult}}" }
```

**empty-state** -- Placeholder shown when no data is available.

```json
{ "type": "empty-state", "icon": "inbox", "title": "No items", "description": "Click refresh to load data.", "action": { "label": "Refresh", "trigger": "loadData" } }
```

**header** -- Section header with optional subtitle.

```json
{ "type": "header", "title": "{{title}}", "subtitle": "{{team}} - Created {{date}}" }
```

### Data Binding

Components with a `dataSource` field receive data when a workflow calls `ctx.ui.update(componentId, data)`. The `id` on the component must match the `componentId` passed to `ctx.ui.update`.

Template strings like `{{title}}` are replaced with values from the data object.

### Actions

Buttons with an `action` field invoke the trigger with that ID from the manifest. The current selection state is passed as `ctx.input`.

## Workflow Scripts

Each workflow is a TypeScript file that exports a default async function receiving a `PluginContext` object.

### Basic Structure

```ts
export default async function(ctx: PluginContext) {
  // Read config
  const endpoint = ctx.config.apiEndpoint;

  // Read input from the trigger
  const itemId = ctx.input.itemId;

  // Do work...
  const data = await ctx.http.get(`${endpoint}/items/${itemId}`);

  // Update the UI
  await ctx.ui.update('item-detail', data);
  await ctx.ui.toast('Loaded successfully', 'success');
}
```

### ctx API Reference

#### ctx.input

Data passed from the trigger. For manual triggers fired from a table row, this contains the selected row data. For hooked buttons in built-in tabs, this contains contextual data from that tab:

```ts
// From a pr-review hook:
ctx.input.source   // "pr-review"
ctx.input.pr       // { id, title, repository, sourceBranch, targetBranch, ... }
ctx.input.files    // [{ path, changeType, ... }]

// From a pr-home row-action hook:
ctx.input.source   // "pr-home"
ctx.input.pr       // { id, title, repository, status, ... }
```

#### ctx.config

Direct access to plugin configuration values set by the user in Settings:

```ts
const token = ctx.config.apiToken;
const endpoint = ctx.config.apiEndpoint;
```

#### ctx.http

HTTP client for calling external APIs. Returns parsed JSON.

```ts
const data = await ctx.http.get('https://api.example.com/items', {
  headers: { 'Authorization': `Bearer ${ctx.config.token}` }
});

const result = await ctx.http.post('https://api.example.com/items', {
  name: 'New Item',
  status: 'active'
}, {
  headers: { 'Authorization': `Bearer ${ctx.config.token}` }
});

await ctx.http.put('https://api.example.com/items/123', { status: 'closed' });

await ctx.http.delete('https://api.example.com/items/123');
```

#### ctx.shell

Run shell commands. Returns stdout, stderr, and exitCode.

```ts
const result = await ctx.shell.run('git log --oneline -5', {
  cwd: '/path/to/repo',
  timeout: 10000
});

if (result.exitCode === 0) {
  ctx.log.info(`Git output: ${result.stdout}`);
} else {
  ctx.log.error(`Git failed: ${result.stderr}`);
}
```

#### ctx.ai

Call AI providers. Returns the response as a string.

```ts
const analysis = await ctx.ai.claude(
  `Analyze this error and suggest a fix:\n${errorMessage}`
);

const review = await ctx.ai.copilot(
  `Review this code diff:\n${diff}`
);
```

#### ctx.ui

Update plugin UI components, show toast notifications, and inject components into built-in tabs.

```ts
// Push data to a component by its ID
await ctx.ui.update('my-table', items);
await ctx.ui.update('item-detail', { title: 'Hello', summary: markdownText });

// Show a toast notification
await ctx.ui.toast('Operation complete', 'success');   // success | error | warning | info

// Inject a component into a built-in tab
await ctx.ui.inject('pr-review', 'bottom-panel', {
  type: 'card',
  label: 'Build Status',
  content: buildSummary,
  renderAs: 'markdown'
});
```

#### ctx.store

Persistent key-value storage scoped to the plugin. Data survives restarts.

```ts
// Save data
await ctx.store.set('lastPollTime', Date.now());
await ctx.store.set('cache:item:123', { title: 'Cached item' });

// Read data
const lastPoll = await ctx.store.get('lastPollTime');

// Remove data
await ctx.store.delete('cache:item:123');
```

#### ctx.log

Structured logging. Output appears in the plugin log panel at the bottom of the plugin tab.

```ts
ctx.log.info('Starting analysis...');
ctx.log.warn('API rate limit approaching');
ctx.log.error('Failed to fetch data');
ctx.log.debug('Response payload: ' + JSON.stringify(data));
```

#### ctx.run

Invoke another trigger/workflow within the same plugin. Useful for chaining workflows.

```ts
// Run the "runAnalysis" trigger with input data
await ctx.run('runAnalysis', { itemId: 42 });
```

## Complete Plugin Example

A minimal plugin that adds a tab showing a list of items fetched from an API:

**manifest.json**

```json
{
  "id": "item-tracker",
  "name": "Item Tracker",
  "version": "1.0.0",
  "description": "Track items from an external API",
  "config": {
    "apiUrl": { "type": "string", "label": "API URL", "required": true },
    "apiToken": { "type": "string", "label": "API Token", "secret": true }
  },
  "triggers": [
    { "type": "manual", "id": "refresh", "workflow": "workflows/refresh.ts", "label": "Refresh" },
    { "type": "polling", "id": "poll", "workflow": "workflows/refresh.ts", "interval": "60s" }
  ]
}
```

**ui.json**

```json
{
  "tab": { "id": "items", "label": "Items", "icon": "list" },
  "layout": {
    "type": "table",
    "id": "item-list",
    "columns": [
      { "key": "id", "label": "ID", "width": 60 },
      { "key": "title", "label": "Title" },
      { "key": "status", "label": "Status", "component": "status-badge", "colorMap": { "open": "green", "closed": "gray" } }
    ],
    "sortable": true
  }
}
```

**workflows/refresh.ts**

```ts
export default async function(ctx) {
  const items = await ctx.http.get(`${ctx.config.apiUrl}/items`, {
    headers: { 'Authorization': `Bearer ${ctx.config.apiToken}` }
  });

  await ctx.ui.update('item-list', items);
  ctx.log.info(`Loaded ${items.length} items`);
}
```
