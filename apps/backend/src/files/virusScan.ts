import { VirusScanProvider } from './types';
import { logger } from '../utils/logger';

// Stub virus scan provider - for production, use ClamAV or similar
export class StubVirusScanProvider implements VirusScanProvider {
  async scan(_buffer: Buffer, fileName: string): Promise<{ clean: boolean; error?: string }> {
    try {
      // Stub implementation - always returns clean
      // Production should integrate with ClamAV or cloud AV service
      logger.debug('[VirusScan] Stub scan (not configured)', { fileName });
      return { clean: true };
    } catch (error: any) {
      logger.error('[VirusScan] Scan failed', { fileName, error: error.message });
      return { clean: false, error: error.message };
    }
  }
}

// Mock virus scan provider for testing
export class MockVirusScanProvider implements VirusScanProvider {
  private alwaysClean: boolean;

  constructor(alwaysClean: boolean = true) {
    this.alwaysClean = alwaysClean;
  }

  async scan(buffer: Buffer, fileName: string): Promise<{ clean: boolean; error?: string }> {
    logger.debug('[VirusScan] Mock scan', { fileName, clean: this.alwaysClean });

    // For testing purposes, detect EICAR test string (common AV test)
    if (!this.alwaysClean && buffer.includes(Buffer.from('EICAR'))) {
      return { clean: false, error: 'EICAR test signature detected' };
    }

    return { clean: this.alwaysClean };
  }
}

export const virusScanProvider: VirusScanProvider = new StubVirusScanProvider();
