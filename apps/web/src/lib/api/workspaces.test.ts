import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

import { api } from './client';
import { listWorkspaces, createWorkspace, getWorkspace, updateWorkspace, listWorkspaceMembers } from './workspaces';

describe('lib/api/workspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listWorkspaces fetches /api/workspaces', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listWorkspaces();
    expect(api.get).toHaveBeenCalledWith('/api/workspaces');
  });

  it('createWorkspace posts the name and description', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'w1' });
    await createWorkspace({ name: 'Acme', description: 'A company' });
    expect(api.post).toHaveBeenCalledWith('/api/workspaces', { name: 'Acme', description: 'A company' });
  });

  it('getWorkspace fetches /api/workspaces/:id', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'w1' });
    await getWorkspace('w1');
    expect(api.get).toHaveBeenCalledWith('/api/workspaces/w1');
  });

  it('updateWorkspace patches /api/workspaces/:id', async () => {
    (api.patch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'w1' });
    await updateWorkspace('w1', { name: 'New Name' });
    expect(api.patch).toHaveBeenCalledWith('/api/workspaces/w1', { name: 'New Name' });
  });

  it('listWorkspaceMembers fetches /api/workspaces/:id/members', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listWorkspaceMembers('w1');
    expect(api.get).toHaveBeenCalledWith('/api/workspaces/w1/members');
  });
});
