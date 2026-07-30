/**
 * Message API client with streaming support
 * Handles message CRUD, streaming SSE, regeneration, continuation
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
import type { Message, CreateMessageInput } from '@/lib/types/conversations';

const MESSAGES_KEY = 'messages';

/**
 * Fetch messages for a conversation (paginated, infinite scroll UP = older messages)
 */
export function useMessages(
  workspaceId: string,
  conversationId: string,
  options?: { enabled?: boolean }
): UseInfiniteQueryResult<{ items: Message[]; hasMore: boolean }> {
  return useInfiniteQuery({
    queryKey: [MESSAGES_KEY, conversationId],
    queryFn: async ({ pageParam = 0 }) => {
      return api.get<{ items: Message[]; hasMore: boolean }>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages?skip=${pageParam}&take=50`
      );
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore) return undefined;
      return undefined;
    },
    initialPageParam: 0,
    enabled: !!conversationId && !!workspaceId && options?.enabled !== false,
  });
}

/**
 * Fetch a single message
 */
export function useMessage(
  workspaceId: string,
  conversationId: string,
  messageId: string,
  options?: { enabled?: boolean }
): UseQueryResult<Message> {
  return useQuery({
    queryKey: [MESSAGES_KEY, messageId],
    queryFn: async () => {
      const response = await api.get<Message>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}`
      );
      return response.data;
    },
    enabled:
      !!messageId && !!conversationId && !!workspaceId && options?.enabled !== false,
  });
}

/**
 * Create a message and stream the response
 * Returns { messageId, stream, cancel }
 */
export function useCreateMessage(
  workspaceId: string,
  conversationId: string
): UseMutationResult<
  { messageId: string; stream: EventSource },
  Error,
  CreateMessageInput
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateMessageInput) => {
      // 1. Create the message (returns with status PENDING)
      const response = await api.post<Message>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages`,
        input
      );
      const message = response.data;

      // 2. Open SSE stream for response generation
      const stream = new EventSource(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/stream?messageId=${message.id}`
      );

      return { messageId: message.id, stream };
    },
    onSuccess: () => {
      // Invalidate messages query to refetch list
      queryClient.invalidateQueries({
        queryKey: [MESSAGES_KEY, conversationId],
      });
    },
  });
}

/**
 * Update a message (edit)
 */
export function useUpdateMessage(
  workspaceId: string,
  conversationId: string,
  messageId: string
): UseMutationResult<Message, Error, Partial<CreateMessageInput>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: Partial<CreateMessageInput>) => {
      const response = await api.patch<Message>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}`,
        input
      );
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData([MESSAGES_KEY, messageId], data);
      queryClient.invalidateQueries({
        queryKey: [MESSAGES_KEY, conversationId],
      });
    },
  });
}

/**
 * Delete a message
 */
export function useDeleteMessage(
  workspaceId: string,
  conversationId: string,
  messageId: string
): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await api.delete(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}`
      );
    },
    onSuccess: () => {
      queryClient.removeQueries({
        queryKey: [MESSAGES_KEY, messageId],
      });
      queryClient.invalidateQueries({
        queryKey: [MESSAGES_KEY, conversationId],
      });
    },
  });
}

/**
 * Regenerate a message (create alternative response)
 */
export function useRegenerateMessage(
  workspaceId: string,
  conversationId: string,
  messageId: string
): UseMutationResult<
  { messageId: string; stream: EventSource },
  Error,
  void
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      // Trigger regeneration on the server
      // This will create a new assistant message and return its ID + stream URL
      const response = await api.post<{ messageId: string; streamUrl: string }>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}/regenerate`
      );

      const stream = new EventSource(response.streamUrl);
      return { messageId: response.messageId, stream };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [MESSAGES_KEY, conversationId],
      });
    },
  });
}

/**
 * Continue generation (append more tokens to an existing message)
 */
export function useContinueMessage(
  workspaceId: string,
  conversationId: string,
  messageId: string
): UseMutationResult<
  { stream: EventSource },
  Error,
  void
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await api.post<{ streamUrl: string }>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}/continue`
      );

      const stream = new EventSource(response.streamUrl);
      return { stream };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [MESSAGES_KEY, messageId],
      });
    },
  });
}

/**
 * Create a branch (alternative generation from a message)
 */
export function useBranchMessage(
  workspaceId: string,
  conversationId: string,
  messageId: string
): UseMutationResult<
  { messageId: string; stream: EventSource },
  Error,
  { title?: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { title?: string }) => {
      const response = await api.post<{ messageId: string; streamUrl: string }>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}/branch`,
        input
      );

      const stream = new EventSource(response.streamUrl);
      return { messageId: response.messageId, stream };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [MESSAGES_KEY, conversationId],
      });
    },
  });
}
