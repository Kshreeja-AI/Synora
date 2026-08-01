'use client';

import { useMutation, useQuery, useQueryClient, UseQueryResult } from '@tanstack/react-query';
import { api } from './client';

export interface Prompt {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  content: string;
  category?: string;
  tags: string[];
  isPublic: boolean;
  usageCount: number;
  rating: number;
  isFavorite: boolean;
  version: number;
  parentId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const PROMPTS_KEY = 'prompts';

// Raw API functions for direct use
export async function listPrompts(
  workspaceId: string,
  options?: { category?: string; isPublic?: boolean; skip?: number; take?: number }
): Promise<{ items: Prompt[]; total: number }> {
  const params = new URLSearchParams();
  if (options?.category) params.append('category', options.category);
  if (options?.isPublic !== undefined) params.append('isPublic', String(options.isPublic));
  if (options?.skip !== undefined) params.append('skip', String(options.skip));
  if (options?.take !== undefined) params.append('take', String(options.take));

  const queryString = params.toString();
  const url = queryString
    ? `/api/workspaces/${workspaceId}/prompts?${queryString}`
    : `/api/workspaces/${workspaceId}/prompts`;

  return api.get<{ items: Prompt[]; total: number }>(url);
}

export async function getPrompt(workspaceId: string, promptId: string): Promise<Prompt> {
  return api.get<Prompt>(`/api/workspaces/${workspaceId}/prompts/${promptId}`);
}

export async function createPrompt(
  workspaceId: string,
  input: { name: string; description?: string; content: string; category?: string; tags?: string[]; isPublic?: boolean }
): Promise<Prompt> {
  return api.post<Prompt>(`/api/workspaces/${workspaceId}/prompts`, input);
}

export async function updatePrompt(
  workspaceId: string,
  promptId: string,
  input: Partial<{ name: string; description: string; content: string; category: string; tags: string[]; isPublic: boolean }>
): Promise<Prompt> {
  return api.patch<Prompt>(`/api/workspaces/${workspaceId}/prompts/${promptId}`, input);
}

export async function deletePrompt(workspaceId: string, promptId: string): Promise<void> {
  await api.delete(`/api/workspaces/${workspaceId}/prompts/${promptId}`);
}

export async function createPromptVersion(
  workspaceId: string,
  promptId: string,
  input: Partial<{ name: string; description: string; content: string; category: string; tags: string[]; isPublic: boolean }>
): Promise<Prompt> {
  return api.post<Prompt>(`/api/workspaces/${workspaceId}/prompts/${promptId}/version`, input);
}

export async function ratePrompt(workspaceId: string, promptId: string, rating: number): Promise<Prompt> {
  return api.post<Prompt>(`/api/workspaces/${workspaceId}/prompts/${promptId}/rate`, { rating });
}

export async function togglePromptFavorite(workspaceId: string, promptId: string): Promise<Prompt> {
  return api.post<Prompt>(`/api/workspaces/${workspaceId}/prompts/${promptId}/favorite`, {});
}

// React hooks
export function useCreatePrompt(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { name: string; description?: string; content: string; category?: string; tags?: string[]; isPublic?: boolean }) => {
      return createPrompt(workspaceId, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [PROMPTS_KEY, workspaceId],
      });
    },
  });
}

export function usePrompts(workspaceId: string, options?: { category?: string; isPublic?: boolean }): UseQueryResult<Prompt[]> {
  return useQuery({
    queryKey: [PROMPTS_KEY, workspaceId, options],
    queryFn: async () => {
      const result = await listPrompts(workspaceId, options);
      return result.items || [];
    },
    enabled: !!workspaceId,
  });
}

export function usePrompt(workspaceId: string, promptId: string): UseQueryResult<Prompt> {
  return useQuery({
    queryKey: [PROMPTS_KEY, promptId],
    queryFn: async () => getPrompt(workspaceId, promptId),
    enabled: !!promptId && !!workspaceId,
  });
}

export function useUpdatePrompt(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { promptId: string; data: Partial<{ name: string; description: string; content: string; category: string; tags: string[]; isPublic: boolean }> }) => {
      return updatePrompt(workspaceId, input.promptId, input.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [PROMPTS_KEY, workspaceId],
      });
    },
  });
}

export function useDeletePrompt(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (promptId: string) => {
      await deletePrompt(workspaceId, promptId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [PROMPTS_KEY, workspaceId],
      });
    },
  });
}

export function useCreatePromptVersion(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { promptId: string; data: Partial<{ name: string; description: string; content: string; category: string; tags: string[]; isPublic: boolean }> }) => {
      return createPromptVersion(workspaceId, input.promptId, input.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [PROMPTS_KEY, workspaceId],
      });
    },
  });
}

export function useRatePrompt(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { promptId: string; rating: number }) => {
      return ratePrompt(workspaceId, input.promptId, input.rating);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [PROMPTS_KEY, workspaceId],
      });
    },
  });
}

export function useTogglePromptFavorite(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (promptId: string) => {
      return togglePromptFavorite(workspaceId, promptId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [PROMPTS_KEY, workspaceId],
      });
    },
  });
}
