import {
  useMutation,
  useQuery,
  useQueryClient,
  UseMutationResult,
  UseQueryResult,
} from '@tanstack/react-query';
import { api } from './client';

export interface ConversationFile {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  uploadedAt: string;
}

export interface UploadFileInput {
  file: File;
}

const FILES_KEY = 'conversation-files';

/**
 * Fetch files for a conversation
 */
export function useConversationFiles(
  workspaceId: string,
  conversationId: string,
  options?: { enabled?: boolean }
): UseQueryResult<ConversationFile[]> {
  return useQuery({
    queryKey: [FILES_KEY, conversationId],
    queryFn: async () => {
      const response = await api.get<{ items: ConversationFile[] }>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/files`
      );
      return response.items || [];
    },
    enabled: !!conversationId && !!workspaceId && options?.enabled !== false,
  });
}

/**
 * Upload a file to a conversation
 */
export function useUploadFile(
  workspaceId: string,
  conversationId: string
): UseMutationResult<ConversationFile, Error, File> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);

      return api.upload<ConversationFile>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/files`,
        formData
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [FILES_KEY, conversationId],
      });
    },
  });
}

/**
 * Delete a file from a conversation
 */
export function useDeleteFile(
  workspaceId: string,
  conversationId: string
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fileId: string) => {
      await api.delete(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/files/${fileId}`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [FILES_KEY, conversationId],
      });
    },
  });
}

/**
 * Get download URL for a file
 */
export function getFileDownloadUrl(
  workspaceId: string,
  conversationId: string,
  fileId: string
): string {
  return `/api/workspaces/${workspaceId}/conversations/${conversationId}/files/${fileId}/download`;
}
