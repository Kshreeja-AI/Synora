'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { listWorkspaces } from '../lib/api/workspaces';
import type { WorkspaceSummary } from '../lib/api/types';

export function useWorkspaces(): UseQueryResult<WorkspaceSummary[]> {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  });
}
