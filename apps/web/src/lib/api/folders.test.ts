import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

import { api } from './client';
import { listFolders, createFolder, renameFolder, deleteFolder } from './folders';

describe('lib/api/folders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listFolders fetches without filters', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listFolders('w1');
    expect(api.get).toHaveBeenCalledWith('/api/workspaces/w1/folders');
  });

  it('listFolders includes projectId and parentId filters', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listFolders('w1', { projectId: 'p1', parentId: null });
    expect(api.get).toHaveBeenCalledWith('/api/workspaces/w1/folders?projectId=p1&parentId=null');
  });

  it('createFolder posts the input', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'f1' });
    await createFolder('w1', { name: 'Marketing' });
    expect(api.post).toHaveBeenCalledWith('/api/workspaces/w1/folders', { name: 'Marketing' });
  });

  it('renameFolder patches the name', async () => {
    (api.patch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'f1' });
    await renameFolder('w1', 'f1', 'Growth');
    expect(api.patch).toHaveBeenCalledWith('/api/workspaces/w1/folders/f1', { name: 'Growth' });
  });

  it('deleteFolder deletes by id', async () => {
    (api.delete as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    await deleteFolder('w1', 'f1');
    expect(api.delete).toHaveBeenCalledWith('/api/workspaces/w1/folders/f1');
  });
});
