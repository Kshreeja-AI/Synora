import type { VirusScanProvider, VirusScanProviderDescriptor } from './types';
import { clamavScanDescriptor } from './providers/clamav.provider';

/**
 * Every virus-scan provider the platform knows how to use. Adding another
 * scanner (a cloud AV API, a different engine) is a new descriptor here and
 * one file under `./providers/` — no call-site change, matching the AI,
 * embeddings, vectordb, mail and storage subsystems. ClamAV is the only
 * real provider today.
 */
export const VIRUS_SCAN_PROVIDER_REGISTRY: readonly VirusScanProviderDescriptor[] = [
  clamavScanDescriptor,
];

/**
 * The first configured scanner, or null when none is configured. Null is a
 * first-class result, not an error: the file pipeline degrades honestly to
 * "unscanned" rather than pretending a file is clean.
 */
export async function resolveVirusScanProvider(): Promise<VirusScanProvider | null> {
  for (const descriptor of VIRUS_SCAN_PROVIDER_REGISTRY) {
    if (await descriptor.isConfigured()) {
      return descriptor.create();
    }
  }
  return null;
}

export async function getConfiguredScannerId(): Promise<string | null> {
  for (const descriptor of VIRUS_SCAN_PROVIDER_REGISTRY) {
    if (await descriptor.isConfigured()) {
      return descriptor.id;
    }
  }
  return null;
}
