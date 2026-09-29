import { api } from './client';

/**
 * Memory management API client.
 *
 * The backend memory subsystem (embeddings, ranking, dedup, decay, retrieval)
 * has been complete for some time — this file gives the user a way to see
 * what it stored about them and change or delete it. Every route here is
 * cookie-authenticated and workspace-scoped via `requireWorkspaceAccess()`.
 */

/** Server enum: MemoryType. Kept as a union rather than an enum import so
 *  this file has no Prisma types dependency. */
export type MemoryType =
  | 'SHORT_TERM'
  | 'LONG_TERM'
  | 'SEMANTIC'
  | 'EPISODIC'
  | 'PROCEDURAL'
  | 'PREFERENCE'
  | 'FACT'
  | 'CONTEXT';

export type MemoryStatus = 'ACTIVE' | 'ARCHIVED' | 'CONFLICTED' | 'SUPERSEDED' | 'DELETED';

/**
 * The subset of the backend Memory row the UI actually reads. Kept small on
 * purpose so a schema addition does not require a client rebuild — extra
 * fields on the wire are simply ignored.
 */
export interface Memory {
  id: string;
  workspaceId: string;
  userId: string;
  content: string;
  summary?: string | null;
  type: MemoryType;
  category?: string | null;
  tags: string[];
  importance: number;
  isPinned?: boolean;
  isArchived?: boolean;
  status?: MemoryStatus;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string | null;
  accessCount?: number;
  conversationId?: string | null;
  source?: string | null;
}

export interface MemorySearchResult {
  memories: Memory[];
  total: number;
}

/**
 * Matches the shape memoryService.getStats() returns via
 * GET /api/workspaces/:workspaceId/memories/stats — verified live, not
 * inferred from the model. `pinnedMemories` is not surfaced by the current
 * backend and is deliberately omitted so the UI doesn't render a zero it
 * has no data for.
 */
export interface MemoryStats {
  totalMemories: number;
  activeMemories: number;
  archivedMemories: number;
  averageImportance: number;
  typeDistribution: Record<string, number>;
}

export interface ListMemoriesParams {
  search?: string;
  type?: MemoryType;
  status?: MemoryStatus;
  tags?: string[];
  pinnedOnly?: boolean;
  archivedOnly?: boolean;
  limit?: number;
  offset?: number;
}

function qs(params: ListMemoriesParams): string {
  const p = new URLSearchParams();
  if (params.search) p.set('search', params.search);
  if (params.type) p.set('type', params.type);
  if (params.status) p.set('status', params.status);
  if (params.pinnedOnly) p.set('pinnedOnly', 'true');
  if (params.archivedOnly) p.set('archivedOnly', 'true');
  if (params.limit) p.set('limit', String(params.limit));
  if (params.offset) p.set('offset', String(params.offset));
  for (const t of params.tags ?? []) p.append('tags', t);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function listMemories(
  workspaceId: string,
  params: ListMemoriesParams = {}
): Promise<MemorySearchResult> {
  return api.get<MemorySearchResult>(
    `/api/workspaces/${workspaceId}/memories${qs(params)}`
  );
}

export function getMemoryStats(workspaceId: string): Promise<MemoryStats> {
  return api.get<MemoryStats>(`/api/workspaces/${workspaceId}/memories/stats`);
}

export function updateMemory(
  workspaceId: string,
  memoryId: string,
  patch: Partial<Pick<Memory, 'content' | 'category' | 'importance' | 'tags'>>
): Promise<Memory> {
  return api.patch<Memory>(
    `/api/workspaces/${workspaceId}/memories/${memoryId}`,
    patch
  );
}

export function pinMemory(workspaceId: string, memoryId: string): Promise<Memory> {
  return api.post<Memory>(
    `/api/workspaces/${workspaceId}/memories/${memoryId}/pin`,
    {}
  );
}

export function unpinMemory(workspaceId: string, memoryId: string): Promise<Memory> {
  return api.post<Memory>(
    `/api/workspaces/${workspaceId}/memories/${memoryId}/unpin`,
    {}
  );
}

export function deleteMemory(
  workspaceId: string,
  memoryId: string
): Promise<{ success: true }> {
  return api.delete<{ success: true }>(
    `/api/workspaces/${workspaceId}/memories/${memoryId}`
  );
}

export function createMemory(
  workspaceId: string,
  input: {
    content: string;
    type: MemoryType;
    category?: string;
    tags?: string[];
    importance?: number;
  }
): Promise<Memory> {
  return api.post<Memory>(`/api/workspaces/${workspaceId}/memories`, input);
}
