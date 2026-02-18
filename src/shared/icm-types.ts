// ICM (Incident Management) API Types

// ==================== Core Entities ====================

export interface IcmIncident {
  Id: number;
  Severity: number;
  State: string;
  Title: string;
  CreatedDate: string;
  LastModifiedDate?: string;
  OwningTenantName: string;
  OwningTeamName: string;
  OwningServiceId: number;
  OwningTeamId: number;
  ContactAlias: string;
  NotificationStatus: string;
  HitCount: number;
  ChildCount: number;
  ParentId: number | null;
  IsCustomerImpacting: boolean;
  IsNoise: boolean;
  IsOutage: boolean;
  ExternalLinksCount: number;
  AcknowledgeBy: string;
  ImpactStartTime: string;
  MitigateData?: { MitigateTime?: string | null; MitigatedBy?: string | null; MitigationSteps?: string | null } | null;
  ResolveData?: { ResolveTime?: string | null; ResolvedBy?: string | null } | null;
  CustomFields: IcmCustomField[];
  AlertSource: IcmAlertSource | null;
  CreatedBy: string;
  Duration: string;
  Tags: string[];
  Summary: string;
  Discussion?: IcmDiscussionEntry[];
  Type?: string;
  Keywords?: string;
  Environment?: string;
  Description?: string;
  ModifiedBy?: string;
}

export interface IcmIncidentListItem {
  Id: number;
  Severity: number;
  State: string;
  Title: string;
  CreatedDate: string;
  OwningTenantName: string;
  OwningTeamName: string;
  OwningServiceId: number;
  OwningTeamId: number;
  ContactAlias: string;
  NotificationStatus: string;
  HitCount: number;
  ChildCount: number;
  ParentId: number | null;
  IsCustomerImpacting: boolean;
  IsNoise: boolean;
  IsOutage: boolean;
  ExternalLinksCount: number;
  AcknowledgeBy: string;
  ImpactStartTime: string;
  CustomFields?: IcmCustomField[];
  AlertSource?: IcmAlertSource | null;
}

export interface IcmDiscussionEntry {
  Author: string;
  AuthorDisplayName: string;
  SubmittedAt: string;
  Body: string;
  Likes: number;
  Dislikes: number;
  Type: 'Discussion' | 'Enrichment';
  WorkflowName?: string;
}

export interface IcmContact {
  Id: number;
  ObjectId?: string;
  Alias: string;
  AliasShort?: string;
  DisplayName?: string;
  FullName?: string;
  EmailAddress: string;
  IsActive?: boolean;
  Status?: string;
  TenantId?: string;
  Teams?: Record<string, IcmContactTeam>;
}

export interface IcmContactTeam {
  Id: number;
  Name: string;
  ServiceId: number;
  ServiceName: string;
  EmailAddress?: string;
  IsAssignable?: boolean;
  IsPrivate?: boolean;
}

// ==================== Organizational Entities ====================

export interface IcmTeam {
  Id: number;
  Name: string;
  Description?: string;
  OwningService?: IcmService;
  TenantId?: string;
  IsActive?: boolean;
}

export interface IcmService {
  Id: number;
  Name: string;
  Description?: string;
  TenantId?: string;
  IsActive?: boolean;
}

// ==================== Queries ====================

export interface IcmQuery {
  QueryId: number;
  Id?: string;
  Name: string;
  ContactId?: number;
  Criteria: string | null;
  IsShared?: boolean;
  Folder?: string;
  TenantId?: number;
  TeamId?: number;
  CreatedDate?: string;
  ModifiedDate?: string;
  MigrationDate?: string | null;
}

export interface IcmFavoriteQuery {
  OwnerId: number;
  OwnerType: string;
  Query: IcmQuery;
  SortOrder?: number;
}

// ==================== Metadata & Configuration ====================

export interface IcmAlertSource {
  AlertSourceId: string;
  Name: string;
}

export interface IcmCustomField {
  Name: string;
  Description?: string;
  StringValue?: string | null;
  NumberValue?: number | null;
  BooleanValue?: boolean | null;
  EnumValue?: string | null;
  DateTimeOffsetValue?: string | null;
}

export interface IcmBridge {
  Id: number;
  BridgeUrl?: string;
  BridgePhoneNumber?: string;
  BridgeType?: string;
  Status?: string;
  CreatedDate?: string;
}

export interface IcmPropertyGroup {
  Id: string;
  Name: string;
  Properties?: IcmProperty[];
}

export interface IcmProperty {
  Id: string;
  Name: string;
  Type: string;
  AllowedValues?: string[];
}

export interface IcmCloudInstance {
  Id: string;
  Name: string;
  Description?: string;
}

// ==================== User & Preferences ====================

export interface IcmUserPreferences {
  Key: string;
  Value: string;
}

export interface IcmFeatureFlags {
  [featureName: string]: boolean | string;
}

export interface IcmPermission {
  PermissionName: string;
  IsGranted: boolean;
}

// ==================== Response Wrappers ====================

export interface IcmODataResponse<T> {
  value: T[];
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
}

export interface IcmTeamsChannel {
  ChannelId: string;
  ChannelUrl?: string;
  TeamId?: string;
  TeamName?: string;
}

export interface IcmBreakingNewsEvent {
  Id: string;
  Title: string;
  Description?: string;
  CreatedDate?: string;
  Channel: string;
}

// ==================== Token Cache ====================

export interface IcmTokenCache {
  cookie: string;
  cookies_count: number;
  bearer_token?: string;
  [key: string]: any;
}

// ==================== Query/Filter Builders ====================

export interface IcmQueryFilter {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'ge' | 'le' | 'contains';
  value: string | number | boolean;
}

export type IcmSortDirection = 'asc' | 'desc';

export interface IcmSortOrder {
  field: string;
  direction: IcmSortDirection;
}

export interface IcmQueryOptions {
  filter?: string;
  top?: number;
  select?: string;
  expand?: string;
  orderby?: string;
}

// ==================== Incident State Constants ====================

export const ICM_STATES = ['Active', 'Mitigated', 'Resolved'] as const;
export type IcmState = (typeof ICM_STATES)[number];

export const ICM_SEVERITIES = [1, 2, 3, 4, 25] as const;
export type IcmSeverity = (typeof ICM_SEVERITIES)[number];

export const ICM_SEVERITY_COLORS: Record<number, string> = {
  1: '#d13438',
  2: '#ff8c00',
  3: '#ffaa44',
  4: '#498205',
  25: '#ff8c00',
};

export const ICM_STATE_COLORS: Record<string, string> = {
  Active: '#d13438',
  Mitigated: '#ff8c00',
  Resolved: '#498205',
};

// ==================== Criteria Compiler ====================

/** Maps ICM query FieldId to OData field path (from /metadataapi/propertygroups) */
const ICM_FIELD_MAP: Record<string, string> = {
  '1': 'Title',
  '2': 'OccuringLocation/Environment',
  '3': 'CreatedDate',
  '4': 'AssignedTo',
  '7': 'OwningTeamId',
  '8': 'Severity',
  '9': 'ContactAlias',
  '13': 'Id',
  '14': 'ResolveData/ResolvedBy',
  '19': 'RootCauseOption',
  '21': 'RootCauseNeedsInvestigation',
  '22': 'Keywords',
  '24': 'MonitorId',
  '25': 'SubscriptionId',
  '26': 'SupportTicketId',
  '29': 'HowFixed',
  '31': 'ResponsibleServiceId',
  '32': 'TsgInfo/TsgLink',
  '33': 'ImpactedServices/ServiceId',
  '34': 'ImpactedTeams/TeamId',
  '36': 'CustomerName',
  '38': 'CreatedBy',
  '41': 'MonitorLocation/Datacenter',
  '42': 'OccuringLocation/Datacenter',
  '43': 'MonitorLocation/Role',
  '44': 'OccuringLocation/Role',
  '45': 'MonitorLocation/Instance',
  '46': 'OccuringLocation/Instance',
  '49': 'MonitorLocation/Slice',
  '50': 'OccuringLocation/Slice',
  '51': 'LastModifiedDate',
  '52': 'IsSecurityRisk',
  '53': 'IsNoise',
  '54': 'State',
  '55': 'Type',
  '56': 'SubType',
  '58': 'ModifiedBy',
  '59': 'AcknowledgeTime',
  '60': 'AcknowledgeBy',
  '62': 'ResolveData/ResolveTime',
  '63': 'AlertSource/AlertSourceId',
  '66': 'AlertSource/TypeId',
  '67': 'IsCustomerImpacting',
  '68': 'Postmortem/Id',
  '69': 'LinkedIncidentCount',
  '70': 'SourceCreateTime',
  '71': 'ChildCount',
  '72': 'HitCount',
  '73': 'ParentId',
  '74': 'ImpactStartTime',
  '75': 'MitigateData/MitigateTime',
  '76': 'LastCorrelationTime',
  '77': 'SourceOrigin',
  '78': 'ExternalLinksCount',
  '79': 'IsAcknowledged',
  '81': 'PastOwningServices/ServiceId',
  '82': 'ServiceCategoryId',
  '83': 'CloudInstanceId',
  '84': 'TrackingTeams/TeamId',
  '85': 'SourceIncidentId',
  '86': 'MitigateData/MitigatedBy',
  '87': 'IsOutage',
  '89': 'Summary',
  '90': 'OutageDeclaredDate',
  '91': 'ResponsibleTeamId',
  '92': 'IncidentManagerContactId',
  '93': 'CommunicationsManagerContactId',
  '94': 'OutageImpactLevel',
  '95': 'ExecutiveIncidentManagerContactId',
  '96': 'Tags',
  '97': 'ImpactedEntities/EntityId',
  '98': 'IsRootCauseSpecified',
  '99': 'IsSupportEngagement',
  '101': 'OwningServiceId',
  '102': 'OriginatingServiceId',
  '153': 'RoutingId',
  '154': 'CorrelationId',
  '164': 'Description',
  '173': 'AzureSupportTickets/Severity',
  '174': 'AzureSupportTickets/Status',
};

/** Fields that use GUID type in OData (must not be quoted) */
const GUID_FIELDS = new Set(['AlertSource/AlertSourceId']);

interface CriteriaItem {
  id: number;
  Verb?: string;
  Operator?: string;
  FieldId?: string;
  Value?: string;
  DateTimeValue?: string;
  parentId?: number;
  items?: CriteriaItem[];
}

/**
 * Compile ICM saved query Criteria JSON into an OData $filter string.
 * Returns undefined if the criteria cannot be parsed.
 */
export function compileIcmCriteria(criteriaJson: string): string | undefined {
  try {
    const root = JSON.parse(criteriaJson);
    const items: CriteriaItem[] = root.items || root;
    if (!Array.isArray(items) || items.length === 0) return undefined;
    return compileGroup(items);
  } catch {
    return undefined;
  }
}

function compileGroup(items: CriteriaItem[]): string {
  const parts: string[] = [];

  for (const item of items) {
    if (item.items && item.items.length > 0) {
      const sub = compileGroup(item.items);
      if (sub) parts.push(`(${sub})`);
    } else if (item.FieldId && item.Operator) {
      const expr = compileLeaf(item);
      if (expr) parts.push(expr);
    }
  }

  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];

  // ICM criteria groups use a uniform connector; the second item's Verb determines it
  const groupConnector = items.length > 1 && items[1]?.Verb === 'or' ? ' or ' : ' and ';
  return parts.join(groupConnector);
}

/** Fields that are numeric in OData (no quotes) */
const NUMERIC_FIELDS = new Set([
  'Id', 'OwningTeamId', 'OwningServiceId', 'ResponsibleServiceId', 'ResponsibleTeamId',
  'OriginatingServiceId', 'Severity', 'HitCount', 'ChildCount', 'LinkedIncidentCount',
  'ExternalLinksCount', 'ParentId', 'ServiceCategoryId',
  'CloudInstanceId', 'IncidentManagerContactId', 'CommunicationsManagerContactId',
  'ExecutiveIncidentManagerContactId', 'AlertSource/TypeId', 'Postmortem/Id',
  'ImpactedServices/ServiceId', 'ImpactedTeams/TeamId', 'TrackingTeams/TeamId',
  'PastOwningServices/ServiceId', 'AzureSupportTickets/Severity', 'AzureSupportTickets/Status',
]);

/** Fields that are boolean in OData (no quotes, use true/false) */
const BOOLEAN_FIELDS = new Set([
  'IsSecurityRisk', 'IsNoise', 'IsCustomerImpacting', 'IsAcknowledged',
  'IsOutage', 'IsRootCauseSpecified', 'IsSupportEngagement', 'RootCauseNeedsInvestigation',
]);

function compileLeaf(item: CriteriaItem): string | undefined {
  const field = ICM_FIELD_MAP[item.FieldId!];
  if (!field) return undefined;

  const op = item.Operator?.toLowerCase();
  const value = item.DateTimeValue || item.Value;
  if (value === undefined) return undefined;

  // Handle date relative values like "@Today", "@Today - 60", "@Today + 7"
  if (item.DateTimeValue && item.DateTimeValue.includes('@Today')) {
    const d = new Date();
    const offsetMatch = item.DateTimeValue.match(/@Today\s*([+-])\s*(\d+)/);
    if (offsetMatch) {
      const sign = offsetMatch[1] === '+' ? 1 : -1;
      d.setDate(d.getDate() + sign * parseInt(offsetMatch[2]));
    }
    return `${field} ${op} ${d.toISOString()}`;
  }

  // Determine value formatting based on field type
  const isNumeric = NUMERIC_FIELDS.has(field);
  const isGuid = GUID_FIELDS.has(field);
  const isBoolean = BOOLEAN_FIELDS.has(field);
  // Numeric, GUID, and boolean fields are not quoted in OData
  const unquoted = isNumeric || isGuid || isBoolean;

  switch (op) {
    case 'eq':
    case 'ne':
    case 'gt':
    case 'lt':
    case 'ge':
    case 'le':
      return unquoted
        ? `${field} ${op} ${value}`
        : `${field} ${op} '${value}'`;
    case 'contains':
      return `contains(${field}, '${value}')`;
    case 'notcontains':
      return `not contains(${field}, '${value}')`;
    default:
      return undefined;
  }
}
