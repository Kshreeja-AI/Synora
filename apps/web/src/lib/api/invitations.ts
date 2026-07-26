import { api } from './client';
import type { InvitationPreview } from './types';

export function previewInvitation(token: string): Promise<InvitationPreview> {
  return api.get<InvitationPreview>(`/api/invitations/${token}`, { anonymous: true });
}

export function acceptInvitation(token: string): Promise<{ workspaceId: string }> {
  return api.post<{ workspaceId: string }>(`/api/invitations/${token}/accept`);
}
