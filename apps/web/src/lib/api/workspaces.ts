import { api } from './client';
import type {
  WorkspaceSummary,
  WorkspaceMemberSummary,
  WorkspaceRole,
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
  InvitationSummary,
  CreateInvitationRequest,
  AuditLogEntry,
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

export function updateMemberRole(
  workspaceId: string,
  memberId: string,
  role: WorkspaceRole
): Promise<WorkspaceMemberSummary> {
  return api.patch<WorkspaceMemberSummary>(`/api/workspaces/${workspaceId}/members/${memberId}`, { role });
}

export function removeMember(workspaceId: string, memberId: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/workspaces/${workspaceId}/members/${memberId}`);
}

export function listInvitations(workspaceId: string): Promise<InvitationSummary[]> {
  return api.get<InvitationSummary[]>(`/api/workspaces/${workspaceId}/invitations`);
}

export function createInvitation(
  workspaceId: string,
  input: CreateInvitationRequest
): Promise<InvitationSummary> {
  return api.post<InvitationSummary>(`/api/workspaces/${workspaceId}/invitations`, input);
}

export function revokeInvitation(workspaceId: string, invitationId: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/workspaces/${workspaceId}/invitations/${invitationId}`);
}

export function listAuditLog(workspaceId: string): Promise<AuditLogEntry[]> {
  return api.get<AuditLogEntry[]>(`/api/workspaces/${workspaceId}/audit-log`);
}
