/**
 * Integrated hook combining conversation, messages, and streaming
 * Handles fetching, storing, and real-time updates for chat interface
 */

import { useCallback, useMemo } from 'react';
import { useMessages, useCreateMessage } from '@/lib/api/messages';
import { useConversation, useCreateConversation } from '@/lib/api/conversations';
import { useRelease3Store } from '@/stores/release3-store';
import { useStream } from './useStream';
import { Message, CreateMessageInput } from '@/lib/types/conversations';

export interface UseConversationChatReturn {
  // Conversation state
  conversation: any; // from useConversation
  isLoadingConversation: boolean;
  conversationError: any;

  // Messages state
  messages: Message[];
  isLoadingMessages: boolean;
  messagesError: any;
  hasMoreMessages: boolean;
  loadMoreMessages: () => void;

  // Streaming state
  isStreaming: boolean;
  streamContent: string;
  streamError: string | null;

  // Actions
  sendMessage: (content: string) => Promise<void>;
  createNewConversation: (title?: string) => Promise<string>;
  stopStreaming: () => void;

  // Store state
  selectedModel: string;
  selectedProvider: string;
  temperature: number;
  topP: number;
  contextWindow: number;

  // Store actions
  setSelectedModel: (model: string) => void;
  setSelectedProvider: (provider: string) => void;
  setTemperature: (temp: number) => void;
  setTopP: (topP: number) => void;
  setContextWindow: (window: number) => void;
}

/**
 * Hook: Integrated chat conversation with API, store, and streaming
 * @param workspaceId - Current workspace ID
 * @param conversationId - Current conversation ID (or null for new)
 * @returns All needed state and actions for chat interface
 */
export function useConversationChat(
  workspaceId: string,
  conversationId: string | null
): UseConversationChatReturn {
  const store = useRelease3Store();

  // API hooks
  const conversationQuery = useConversation(workspaceId, conversationId || '', {
    enabled: !!conversationId,
  });

  const messagesQuery = useMessages(workspaceId, conversationId || '', {
    enabled: !!conversationId,
  });

  const createMessageMutation = useCreateMessage(workspaceId, conversationId || '');
  const createConversationMutation = useCreateConversation(workspaceId);

  // Streaming hook
  const streamResult = useStream(
    store.isStreaming && store.streamingMessageId
      ? new EventSource(
          `/api/workspaces/${workspaceId}/conversations/${conversationId}/stream?messageId=${store.streamingMessageId}`
        )
      : null,
    (token) => store.addStreamToken(token)
  );

  // Memoized messages from store
  const messages = useMemo(() => {
    if (!conversationId) return [];
    return store.messages.get(conversationId) || [];
  }, [store.messages, conversationId]);

  // Load more messages (infinite scroll)
  const loadMoreMessages = useCallback(() => {
    if (messagesQuery.hasNextPage) {
      messagesQuery.fetchNextPage();
    }
  }, [messagesQuery]);

  // Send message and trigger streaming
  const sendMessage = useCallback(
    async (content: string) => {
      if (!conversationId || !content.trim()) return;

      try {
        // Add user message to store
        const userMessage: Message = {
          id: `temp-${Date.now()}`,
          conversationId,
          content,
          role: 'USER',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.addMessage(conversationId, userMessage);

        // Create message on server (triggers assistant response generation)
        const response = await createMessageMutation.mutateAsync({
          content,
          role: 'USER',
        });

        // Start streaming for assistant response
        store.startStreaming(response.id);

        // Wait for streaming to complete
        await new Promise((resolve) => {
          const checkComplete = setInterval(() => {
            if (!store.isStreaming) {
              clearInterval(checkComplete);
              resolve(true);
            }
          }, 100);
        });
      } catch (err) {
        console.error('Failed to send message:', err);
      }
    },
    [conversationId, store, createMessageMutation]
  );

  // Create new conversation
  const createNewConversation = useCallback(
    async (title?: string) => {
      try {
        const response = await createConversationMutation.mutateAsync({
          title: title || 'New Conversation',
        });
        store.setCurrentConversation(response.id);
        return response.id;
      } catch (err) {
        console.error('Failed to create conversation:', err);
        throw err;
      }
    },
    [store, createConversationMutation]
  );

  // Stop streaming
  const stopStreaming = useCallback(() => {
    streamResult.close();
    store.completeStreaming();
  }, [store, streamResult]);

  return {
    // Conversation
    conversation: conversationQuery.data,
    isLoadingConversation: conversationQuery.isLoading,
    conversationError: conversationQuery.error,

    // Messages
    messages,
    isLoadingMessages: messagesQuery.isLoading,
    messagesError: messagesQuery.error,
    hasMoreMessages: messagesQuery.hasNextPage || false,
    loadMoreMessages,

    // Streaming
    isStreaming: store.isStreaming || streamResult.isStreaming,
    streamContent: store.streamContent || streamResult.content,
    streamError: streamResult.error,

    // Actions
    sendMessage,
    createNewConversation,
    stopStreaming,

    // Store settings
    selectedModel: store.selectedModel,
    selectedProvider: store.selectedProvider,
    temperature: store.temperature,
    topP: store.topP,
    contextWindow: store.contextWindow,

    // Store actions
    setSelectedModel: store.setSelectedModel,
    setSelectedProvider: store.setSelectedProvider,
    setTemperature: store.setTemperature,
    setTopP: store.setTopP,
    setContextWindow: store.setContextWindow,
  };
}
