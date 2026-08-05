import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { api } from './client';
import type { InvitationPreview } from './types';

export function previewInvitation(token: string): Promise<InvitationPreview> {
  return api.get<InvitationPreview>(`/api/invitations/${token}`, { anonymous: true });
}

export function acceptInvitation(token: string): Promise<{ workspaceId: string }> {
  return api.post<{ workspaceId: string }>(`/api/invitations/${token}/accept`);
}

export interface MyInvitation {
  id: string;
  /** The accept credential — only returned to the verified owner of the invited email. */
  token: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  workspaceName: string;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface MyInvitationsResult {
  /**
   * False means the backend refused to look: an unverified email is only
   * a claimed address, and this surface must not be weaker than the
   * emailed token it stands in for. The list is empty in that case —
   * which is NOT a statement that no invitations exist.
   */
  emailVerified: boolean;
  invitations: MyInvitation[];
}

export const MY_INVITATIONS_KEY = ['invitations', 'mine'] as const;

/**
 * Invitations addressed to me — a decision waiting on the person, not on
 * any one workspace, so this is account-scoped.
 */
export function useMyInvitations(options?: {
  enabled?: boolean;
}): UseQueryResult<MyInvitationsResult> {
  return useQuery({
    queryKey: MY_INVITATIONS_KEY,
    queryFn: () => api.get<MyInvitationsResult>('/api/invitations/mine'),
    enabled: options?.enabled !== false,
  });
}
