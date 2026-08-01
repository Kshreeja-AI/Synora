'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
} from '@tanstack/react-query';
import { api } from './client';

export interface ConversationFile {
  id: string;
  conversationId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  isArchived: boolean;
  uploadedBy: string;
  createdAt: string;
}

export interface FileUploadResponse {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
  downloadUrl?: string;
}

const FILES_KEY = 'files';

/**
 * Get all files in a conversation
 */
export function useConversationFiles(
  workspaceId: string,
  conversationId: string,
  options?: { enabled?: boolean }
): UseQueryResult<ConversationFile[]> {
  return useQuery({
    queryKey: [FILES_KEY, 'conversation', conversationId],
    queryFn: async () => {
      const response = await api.get<{ items: ConversationFile[] } | ConversationFile[]>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/files`
      );
      return Array.isArray(response) ? response : response.items || [];
    },
    enabled: !!workspaceId && !!conversationId && options?.enabled !== false,
  });
}

/**
 * Upload file to conversation
 */
export function useUploadFile(
  workspaceId: string,
  conversationId: string
): UseMutationResult<FileUploadResponse, Error, File> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/files`,
        {
          method: 'POST',
          body: formData,
          headers: {
            Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('token') || '' : ''}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}`);
      }

      const data = await response.json();
      return data.data || data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [FILES_KEY, 'conversation', conversationId],
      });
    },
  });
}

/**
 * Delete file from conversation
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
        queryKey: [FILES_KEY, 'conversation', conversationId],
      });
    },
  });
}
