'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { listWaitingElsewhere, type WaitingElsewhereEntry } from '../lib/api/workspaces';

/**
 * Decisions waiting on me in OTHER workspaces. A paused run in a
 * workspace I never open is just as stopped as one in front of me —
 * this is how the home page avoids quietly hiding it.
 */
export function useWaitingElsewhere(): UseQueryResult<WaitingElsewhereEntry[]> {
  return useQuery({
    queryKey: ['workspaces', 'waiting-elsewhere'],
    queryFn: listWaitingElsewhere,
  });
}
