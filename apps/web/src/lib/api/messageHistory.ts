'use client';

import {
  useQuery,
  useMutation,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
} from '@tanstack/react-query';
import { api } from './client';

export interface MessageVersion {
  id: string;
  messageId: string;
  content: string;
  version: number;
  createdAt: string;
  editedBy: string;
}

export interface ConversationSnapshot {
  id: string;
  conversationId: string;
  title: string;
  description?: string;
  messageCount: number;
  createdAt: string;
  createdBy: string;
}

export interface MessageWithHistory {
  id: string;
  content: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  createdAt: string;
  updatedAt?: string;
  versions: MessageVersion[];
}

const HISTORY_KEY = 'messageHistory';
const SNAPSHOTS_KEY = 'conversationSnapshots';

/**
 * Get version history for a message
 */
export function useMessageVersions(
  workspaceId: string,
  conversationId: string,
  messageId: string,
  options?: { enabled?: boolean }
): UseQueryResult<MessageVersion[]> {
  return useQuery({
    queryKey: [HISTORY_KEY, 'message', messageId],
    queryFn: async () => {
      const response = await api.get<{ items: MessageVersion[] } | MessageVersion[]>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}/versions`
      );
      return Array.isArray(response) ? response : response.items || [];
    },
    enabled: !!workspaceId && !!conversationId && !!messageId && options?.enabled !== false,
  });
}

/**
 * Restore message to a previous version
 */
export function useRestoreMessageVersion(
  workspaceId: string,
  conversationId: string,
  messageId: string
): UseMutationResult<MessageWithHistory, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (versionId: string) => {
      return api.post(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}/restore/${versionId}`,
        {}
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [HISTORY_KEY, 'message', messageId],
      });
    },
  });
}

/**
 * Get conversation snapshots
 */
export function useConversationSnapshots(
  workspaceId: string,
  conversationId: string,
  options?: { enabled?: boolean }
): UseQueryResult<ConversationSnapshot[]> {
  return useQuery({
    queryKey: [SNAPSHOTS_KEY, conversationId],
    queryFn: async () => {
      const response = await api.get<{ items: ConversationSnapshot[] } | ConversationSnapshot[]>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/snapshots`
      );
      return Array.isArray(response) ? response : response.items || [];
    },
    enabled: !!workspaceId && !!conversationId && options?.enabled !== false,
  });
}

/**
 * Create conversation snapshot
 */
export function useCreateSnapshot(
  workspaceId: string,
  conversationId: string
): UseMutationResult<ConversationSnapshot, Error, { title: string; description?: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { title: string; description?: string }) => {
      return api.post(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/snapshots`,
        data
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [SNAPSHOTS_KEY, conversationId],
      });
    },
  });
}

/**
 * Export conversation as markdown
 */
export async function exportConversationMarkdown(
  workspaceId: string,
  conversationId: string
): Promise<Blob> {
  const response = await fetch(
    `/api/workspaces/${workspaceId}/conversations/${conversationId}/export/markdown`,
    {
      headers: {
        Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('token') || '' : ''}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error('Failed to export conversation');
  }

  return response.blob();
}

/**
 * Export conversation as JSON
 */
export async function exportConversationJSON(
  workspaceId: string,
  conversationId: string
): Promise<Blob> {
  const response = await fetch(
    `/api/workspaces/${workspaceId}/conversations/${conversationId}/export/json`,
    {
      headers: {
        Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('token') || '' : ''}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error('Failed to export conversation');
  }

  return response.blob();
}

/**
 * Download conversation export blob
 */
export function downloadExport(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
