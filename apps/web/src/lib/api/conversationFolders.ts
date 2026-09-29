'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

/**
 * Conversation folders — `/api/workspaces/:id/conversation-folders`.
 *
 * Deliberately separate from `./folders`, which is the *asset* folder
 * (`Folder`: workspace + project scoped, holds uploaded assets). These
 * are two different tables with two different parents, and conflating
 * them is not hypothetical: a folder created under the wrong model can
 * never hold the thing the user was trying to file.
 */
export interface ConversationFolder {
  id: string;
  workspaceId: string;
  parentId?: string | null;
  name: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  children?: ConversationFolder[];
  conversations?: { id: string; title: string }[];
  /** Backend returns Prisma's `_count`; the tree shows the conversation tally. */
  _count?: { conversations: number; children: number };
}

const KEY = 'conversation-folders';

export function conversationFoldersKey(workspaceId: string, parentId?: string) {
  return parentId ? [KEY, workspaceId, parentId] : [KEY, workspaceId];
}

/** Lists root folders by default, or the children of `parentId`. */
export function useConversationFolders(workspaceId: string, parentId?: string) {
  return useQuery({
    queryKey: conversationFoldersKey(workspaceId, parentId),
    queryFn: async () => {
      const query = parentId ? `?parentId=${encodeURIComponent(parentId)}` : '';
      return api.get<ConversationFolder[]>(
        `/api/workspaces/${workspaceId}/conversation-folders${query}`
      );
    },
    enabled: !!workspaceId,
  });
}

export function useCreateConversationFolder(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { name: string; parentId?: string }) =>
      api.post<ConversationFolder>(
        `/api/workspaces/${workspaceId}/conversation-folders`,
        input
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY, workspaceId] });
    },
  });
}

export function useRenameConversationFolder(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { folderId: string; name: string }) =>
      api.patch<ConversationFolder>(
        `/api/workspaces/${workspaceId}/conversation-folders/${input.folderId}`,
        { name: input.name }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY, workspaceId] });
    },
  });
}

export function useDeleteConversationFolder(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (folderId: string) => {
      await api.delete(`/api/workspaces/${workspaceId}/conversation-folders/${folderId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY, workspaceId] });
    },
  });
}

/** Files a conversation into a folder, or out of every folder with `null`. */
export function useMoveConversationToFolder(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { conversationId: string; folderId: string | null }) => {
      await api.post(`/api/workspaces/${workspaceId}/conversation-folders/move`, {
        conversationId: input.conversationId,
        folderId: input.folderId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY, workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['conversations', workspaceId] });
    },
  });
}
