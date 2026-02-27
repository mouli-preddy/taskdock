# Geneva/Jarvis Dashboard API Analysis

## Overview

The Geneva portal (portal.microsoftgeneva.com) — also known as **Jarvis** — is Microsoft's internal monitoring platform. Dashboards display time-series metrics using **MQL (Metrics Query Language)** queries against monitoring accounts.

## Architecture

```
Browser → portal.microsoftgeneva.com → user-api proxy → Geneva backend (MDM)
                                    ↓
                              iframe-based dashboard
                              (canvas/MDMProfilePage)
```

The dashboard content loads inside an **iframe** pointing to `/app/canvas/w/mdm/MDMProfilePage`. The outer shell provides navigation, account selection, and authentication.

---

## Key API Endpoints

### 1. Dashboard Definition
```
GET /user-api/v2/dashboard/get/{account}/{path}
```
- **Example**: `GET /user-api/v2/dashboard/get/SkypeCoreConv/ServiceHealth/CS/MQL`
- **Returns**: Full dashboard JSON with all widget definitions, MQL queries, display options
- **Response structure**:
  ```json
  {
    "account": "SkypeCoreConv",
    "id": "a7cdd6b09f8d413426ca9ffb66fb5898",
    "path": "ServiceHealth/CS/MQL",
    "content": {
      "wires": {
        "widgets": [
          {
            "guid": "867cbf21-d273-4687-8df1-e4ce5fdcf119",
            "wires": {
              "title": "Global",
              "data": {
                "startTime": -86400000,     // relative: -24h
                "endTime": -1,              // relative: now
                "mdmKql": [{ ... }]         // MQL queries
              },
              "view": { /* chart display options */ }
            }
          }
        ]
      }
    }
  }
  ```

### 2. Metrics Query (Most Important!)
```
POST /user-api/queryGateway/v2/language/jarvis/monitoringAccount/{account}
```
- **Content-Type**: `application/json`
- **Required Headers**:
  - `clientid: Jarvis`
  - `csrftoken: {token}` (obtained from session)
  - `sourceidentity: {"user":"...", "time":..., "retry":false, "selectedPath":[...]}`
  - `traceguid: {uuid}` (for tracing)
  - `jarvis.overridetimeout: 601000`
  - Standard cookies (AAD auth session)

- **Request Body**:
  ```json
  {
    "monitoringAccount": "SkypeCoreConv",
    "metricNamespace": "HTTPMetrics",
    "startTimeUTC": "Sun, 08 Feb 2026 02:25:00 GMT",
    "endTimeUTC": "Mon, 09 Feb 2026 02:28:58 GMT",
    "queryStatement": "<MQL query string>",
    "resolutionInMilliseconds": 300000,
    "resolutionReductionAggregationType": "None",
    "selectionCount": 100,
    "queryParameters": {}
  }
  ```

- **Response Body**:
  ```json
  {
    "timeResolutionInMilliseconds": 900000,
    "startTimeUtc": "2026-02-08T02:15:00Z",
    "endTimeUtc": "2026-02-09T02:28:00Z",
    "outputDimensions": ["APIMethod"],
    "outputSamplingTypes": ["Reliability"],
    "timeSeriesList": [
      {
        "dimensionList": [
          { "key": "APIMethod", "value": "JoinConversation_ConversationApi" }
        ],
        "timeSeriesValues": [
          {
            "key": "Reliability",
            "value": [100.0, 100.0, 99.94, 100.0, ...]
          }
        ]
      }
    ],
    "messages": [
      {
        "messageID": "RI7000",
        "severity": 2,
        "text": "Pre-aggregate for HttpRequests chosen..."
      }
    ]
  }
  ```

### 3. Dashboard Tree
```
GET /user-api/v1/dashboard/getTree/{account}
```
- Returns list of all dashboards in an account
- Response: Array of `{ account, path, lastUpdatedBy, lastUpdated, isDeleted }`

### 4. Tenant Configuration
```
GET /passthrough/user-api/v1/config/tenant/{account}
```
- Returns tenant certificates, ACLs, and configuration

### 5. User APIs
```
GET /user-api/v1/data/user                          # User data
GET /user-api/v1/aad/getMyInfo                      # AAD user info
GET /user-api/v3/data/statebag/preferences          # User preferences
GET /user-api/v1/hint/monitoringAccountConfig       # Account config hints
GET /user-api/v1/gcs/path/{path}/get                # Favorites
```

---

## MQL (Metrics Query Language) Examples

### Reliability Calculation (from this dashboard)
```kql
metricNamespace("HTTPMetrics")
  .metric("HttpRequests")
  .dimensions("ServiceDU","ServiceTenant","ServiceRole","APIMethod","StatusCode","ResultCategory","ProxyOrTakeover")
  .samplingTypes("Count")
| where ProxyOrTakeover in ("Flighted","NotFlighted")
| zoom 5mTotal = sum(Count) by 10m
| summarize Total = sum(5mTotal) by APIMethod
| join kind=fullouter (
    metricNamespace("HTTPMetrics")
      .metric("HttpRequests")
      .dimensions("ServiceDU","ServiceTenant","ServiceRole","APIMethod","StatusCode","ResultCategory","ProxyOrTakeover")
      .samplingTypes("Count")
    | where ProxyOrTakeover in ("Flighted","NotFlighted")
    | where StatusCode startswith "2" or StatusCode startswith "4"
    | zoom 5mTotal = sum(Count) by 10m
    | summarize Success = sum(5mTotal) by APIMethod
  )
| where APIMethod in ("CreateConversation_ConversationFactory", "JoinConversation_ConversationApi", ...)
| project Reliability = (100 * Success)/Total
```

### Key MQL Operators
- `metricNamespace().metric().dimensions().samplingTypes()` — Select metric source
- `| where` — Filter dimensions
- `| zoom` — Time-window aggregation
- `| summarize` — Group-by aggregation
- `| join` — Join two metric streams
- `| project` — Compute derived metrics
- `| top` — Select top N results

---

## Authentication

The portal uses **AAD (Azure Active Directory)** authentication:
- Cookie-based session (`AADAuth.SPA`, `.AspNetCore.Cookies`)
- CSRF token in `csrftoken` header (extracted from page/session)
- User identity in `sourceidentity` header

---

## Dashboard Widget Structure

Each widget in the dashboard is an `XTSGrid` component with:
- **`data.mdmKql`**: Array of MQL query configurations
  - `account`: Monitoring account name
  - `namespace`: Metric namespace
  - `kqlQuery`: The MQL query string
  - `displayOptions`: Color, line style, units, etc.
- **`view`**: Visualization settings (chart type, thresholds, legend, etc.)
- **`title`**: Widget title
- **`guid`**: Unique widget identifier
- **`drilldown`**: Click-through configuration to other widgets

### Time Range
- `startTime`: Relative offset in ms (e.g., `-86400000` = last 24h)
- `endTime`: Relative offset in ms (e.g., `-1` = now)
- Can be absolute UTC timestamps when pinned

---

## Request Flow for Loading a Dashboard

1. **Auth check** → `GET /user-api/v1/data/user`
2. **Preferences** → `GET /user-api/v3/data/statebag/preferences`
3. **Dashboard definition** → `GET /user-api/v2/dashboard/get/{account}/{path}`
4. **Dashboard tree** → `GET /user-api/v1/dashboard/getTree/{account}` (for sidebar)
5. **Tenant config** → `GET /passthrough/user-api/v1/config/tenant/{account}`
6. **Metrics queries** → Multiple `POST /user-api/queryGateway/v2/language/jarvis/monitoringAccount/{account}` (one per widget)
7. **Telemetry** → `POST /user-api/v1/data/telemetry`

---

## Key Observations for Integration

1. **All API calls go through the portal proxy** — The actual MDM backend isn't called directly
2. **Authentication is cookie-based** — To call these APIs programmatically, you need a valid AAD session
3. **CSRF token required** — Every mutating request needs the `csrftoken` header
4. **MQL is the query language** — Similar to KQL but specific to Geneva metrics
5. **5 concurrent queries per dashboard load** — Each widget fires its own query independently
6. **Resolution is adaptive** — `resolutionInMilliseconds` adjusts based on time range (300000 for 24h = 5min buckets)
7. **`NaN` values** — Missing data points are represented as string `"NaN"` in the JSON response
8. **Selection limit** — Default `selectionCount: 100` limits time series returned
