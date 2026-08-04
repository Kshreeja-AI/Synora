'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { api } from './client';

export type BlockKind = 'text' | 'note' | 'link';
export type LinkTarget = 'conversation' | 'run' | 'workflow' | 'agent';

export interface CanvasBlock {
  id: string;
  kind: BlockKind;
  content: string;
  target?: LinkTarget;
  targetId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * A directed line between two blocks. Both endpoints always exist: the
 * server deletes a block's connections along with the block, so the client
 * never has to render a line to nothing.
 */
export interface CanvasConnection {
  id: string;
  from: string;
  to: string;
  label?: string;
  createdAt: number;
}

export interface CanvasDocument {
  id: string;
  workspaceId: string;
  title: string;
  blocks: CanvasBlock[];
  /** Absent on canvases stored before connections existed. */
  connections?: CanvasConnection[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
}

export interface AddBlockInput {
  kind: BlockKind;
  content: string;
  target?: LinkTarget;
  targetId?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export type UpdateBlockInput = Partial<Pick<AddBlockInput, 'content' | 'x' | 'y' | 'width' | 'height'>>;

const KEY = 'canvases';

export function useCanvases(
  workspaceId: string,
  options?: { enabled?: boolean },
): UseQueryResult<CanvasDocument[]> {
  return useQuery({
    queryKey: [KEY, workspaceId],
    queryFn: () => api.get<CanvasDocument[]>(`/api/workspaces/${workspaceId}/canvases`),
    enabled: !!workspaceId && options?.enabled !== false,
  });
}

export function useCanvas(
  workspaceId: string,
  canvasId: string,
  options?: { enabled?: boolean },
): UseQueryResult<CanvasDocument> {
  return useQuery({
    queryKey: [KEY, workspaceId, canvasId],
    queryFn: () => api.get<CanvasDocument>(`/api/workspaces/${workspaceId}/canvases/${canvasId}`),
    enabled: !!workspaceId && !!canvasId && options?.enabled !== false,
  });
}

export function useCreateCanvas(
  workspaceId: string,
): UseMutationResult<CanvasDocument, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title) =>
      api.post<CanvasDocument>(`/api/workspaces/${workspaceId}/canvases`, { title }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY, workspaceId] }),
  });
}

export function useArchiveCanvas(
  workspaceId: string,
): UseMutationResult<CanvasDocument, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (canvasId) =>
      api.delete<CanvasDocument>(`/api/workspaces/${workspaceId}/canvases/${canvasId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY, workspaceId] }),
  });
}

export function useAddBlock(
  workspaceId: string,
): UseMutationResult<CanvasBlock, Error, { canvasId: string; input: AddBlockInput }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ canvasId, input }) =>
      api.post<CanvasBlock>(`/api/workspaces/${workspaceId}/canvases/${canvasId}/blocks`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY, workspaceId] }),
  });
}

export function useUpdateBlock(
  workspaceId: string,
): UseMutationResult<
  CanvasBlock,
  Error,
  { canvasId: string; blockId: string; changes: UpdateBlockInput }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ canvasId, blockId, changes }) =>
      api.patch<CanvasBlock>(
        `/api/workspaces/${workspaceId}/canvases/${canvasId}/blocks/${blockId}`,
        changes,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY, workspaceId] }),
  });
}

export function useRemoveBlock(
  workspaceId: string,
): UseMutationResult<{ deleted: boolean }, Error, { canvasId: string; blockId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ canvasId, blockId }) =>
      api.delete<{ deleted: boolean }>(
        `/api/workspaces/${workspaceId}/canvases/${canvasId}/blocks/${blockId}`,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY, workspaceId] }),
  });
}

export function useConnectBlocks(
  workspaceId: string,
): UseMutationResult<
  CanvasConnection,
  Error,
  { canvasId: string; from: string; to: string; label?: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ canvasId, from, to, label }) =>
      api.post<CanvasConnection>(
        `/api/workspaces/${workspaceId}/canvases/${canvasId}/connections`,
        { from, to, label },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY, workspaceId] }),
  });
}

export function useDisconnectBlocks(
  workspaceId: string,
): UseMutationResult<{ deleted: boolean }, Error, { canvasId: string; connectionId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ canvasId, connectionId }) =>
      api.delete<{ deleted: boolean }>(
        `/api/workspaces/${workspaceId}/canvases/${canvasId}/connections/${connectionId}`,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY, workspaceId] }),
  });
}
