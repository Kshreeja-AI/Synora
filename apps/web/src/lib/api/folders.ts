import { api } from './client';
import type { Folder } from './types';

export function listFolders(
  workspaceId: string,
  filter: { projectId?: string; parentId?: string | null } = {}
): Promise<Folder[]> {
  const params = new URLSearchParams();
  if (filter.projectId) params.set('projectId', filter.projectId);
  if (filter.parentId !== undefined) params.set('parentId', filter.parentId === null ? 'null' : filter.parentId);
  const query = params.toString() ? `?${params.toString()}` : '';
  return api.get<Folder[]>(`/api/workspaces/${workspaceId}/folders${query}`);
}

export function createFolder(
  workspaceId: string,
  input: { name: string; projectId?: string; parentId?: string }
): Promise<Folder> {
  return api.post<Folder>(`/api/workspaces/${workspaceId}/folders`, input);
}

export function renameFolder(workspaceId: string, folderId: string, name: string): Promise<Folder> {
  return api.patch<Folder>(`/api/workspaces/${workspaceId}/folders/${folderId}`, { name });
}

export function deleteFolder(workspaceId: string, folderId: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/workspaces/${workspaceId}/folders/${folderId}`);
}
