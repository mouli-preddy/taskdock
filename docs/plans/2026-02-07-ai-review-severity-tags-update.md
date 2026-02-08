# AI Review Severity & Category Update

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace AI review severity levels (critical/warning/suggestion/praise → critical/major/minor/trivial), expand categories with compliance/recommendation/nitpick, remove "praise" comments, update LLM prompt for subagent-based review strategy, and skip generated files entirely.

**Architecture:** Update the shared type definitions, then propagate changes to all 6 executor files, 3 provider files, the review prompt builder, the diff-viewer badge rendering, the AI comments panel UI, app.ts formatting, api.d.ts type declarations, and CSS styling.

**Tech Stack:** TypeScript, vanilla DOM rendering, CSS

---

### Task 1: Update shared type definitions

**Files:**
- Modify: `src/shared/ai-types.ts`

**Step 1: Update severity type on AIReviewComment**

Change line 14:
```ts
severity: 'critical' | 'major' | 'minor' | 'trivial';
```

**Step 2: Update category type on AIReviewComment**

Change line 15:
```ts
category: 'bug' | 'security' | 'performance' | 'style' | 'logic' | 'compliance' | 'recommendation' | 'nitpick' | 'other';
```

**Step 3: Update SEVERITY_CONFIG**

Replace the entire `SEVERITY_CONFIG` object (lines 385-410):
```ts
export const SEVERITY_CONFIG = {
  critical: {
    color: '#d13438',
    bgColor: '#d1343820',
    icon: 'alert-circle',
    label: 'Critical',
  },
  major: {
    color: '#ffaa44',
    bgColor: '#ffaa4420',
    icon: 'alert-triangle',
    label: 'Major',
  },
  minor: {
    color: '#0078d4',
    bgColor: '#0078d420',
    icon: 'lightbulb',
    label: 'Minor',
  },
  trivial: {
    color: '#888888',
    bgColor: '#88888820',
    icon: 'info',
    label: 'Trivial',
  },
} as const;
```

**Step 4: Update CATEGORY_LABELS**

Replace the entire `CATEGORY_LABELS` object (lines 413-420):
```ts
export const CATEGORY_LABELS: Record<AIReviewComment['category'], string> = {
  bug: 'Bug',
  security: 'Security',
  performance: 'Performance',
  style: 'Style',
  logic: 'Logic',
  compliance: 'Compliance',
  recommendation: 'Recommendation',
  nitpick: 'Nitpick',
  other: 'Other',
};
```

**Step 5: Commit**

```bash
git add src/shared/ai-types.ts
git commit -m "refactor(ai-review): update severity levels and add new categories"
```

---

### Task 2: Update all executor default fallbacks

All 6 executor files have a default severity fallback of `'suggestion'` — change to `'minor'`.

**Files:**
- Modify: `src/main/ai/executors/claude-sdk-executor.ts` (line 277)
- Modify: `src/main/ai/executors/claude-terminal-executor.ts` (line 319)
- Modify: `src/main/ai/executors/claude-headless-executor.ts` (line 396)
- Modify: `src/main/ai/executors/copilot-sdk-executor.ts` (line 290)
- Modify: `src/main/ai/executors/copilot-terminal-executor.ts` (line 293)
- Modify: `src/main/ai/executors/copilot-headless-executor.ts` (line 404)

**Step 1: In each file, change:**
```ts
severity: c.severity || 'suggestion',
```
to:
```ts
severity: c.severity || 'minor',
```

**Step 2: Commit**

```bash
git add src/main/ai/executors/
git commit -m "refactor(ai-review): update executor severity fallback to 'minor'"
```

---

### Task 3: Update provider files

**Files:**
- Modify: `src/main/ai/ai-provider.ts`
- Modify: `src/main/ai/claude-provider.ts`
- Modify: `src/main/ai/copilot-provider.ts`

**Step 1: Update ai-provider.ts**

Line 71 — change severity enum in prompt/schema:
```
"severity": "critical|major|minor|trivial",
```

Line 72 — change category enum:
```
"category": "bug|security|performance|style|logic|compliance|recommendation|nitpick|other",
```

Line 87 — remove the praise instruction line (`- Use "praise" for well-written code`).

Lines 134-139 — update the severity enum in the JSON schema:
```ts
severity: {
  type: 'string',
  enum: ['critical', 'major', 'minor', 'trivial'],
},
```

Line 150 — change description from `'Detailed explanation of the issue or praise'` to `'Detailed explanation of the issue'`.

**Step 2: Update claude-provider.ts**

Line 206 — update the inline prompt severity/category values:
```
severity (critical/major/minor/trivial), category (bug/security/performance/style/logic/compliance/recommendation/nitpick/other)
```

Lines 273-274 — change default fallback:
```ts
severity: input.severity || 'minor',
```

Lines 306-307 — change default fallback:
```ts
severity: c.severity || 'minor',
```

**Step 3: Update copilot-provider.ts**

Lines 236-237 — update severity and category enums in the prompt:
```
"severity": "critical|major|minor|trivial",
"category": "bug|security|performance|style|logic|compliance|recommendation|nitpick|other",
```

Lines 341-342 — change default fallback:
```ts
severity: c.severity || 'minor',
```

**Step 4: Commit**

```bash
git add src/main/ai/ai-provider.ts src/main/ai/claude-provider.ts src/main/ai/copilot-provider.ts
git commit -m "refactor(ai-review): update provider severity/category enums and defaults"
```

---

### Task 4: Update review prompt builder

**Files:**
- Modify: `src/main/terminal/review-prompt.ts`

**Step 1: Update Review Criteria section (around line 194-200)**

Replace with:
```
## Review Criteria
Evaluate each change for:
- **Security**: Injection vulnerabilities, authentication issues, data exposure, OWASP top 10
- **Bugs**: Logic errors, null/undefined handling, edge cases, race conditions
- **Performance**: Unnecessary loops, repeated O(N) or O(N^2) operations, N+1 queries, memory leaks, inefficient algorithms
- **Compliance**: User ID or PII being logged, data retention violations, audit trail gaps
- **Code Quality**: Readability, naming conventions, code duplication, SOLID principles
- **Testing**: Missing test coverage for new or changed code paths
```

**Step 2: Update review strategy — add subagent instructions after the task section (after line 172)**

After the `## Your Task` section, add:
```
## Review Strategy
1. First, read the file list and PR metadata to understand the overall scope and purpose of the changes
2. Then dispatch subagents to review files in depth — group related files together and prioritize high-risk files (files touching auth, data access, configuration)
3. Each subagent should focus on its assigned file(s) and return structured findings
4. After all subagents complete, consolidate findings and remove duplicates
```

**Step 3: Update generated files section (around line 213-221)**

Replace the generated files note with:
```ts
    reviewInstructions += `\n\n## Generated Files — SKIP ENTIRELY
The following file patterns are auto-generated: ${patterns}
Do NOT review these files. Skip them completely during your review. Do not include any comments about generated files.`;
```

**Step 4: Update output format severity/category values (around line 257-258)**

Change:
```
Severity values: "critical" | "major" | "minor" | "trivial"
Category values: "security" | "bug" | "performance" | "style" | "logic" | "compliance" | "recommendation" | "nitpick" | "other"
```

**Step 5: Remove praise rule (line 294)**

Delete or replace line:
```
4. Praise good code patterns, not just problems
```
with:
```
4. Do NOT include praise or "good job" comments — only report issues and actionable suggestions
```

**Step 6: Commit**

```bash
git add src/main/terminal/review-prompt.ts
git commit -m "refactor(ai-review): update prompt with new severities, subagent strategy, skip generated files"
```

---

### Task 5: Update AI comments panel UI

**Files:**
- Modify: `src/renderer/components/ai-comments-panel.ts`

**Step 1: Update filter initialization (line 50)**

Change:
```ts
severity: ['critical', 'major', 'minor', 'trivial'],
```

**Step 2: Update stats bar HTML (lines 348-365)**

Replace the 4 stat divs:
```html
<div class="ai-stat critical" title="Critical issues">
  <span class="ai-stat-count">${stats.critical}</span>
  <span class="ai-stat-label">Critical</span>
</div>
<div class="ai-stat major" title="Major issues">
  <span class="ai-stat-count">${stats.major}</span>
  <span class="ai-stat-label">Major</span>
</div>
<div class="ai-stat minor" title="Minor issues">
  <span class="ai-stat-count">${stats.minor}</span>
  <span class="ai-stat-label">Minor</span>
</div>
<div class="ai-stat trivial" title="Trivial issues">
  <span class="ai-stat-count">${stats.trivial}</span>
  <span class="ai-stat-label">Trivial</span>
</div>
```

**Step 3: Update renderSeverityFilters (line 401)**

Change the severity array:
```ts
return (['critical', 'major', 'minor', 'trivial'] as const)
```

**Step 4: Update getSeverityIcon (line 558)**

Replace icon map:
```ts
const severityIcons = {
  critical: iconHtml(AlertCircle, { size: 14 }),
  major: iconHtml(AlertTriangle, { size: 14 }),
  minor: iconHtml(Lightbulb, { size: 14 }),
  trivial: iconHtml(Lightbulb, { size: 14 }),
};
```

Note: Import `Info` icon if desired for trivial, or reuse `Lightbulb`. Check available icons — if there's an `Info` icon, use it for trivial.

**Step 5: Update getStats (line 567)**

Change stats initialization:
```ts
const stats = { critical: 0, major: 0, minor: 0, trivial: 0 };
```

**Step 6: Commit**

```bash
git add src/renderer/components/ai-comments-panel.ts
git commit -m "refactor(ai-review): update comments panel for new severity levels"
```

---

### Task 6: Update diff-viewer badge colors

**Files:**
- Modify: `src/renderer/components/diff-viewer.ts`

**Step 1: Update severityColors object (around line 793-798)**

Replace:
```ts
const severityColors: Record<string, string> = {
  critical: '#d13438',
  major: '#ffaa44',
  minor: '#0078d4',
  trivial: '#888888'
};
```

**Step 2: Update fallback (line 800)**

Change:
```ts
const color = severityColors[comment.severity] || severityColors.minor;
```

**Step 3: Commit**

```bash
git add src/renderer/components/diff-viewer.ts
git commit -m "refactor(ai-review): update diff-viewer badge colors for new severities"
```

---

### Task 7: Update app.ts ADO formatting

**Files:**
- Modify: `src/renderer/app.ts`

**Step 1: Update severityEmoji map (around line 4181-4186)**

Replace:
```ts
const severityEmoji: Record<string, string> = {
  critical: '🔴',
  major: '🟡',
  minor: '🔵',
  trivial: '⚪',
};
```

**Step 2: Update default severity fallback (line 901)**

Change:
```ts
severity: c.severity || 'minor',
```

**Step 3: Commit**

```bash
git add src/renderer/app.ts
git commit -m "refactor(ai-review): update app.ts severity emoji and default"
```

---

### Task 8: Update api.d.ts type declarations

**Files:**
- Modify: `src/renderer/api.d.ts`

**Step 1: Update severity type (line 222)**

Change:
```ts
severity: 'critical' | 'major' | 'minor' | 'trivial';
```

**Step 2: Update category type (line 223)**

Change:
```ts
category: 'security' | 'bug' | 'performance' | 'style' | 'logic' | 'compliance' | 'recommendation' | 'nitpick' | 'other';
```

**Step 3: Commit**

```bash
git add src/renderer/api.d.ts
git commit -m "refactor(ai-review): update api.d.ts severity and category types"
```

---

### Task 9: Update CSS styles

**Files:**
- Modify: `src/renderer/styles/ai-review.css`

**Step 1: Update comment badge classes (lines 32-48)**

Replace `.ai-comment-badge.warning`, `.suggestion`, `.praise` with:
```css
.ai-comment-badge.major {
  background: #ffaa4420;
  border-color: #ffaa44;
  color: #c88700;
}

.ai-comment-badge.minor {
  background: #0078d420;
  border-color: #0078d4;
  color: #0078d4;
}

.ai-comment-badge.trivial {
  background: #88888820;
  border-color: #888888;
  color: #888888;
}
```

**Step 2: Update stat count colors (lines 294-297)**

Replace:
```css
.ai-stat.critical .ai-stat-count { color: #d13438; }
.ai-stat.major .ai-stat-count { color: #ffaa44; }
.ai-stat.minor .ai-stat-count { color: #0078d4; }
.ai-stat.trivial .ai-stat-count { color: #888888; }
```

**Step 3: Update comment border-left colors (lines 456-459)**

Replace:
```css
.ai-comment.critical { border-left: 3px solid #d13438; }
.ai-comment.major { border-left: 3px solid #ffaa44; }
.ai-comment.minor { border-left: 3px solid #0078d4; }
.ai-comment.trivial { border-left: 3px solid #888888; }
```

**Step 4: Commit**

```bash
git add src/renderer/styles/ai-review.css
git commit -m "refactor(ai-review): update CSS for new severity levels"
```

---

### Task 10: Build verification

**Step 1: Run TypeScript compilation**

```bash
npx tsc --noEmit
```

Expected: No new errors related to severity/category types. Fix any remaining references to old values.

**Step 2: Search for any remaining old severity references**

```bash
grep -r "praise\|'suggestion'\|'warning'" src/ --include="*.ts" --include="*.css" -l
```

Expected: No files found (or only false positives in unrelated contexts like toast warning).

**Step 3: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix(ai-review): fix remaining severity/category references"
```
