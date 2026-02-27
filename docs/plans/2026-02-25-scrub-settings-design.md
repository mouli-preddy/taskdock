# Scrub Pattern Settings Design

**Date:** 2026-02-25
**Status:** Approved

## Problem

Scrub patterns are currently hardcoded (GUID only) in `ScrubLayer.createDefault()`. Users need to configure which patterns are active, add custom regex patterns, and test them against sample data before committing.

## Solution

A dedicated "Privacy" tab in Settings with a pattern management table, add form, and regex tester. Patterns are persisted in `store.json` and loaded by the ScrubLayer at runtime.

## UI: New "Privacy" Tab

Fifth tab in settings (after Services). Three sections:

### 1. Pattern Table

| Enabled | Name | Letter | Regex | Actions |
|---------|------|--------|-------|---------|
| [x] | GUID | g | `[0-9a-fA-F]{8}-...` | (locked) |
| [x] | Email | e | `[\w.+-]+@[\w-]+\.[\w.]+` | (locked) |
| [ ] | IPv4 | i | `\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b` | (locked) |
| [x] | Custom | x | `my-pattern` | [Delete] |

- Default patterns can be toggled on/off but not deleted
- Custom patterns can be toggled and deleted
- Letter column is read-only after creation

### 2. Add Pattern Form

Inline form below the table:
- Name (text input)
- Letter (single char input, validated)
- Regex (text input)
- [Add] button

Validation: letter must be unique lowercase a-z, regex must be valid, name must be non-empty.

### 3. Regex Tester

A panel where users paste sample text and see results:
- Textarea for sample input
- Results area showing:
  - Highlighted matches with pattern name labels
  - The scrubbed output (sample text with tokens replacing matches)
- Uses only enabled patterns for testing

## Default Patterns

| Name | Letter | Regex | Description |
|------|--------|-------|-------------|
| GUID | `g` | `[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}` | Standard UUID |
| Email | `e` | `[\w.+-]+@[\w-]+\.[\w.]+` | Email addresses |
| IPv4 | `i` | `\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b` | IP v4 addresses |
| Tenant ID | `t` | `[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}` | Tenant identifiers (same regex as GUID, separate token namespace) |
| SIP URI | `s` | `sip:[\w.+-]+@[\w.-]+` | SIP addresses |

All defaults ship enabled except IPv4 (disabled by default — too noisy in some log contexts).

## Storage

Under `store.json` at key `scrubPatterns`:

```json
{
  "scrubPatterns": [
    { "name": "GUID", "letter": "g", "regex": "[0-9a-fA-F]{8}-...", "enabled": true, "isDefault": true },
    { "name": "Email", "letter": "e", "regex": "[\\w.+-]+@[\\w-]+\\.[\\w.]+", "enabled": true, "isDefault": true },
    { "name": "IPv4", "letter": "i", "regex": "\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b", "enabled": false, "isDefault": true },
    { "name": "Tenant ID", "letter": "t", "regex": "[0-9a-fA-F]{8}-...", "enabled": true, "isDefault": true },
    { "name": "SIP URI", "letter": "s", "regex": "sip:[\\w.+-]+@[\\w.-]+", "enabled": true, "isDefault": true },
    { "name": "Custom", "letter": "x", "regex": "user-defined", "enabled": true, "isDefault": false }
  ]
}
```

Top-level key (not nested under `consoleReview`) since scrubbing is cross-cutting across DGrep, CFV, and incidents.

## Integration with ScrubLayer

### New: `ScrubLayer.fromSettings(patterns)`

Replace `ScrubLayer.createDefault()` with a factory that reads the persisted settings:

```typescript
static fromSettings(patterns: ScrubPatternSetting[]): ScrubLayer {
  const layer = new ScrubLayer();
  for (const p of patterns) {
    if (p.enabled) {
      layer.addPattern(p.name, p.letter, new RegExp(p.regex));
    }
  }
  return layer;
}
```

### Loading Flow

1. Bridge reads `scrubPatterns` from `store.json` at startup
2. Passes patterns to `DGrepAIService.setScrubPatterns(patterns)`
3. When creating a ScrubLayer, uses `ScrubLayer.fromSettings(patterns)` instead of `createDefault()`
4. Same for CFV converter — receives patterns via function parameter

### Default Initialization

If `scrubPatterns` key is missing from `store.json`, the defaults are written on first load:

```typescript
const DEFAULT_SCRUB_PATTERNS: ScrubPatternSetting[] = [
  { name: 'GUID', letter: 'g', regex: '...', enabled: true, isDefault: true },
  { name: 'Email', letter: 'e', regex: '...', enabled: true, isDefault: true },
  { name: 'IPv4', letter: 'i', regex: '...', enabled: false, isDefault: true },
  { name: 'Tenant ID', letter: 't', regex: '...', enabled: true, isDefault: true },
  { name: 'SIP URI', letter: 's', regex: '...', enabled: true, isDefault: true },
];
```

## Scope

- Settings UI: New Privacy tab with pattern table, add form, regex tester
- Storage: New `scrubPatterns` key in `store.json`
- Rust: New Tauri commands `get_scrub_patterns` / `set_scrub_patterns`
- Shared types: `ScrubPatternSetting` interface
- ScrubLayer: New `fromSettings()` factory, update all `createDefault()` call sites
- Bridge: Load and pass patterns to services
