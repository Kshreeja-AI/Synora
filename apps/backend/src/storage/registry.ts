import type { StorageProvider } from './types';

export interface StorageProviderDescriptor {
  readonly id: string;
  readonly displayName: string;
  isConfigured(): Promise<boolean>;
  create(): Promise<StorageProvider>;
}

import { localStorageDescriptor } from './providers/local.provider';

/**
 * Every storage provider this application knows how to talk to. Adding an
 * S3-compatible provider later (M6) means adding one descriptor here and
 * one file under `./providers/` — no call site changes, matching the AI
 * provider and mail transport abstractions.
 */
export const STORAGE_REGISTRY: readonly StorageProviderDescriptor[] = [localStorageDescriptor];

export function getStorageDescriptor(id: string): StorageProviderDescriptor | undefined {
  return STORAGE_REGISTRY.find((p) => p.id === id);
}
