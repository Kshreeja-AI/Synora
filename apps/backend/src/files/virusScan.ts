import type { ScanOutcome, VirusScanProvider } from './types';
import { logger } from '../utils/logger';

/**
 * Test-only in-memory scanner. It is NOT wired into the provider registry
 * and is never used in production — real scanning goes through the ClamAV
 * provider selected by `resolveVirusScanProvider()`. This exists so tests
 * can exercise the file pipeline's clean/infected/unscanned branches
 * deterministically without a clamd daemon.
 *
 * There is deliberately no "always returns clean" production stub anymore:
 * the previous one marked every upload clean without scanning, which
 * defeated the infected-file download gate entirely.
 */
export class MockVirusScanProvider implements VirusScanProvider {
  readonly id = 'mock';

  async scan(buffer: Buffer, fileName: string): Promise<ScanOutcome> {
    // Detect the EICAR test signature (the standard, harmless AV test file)
    // so tests can drive the infected branch with real-looking input.
    if (buffer.includes(Buffer.from('EICAR'))) {
      logger.debug('[VirusScan] Mock detected EICAR signature', { fileName });
      return { status: 'infected', signature: 'Eicar-Test-Signature' };
    }
    return { status: 'clean' };
  }
}
