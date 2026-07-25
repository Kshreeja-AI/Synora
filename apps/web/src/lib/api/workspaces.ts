import { api } from './client';
import type {
  WorkspaceSummary,
  WorkspaceMemberSummary,
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
} from './types';

export function listWorkspaces(): Promise<WorkspaceSummary[]> {
  return api.get<WorkspaceSummary[]>('/api/workspaces');
}

export function createWorkspace(input: CreateWorkspaceRequest): Promise<WorkspaceSummary> {
  return api.post<WorkspaceSummary>('/api/workspaces', input);
}

export function getWorkspace(id: string): Promise<WorkspaceSummary> {
  return api.get<WorkspaceSummary>(`/api/workspaces/${id}`);
}

export function updateWorkspace(id: string, input: UpdateWorkspaceRequest): Promise<WorkspaceSummary> {
  return api.patch<WorkspaceSummary>(`/api/workspaces/${id}`, input);
}

export function listWorkspaceMembers(id: string): Promise<WorkspaceMemberSummary[]> {
  return api.get<WorkspaceMemberSummary[]>(`/api/workspaces/${id}/members`);
}
