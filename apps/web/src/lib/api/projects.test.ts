import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

import { api } from './client';
import { listProjects, createProject, getProject, updateProject, deleteProject } from './projects';

describe('lib/api/projects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listProjects fetches without a query when no workspace given', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listProjects();
    expect(api.get).toHaveBeenCalledWith('/api/projects');
  });

  it('listProjects includes workspaceId as a query param', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listProjects('w1');
    expect(api.get).toHaveBeenCalledWith('/api/projects?workspaceId=w1');
  });

  it('createProject posts the input', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'p1' });
    await createProject({ name: 'Project', workspaceId: 'w1' });
    expect(api.post).toHaveBeenCalledWith('/api/projects', { name: 'Project', workspaceId: 'w1' });
  });

  it('getProject fetches by id', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'p1' });
    await getProject('p1');
    expect(api.get).toHaveBeenCalledWith('/api/projects/p1');
  });

  it('updateProject patches by id', async () => {
    (api.patch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'p1' });
    await updateProject('p1', { name: 'New' });
    expect(api.patch).toHaveBeenCalledWith('/api/projects/p1', { name: 'New' });
  });

  it('deleteProject deletes by id', async () => {
    (api.delete as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    await deleteProject('p1');
    expect(api.delete).toHaveBeenCalledWith('/api/projects/p1');
  });
});
