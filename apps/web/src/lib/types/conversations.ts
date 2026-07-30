/**
 * Conversation and Message types for Release 3 Universal AI Workspace
 */

export type ConversationStatus = 'ACTIVE' | 'ARCHIVED' | 'DELETED';
export type MessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM';

export interface Conversation {
  id: string;
  workspaceId: string;
  title: string;
  description?: string;
  provider: string;
  model: string;
  status: ConversationStatus;
  isArchived: boolean;
  isPinned: boolean;
  lastMessageAt?: Date;
  folderId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  content: string;
  role: MessageRole;
  parentId?: string;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageBranch {
  id: string;
  messageId: string;
  branchIndex: number;
  isMainBranch: boolean;
  createdAt: Date;
}

export interface StreamEvent {
  type: 'token' | 'done' | 'error' | 'start';
  data: any;
}

export interface CreateConversationInput {
  title?: string;
  description?: string;
  provider?: string;
  model?: string;
  folderId?: string;
  templateId?: string;
}

export interface UpdateConversationInput {
  title?: string;
  description?: string;
  provider?: string;
  model?: string;
  folderId?: string;
  isPinned?: boolean;
  isArchived?: boolean;
}

export interface CreateMessageInput {
  content: string;
  role: MessageRole;
  parentId?: string;
}

export interface SearchConversationsInput {
  query?: string;
  limit?: number;
  offset?: number;
  archived?: boolean;
}

export interface ConversationFolder {
  id: string;
  workspaceId: string;
  name: string;
  parentId?: string;
  createdAt: Date;
  updatedAt: Date;
}
