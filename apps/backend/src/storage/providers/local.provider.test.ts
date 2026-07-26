import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getConfig } from '../../config';

vi.mock('../../config', () => ({ getConfig: vi.fn() }));

import { LocalStorageProvider } from './local.provider';
import { StorageError } from '../types';

describe('LocalStorageProvider', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'synora-storage-test-'));
    (getConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      storage: { localDirectory: dir, publicBasePath: '/uploads' },
      urls: { backendUrl: 'http://localhost:3001' },
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the file and returns a public URL built from config', async () => {
    const provider = new LocalStorageProvider();
    const buffer = Buffer.from('fake-image-bytes');

    const result = await provider.upload({
      key: 'avatars/user-1/abc.png',
      buffer,
      contentType: 'image/png',
    });

    expect(result.key).toBe('avatars/user-1/abc.png');
    expect(result.url).toBe('http://localhost:3001/uploads/avatars/user-1/abc.png');

    const written = await readFile(join(dir, 'avatars/user-1/abc.png'));
    expect(written.equals(buffer)).toBe(true);
  });

  it('creates nested directories that do not yet exist', async () => {
    const provider = new LocalStorageProvider();
    await expect(
      provider.upload({ key: 'avatars/new-user/nested/file.png', buffer: Buffer.from('x'), contentType: 'image/png' })
    ).resolves.toBeDefined();
  });

  it('deletes an existing file', async () => {
    const provider = new LocalStorageProvider();
    await provider.upload({ key: 'avatars/user-2/pic.png', buffer: Buffer.from('x'), contentType: 'image/png' });

    await expect(provider.delete('avatars/user-2/pic.png')).resolves.toBeUndefined();
    await expect(readFile(join(dir, 'avatars/user-2/pic.png'))).rejects.toThrow();
  });

  it('deleting a missing file is a no-op, not an error', async () => {
    const provider = new LocalStorageProvider();
    await expect(provider.delete('avatars/never-existed/pic.png')).resolves.toBeUndefined();
  });

  it('wraps a write failure in StorageError', async () => {
    (getConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      // A path under a file (not a directory) forces mkdir to fail.
      storage: { localDirectory: join(dir, 'not-a-directory'), publicBasePath: '/uploads' },
      urls: { backendUrl: 'http://localhost:3001' },
    });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'not-a-directory'), 'i am a file, not a directory');

    const provider = new LocalStorageProvider();
    await expect(
      provider.upload({ key: 'x/y.png', buffer: Buffer.from('x'), contentType: 'image/png' })
    ).rejects.toThrow(StorageError);
  });
});
