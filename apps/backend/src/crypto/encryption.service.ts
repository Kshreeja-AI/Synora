import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { logger } from '../utils/logger'

export interface EncryptedSecret {
  encryptedValue: string
  iv: string
  authTag: string
  algorithm: string
}

export interface DecryptedSecret {
  value: string
}

/**
 * Encryption Service
 * Handles AES-256-GCM encryption/decryption for tool secrets
 */
export class EncryptionService {
  private readonly ALGORITHM = 'aes-256-gcm'
  private readonly KEY_LENGTH = 32 // 256 bits
  private readonly IV_LENGTH = 16 // 128 bits for GCM
  private readonly ENCODING = 'base64'
  private readonly SALT = Buffer.from('SYNORA_TOOL_SECRETS_SALT_v1', 'utf8')

  // Derived lazily on first encrypt/decrypt, not in the constructor. The
  // module-level singleton below is imported transitively by most of the
  // app, so deriving eagerly made a missing TOOL_SECRET_MASTER_KEY crash
  // the process at import time — before config loaded and before any code
  // that actually handles secrets ran.
  private encryptionKey: Buffer | null = null

  // Boot-time value handed over from the SecretsManager source chain (see
  // prime()). Wins over the raw env read so that a key mounted as a
  // docker/kubernetes secret file — which validateRequired() sees but
  // process.env does not — cannot pass boot validation and then miss at
  // runtime.
  private primedMasterKey: string | null = null

  /**
   * Hand this service the master key the SecretsManager chain resolved at
   * boot. Pass only REAL values (tryGetReal) — priming with a generated
   * placeholder would encrypt real user secrets under a key that vanishes
   * the moment a real one is configured. Undefined is a no-op: the raw
   * env read below stays as the fallback, which is what development uses.
   */
  prime(masterKey: string | undefined): void {
    if (masterKey) {
      this.primedMasterKey = masterKey
      this.encryptionKey = null
    }
  }

  /**
   * Master key: boot-primed value first, raw env var as fallback.
   * In production this should come from HashiCorp Vault, AWS KMS, or similar;
   * the SecretsManager chain (primed at boot) / env var is the current source.
   */
  private getMasterKey(): string {
    const key = this.primedMasterKey ?? process.env.TOOL_SECRET_MASTER_KEY
    if (!key) {
      throw new Error('TOOL_SECRET_MASTER_KEY environment variable is required for secret encryption')
    }
    return key
  }

  private getKey(): Buffer {
    if (!this.encryptionKey) {
      this.encryptionKey = this.deriveKey(this.getMasterKey())
    }
    return this.encryptionKey
  }

  /** Whether a master key is present, without throwing. For health checks. */
  isConfigured(): boolean {
    return Boolean(this.primedMasterKey ?? process.env.TOOL_SECRET_MASTER_KEY)
  }

  /**
   * Derive a key from master key using scrypt
   * This provides additional security through key derivation
   */
  private deriveKey(masterKey: string): Buffer {
    try {
      return scryptSync(masterKey, this.SALT, this.KEY_LENGTH)
    } catch (error) {
      logger.error('[EncryptionService] Failed to derive key', { error })
      throw new Error('Failed to derive encryption key')
    }
  }

  /**
   * Encrypt a secret value
   * Returns encrypted value, IV, and auth tag (all base64-encoded)
   */
  encrypt(plaintext: string): EncryptedSecret {
    try {
      const iv = randomBytes(this.IV_LENGTH)
      const cipher = createCipheriv(this.ALGORITHM, this.getKey(), iv)

      const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ])

      const authTag = cipher.getAuthTag()

      return {
        encryptedValue: encrypted.toString(this.ENCODING),
        iv: iv.toString(this.ENCODING),
        authTag: authTag.toString(this.ENCODING),
        algorithm: this.ALGORITHM,
      }
    } catch (error) {
      logger.error('[EncryptionService] Encryption failed', { error })
      throw new Error('Failed to encrypt secret')
    }
  }

  /**
   * Decrypt a secret value
   */
  decrypt(encrypted: EncryptedSecret): DecryptedSecret {
    try {
      const iv = Buffer.from(encrypted.iv, this.ENCODING)
      const encryptedBuffer = Buffer.from(encrypted.encryptedValue, this.ENCODING)
      const authTag = Buffer.from(encrypted.authTag, this.ENCODING)

      const decipher = createDecipheriv(this.ALGORITHM, this.getKey(), iv)
      decipher.setAuthTag(authTag)

      const decrypted = Buffer.concat([
        decipher.update(encryptedBuffer),
        decipher.final(),
      ])

      return {
        value: decrypted.toString('utf8'),
      }
    } catch (error) {
      logger.error('[EncryptionService] Decryption failed', { error })
      throw new Error('Failed to decrypt secret (authentication failed or corrupted data)')
    }
  }

  /**
   * Verify that the encryption service is working
   * Used for health checks and diagnostics
   */
  healthCheck(): boolean {
    if (!this.isConfigured()) return false
    try {
      const testSecret = 'health_check_test_value_' + Date.now()
      const encrypted = this.encrypt(testSecret)
      const decrypted = this.decrypt(encrypted)
      return decrypted.value === testSecret
    } catch (error) {
      logger.error('[EncryptionService] Health check failed', { error })
      return false
    }
  }
}

export const encryptionService = new EncryptionService()
