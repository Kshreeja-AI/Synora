'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createMemory,
  deleteMemory,
  getMemoryStats,
  listMemories,
  pinMemory,
  unpinMemory,
  updateMemory,
  type ListMemoriesParams,
  type Memory,
  type MemorySearchResult,
  type MemoryStats,
  type MemoryType,
} from '../lib/api/memories';

const KEY = 'memories';
const STATS_KEY = 'memory-stats';

/**
 * Fetch memories with the given filters. Not enabled until a workspace id is
 * available so an intermediate render on route change does not fire an
 * `/undefined/memories` request.
 */
export function useMemories(workspaceId: string | null | undefined, params: ListMemoriesParams = {}) {
  return useQuery<MemorySearchResult>({
    queryKey: [KEY, workspaceId, params],
    queryFn: () => listMemories(workspaceId!, params),
    enabled: !!workspaceId,
  });
}

export function useMemoryStats(workspaceId: string | null | undefined) {
  return useQuery<MemoryStats>({
    queryKey: [STATS_KEY, workspaceId],
    queryFn: () => getMemoryStats(workspaceId!),
    enabled: !!workspaceId,
  });
}

/** All mutations invalidate both list and stats to keep counts honest. */
function useInvalidateMemories(workspaceId: string | null | undefined) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: [KEY, workspaceId] });
    qc.invalidateQueries({ queryKey: [STATS_KEY, workspaceId] });
  };
}

export function usePinMemory(workspaceId: string) {
  const invalidate = useInvalidateMemories(workspaceId);
  return useMutation<Memory, Error, string>({
    mutationFn: (memoryId) => pinMemory(workspaceId, memoryId),
    onSuccess: invalidate,
  });
}

export function useUnpinMemory(workspaceId: string) {
  const invalidate = useInvalidateMemories(workspaceId);
  return useMutation<Memory, Error, string>({
    mutationFn: (memoryId) => unpinMemory(workspaceId, memoryId),
    onSuccess: invalidate,
  });
}

export function useDeleteMemory(workspaceId: string) {
  const invalidate = useInvalidateMemories(workspaceId);
  return useMutation<unknown, Error, string>({
    mutationFn: (memoryId) => deleteMemory(workspaceId, memoryId),
    onSuccess: invalidate,
  });
}

export function useUpdateMemory(workspaceId: string) {
  const invalidate = useInvalidateMemories(workspaceId);
  return useMutation<
    Memory,
    Error,
    { memoryId: string; patch: Partial<Pick<Memory, 'content' | 'category' | 'importance' | 'tags'>> }
  >({
    mutationFn: ({ memoryId, patch }) => updateMemory(workspaceId, memoryId, patch),
    onSuccess: invalidate,
  });
}

export function useCreateMemory(workspaceId: string) {
  const invalidate = useInvalidateMemories(workspaceId);
  return useMutation<
    Memory,
    Error,
    { content: string; type: MemoryType; category?: string; tags?: string[]; importance?: number }
  >({
    mutationFn: (input) => createMemory(workspaceId, input),
    onSuccess: invalidate,
  });
}
