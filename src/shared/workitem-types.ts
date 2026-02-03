import type { Identity } from './types';

export interface WorkItem {
  id: number;
  rev: number;
  fields: {
    'System.Id': number;
    'System.Title': string;
    'System.State': string;
    'System.WorkItemType': string;
    'System.AssignedTo'?: Identity;
    'System.CreatedBy'?: Identity;
    'System.CreatedDate': string;
    'System.ChangedDate': string;
    'System.Description'?: string;
    'System.IterationPath'?: string;
    'System.AreaPath'?: string;
    'System.Tags'?: string;
    'Microsoft.VSTS.Common.Priority'?: number;
    [key: string]: any;
  };
  relations?: WorkItemRelation[];
  url: string;
  _links: {
    self: { href: string };
    workItemUpdates: { href: string };
    workItemRevisions: { href: string };
    workItemComments: { href: string };
    html: { href: string };
    workItemType: { href: string };
    fields: { href: string };
  };
}

export interface WorkItemRelation {
  rel: string;
  url: string;
  attributes?: {
    isLocked?: boolean;
    name?: string;
    comment?: string;
    [key: string]: any;
  };
}

export interface SavedQuery {
  id: string;
  name: string;
  wiql: string;
  adoQueryId?: string;    // For imported ADO queries (server-side query GUID)
  createdAt: string;
  lastUsed?: string;
}

export interface WorkItemQueryFilter {
  workItemType?: string;
  state?: string;
  assignedTo?: 'me' | 'unassigned' | string;
  areaPath?: string;
  iterationPath?: string;
  tags?: string;
}

export interface WorkItemUpdate {
  id: number;
  workItemId: number;
  rev: number;
  revisedBy: Identity;
  revisedDate: string;
  fields?: {
    [fieldName: string]: {
      oldValue?: any;
      newValue?: any;
    };
  };
  relations?: {
    added?: WorkItemRelation[];
    removed?: WorkItemRelation[];
    updated?: WorkItemRelation[];
  };
}

export interface WiqlQueryResult {
  queryType: string;
  queryResultType: string;
  asOf: string;
  columns?: Array<{
    referenceName: string;
    name: string;
    url: string;
  }>;
  workItems: Array<{
    id: number;
    url: string;
  }>;
}

// Work item type colors for UI
export const WORK_ITEM_TYPE_COLORS: Record<string, string> = {
  'Bug': '#cc293d',
  'Task': '#f2cb1d',
  'User Story': '#009ccc',
  'Feature': '#773b93',
  'Epic': '#ff7b00',
  'Issue': '#cc293d',
  'Impediment': '#cc293d',
  'Test Case': '#004b50',
  'Test Plan': '#004b50',
  'Test Suite': '#004b50',
};

// Work item state colors for UI
export const WORK_ITEM_STATE_COLORS: Record<string, string> = {
  'New': '#b2b2b2',
  'Active': '#007acc',
  'Resolved': '#5db146',
  'Closed': '#7a7a7a',
  'Removed': '#7a7a7a',
  'Done': '#5db146',
  'In Progress': '#007acc',
  'To Do': '#b2b2b2',
  'Approved': '#5db146',
  'Committed': '#007acc',
};

// Relation type display names
export const RELATION_TYPE_NAMES: Record<string, string> = {
  'System.LinkTypes.Hierarchy-Forward': 'Child',
  'System.LinkTypes.Hierarchy-Reverse': 'Parent',
  'System.LinkTypes.Related': 'Related',
  'System.LinkTypes.Dependency-Forward': 'Successor',
  'System.LinkTypes.Dependency-Reverse': 'Predecessor',
  'Microsoft.VSTS.Common.Affects-Forward': 'Affects',
  'Microsoft.VSTS.Common.Affects-Reverse': 'Affected By',
  'AttachedFile': 'Attachment',
  'Hyperlink': 'Hyperlink',
  'ArtifactLink': 'Artifact',
};

// ==================== Phase 2: Edit & Sync Types ====================

/**
 * JSON Patch operation for updating work items
 */
export interface PatchOperation {
  op: 'add' | 'replace' | 'remove' | 'test';
  path: string;
  value?: any;
  from?: string;
}

/**
 * Work item comment
 */
export interface WorkItemComment {
  id: number;
  workItemId: number;
  version: number;
  text: string;
  renderedText?: string;
  createdBy: Identity;
  createdDate: string;
  modifiedBy?: Identity;
  modifiedDate?: string;
  format?: 'html' | 'markdown';
}

/**
 * Work item comments response
 */
export interface WorkItemCommentsResponse {
  totalCount: number;
  count: number;
  comments: WorkItemComment[];
  continuationToken?: string;
}

/**
 * Attachment reference returned after upload
 */
export interface AttachmentRef {
  id: string;
  url: string;
}

/**
 * Work item attachment
 */
export interface WorkItemAttachment {
  id: string;
  url: string;
  name: string;
  size?: number;
  createdDate?: string;
  createdBy?: Identity;
  comment?: string;
}

/**
 * Wiki information
 */
export interface Wiki {
  id: string;
  name: string;
  projectId: string;
  repositoryId?: string;
  type: 'projectWiki' | 'codeWiki';
  mappedPath?: string;
  url: string;
  versions?: Array<{ version: string }>;
}

/**
 * Wiki page
 */
export interface WikiPage {
  id: number;
  path: string;
  content?: string;
  gitItemPath?: string;
  isParentPage?: boolean;
  order?: number;
  subPages?: WikiPage[];
  url: string;
  remoteUrl?: string;
  version?: {
    version: string;
  };
}

/**
 * Wiki page search result
 */
export interface WikiPageSearchResult {
  wiki: {
    id: string;
    name: string;
    mappedPath?: string;
  };
  path: string;
  fileName: string;
  content?: string;
}

/**
 * Team member for assignment dropdown
 */
export interface TeamMember {
  id: string;
  displayName: string;
  uniqueName: string;
  imageUrl?: string;
}

/**
 * Work item type definition with allowed states
 */
export interface WorkItemTypeDefinition {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  states: WorkItemStateDefinition[];
  fields?: WorkItemFieldDefinition[];
}

/**
 * Work item state definition
 */
export interface WorkItemStateDefinition {
  name: string;
  color?: string;
  category?: 'Proposed' | 'InProgress' | 'Resolved' | 'Completed' | 'Removed';
}

/**
 * Work item field definition
 */
export interface WorkItemFieldDefinition {
  referenceName: string;
  name: string;
  type: string;
  readOnly?: boolean;
  required?: boolean;
  allowedValues?: string[];
}

/**
 * Classification node (Area or Iteration path)
 */
export interface ClassificationNode {
  id: number;
  identifier: string;
  name: string;
  structureType: 'area' | 'iteration';
  hasChildren: boolean;
  children?: ClassificationNode[];
  path: string;
  attributes?: {
    startDate?: string;
    finishDate?: string;
  };
}
