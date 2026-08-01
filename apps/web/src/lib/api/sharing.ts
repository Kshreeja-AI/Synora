'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
} from '@tanstack/react-query';
import { api } from './client';

export enum SharePermission {
  VIEW = 'VIEW',         // Read-only
  EDIT = 'EDIT',         // Can add messages
  MANAGE = 'MANAGE',     // Full control (edit/delete/manage sharing)
}

export interface SharedConversation {
  id: string;
  conversationId: string;
  inviteToken: string;
  inviteUrl?: string;
  permission: SharePermission;
  sharedBy: string;
  sharedWith?: string;
  createdAt: string;
  acceptedAt?: string;
  expiresAt?: string;
}

export interface CreateShareInput {
  permission: SharePermission;
  expiresIn?: string; // e.g., "7d", "30d", "never"
}

export interface ShareResponse {
  id: string;
  inviteToken: string;
  inviteUrl: string;
  permission: SharePermission;
  expiresAt?: string;
  createdAt: string;
}

const SHARING_KEY = 'sharing';

/**
 * Get all shares for a conversation
 */
export function useConversationShares(
  workspaceId: string,
  conversationId: string,
  options?: { enabled?: boolean }
): UseQueryResult<SharedConversation[]> {
  return useQuery({
    queryKey: [SHARING_KEY, 'conversation', conversationId],
    queryFn: async () => {
      const response = await api.get<SharedConversation[]>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/shared`
      );
      return Array.isArray(response) ? response : [];
    },
    enabled: !!workspaceId && !!conversationId && options?.enabled !== false,
  });
}

/**
 * Create a new share link for a conversation
 */
export function useCreateShare(
  workspaceId: string,
  conversationId: string
): UseMutationResult<ShareResponse, Error, CreateShareInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateShareInput) => {
      return api.post<ShareResponse>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/share`,
        input
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [SHARING_KEY, 'conversation', conversationId],
      });
    },
  });
}

/**
 * Revoke access to a shared conversation
 */
export function useRevokeShare(
  workspaceId: string,
  conversationId: string
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (shareId: string) => {
      await api.delete(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/shared/${shareId}`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [SHARING_KEY, 'conversation', conversationId],
      });
    },
  });
}

/**
 * Accept a shared conversation invite (public, no auth required)
 */
export async function acceptShareInvite(
  inviteToken: string
): Promise<{
  conversationId: string;
  permission: SharePermission;
  title: string;
  description?: string;
}> {
  return api.post(
    `/api/shared/conversations/${inviteToken}/accept`,
    {}
  );
}

/**
 * Get public shared conversation info (no auth required)
 */
export async function getSharedConversationInfo(
  inviteToken: string
): Promise<{
  conversationId: string;
  permission: SharePermission;
  title: string;
  description?: string;
  isExpired?: boolean;
}> {
  return api.get(
    `/api/shared/conversations/${inviteToken}`
  );
}

/**
 * Copy share link to clipboard
 */
export function copyShareLink(url: string): boolean {
  if (!url) return false;

  try {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url);
      return true;
    } else {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = url;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    }
  } catch {
    return false;
  }
}

/**
 * Get the display name for a permission level
 */
export function getPermissionLabel(permission: SharePermission): string {
  const labels: Record<SharePermission, string> = {
    [SharePermission.VIEW]: 'Can view',
    [SharePermission.EDIT]: 'Can edit',
    [SharePermission.MANAGE]: 'Can manage',
  };
  return labels[permission];
}

/**
 * Get the description for a permission level
 */
export function getPermissionDescription(permission: SharePermission): string {
  const descriptions: Record<SharePermission, string> = {
    [SharePermission.VIEW]: 'Recipients can view the conversation but cannot send messages',
    [SharePermission.EDIT]: 'Recipients can view and send messages in the conversation',
    [SharePermission.MANAGE]: 'Recipients can view, send, edit, delete messages and manage sharing',
  };
  return descriptions[permission];
}
