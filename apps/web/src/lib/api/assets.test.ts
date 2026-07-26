import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, api: { get: vi.fn(), upload: vi.fn(), delete: vi.fn() } };
});

import { api } from './client';
import { listAssets, uploadAsset, deleteAsset } from './assets';

describe('lib/api/assets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listAssets fetches without filters', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listAssets('w1');
    expect(api.get).toHaveBeenCalledWith('/api/workspaces/w1/assets');
  });

  it('listAssets includes folderId filter', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listAssets('w1', { folderId: null });
    expect(api.get).toHaveBeenCalledWith('/api/workspaces/w1/assets?folderId=null');
  });

  it('uploadAsset sends a FormData with the file', async () => {
    (api.upload as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'a1' });
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });

    await uploadAsset('w1', file, { folderId: 'f1' });

    expect(api.upload).toHaveBeenCalledTimes(1);
    const [path, formData] = (api.upload as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe('/api/workspaces/w1/assets');
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get('file')).toBe(file);
    expect(formData.get('folderId')).toBe('f1');
  });

  it('deleteAsset deletes by id', async () => {
    (api.delete as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    await deleteAsset('w1', 'a1');
    expect(api.delete).toHaveBeenCalledWith('/api/workspaces/w1/assets/a1');
  });
});
