import type { StorageProvider } from '../types';

export interface StorageProviderDescriptor {
  readonly id: string;
  readonly displayName: string;
  isConfigured(): Promise<boolean>;
  create(): Promise<StorageProvider>;
}
