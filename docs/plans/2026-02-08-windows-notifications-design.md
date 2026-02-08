# Windows Notifications Design

## Summary

Add native Windows toast notifications for long-running background events. Notifications fire when TaskDock is in the background so the user knows when AI tasks complete or PR activity is detected. Existing in-app toasts are kept for foreground use.

## Events

| Event | Trigger | Notification Text |
|---|---|---|
| AI PR Review complete | Review session status → `complete` | "PR Review Complete — N comment(s) found on PR #123" |
| AI Comment Analysis complete | Analysis callback signals done | "Comment Analysis Complete — N comment(s) analyzed on PR #123" |
| New comments detected | Polling detects thread hash change | "New Comments — N new/updated thread(s) on PR #123" |
| New iterations detected | Polling detects iteration count change | "New Commits — New push detected on PR #123" |

## Settings Model

```typescript
interface NotificationSettings {
  enabled: boolean;              // master toggle
  aiReviewComplete: boolean;     // default: true
  aiAnalysisComplete: boolean;   // default: true
  newComments: boolean;          // default: true
  newIterations: boolean;        // default: true
}
```

Default: all enabled. Stored via `tauri-plugin-store` alongside existing settings.

## Architecture

```
Backend (Node sidecar)
  → emits event over WebSocket
    → Renderer receives in app.ts
      → Reads NotificationSettings from store
      → Master toggle off? Skip.
      → Per-event toggle off? Skip.
      → Calls Tauri notification API → Windows toast
      → Also shows in-app Toast (existing behavior)
```

No backend changes needed — all notification logic lives in the renderer.

## Implementation

### 1. Rust — Tauri Plugin Setup

**Cargo.toml** — add dependency:
```toml
tauri-plugin-notification = "2"
```

**lib.rs** — register plugin:
```rust
.plugin(tauri_plugin_notification::init())
```

**capabilities/default.json** — add permission:
```json
"notification:default"
```

### 2. Frontend — npm Package

Install `@tauri-apps/plugin-notification` (Tauri v2 JS binding).

### 3. NotificationService

New file: `src/renderer/services/notification-service.ts`

```typescript
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

type NotificationEvent =
  | 'aiReviewComplete'
  | 'aiAnalysisComplete'
  | 'newComments'
  | 'newIterations';

interface NotificationSettings {
  enabled: boolean;
  aiReviewComplete: boolean;
  aiAnalysisComplete: boolean;
  newComments: boolean;
  newIterations: boolean;
}

const DEFAULTS: NotificationSettings = {
  enabled: true,
  aiReviewComplete: true,
  aiAnalysisComplete: true,
  newComments: true,
  newIterations: true,
};

class NotificationService {
  private settings: NotificationSettings = { ...DEFAULTS };

  updateSettings(settings: NotificationSettings) {
    this.settings = settings;
  }

  async notify(event: NotificationEvent, title: string, body: string) {
    if (!this.settings.enabled) return;
    if (!this.settings[event]) return;

    let permitted = await isPermissionGranted();
    if (!permitted) {
      const result = await requestPermission();
      permitted = result === 'granted';
    }
    if (!permitted) return;

    sendNotification({ title, body });
  }
}

export const notificationService = new NotificationService();
```

### 4. Integration Points (app.ts)

Wire `notificationService.notify()` at each event handler:

1. **AI Review complete** (~line 1012, existing `showNotification` block):
   ```typescript
   notificationService.notify(
     'aiReviewComplete',
     'PR Review Complete',
     `${commentCount} comment(s) found on PR #${prId}`
   );
   ```

2. **AI Analysis complete** (analysis completion callback):
   ```typescript
   notificationService.notify(
     'aiAnalysisComplete',
     'Comment Analysis Complete',
     `${count} comment(s) analyzed on PR #${prId}`
   );
   ```

3. **New comments** (polling result handler, thread hash changed):
   ```typescript
   notificationService.notify(
     'newComments',
     'New Comments',
     `New/updated thread(s) on PR #${prId}`
   );
   ```

4. **New iterations** (polling result handler, iteration count changed):
   ```typescript
   notificationService.notify(
     'newIterations',
     'New Commits',
     `New push detected on PR #${prId}`
   );
   ```

### 5. Settings UI (settings-view.ts)

Add a "Notifications" section after the existing Polling section:

```
[ ] Enable Windows notifications          ← master toggle
    [ ] AI PR Review completed            ← disabled when master is off
    [ ] AI Comment Analysis completed
    [ ] New comments detected
    [ ] New iterations detected
```

Settings loaded/saved via `notificationService.updateSettings()` and persisted to `tauri-plugin-store`.

## Files Changed

| File | Change |
|---|---|
| `src-tauri/Cargo.toml` | Add `tauri-plugin-notification = "2"` |
| `src-tauri/src/lib.rs` | Register notification plugin |
| `src-tauri/capabilities/default.json` | Add `notification:default` permission |
| `package.json` | Add `@tauri-apps/plugin-notification` |
| `src/renderer/services/notification-service.ts` | **New** — NotificationService class |
| `src/renderer/app.ts` | Wire notify calls at 4 event handlers |
| `src/renderer/components/settings-view.ts` | Add Notifications settings section |
| `src/shared/terminal-types.ts` | Add `NotificationSettings` interface |
