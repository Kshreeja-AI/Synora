import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

import { api } from './client';
import {
  createMemory,
  deleteMemory,
  getMemoryStats,
  listMemories,
  pinMemory,
  unpinMemory,
  updateMemory,
} from './memories';

const WS = 'ws-1';

describe('lib/api/memories', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listMemories hits GET /api/workspaces/:ws/memories with no query when no params given', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ memories: [], total: 0 });
    await listMemories(WS);
    expect(api.get).toHaveBeenCalledWith(`/api/workspaces/${WS}/memories`);
  });

  it('listMemories serializes filters and multi-value tags into the URL query', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ memories: [], total: 0 });
    await listMemories(WS, {
      search: 'launch',
      type: 'SEMANTIC',
      pinnedOnly: true,
      tags: ['work', 'q3'],
      limit: 50,
    });
    const call = (api.get as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(call.startsWith(`/api/workspaces/${WS}/memories?`)).toBe(true);
    // URL param order isn't guaranteed — assert semantic content instead of a literal string.
    expect(call).toContain('search=launch');
    expect(call).toContain('type=SEMANTIC');
    expect(call).toContain('pinnedOnly=true');
    expect(call).toContain('limit=50');
    // Multi-value tags stay as repeated query keys, matching what the route reads
    // via `Array.isArray(tags)` in routes/memories.ts.
    expect(call.match(/tags=/g)?.length).toBe(2);
    expect(call).toContain('tags=work');
    expect(call).toContain('tags=q3');
  });

  it('getMemoryStats hits GET /api/workspaces/:ws/memories/stats', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    await getMemoryStats(WS);
    expect(api.get).toHaveBeenCalledWith(`/api/workspaces/${WS}/memories/stats`);
  });

  it('pinMemory / unpinMemory / deleteMemory / createMemory hit their respective routes', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.delete as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    (api.patch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await pinMemory(WS, 'm1');
    expect(api.post).toHaveBeenCalledWith(`/api/workspaces/${WS}/memories/m1/pin`, {});

    await unpinMemory(WS, 'm1');
    expect(api.post).toHaveBeenCalledWith(`/api/workspaces/${WS}/memories/m1/unpin`, {});

    await deleteMemory(WS, 'm1');
    expect(api.delete).toHaveBeenCalledWith(`/api/workspaces/${WS}/memories/m1`);

    await updateMemory(WS, 'm1', { content: 'x' });
    expect(api.patch).toHaveBeenCalledWith(`/api/workspaces/${WS}/memories/m1`, { content: 'x' });

    await createMemory(WS, { content: 'hi', type: 'SEMANTIC' });
    expect(api.post).toHaveBeenCalledWith(`/api/workspaces/${WS}/memories`, {
      content: 'hi',
      type: 'SEMANTIC',
    });
  });
});
