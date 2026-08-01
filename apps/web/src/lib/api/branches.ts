'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
} from '@tanstack/react-query';
import { api } from './client';

export interface MessageBranch {
  id: string;
  conversationId: string;
  parentMessageId: string;
  title: string;
  isActive: boolean;
  messageCount: number;
  createdAt: string;
}

export interface CreateBranchInput {
  title?: string;
}

const BRANCHES_KEY = 'branches';

export function useConversationBranches(
  workspaceId: string,
  conversationId: string,
  options?: { enabled?: boolean }
): UseQueryResult<MessageBranch[]> {
  return useQuery({
    queryKey: [BRANCHES_KEY, conversationId],
    queryFn: async () => {
      const response = await api.get<MessageBranch[] | { items: MessageBranch[] }>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/branches`
      );
      return Array.isArray(response) ? response : response.items || [];
    },
    enabled: !!workspaceId && !!conversationId && options?.enabled !== false,
  });
}

export function useCreateBranch(
  workspaceId: string,
  conversationId: string,
  parentMessageId: string
): UseMutationResult<MessageBranch, Error, CreateBranchInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateBranchInput) =>
      api.post<MessageBranch>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages/${parentMessageId}/branches`,
        input
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [BRANCHES_KEY, conversationId],
      });
    },
  });
}

export function useActivateBranch(
  workspaceId: string,
  conversationId: string
): UseMutationResult<MessageBranch, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (branchId: string) =>
      api.patch<MessageBranch>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/branches/${branchId}`,
        { isActive: true }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [BRANCHES_KEY, conversationId],
      });
    },
  });
}

export function useDeleteBranch(
  workspaceId: string,
  conversationId: string
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (branchId: string) =>
      api.delete(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/branches/${branchId}`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [BRANCHES_KEY, conversationId],
      });
    },
  });
}
