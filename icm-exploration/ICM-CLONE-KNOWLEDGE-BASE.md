# ICM Clone Knowledge Base for TaskDock

## 1. Authentication Flow

### Token Acquisition (using C:\git\scripts approach)
1. **Playwright + Edge Profile** - Leverages existing SSO session from Edge browser
2. Navigate to `https://portal.microsofticm.com/imp/v3/incidents/search/advanced`
3. Redirect chain: Page -> `/sso2/` -> Identity Provider Selection -> OAuth2/OIDC -> Bearer token
4. **Token exchange**: `POST /sso2/token` with `grant_type=cookie` returns a Bearer JWT
5. Cache tokens to `%LOCALAPPDATA%\BrainBot\icm_tokens.json`

### Identity Providers
| Provider | Value | Notes |
|----------|-------|-------|
| Microsoft Entra ID (OIDC) | `EntraID-OIDC` | Primary, preferred |
| Microsoft Entra ID (Legacy) | `AzureActiveDirectory` | Fallback |
| Datacenter STS | `IcMdSTS` | SAW/campus/VPN only |
| Datacenter STS China | `IcMdSTSMooncake` | @cme.gbl only |

### OAuth Details
- **Client ID**: `0c421fa6-202b-435d-a693-909bfe7a1cc2`
- **Redirect URI**: `https://portal.microsofticm.com/sso2/`
- **Scopes**: `openid profile`
- **Response Type**: `code id_token`

---

## 2. API Endpoints (All use Bearer JWT auth)

### 2.1 Portal API (`portal.microsofticm.com`)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/sso2/token` | Exchange cookie for Bearer JWT |
| GET | `/imp/api/contact/GetCurrentUser` | Get logged-in user info |
| GET | `/imp/api/UserSettings/TimeZones` | Available timezones |

### 2.2 Incident API (`prod.microsofticm.com/api2`)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/incidentapi/incidents?$filter=...&$top=100&$select=...&$expand=...` | **Query incidents** (OData) |
| GET | `/incidentapi/IncidentCount?$filter=...` | Count incidents for a query |
| GET | `/incidentapi/incidents({id})` | **Get single incident** |
| GET | `/incidentapi/incidents({id})/Bridges` | Get bridges for incident |
| GET | `/incidentapi/alertSources?$filter=AlertSourceId eq {guid}` | Alert source lookup |
| GET | `/incidentapi/serviceFieldValues?$filter=...` | Service field values |
| POST | `/incidentapi/GetFavoriteQueries?$orderby=Query/Name` | Get user's favorite queries |
| POST | `/incidentapi/GetContactQueries?$filter=Criteria ne null&$orderby=Name` | Get saved queries |

### 2.3 Metadata API (`prod.microsofticm.com/api2`)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/metadataapi/propertygroups?$filter=(Id eq 'Default')` | Property group definitions |
| GET | `/metadataapi/properties/GetSavedQueryProperties?propertyIds=...` | Query property definitions |

### 2.4 Search/Directory API (`prod.microsofticm.com/api2`)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/search/teams?$filter=Id eq {id}` | Team lookup by ID |
| GET | `/search/services?$filter=Id eq {id}` | Service lookup by ID |
| GET | `//directory/cloudinstances` | Cloud instances |
| POST | `/user/mscontact-bulk` | Bulk contact resolution |
| POST | `/user/auth/HasPermissionOnAnyTenantBulk` | Permission check |
| GET | `/auth/GetAllPermissions` | All user permissions |

### 2.5 On-Call API (`oncallapi.prod.microsofticm.com`)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `//Directory/Teams?$select=...&$expand=OwningService(...)&$filter=Id eq {id}` | Team details with service info |

### 2.6 User Preferences API (`upsapi.prod.microsofticm.com`)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/UniversalPreferencesService/Domains('ICM')/Scopes('SPA')/Preferences?$filter=...` | User preferences |
| GET | `/UniversalPreferencesService/Domains('ICM')/Scopes('incidents')/Flighting.GetFeatures(...)` | Feature flags per user |
| GET | `/UniversalPreferencesService/Domains('ICM')/Scopes('shell')/Flighting.GetFeatures(...)` | Shell feature flags |
| GET | `/UniversalPreferencesService/Domains('ICM')/Scopes('administration')/Flighting.GetFeatures(...)` | Admin feature flags |
| POST | `.../Flighting.GetFeaturesBulkByEntities` | Bulk feature flags for teams/services |

### 2.7 Collaboration API (`prod.microsofticm.com/api2`)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/user/msteams/collaborationworkspace?IncidentId={id}&ChannelType=Partner` | Teams channel for incident |
| GET | `/user/ActionCenterApi/SearchEvents?Channel=BreakingNews` | Breaking news events |

### 2.8 Outage API (`outageapi.prod.microsofticm.com`)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/outage/outages/brandmapv2` | Brand map for outages |

### 2.9 OData Query Patterns
The incident API uses OData v4 query syntax:
```
$filter=(OwningTeamId eq 31050 or OwningTeamId eq 85346) and State ne 'Resolved'
$top=100
$select=Id,Severity,OwningTenantName,State,Title,CreatedDate,OwningTeamName,...
$expand=CustomFields,AlertSource
$orderby=CreatedDate desc
```

**Common filter fields**: `OwningTeamId`, `OwningServiceId`, `State`, `Severity`, `AlertSource/AlertSourceId`, `MonitorLocation/Instance`, `Keywords`, `Type`, `ParentId`

---

## 3. UI Structure & Components

### 3.1 Global Shell (All Pages)
```
+------------------------------------------------------------------+
| [Apps] [IcM Logo]    [Search Bar]   [IcM Assistant] [Help] [Tz]  |
|                                      [News] [Profile: Name]      |
+------+-----------------------------------------------------------+
| Nav  |  Main Content Area                                        |
|------|                                                           |
| Dash |                                                           |
| Inci |                                                           |
| Outg |                                                           |
| Retr |                                                           |
| OnCl |                                                           |
| Auto |                                                           |
| Rptg |                                                           |
| Admin|                                                           |
+------+-----------------------------------------------------------+
```

**Top Bar Elements:**
- Applications switcher (Microsoft 365 apps)
- IcM logo/home link
- Global search bar ("Search by incident ID or other fields...")
- IcM Assistant (AI chatbot)
- Help & Support menu
- Report a Bug link
- Feedback toggle
- Timezone preferences (shows current: PST, UTC, etc.)
- Breaking News alerts
- User Profile with name

**Left Navigation:**
- Dashboard
- Incidents (expandable)
- Outages (expandable)
- Retrospectives
- On call lists (expandable)
- Agent Studio (Automation)
- Reporting (expandable)
- Administration (expandable)

### 3.2 Advanced Search Page (`/incidents/search/advanced`)

**Left Panel - Query Sidebar:**
- "Create Query" button
- **Built-in Queries:**
  - My Incidents
  - My Teams' Incidents
  - My Services' Incidents
  - My Tracked Incidents
  - My Phone Notification History
  - My Restricted Incidents
  - My EUDB Services' Incidents
  - GDCO Incidents
- **Tree Structure:**
  - My Favorite (expandable, contains saved favorites)
  - My Queries (expandable, organized in folders like "Default")
  - Shared Queries (expandable)
  - Basic Query (inline query builder)

**Basic Query Builder:**
- IcM Instance dropdown (PUBLIC, etc.)
- Service/Team selector with tabs: Service | Contact | All
- Search services or teams textbox
- Date Range picker
- Environment dropdown
- State dropdown
- Severity dropdown
- Acknowledged dropdown
- "Save As" and "Run" buttons

**Right Panel - Results Area:**

**Toolbar:**
| Button | State | Purpose |
|--------|-------|---------|
| Results tab | Active tab | Shows query results |
| Editor tab | | Shows query editor |
| Create Query | | Create new query |
| Run | | Execute current query |
| Export to Excel | | Export results |
| Settings | | Column/display settings |
| Switch to Parent and Child View | | Toggle parent/child hierarchy |
| Subscribe in Teams | | Create Teams subscription |
| Edit | Disabled until selection | Edit selected incidents |
| Acknowledge | Disabled until selection | Ack selected |
| Transfer | Disabled until selection | Transfer ownership |
| Link | Disabled until selection | Link incidents |
| Mitigate | Disabled until selection | Mark mitigated |
| Resolve | Disabled until selection | Mark resolved |
| Show More | | More bulk actions |

**Results Grid Columns:**
| Column | Sortable | Description |
|--------|----------|-------------|
| Select All (checkbox) | No | Bulk select |
| ID | Yes | Incident number (clickable link) |
| Severity | Yes | 1-4, 25 |
| Owning Service | Yes | Service name |
| State | Yes | Active, Mitigated, Resolved |
| Title | Yes | Incident title (clickable link) |
| Create Time | Yes | Timestamp with timezone |
| Owning Team | Yes | Team name |
| Owner | Yes | Contact alias |
| Notification Status | Yes | "Acknowledged by X" / "Not Acknowledged" |
| Hit Count | Yes | Number of hits |
| Child Count | Yes | Number of child incidents |

**Pagination:** `1 - N of N items` with `<<` `<` `page#` `>` `>>`
**Auto Refresh:** OFF | 1m | 5m | 10m

### 3.3 Incident Detail Page (`/incidents/details/{id}/summary`)

**Top Card (Header):**
- Incident number + "created by [Contact Name]"
- Copy button (copies incident details)
- Collapse button
- **Title** (editable)
- **Status bar:** Status | Severity (dropdown) | Duration (live timer) | Owning Service (transfer button) | Owning Team (transfer button) | Owner (combobox) | Tags (add/remove)

**Action Bar:**
| Button | Purpose |
|--------|---------|
| Find | Search within incident |
| Track | Track/untrack incident |
| Links | External links |
| Attachments | File attachments |
| More actions | Additional actions menu |
| Declare outage | Create outage from incident |
| Create bridge | Create bridge call |
| Transfer | Transfer to another team |
| Request assistance | Ask another team for help |
| Mitigate | Change lifecycle to mitigated |
| More lifecycle actions | Dropdown: Resolve, Reactivate, etc. |

**Tabs:**

#### Tab 1: Summary & Discussion
- **AI Summary by IcM Assistant** - Collapsible widget with auto-generated summary
  - Refresh button, fullscreen, collapse
- **Authored Summary** - Editable rich text area
  - Edit, Fullscreen, Collapse buttons
- **Discussion Thread** - Chronological comment feed
  - Text editor with rich text toolbar (PII warning)
  - Cancel/Save buttons
  - Search/filter discussion
  - Each comment shows:
    - Contact avatar + name
    - Timestamp ("Submitted at 2026-02-07 22:03:58 PST")
    - Comment body (rich text, tables, links)
    - Like/Dislike counters
    - Comment type badge: "Discussion" or "Enrichment"
    - "Run by workflow" link for automated enrichments

#### Tab 2: Impact Assessment
- Customer impact details, affected tenants, regions
- Impact start/end times

#### Tab 3: Troubleshooting
- Troubleshooting steps, diagnostic data
- Root cause analysis

#### Tab 4: Mitigation & Resolution
- Mitigation details, resolution notes
- Timeline of actions taken

#### Tab 5: Retrospective
- Post-incident review
- Lessons learned, action items

#### Tab 6: Custom Fields
- Service-specific custom metadata fields
- Key-value pairs configurable per service

#### Tab 7: Activity Log
- Complete audit trail of all changes
- Who did what, when

### 3.4 Incident Data Model (from API `$select`)
```typescript
interface Incident {
  Id: number;                    // e.g., 744629864
  Severity: number;              // 1, 2, 3, 4, 25
  State: string;                 // "Active", "Mitigated", "Resolved"
  Title: string;
  CreatedDate: string;           // ISO datetime
  OwningTenantName: string;      // Service name
  OwningTeamName: string;        // Team name
  OwningServiceId: number;
  OwningTeamId: number;
  ContactAlias: string;          // Owner alias
  NotificationStatus: string;    // "Acknowledged by X" or "Not Acknowledged"
  HitCount: number;
  ChildCount: number;
  ParentId: number | null;
  IsCustomerImpacting: boolean;
  IsNoise: boolean;
  IsOutage: boolean;
  ExternalLinksCount: number;
  AcknowledgeBy: string;
  ImpactStartTime: string;
  MitigateData: object;
  CustomFields: CustomField[];
  AlertSource: AlertSource;

  // Detail view additional fields:
  CreatedBy: string;             // email
  Duration: string;              // "1d 10h 53m"
  Tags: string[];                // e.g., ["Teams Impact"]
  Summary: string;               // Rich text
  Discussion: DiscussionEntry[];
}

interface DiscussionEntry {
  Author: string;                // alias or email
  AuthorDisplayName: string;
  SubmittedAt: string;           // datetime
  Body: string;                  // rich text (HTML)
  Likes: number;
  Dislikes: number;
  Type: "Discussion" | "Enrichment";
  WorkflowName?: string;         // if automated
}

interface AlertSource {
  AlertSourceId: string;         // GUID
  Name: string;
}

interface CustomField {
  Name: string;
  Value: string;
}
```

---

## 4. Key Features for TaskDock ICM Clone

### 4.1 Must-Have Features
1. **Incident List View** - Grid with sortable columns, pagination, auto-refresh
2. **Incident Detail View** - Full detail with all 7 tabs
3. **Query System** - Built-in queries + custom saved queries + favorites
4. **Authentication** - Reuse existing Playwright-based token acquisition
5. **Discussion Thread** - Rich text comments with timestamps
6. **Bulk Actions** - Select multiple incidents, acknowledge, transfer, mitigate, resolve
7. **Transfer Ownership** - Change owning team/service/contact
8. **Search** - Global incident search by ID or keywords
9. **Severity Management** - Change severity with reason
10. **Tags** - Add/remove tags on incidents

### 4.2 AI Enhancement Opportunities (Making it "more AI friendly")
1. **AI-Powered Incident Summarization** - ICM already has "IcM Assistant" for summaries. TaskDock can do better:
   - Auto-summarize discussion threads
   - Extract key facts: affected tenants, root cause, impact
   - Generate timeline of events from discussion
2. **Smart Routing** - ICM has "PRISM" for routing suggestions. TaskDock can:
   - Analyze incident text to suggest owning team
   - Detect duplicate incidents automatically
   - Recommend similar resolved incidents
3. **Intelligent Triage** - Automatically:
   - Suggest severity based on impact description
   - Flag SLA violations
   - Highlight incidents needing attention (no acknowledgement, aging, etc.)
4. **Natural Language Querying** - Instead of OData filters:
   - "Show me all active sev2 incidents for MeetingsCore from this week"
   - "Which incidents haven't been acknowledged in 24 hours?"
5. **Discussion Analysis** - Parse discussion threads to:
   - Extract action items
   - Identify blockers
   - Suggest next steps
   - Detect escalation patterns
6. **Cross-Incident Intelligence** - Correlate across incidents:
   - Pattern detection (are multiple teams seeing similar issues?)
   - Impact blast radius estimation
   - Root cause grouping

### 4.3 Navigation Structure for TaskDock
```
TaskDock ICM Module:
  /icm/dashboard          - Overview with key metrics
  /icm/incidents          - Incident list (advanced search)
  /icm/incidents/:id      - Incident detail
  /icm/on-call            - On-call schedules
  /icm/queries            - Saved queries management
```

---

## 5. API Call Patterns for Implementation

### 5.1 Initial Page Load Sequence
1. `POST /sso2/token` (grant_type=cookie) -> Bearer token
2. `GET /imp/api/contact/GetCurrentUser` -> User info
3. `GET /imp/api/UserSettings/TimeZones` -> Timezone list
4. `GET /api2/metadataapi/propertygroups?$filter=(Id eq 'Default')` -> Property definitions
5. `POST /api2/incidentapi/GetFavoriteQueries` -> User's favorites
6. `POST /api2/incidentapi/GetContactQueries` -> User's saved queries
7. `GET /api2/auth/GetAllPermissions` -> User permissions
8. `GET /UniversalPreferencesService/.../Preferences` -> User preferences
9. `GET /UniversalPreferencesService/.../Flighting.GetFeatures` -> Feature flags

### 5.2 Running a Query
1. `GET /api2/incidentapi/IncidentCount?$filter=...` -> Total count
2. `GET /api2/incidentapi/incidents?$filter=...&$top=100&$select=...&$expand=...` -> Results
3. For each team/service ID in results: `GET /api2/search/teams?$filter=Id eq {id}` -> Team details
4. For each alert source: `GET /api2/incidentapi/alertSources?$filter=...` -> Alert source details
5. `POST /api2/user/mscontact-bulk` -> Resolve contact display names

### 5.3 Viewing Incident Detail
1. `GET /api2/incidentapi/incidents({id})` -> Full incident data
2. `GET /api2/user/msteams/collaborationworkspace?IncidentId={id}` -> Teams channel
3. `GET /api2/incidentapi/incidents({id})/Bridges` -> Bridge info
4. `GET /oncallapi/Directory/Teams?...&$filter=Id eq {teamId}` -> On-call team info

### 5.4 Authentication Headers
All API calls require:
```
Authorization: Bearer eyJhbGciOiJSU...  (JWT from /sso2/token)
```

---

## 6. Differences Between Our Clone and Original ICM

| Aspect | ICM Portal | TaskDock ICM Clone |
|--------|------------|-------------------|
| Auth | Browser SSO | Token from scripts/gather-icm-secrets.py |
| Frontend | React SPA (webpack module federation) | Tauri + our existing frontend stack |
| API calls | Direct from browser | Through Tauri backend proxy |
| AI features | Basic IcM Assistant + PRISM routing | Full AI analysis per incident |
| Query language | OData filter builder | Natural language + OData |
| Notifications | Browser + phone | Native Windows toast (already built) |
| Discussion | Rich text only | Rich text + AI-assisted drafting |

---

## 7. Technical Notes

- ICM uses **Webpack Module Federation** (v5/fast/remoteEntry.js) for micro-frontend architecture
- The v3 and v5 URL paths coexist - v5 is the newer React-based UI for incident details
- **Dark theme** is supported (detected "ThemeOnInit - dark" in console)
- APIs follow **OData v4** conventions with `$filter`, `$select`, `$expand`, `$top`, `$orderby`
- Telemetry goes to `dc.services.visualstudio.com` (Application Insights) and `j.clarity.ms` (Clarity)
- CDN for static assets: `icmcdn.akamaized.net`
- Version checking: `GET /imp/v3/version.json?timestamp=...`
