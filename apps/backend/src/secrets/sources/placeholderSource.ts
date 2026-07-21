import { createHash } from 'crypto';
import { ISecretSource } from '../interfaces/secretSource';
import { SecretSourceKind } from '../types';
import { logger } from '../../utils/logger';

/**
 * Last-resort source: manufactures a deterministic, obviously-fake value
 * for a key so the app runs end-to-end with zero real secrets configured.
 * "Deterministic" matters — the same key always yields the same
 * placeholder within a process, so things like JWT sign/verify still work
 * against each other during local development.
 *
 * This source must never be reachable in staging/production — SecretsManager
 * only wires it into the local/development source chains. It also logs a
 * loud, one-time-per-key warning so nobody mistakes a placeholder for a
 * real secret while debugging.
 */
export class PlaceholderSecretSource implements ISecretSource {
  readonly kind: SecretSourceKind = 'placeholder';
  private readonly warned = new Set<string>();

  isAvailable(): boolean {
    return true;
  }

  async read(key: string): Promise<string | undefined> {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      logger.warn(
        `[secrets] "${key}" has no real value configured — using a generated placeholder. ` +
          'This is expected in local development and must never happen in staging/production.',
        { key }
      );
    }
    return PlaceholderSecretSource.generate(key);
  }

  static generate(key: string): string {
    return `placeholder_${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
  }
}
