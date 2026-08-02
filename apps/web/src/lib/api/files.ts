import {
  useMutation,
  useQuery,
  useQueryClient,
  UseMutationResult,
  UseQueryResult,
} from '@tanstack/react-query';
import { api, getApiBaseUrl } from './client';

/**
 * Shape returned by the backend's file list endpoint
 * (fileService.getConversationFiles select clause). `storageKey` is
 * deliberately NOT exposed to clients — storage layout is a backend
 * concern.
 */
export interface ConversationFile {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  processingStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  virusScanStatus: 'PENDING' | 'CLEAN' | 'INFECTED';
  extractedText?: string | null;
  createdAt: string;
}

/** Shape returned by the upload endpoint (fileService.uploadFile). */
export interface UploadFileResponse {
  id: string;
  fileName: string;
  url: string;
  status: string;
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
): UseMutationResult<UploadFileResponse, Error, File> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);

      return api.upload<UploadFileResponse>(
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
 * Absolute download URL for a file. Must target the backend origin —
 * a relative path would resolve against the Next.js origin, which
 * has no such route. Auth rides on the accessToken cookie, which the
 * browser sends automatically on same-site top-level navigations
 * (i.e. clicking a download link).
 */
export function getFileDownloadUrl(
  workspaceId: string,
  conversationId: string,
  fileId: string
): string {
  return `${getApiBaseUrl()}/api/workspaces/${workspaceId}/conversations/${conversationId}/files/${fileId}/download`;
}
