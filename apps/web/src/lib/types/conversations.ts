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
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  content: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateConversationInput {
  title?: string;
  description?: string;
  projectId?: string;
  folderId?: string;
}

export interface UpdateConversationInput {
  title?: string;
  description?: string;
  isArchived?: boolean;
}
