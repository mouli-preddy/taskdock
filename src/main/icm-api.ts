import type {
  IcmIncident,
  IcmIncidentListItem,
  IcmDiscussionEntry,
  IcmContact,
  IcmTeam,
  IcmService,
  IcmFavoriteQuery,
  IcmQuery,
  IcmAlertSource,
  IcmBridge,
  IcmODataResponse,
  IcmUserPreferences,
  IcmFeatureFlags,
  IcmPermission,
  IcmQueryFilter,
  IcmQueryOptions,
  IcmTeamsChannel,
  IcmBreakingNewsEvent,
  IcmPropertyGroup,
  IcmCloudInstance,
} from '../shared/icm-types.js';
import type { IcmAuthService } from './icm-auth.js';

// API host constants
const PORTAL_HOST = 'https://portal.microsofticm.com';
const PROD_API_HOST = 'https://prod.microsofticm.com/api2';
const ONCALL_API_HOST = 'https://oncallapi.prod.microsofticm.com';
const UPS_API_HOST = 'https://upsapi.prod.microsofticm.com/UniversalPreferencesService';

export class IcmApiClient {
  private authService: IcmAuthService;

  constructor(authService: IcmAuthService) {
    this.authService = authService;
  }

  // ==================== Token Management ====================

  async getToken(): Promise<string> {
    return this.authService.getToken();
  }

  hasValidToken(): boolean {
    return this.authService.hasValidToken();
  }

  // ==================== Private Helpers ====================

  private async request<T>(url: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getToken();

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ICM API Error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  private async requestOData<T>(url: string): Promise<T[]> {
    const response = await this.request<IcmODataResponse<T>>(url);
    return response.value;
  }

  static buildFilter(filters: IcmQueryFilter[]): string {
    return filters
      .map((f) => {
        const value =
          typeof f.value === 'string' ? `'${f.value}'` : String(f.value);
        if (f.operator === 'contains') {
          return `contains(${f.field}, ${value})`;
        }
        return `${f.field} ${f.operator} ${value}`;
      })
      .join(' and ');
  }

  private buildQueryString(options: IcmQueryOptions): string {
    const parts: string[] = [];
    if (options.filter) parts.push(`$filter=${encodeURIComponent(options.filter)}`);
    if (options.top) parts.push(`$top=${options.top}`);
    if (options.select) parts.push(`$select=${encodeURIComponent(options.select)}`);
    if (options.expand) parts.push(`$expand=${encodeURIComponent(options.expand)}`);
    if (options.orderby) parts.push(`$orderby=${encodeURIComponent(options.orderby)}`);
    return parts.length > 0 ? `?${parts.join('&')}` : '';
  }

  // ==================== User & Auth ====================

  async getCurrentUser(): Promise<IcmContact> {
    return this.request<IcmContact>(`${PORTAL_HOST}/imp/api/contact/GetCurrentUser`);
  }

  async getPermissions(): Promise<IcmPermission[]> {
    return this.request<IcmPermission[]>(`${PROD_API_HOST}/auth/GetAllPermissions`);
  }

  async resolveContacts(emails: string[]): Promise<IcmContact[]> {
    return this.request<IcmContact[]>(`${PROD_API_HOST}/user/mscontact-bulk`, {
      method: 'POST',
      body: JSON.stringify(emails),
    });
  }

  // ==================== Incidents ====================

  async queryIncidents(
    filter?: string,
    top?: number,
    select?: string,
    expand?: string,
    orderby?: string
  ): Promise<IcmIncidentListItem[]> {
    const qs = this.buildQueryString({ filter, top, select, expand, orderby });
    return this.requestOData<IcmIncidentListItem>(
      `${PROD_API_HOST}/incidentapi/incidents${qs}`
    );
  }

  async getIncidentCount(filter: string): Promise<number> {
    const qs = filter ? `?$filter=${encodeURIComponent(filter)}` : '';
    const result = await this.request<any>(
      `${PROD_API_HOST}/incidentapi/IncidentCount${qs}`
    );
    // Response could be { Count: N }, { value: N }, or a bare number
    return result?.Count ?? result?.value ?? (typeof result === 'number' ? result : 0);
  }

  async getIncident(id: number): Promise<IcmIncident> {
    const expand = 'CustomFields,AlertSource,ImpactedServices,ImpactedTeams,TrackingTeams,Bridges';
    const [incident, discussionRaw] = await Promise.all([
      this.request<IcmIncident>(`${PROD_API_HOST}/incidentapi/incidents(${id})/GetIncidentDetails?$expand=${encodeURIComponent(expand)}`),
      this.request<any>(`${PROD_API_HOST}/incidentapi/incidents/${id}/getdescriptionentries?$top=200&$skip=0`).catch(() => null),
    ]);
    if (discussionRaw) {
      const rawEntries: any[] = Array.isArray(discussionRaw)
        ? discussionRaw
        : (discussionRaw.Items || discussionRaw.value || []);
      // Map API field names to our IcmDiscussionEntry shape
      incident.Discussion = rawEntries.map((e: any) => ({
        Author: e.SubmittedBy || e.Author || '',
        AuthorDisplayName: e.SubmittedByDisplayName || e.AuthorDisplayName || e.SubmittedBy || '',
        SubmittedAt: e.SubmitDate || e.SubmittedAt || e.Date || '',
        Body: e.Text || e.Body || '',
        Likes: e.Likes || 0,
        Dislikes: e.Dislikes || 0,
        Type: e.SourceName ? 'Enrichment' : (e.Category === 'User' ? 'Discussion' : (e.Type || 'Discussion')),
        WorkflowName: e.SourceName || e.WorkflowName || undefined,
      }));
    } else {
      incident.Discussion = [];
    }
    return incident;
  }

  async getIncidentBridges(id: number): Promise<IcmBridge[]> {
    return this.requestOData<IcmBridge>(
      `${PROD_API_HOST}/incidentapi/incidents(${id})/Bridges`
    );
  }

  async acknowledgeIncident(id: number): Promise<void> {
    await this.request(`${PROD_API_HOST}/incidentapi/incidents(${id})/Acknowledge`, {
      method: 'POST',
    });
  }

  async transferIncident(id: number, teamId: number): Promise<void> {
    await this.request(`${PROD_API_HOST}/incidentapi/incidents(${id})`, {
      method: 'PATCH',
      body: JSON.stringify({ OwningTeamId: teamId }),
    });
  }

  async mitigateIncident(id: number): Promise<void> {
    await this.request(`${PROD_API_HOST}/incidentapi/incidents(${id})`, {
      method: 'PATCH',
      body: JSON.stringify({ State: 'Mitigated' }),
    });
  }

  async resolveIncident(id: number): Promise<void> {
    await this.request(`${PROD_API_HOST}/incidentapi/incidents(${id})`, {
      method: 'PATCH',
      body: JSON.stringify({ State: 'Resolved' }),
    });
  }

  // ==================== Discussion ====================

  async getDiscussionEntries(incidentId: number): Promise<IcmDiscussionEntry[]> {
    const incident = await this.getIncident(incidentId);
    return incident.Discussion || [];
  }

  async addDiscussionEntry(incidentId: number, text: string): Promise<void> {
    await this.request(
      `${PROD_API_HOST}/incidentapi/incidents(${incidentId})/PostDiscussionEntry`,
      {
        method: 'POST',
        body: JSON.stringify({ Text: text }),
      }
    );
  }

  // ==================== Queries ====================

  async getFavoriteQueries(ownerId: number, ownerType?: string): Promise<IcmFavoriteQuery[]> {
    const url = `${PROD_API_HOST}/incidentapi/GetFavoriteQueries?$orderby=Query/Name`;
    const response = await this.request<IcmODataResponse<IcmFavoriteQuery>>(url, {
      method: 'POST',
      body: JSON.stringify({ ownerId, ownerType: ownerType || 'Contact' }),
    });
    return response.value;
  }

  async getContactQueries(contactId: number): Promise<IcmQuery[]> {
    const url = `${PROD_API_HOST}/incidentapi/GetContactQueries?$filter=Criteria ne null&$orderby=Name`;
    const response = await this.request<IcmODataResponse<IcmQuery>>(url, {
      method: 'POST',
      body: JSON.stringify({ contactId }),
    });
    return response.value;
  }

  async getSharedQueries(contactId: number): Promise<IcmQuery[]> {
    const url = `${PROD_API_HOST}/incidentapi/GetSharedQuery?$filter=Criteria ne null&$orderby=Name`;
    const response = await this.request<IcmODataResponse<IcmQuery>>(url, {
      method: 'POST',
      body: JSON.stringify({ contactId }),
    });
    return response.value;
  }

  // ==================== Teams & Services ====================

  async getTeams(ids: number[]): Promise<IcmTeam[]> {
    const filter = ids.map((id) => `Id eq ${id}`).join(' or ');
    return this.requestOData<IcmTeam>(
      `${ONCALL_API_HOST}//Directory/Teams?$select=Id,Name,Description&$expand=OwningService($select=Id,Name)&$filter=${encodeURIComponent(filter)}`
    );
  }

  async searchTeams(id: number): Promise<IcmTeam[]> {
    return this.requestOData<IcmTeam>(
      `${PROD_API_HOST}/search/teams?$filter=${encodeURIComponent(`Id eq ${id}`)}`
    );
  }

  async searchServices(id: number): Promise<IcmService[]> {
    return this.requestOData<IcmService>(
      `${PROD_API_HOST}/search/services?$filter=${encodeURIComponent(`Id eq ${id}`)}`
    );
  }

  async getAlertSources(alertSourceId: string): Promise<IcmAlertSource[]> {
    return this.requestOData<IcmAlertSource>(
      `${PROD_API_HOST}/incidentapi/alertSources?$filter=${encodeURIComponent(`AlertSourceId eq ${alertSourceId}`)}`
    );
  }

  // ==================== Preferences ====================

  async getUserPreferences(alias: string): Promise<IcmUserPreferences[]> {
    const filter = encodeURIComponent(`(EntityType eq 'User' and EntityIdentity eq '${alias}')`);
    return this.requestOData<IcmUserPreferences>(
      `${UPS_API_HOST}/Domains('ICM')/Scopes('SPA')/Preferences?$filter=${filter}`
    );
  }

  async getFeatureFlags(scope: string, alias: string): Promise<IcmFeatureFlags> {
    return this.request<IcmFeatureFlags>(
      `${UPS_API_HOST}/Domains('ICM')/Scopes('${scope}')/Flighting.GetFeatures(EntityType='User',EntityIdentity='${encodeURIComponent(alias)}')`
    );
  }

  // ==================== Collaboration ====================

  async getTeamsChannel(incidentId: number): Promise<IcmTeamsChannel | null> {
    try {
      return await this.request<IcmTeamsChannel>(
        `${PROD_API_HOST}/user/msteams/collaborationworkspace?IncidentId=${incidentId}&ChannelType=Partner`
      );
    } catch {
      return null;
    }
  }

  async getBreakingNews(): Promise<IcmBreakingNewsEvent[]> {
    const result = await this.request<any>(
      `${PROD_API_HOST}/user/ActionCenterApi/SearchEvents?Channel=BreakingNews`
    );
    // Response may be OData-wrapped or a direct array
    if (Array.isArray(result)) return result;
    if (result?.value && Array.isArray(result.value)) return result.value;
    return [];
  }

  // ==================== Metadata ====================

  async getPropertyGroups(): Promise<IcmPropertyGroup[]> {
    return this.requestOData<IcmPropertyGroup>(
      `${PROD_API_HOST}/metadataapi/propertygroups?$filter=${encodeURIComponent("(Id eq 'Default')")}`
    );
  }

  async getCloudInstances(): Promise<IcmCloudInstance[]> {
    return this.requestOData<IcmCloudInstance>(
      `${PROD_API_HOST}//directory/cloudinstances`
    );
  }
}
