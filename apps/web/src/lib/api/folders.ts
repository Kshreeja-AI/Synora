import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface ConversationFolder {
  id: string;
  workspaceId: string;
  parentId?: string;
  name: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  conversationCount?: number;
  children?: ConversationFolder[];
}

const FOLDERS_KEY = 'folders';

// Raw API functions for direct use (non-hook)
export async function listFolders(
  workspaceId: string,
  options?: { projectId?: string; parentId?: string | null }
): Promise<ConversationFolder[]> {
  const params = new URLSearchParams();
  if (options?.projectId) params.append('projectId', options.projectId);
  if (options?.parentId !== undefined) params.append('parentId', String(options.parentId));

  const queryString = params.toString();
  const url = queryString
    ? `/api/workspaces/${workspaceId}/folders?${queryString}`
    : `/api/workspaces/${workspaceId}/folders`;

  const response = await api.get<{ items: ConversationFolder[] }>(url);
  return response.items || [];
}

export async function createFolder(
  workspaceId: string,
  input: { name: string; parentId?: string; projectId?: string }
): Promise<ConversationFolder> {
  return api.post<ConversationFolder>(
    `/api/workspaces/${workspaceId}/folders`,
    input
  );
}

export async function renameFolder(
  workspaceId: string,
  folderId: string,
  name: string
): Promise<ConversationFolder> {
  return api.patch<ConversationFolder>(
    `/api/workspaces/${workspaceId}/folders/${folderId}`,
    { name }
  );
}

export async function deleteFolder(
  workspaceId: string,
  folderId: string
): Promise<void> {
  await api.delete(`/api/workspaces/${workspaceId}/folders/${folderId}`);
}

export function useCreateFolder(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { name: string; parentId?: string }) => {
      return api.post<ConversationFolder>(
        `/api/workspaces/${workspaceId}/folders`,
        input
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [FOLDERS_KEY, workspaceId],
      });
    },
  });
}

export function useFolders(workspaceId: string) {
  return useQuery({
    queryKey: [FOLDERS_KEY, workspaceId],
    queryFn: async () => {
      const response = await api.get<{ items: ConversationFolder[] }>(
        `/api/workspaces/${workspaceId}/folders`
      );
      return response.items || [];
    },
    enabled: !!workspaceId,
  });
}

export function useFolder(workspaceId: string, folderId: string) {
  return useQuery({
    queryKey: [FOLDERS_KEY, folderId],
    queryFn: async () => {
      return api.get<ConversationFolder>(
        `/api/workspaces/${workspaceId}/folders/${folderId}`
      );
    },
    enabled: !!folderId && !!workspaceId,
  });
}

export function useUpdateFolder(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { folderId: string; name: string }) => {
      return api.patch<ConversationFolder>(
        `/api/workspaces/${workspaceId}/folders/${input.folderId}`,
        { name: input.name }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [FOLDERS_KEY, workspaceId],
      });
    },
  });
}

export function useMoveFolder(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { folderId: string; parentId?: string | null }) => {
      return api.post<ConversationFolder>(
        `/api/workspaces/${workspaceId}/folders/${input.folderId}/move`,
        { parentId: input.parentId }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [FOLDERS_KEY, workspaceId],
      });
    },
  });
}

export function useDeleteFolder(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (folderId: string) => {
      await api.delete(
        `/api/workspaces/${workspaceId}/folders/${folderId}`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [FOLDERS_KEY, workspaceId],
      });
    },
  });
}

export function useMoveConversationToFolder(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { conversationId: string; folderId?: string | null }) => {
      await api.post(
        `/api/workspaces/${workspaceId}/conversations/${input.conversationId}/move-to-folder`,
        { folderId: input.folderId }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [FOLDERS_KEY, workspaceId],
      });
    },
  });
}
