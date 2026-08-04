'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api } from './client';

/**
 * The workspace's recent history, as sentences.
 *
 * Work events only — the server enforces an allowlist, so this can never
 * show a member governance history (roles, invitations, billing) that
 * `audit:view` exists to gate. The sentence is composed server-side from
 * what was actually recorded; the client renders it verbatim rather than
 * re-deriving its own wording of the same event.
 */
export interface ActivityEntry {
  id: string;
  sentence: string;
  actor: { id: string; name: string | null } | null;
  action: string;
  targetType: string;
  targetId: string | null;
  /** ISO. */
  at: string;
}

export const ACTIVITY_KEY = 'workspace-activity';

export function useWorkspaceActivity(
  workspaceId: string,
  options?: { enabled?: boolean; limit?: number },
): UseQueryResult<ActivityEntry[]> {
  const limit = options?.limit;
  return useQuery({
    queryKey: [ACTIVITY_KEY, workspaceId, limit ?? 'default'],
    queryFn: () =>
      api.get<ActivityEntry[]>(
        `/api/workspaces/${workspaceId}/activity${limit ? `?limit=${limit}` : ''}`,
      ),
    enabled: !!workspaceId && options?.enabled !== false,
  });
}
