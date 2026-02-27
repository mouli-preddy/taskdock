# DGrep Clone Research - Comprehensive Analysis

## Overview

This document captures the complete analysis of the Geneva DGrep log search interface at
`https://portal.microsoftgeneva.com/logs/dgrep`. The goal is to replicate and improve DGrep
within TaskDock, making it more AI-friendly and integrated with our existing workflow.

---

## 1. Architecture & Page Structure

The DGrep page is hosted within the Jarvis portal shell. The main content lives inside an iframe:

```
Main page: https://portal.microsoftgeneva.com/logs/dgrep
  └── iframe (name="durandal-frame"):
        https://portal.microsoftgeneva.com/frameable/dgrep?hideShell=true&nopreview=true&parentOrigin=https://portal.microsoftgeneva.com
```

The UI uses:
- **Knockout.js** for data binding (data-bind attributes throughout)
- **Select2** for dropdown/combobox widgets
- **Ace Editor** for query editors (MQL/KQL syntax highlighting)
- **jQuery + jQuery Migrate** for DOM manipulation
- **Durandal** framework for widgets and view composition

---

## 2. UI Components (Complete Inventory)

### 2.1 Top Toolbar

| Button | Icon | Description |
|--------|------|-------------|
| **Server Query** | Search icon | Edit base parameters of the search (active tab indicator) |
| **Open Saved** | Folder icon | Open a previously saved search |
| **Save** | Disk icon | Save the current search parameters |
| **Personalize** | Gear icon | Personalize search experience |
| **Share Link** | Link icon | Generate a deep link to share |

### 2.2 Query Parameters Panel (Left Side)

#### Endpoint Selector
- **Type**: Combobox (Select2) with search/filter
- **Default**: "Diagnostics PROD"
- **Available Options** (13 total):
  1. Billing PROD
  2. Bleu
  3. CA Fairfax
  4. CA Mooncake
  5. Delos
  6. Dev
  7. Diagnostics PROD
  8. External PROD
  9. FirstParty PROD
  10. GovSG
  11. Smoke
  12. Stage
  13. Test

#### Namespace Selector
- **Type**: Combobox (Select2) with search/filter
- **Placeholder**: "Namespace..."
- **Data source**: API call to `/user-api/v1/logs/environment/{endpoint}/namespace`
- Returns thousands of namespaces (dynamically based on selected endpoint)

#### Events to Search
- **Type**: Multi-select text input with autocomplete
- **Placeholder**: "type event name..."
- Shows "No columns matching filter" when namespace not selected
- **Checkbox**: "Show Azure security pack events" (unchecked by default)

#### Time Range Controls
- **Reference Time**:
  - Date picker button (calendar icon)
  - "Now" button (sets to current time)
  - Text input: `MM/DD/YYYY HH:mm` format
  - UTC/Local toggle button
  - Quick adjust buttons: `-5mins`, `-1 min`, `+1 min`, `+5mins`

- **Time Offset**:
  - Sign selector (radio-style): `±` | `+` | `-` (default: `-`)
  - Offset value: text input (default: `30`)
  - Unit dropdown: `Minutes` (also supports Hours, Days)
  - Quick macro buttons: `1`, `2`, `3`, `5`, `15`, `30`

#### Add Index Button
- Adds a selective index to the selected event

#### Scoping Conditions
- Label: "Scoping conditions"
- Group for adding conditions with:
  - **Comparand**: Combobox - selects the field name (e.g., "Field")
  - **Operator**: Text input for comparison operator
  - **Values**: Text input for values to match

#### Filtering Conditions / Query Language Toggle
- **Query Language Radio Group**:
  - `Simple` - Basic filter interface
  - `MQL` - Monitoring Query Language (default, active)
  - `KQL` - Kusto Query Language

#### Server Query Editor
- **Type**: Ace Editor with syntax highlighting
- Supports MQL and KQL modes
- Line numbers displayed
- Alt+F1 for accessibility options

#### Miscellaneous Settings (Collapsible)
- Toggle button to expand/collapse

#### Start Search Button
- Primary action button with search icon

### 2.3 Results Panel (Right Side)

#### Client Query Section (Top)
- **Toggle**: "Client Query" button (collapsible, for post-search filtering)
- **Query Language**: MQL (default) | KQL toggle
- **Editor**: Separate Ace Editor for client-side filtering
- **Run Button**: Execute client query against already-fetched results
- **Hide Button**: Collapse client query panel

#### Results Tabs
1. **Logs Tab** (default):
   - Refresh search results button
   - Download as CSV button
   - Search/filter textbox: "Find... prefix with '-' to negate"
   - Data grid with pagination (first, prev, next, last buttons)
   - Column visibility controls: "Filter columns..." input, "Select All" checkbox
   - Toggle aggregates panel button

2. **Chart Tab**:
   - Chart type picker: `line` | `column` | `area`
   - Chart editor panel with query input
   - Pin to dashboard button
   - Refresh button
   - "Generate Query" button
   - Layer management: "Add a layer" button with layer name input
   - Refresh chart button, Pin to dashboard button

3. **Aggregates Tab**:
   - Toggle aggregates panel
   - Add new aggregate button
   - Refresh aggregates button

#### Full Screen Toggle
- Button to expand results to full viewport

### 2.4 Panel Toggle
- "Toggle D Grep Panel" button - collapse/expand left query panel

---

## 3. Settings & Personalization (Complete)

### 3.1 Saved Queries
- **My Queries** / **Shared Queries** toggle tabs

### 3.2 Personalization Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **Auto Hiding** | Radio group | "Disable auto hiding" | When to auto-hide query panel |
| | | Option 2: "When search successfully starts" | |
| | | Option 3: "When results are first found" | |
| | | Option 4: "When the search completes successfully" | |
| **Query Editor Magnification** | Slider + input | 100% | Zoom level for code editors |
| **Hide time macros** | Checkbox | unchecked | Hide time selection macro buttons |
| **Collapse to summary** | Checkbox | checked | Collapse scoping conditions to summary |
| **Disable autorun on remove** | Checkbox | unchecked | Don't re-run on filter removal |
| **Always include security group** | Checkbox | unchecked | Include REDMOND\\AZURE-ALL-PSV group |
| **Save column visibility** | Checkbox | unchecked | Per-namespace column preferences |
| **Max Columns** | Number | 50 | Maximum columns displayed |
| **Time Formatting** | Text | "MM-DD-YYYY HH:mm:ss" | Custom time format string |
| **Single Value Columns** | Group | | |
| - Disable auto show summary | Checkbox | unchecked | |
| - Disable auto hiding | Checkbox | unchecked | |
| - Min rows for auto hide | Number | 2 | |
| **Export Format** | Radio | CSV | CSV, TSV, or Space-separated |
| **Show formatted body** | Checkbox | checked | Render structured body column |
| **Disable monospace font** | Checkbox | unchecked | Use proportional font |
| **Aggregate decimals** | Number | 2 | Decimal places for aggregates |

### 3.3 Link Sharing
- **Shortlink (Absolute time)**: Short URL with copy button
- **Parameterized Link (Absolute time)**: Full URL with parameters
- **Parameterized Link (Relative time)**: URL with relative time offset

### 3.4 Other Settings (Misc panel)
- **Max results**: Select dropdown: 500,000 | 750,000 | 1,000,000
- **Auxiliary logs**: Toggle: DGrep-only | Auxiliary
- **Clear namespace/event hints** button
- **Clear saved visibility preferences** button

---

## 4. API Endpoints (Complete)

### 4.1 Authentication

**Required Headers** for all API calls:
```
Cookie: <session_cookie>
Csrftoken: <csrf_token>
X-Requested-With: XMLHttpRequest
Content-Type: application/json
Referer: https://portal.microsoftgeneva.com/frameable/dgrep?hideShell=true&nopreview=true&parentOrigin=https://portal.microsoftgeneva.com
```

**Token Acquisition**: Uses Playwright to copy Edge browser profile, navigate to Geneva portal,
execute a test query, and capture the CSRF token from intercepted requests + cookies from browser context.
Tokens cached at `%LOCALAPPDATA%\BrainBot\geneva_tokens.json`.

### 4.2 Core Search API

#### Start Search
```
POST /user-api/v2/logs/startSearchV2?addAADClaimToMdsCalls=true&useDSTSPathwayWithDSTSLogin=false
```

**Request Body:**
```json
{
  "endpoint": "https://production.diagnostics.monitoring.core.windows.net/",
  "namespaces": ["SkypeCoreConv"],
  "eventNames": ["ServiceTraces"],
  "startTime": "2025-02-08T10:00:00+00:00",
  "endTime": "2025-02-08T10:30:00+00:00",
  "identityColumns": {},
  "queryID": "<uuid>",
  "queryType": 1,
  "query": "| where Message contains 'error'",
  "searchCriteria": null,
  "maxResults": 500000
}
```

**Response**: HTTP 200 on success.

#### Check Search Status (Polling)
```
GET /user-api/v2/logs/searchstatus/id/{queryID}/endpoint/{doubleEncodedEndpoint}?_={timestamp}
```

**Response:**
```json
{
  "Status": "Searching",        // "Initializing" | "Searching" | "Completed" | "Unknown"
  "ResultCount": 245,
  "ProcessedBlobSize": 1500000,
  "ScheduledBlobSize": 2000000
}
```

**Polling**: 1-second intervals, 300-second timeout.
**Progress**: `ProcessedBlobSize / ScheduledBlobSize * 100`

#### Fetch Results
```
POST /user-api/v2/logs/results/id/{queryID}/endpoint/{doubleEncodedEndpoint}?startIndex={start}&endIndex={end}&querytype=KQL
```

**Request Body**: JSON-encoded string of the KQL client query.
Example: `"source\n| sort by PreciseTimeStamp asc\n| limit 10"`

**Response:**
```json
{
  "Count": 245,
  "Rows": [
    {
      "PreciseTimeStamp": "2025-02-08T10:15:30.123Z",
      "Message": "Query executed successfully",
      "EventMessage": "Log entry content",
      "TaskName": "ServiceTask",
      "source": "raw log entry"
    }
  ]
}
```

**Preview mode**: `startIndex=1, endIndex=0` returns only `Count`, no `Rows`.

### 4.3 Metadata APIs

#### Get Namespaces for Endpoint
```
GET /user-api/v1/logs/environment/{doubleEncodedEndpoint}/namespace
```
Returns: JSON array of namespace strings.

#### Get Events for Namespace
```
POST /user-api/v1/logs/environment/{doubleEncodedEndpoint}/namespace/{namespace}/identityName/__EventVersion__/identityValues
```
Returns: Event names for the namespace (requires CSRF token).

#### Get User Preferences
```
GET /user-api/v3/data/statebag/preferences
```
Returns: User preferences including defaultMdmAccounts, timezone, etc.

#### Get Monitoring Account Config (Autocomplete)
```
GET /user-api/v1/hint/monitoringAccountConfig
```
Returns: JSON array of all monitoring account names (thousands of entries).

#### Get User Info
```
GET /user-api/v1/data/user
GET /user-api/v1/aad/getMyInfo
GET /user-api/v1/aad/getSecurityGroups
```

#### Telemetry & Logging
```
POST /user-api/v1/data/telemetry
POST /user-api/v1/data/log/batch-events
```

### 4.4 URL Encoding

Endpoint URLs are **double-encoded** in path parameters:
```
https://production.diagnostics.monitoring.core.windows.net/
  → encodeURIComponent → https%3A%2F%2Fproduction.diagnostics.monitoring.core.windows.net%2F
  → encodeURIComponent → https%253A%252F%252Fproduction%252Ediagnostics%252Emonitoring%252Ecore%252Ewindows%252Enet%252F
```

---

## 5. Endpoint URL Mapping

| Display Name | MDS Endpoint URL |
|-------------|-----------------|
| Diagnostics PROD | `https://production.diagnostics.monitoring.core.windows.net/` |
| FirstParty PROD | `https://firstparty.monitoring.windows.net/` |
| CA Mooncake | (Mooncake sovereign cloud endpoint) |
| CA Fairfax | (Fairfax sovereign cloud endpoint) |
| Billing PROD | (Billing endpoint) |
| Bleu | (Bleu endpoint) |
| Delos | (Delos endpoint) |
| Dev | (Development endpoint) |
| External PROD | (External endpoint) |
| GovSG | (Singapore government endpoint) |
| Smoke | (Smoke test endpoint) |
| Stage | (Staging endpoint) |
| Test | (Test endpoint) |

**DGrep V2 Frontend Endpoints** (used directly by API clients):
- **Production**: `https://dgrepv2-frontend-prod.trafficmanager.net`
- **Mooncake**: `https://dgrepv2-frontend-prod.trafficmanager.cn`
- **Fairfax**: `https://dgrepv2-frontend-prod.usgovtrafficmanager.net`

---

## 6. Query Languages

### 6.1 KQL (Kusto Query Language) - Recommended
Used for both server-side and client-side queries.

**Server Query** (filters before collection):
```kql
| where Message contains 'error'
| where TaskName == 'MyTask'
| where PreciseTimeStamp between (datetime(2025-01-01) .. datetime(2025-01-02))
```

**Client Query** (applied after results fetched):
```kql
source
| sort by PreciseTimeStamp asc
| project PreciseTimeStamp, Message, TaskName
| limit 100
```

### 6.2 MQL (Monitoring Query Language) - Legacy
The original DGrep query language. Still supported and is the default.

### 6.3 Simple Mode
Basic UI-driven filtering without writing queries.

### 6.4 Key References
- KQL docs: `https://eng.ms/docs/products/geneva/logs/references/dgrepquerylanguage/kql`
- KQL categorize operator: separate doc
- MQL docs: `https://eng.ms/docs/products/geneva/logs/references/dgrepquerylanguage/mql`
- DGrep Developer SDK: separate doc section

---

## 7. Pre-configured Log Sources (from existing client)

| ID | Namespace | Event | Endpoint | Description |
|----|-----------|-------|----------|-------------|
| `cs` | SkypeCoreConv | ServiceTraces | diagnostics | Skype Core Conversation |
| `ts` | TeamsScheduler | ServiceTraces | diagnostics | Teams Scheduler |
| `cc` | SkypeCoreCC | ServiceTraces | diagnostics | Skype Core CC |
| `ccts` | SkypeCCTS | ServiceTraces | diagnostics | Skype CCTS |
| `css` | SkypeContentSharing | ServiceTraces | diagnostics | Content Sharing |
| `rb` | SkypeRB | BroadcastLogs | firstparty | Broadcast Logs |
| `scx` | TeamsLiveEventsAttendee | AttendeeLogs | diagnostics | Teams Live Events |
| `csmetrics` | SkypeCoreConv | Metrics | diagnostics | Core Conv Metrics |
| `tsmetrics` | TeamsScheduler | Metrics | diagnostics | Scheduler Metrics |

---

## 8. Identity Columns (Scoping)

Optional filtering used to scope queries to specific identities:

```json
{
  "identityColumns": {
    "UserId": ["user123", "user456"],
    "TenantId": ["tenant789"]
  }
}
```

URL format for deep links:
```
&scopingConditions=["UserId","user123,user456"]["TenantId","tenant789"]
```

---

## 9. Deep Link URL Format

```
https://portal.microsoftgeneva.com/logs/dgrep?
  page=logs
  &be=DGrep
  &ep={endpointName}
  &ns={namespace}
  &en={eventNames}
  &time={ISO8601DateTime}
  &offset=~{minutes}
  &offsetUnit=Minutes
  &UTC=true
  &serverQuery={encodedQuery}
  &serverQueryType=kql
  &kqlClientQuery={encodedQuery}
  &scopingConditions={encodedConditions}
```

---

## 10. Query Execution Flow

```
1. User fills in parameters → clicks "Start Search"
     │
2. POST /startSearchV2 → returns queryID
     │
3. Poll GET /searchstatus/{queryID} every 1s
     │ (shows progress: ResultCount, ProcessedBlobSize/ScheduledBlobSize)
     │
4. Status changes from "Searching" → "Completed"
     │
5. POST /results/{queryID} (preview: startIndex=1, endIndex=0)
     │ → returns Count only
     │
6. POST /results/{queryID} (full: startIndex=0, endIndex=Count)
     │ → returns Rows[]
     │
7. Client-side KQL query applied to results
     │
8. Results displayed in grid with pagination
```

---

## 11. Token Acquisition Approach (for TaskDock)

From `C:\git\scripts\gather-geneva-secrets.py`:

1. Copy Edge browser profile (Cookies, Login Data, Preferences, Local State) to temp dir
2. Launch headless Edge via Playwright with the copied profile
3. Navigate to `https://portal.microsoftgeneva.com/logs/dgrep`
4. Execute test query (`| take 1`) to trigger network requests
5. Intercept requests to capture `Csrftoken` header
6. Extract cookies from browser context
7. Save to `%LOCALAPPDATA%\BrainBot\geneva_tokens.json`:
   ```json
   {"cookie": "...", "csrf": "..."}
   ```
8. Validate: cookie must be > 50 chars, CSRF must exist

---

## 12. Improvements for TaskDock DGrep Clone (AI-Friendly)

### 12.1 AI-Powered Query Building
- Natural language → KQL conversion: "Show me errors from Core Conv in the last hour"
- Query suggestions based on past queries and patterns
- AI-assisted scoping condition builder

### 12.2 Smart Log Analysis
- AI summarization of search results (pattern detection, anomaly detection)
- Automatic correlation across multiple log sources
- Timeline visualization with AI-highlighted anomalies
- Root cause suggestion based on error patterns

### 12.3 Saved Query Library
- Team-shared query templates with semantic search
- Query history with AI-powered similarity matching
- Auto-tagging of queries by service/feature/incident

### 12.4 Enhanced UX
- Side-by-side comparison of two searches
- Live tail mode for real-time log streaming
- Structured JSON body viewer (expand/collapse)
- Inline field value distribution charts
- Quick filters by clicking column values in results

### 12.5 Integration Points
- Link DGrep searches to work items and PRs
- Attach log snippets to code review comments
- Auto-search logs when investigating PR changes
- Plugin system hooks for custom log analysis workflows

---

## 13. Network Request Summary (from live capture)

### Page Load Requests
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/user-api/v3/data/statebag/preferences` | User preferences |
| GET | `/user-api/v3/data/statebag/feature-flags` | Feature flags |
| GET | `/user-api/v1/data/user` | User info |
| GET | `/user-api/v1/aad/getMyInfo` | AAD user info |
| GET | `/user-api/v1/hint/monitoringAccountConfig` | Account config (autocomplete) |
| GET | `/user-api/v3/Notifications?component=common` | Notifications |
| GET | `/user-api/v3/announcements` | Announcements |
| GET | `/user-api/v1/aad/getSecurityGroups` | Security groups |
| GET | `/user-api/v1/logs/environment/{ep}/namespace` | Namespace list |
| POST | `/user-api/v1/logs/environment/{ep}/namespace/{ns}/.../identityValues` | Events for namespace |

### DGrep-Specific HTML Templates
| Path | Widget/Component |
|------|-----------------|
| `/js-min/pages/logs/dgrep.html` | Main DGrep page |
| `/js-min/pages/logs/dgrep-search-store-selector.html` | Saved search selector |
| `/js-min/pages/logs/dgrep-grid.html` | Results grid |
| `/js-min/pages/logs/dgrep-chart.html` | Chart panel |
| `/js-min/durandal/widgets/timePicker/view.html` | Time picker widget |
| `/js-min/durandal/widgets/codeEditor/view.html` | Code editor (Ace) widget |
| `/js-min/durandal/widgets/autocomplete/view.html` | Autocomplete dropdown |
| `/js-min/durandal/widgets/autocompleteMultiSelect/view.html` | Multi-select |
| `/js-min/durandal/widgets/checklist/view.html` | Checklist widget |
| `/js-min/durandal/widgets/offsetPicker/view.html` | Time offset picker |
| `/js-min/durandal/widgets/conditions/view.html` | Scoping conditions |
| `/js-min/durandal/widgets/slider/view.html` | Slider widget |
| `/js-min/durandal/widgets/grid/view.html` | Data grid |
| `/js-min/durandal/widgets/logs.queryEditor/view.html` | Query editor |

---

## 14. User Preferences Structure

From the statebag/preferences API:
```json
{
  "id": "<base64_user_id>",
  "timezone": false,
  "defaultMdmAccounts": [
    "TeamsScheduler",
    "SkypeCastMG",
    "SkypeCoreConv",
    "SkypeCCTS",
    "SkypeCoreFlightProxy",
    "SkypeUserStore",
    "mstCoreProd"
  ],
  "defaultMDMAccount": "..."
}
```

---

## 15. Keyboard Shortcuts

The DGrep UI has a "Show Shortcuts" button that displays an overlay of all keyboard shortcuts.
(Exact shortcuts not captured in this analysis - should be documented during implementation.)

---

## 16. IcM Integration

The portal has built-in IcM (Incident Management) integration:
- "Select Incident" button
- Incident ID display with expand panel
- Links incidents to DGrep searches for correlation

---

## 17. Cascading Data Population (How UI Dropdowns Get Filled)

### 17.1 Data Flow Overview

```
Endpoint selected
  │
  ├─→ GET /user-api/v1/logs/environment/{doubleEncodedEndpoint}/namespace
  │     Returns: array of namespace strings (41,549 for Diagnostics PROD)
  │
  └─→ Populates namespacePicker (autocompleteMultiSelect widget)

Namespace selected
  │
  ├─→ POST /user-api/v1/logs/environment/{ep}/namespace/{ns}/identityName/__EventVersion__/identityValues
  │     Body: [] (empty array)
  │     Returns: array of event names for the namespace
  │     NOTE: Returns 500 with {} body; requires [] body for 200
  │
  ├─→ Populates dgrepModel.namespaceEventMap[namespace] = [event names...]
  │     Example: TeamsScheduler → 72 events (see list below)
  │
  ├─→ Populates allEvents observable array (checklist items with label/checked)
  │
  └─→ Populates scopingConditions.comparands observable
        Contains: { "<i>EventVersion</i>": { supportedOperations, name, environment, namespaceEventsMapping } }

Event selected
  │
  └─→ scopingConditions.comparands updated with available scoping fields
```

### 17.2 Endpoints List

The endpoint picker is an `autocomplete` widget. Available endpoints (13):
- Billing PROD, Bleu, CA Fairfax, CA Mooncake, Delos, Dev,
  Diagnostics PROD, External PROD, FirstParty PROD, GovSG, Smoke, Stage, Test

The endpoint picker fetches its list lazily from the `dgrepModel.getEndpoints()` function.

### 17.3 Namespace Population

- **API**: `GET /user-api/v1/logs/environment/{doubleEncodedEndpoint}/namespace`
- **Widget**: `autocompleteMultiSelect` (supports multiple namespace selection)
- **Behavior**: Fetched when endpoint changes; supports search/filter, create-on-fly
- **Count**: ~41,549 namespaces for Diagnostics PROD
- **Properties**: `createChoiceOnFly: true`, `showSelectedItems: true`

### 17.4 Events Population

Events come from the **hinting system** (pre-indexed metadata). The key API:

```
POST /user-api/v1/logs/environment/{ep}/namespace/{ns}/identityName/__EventVersion__/identityValues
Body: []  (MUST be empty array, not {} object!)
```

**Response**: Array of event name strings.

The UI uses a `checklist` widget with:
- **data**: Observable array of event objects `{ label: string, checked: boolean }`
- **checkedItems**: Observable array of selected events
- **enableSelectAll**: true
- **createItemsOnFly**: true (allows typing custom event names)
- **unknownItemHint**: " (unknown event)"
- **placeholderText**: "Please first populate the above fields"
- **searchPlaceholder**: "type event name..."

**Data is stored** in `dgrepModel.namespaceEventMap` as:
```json
{
  "TeamsScheduler": ["ApplicationEvents", "AzureEvents", "CustomEventTraces", ...72 total],
  "SkypeCoreConv": ["ServiceTraces", "Metrics", ...]
}
```

When "Show Azure security pack events" is unchecked, Asm* events are filtered out.
The non-Asm events for TeamsScheduler (29): ApplicationEvents, AzureEvents, CustomEventTraces,
DiscreteDiskCounters, DnsAggregatedEvent, DnsAggregatedQueryInterceptionEvent, DnsPluginEvent,
DnsQueryInterceptionEvent, DnsQueryInterceptionSummaryEvent, FabricActorTraces, FabricAdminEvents,
FabricComponentCounters, FabricCounters, FabricOperationalEvents, FabricServiceTraces, FabricTraces,
MaCounterSummary, MaErrorsSummary, MaHeartBeats, MaQosSummary, MetricValue,
PatchOrchestrationTraces, PerfCounters, ServiceFabricOperationalEvent,
ServiceFabricReliableActorEvent, ServiceFabricReliableServiceEvent, ServiceTraces,
SystemCounters, SystemEvents

### 17.5 Scoping Conditions Population

Scoping conditions are populated from the same identity hinting system. The `comparands` observable
contains an object mapping field names to their metadata:

```json
{
  "<i>EventVersion</i>": {
    "supportedOperations": ["=="],
    "name": "<i>EventVersion</i>",
    "environment": "https://production.diagnostics.monitoring.core.windows.net/",
    "namespaceEventsMapping": { "TeamsScheduler": ["ApplicationEvents", ...] }
  }
}
```

**Condition operators** (from `defaultFieldComparers`):
- `contains` - Field contains value
- `!contains` - Field does not contain value
- `==` - Equals
- `!=` - Not equals
- `equals any of` - Matches any of the values
- `contains any of` - Contains any of the values

**Widget**: `conditions` with `enableAutoCompletion: true`

### 17.6 DGrep ViewModel Architecture

The `MainViewModel` (113 properties) orchestrates the entire UI:

**Key Observables:**
- `dgrepModel.endpoint` → "Diagnostics PROD"
- `dgrepModel.namespaces` → ["TeamsScheduler"]
- `dgrepModel.namespace` → "TeamsScheduler"
- `dgrepModel.eventNames` → ["ServiceTraces"]
- `dgrepModel.offset` → 30
- `dgrepModel.offsetSign` → "-"
- `dgrepModel.offsetUnit` → "Minutes"
- `dgrepModel.scopingConditions` → []
- `dgrepModel.useAdvancedQuery` → true
- `dgrepModel.mqlQuery` → ""
- `dgrepModel.kqlQuery` → "source"
- `dgrepModel.maxResults` → 500000
- `dgrepModel.shimMode` → "Dgrep" (vs "Auxiliary")

**Key Widget Instances:**
- `endpointPicker` → autocomplete (Select2-based)
- `namespacePicker` → autocompleteMultiSelect (Select2-based)
- `eventsPicker` → checklist (custom checkbox list)
- `scopingConditions` → conditions (custom condition builder)
- `timePicker` → timePicker (date/time input)
- `offsetPicker` → offsetPicker (offset value + unit)
- `mqlQueryEditor` → codeEditor (Ace-based)
- `kqlQueryEditor` → codeEditor (Ace-based)

**Key Event Handlers:**
- `onNamespaceChanged` → fetches events for new namespace
- `onEventNamesChanged` → updates scoping conditions
- `onAdvancedQueryChanged` → validates query syntax
- `onApplySearch` → triggers search execution
- `onApplyCacheQuery` → runs client-side KQL filter
- `onScopingConditionsSchemaLoaded` → updates comparands
- `onDataSchemaLoaded` → updates column list

### 17.7 Monitoring Account Hints

The `/user-api/v1/hint/monitoringAccountConfig` endpoint returns 46,487 monitoring account names
used for autocomplete suggestions in the namespace picker.

---

## 18. Live Query Execution Results

### TeamsScheduler / ServiceTraces / Diagnostics PROD (30-min window)

**Search Status**: Throttled at 500,000 results (only 1.2% of data scanned)
**Columns Returned (20)**: TIMESTAMP, env_ver, env_name, env_time, severityText,
severityNumber, Message, ActivityId, Level, Tid, Pid, name, Tenant, Role, RoleInstance,
GenevaPodName, PreciseTimeStamp, __SourceEvent__, __SourceMoniker__, __SearchWorker__

**Sample Log Entry**:
```json
{
  "PreciseTimeStamp": "2026-02-08T23:30:01.8257070Z",
  "Message": "[NoMember,NoFile(NoLine) 190f107f-... ] Performing health check for Machines to Try.",
  "Role": "...",
  "RoleInstance": "...",
  "Level": "...",
  "Tenant": "...",
  "GenevaPodName": "..."
}
```

---

## Summary

This document captures the complete DGrep interface including:
- **61+ input elements** (text, checkbox, radio, range, hidden, number)
- **80+ buttons** with specific actions
- **3 select dropdowns** (max results, auxiliary logs, chart type)
- **3 API endpoints** for the core search flow (start, status, results)
- **10+ metadata APIs** for UI population
- **3 query languages** (Simple, MQL, KQL)
- **13 endpoint environments**
- **9 pre-configured log sources**
- **Full token acquisition pipeline**

This provides sufficient detail to implement a complete DGrep clone within TaskDock.
