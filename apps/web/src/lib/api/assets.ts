import { api } from './client';
import type { Asset } from './types';

export function listAssets(
  workspaceId: string,
  filter: { projectId?: string; folderId?: string | null } = {}
): Promise<Asset[]> {
  const params = new URLSearchParams();
  if (filter.projectId) params.set('projectId', filter.projectId);
  if (filter.folderId !== undefined) params.set('folderId', filter.folderId === null ? 'null' : filter.folderId);
  const query = params.toString() ? `?${params.toString()}` : '';
  return api.get<Asset[]>(`/api/workspaces/${workspaceId}/assets${query}`);
}

export function uploadAsset(
  workspaceId: string,
  file: File,
  options: { projectId?: string; folderId?: string } = {}
): Promise<Asset> {
  const formData = new FormData();
  formData.append('file', file);
  if (options.projectId) formData.append('projectId', options.projectId);
  if (options.folderId) formData.append('folderId', options.folderId);
  return api.upload<Asset>(`/api/workspaces/${workspaceId}/assets`, formData);
}

export function deleteAsset(workspaceId: string, assetId: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/workspaces/${workspaceId}/assets/${assetId}`);
}
