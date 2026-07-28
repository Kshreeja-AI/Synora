import { randomUUID } from 'node:crypto';
import { getConfig } from '../config';
import { resolveStorageProvider } from './resolver';
import type { StoredFile } from './types';

export type { StorageProvider, StoredFile, UploadInput } from './types';
export { StorageError } from './types';
export { STORAGE_REGISTRY, getStorageDescriptor } from './registry';
export type { StorageProviderDescriptor } from './registry';
export { resolveStorageProvider } from './resolver';

const AVATAR_CONTENT_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export function isAllowedAvatarContentType(contentType: string): boolean {
  return contentType in AVATAR_CONTENT_TYPES;
}

/**
 * Uploads an avatar image for a user and returns its public URL. The key
 * embeds a fresh random id on every upload (never reused), so a client
 * that already cached the previous avatar's URL never sees a stale
 * cross-user image and no cache-busting query string is needed.
 */
export async function uploadAvatar(params: {
  userId: string;
  buffer: Buffer;
  contentType: string;
}): Promise<StoredFile> {
  const extension = AVATAR_CONTENT_TYPES[params.contentType];
  if (!extension) {
    throw new Error(`Unsupported avatar content type: ${params.contentType}`);
  }

  const provider = await resolveStorageProvider();
  const key = `avatars/${params.userId}/${randomUUID()}.${extension}`;
  return provider.upload({ key, buffer: params.buffer, contentType: params.contentType });
}

/**
 * Extracts the storage key from a URL previously returned by
 * `uploadAvatar`, so a subsequent replace/remove can delete the old file.
 * Returns null for anything not hosted by this app's own storage (e.g. a
 * future OAuth-provided avatar URL) — we only ever delete what we own.
 */
export function avatarKeyFromUrl(url: string): string | null {
  const { urls, storage } = getConfig();
  const prefix = `${urls.backendUrl}${storage.publicBasePath}/`;
  if (!url.startsWith(prefix)) return null;
  return url.slice(prefix.length);
}

export async function deleteAvatar(key: string): Promise<void> {
  const provider = await resolveStorageProvider();
  await provider.delete(key);
}

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim().replace(/[^a-zA-Z0-9._-]/g, '-');
  return trimmed.length > 0 ? trimmed.slice(-100) : 'file';
}

/**
 * Uploads a workspace asset (a member-provided file, as opposed to an
 * AI-generated result) and returns its public URL + storage key. Unlike
 * `uploadAvatar`, this accepts any content type — assets are generic
 * documents/images/etc., not a fixed set of avatar formats.
 */
export async function uploadWorkspaceAsset(params: {
  workspaceId: string;
  filename: string;
  buffer: Buffer;
  contentType: string;
}): Promise<StoredFile> {
  const provider = await resolveStorageProvider();
  const key = `assets/${params.workspaceId}/${randomUUID()}-${sanitizeFilename(params.filename)}`;
  return provider.upload({ key, buffer: params.buffer, contentType: params.contentType });
}

export async function deleteWorkspaceAsset(key: string): Promise<void> {
  const provider = await resolveStorageProvider();
  await provider.delete(key);
}
