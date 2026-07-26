import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, api: { get: vi.fn(), delete: vi.fn() } };
});

import { api } from './client';
import { listSessions, revokeSession } from './sessions';

describe('lib/api/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listSessions fetches /api/auth/sessions', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listSessions();
    expect(api.get).toHaveBeenCalledWith('/api/auth/sessions');
  });

  it('revokeSession deletes the specific session by id', async () => {
    (api.delete as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    await revokeSession('sess-123');
    expect(api.delete).toHaveBeenCalledWith('/api/auth/sessions/sess-123');
  });
});
