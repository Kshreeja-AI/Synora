'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
} from '@tanstack/react-query';
import { api } from './client';

export interface Template {
  id: string;
  workspaceId: string;
  title: string;
  description?: string;
  category: string;
  systemPrompt: string;
  initialUserMessage?: string;
  suggestedFollowUps: string[];
  createdBy: string;
  isPublic: boolean;
  createdAt: string;
}

export interface CreateTemplateInput {
  title: string;
  description?: string;
  category: string;
  systemPrompt: string;
  initialUserMessage?: string;
  suggestedFollowUps?: string[];
  isPublic?: boolean;
}

const TEMPLATES_KEY = 'templates';

export function useWorkspaceTemplates(
  workspaceId: string,
  options?: { enabled?: boolean }
): UseQueryResult<Template[]> {
  return useQuery({
    queryKey: [TEMPLATES_KEY, workspaceId],
    queryFn: async () => {
      const response = await api.get<Template[] | { items: Template[] }>(
        `/api/workspaces/${workspaceId}/templates`
      );
      return Array.isArray(response) ? response : response.items || [];
    },
    enabled: !!workspaceId && options?.enabled !== false,
  });
}

export function usePublicTemplates(
  workspaceId: string,
  category?: string
): UseQueryResult<Template[]> {
  return useQuery({
    queryKey: [TEMPLATES_KEY, 'public', workspaceId, category],
    queryFn: async () => {
      const url = category
        ? `/api/workspaces/${workspaceId}/templates?category=${encodeURIComponent(category)}&isPublic=true`
        : `/api/workspaces/${workspaceId}/templates?isPublic=true`;
      const response = await api.get<Template[] | { items: Template[] }>(url);
      return Array.isArray(response) ? response : response.items || [];
    },
    enabled: !!workspaceId,
  });
}

export function useCreateTemplate(
  workspaceId: string
): UseMutationResult<Template, Error, CreateTemplateInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateTemplateInput) =>
      api.post<Template>(
        `/api/workspaces/${workspaceId}/templates`,
        input
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [TEMPLATES_KEY, workspaceId],
      });
    },
  });
}

export function useDeleteTemplate(
  workspaceId: string
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (templateId: string) =>
      api.delete(
        `/api/workspaces/${workspaceId}/templates/${templateId}`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [TEMPLATES_KEY, workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: [TEMPLATES_KEY, 'public'],
      });
    },
  });
}

export const TEMPLATE_CATEGORIES = [
  { value: 'creative', label: 'Creative Writing' },
  { value: 'analysis', label: 'Analysis' },
  { value: 'coding', label: 'Coding' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'education', label: 'Education' },
  { value: 'brainstorm', label: 'Brainstorming' },
  { value: 'other', label: 'Other' },
];
