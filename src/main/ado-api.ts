import { execSync } from 'child_process';
import { existsSync } from 'fs';
import type {
  PullRequest,
  PullRequestIteration,
  IterationChange,
  CommentThread,
  Comment,
} from '../shared/types.js';

const ADO_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798';
const API_VERSION = '7.1';

function findAzCommand(): string {
  if (process.platform !== 'win32') {
    return 'az';
  }

  const knownPaths = [
    'C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd',
    'C:\\Program Files (x86)\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd',
  ];

  for (const azPath of knownPaths) {
    if (existsSync(azPath)) {
      return `"${azPath}"`;
    }
  }

  // Fall back to PATH lookup
  return 'az';
}

export class AdoApiClient {
  private tokenCache: { token: string; expiresAt: number } | null = null;

  async getToken(): Promise<string> {
    // Check environment variable first
    const pat = process.env.AZURE_DEVOPS_PAT;
    if (pat) {
      return pat;
    }

    // Check cache
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt - 60000) {
      return this.tokenCache.token;
    }

    try {
      const azCommand = findAzCommand();

      const result = execSync(
        `${azCommand} account get-access-token --resource ${ADO_RESOURCE_ID} --output json`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );

      const tokenResponse = JSON.parse(result);
      const expiresAt = new Date(tokenResponse.expiresOn).getTime();

      this.tokenCache = {
        token: tokenResponse.accessToken,
        expiresAt,
      };

      return tokenResponse.accessToken;
    } catch (error: any) {
      const errorMessage = error.message || String(error);
      throw new Error(
        `Failed to get ADO token. Ensure you are logged in via 'az login' or set AZURE_DEVOPS_PAT environment variable. Error: ${errorMessage}`
      );
    }
  }

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
      throw new Error(`ADO API Error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  private async requestRaw(url: string): Promise<string | null> {
    const token = await this.getToken();

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/octet-stream',
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`ADO API Error: ${response.status}`);
    }

    return response.text();
  }

  async getPullRequest(org: string, project: string, prId: number): Promise<PullRequest> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/git/pullrequests/${prId}?api-version=${API_VERSION}`;
    return this.request<PullRequest>(url);
  }

  async getIterations(org: string, project: string, repoId: string, prId: number): Promise<PullRequestIteration[]> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repoId}/pullrequests/${prId}/iterations?api-version=${API_VERSION}`;
    const response = await this.request<{ value: PullRequestIteration[] }>(url);
    return response.value;
  }

  async getIterationChanges(org: string, project: string, repoId: string, prId: number, iterationId: number): Promise<IterationChange[]> {
    const allChanges: IterationChange[] = [];
    let skip = 0;
    const top = 100; // ADO API page size

    while (true) {
      const url = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repoId}/pullrequests/${prId}/iterations/${iterationId}/changes?$top=${top}&$skip=${skip}&api-version=${API_VERSION}`;
      const response = await this.request<{ changeEntries: IterationChange[] }>(url);
      const entries = response.changeEntries || [];

      if (entries.length === 0) {
        break;
      }

      allChanges.push(...entries);

      if (entries.length < top) {
        // Last page - no more results
        break;
      }

      skip += top;
    }

    return allChanges;
  }

  async getThreads(org: string, project: string, repoId: string, prId: number): Promise<CommentThread[]> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repoId}/pullrequests/${prId}/threads?api-version=${API_VERSION}`;
    const response = await this.request<{ value: CommentThread[] }>(url);
    return response.value;
  }

  async getFileContent(org: string, project: string, repoId: string, objectId: string): Promise<string> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repoId}/blobs/${objectId}?api-version=${API_VERSION}`;
    const content = await this.requestRaw(url);
    return content || '';
  }

  async getFileFromBranch(org: string, project: string, repoId: string, filePath: string, branch: string): Promise<string | null> {
    const encodedPath = encodeURIComponent(filePath).replace(/%2F/g, '/');
    const url = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repoId}/items?path=${encodedPath}&versionType=Branch&version=${branch}&api-version=${API_VERSION}`;
    return this.requestRaw(url);
  }

  async createFileComment(
    org: string,
    project: string,
    repoId: string,
    prId: number,
    filePath: string,
    startLine: number,
    endLine: number,
    content: string
  ): Promise<CommentThread> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repoId}/pullrequests/${prId}/threads?api-version=${API_VERSION}`;

    const body = {
      comments: [
        {
          parentCommentId: 0,
          content,
          commentType: 1,
        },
      ],
      status: 1, // Active
      threadContext: {
        filePath,
        rightFileStart: { line: startLine, offset: 1 },
        rightFileEnd: { line: endLine, offset: 1 },
      },
    };

    return this.request<CommentThread>(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async createGeneralComment(
    org: string,
    project: string,
    repoId: string,
    prId: number,
    content: string
  ): Promise<CommentThread> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repoId}/pullrequests/${prId}/threads?api-version=${API_VERSION}`;

    const body = {
      comments: [
        {
          parentCommentId: 0,
          content,
          commentType: 1,
        },
      ],
      status: 1,
    };

    return this.request<CommentThread>(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async replyToThread(
    org: string,
    project: string,
    repoId: string,
    prId: number,
    threadId: number,
    content: string
  ): Promise<Comment> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repoId}/pullrequests/${prId}/threads/${threadId}/comments?api-version=${API_VERSION}`;

    const body = {
      content,
      parentCommentId: 1,
      commentType: 1,
    };

    return this.request<Comment>(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async updateThreadStatus(
    org: string,
    project: string,
    repoId: string,
    prId: number,
    threadId: number,
    status: string
  ): Promise<void> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repoId}/pullrequests/${prId}/threads/${threadId}?api-version=${API_VERSION}`;

    const statusMap: Record<string, number> = {
      active: 1,
      fixed: 2,
      wontFix: 3,
      closed: 4,
      byDesign: 5,
      pending: 6,
    };

    await this.request(url, {
      method: 'PATCH',
      body: JSON.stringify({ status: statusMap[status] || 1 }),
    });
  }

  async submitVote(
    org: string,
    project: string,
    repoId: string,
    prId: number,
    vote: number
  ): Promise<void> {
    // Get current user ID
    const profileUrl = `https://vssps.dev.azure.com/${org}/_apis/profile/profiles/me?api-version=${API_VERSION}`;
    const profile = await this.request<{ id: string }>(profileUrl);

    const url = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repoId}/pullrequests/${prId}/reviewers/${profile.id}?api-version=${API_VERSION}`;

    await this.request(url, {
      method: 'PUT',
      body: JSON.stringify({ vote }),
    });
  }

  async getCurrentUserId(org: string): Promise<string> {
    const url = `https://vssps.dev.azure.com/${org}/_apis/profile/profiles/me?api-version=${API_VERSION}`;
    const response = await this.request<{ id: string }>(url);
    return response.id;
  }

  async getPullRequestsForReviewer(org: string, project: string): Promise<any[]> {
    const userId = await this.getCurrentUserId(org);
    const url = `https://dev.azure.com/${org}/${project}/_apis/git/pullrequests?searchCriteria.reviewerId=${userId}&searchCriteria.status=active&$top=50&api-version=${API_VERSION}`;
    const response = await this.request<{ value: any[] }>(url);
    return response.value || [];
  }

  async getPullRequestsCreatedByMe(org: string, project: string): Promise<any[]> {
    const userId = await this.getCurrentUserId(org);
    const url = `https://dev.azure.com/${org}/${project}/_apis/git/pullrequests?searchCriteria.creatorId=${userId}&searchCriteria.status=active&$top=50&api-version=${API_VERSION}`;
    const response = await this.request<{ value: any[] }>(url);
    return response.value || [];
  }

  async getPullRequestsCreatedByMeInRepo(org: string, project: string, repositoryName: string): Promise<any[]> {
    const userId = await this.getCurrentUserId(org);
    const url = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${encodeURIComponent(repositoryName)}/pullrequests?searchCriteria.creatorId=${userId}&searchCriteria.status=active&$top=50&api-version=${API_VERSION}`;
    const response = await this.request<{ value: any[] }>(url);
    return response.value || [];
  }

  async getPullRequestsForRepository(org: string, project: string, repositoryName: string): Promise<any[]> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${encodeURIComponent(repositoryName)}/pullrequests?searchCriteria.status=active&$top=50&api-version=${API_VERSION}`;
    const response = await this.request<{ value: any[] }>(url);
    return response.value || [];
  }


  // ==================== Work Item APIs ====================

  async queryWorkItems(org: string, project: string, wiql: string): Promise<number[]> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/wit/wiql?api-version=${API_VERSION}`;
    const response = await this.request<{ workItems: Array<{ id: number }> }>(url, {
      method: 'POST',
      body: JSON.stringify({ query: wiql }),
    });
    return (response.workItems || []).map(wi => wi.id);
  }

  /**
   * Run a saved/shared query by its ID (GUID) and return work item IDs
   */
  async runQueryById(org: string, project: string, queryId: string): Promise<number[]> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/wit/wiql/${queryId}?api-version=${API_VERSION}`;
    const response = await this.request<{ workItems: Array<{ id: number }> }>(url);
    return (response.workItems || []).map(wi => wi.id);
  }

  async getWorkItems(org: string, project: string, ids: number[]): Promise<any[]> {
    if (ids.length === 0) return [];

    // ADO has a limit of 200 work items per request
    const batchSize = 200;
    const results: any[] = [];

    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const idsParam = batch.join(',');
      const url = `https://dev.azure.com/${org}/${project}/_apis/wit/workitems?ids=${idsParam}&$expand=relations&api-version=${API_VERSION}`;
      const response = await this.request<{ value: any[] }>(url);
      results.push(...(response.value || []));
    }

    return results;
  }

  async getWorkItem(org: string, project: string, id: number): Promise<any> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/wit/workitems/${id}?$expand=relations&api-version=${API_VERSION}`;
    return this.request<any>(url);
  }

  async getWorkItemUpdates(org: string, project: string, id: number): Promise<any[]> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/wit/workitems/${id}/updates?api-version=${API_VERSION}`;
    const response = await this.request<{ value: any[] }>(url);
    return response.value || [];
  }

  async getMyWorkItems(org: string, project: string): Promise<any[]> {
    const wiql = `
      SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [System.AssignedTo], [System.ChangedDate]
      FROM WorkItems
      WHERE [System.TeamProject] = @project
        AND [System.AssignedTo] = @me
        AND [System.State] NOT IN ('Closed', 'Removed', 'Done')
      ORDER BY [System.ChangedDate] DESC
    `;
    const ids = await this.queryWorkItems(org, project, wiql);
    return this.getWorkItems(org, project, ids.slice(0, 50));
  }

  async getCreatedByMeWorkItems(org: string, project: string): Promise<any[]> {
    const wiql = `
      SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [System.AssignedTo], [System.ChangedDate]
      FROM WorkItems
      WHERE [System.TeamProject] = @project
        AND [System.CreatedBy] = @me
        AND [System.State] NOT IN ('Closed', 'Removed', 'Done')
      ORDER BY [System.ChangedDate] DESC
    `;
    const ids = await this.queryWorkItems(org, project, wiql);
    return this.getWorkItems(org, project, ids.slice(0, 50));
  }

  async getWorkItemsList(org: string, project: string, ids: number[]): Promise<any[]> {
    if (ids.length === 0) return [];
    const batchSize = 200;
    const batches: number[][] = [];
    for (let i = 0; i < ids.length; i += batchSize) {
      batches.push(ids.slice(i, i + batchSize));
    }
    const results = await Promise.all(batches.map(batch => {
      const idsParam = batch.join(',');
      const url = `https://dev.azure.com/${org}/${project}/_apis/wit/workitems?ids=${idsParam}&api-version=${API_VERSION}`;
      return this.request<{ value: any[] }>(url).then(r => r.value || []);
    }));
    return results.flat();
  }

  async getWorkItemsGroupedByType(org: string, project: string, wiql: string): Promise<Array<{ type: string; items: any[]; totalCount: number }>> {
    const allIds = await this.queryWorkItems(org, project, wiql);
    const allItems = await this.getWorkItemsList(org, project, allIds.slice(0, 500));

    const groups = new Map<string, any[]>();
    for (const item of allItems) {
      const type = item.fields['System.WorkItemType'] || 'Unknown';
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type)!.push(item);
    }

    const TYPE_ORDER = ['Bug', 'Task', 'User Story', 'Feature', 'Epic', 'Issue', 'Impediment', 'Test Case', 'Test Plan', 'Test Suite'];
    return Array.from(groups.entries())
      .map(([type, items]) => ({ type, items: items.slice(0, 50), totalCount: items.length }))
      .sort((a, b) => {
        const ai = TYPE_ORDER.indexOf(a.type);
        const bi = TYPE_ORDER.indexOf(b.type);
        if (ai === -1 && bi === -1) return a.type.localeCompare(b.type);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
  }

  async getWorkItemTypes(org: string, project: string): Promise<any[]> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/wit/workitemtypes?api-version=${API_VERSION}`;
    const response = await this.request<{ value: any[] }>(url);
    return response.value || [];
  }

  async getAreaPaths(org: string, project: string): Promise<any> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/wit/classificationnodes/areas?$depth=5&api-version=${API_VERSION}`;
    return this.request<any>(url);
  }

  async getIterationPaths(org: string, project: string): Promise<any> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/wit/classificationnodes/iterations?$depth=5&api-version=${API_VERSION}`;
    return this.request<any>(url);
  }

  // ==================== Phase 2: Edit Work Items ====================

  /**
   * Update a work item using JSON Patch operations
   */
  async updateWorkItem(
    org: string,
    project: string,
    id: number,
    operations: Array<{ op: string; path: string; value?: any }>
  ): Promise<any> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/wit/workitems/${id}?api-version=${API_VERSION}`;
    return this.request<any>(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json-patch+json',
      },
      body: JSON.stringify(operations),
    });
  }

  /**
   * Get comments for a work item
   */
  async getWorkItemComments(org: string, project: string, id: number): Promise<any> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/wit/workitems/${id}/comments?api-version=${API_VERSION}-preview.4`;
    return this.request<any>(url);
  }

  /**
   * Add a comment to a work item
   */
  async addWorkItemComment(org: string, project: string, id: number, text: string): Promise<any> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/wit/workitems/${id}/comments?api-version=${API_VERSION}-preview.4`;
    return this.request<any>(url, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  /**
   * Get team members for a project (for assignment dropdown)
   */
  async getTeamMembers(org: string, project: string): Promise<any[]> {
    // First get the default team
    const teamsUrl = `https://dev.azure.com/${org}/_apis/projects/${project}/teams?api-version=${API_VERSION}`;
    const teamsResponse = await this.request<{ value: any[] }>(teamsUrl);
    const defaultTeam = teamsResponse.value?.[0];

    if (!defaultTeam) return [];

    // Get team members
    const membersUrl = `https://dev.azure.com/${org}/_apis/projects/${project}/teams/${defaultTeam.id}/members?api-version=${API_VERSION}`;
    const membersResponse = await this.request<{ value: any[] }>(membersUrl);
    return membersResponse.value?.map(m => m.identity) || [];
  }

  /**
   * Get work item type states (allowed workflow states)
   */
  async getWorkItemTypeStates(org: string, project: string, workItemType: string): Promise<any[]> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/wit/workitemtypes/${encodeURIComponent(workItemType)}/states?api-version=${API_VERSION}`;
    const response = await this.request<{ value: any[] }>(url);
    return response.value || [];
  }

  // ==================== Phase 2: Attachments ====================

  /**
   * Upload an attachment (returns attachment reference)
   */
  async uploadAttachment(
    org: string,
    project: string,
    fileName: string,
    content: Buffer
  ): Promise<{ id: string; url: string }> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/wit/attachments?fileName=${encodeURIComponent(fileName)}&api-version=${API_VERSION}`;

    const token = await this.getToken();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: content as unknown as BodyInit,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ADO API Error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<{ id: string; url: string }>;
  }

  /**
   * Add an attachment to a work item (link uploaded attachment)
   */
  async addWorkItemAttachment(
    org: string,
    project: string,
    workItemId: number,
    attachmentUrl: string,
    comment?: string
  ): Promise<any> {
    const operations = [
      {
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'AttachedFile',
          url: attachmentUrl,
          attributes: {
            comment: comment || '',
          },
        },
      },
    ];
    return this.updateWorkItem(org, project, workItemId, operations);
  }

  /**
   * Remove an attachment from a work item
   */
  async removeWorkItemAttachment(
    org: string,
    project: string,
    workItemId: number,
    attachmentUrl: string
  ): Promise<any> {
    // First get the work item to find the relation index
    const workItem = await this.getWorkItem(org, project, workItemId);
    const relations = workItem.relations || [];
    const relationIndex = relations.findIndex(
      (r: any) => r.rel === 'AttachedFile' && r.url === attachmentUrl
    );

    if (relationIndex === -1) {
      throw new Error('Attachment not found on work item');
    }

    const operations = [
      {
        op: 'remove',
        path: `/relations/${relationIndex}`,
      },
    ];
    return this.updateWorkItem(org, project, workItemId, operations);
  }

  // ==================== Phase 2: Wiki ====================

  /**
   * Get list of wikis for a project
   */
  async getWikis(org: string, project: string): Promise<any[]> {
    const url = `https://dev.azure.com/${org}/${project}/_apis/wiki/wikis?api-version=${API_VERSION}`;
    const response = await this.request<{ value: any[] }>(url);
    return response.value || [];
  }

  /**
   * Get a wiki page
   */
  async getWikiPage(
    org: string,
    project: string,
    wikiId: string,
    path: string
  ): Promise<any> {
    const encodedPath = encodeURIComponent(path);
    const url = `https://dev.azure.com/${org}/${project}/_apis/wiki/wikis/${wikiId}/pages?path=${encodedPath}&includeContent=true&api-version=${API_VERSION}`;
    return this.request<any>(url);
  }

  /**
   * Create or update a wiki page
   */
  async createOrUpdateWikiPage(
    org: string,
    project: string,
    wikiId: string,
    path: string,
    content: string,
    version?: string
  ): Promise<any> {
    const encodedPath = encodeURIComponent(path);
    const url = `https://dev.azure.com/${org}/${project}/_apis/wiki/wikis/${wikiId}/pages?path=${encodedPath}&api-version=${API_VERSION}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // If updating existing page, need to provide version header
    if (version) {
      headers['If-Match'] = version;
    }

    return this.request<any>(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ content }),
    });
  }

  /**
   * Search wiki pages
   */
  async searchWikiPages(
    org: string,
    project: string,
    searchText: string
  ): Promise<any[]> {
    // Use the search API
    const url = `https://almsearch.dev.azure.com/${org}/${project}/_apis/search/wikisearchresults?api-version=${API_VERSION}`;
    const response = await this.request<{ results: any[] }>(url, {
      method: 'POST',
      body: JSON.stringify({
        searchText,
        $top: 50,
        filters: {},
      }),
    });
    return response.results || [];
  }

  /**
   * Add a hyperlink to a work item (for wiki page links)
   */
  async addWorkItemHyperlink(
    org: string,
    project: string,
    workItemId: number,
    url: string,
    comment?: string
  ): Promise<any> {
    const operations = [
      {
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'Hyperlink',
          url,
          attributes: {
            comment: comment || '',
          },
        },
      },
    ];
    return this.updateWorkItem(org, project, workItemId, operations);
  }

  /**
   * Remove a hyperlink from a work item
   */
  async removeWorkItemHyperlink(
    org: string,
    project: string,
    workItemId: number,
    hyperlinkUrl: string
  ): Promise<any> {
    const workItem = await this.getWorkItem(org, project, workItemId);
    const relations = workItem.relations || [];
    const relationIndex = relations.findIndex(
      (r: any) => r.rel === 'Hyperlink' && r.url === hyperlinkUrl
    );

    if (relationIndex === -1) {
      throw new Error('Hyperlink not found on work item');
    }

    const operations = [
      {
        op: 'remove',
        path: `/relations/${relationIndex}`,
      },
    ];
    return this.updateWorkItem(org, project, workItemId, operations);
  }
}
