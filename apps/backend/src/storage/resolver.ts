import { getConfig } from '../config';
import { STORAGE_REGISTRY, getStorageDescriptor } from './registry';
import type { StorageProvider } from './types';

/**
 * Selects and constructs the active storage provider. `storage.provider`
 * (env: `STORAGE_PROVIDER`) is the single explicit switch, mirroring
 * `ai.provider` and `mail.transport` — never auto-detected.
 */
export async function resolveStorageProvider(): Promise<StorageProvider> {
  const providerId = getConfig().storage.provider;
  const descriptor = getStorageDescriptor(providerId);

  if (!descriptor) {
    throw new Error(
      `STORAGE_PROVIDER is set to a value that is not a known provider. ` +
        // Value withheld: a mistyped selection variable has been observed to
        // contain an API key, and this error is logged.

        `Known providers: ${STORAGE_REGISTRY.map((p) => p.id).join(', ')}.`
    );
  }

  if (!(await descriptor.isConfigured())) {
    throw new Error(`Storage provider "${providerId}" is not configured.`);
  }

  return descriptor.create();
}
