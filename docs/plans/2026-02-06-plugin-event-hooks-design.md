# Plugin Event Hooks Design

## Overview

Event hooks allow plugins to run workflows in response to app events (PR opened, comment added, work item updated, etc.). Hooks are **fire-and-forget**: the action completes first, then hook workflows run asynchronously in the background. Errors are logged but never affect the original action.

## Hook Trigger Format in manifest.json

```json
{
  "triggers": [
    {
      "type": "hook",
      "id": "on-pr-opened",
      "event": "pr:opened",
      "workflow": "workflows/on-pr-opened.ts",
      "timeout": 30
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"hook"` | Yes | Trigger type |
| `id` | `string` | Yes | Unique trigger ID within the plugin |
| `event` | `AppEventName` | Yes | Event to subscribe to |
| `workflow` | `string` | Yes | Path to workflow file (relative to plugin dir) |
| `timeout` | `number` | No | Timeout in seconds (default: engine default) |

## Event Catalog

| Event | Fired When | `ctx.input` keys |
|---|---|---|
| `pr:opened` | User loads PR | `event, pr` |
| `pr:comment-created` | New file comment | `event, pr, threadId, filePath, comment` |
| `pr:comment-replied` | Reply to thread | `event, pr, threadId, comment` |
| `pr:thread-status-changed` | Thread resolved/activated | `event, pr, threadId, status` |
| `pr:vote-submitted` | Approval/rejection | `event, pr, vote` |
| `workitem:opened` | User opens work item | `event, workItem` |
| `workitem:updated` | Field updated | `event, workItem, changes` |
| `workitem:comment-added` | Comment on work item | `event, workItem, comment` |
| `terminal:created` | Terminal starts | `event, sessionId` |
| `terminal:exited` | Terminal ends | `event, sessionId, exitCode` |
| `review:started` | AI review begins | `event, sessionId` |
| `review:completed` | AI review finishes | `event, sessionId` |

All events include an `event` key with the event name string.

## Architecture

```
┌──────────────┐      RPC handler completes       ┌─────────────────┐
│  bridge.ts   │ ──────────────────────────────>   │  pluginEngine   │
│  (RPC layer) │   pluginEngine.emitAppEvent(...)  │  .emitAppEvent()│
└──────────────┘                                   └────────┬────────┘
                                                            │
                                               hookRegistry.get(event)
                                                            │
                                                   ┌────────▼────────┐
                                                   │  For each hook: │
                                                   │  executeTrigger  │
                                                   │  (fire & forget)│
                                                   └─────────────────┘
```

### Hook Registry

- `Map<string, Array<{ pluginId, triggerId, workflow }>>` keyed by event name
- Built at initialization time (not scanned per event)
- Rebuilt on: plugin reload, plugin enable/disable, new plugin detected

### Execution Model

- `emitAppEvent()` is synchronous from the caller's perspective
- Each hook calls `executeTrigger().catch(logger.error)` — no await
- Multiple plugins subscribing to the same event all fire independently
- Hook errors are logged but never propagate to the caller

## Adding New Events

To add a new event:

1. Add the event name to the `AppEventName` union in `src/shared/plugin-types.ts`
2. Add `pluginEngine.emitAppEvent('new:event', { ...data })` at the appropriate point in `bridge.ts`

That's it — the hook registry automatically picks up any plugins subscribed to the new event.

## Example Plugin Usage

### manifest.json

```json
{
  "id": "pr-notifier",
  "name": "PR Notifier",
  "version": "1.0.0",
  "description": "Shows a toast when PRs are opened",
  "triggers": [
    {
      "type": "hook",
      "id": "on-pr-opened",
      "event": "pr:opened",
      "workflow": "workflows/on-pr-opened.ts"
    }
  ]
}
```

### workflows/on-pr-opened.ts

```ts
export default async function(ctx) {
  ctx.log.info(`PR opened: ${ctx.input.pr?.title || 'unknown'}`);
  await ctx.ui.toast(`PR "${ctx.input.pr?.title}" loaded`, 'info');
}
```
