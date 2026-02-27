# CFV (Call Flow Visualizer) Client Analysis

## Overview

CFV is a web-based diagnostic tool for analyzing Teams/Skype call flows. It loads call data by call ID and presents it across 4 tabs with an AI-generated summary. The web app is at `https://ngc.skype.net/`.

---

## API Architecture

### Base URLs
- **Primary Gateway:** `https://cfvapi-aks.cfvapi.skype.com`
- **Regional Endpoints:** `https://cfvapi-{region}-{num}-prod-aks.cfvapi.skype.com` (e.g., `cfvapi-uswe-01-prod-aks`)

### Authentication
- Bearer token (extracted from browser session via Edge profile cookies)
- Token acquisition approach: Use Playwright to launch Edge with user's profile, intercept network requests to extract Bearer token
- Token storage: `%LOCALAPPDATA%/BrainBot/cfv_tokens.json`
- Scripts at `C:\git\scripts\` handle this (cfv.py, gather-cfv-secrets.py)

### API Endpoints

#### 1. Call Summary (AI-generated)
```
GET /api/callSummary/{callId}
Response: 200 - AI summary text with call overview, errors, notable events
```

#### 2. Chat Assistant Availability
```
GET /api/ChatAssistant/Chat/{callId}/ChatAvailable
Response: 200 - Boolean availability
```

#### 3. Call Details (async initiation)
```
GET /v2/api/callDetails/{callId}?forceReload=false
Response: 201 - Returns poll URL on regional server
```

#### 4. Call Flow Query (async initiation)
```
POST /api/query/call/{callId}?forceReload=false&getMessageScores=true&forceCallFlowData=false
Response: 201 - Returns poll URL on regional server
```

#### 5. QoE Events
```
GET /v2/api/events/{callId}?eventName=mdss_qoe
Response: 200 - Quality of Experience data
```

#### 6. Call Flow Status Polling (streaming download)
```
POST /v2/api/query/status/callFlow--{callId}?i={instanceId}
POST /v2/api/query/status/callFlow--{callId}?i={instanceId}&exclude[]=relatedCallIds
Response: 200 - Chunked call flow data (can be ~10MB for large calls)
```

#### 7. Call Leg Drill Down Status Polling
```
POST /v2/api/query/status/callLegDrillDown-{callId}-?i={instanceId}
Response: 200 - Per-user call leg data
```

#### 8. Meeting Schedule
```
GET /api/query/meetingSchedule/{threadId}/{index}
Response: 200 - Meeting scheduling data
```

### Async Query Pattern
1. Client sends initial query (GET/POST) to primary gateway
2. Gateway returns **201** with a poll URL on a **regional server**
3. Client polls the regional URL repeatedly (~every 1-2s)
4. Regional server returns data in chunks (progressive download)
5. Call leg drill down completes faster; call flow takes longer (~2 min for 10MB)
6. Later polls add `&exclude[]=relatedCallIds` to skip already-fetched data

---

## UI Structure

### Header Bar
- **Logo/Title:** "Call Flow Visualizer" (link to home `/`)
- **Search Box:** "Specify a Call ID, Meeting URL or a Meeting ID"
- **Clear Text Button**
- **People Lookup Button** (icon)
- **Import Data Button**
- **Service Selector Dropdown:** CFV (default), possibly other services
- **Search Button**

### Navigation Bar
- **Troubleshooting Guides** - Opens troubleshooting documentation
- **Call Diagnostics** - Opens diagnostics view
- **Force Reload** - Forces re-fetch of data
- **Export Data** (dropdown, disabled until data loads)
- **Settings** - Opens settings panel

### AI Summary Panel (collapsible)
- **Header:** "Azure OpenAI Call Summary" with close button
- **Content:** AI-generated paragraph summarizing:
  - Call type (scheduled meeting, ad-hoc, etc.)
  - Duration, start/end times
  - Participant count (unique non-bot, max concurrent)
  - Cluster and instance info
  - Notable errors with subcodes
  - Key events
- **"Show more"** button to expand full summary

### Bottom Bar
- **Version tag:** e.g., "09f28a70\HEAD"
- **Feedback button**
- **Chat Assistant button**

---

## Tab 1: Call Flow (Default)

### Command Bar (horizontal menu)
- **Scoping** (collapsible) - Filter by scope
- **Filters** (collapsible) - Filter messages
- **Scheduling Data** (collapsible, loads async)
- **Related Calls (N)** (collapsible)
- **Endpoint Tracker** (collapsible)
- **Logs** (submenu)
- **Health Dashboards** (submenu)
- **Share** button

### Pagination Controls (top and bottom)
- Previous/Next page buttons
- Page number buttons (1, 2, 3, ..., 133)
- Page number input
- Rows per page: 50 rows (configurable dropdown)
- Status: "Displaying 50 out of 6617"

### View Selector
- Dropdown: "Autodetect" (default)

### Service Columns (horizontal lanes)
The call flow is displayed as a sequence diagram with these service columns:
1. **Originator** - The client initiating calls
2. **Conv** - Conversation service
3. **CC** - Call Controller
4. **Target** - Target endpoint/user
5. **MC** - Media Controller
6. **MPAAS** - Media Platform as a Service
7. **MPaaS:IVR** - IVR subsystem
8. **PNH** - Push Notification Hub
9. **PMA** - Presence/Messaging Agent
10. **Agent** - Bot/Agent service
11. **Runtime API** - Runtime API service
12. **External** - External services

### Message Rows
Each row shows:
- **Sequence number** (1, 2, 3...)
- **Timestamp** (HH:MM:SS.mmm format)
- **Duration** (e.g., "496 ms")
- **HTTP Method + URL** (e.g., "POST /conv/")
- **Arrow** between source and destination service columns
- Error messages shown inline: `[HTTP: 200] [Code(Subcode): 200()]`

### Message Detail Dialog (on click)
Opens a modal dialog with:
- **Close button**
- **Expand button**
- **Request section:**
  - Title: "UDPCALLBACKPROXY Request {timestamp}"
  - Full HTTP request: method, URL, headers, body (formatted JSON)
  - Headers include: Host, User-Agent, Authorization (redacted), Content-Type, traceparent, Via, MS-Teams-*, X-Microsoft-Skype-*, Forwarded
- **Response section:**
  - Title: "Response {timestamp}"
  - Full HTTP response: status, headers, body (formatted JSON)
  - Response includes: conversation URLs, meeting details, capabilities, roster, etc.

---

## Tab 2: Call Leg Drill Down

### Menu Bar
- **View conv report** - View conversation report
- **View all events (raw)** - View raw event data
- **Logs** (submenu)

### Search Bar
- "Search for any field (e.g. participant id)"

### Filters (radio buttons)
- **All** (default)
- **Errors** - Show only legs with errors
- **Bots** - Show only bot participants
- **Unknown** - Show unknown participants

### User List (expandable grid)
Columns:
- **Expand/Collapse toggle**
- **Description** - "User N - {userId}" with copy button, "(Bot)" suffix for bots
- **Client Version** - e.g., "CallSignalingAgent (49/26033.600.4339.5819/...)"
- **Participant ID** - GUID with copy button
- **End Code** - e.g., "N/A" or error code
- **End Sub Code** - e.g., "N/A" or subcode (5027, 5003, etc.)
- **Endpoint ID** - GUID with copy button
- **Actions** - Buttons: "MultiParty Call", "Native CSA"

### User States
- Green checkmark: Success
- Red error icon: Error/failure
- Each user can have multiple call legs (rejoin, reconnect, etc.)

---

## Tab 3: Raw Events

### Event Browser
- **Heading:** "Browse raw events"
- **Description:** Useful for large meetings or accessing mdss_qoe, mdss_mediadiagnostics, skypemc_mpc_mediasessionterminated

### Event Type Dropdown (26 types)
1. mdsc_conference
2. mdsc_mediadiagnostic
3. mdsc_negotiation
4. mdsc_qoe
5. mdsc_rmconnectionevent
6. mdsc_webrtc_session
7. mdss_mediadiagnostics
8. mdss_qoe
9. skypecosi_concore_callcontroller_multipartycallleg
10. skypecosi_concore_callcontroller_notificationdelivery
11. skypecosi_concore_callcontroller_twopartycall
12. skypecosi_concore_native_callsignalingagent_callmodality
13. skypecosi_concore_native_callsignalingagent_contentsharing
14. skypecosi_concore_native_callsignalingagent_conversation
15. skypecosi_concore_native_callsignalingagent_httprequest
16. skypecosi_concore_native_ts_calling_call_setup_session
17. skypecosi_concore_native_ts_calling_in_call_session
18. skypecosi_concore_web_csa_conversation_callmodality
19. skypecosi_concore_web_csa_conversation_contentsharing
20. skypecosi_concore_web_csa_conversation_httprequest
21. skypecosi_concore_web_ts_calling_call_setup_session
22. skypecosi_concore_web_ts_calling_in_call_session
23. skypecosi_conversation_participant_join
24. skypecosi_conversation_report
25. skypecosi_pstn_routing
26. skypemc_mpc_mediasessionterminated

---

## Tab 4: Quality of Experience

### Network Path Diagram
Visual diagram showing: **Client** <-> **MP** (Media Processor) <-> **SBC** (Session Border Controller)
- Inbound/Outbound sections for each hop
- Shows: Codec, BurstGapLoss, Utilization_Packets, Delay_RoundTripMax, PacketLoss_LossRateMax, NetworkJitterMax

### Filtering
- **Criteria type:** Contains (dropdown)
- **Input string:** Text filter
- **Regular Expression** checkbox
- **Add** button to apply filter
- **Saved filters** dropdown with presets

### QoE Data Table
Key-Value table with metrics grouped by endpoint type:

**Endpoint Types:**
- `Gvc_Business_RP_NgcMd` - Relay Proxy (business)
- `Gvc_Business_NgcMd` - Direct (business)
- `Client_Consumer` - Consumer client
- `Bot` - Bot endpoints

**Key Metrics:**
| Metric | Description |
|--------|-------------|
| `PayloadDescription` | Audio codec (SATINFullband, SILKWide, etc.) |
| `Network_Utilization_Packets` | Packet count (inbound/outbound) |
| `Network_Delay_RoundTripMax` | Max round-trip delay (ms) |
| `Network_PacketLoss_LossRateMax` | Max packet loss rate |
| `Payload_Audio_v4_NetworkJitterMax` | Max network jitter |
| `iceClientType` | ICE type (FullIce) |
| `Description_Connectivity_Ice` | Connection type (RELAY, DIRECT) |
| `Description_Security` | Security protocol (SRTPV2, SRTP) |
| `Network_BurstGapLoss_BurstDuration` | Burst loss duration |
| `Network_Jitter_InterArrivalMax` | Max inter-arrival jitter |

### Pagination
- 50 rows per page, 2 pages for this call
- Export Data link (blob URL)

---

## Data Model Summary

### Call Flow Message
```typescript
interface CallFlowMessage {
  sequenceNumber: number;
  timestamp: string;          // ISO 8601
  duration: number;           // milliseconds
  httpMethod: string;         // GET, POST, PUT, TROUTER
  url: string;                // relative or full URL
  sourceService: ServiceColumn;
  targetService: ServiceColumn;
  httpStatus?: number;
  code?: number;
  subCode?: number;
  request: {
    headers: Record<string, string>;
    body: string;             // JSON string
  };
  response: {
    headers: Record<string, string>;
    body: string;             // JSON string
  };
}

type ServiceColumn =
  | 'Originator' | 'Conv' | 'CC' | 'Target' | 'MC'
  | 'MPAAS' | 'MPaaS:IVR' | 'PNH' | 'PMA' | 'Agent'
  | 'Runtime API' | 'External';
```

### Call Leg
```typescript
interface CallLeg {
  userId: string;             // orgid or hash
  description: string;        // "Skype join : success"
  clientVersion: string;      // CSA version
  participantId: string;      // GUID
  endCode: string;            // "N/A" or numeric
  endSubCode: string;         // "N/A" or numeric (5027, 5003, etc.)
  endpointId: string;         // GUID
  isBot: boolean;
  callType: string;           // "MultiParty Call"
  clientType: string;         // "Native CSA"
}
```

### QoE Metric
```typescript
interface QoeMetric {
  key: string;                // dotted path e.g. "Gvc_Business_NgcMd.mediaLine_InboundStream_..."
  value: string | number;
  endpointType: string;       // Gvc_Business_RP_NgcMd, Client_Consumer, Bot, etc.
  direction: 'Inbound' | 'Outbound';
  category: string;           // Network, Payload, Description
}
```

---

## Key Observations for TaskDock Clone

### What to Keep
1. **4-tab structure** - All tabs serve distinct diagnostic purposes
2. **AI Summary** - Very useful, keep as a panel
3. **Call Flow sequence diagram** - Core visualization with service columns
4. **Message detail** - Full request/response view is essential
5. **QoE metrics** - Key-value format with network diagram
6. **Call Leg Drill Down** - Per-user view with expandable legs
7. **Search/Filter** - Call ID search, message filters, QoE filters

### What to Improve (AI-Friendly Enhancements)
1. **Smarter filtering** - Natural language search ("show me errors", "find timeout issues")
2. **AI analysis per message** - Annotate each message with significance
3. **Error correlation** - Automatically link errors across legs/messages
4. **Timeline view** - Visual timeline instead of paginated list
5. **Diff between calls** - Compare a good call vs. bad call
6. **Auto-diagnosis** - AI-driven root cause analysis
7. **Participant journey** - Follow a single participant across all events
8. **Export to AI context** - Generate AI-friendly summaries (TOON format from scripts)

### API Integration Strategy
1. Use token acquisition from `C:\git\scripts\gather-cfv-secrets.py`
2. Implement async query pattern with polling in Tauri backend
3. Cache call data locally to avoid re-downloading 10MB+ per view
4. Stream call flow data to UI progressively (like CFV does)
5. Parse and index messages for fast search/filter

### Technology Notes
- CFV uses: React/Fluent UI, Pivot components, Application Insights telemetry
- Our stack: TypeScript/Tauri with custom web components
- We'll need: SVG/Canvas for sequence diagram, virtual scrolling for 6000+ messages
