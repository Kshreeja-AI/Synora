/**
 * Extension point for a real Hardware Security Module (AWS CloudHSM, GCP
 * Cloud KMS with HSM protection, Azure Key Vault Managed HSM, Thales
 * Luna, etc.). Nothing implements this today — StubHsmProvider is the only
 * implementation and it throws on every call. It exists so that when an
 * HSM is actually procured, the integration is "implement this interface
 * and register it", not "redesign the secrets subsystem".
 *
 * An HSM never returns raw key material — it performs operations
 * on-device and returns results, which is why this interface has no
 * "getSecret"-style method.
 */
export interface IHsmProvider {
  readonly available: boolean;

  encrypt(plaintext: Buffer, keyId: string): Promise<Buffer>;
  decrypt(ciphertext: Buffer, keyId: string): Promise<Buffer>;
  sign(payload: Buffer, keyId: string): Promise<Buffer>;
  getPublicKey(keyId: string): Promise<Buffer>;
}

export class HsmNotConfiguredError extends Error {
  constructor(operation: string) {
    super(
      `HSM operation "${operation}" was called but no HSM provider is configured. ` +
        'See docs/security/SECRET_MANAGEMENT.md#future-hsm-integration for how to wire one in.'
    );
    this.name = 'HsmNotConfiguredError';
  }
}
