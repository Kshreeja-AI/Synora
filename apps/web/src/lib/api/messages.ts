/**
 * Message API client with TanStack Query
 * Handles message CRUD operations and streaming
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
} from '@tanstack/react-query';
import { api } from './client';

export interface MessageAttachment {
  id: string;
  url: string;
  mimeType: string;
  name: string;
  size: number;
  createdAt: string;
}

export interface ConversationMessage {
  id: string;
  content: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  createdAt: string;
  inputTokens?: number;
  outputTokens?: number;
  parentId?: string | null;
  attachments?: MessageAttachment[];
  isPinned?: boolean;
  /**
   * Total sibling alternatives at this fork (including self). Attached
   * by the backend linearizer — `1` for messages with no siblings.
   */
  siblingCount?: number;
  /**
   * 0-based index of this message among its siblings, ordered by
   * createdAt. Attached by the backend linearizer.
   */
  siblingIndex?: number;
}

export interface CreateMessageInput {
  content: string;
  role: 'USER' | 'SYSTEM';
  parentId?: string;
  fileIds?: string[];
}

export interface CreateMessageResponse {
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  jobId: string;
}

const MESSAGES_KEY = 'messages';

/**
 * Fetch messages for a conversation (paginated)
 */
export function useMessages(
  workspaceId: string,
  conversationId: string,
  options?: { enabled?: boolean }
): UseQueryResult<ConversationMessage[]> {
  return useQuery({
    queryKey: [MESSAGES_KEY, conversationId],
    queryFn: async () => {
      const response = await api.get<ConversationMessage[]>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages`
      );
      return response ?? [];
    },
    enabled: !!conversationId && !!workspaceId && options?.enabled !== false,
  });
}

/**
 * Create and send a message (user or system)
 * For user messages, automatically creates a placeholder assistant message
 * and returns both messages along with a jobId for streaming
 */
export function useSendMessage(
  workspaceId: string,
  conversationId: string
): UseMutationResult<CreateMessageResponse, Error, CreateMessageInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateMessageInput) => {
      const response = await api.post<CreateMessageResponse>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages`,
        input
      );
      return response;
    },
    onSuccess: () => {
      // Invalidate messages query to refetch if needed
      queryClient.invalidateQueries({
        queryKey: [MESSAGES_KEY, conversationId],
      });
    },
  });
}

/**
 * Subscribe to message generation stream via Server-Sent Events
 * Yields tokens as they arrive, then completion event with metadata
 */
export function subscribeToMessageStream(
  workspaceId: string,
  conversationId: string,
  messageId: string,
  onToken: (token: string) => void,
  onComplete: (data: { inputTokens: number; outputTokens: number }) => void,
  onError: (error: string) => void
): () => void {
  const streamUrl = `/api/workspaces/${workspaceId}/conversations/${conversationId}/stream?messageId=${messageId}`;
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  // Resolve the full URL based on environment
  const fullUrl = baseUrl
    ? `${baseUrl}${streamUrl}`
    : streamUrl;

  const eventSource = new EventSource(fullUrl, { withCredentials: true });

  eventSource.addEventListener('token', (e) => {
    try {
      const token = JSON.parse(e.data);
      onToken(token.content || '');
    } catch (err) {
      console.error('Failed to parse token event', err);
    }
  });

  eventSource.addEventListener('done', (e) => {
    try {
      const completion = JSON.parse(e.data);
      onComplete({
        inputTokens: completion.inputTokens || 0,
        outputTokens: completion.outputTokens || 0,
      });
    } catch (err) {
      console.error('Failed to parse completion event', err);
    }
    eventSource.close();
  });

  eventSource.addEventListener('error', () => {
    onError('Connection lost while streaming response');
    eventSource.close();
  });

  eventSource.addEventListener('heartbeat', () => {
    // Heartbeat to keep connection alive
  });

  // Return cleanup function
  return () => {
    eventSource.close();
  };
}

/**
 * Regenerate an assistant response. The server clears the message and
 * re-enqueues generation against the same messageId, so the caller can
 * re-subscribe to the stream with the id it already has.
 */
export function useRegenerateMessage(
  workspaceId: string,
  conversationId: string
): UseMutationResult<{ message: ConversationMessage; jobId: string }, Error, string> {
  return useMutation({
    mutationFn: async (messageId: string) => {
      return api.post<{ message: ConversationMessage; jobId: string }>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}/regenerate`
      );
    },
  });
}

/**
 * Cancel an in-flight generation.
 */
export function useCancelGeneration(
  workspaceId: string,
  conversationId: string
): UseMutationResult<void, Error, string> {
  return useMutation({
    mutationFn: async (jobId: string) => {
      await api.post(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/stream/${jobId}/cancel`
      );
    },
  });
}

/**
 * Update a message (user messages only)
 */
export function useUpdateMessage(
  workspaceId: string,
  conversationId: string,
  messageId: string
): UseMutationResult<ConversationMessage, Error, { content: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { content: string }) => {
      const response = await api.patch<ConversationMessage>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}`,
        input
      );
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [MESSAGES_KEY, conversationId],
      });
    },
  });
}

/**
 * Delete a message (soft delete)
 */
export function useDeleteMessage(
  workspaceId: string,
  conversationId: string
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (messageId: string) => {
      await api.delete(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [MESSAGES_KEY, conversationId],
      });
    },
  });
}

/**
 * Add attachment to a message
 */
export function useAddMessageAttachment(
  workspaceId: string,
  conversationId: string,
  messageId: string
): UseMutationResult<
  void,
  Error,
  { url: string; mimeType: string; name: string; size: number }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input) => {
      await api.post(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}/attachments`,
        input
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [MESSAGES_KEY, conversationId],
      });
    },
  });
}

/**
 * Pin a message to conversation
 */
export function usePinMessage(
  workspaceId: string,
  conversationId: string
): UseMutationResult<ConversationMessage, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (messageId: string) => {
      return api.post<ConversationMessage>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}/pin`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [MESSAGES_KEY, conversationId],
      });
    },
  });
}

/**
 * Unpin a message from conversation
 */
export function useUnpinMessage(
  workspaceId: string,
  conversationId: string
): UseMutationResult<ConversationMessage, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (messageId: string) => {
      return api.post<ConversationMessage>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}/unpin`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [MESSAGES_KEY, conversationId],
      });
    },
  });
}
