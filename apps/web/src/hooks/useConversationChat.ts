/**
 * useConversationChat — Release 3 placeholder
 *
 * This hook is reserved for Release 3 conversational AI integration.
 * Placeholder stub exported for type safety.
 *
 * Full implementation scheduled for Release 3 (M1-M10).
 */

export interface UseConversationChatReturn {
  conversation: null;
  isLoadingConversation: false;
  conversationError: null;
  messages: never[];
  isLoadingMessages: false;
  messagesError: null;
  hasMoreMessages: false;
  loadMoreMessages: () => void;
  isStreaming: false;
  streamContent: '';
  streamError: null;
  sendMessage: (content: string) => Promise<void>;
  createNewConversation: (title?: string) => Promise<string>;
  stopStreaming: () => void;
  selectedModel: string;
  selectedProvider: string;
  temperature: number;
  topP: number;
  contextWindow: number;
  setSelectedModel: (model: string) => void;
  setSelectedProvider: (provider: string) => void;
  setTemperature: (temp: number) => void;
  setTopP: (topP: number) => void;
  setContextWindow: (window: number) => void;
}

export function useConversationChat(
  _workspaceId: string,
  _conversationId: string | null
): UseConversationChatReturn {
  return {
    conversation: null,
    isLoadingConversation: false,
    conversationError: null,
    messages: [] as never[],
    isLoadingMessages: false,
    messagesError: null,
    hasMoreMessages: false,
    loadMoreMessages: () => {},
    isStreaming: false,
    streamContent: '',
    streamError: null,
    sendMessage: async () => {},
    createNewConversation: async () => '',
    stopStreaming: () => {},
    selectedModel: 'claude-3-sonnet',
    selectedProvider: 'anthropic',
    temperature: 0.7,
    topP: 1,
    contextWindow: 8192,
    setSelectedModel: () => {},
    setSelectedProvider: () => {},
    setTemperature: () => {},
    setTopP: () => {},
    setContextWindow: () => {},
  };
}
