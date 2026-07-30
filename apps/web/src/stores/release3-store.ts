/**
 * Release 3 Unified Store (Zustand + Immer)
 * Minimal, efficient state management for MVP chat interface
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { Conversation, Message } from '@/lib/types/conversations';

interface Release3Store {
  // Conversation state
  conversations: Conversation[];
  currentConversationId: string | null;
  conversationsLoading: boolean;

  // Message state
  messages: Map<string, Message[]>;
  isStreaming: boolean;
  streamingMessageId: string | null;
  streamContent: string;

  // UI state
  sidebarOpen: boolean;
  selectedMessageId: string | null;
  showSettings: boolean;

  // Settings
  selectedModel: string;
  selectedProvider: string;
  temperature: number;
  topP: number;
  contextWindow: number;

  // Presence
  typingUsers: Set<string>;

  // Actions
  setConversations: (conversations: Conversation[]) => void;
  setCurrentConversation: (id: string | null) => void;
  addConversation: (conversation: Conversation) => void;
  updateConversation: (id: string, updates: Partial<Conversation>) => void;
  deleteConversation: (id: string) => void;

  setMessages: (conversationId: string, messages: Message[]) => void;
  addMessage: (conversationId: string, message: Message) => void;
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void;
  deleteMessage: (conversationId: string, messageId: string) => void;

  startStreaming: (messageId: string) => void;
  addStreamToken: (token: string) => void;
  completeStreaming: () => void;

  setSidebarOpen: (open: boolean) => void;
  setSelectedMessage: (id: string | null) => void;
  setShowSettings: (show: boolean) => void;

  setSelectedModel: (model: string) => void;
  setSelectedProvider: (provider: string) => void;
  setTemperature: (temp: number) => void;
  setTopP: (topP: number) => void;
  setContextWindow: (window: number) => void;

  setTypingUsers: (users: Set<string>) => void;
  addTypingUser: (userId: string) => void;
  removeTypingUser: (userId: string) => void;
}

export const useRelease3Store = create<Release3Store>()(
  immer((set) => ({
    // Initial state
    conversations: [],
    currentConversationId: null,
    conversationsLoading: false,
    messages: new Map(),
    isStreaming: false,
    streamingMessageId: null,
    streamContent: '',
    sidebarOpen: true,
    selectedMessageId: null,
    showSettings: false,
    selectedModel: 'claude-opus',
    selectedProvider: 'anthropic',
    temperature: 0.7,
    topP: 1,
    contextWindow: 8192,
    typingUsers: new Set(),

    // Conversation actions
    setConversations: (conversations) =>
      set((state) => {
        state.conversations = conversations;
      }),

    setCurrentConversation: (id) =>
      set((state) => {
        state.currentConversationId = id;
      }),

    addConversation: (conversation) =>
      set((state) => {
        state.conversations.unshift(conversation);
      }),

    updateConversation: (id, updates) =>
      set((state) => {
        const idx = state.conversations.findIndex((c: Conversation) => c.id === id);
        if (idx !== -1) {
          state.conversations[idx] = { ...state.conversations[idx], ...updates };
        }
      }),

    deleteConversation: (id) =>
      set((state) => {
        state.conversations = state.conversations.filter((c: Conversation) => c.id !== id);
        if (state.currentConversationId === id) {
          state.currentConversationId = null;
        }
      }),

    // Message actions
    setMessages: (conversationId, messages) =>
      set((state) => {
        state.messages.set(conversationId, messages);
      }),

    addMessage: (conversationId, message) =>
      set((state) => {
        const msgs = state.messages.get(conversationId) || [];
        msgs.push(message);
        state.messages.set(conversationId, msgs);
      }),

    updateMessage: (conversationId, messageId, updates) =>
      set((state) => {
        const msgs = state.messages.get(conversationId);
        if (msgs) {
          const idx = msgs.findIndex((m: Message) => m.id === messageId);
          if (idx !== -1) {
            msgs[idx] = { ...msgs[idx], ...updates };
          }
        }
      }),

    deleteMessage: (conversationId, messageId) =>
      set((state) => {
        const msgs = state.messages.get(conversationId);
        if (msgs) {
          state.messages.set(
            conversationId,
            msgs.filter((m: Message) => m.id !== messageId)
          );
        }
      }),

    // Streaming actions
    startStreaming: (messageId) =>
      set((state) => {
        state.isStreaming = true;
        state.streamingMessageId = messageId;
        state.streamContent = '';
      }),

    addStreamToken: (token) =>
      set((state) => {
        state.streamContent += token;
      }),

    completeStreaming: () =>
      set((state) => {
        state.isStreaming = false;
        state.streamingMessageId = null;
        state.streamContent = '';
      }),

    // UI actions
    setSidebarOpen: (open) =>
      set((state) => {
        state.sidebarOpen = open;
      }),

    setSelectedMessage: (id) =>
      set((state) => {
        state.selectedMessageId = id;
      }),

    setShowSettings: (show) =>
      set((state) => {
        state.showSettings = show;
      }),

    // Settings actions
    setSelectedModel: (model) =>
      set((state) => {
        state.selectedModel = model;
      }),

    setSelectedProvider: (provider) =>
      set((state) => {
        state.selectedProvider = provider;
      }),

    setTemperature: (temp) =>
      set((state) => {
        state.temperature = Math.max(0, Math.min(2, temp));
      }),

    setTopP: (topP) =>
      set((state) => {
        state.topP = Math.max(0, Math.min(1, topP));
      }),

    setContextWindow: (window) =>
      set((state) => {
        state.contextWindow = window;
      }),

    // Presence actions
    setTypingUsers: (users) =>
      set((state) => {
        state.typingUsers = users;
      }),

    addTypingUser: (userId) =>
      set((state) => {
        state.typingUsers.add(userId);
      }),

    removeTypingUser: (userId) =>
      set((state) => {
        state.typingUsers.delete(userId);
      }),
  }))
);
