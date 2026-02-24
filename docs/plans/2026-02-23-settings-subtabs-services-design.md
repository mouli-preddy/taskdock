# Settings Sub-tabs & Services Tab Design

## Problem
The settings page is a single scrollable page with many unrelated sections. We need to:
1. Organize settings into sub-tabs for better navigation
2. Add a new "Services" tab for registering services with repo paths and cross-links

## Design

### Sub-tab Structure

| Tab | Contents |
|-----|----------|
| **Connection** | ADO connection, auth help, monitored repos |
| **Review** | Console review (linked repos, worktree settings, generated patterns, WorkIQ), polling |
| **AI** | AI provider cards, notifications, plugins |
| **Services** | Service registry |

### Services Data Model

```typescript
interface ServiceEntry {
  id: string;           // UUID
  name: string;         // Display name (e.g., "Backend API")
  description: string;  // Short description
  repoPath: string;     // Local filesystem path to git repo
  linkedServiceIds: string[]; // IDs of related services
}
```

Stored in `store.json` under `"services"` key as an array.

### Approach: CSS-based sub-tabs within SettingsView

- Add horizontal tab bar inside settings view header (reuse existing tab-bar patterns)
- Each tab wraps its settings cards in a container div, toggled via CSS class
- Services persisted via new Tauri commands: `get_services` / `set_services`
- Service form: name input, description textarea, repo path (browse button), linked services (multi-select from existing services)

### Changes Required

**Rust (src-tauri/src/commands/storage.rs):**
- Add `ServiceEntry` struct
- Add `get_services` / `set_services` commands
- Add default `"services": []` to store defaults

**Rust (src-tauri/src/lib.rs):**
- Register new commands

**TypeScript (src/renderer/components/settings-view.ts):**
- Add sub-tab bar to header
- Wrap existing sections in tab container divs
- Add services tab content with CRUD UI
- Add load/save/render methods for services

**TypeScript (src/renderer/tauri-api.ts + api.d.ts):**
- Add `getServices` / `setServices` API methods

**CSS (src/renderer/styles/settings-view.css):**
- Add settings sub-tab styles

**TypeScript (src/shared/types.ts or new shared file):**
- Add `ServiceEntry` interface
