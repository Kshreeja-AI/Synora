import { useMutation, useQuery, useQueryClient, UseQueryResult } from '@tanstack/react-query';
import { api } from './client';

export interface ConversationFile {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  processingStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  virusScanStatus: 'PENDING' | 'SCANNING' | 'CLEAN' | 'INFECTED' | 'FAILED';
  extractedText?: string;
  createdAt: string;
}

const FILES_KEY = 'files';

/**
 * Upload file to conversation
 */
export function useUploadFile(workspaceId: string, conversationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);

      return api.post<{
        id: string;
        fileName: string;
        url: string;
        status: string;
      }>(
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
 * Get files in conversation
 */
export function useConversationFiles(
  workspaceId: string,
  conversationId: string
): UseQueryResult<ConversationFile[]> {
  return useQuery({
    queryKey: [FILES_KEY, conversationId],
    queryFn: async () => {
      const response = await api.get<{ items: ConversationFile[] }>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/files`
      );
      return response.items || [];
    },
    enabled: !!conversationId && !!workspaceId,
  });
}

/**
 * Delete file from conversation
 */
export function useDeleteFile(workspaceId: string, conversationId: string) {
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
