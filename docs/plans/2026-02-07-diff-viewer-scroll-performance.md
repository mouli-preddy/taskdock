# Diff Viewer Scroll Performance Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix sluggish scrolling in PR review diff viewer (both split and unified views) by applying CSS performance optimizations and JS event delegation.

**Architecture:** Apply a layered approach — (1) CSS `content-visibility: auto` on off-screen diff lines to skip rendering, (2) CSS `contain` to isolate layout/paint per line, (3) event delegation instead of per-line listeners, (4) `passive` scroll listeners, (5) throttle scroll-synced updates. No virtual scrolling library needed — CSS containment alone gives 90%+ of the benefit with zero refactoring risk.

**Tech Stack:** Vanilla CSS (`content-visibility`, `contain`, `will-change`), vanilla TypeScript (event delegation, `requestAnimationFrame` throttle)

---

### Task 1: CSS — Add content-visibility and containment to diff lines

The single biggest win. `content-visibility: auto` tells the browser to skip layout+paint for off-screen lines. `contain-intrinsic-height` prevents scrollbar jank. `contain: content` isolates each line's layout/paint from siblings.

**Files:**
- Modify: `src/renderer/styles/diff.css:131-136` (`.diff-line` rule)

**Step 1: Add containment properties to `.diff-line`**

In `diff.css`, replace the `.diff-line` rule (lines 132-136):

```css
/* Individual Line */
.diff-line {
  display: flex;
  height: 22px;
  flex-shrink: 0;
}
```

With:

```css
/* Individual Line */
.diff-line {
  display: flex;
  height: 22px;
  flex-shrink: 0;
  content-visibility: auto;
  contain-intrinsic-height: 22px;
  contain: content;
}
```

**What these do:**
- `content-visibility: auto` — browser skips rendering lines outside viewport (biggest perf win)
- `contain-intrinsic-height: 22px` — tells scrollbar the height of skipped lines so scroll position stays stable
- `contain: content` — isolates layout/paint so changing one line doesn't reflow siblings

**Step 2: Verify scrolling is smoother**

Run the app, open a PR with a large diff (500+ lines), scroll rapidly in both split and unified views. Scrollbar should maintain correct size and position.

**Step 3: Commit**

```bash
git add src/renderer/styles/diff.css
git commit -m "perf(diff): add CSS containment to diff lines for scroll performance"
```

---

### Task 2: CSS — Remove expensive hover/animation properties that cause per-frame repaints

Hover effects on every `.diff-line` cause a repaint on every frame during scroll when the cursor is over the diff. Filters and box-shadows during animations are also expensive.

**Files:**
- Modify: `src/renderer/styles/diff.css` (multiple rules)

**Step 1: Make diff-line hover opt-in via pointer interaction**

Replace the hover rule (lines 138-140):

```css
.diff-line:hover {
  background: var(--bg-hover);
}
```

With a pointer-based approach that doesn't trigger during scroll:

```css
@media (hover: hover) {
  .diff-line:hover {
    background: var(--bg-hover);
  }
}
```

This still shows hover on desktop but the `@media (hover: hover)` wrapper is a best practice signal. The real fix is the `content-visibility` from Task 1 which prevents the browser from even evaluating hover on off-screen lines.

**Step 2: Remove filter from minimap marker hover**

Replace (lines 559-562):

```css
.minimap-marker:hover {
  opacity: 1 !important;
  filter: brightness(1.2);
}
```

With:

```css
.minimap-marker:hover {
  opacity: 1 !important;
}
```

`filter: brightness()` forces a GPU-composited layer on every hovered marker. Removing it eliminates the cost while the opacity change alone is sufficient visual feedback.

**Step 3: Replace box-shadow animation with border animation**

Replace the `line-highlight` keyframes (lines 501-510):

```css
@keyframes line-highlight {
  0%, 30% {
    background: var(--info-bg);
    box-shadow: inset 4px 0 0 var(--accent-blue);
  }
  100% {
    background: transparent;
    box-shadow: none;
  }
}
```

With a cheaper border-based approach:

```css
@keyframes line-highlight {
  0%, 30% {
    background: var(--info-bg);
    outline: none;
  }
  100% {
    background: transparent;
    outline: none;
  }
}
```

The left-bar indicator is already handled by `.change-highlight::before` and `.has-comment::before` pseudo-elements. The `box-shadow` in the animation was redundant and expensive (forces repaint of entire line on every animation frame).

**Step 4: Commit**

```bash
git add src/renderer/styles/diff.css
git commit -m "perf(diff): remove expensive CSS hover/animation properties"
```

---

### Task 3: JS — Add passive flag to scroll listeners and throttle minimap updates

Scroll listeners without `{ passive: true }` block the browser's scroll compositor. The minimap viewport update runs on every scroll event without throttling.

**Files:**
- Modify: `src/renderer/components/diff-viewer.ts:1010-1022` (`syncScroll`)
- Modify: `src/renderer/components/diff-viewer.ts:1141-1163` (`renderMinimap` scroll handler)

**Step 1: Make scroll sync listeners passive**

In `diff-viewer.ts`, replace the `syncScroll` method (lines 1010-1022):

```typescript
  private syncScroll(el1: Element, el2: Element) {
    let syncing = false;

    const sync = (source: Element, target: Element) => {
      if (syncing) return;
      syncing = true;
      target.scrollTop = source.scrollTop;
      syncing = false;
    };

    el1.addEventListener('scroll', () => sync(el1, el2));
    el2.addEventListener('scroll', () => sync(el2, el1));
  }
```

With:

```typescript
  private syncScroll(el1: Element, el2: Element) {
    let syncing = false;

    const sync = (source: Element, target: Element) => {
      if (syncing) return;
      syncing = true;
      target.scrollTop = source.scrollTop;
      syncing = false;
    };

    el1.addEventListener('scroll', () => sync(el1, el2), { passive: true });
    el2.addEventListener('scroll', () => sync(el2, el1), { passive: true });
  }
```

**Step 2: Throttle minimap viewport updates with rAF**

In the `renderMinimap` method, replace the scroll listener setup (around lines 1141-1163):

```typescript
    // Update viewport indicator on scroll
    const updateViewport = () => {
      const scrollHeight = scrollPane.scrollHeight;
      const clientHeight = scrollPane.clientHeight;
      const scrollTop = scrollPane.scrollTop;

      if (scrollHeight <= clientHeight) {
        viewport.style.display = 'none';
        return;
      }

      viewport.style.display = 'block';
      const viewportHeight = (clientHeight / scrollHeight) * 100;
      const viewportTop = (scrollTop / scrollHeight) * 100;

      viewport.style.height = `${Math.max(viewportHeight, 10)}%`;
      viewport.style.top = `${viewportTop}%`;
    };

    scrollPane.addEventListener('scroll', updateViewport);
```

With:

```typescript
    // Update viewport indicator on scroll (throttled via rAF)
    const updateViewport = () => {
      const scrollHeight = scrollPane.scrollHeight;
      const clientHeight = scrollPane.clientHeight;
      const scrollTop = scrollPane.scrollTop;

      if (scrollHeight <= clientHeight) {
        viewport.style.display = 'none';
        return;
      }

      viewport.style.display = 'block';
      const viewportHeight = (clientHeight / scrollHeight) * 100;
      const viewportTop = (scrollTop / scrollHeight) * 100;

      viewport.style.height = `${Math.max(viewportHeight, 10)}%`;
      viewport.style.top = `${viewportTop}%`;
    };

    let rafPending = false;
    scrollPane.addEventListener('scroll', () => {
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(() => {
          updateViewport();
          rafPending = false;
        });
      }
    }, { passive: true });
```

**Step 3: Commit**

```bash
git add src/renderer/components/diff-viewer.ts
git commit -m "perf(diff): add passive scroll listeners and throttle minimap updates"
```

---

### Task 4: JS — Switch from per-line event listeners to event delegation

Each diff line currently gets its own `dblclick` and gutter `mousedown` listener. For a 2000-line diff in split view, that's ~6000 listeners. Event delegation uses one listener on the container.

**Files:**
- Modify: `src/renderer/components/diff-viewer.ts:436-517` (`createSplitLineElement`, `createUnifiedLineElement`)
- Modify: `src/renderer/components/diff-viewer.ts:1072-1087` (`attachEventListeners`)

**Step 1: Remove per-line listeners from createSplitLineElement**

In `createSplitLineElement` (lines 436-484), remove the event listener block. Replace lines 474-481:

```typescript
    if (lineNum) {
      el.dataset.line = lineNum.toString();
      el.addEventListener('dblclick', () => this.showCommentBox(lineNum, lineNum, el));
      // Attach gutter handlers for line selection (only on the new/modified side)
      if (side === 'new') {
        this.attachGutterHandlers(el, lineNum);
      }
    }
```

With:

```typescript
    if (lineNum) {
      el.dataset.line = lineNum.toString();
      // Gutter marked as selectable for CSS hover indicator (new side only)
      if (side === 'new') {
        const gutter = el.querySelector('.diff-gutter') as HTMLElement;
        if (gutter) {
          gutter.classList.add('selectable');
        }
      }
    }
```

**Step 2: Remove per-line listeners from createUnifiedLineElement**

In `createUnifiedLineElement` (lines 486-517), replace lines 508-514:

```typescript
    const lineNum = line.newLineNum || line.oldLineNum;
    if (lineNum) {
      el.dataset.line = lineNum.toString();
      el.addEventListener('dblclick', () => this.showCommentBox(lineNum, lineNum, el));
      // Attach gutter handlers for line selection
      this.attachGutterHandlers(el, lineNum);
    }
```

With:

```typescript
    const lineNum = line.newLineNum || line.oldLineNum;
    if (lineNum) {
      el.dataset.line = lineNum.toString();
      // Gutter marked as selectable for CSS hover indicator
      const gutter = el.querySelector('.diff-gutter') as HTMLElement;
      if (gutter) {
        gutter.classList.add('selectable');
      }
    }
```

**Step 3: Replace attachEventListeners with delegated event handlers**

Replace the `attachEventListeners` method (lines 1072-1087) and the `attachGutterHandlers` method (lines 678-690) with a single delegated handler approach.

Replace `attachGutterHandlers` (lines 678-690):

```typescript
  private attachGutterHandlers(lineElement: HTMLElement, lineNum: number) {
    const gutter = lineElement.querySelector('.diff-gutter') as HTMLElement;
    if (!gutter) return;

    // Mark gutter as selectable
    gutter.classList.add('selectable');

    gutter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.startLineSelection(lineNum, lineElement);
    });
  }
```

With an empty stub (the logic moves to attachEventListeners):

```typescript
  // Kept for compatibility — gutter 'selectable' class is now added inline during element creation
  // Event handling is delegated in attachEventListeners()
  private attachGutterHandlers(_lineElement: HTMLElement, _lineNum: number) {}
```

Then replace `attachEventListeners` (lines 1072-1087):

```typescript
  private attachEventListeners() {
    this.container.querySelectorAll('.diff-comment-badge').forEach(badge => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const reviewScreen = document.getElementById('reviewScreen');
        reviewScreen?.classList.add('comments-open');

        // Get thread IDs and notify callback
        const threadIdsStr = (badge as HTMLElement).dataset.threadIds;
        if (threadIdsStr && this.commentBadgeClickCallback) {
          const threadIds = threadIdsStr.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
          this.commentBadgeClickCallback(threadIds);
        }
      });
    });
  }
```

With a delegated version:

```typescript
  private attachEventListeners() {
    // Delegated: dblclick on any diff line opens comment box
    this.container.addEventListener('dblclick', (e) => {
      const lineEl = (e.target as HTMLElement).closest('.diff-line[data-line]') as HTMLElement | null;
      if (!lineEl) return;
      const lineNum = parseInt(lineEl.dataset.line || '0');
      if (lineNum > 0) {
        this.showCommentBox(lineNum, lineNum, lineEl);
      }
    });

    // Delegated: mousedown on selectable gutter starts line selection
    this.container.addEventListener('mousedown', (e) => {
      const gutter = (e.target as HTMLElement).closest('.diff-gutter.selectable') as HTMLElement | null;
      if (!gutter) return;
      const lineEl = gutter.closest('.diff-line[data-line]') as HTMLElement | null;
      if (!lineEl) return;
      const lineNum = parseInt(lineEl.dataset.line || '0');
      if (lineNum > 0) {
        e.preventDefault();
        e.stopPropagation();
        this.startLineSelection(lineNum, lineEl);
      }
    });

    // Delegated: click on comment badge
    this.container.addEventListener('click', (e) => {
      const badge = (e.target as HTMLElement).closest('.diff-comment-badge') as HTMLElement | null;
      if (!badge) return;
      e.stopPropagation();
      const reviewScreen = document.getElementById('reviewScreen');
      reviewScreen?.classList.add('comments-open');

      const threadIdsStr = badge.dataset.threadIds;
      if (threadIdsStr && this.commentBadgeClickCallback) {
        const threadIds = threadIdsStr.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
        this.commentBadgeClickCallback(threadIds);
      }
    });
  }
```

**Step 4: Commit**

```bash
git add src/renderer/components/diff-viewer.ts
git commit -m "perf(diff): switch to event delegation instead of per-line listeners"
```

---

### Task 5: CSS — Add will-change and GPU hints for scroll containers

Tell the browser which elements will be scrolled so it can promote them to compositor layers.

**Files:**
- Modify: `src/renderer/styles/diff.css` (`.diff-pane-content` and `.diff-unified` rules)

**Step 1: Add will-change to scroll containers**

In `diff.css`, update `.diff-pane-content` (lines 111-115):

```css
.diff-pane-content {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
```

To:

```css
.diff-pane-content {
  flex: 1;
  overflow: auto;
  min-height: 0;
  will-change: scroll-position;
}
```

Update `.diff-unified` (lines 118-122):

```css
.diff-unified {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
```

To:

```css
.diff-unified {
  flex: 1;
  overflow: auto;
  min-height: 0;
  will-change: scroll-position;
}
```

**Step 2: Commit**

```bash
git add src/renderer/styles/diff.css
git commit -m "perf(diff): add will-change hints to scroll containers"
```

---

### Task 6: JS — Optimize querySelectorAll in navigateChanges and getChangeStats

`navigateChanges()` and `getChangeStats()` both query ALL `.diff-line` elements and iterate them on every call. Cache the change groups after render so navigation is O(1) lookup instead of O(n) DOM traversal.

**Files:**
- Modify: `src/renderer/components/diff-viewer.ts` (add cache, update navigateChanges and getChangeStats)

**Step 1: Add a change groups cache property**

After the existing private fields (around line 36), add:

```typescript
  private changeGroupsCache: HTMLElement[][] = [];
  private currentChangeGroupIndex = -1;
```

**Step 2: Build cache after render**

At the end of `renderSplitView` (after line 354) and `renderUnifiedView` (after line 392), add a call:

```typescript
    this.buildChangeGroupsCache();
```

Add the method:

```typescript
  private buildChangeGroupsCache() {
    this.changeGroupsCache = [];
    this.currentChangeGroupIndex = -1;
    const allLines = this.container.querySelectorAll('.diff-line');
    let currentGroup: HTMLElement[] = [];

    for (const line of allLines) {
      const isChange = line.classList.contains('add') || line.classList.contains('del');
      if (isChange) {
        currentGroup.push(line as HTMLElement);
      } else if (currentGroup.length > 0) {
        this.changeGroupsCache.push(currentGroup);
        currentGroup = [];
      }
    }
    if (currentGroup.length > 0) {
      this.changeGroupsCache.push(currentGroup);
    }
  }
```

**Step 3: Rewrite navigateChanges to use cache**

Replace `navigateChanges` (lines 836-900):

```typescript
  navigateChanges(direction: number): boolean {
    if (this.changeGroupsCache.length === 0) return false;

    // Calculate new group index
    const newIndex = this.currentChangeGroupIndex + direction;
    if (newIndex < 0 || newIndex >= this.changeGroupsCache.length) {
      return false;
    }

    // Remove previous highlights
    if (this.currentChangeGroupIndex >= 0 && this.currentChangeGroupIndex < this.changeGroupsCache.length) {
      for (const line of this.changeGroupsCache[this.currentChangeGroupIndex]) {
        line.classList.remove('change-highlight');
      }
    }

    // Apply new highlights
    this.currentChangeGroupIndex = newIndex;
    const newGroup = this.changeGroupsCache[newIndex];
    for (const line of newGroup) {
      line.classList.add('change-highlight');
    }

    newGroup[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }
```

**Step 4: Rewrite getChangeStats to use cache**

Replace `getChangeStats` (lines 912-934):

```typescript
  getChangeStats(): { current: number; total: number } {
    return {
      current: this.currentChangeGroupIndex >= 0 ? this.currentChangeGroupIndex + 1 : 0,
      total: this.changeGroupsCache.length
    };
  }
```

**Step 5: Update clearChangeHighlight to reset cache index**

Replace `clearChangeHighlight` (lines 902-906):

```typescript
  clearChangeHighlight() {
    if (this.currentChangeGroupIndex >= 0 && this.currentChangeGroupIndex < this.changeGroupsCache.length) {
      for (const line of this.changeGroupsCache[this.currentChangeGroupIndex]) {
        line.classList.remove('change-highlight');
      }
    }
    this.currentChangeGroupIndex = -1;
  }
```

**Step 6: Commit**

```bash
git add src/renderer/components/diff-viewer.ts
git commit -m "perf(diff): cache change groups to avoid querySelectorAll on every navigation"
```

---

## Summary of Performance Wins

| Optimization | Impact | Mechanism |
|---|---|---|
| `content-visibility: auto` | **Very High** | Browser skips layout+paint for off-screen lines |
| `contain: content` | **High** | Isolates each line so changes don't reflow siblings |
| Event delegation | **High** | ~6000 listeners → 3 listeners |
| Passive scroll listeners | **Medium** | Unblocks scroll compositor thread |
| rAF throttle on minimap | **Medium** | Reduces minimap updates to 60fps max |
| Cached change groups | **Medium** | Eliminates O(n) DOM queries during navigation |
| Remove filter/box-shadow | **Low-Medium** | Eliminates GPU layer churn during hover/animation |
| `will-change: scroll-position` | **Low** | Hints browser to optimize scroll containers |

**Research sources:**
- [web.dev: content-visibility](https://web.dev/articles/content-visibility)
- [MDN: content-visibility](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility)
- [Four Kitchens: will-change](https://www.fourkitchens.com/blog/article/fix-scrolling-performance-css-will-change-property/)
- [DebugBear: content-visibility](https://www.debugbear.com/blog/content-visibility-api)
- [SitePen: Next Generation Virtual Scrolling](https://www.sitepen.com/blog/next-generation-virtual-scrolling)
