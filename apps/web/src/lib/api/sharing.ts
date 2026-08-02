/**
 * Sharing API client.
 *
 * Backend contract (routes/sharing.ts + sharing-public.ts):
 *   POST   /api/workspaces/:ws/conversations/:c/share
 *            body { permissions?: 'VIEW'|'COMMENT'|'EDIT',
 *                   isPublic?: boolean, expiresAt?: ISO datetime }
 *   GET    /api/workspaces/:ws/conversations/:c/share      → ShareLink[]
 *   DELETE /api/workspaces/:ws/conversations/:c/share/:id
 *   GET    /api/shared/:shareToken   (public, no auth)
 *
 * The share URL given to users points at the FRONTEND page
 * (/share/:token), which fetches the public endpoint client-side.
 */

'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
} from '@tanstack/react-query';
import { api } from './client';

export type SharePermission = 'VIEW' | 'COMMENT' | 'EDIT';

/** Mirrors the backend's SharedConversation record. */
export interface ShareLink {
  id: string;
  conversationId: string;
  shareToken: string;
  permissions: SharePermission;
  isPublic: boolean;
  expiresAt?: string | null;
  createdAt: string;
}

export interface CreateShareInput {
  permissions?: SharePermission;
  isPublic?: boolean;
  expiresAt?: string; // ISO datetime
}

/** Public-safe shape served by GET /api/shared/:token. */
export interface PublicSharedConversation {
  conversation: {
    id: string;
    title: string;
    description: string | null;
    createdAt: string;
  };
  messages: {
    id: string;
    role: 'USER' | 'ASSISTANT' | 'SYSTEM';
    content: string;
    createdAt: string;
  }[];
  permissions: SharePermission;
}

const SHARING_KEY = 'sharing';

export function useConversationShares(
  workspaceId: string,
  conversationId: string,
  options?: { enabled?: boolean }
): UseQueryResult<ShareLink[]> {
  return useQuery({
    queryKey: [SHARING_KEY, conversationId],
    queryFn: async () => {
      const response = await api.get<ShareLink[]>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/share`
      );
      return Array.isArray(response) ? response : [];
    },
    enabled: !!workspaceId && !!conversationId && options?.enabled !== false,
  });
}

export function useCreateShare(
  workspaceId: string,
  conversationId: string
): UseMutationResult<ShareLink, Error, CreateShareInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateShareInput) =>
      api.post<ShareLink>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/share`,
        input
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SHARING_KEY, conversationId] });
    },
  });
}

export function useRevokeShare(
  workspaceId: string,
  conversationId: string
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (shareId: string) => {
      await api.delete(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/share/${shareId}`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SHARING_KEY, conversationId] });
    },
  });
}

/**
 * Fetch a publicly shared conversation. No auth — only isPublic,
 * unexpired shares resolve; everything else is a uniform 404.
 */
export async function getSharedConversation(
  shareToken: string
): Promise<PublicSharedConversation> {
  return api.get<PublicSharedConversation>(`/api/shared/${shareToken}`, {
    anonymous: true,
  });
}

/**
 * The URL a recipient visits — the frontend's public share page, not
 * the API. Uses the current origin so it works in every environment
 * without configuration.
 */
export function getShareUrl(shareToken: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/share/${shareToken}`;
}

export async function copyShareLink(url: string): Promise<boolean> {
  if (!url) return false;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

export function getPermissionLabel(permission: SharePermission): string {
  const labels: Record<SharePermission, string> = {
    VIEW: 'Can view',
    COMMENT: 'Can comment',
    EDIT: 'Can edit',
  };
  return labels[permission];
}

export function getPermissionDescription(permission: SharePermission): string {
  const descriptions: Record<SharePermission, string> = {
    VIEW: 'Anyone with the link can read this conversation',
    COMMENT: 'Anyone with the link can read and leave comments',
    EDIT: 'Anyone with the link can read and add messages',
  };
  return descriptions[permission];
}
