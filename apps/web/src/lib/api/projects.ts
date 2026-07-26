import { api } from './client';
import type { Project, CreateProjectRequest, UpdateProjectRequest } from './types';

export function listProjects(workspaceId?: string): Promise<Project[]> {
  const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
  return api.get<Project[]>(`/api/projects${query}`);
}

export function createProject(input: CreateProjectRequest): Promise<Project> {
  return api.post<Project>('/api/projects', input);
}

export function getProject(id: string): Promise<Project> {
  return api.get<Project>(`/api/projects/${id}`);
}

export function updateProject(id: string, input: UpdateProjectRequest): Promise<Project> {
  return api.patch<Project>(`/api/projects/${id}`, input);
}

export function deleteProject(id: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/projects/${id}`);
}
