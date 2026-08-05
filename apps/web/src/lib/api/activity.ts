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

/**
 * What happened since THIS person last opened the workspace home. Null
 * on a first-ever visit (there is no "since" yet); a `count: 0` digest
 * when nothing happened since a real one. Reading it IS the visit — the
 * server moves the baseline forward after answering.
 */
export interface WorkspaceWhatsNew {
  previousVisitAt: string;
  count: number;
}

export const WHATS_NEW_KEY = 'workspace-whats-new';

export function useWorkspaceWhatsNew(
  workspaceId: string,
  options?: { enabled?: boolean },
): UseQueryResult<WorkspaceWhatsNew | null> {
  return useQuery({
    queryKey: [WHATS_NEW_KEY, workspaceId],
    queryFn: () =>
      api.get<WorkspaceWhatsNew | null>(`/api/workspaces/${workspaceId}/whats-new`),
    enabled: !!workspaceId && options?.enabled !== false,
    // Never refetched in the background: each read consumes the "since
    // last time" baseline, so an invisible refetch would silently zero a
    // digest the person had not read yet.
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
}

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
