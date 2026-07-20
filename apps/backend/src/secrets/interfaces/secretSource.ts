import { SecretSourceKind } from '../types';

/**
 * A place a secret's raw value can come from. Sources know nothing about
 * versioning, rotation, expiration or auditing — SecretsManager owns all
 * of that. A source's only job is "can you read this key right now".
 */
export interface ISecretSource {
  readonly kind: SecretSourceKind;

  /** Cheap, synchronous check for whether this source applies in the current runtime. */
  isAvailable(): boolean;

  /** Returns undefined if the key isn't present in this source (not an error). */
  read(key: string): Promise<string | undefined>;
}
