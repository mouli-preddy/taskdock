# Scrub Pattern Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Privacy" settings tab where users configure scrub patterns (regex rules for tokenizing sensitive data), with defaults for GUID/Email/IP/TenantID/SIP, and a regex tester.

**Architecture:** New `ScrubPatternSetting` shared type flows through: Rust Tauri storage (`store.json`) → Bridge startup → `DGrepAIService.setScrubPatterns()` → `ScrubLayer.fromSettings()`. UI is a new tab in `settings-view.ts` with pattern table + regex tester.

**Tech Stack:** TypeScript (shared types, renderer, backend), Rust (Tauri storage commands)

**Design doc:** `docs/plans/2026-02-25-scrub-settings-design.md`

---

### Task 1: Add Shared Types for ScrubPatternSetting

**Files:**
- Modify: `src/shared/terminal-types.ts`

**Step 1: Add the ScrubPatternSetting interface and defaults**

After the existing `ConsoleReviewSettings` interface (line ~83), add:

```typescript
// ==================== Scrub Pattern Settings ====================

export interface ScrubPatternSetting {
  name: string;
  letter: string;
  regex: string;
  enabled: boolean;
  isDefault: boolean;
}

export const DEFAULT_SCRUB_PATTERNS: ScrubPatternSetting[] = [
  { name: 'GUID', letter: 'g', regex: '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', enabled: true, isDefault: true },
  { name: 'Email', letter: 'e', regex: '[\\w.+-]+@[\\w-]+\\.[\\w.]+', enabled: true, isDefault: true },
  { name: 'IPv4', letter: 'i', regex: '\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b', enabled: false, isDefault: true },
  { name: 'Tenant ID', letter: 't', regex: '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', enabled: true, isDefault: true },
  { name: 'SIP URI', letter: 's', regex: 'sip:[\\w.+-]+@[\\w.-]+', enabled: true, isDefault: true },
];
```

**Step 2: Commit**

```bash
git add src/shared/terminal-types.ts
git commit -m "feat(scrub): add ScrubPatternSetting shared types and defaults"
```

---

### Task 2: Add Rust Storage Commands

**Files:**
- Modify: `src-tauri/src/commands/storage.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Add ScrubPatternSetting Rust struct and commands**

In `storage.rs`, after the `ServiceEntry` struct and commands (line ~365), add:

```rust
// ==================== Scrub Pattern Settings ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScrubPatternSetting {
    pub name: String,
    pub letter: String,
    pub regex: String,
    pub enabled: bool,
    pub is_default: bool,
}

fn default_scrub_patterns() -> Vec<ScrubPatternSetting> {
    vec![
        ScrubPatternSetting { name: "GUID".into(), letter: "g".into(), regex: r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}".into(), enabled: true, is_default: true },
        ScrubPatternSetting { name: "Email".into(), letter: "e".into(), regex: r"[\w.+-]+@[\w-]+\.[\w.]+".into(), enabled: true, is_default: true },
        ScrubPatternSetting { name: "IPv4".into(), letter: "i".into(), regex: r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b".into(), enabled: false, is_default: true },
        ScrubPatternSetting { name: "Tenant ID".into(), letter: "t".into(), regex: r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}".into(), enabled: true, is_default: true },
        ScrubPatternSetting { name: "SIP URI".into(), letter: "s".into(), regex: r"sip:[\w.+-]+@[\w.-]+".into(), enabled: true, is_default: true },
    ]
}

#[tauri::command]
pub fn get_scrub_patterns() -> Result<Vec<ScrubPatternSetting>, String> {
    let data = load_store_data()?;
    let patterns_value = get_nested_value(&data, "scrubPatterns");

    match patterns_value {
        Some(val) => {
            let patterns: Vec<ScrubPatternSetting> = serde_json::from_value(val)
                .map_err(|e| format!("Failed to parse scrub patterns: {}", e))?;
            Ok(patterns)
        }
        None => Ok(default_scrub_patterns()),
    }
}

#[tauri::command]
pub fn set_scrub_patterns(patterns: Vec<ScrubPatternSetting>) -> Result<(), String> {
    let mut data = load_store_data()?;
    let patterns_value = serde_json::to_value(patterns)
        .map_err(|e| format!("Failed to serialize scrub patterns: {}", e))?;
    set_nested_value(&mut data, "scrubPatterns", patterns_value)?;
    save_store_data(&data)?;
    Ok(())
}
```

**Step 2: Register commands in lib.rs**

In `src-tauri/src/lib.rs`, add to the `generate_handler!` macro (after `set_services`, line ~169):

```rust
commands::storage::get_scrub_patterns,
commands::storage::set_scrub_patterns,
```

**Step 3: Build the Rust project to verify**

Run: `cd src-tauri && cargo check`

**Step 4: Commit**

```bash
git add src-tauri/src/commands/storage.rs src-tauri/src/lib.rs
git commit -m "feat(scrub): add Rust storage commands for scrub patterns"
```

---

### Task 3: Add Tauri API and Type Declarations

**Files:**
- Modify: `src/renderer/tauri-api.ts`
- Modify: `src/renderer/api.d.ts`

**Step 1: Add API functions in tauri-api.ts**

After the `setServices` function (line ~511), add:

```typescript
  // Scrub Patterns
  getScrubPatterns: async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_scrub_patterns');
  },
  setScrubPatterns: async (patterns: any) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('set_scrub_patterns', { patterns });
  },
```

**Step 2: Add type declarations in api.d.ts**

After the `setServices` declaration (line ~380), add:

```typescript
  // Scrub Patterns
  getScrubPatterns: () => Promise<{
    name: string;
    letter: string;
    regex: string;
    enabled: boolean;
    isDefault: boolean;
  }[]>;
  setScrubPatterns: (patterns: {
    name: string;
    letter: string;
    regex: string;
    enabled: boolean;
    isDefault: boolean;
  }[]) => Promise<void>;
```

**Step 3: Commit**

```bash
git add src/renderer/tauri-api.ts src/renderer/api.d.ts
git commit -m "feat(scrub): add Tauri API and type declarations for scrub patterns"
```

---

### Task 4: Add ScrubLayer.fromSettings() Factory

**Files:**
- Modify: `src/main/dgrep/scrub-layer.ts`

**Step 1: Add the fromSettings static method**

After the `createDefault()` method (line ~188), add:

```typescript
  /** Create a ScrubLayer from user-configured pattern settings. Only adds enabled patterns. */
  static fromSettings(patterns: Array<{ name: string; letter: string; regex: string; enabled: boolean }>): ScrubLayer {
    const layer = new ScrubLayer();
    for (const p of patterns) {
      if (p.enabled) {
        try {
          layer.addPattern(p.name, p.letter, new RegExp(p.regex));
        } catch {
          // Skip invalid patterns (bad regex or duplicate letter)
        }
      }
    }
    // Fallback: if no patterns were added (all disabled or all invalid), add GUID default
    if (layer.patterns.length === 0) {
      layer.addPattern('GUID', 'g', /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
    }
    return layer;
  }
```

Also update `load()` to accept optional settings for creating from settings instead of defaults when no file exists. Change the `load` method's fallback (around line ~155):

```typescript
  /** Load token map from a workspace directory. Optionally accepts pattern settings for initialization. */
  static load(workspacePath: string, settings?: Array<{ name: string; letter: string; regex: string; enabled: boolean }>): ScrubLayer {
    const layer = new ScrubLayer();
    const filePath = path.join(workspacePath, TOKEN_MAP_FILENAME);
    if (!fs.existsSync(filePath)) {
      if (settings) return ScrubLayer.fromSettings(settings);
      layer.addPattern('GUID', 'g', /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
      return layer;
    }
    // ... rest of load unchanged
```

**Step 2: Commit**

```bash
git add src/main/dgrep/scrub-layer.ts
git commit -m "feat(scrub): add ScrubLayer.fromSettings() factory method"
```

---

### Task 5: Wire Settings Through Bridge and DGrep AI Service

**Files:**
- Modify: `src-backend/bridge.ts`
- Modify: `src/main/dgrep/dgrep-ai-service.ts`
- Modify: `src/main/dgrep/dgrep-analysis-workspace.ts`

**Step 1: Add scrub patterns loading and setter on DGrepAIService**

In `dgrep-ai-service.ts`, add a new field and setter (after `setSourceRepo`, around line ~192):

```typescript
  private scrubPatternSettings: Array<{ name: string; letter: string; regex: string; enabled: boolean }> | null = null;

  setScrubPatterns(patterns: Array<{ name: string; letter: string; regex: string; enabled: boolean }>): void {
    this.scrubPatternSettings = patterns;
  }
```

**Step 2: Replace `ScrubLayer.createDefault()` calls with `ScrubLayer.fromSettings()`**

In `dgrep-ai-service.ts`, everywhere `ScrubLayer.createDefault()` is used as a fallback (3 locations — lines ~1279, ~1370, ~1752), change to:

```typescript
const scrubLayer = this.scrubLayers.get(chatSessionId) ?? (this.scrubPatternSettings ? ScrubLayer.fromSettings(this.scrubPatternSettings) : ScrubLayer.createDefault());
```

**Step 3: Update workspace creation to use settings**

In `dgrep-analysis-workspace.ts`, modify `createAnalysisWorkspace` to accept optional settings parameter:

```typescript
export function createAnalysisWorkspace(
  sessionId: string,
  columns: string[],
  rows: Record<string, any>[],
  _patterns: any[],
  metadata: AnalysisMetadata,
  scrubSettings?: Array<{ name: string; letter: string; regex: string; enabled: boolean }>
): AnalysisWorkspace {
```

And change line ~65 from:
```typescript
const scrubLayer = ScrubLayer.createDefault();
```
to:
```typescript
const scrubLayer = scrubSettings ? ScrubLayer.fromSettings(scrubSettings) : ScrubLayer.createDefault();
```

**Step 4: Pass settings from DGrepAIService when creating workspaces**

In all `createAnalysisWorkspace(...)` calls in `dgrep-ai-service.ts` (summarizeLogs, analyzeRootCause, improveDisplay, initChatSession), add `this.scrubPatternSettings ?? undefined` as the last argument.

**Step 5: Update CFV converter to accept settings**

In `cfv-converter.ts`, modify all three functions to accept optional settings:

```typescript
export async function convertCallFlow(
  data: Record<string, unknown>,
  outputDir: string,
  scrubSettings?: Array<{ name: string; letter: string; regex: string; enabled: boolean }>
): Promise<number> {
  // ...
  const scrubLayer = scrubSettings ? ScrubLayer.fromSettings(scrubSettings) : ScrubLayer.createDefault();
```

Apply same pattern to `convertCallDetails` and `writeMetadata`.

**Step 6: Load settings in bridge.ts at startup**

In `bridge.ts`, after the existing DGrep AI config block (line ~265), add:

```typescript
// Configure scrub patterns from settings
{
  const scrubPatterns = loadStoreData().scrubPatterns;
  if (scrubPatterns) {
    dgrepAIService.setScrubPatterns(scrubPatterns);
  }
}
```

Also reload scrub patterns dynamically in RPC handlers where settings are reloaded (before each analysis operation), similar to how provider is reloaded.

**Step 7: Commit**

```bash
git add src-backend/bridge.ts src/main/dgrep/dgrep-ai-service.ts src/main/dgrep/dgrep-analysis-workspace.ts src/main/cfv/cfv-converter.ts
git commit -m "feat(scrub): wire pattern settings through bridge, AI service, and workspace"
```

---

### Task 6: Add Privacy Tab UI

**Files:**
- Modify: `src/renderer/components/settings-view.ts`

**Step 1: Add the Privacy tab button**

In the tab bar (line ~243), add after the Services tab button:

```html
<button class="settings-tab-btn" data-settings-tab="privacy">Privacy</button>
```

**Step 2: Add the Privacy tab content**

After the Services tab content closing `</div>` (line ~610), add the Privacy tab HTML:

```html
<!-- Privacy Tab -->
<div class="settings-tab-content" data-tab-content="privacy">
  <div class="settings-section full-width">
    <h2 class="settings-section-title">Scrub Patterns</h2>
    <p class="settings-section-description">Configure regex patterns for scrubbing sensitive data before it reaches AI agents. Matched values are replaced with tokens like scrub_g1, scrub_e1.</p>

    <table class="scrub-patterns-table" id="scrubPatternsTable">
      <thead>
        <tr>
          <th style="width: 60px;">Enabled</th>
          <th>Name</th>
          <th style="width: 60px;">Letter</th>
          <th>Regex</th>
          <th style="width: 80px;">Actions</th>
        </tr>
      </thead>
      <tbody id="scrubPatternsBody"></tbody>
    </table>

    <div class="scrub-add-form" style="margin-top: var(--space-4);">
      <h3 class="settings-subsection-title" style="margin: 0; padding: 0; border: none;">Add Pattern</h3>
      <div style="display: flex; gap: var(--space-2); align-items: end;">
        <div class="form-group" style="flex: 1;">
          <label for="scrubPatternName">Name</label>
          <input type="text" id="scrubPatternName" placeholder="e.g., Phone Number">
        </div>
        <div class="form-group" style="width: 80px;">
          <label for="scrubPatternLetter">Letter</label>
          <input type="text" id="scrubPatternLetter" maxlength="1" placeholder="p">
        </div>
        <div class="form-group" style="flex: 2;">
          <label for="scrubPatternRegex">Regex</label>
          <input type="text" id="scrubPatternRegex" placeholder="\\d{3}-\\d{3}-\\d{4}">
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="addScrubPatternBtn">Add</button>
      </div>
      <div id="scrubPatternError" class="error-text" style="display: none;"></div>
    </div>

    <div class="scrub-tester" style="margin-top: var(--space-6);">
      <h3 class="settings-subsection-title" style="margin: 0; padding: 0; border: none;">Regex Tester</h3>
      <p class="settings-section-description">Paste sample text to see which values would be scrubbed.</p>
      <div class="form-group">
        <label for="scrubTesterInput">Sample Text</label>
        <textarea id="scrubTesterInput" rows="4" placeholder="Paste log text with GUIDs, emails, IPs, etc."></textarea>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" id="testScrubBtn">Test Scrub</button>
      <div id="scrubTesterOutput" style="margin-top: var(--space-2); display: none;">
        <label>Scrubbed Output</label>
        <pre id="scrubTesterResult" class="code-block" style="white-space: pre-wrap; max-height: 200px; overflow: auto;"></pre>
        <div id="scrubTesterMatches" style="margin-top: var(--space-2);"></div>
      </div>
    </div>
  </div>
</div>
```

**Step 3: Add scrub pattern state and rendering logic**

Add to the class fields (around line ~28):

```typescript
private scrubPatterns: Array<{ name: string; letter: string; regex: string; enabled: boolean; isDefault: boolean }> = [];
```

Add methods for loading, rendering, and managing patterns:

```typescript
private async loadScrubPatterns(): Promise<void> {
  try {
    this.scrubPatterns = await window.electronAPI.getScrubPatterns();
  } catch {
    this.scrubPatterns = [];
  }
  this.renderScrubPatterns();
}

private renderScrubPatterns(): void {
  const tbody = this.container.querySelector('#scrubPatternsBody');
  if (!tbody) return;
  tbody.innerHTML = this.scrubPatterns.map((p, i) => `
    <tr>
      <td><input type="checkbox" class="scrub-pattern-toggle" data-index="${i}" ${p.enabled ? 'checked' : ''}></td>
      <td>${this.escapeHtml(p.name)}</td>
      <td><code>${this.escapeHtml(p.letter)}</code></td>
      <td><code style="font-size: 0.85em;">${this.escapeHtml(p.regex)}</code></td>
      <td>${p.isDefault ? '<span class="badge">Default</span>' : `<button class="btn btn-danger btn-xs scrub-pattern-delete" data-index="${i}">Delete</button>`}</td>
    </tr>
  `).join('');
}

private escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

**Step 4: Add event handlers**

In `attachEventListeners()` or equivalent, add handlers for:
- Toggle enable/disable (checkbox change)
- Delete custom pattern (delete button click)
- Add new pattern (add button click with validation)
- Test scrub (test button click)

For the regex tester, implement client-side scrubbing by building a combined regex from enabled patterns and replacing matches with tokens.

**Step 5: Call `loadScrubPatterns()` in the constructor**

Add `this.loadScrubPatterns();` in the constructor (line ~47).

**Step 6: Save patterns when changed**

After toggling, adding, or deleting, call:
```typescript
await window.electronAPI.setScrubPatterns(this.scrubPatterns);
```

**Step 7: Commit**

```bash
git add src/renderer/components/settings-view.ts
git commit -m "feat(scrub): add Privacy tab with pattern management and regex tester"
```

---

### Task 7: Build Verification

**Files:**
- No new files. Build and verify.

**Step 1: TypeScript check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: No new errors (only pre-existing `app.ts` errors).

**Step 2: Rust check**

Run: `cd src-tauri && cargo check`
Expected: Clean build.

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(scrub): address build issues from settings integration"
```
