import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { getConfig } from '../../config';
import { StorageError, type StorageProvider, type StoredFile, type UploadInput } from '../types';
import type { StorageProviderDescriptor } from '../registry';

/**
 * Writes uploaded files to a directory on the local filesystem, served back
 * out via `express.static` at `storage.publicBasePath` (wired in `app.ts`).
 * Correct for Release 2's single-instance deployment target — the same
 * posture as the DB-backed login lockout (see `lockout.service.ts`). A
 * multi-instance deployment needs a shared object store (S3-compatible),
 * tracked as Release 2 M6; adding it is a new descriptor here, not a
 * rewrite of this one or of any call site.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly id = 'local';

  private baseDir(): string {
    return resolve(process.cwd(), getConfig().storage.localDirectory);
  }

  async upload(input: UploadInput): Promise<StoredFile> {
    const absolutePath = join(this.baseDir(), input.key);
    try {
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, input.buffer);
    } catch (error) {
      throw new StorageError(
        `Local storage write failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        error
      );
    }

    const { urls } = getConfig();
    const { publicBasePath } = getConfig().storage;
    return {
      key: input.key,
      url: `${urls.backendUrl}${publicBasePath}/${input.key}`,
    };
  }

  async delete(key: string): Promise<void> {
    const absolutePath = join(this.baseDir(), key);
    try {
      await unlink(absolutePath);
    } catch (error) {
      // Deleting an already-missing file is not an error — idempotent by contract.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new StorageError(
        `Local storage delete failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        error
      );
    }
  }
}

export const localStorageDescriptor: StorageProviderDescriptor = {
  id: 'local',
  displayName: 'Local filesystem',
  async isConfigured() {
    return true;
  },
  async create() {
    return new LocalStorageProvider();
  },
};
