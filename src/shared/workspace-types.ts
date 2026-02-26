export type WorkspaceSubtabType = 'cfv' | 'dgrep' | 'icm' | 'new';

export interface CfvSubtabState {
  callId: string;
}

export interface DgrepSubtabState {
  searchQuery: string;
  timeRange: { start: string; end: string };
}

export interface IcmSubtabState {
  incidentId: number;
}

export interface NewSubtabState {}

export type WorkspaceSubtabState = CfvSubtabState | DgrepSubtabState | IcmSubtabState | NewSubtabState;

export interface WorkspaceSubtab {
  id: string;
  type: WorkspaceSubtabType;
  label: string;
  state: WorkspaceSubtabState;
}

export interface Workspace {
  id: string;
  name: string;
  subtabs: WorkspaceSubtab[];
  activeSubtabId: string | null;
  createdAt: number;
}

export interface WorkspacesData {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
}
