/**
 * Conversation types — Release 3 placeholder
 *
 * Complete type definitions reserved for Release 3 implementation.
 * Stub types exported for build compatibility.
 */

export interface Conversation {
  id: string;
  workspaceId: string;
  title: string;
  description?: string;
  provider: string;
  model: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  content: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  inputTokens?: number;
  outputTokens?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateConversationInput {
  title?: string;
  description?: string;
  provider?: string;
  model?: string;
  projectId?: string;
  folderId?: string;
}

export interface UpdateConversationInput {
  title?: string;
  description?: string;
  isArchived?: boolean;
}
