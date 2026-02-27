# DGrep Feature Test Checklist

## Prerequisites
1. Run `npm run dev` and open the Tauri app
2. Click "Log Search" in the sidebar
3. Select a log preset (e.g., "cs") or configure endpoint/namespace/events manually
4. Click "Search" to load results (use 10K max results for faster testing)

---

## 1. Core Search & Results

### 1.1 Search Execution
- [x] Select a log preset (e.g., "cs") - endpoint, namespace, events auto-populate
- [x] Click "Search" - status bar shows "Starting search...", then progress percentage
- [x] Results stream in incrementally (row count increases as data loads)
- [X] Status bar shows "Complete: X results" when done

### 1.2 Auto-Collapse Query Panel
- [x] After clicking Search, the left query panel collapses automatically
- [x] The collapse button changes from "<<" to ">>"
- [x] Click ">>" to expand the query panel back

### 1.3 Smart Column Defaults
- [x] After results load, only essential columns are shown: severityText, Message, ActivityId, Level, name, Role, RoleInstance, PreciseTimeStamp
- [x] Internal columns are hidden by default: env_*, __SourceEvent__, __SearchWorker__, GenevaPodName, Tid, Pid, TIMESTAMP, etc.

### 1.4 Virtual Scrolling
- [x] Results render without pagination (no "Page 1 of X" buttons)
- [x] Scroll smoothly through 10K+ rows without lag
- [x] Row count shown in toolbar (e.g., "10,002 rows")
- [x] Scrollbar reflects position in full dataset

---

## 2. Column Management

### 2.1 Column Presets
- [x] Click "Essential" - shows only the 8 essential columns
- [x] Click "All" - shows ALL columns including hidden metadata ones
- [x] Column set changes immediately

### 2.2 Column Picker
- [x] Click "Columns" button - dropdown appears with checkbox list
- [ ] Search box at top filters column names
- [ ] "Select All" / "Deselect All" buttons work
- [Onl] Check/uncheck individual columns - table updates immediately
- [ ] Click outside dropdown to close it

### 2.3 Column Resizing
- [x] Hover the right edge of any column header - cursor changes to resize
- [x] Drag to resize the column width
- [x] Other columns adjust accordingly

### 2.4 Column Sorting
- [x] Click a column header - sorts ascending (arrow up shown)
- [x] Click again - sorts descending (arrow down shown)
- [x] Click a different column - sorts by that column

---

- [x] Clear existing rows as soon as Search is clicked
- [ ] Clicking on a place in the virtual scrolling scrollbar should scroll to those lines
- [x] The selected column preset must be highlighted (essential vs All). 
- [ ] If column presets are updated, they should be saved for the given Namespace + Events combination.
- [x] Add support for highlight based on filter condition, make it easy to set filter conditions (example, right-click on a cell to either highlight it, or filter that value - like I click on severityText=Warning cell and I should be able to highlight (mark all cells with that with a unique color) or filter only warnings. 
- [x] Quick filter should have an option to search regex. Clicking on enter should allow me to apply that filter and it should show in the filters row. Shift + Enter should instead make it highlight-only.
- [x] I should be able to convert any filter to highlight only, so it doesn't get filtered but hightghed with a color. 

## 3. Filtering

### 3.1 Quick Text Filter
- [ ] Type in "Quick text filter across all columns..." input
- [ ] Table filters to show only rows containing the text
- [ ] Row count updates to show "(filtered)" count
- [ ] Clear the filter - all rows return

### 3.2 Search Text Highlighting
- [ ] Type a filter term (e.g., "error" or "Adapter")
- [ ] Matching text in table cells is highlighted in yellow
- [ ] Clear filter - highlighting disappears

### 3.3 Pattern Detection
- [ ] After results load, "Patterns (N)" button appears in toolbar
- [ ] Click it - dropdown shows detected message patterns with counts
- [ ] Each pattern shows: [count] normalized message text + sparkline frequency
- [ ] Click a pattern - table filters to show only matching rows
- [ ] "Clear filter" button in dropdown removes the pattern filter

### 3.4 Ctrl+Click Quick Value Filter
- [ ] Hold Ctrl and click any cell value in the table
- [ ] A filter chip appears in the "Filters:" bar above the table
- [ ] Table filters to show only rows matching that column=value
- [ ] Add multiple Ctrl+Click filters - they stack (AND logic)
- [ ] Click X on a filter chip to remove it
- [ ] "Clear all" button removes all filter chips

### 3.5 Faceted Sidebar
- [ ] Click "Facets" button in the actions bar
- [ ] Right sidebar appears showing value distributions per column
- [ ] Each facet shows: column name, expand/collapse toggle, top 10 values with horizontal bars and counts
- [ ] Click a value in any facet - filters the table to that value
- [ ] Click "Facets" again to hide the sidebar

### 3.6 Per-Column Filter (Excel-like)
- [ ] Hover over any column header - a small funnel icon appears on the right
- [ ] Click the funnel icon - dropdown appears with checkbox list of distinct values
- [ ] Text search box to filter values in the dropdown
- [ ] "Select All" / "Deselect All" buttons
- [ ] Check specific values, click "Apply" - table filters to only those values
- [ ] The funnel icon turns blue when a column filter is active
- [ ] Click funnel again to modify/remove the filter

---

## 4. Row Detail & Inspection

### 4.1 Row Selection & Detail Panel
- [ ] Click any row in the results table
- [ ] Row highlights with blue background
- [ ] Detail panel appears below the table showing ALL column values for that row
- [ ] Click the same row again to deselect (detail panel closes)
- [ ] Click X button in detail panel header to close it

### 4.2 Detail Panel - Table View
- [ ] Detail panel shows a two-column table: column name | value
- [ ] Empty/null values are hidden
- [ ] Click any value in the detail panel to copy it to clipboard
- [ ] Blue flash animation confirms the copy

### 4.3 Detail Panel - JSON View
- [ ] Click "JSON" button in the detail panel header (next to "Table")
- [ ] Detail panel switches to a collapsible JSON tree view
- [ ] String values shown in green, numbers in blue, booleans in purple, null in gray
- [ ] Strings containing valid JSON are auto-parsed into nested trees
- [ ] "Expand All" / "Collapse All" buttons work
- [ ] "Copy All" button copies entire row as formatted JSON
- [ ] Click "Table" to switch back to table view

### 4.4 Context Viewer (Surrounding Logs)
- [ ] With a row selected, click "Show Context" button in detail panel header
- [ ] Context panel appears showing ~10 rows before and ~10 rows after the selected row
- [ ] Selected row is highlighted with blue background in the timeline
- [ ] Each context row shows: timestamp, severity badge, truncated message
- [ ] Click any context row to select it in the main table
- [ ] Close button to dismiss the context viewer

### 4.5 Double-Click to Copy
- [ ] Double-click any cell in the table
- [ ] Cell briefly flashes blue (copy animation)
- [ ] Cell value is copied to clipboard

### 4.6 Keyboard Navigation
- [ ] Click the table area to focus it
- [ ] Press Arrow Down - selects next row, detail panel updates
- [ ] Press Arrow Up - selects previous row
- [ ] Press Escape - deselects current row, closes detail panel
- [ ] Arrow keys auto-scroll when reaching edge of visible area

---

## 5. Toolbar Features

### 5.1 Wrap Toggle
- [ ] Click "Wrap" button in toolbar
- [ ] Button turns blue (active state)
- [ ] Message column text wraps instead of truncating with ellipsis
- [ ] Click "Wrap" again to toggle off - text returns to single-line truncated

### 5.2 Bookmarks
- [ ] Select a row, press Ctrl+B - row gets bookmarked (yellow indicator)
- [ ] Click "Bookmarks" button - dropdown shows all bookmarked rows
- [ ] Press Ctrl+] to jump to next bookmark
- [ ] Press Ctrl+[ to jump to previous bookmark
- [ ] Bookmark indicators appear in the severity minimap (yellow ticks)

### 5.3 Live Tail
- [ ] Click "Live Tail" button
- [ ] Button turns green with pulsing dot
- [ ] Select poll interval (5s, 10s, 30s)
- [ ] New log rows appear at the bottom of the table periodically
- [ ] Auto-scrolls to show new rows (unless you've scrolled up)
- [ ] Click "Live Tail" again to stop

### 5.4 CSV Export
- [ ] Click "CSV" button in actions bar
- [ ] File downloads as `dgrep-results-YYYY-MM-DDTHH-MM-SS.csv`
- [ ] CSV contains only visible columns
- [ ] CSV contains all filtered rows (not just visible ones)

### 5.5 Open in Geneva
- [ ] Click "Open in Geneva" button
- [ ] Browser opens the DGrep portal with the current query pre-populated

### 5.6 Copy Query ID
- [ ] Click "Copy Query ID" button
- [ ] Session ID copied to clipboard (paste to verify)

---

## 6. Visualization

### 6.1 Time Histogram
- [ ] After results load, a bar chart appears above the results table
- [ ] Bars are stacked by severity: red=error, yellow=warning, blue=info, gray=verbose
- [ ] X-axis shows time labels, Y-axis shows count
- [ ] Hover over a bar - tooltip shows time range and per-severity counts
- [ ] Click and drag to select a time range - table filters to that range
- [ ] A filter chip appears showing the time range
- [ ] Double-click histogram to reset to full time range
- [ ] Mouse wheel to zoom in/out

### 6.2 Severity Minimap
- [ ] A thin vertical colored strip appears on the right edge of the table
- [ ] Colors represent severity: red pixels = errors, yellow = warnings, blue = info
- [ ] A semi-transparent overlay shows the current scroll viewport position
- [ ] Click anywhere on the minimap to jump to that position in the table
- [ ] Drag the viewport indicator to scroll the table
- [ ] Bookmark ticks appear as yellow markers when bookmarks are set

---

## 7. Query UX

### 7.1 NL-to-KQL (AI Query)
- [ ] In the query panel, find "AI Query" section with "Ask AI..." input
- [ ] The "AI" checkbox is checked (enabled by default)
- [ ] Type a natural language query: "show me all errors with timeout"
- [ ] Click "KQL" button or press Enter
- [ ] Loading spinner appears while AI generates KQL
- [ ] Generated KQL populates the Server Query (KQL) editor
- [ ] An explanation appears below the input describing what the KQL does
- [ ] Uncheck "AI" checkbox to disable the NL input

### 7.2 Command Palette (Ctrl+K)
- [ ] Press Ctrl+K anywhere in the DGrep view
- [ ] Modal overlay appears with search input: "Type a command..."
- [ ] Type to fuzzy-search across all commands
- [ ] Commands organized by category: Search, View, Filter, AI, Export
- [ ] Use Arrow Up/Down to navigate, Enter to execute
- [ ] Press Escape to close
- [ ] Execute "Show Errors Only" - table filters to error rows
- [ ] Execute "Essential Columns" - switches to essential column preset

### 7.3 Saved Queries
- [ ] In query panel, click "Saved" button (next to Log Preset)
- [ ] Dropdown appears with "Save Current Query" section
- [ ] Type a name and click Save
- [ ] Query appears in the list with name, timestamp, delete button
- [ ] Close and reopen the dropdown - query persists
- [ ] Click a saved query to load it - all form fields populate
- [ ] Click the delete icon (X) on a saved query to remove it

### 7.4 URL Parser
- [ ] Paste a Geneva DGrep portal URL into the "DGrep URL" input field
- [ ] Click "Parse"
- [ ] Status bar shows "Parsing URL..."
- [ ] All fields populate: endpoint, namespace, events (checked), time, offset, scoping conditions, server query, client query
- [ ] Status bar shows "URL parsed. Ready to search."
- [ ] Test with government cloud URLs (CA Fairfax, CA Mooncake) - endpoint resolves correctly
- [ ] Scoping conditions with 2-element format [column, value] parse correctly (default to == operator)
- [ ] Click Search - query executes with the parsed parameters

---

## 8. AI Features

> **Note**: AI features require the Copilot SDK to be authenticated. If you see errors about authentication, ensure GitHub Copilot is configured in Settings.

### 8.1 AI Summary Panel
- [ ] After loading results, click "Summarize" button in actions bar
- [ ] AI Summary panel appears above the results
- [ ] Shows "Analyzing logs..." with animated dots while processing
- [ ] AI generates a narrative summary that streams in progressively
- [ ] Summary includes: error breakdown (stacked bar), top patterns with trends, time correlations
- [ ] Click the collapse chevron to minimize the summary panel
- [ ] Click "Summarize" again to regenerate

### 8.2 AI Chat Panel (Conversational Log Exploration)
- [ ] Click "AI Chat" button in actions bar
- [ ] Right-side panel slides in with "Log Assistant" title
- [ ] 3 suggestion chips shown: "What errors are most frequent?", "Show timeline of failures", "Explain the error spike"
- [ ] Click a suggestion chip - question is sent to AI
- [ ] AI response streams in with typing indicator
- [ ] Type a custom question in the input box, press Enter or click Send
- [ ] Multi-turn conversation works (AI remembers context)
- [ ] Close button (X) to dismiss the panel
- [ ] Re-opening preserves conversation history within the session

### 8.3 AI Root Cause Analysis
- [ ] Right-click an error row (red severity) in the results table
- [ ] Context menu appears with "Analyze Root Cause" option
- [ ] RCA panel slides in below the detail panel
- [ ] Shows investigation progress: "Analyzing error context..."
- [ ] AI may run additional queries automatically (shown as "Running additional query: ...")
- [ ] Displays: root cause narrative, confidence indicator, evidence timeline, linked rows, recommendation
- [ ] Click a linked row to navigate to it in the main table

### 8.4 AI Anomaly Detection
- [ ] After results load, anomalies are detected automatically (or via command palette: "Detect Anomalies")
- [ ] Anomalous rows are highlighted with orange glow/accent
- [ ] Orange tick marks appear in the severity minimap at anomaly positions

### 8.5 AI Predictive Suggestions
- [ ] After search completes, a suggestion bar may appear below the actions bar
- [ ] Shows 2-3 clickable suggestion chips like "You might also want to check..."
- [ ] Click a suggestion to either open chat or run a follow-up query

---

## 9. Edge Cases

### 9.1 Empty Results
- [ ] Run a search that returns 0 results
- [ ] Table shows "No results" message
- [ ] All buttons are disabled appropriately
- [ ] Histogram and minimap are empty/hidden

### 9.2 Large Dataset (100K+ rows)
- [ ] Set max results to 500K, run a search
- [ ] Virtual scrolling handles the load without freezing
- [ ] Pattern detection completes without crashing
- [ ] Faceted sidebar computes without hanging the UI

### 9.3 Government Cloud Endpoints
- [ ] Select "CA Fairfax" endpoint - namespaces load correctly
- [ ] Select "CA Mooncake" endpoint - namespaces load correctly
- [ ] These use different portal URLs (not the default portal.microsoftgeneva.com)

### 9.4 URL Parsing Edge Cases
- [ ] Paste URL with scoping conditions in 2-element format: `[["Column","value"]]` - parses as == operator
- [ ] Paste URL with scoping conditions in 3-element format: `[["Column","contains","value"]]` - parses with specified operator
- [ ] Paste URL with complex server query containing newlines and special characters
- [ ] Paste URL with both serverQuery and kqlClientQuery

---

## Test Summary

| Category | Total Tests | Passed | Failed | Blocked |
|----------|-------------|--------|--------|---------|
| 1. Core Search | _/4 | | | |
| 2. Column Management | _/4 | | | |
| 3. Filtering | _/6 | | | |
| 4. Row Detail | _/6 | | | |
| 5. Toolbar | _/6 | | | |
| 6. Visualization | _/2 | | | |
| 7. Query UX | _/4 | | | |
| 8. AI Features | _/5 | | | |
| 9. Edge Cases | _/4 | | | |
| **TOTAL** | **_/41** | | | |

**Tester**: ________________
**Date**: ________________
**Build**: ________________
**Notes**: ________________
