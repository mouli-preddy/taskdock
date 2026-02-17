# Windows Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add native Windows toast notifications for background events (AI review done, analysis done, new comments, new iterations) with configurable per-event toggles in settings.

**Architecture:** Tauri notification plugin handles native Windows toasts from the renderer. A thin `NotificationService` class checks a master toggle + per-event flags before sending. Settings stored via existing Tauri Rust commands (same pattern as PollingSettings). Existing in-app toasts are untouched.

**Tech Stack:** `tauri-plugin-notification` (Rust crate v2), `@tauri-apps/plugin-notification` (npm), TypeScript

---

### Task 1: Add Tauri notification plugin (Rust side)

**Files:**
- Modify: `src-tauri/Cargo.toml:30` (add dependency after `tauri-plugin-deep-link`)
- Modify: `src-tauri/src/lib.rs:154` (register plugin after `tauri_plugin_process::init()`)
- Modify: `src-tauri/capabilities/default.json:14` (add permission after `deep-link:default`)

**Step 1: Add Rust crate dependency**

In `src-tauri/Cargo.toml`, add after line 29 (`tauri-plugin-deep-link = "2"`):

```toml
tauri-plugin-notification = "2"
```

**Step 2: Register plugin in lib.rs**

In `src-tauri/src/lib.rs`, add after line 154 (`.plugin(tauri_plugin_process::init())`):

```rust
.plugin(tauri_plugin_notification::init())
```

**Step 3: Add capability permission**

In `src-tauri/capabilities/default.json`, add `"notification:default"` to the permissions array after `"deep-link:default"`:

```json
"deep-link:default",
"notification:default"
```

**Step 4: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors

**Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat(notifications): add tauri-plugin-notification to Rust side"
```

---

### Task 2: Add notification settings storage (Rust + TypeScript types)

**Files:**
- Modify: `src-tauri/src/commands/storage.rs:68-71` (add struct after PollingSettings)
- Modify: `src-tauri/src/commands/storage.rs:294` (add get/set commands after set_polling_settings)
- Modify: `src-tauri/src/commands/mod.rs` (make new commands public)
- Modify: `src-tauri/src/lib.rs:164` (add to invoke_handler)
- Modify: `src/shared/types.ts:207` (add interface and defaults after DEFAULT_POLLING_SETTINGS)
- Modify: `src/renderer/api.d.ts:340` (add API methods after setPollingSettings)
- Modify: `src/renderer/tauri-api.ts:488` (add API bindings after setPollingSettings)

**Step 1: Add Rust struct for NotificationSettings**

In `src-tauri/src/commands/storage.rs`, add after the `PollingSettings` struct (after line 71):

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSettings {
    pub enabled: bool,
    pub ai_review_complete: bool,
    pub ai_analysis_complete: bool,
    pub new_comments: bool,
    pub new_iterations: bool,
}
```

**Step 2: Add get/set Tauri commands**

In `src-tauri/src/commands/storage.rs`, add after the `set_polling_settings` function (after line 294):

```rust
#[tauri::command]
pub fn get_notification_settings() -> Result<NotificationSettings, String> {
    let data = load_store_data()?;
    let settings_value = get_nested_value(&data, "notifications")
        .ok_or("Notification settings not found")?;

    let settings: NotificationSettings = serde_json::from_value(settings_value)
        .map_err(|e| format!("Failed to parse notification settings: {}", e))?;

    Ok(settings)
}

#[tauri::command]
pub fn set_notification_settings(settings: NotificationSettings) -> Result<(), String> {
    let mut data = load_store_data()?;
    let settings_value = serde_json::to_value(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    set_nested_value(&mut data, "notifications", settings_value)?;
    save_store_data(&data)?;
    Ok(())
}
```

**Step 3: Register commands in invoke_handler**

In `src-tauri/src/lib.rs`, add to the `invoke_handler` list (after `commands::storage::set_polling_settings,` at line 164):

```rust
commands::storage::get_notification_settings,
commands::storage::set_notification_settings,
```

**Step 4: Add TypeScript interface**

In `src/shared/types.ts`, add after `DEFAULT_POLLING_SETTINGS` (after line 207):

```typescript
// Notification settings for native Windows toast notifications
export interface NotificationSettings {
  enabled: boolean;
  aiReviewComplete: boolean;
  aiAnalysisComplete: boolean;
  newComments: boolean;
  newIterations: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  aiReviewComplete: true,
  aiAnalysisComplete: true,
  newComments: true,
  newIterations: true,
};
```

**Step 5: Add API type declarations**

In `src/renderer/api.d.ts`, add after the `setPollingSettings` declaration (after line 340):

```typescript
  // Notification settings
  getNotificationSettings: () => Promise<{
    enabled: boolean;
    aiReviewComplete: boolean;
    aiAnalysisComplete: boolean;
    newComments: boolean;
    newIterations: boolean;
  }>;
  setNotificationSettings: (settings: {
    enabled: boolean;
    aiReviewComplete: boolean;
    aiAnalysisComplete: boolean;
    newComments: boolean;
    newIterations: boolean;
  }) => Promise<void>;
```

**Step 6: Add API bindings**

In `src/renderer/tauri-api.ts`, add after the `setPollingSettings` binding (after line 488):

```typescript
  // Notification settings
  getNotificationSettings: async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_notification_settings');
  },
  setNotificationSettings: async (settings: any) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('set_notification_settings', { settings });
  },
```

**Step 7: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors

**Step 8: Commit**

```bash
git add src-tauri/src/commands/storage.rs src-tauri/src/lib.rs src/shared/types.ts src/renderer/api.d.ts src/renderer/tauri-api.ts
git commit -m "feat(notifications): add notification settings storage and API"
```

---

### Task 3: Install npm package and create NotificationService

**Files:**
- Modify: `package.json` (add `@tauri-apps/plugin-notification` dependency)
- Create: `src/renderer/services/notification-service.ts`

**Step 1: Install npm package**

```bash
npm install @tauri-apps/plugin-notification
```

**Step 2: Create NotificationService**

Create `src/renderer/services/notification-service.ts`:

```typescript
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import type { NotificationSettings } from '../../shared/types.js';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../../shared/types.js';

export type NotificationEvent =
  | 'aiReviewComplete'
  | 'aiAnalysisComplete'
  | 'newComments'
  | 'newIterations';

class NotificationService {
  private settings: NotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS };
  private permissionGranted: boolean | null = null;

  updateSettings(settings: NotificationSettings): void {
    this.settings = settings;
  }

  getSettings(): NotificationSettings {
    return { ...this.settings };
  }

  async notify(event: NotificationEvent, title: string, body: string): Promise<void> {
    if (!this.settings.enabled) return;
    if (!this.settings[event]) return;

    // Cache permission check to avoid repeated calls
    if (this.permissionGranted === null) {
      this.permissionGranted = await isPermissionGranted();
      if (!this.permissionGranted) {
        const result = await requestPermission();
        this.permissionGranted = result === 'granted';
      }
    }

    if (!this.permissionGranted) return;

    sendNotification({ title, body });
  }

  async loadSettings(): Promise<void> {
    try {
      this.settings = await window.electronAPI.getNotificationSettings();
    } catch {
      // Settings not yet saved — use defaults
      this.settings = { ...DEFAULT_NOTIFICATION_SETTINGS };
    }
  }
}

export const notificationService = new NotificationService();
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors from notification-service.ts (pre-existing errors in other files are expected)

**Step 4: Commit**

```bash
git add package.json package-lock.json src/renderer/services/notification-service.ts
git commit -m "feat(notifications): create NotificationService with Tauri plugin"
```

---

### Task 4: Wire notifications into app.ts event handlers

**Files:**
- Modify: `src/renderer/app.ts:42` (add import)
- Modify: `src/renderer/app.ts:232` (load settings on init)
- Modify: `src/renderer/app.ts:1017-1019` (AI review complete — add native notification)
- Modify: `src/renderer/app.ts:2916` (analysis complete — add native notification)
- Modify: `src/renderer/app.ts:2235-2237` (poll result: new version — add native notification)
- Modify: `src/renderer/app.ts:2241-2278` (poll result: comment changes — add native notification)

**Step 1: Add import**

In `src/renderer/app.ts`, add after the existing imports (around line 57, after the `initDeepLinkHandler` import):

```typescript
import { notificationService } from './services/notification-service.js';
```

**Step 2: Load notification settings on startup**

In `src/renderer/app.ts`, in the constructor, add after `this.initPlugins();` (line 232):

```typescript
    // Load notification settings
    notificationService.loadSettings();
```

**Step 3: Add native notification for AI review complete**

In `src/renderer/app.ts`, inside the `if (settings.showNotification)` block (around line 1017-1020), add the native notification call after the Toast:

```typescript
    if (settings.showNotification) {
      const commentCount = aiComments.length;
      Toast.success(`Deep review completed: ${commentCount} comment${commentCount !== 1 ? 's' : ''} found`);
      notificationService.notify(
        'aiReviewComplete',
        'PR Review Complete',
        `${commentCount} comment${commentCount !== 1 ? 's' : ''} found on PR #${state.prId}`
      );
    }
```

**Step 4: Add native notification for analysis complete**

In `src/renderer/app.ts`, after the `Toast.success('Analysis complete');` line (line 2916), add:

```typescript
      Toast.success('Analysis complete');
      notificationService.notify(
        'aiAnalysisComplete',
        'Comment Analysis Complete',
        `${threads.length} comment${threads.length !== 1 ? 's' : ''} analyzed on PR #${state.prId}`
      );
```

**Step 5: Add native notification for new iterations (versions)**

In `src/renderer/app.ts`, inside `handlePollResult`, after `this.showNewVersionBanner(tabId);` (line 2237), add:

```typescript
    if (result.hasNewVersion) {
      state.hasNewVersion = true;
      this.showNewVersionBanner(tabId);
      notificationService.notify(
        'newIterations',
        'New Commits',
        `New push detected on PR #${state.prId}`
      );
    }
```

**Step 6: Add native notification for new comments**

In `src/renderer/app.ts`, inside `handlePollResult`, after the comment changes log line (line 2278), add the notification:

```typescript
      console.log(`[App] Comments updated for tab ${tabId}: ${result.updatedThreads.length} threads`);
      notificationService.notify(
        'newComments',
        'New Comments',
        `Comments updated on PR #${state.prId}`
      );
```

**Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors from the notification additions

**Step 8: Commit**

```bash
git add src/renderer/app.ts
git commit -m "feat(notifications): wire native notifications into event handlers"
```

---

### Task 5: Add notification settings UI

**Files:**
- Modify: `src/renderer/components/settings-view.ts:2` (add import)
- Modify: `src/renderer/components/settings-view.ts:19` (add state field)
- Modify: `src/renderer/components/settings-view.ts:23` (add callback field)
- Modify: `src/renderer/components/settings-view.ts:29` (load settings on init)
- Modify: `src/renderer/components/settings-view.ts:415-416` (add HTML section before plugins)
- Modify: `src/renderer/components/settings-view.ts:526` (gather and save in handleSaveAll)
- Modify: `src/renderer/components/settings-view.ts:150-152` (add callback setter)
- Modify: `src/renderer/components/settings-view.ts:877` (add load/update methods at end of class)

**Step 1: Add imports**

In `src/renderer/components/settings-view.ts`, add to the existing imports from `../../shared/types.js` (line 4-5):

```typescript
import type { PollingSettings, NotificationSettings } from '../../shared/types.js';
import { DEFAULT_POLLING_SETTINGS, DEFAULT_NOTIFICATION_SETTINGS } from '../../shared/types.js';
```

**Step 2: Add state and callback fields**

In the class, add after `private pollingSettings` (line 19):

```typescript
  private notificationSettings: NotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS };
```

Add after `private pollingSettingsSavedCallback` (line 23):

```typescript
  private notificationSettingsSavedCallback: ((settings: NotificationSettings) => void) | null = null;
```

**Step 3: Load notification settings in constructor**

In the constructor, add after `this.loadPollingSettings();` (line 29):

```typescript
    this.loadNotificationSettings();
```

**Step 4: Add callback setter method**

After `onPollingSettingsSaved` method (around line 150-152), add:

```typescript
  onNotificationSettingsSaved(callback: (settings: NotificationSettings) => void) {
    this.notificationSettingsSavedCallback = callback;
  }
```

**Step 5: Add HTML section**

In the `render()` method, add the Notifications section HTML before the Plugins section (before line 418 `<div class="settings-section" id="pluginSettingsSection">`):

```html
          <div class="settings-section">
            <h2 class="settings-section-title">Notifications</h2>
            <p class="settings-section-description">Configure native Windows toast notifications for background events.</p>

            <div class="form-group checkbox-group">
              <label>
                <input type="checkbox" id="notificationsEnabled" checked>
                <span>Enable Windows notifications</span>
              </label>
            </div>

            <div id="notificationEventToggles" class="form-group" style="margin-left: 24px;">
              <div class="checkbox-group">
                <label>
                  <input type="checkbox" id="notifyAiReviewComplete" checked>
                  <span>AI PR Review completed</span>
                </label>
              </div>
              <div class="checkbox-group">
                <label>
                  <input type="checkbox" id="notifyAiAnalysisComplete" checked>
                  <span>AI Comment Analysis completed</span>
                </label>
              </div>
              <div class="checkbox-group">
                <label>
                  <input type="checkbox" id="notifyNewComments" checked>
                  <span>New comments detected</span>
                </label>
              </div>
              <div class="checkbox-group">
                <label>
                  <input type="checkbox" id="notifyNewIterations" checked>
                  <span>New iterations (commits) detected</span>
                </label>
              </div>
            </div>
          </div>
```

**Step 6: Add master toggle behavior in attachEventListeners**

In the `attachEventListeners()` method, add at the end (before the closing `}`):

```typescript
    // Notification master toggle
    const notificationsEnabled = this.container.querySelector('#notificationsEnabled') as HTMLInputElement;
    notificationsEnabled?.addEventListener('change', () => {
      const toggles = this.container.querySelector('#notificationEventToggles') as HTMLElement;
      if (toggles) {
        toggles.style.opacity = notificationsEnabled.checked ? '1' : '0.5';
        toggles.querySelectorAll('input[type="checkbox"]').forEach(cb => {
          (cb as HTMLInputElement).disabled = !notificationsEnabled.checked;
        });
      }
    });
```

**Step 7: Gather and save notification settings in handleSaveAll**

In the `handleSaveAll()` method, add after the polling settings save block (after `this.pollingSettingsSavedCallback?.(this.pollingSettings);` around line 559):

```typescript
      // Update and save Notification settings
      this.notificationSettings = {
        enabled: (this.container.querySelector('#notificationsEnabled') as HTMLInputElement).checked,
        aiReviewComplete: (this.container.querySelector('#notifyAiReviewComplete') as HTMLInputElement).checked,
        aiAnalysisComplete: (this.container.querySelector('#notifyAiAnalysisComplete') as HTMLInputElement).checked,
        newComments: (this.container.querySelector('#notifyNewComments') as HTMLInputElement).checked,
        newIterations: (this.container.querySelector('#notifyNewIterations') as HTMLInputElement).checked,
      };
      await window.electronAPI.setNotificationSettings(this.notificationSettings);
      this.notificationSettingsSavedCallback?.(this.notificationSettings);
```

**Step 8: Add load and update methods at end of class**

At the end of the class (before `}`), add after `updatePollingFormValues`:

```typescript
  // Notification Settings Methods

  private async loadNotificationSettings(): Promise<void> {
    try {
      this.notificationSettings = await window.electronAPI.getNotificationSettings();
      this.updateNotificationFormValues();
    } catch (error) {
      console.error('Failed to load notification settings:', error);
    }
  }

  private updateNotificationFormValues(): void {
    const enabled = this.container.querySelector('#notificationsEnabled') as HTMLInputElement;
    const aiReview = this.container.querySelector('#notifyAiReviewComplete') as HTMLInputElement;
    const aiAnalysis = this.container.querySelector('#notifyAiAnalysisComplete') as HTMLInputElement;
    const newComments = this.container.querySelector('#notifyNewComments') as HTMLInputElement;
    const newIterations = this.container.querySelector('#notifyNewIterations') as HTMLInputElement;

    if (enabled) enabled.checked = this.notificationSettings.enabled;
    if (aiReview) aiReview.checked = this.notificationSettings.aiReviewComplete;
    if (aiAnalysis) aiAnalysis.checked = this.notificationSettings.aiAnalysisComplete;
    if (newComments) newComments.checked = this.notificationSettings.newComments;
    if (newIterations) newIterations.checked = this.notificationSettings.newIterations;

    // Set initial disabled state
    const toggles = this.container.querySelector('#notificationEventToggles') as HTMLElement;
    if (toggles && !this.notificationSettings.enabled) {
      toggles.style.opacity = '0.5';
      toggles.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        (cb as HTMLInputElement).disabled = true;
      });
    }
  }
```

**Step 9: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

**Step 10: Commit**

```bash
git add src/renderer/components/settings-view.ts
git commit -m "feat(notifications): add notification settings UI section"
```

---

### Task 6: Wire settings save callback to NotificationService in app.ts

**Files:**
- Modify: `src/renderer/app.ts` (where SettingsView callbacks are wired)

**Step 1: Find where settings callbacks are connected**

Search for `onConsoleSettingsSaved` or `onPollingSettingsSaved` in app.ts to find where to add the notification callback.

**Step 2: Add notification settings callback**

After the existing `settingsView.onPollingSettingsSaved(...)` call, add:

```typescript
    this.settingsView.onNotificationSettingsSaved((settings) => {
      notificationService.updateSettings(settings);
    });
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

**Step 4: Commit**

```bash
git add src/renderer/app.ts
git commit -m "feat(notifications): wire settings save to NotificationService"
```

---

### Task 7: Manual smoke test

**Step 1: Start the dev server**

Run: `npm run dev`

**Step 2: Verify settings UI**

1. Open Settings section
2. Scroll to "Notifications" section
3. Verify master toggle and 4 sub-checkboxes render
4. Toggle master off → sub-checkboxes should grey out / disable
5. Save settings → no errors

**Step 3: Verify notification fires**

1. Open a PR tab
2. Start an AI review
3. When review completes, verify both:
   - In-app toast appears (existing behavior)
   - Windows notification appears in system tray / Action Center

**Step 4: Verify toggle works**

1. Go to Settings, uncheck "AI PR Review completed"
2. Save
3. Run another AI review
4. In-app toast should appear but NO Windows notification

**Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(notifications): smoke test fixes"
```
