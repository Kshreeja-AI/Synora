/**
 * Provider-agnostic file storage contracts, mirroring `src/ai/types.ts` and
 * `src/mail/types.ts`. Used today for avatar uploads; any future object
 * storage (media generation results, M6) extends this same interface.
 *
 * Nothing outside `./providers/*` should ever touch the filesystem or an
 * object-storage SDK directly — the rest of the application depends only
 * on `./index.ts`.
 */

export interface StoredFile {
  /** Opaque identifier the provider needs to later delete this file. */
  key: string;
  /** Publicly reachable URL for the stored file. */
  url: string;
}

export interface UploadInput {
  key: string;
  buffer: Buffer;
  contentType: string;
}

export interface StorageProvider {
  readonly id: string;
  upload(input: UploadInput): Promise<StoredFile>;
  /** Idempotent: deleting an already-missing key is not an error. */
  delete(key: string): Promise<void>;
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'StorageError';
  }
}
