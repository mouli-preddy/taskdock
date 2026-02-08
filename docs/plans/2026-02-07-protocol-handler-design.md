# Protocol Handler Design (`taskdock://`)

## Overview

Register a `taskdock://` custom protocol scheme so that clicking links like
`taskdock://review/skype/scc/1341766` launches (or focuses) the app and opens
the corresponding PR review tab.

## URL Format

```
taskdock://review/{org}/{project}/{prId}
```

Example: `taskdock://review/skype/scc/1341766`

Only the `review` action is implemented. The infrastructure supports adding more
routes later, but we intentionally keep the scope minimal.

The `repo` segment is omitted — `openPRByUrl()` only needs org, project, and
prId. Repo info is populated automatically from the API response.

## Tauri Plugins

Two Tauri v2 plugins:

| Plugin | Purpose |
|--------|---------|
| `tauri-plugin-deep-link` | Registers `taskdock://` with the OS, provides API to receive URLs |
| `tauri-plugin-single-instance` | Ensures one app instance; forwards URLs from second launches |

## Architecture

### Data Flow

```
User clicks taskdock://review/skype/scc/1341766
  -> OS launches app (or signals existing instance)
  -> Tauri emits "deep-link-received" event (or frontend queries on init)
  -> deep-link-handler.ts parses URL
  -> Calls app.openPRByUrl("skype", "scc", 1341766)
  -> Existing PR loading logic takes over
```

### Two Startup Scenarios

**Warm start** (app already running):
The single-instance plugin intercepts the second launch, extracts the URL from
argv, and emits `"deep-link-received"` to the existing window. The window is
also focused via `set_focus()`.

**Cold start** (app not running):
The app launches normally. The frontend, once initialized, calls a Tauri command
`get_initial_deep_link` to check if the app was launched via a protocol URL. If
so, it dispatches accordingly.

### Rust Side (`lib.rs`)

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        // Warm start: forward URL from second launch to existing window
        if let Some(url) = argv.get(1) {
            let _ = app.emit("deep-link-received", url);
            // Focus the main window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }
    }))
    .plugin(tauri_plugin_deep_link::init())
    .invoke_handler(tauri::generate_handler![get_initial_deep_link])
    .setup(|app| {
        // Store initial deep-link URL for frontend to query
        // ...
    })
```

The `get_initial_deep_link` command returns the URL that launched the app (if
any), allowing the frontend to query it after initialization completes.

### TypeScript Side (`deep-link-handler.ts`)

New module with three responsibilities:

1. **Parse** deep-link URLs into structured actions
2. **Listen** for `"deep-link-received"` Tauri events (warm start)
3. **Query** initial deep-link on startup (cold start)

```typescript
interface DeepLinkReviewAction {
  action: 'review';
  org: string;
  project: string;
  prId: number;
}

type DeepLinkAction = DeepLinkReviewAction; // extensible later

function parseDeepLink(url: string): DeepLinkAction | null {
  const parsed = new URL(url);
  const segments = parsed.pathname.split('/').filter(Boolean);

  if (segments[0] === 'review' && segments.length === 4) {
    return {
      action: 'review',
      org: segments[1],
      project: segments[2],
      prId: Number(segments[3])
    };
  }
  return null;
}
```

Dispatch calls `app.openPRByUrl(org, project, prId)` for review actions.

### Integration Point (`app.ts`)

At the end of the `PRReviewApp` constructor, after all views are initialized:

```typescript
initDeepLinkHandler(this);
```

## File Changes

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Add `tauri-plugin-deep-link` and `tauri-plugin-single-instance` |
| `src-tauri/tauri.conf.json` | Add `deep-link` plugin config with `"taskdock"` scheme |
| `src-tauri/src/lib.rs` | Register plugins, emit events, add `get_initial_deep_link` command |
| `src/renderer/deep-link-handler.ts` | **New** — URL parsing, event listening, dispatch |
| `src/renderer/app.ts` | Call `initDeepLinkHandler(this)` at end of constructor |

## Out of Scope (YAGNI)

- Routes other than `review`
- Custom error UI for malformed URLs (log and ignore)
- URL generation / "copy link" feature
- Multiple window support
