# Protocol Handler Implementation Plan

Design: [2026-02-07-protocol-handler-design.md](./2026-02-07-protocol-handler-design.md)

## Key API Details (from Context7 docs)

**Critical Windows behavior**: On Windows/Linux, the deep-link plugin does NOT
emit events. The OS spawns a new app instance with the URL as a CLI argument.
The single-instance plugin with `features = ["deep-link"]` bridges this gap —
it intercepts the second instance and forwards the URL through the deep-link
plugin's event system, making `onOpenUrl` work cross-platform.

- **Warm start** (app running): single-instance plugin intercepts second
  launch, forwards URL via deep-link integration → JS `onOpenUrl` fires
- **Cold start** (app not running): URL is in `std::env::args()` — need a
  custom Tauri command to expose this to the frontend

JS API: `onOpenUrl(callback: (urls: string[]) => void)` from
`@tauri-apps/plugin-deep-link`

Rust API: `tauri_plugin_deep_link::init()` and
`tauri_plugin_single_instance::init(|app, argv, cwd| { ... })`

---

## Step 1: Add Rust dependencies

**File**: `src-tauri/Cargo.toml`

Add after line 28 (`tauri-plugin-store = "2"`):
```toml
tauri-plugin-deep-link = "2"
tauri-plugin-single-instance = { version = "2", features = ["deep-link"] }
```

The `deep-link` feature on single-instance is what makes `onOpenUrl` work on
Windows/Linux by forwarding CLI args through the deep-link event system.

---

## Step 2: Configure protocol scheme

**File**: `src-tauri/tauri.conf.json`

Add `deep-link` to the existing `plugins` object (alongside `shell`):
```json
"plugins": {
  "shell": {
    "open": true
  },
  "deep-link": {
    "desktop": {
      "schemes": ["taskdock"]
    }
  }
}
```

This tells Tauri to register `taskdock://` with the OS during installation
(Windows registry, Linux xdg-mime).

---

## Step 3: Add capability permissions

**File**: `src-tauri/capabilities/default.json`

Add to the `permissions` array:
```json
"deep-link:default",
"single-instance:default"
```

These allow the frontend to use the deep-link and single-instance plugin APIs.

---

## Step 4: Update Rust backend

**File**: `src-tauri/src/lib.rs`

### 4a. Add a new command module

**File**: `src-tauri/src/commands/deep_link.rs` (new)

```rust
use tauri::State;
use std::sync::Mutex;

/// Holds the deep-link URL from cold start (if any)
pub struct InitialDeepLink(pub Mutex<Option<String>>);

#[tauri::command]
pub fn get_initial_deep_link(
    state: State<'_, InitialDeepLink>,
) -> Option<String> {
    state.0.lock().unwrap().take() // take() so it's only consumed once
}
```

**File**: `src-tauri/src/commands/mod.rs` — add `pub mod deep_link;`

### 4b. Register plugins and state in lib.rs

In the `run()` function, add to the builder chain (before `.setup()`):

```rust
use commands::deep_link::InitialDeepLink;

// Extract deep-link URL from CLI args (cold start on Windows/Linux)
let initial_url = std::env::args()
    .find(|arg| arg.starts_with("taskdock://"));

// ... in Builder:
.manage(InitialDeepLink(Mutex::new(initial_url)))
.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
    // Focus the existing window when a second instance is attempted
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    // URL forwarding to onOpenUrl is handled automatically by the
    // "deep-link" feature on single-instance plugin
}))
.plugin(tauri_plugin_deep_link::init())
```

Add `get_initial_deep_link` to the `invoke_handler`:
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    commands::deep_link::get_initial_deep_link,
])
```

Add `use tauri::Manager;` at the top for `get_webview_window`.

---

## Step 5: Install JS package

```sh
npm add @tauri-apps/plugin-deep-link
```

---

## Step 6: Create deep-link handler

**File**: `src/renderer/deep-link-handler.ts` (new)

```typescript
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { invoke } from '@tauri-apps/api/core';

interface DeepLinkReviewAction {
  action: 'review';
  org: string;
  project: string;
  prId: number;
}

type DeepLinkAction = DeepLinkReviewAction;

interface DeepLinkTarget {
  openPRByUrl(org: string, project: string, prId: number): void;
  switchSection(section: string): void;
}

function parseDeepLink(url: string): DeepLinkAction | null {
  try {
    // URL format: taskdock://review/{org}/{project}/{prId}
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);

    if (parsed.protocol !== 'taskdock:') return null;

    // parsed.hostname is the first segment after taskdock://
    // So taskdock://review/org/proj/123 → hostname="review", pathname="/org/proj/123"
    const action = parsed.hostname;

    if (action === 'review' && segments.length === 3) {
      const prId = Number(segments[2]);
      if (isNaN(prId)) return null;
      return {
        action: 'review',
        org: segments[0],
        project: segments[1],
        prId,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function dispatch(target: DeepLinkTarget, action: DeepLinkAction) {
  if (action.action === 'review') {
    target.switchSection('review');
    target.openPRByUrl(action.org, action.project, action.prId);
  }
}

export async function initDeepLinkHandler(target: DeepLinkTarget) {
  // Warm start: listen for deep-link events (works cross-platform with
  // single-instance "deep-link" feature)
  await onOpenUrl((urls: string[]) => {
    for (const url of urls) {
      console.log('[deep-link] Received URL:', url);
      const action = parseDeepLink(url);
      if (action) {
        dispatch(target, action);
      }
    }
  });

  // Cold start: check if app was launched via protocol URL
  try {
    const initialUrl = await invoke<string | null>('get_initial_deep_link');
    if (initialUrl) {
      console.log('[deep-link] Initial URL:', initialUrl);
      const action = parseDeepLink(initialUrl);
      if (action) {
        dispatch(target, action);
      }
    }
  } catch (e) {
    console.warn('[deep-link] Failed to get initial deep link:', e);
  }
}
```

**Note on URL parsing**: `new URL('taskdock://review/skype/scc/1341766')`
parses as `hostname = "review"`, `pathname = "/skype/scc/1341766"`. So the
action comes from `hostname`, and org/project/prId from pathname segments.

---

## Step 7: Integrate in app.ts

**File**: `src/renderer/app.ts`

### 7a. Import
Add to the imports at the top:
```typescript
import { initDeepLinkHandler } from './deep-link-handler.js';
```

### 7b. Make openPRByUrl accessible
The `openPRByUrl` method is currently `private`. Either:
- Change to `public` (simplest), or
- Add a public wrapper method

Change the method signature at line 2035:
```typescript
public async openPRByUrl(org: string, project: string, prId: number) {
```

Also need to make `switchSection` public (currently called from sidebar
callback, check visibility).

### 7c. Initialize handler
At the end of the constructor (after `this.checkFirstLaunch()` on line 234):
```typescript
initDeepLinkHandler(this);
```

---

## Verification

1. `cargo build` in `src-tauri/` — verify Rust compiles
2. `npm run build:renderer` — verify TypeScript compiles
3. **Cold start test**: Run the built app via `taskdock.exe taskdock://review/skype/scc/1341766` — should open PR tab
4. **Warm start test**: With app running, run the exe again with the URL — should focus window and open PR tab
5. **Invalid URL test**: `taskdock://bogus/path` — should log and ignore

## Build order

Steps 1-4 (Rust side) and Step 5 (npm install) can be done in parallel.
Step 6 depends on Step 5. Step 7 depends on Step 6.
