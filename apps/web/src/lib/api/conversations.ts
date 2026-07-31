/**
 * Conversation API client with TanStack Query
 * Handles CRUD operations and real-time updates
 */

import {
  useQuery,
  useMutation,
  useInfiniteQuery,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
  UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { api } from './client';
import type {
  Conversation,
  CreateConversationInput,
  UpdateConversationInput,
} from '@/lib/types/conversations';

const CONVERSATIONS_KEY = 'conversations';

/**
 * Fetch all conversations for a workspace (paginated, infinite scroll)
 */
export function useConversations(
  workspaceId: string,
  options?: { enabled?: boolean }
): UseInfiniteQueryResult<{ items: Conversation[]; total: number; hasMore: boolean }> {
  return useInfiniteQuery({
    queryKey: [CONVERSATIONS_KEY, workspaceId],
    queryFn: async ({ pageParam = 0 }) => {
      return api.get<{ items: Conversation[]; total: number; hasMore: boolean }>(
        `/api/workspaces/${workspaceId}/conversations?skip=${pageParam}&take=20`
      );
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore) return undefined;
      return undefined;
    },
    initialPageParam: 0,
    enabled: !!workspaceId && options?.enabled !== false,
  });
}

/**
 * Fetch a single conversation
 */
export function useConversation(
  workspaceId: string,
  conversationId: string,
  options?: { enabled?: boolean }
): UseQueryResult<Conversation> {
  return useQuery({
    queryKey: [CONVERSATIONS_KEY, conversationId],
    queryFn: async () => {
      const response = await api.get<Conversation>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}`
      );
      return response.data;
    },
    enabled: !!conversationId && !!workspaceId && options?.enabled !== false,
  });
}

/**
 * Create a new conversation
 */
export function useCreateConversation(
  workspaceId: string
): UseMutationResult<Conversation, Error, CreateConversationInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateConversationInput) => {
      const response = await api.post<Conversation>(
        `/api/workspaces/${workspaceId}/conversations`,
        input
      );
      return response.data;
    },
    onSuccess: (data) => {
      // Invalidate list query to refetch
      queryClient.invalidateQueries({
        queryKey: [CONVERSATIONS_KEY, workspaceId],
      });
      // Cache the new conversation
      queryClient.setQueryData([CONVERSATIONS_KEY, data.id], data);
    },
  });
}

/**
 * Update a conversation
 */
export function useUpdateConversation(
  workspaceId: string,
  conversationId: string
): UseMutationResult<Conversation, Error, UpdateConversationInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateConversationInput) => {
      const response = await api.patch<Conversation>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}`,
        input
      );
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData([CONVERSATIONS_KEY, conversationId], data);
      queryClient.invalidateQueries({
        queryKey: [CONVERSATIONS_KEY, workspaceId],
      });
    },
  });
}

/**
 * Delete a conversation (soft delete)
 */
export function useDeleteConversation(
  workspaceId: string,
  conversationId: string
): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await api.delete(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [CONVERSATIONS_KEY, workspaceId],
      });
      queryClient.removeQueries({
        queryKey: [CONVERSATIONS_KEY, conversationId],
      });
    },
  });
}

/**
 * Archive a conversation
 */
export function useArchiveConversation(
  workspaceId: string,
  conversationId: string
): UseMutationResult<Conversation, Error, void> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await api.patch<Conversation>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}`,
        { isArchived: true }
      );
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData([CONVERSATIONS_KEY, conversationId], data);
      queryClient.invalidateQueries({
        queryKey: [CONVERSATIONS_KEY, workspaceId],
      });
    },
  });
}

/**
 * Restore an archived conversation
 */
export function useRestoreConversation(
  workspaceId: string,
  conversationId: string
): UseMutationResult<Conversation, Error, void> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await api.patch<Conversation>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}`,
        { isArchived: false }
      );
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData([CONVERSATIONS_KEY, conversationId], data);
      queryClient.invalidateQueries({
        queryKey: [CONVERSATIONS_KEY, workspaceId],
      });
    },
  });
}

/**
 * Search conversations
 */
export function useSearchConversations(
  workspaceId: string,
  query: string,
  options?: { enabled?: boolean }
): UseQueryResult<{ items: Conversation[]; total: number }> {
  return useQuery({
    queryKey: ['conversations-search', workspaceId, query],
    queryFn: async () => {
      return api.get<{ items: Conversation[]; total: number }>(
        `/api/workspaces/${workspaceId}/conversations?search=${encodeURIComponent(query)}&take=20`
      );
    },
    enabled: !!query && !!workspaceId && options?.enabled !== false,
    staleTime: 30000, // 30s
  });
}
