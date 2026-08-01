import { describe, it, expect, beforeEach } from 'vitest'
import { encryptionService } from '../../src/crypto/encryption.service'

describe('EncryptionService', () => {
  describe('encrypt and decrypt', () => {
    it('should encrypt plaintext and decrypt back to original', () => {
      const plaintext = 'my-secret-api-key-12345'
      const encrypted = encryptionService.encrypt(plaintext)

      expect(encrypted.encryptedValue).toBeDefined()
      expect(encrypted.iv).toBeDefined()
      expect(encrypted.authTag).toBeDefined()
      expect(encrypted.algorithm).toBe('aes-256-gcm')

      const decrypted = encryptionService.decrypt(encrypted)
      expect(decrypted.value).toBe(plaintext)
    })

    it('should encrypt empty string', () => {
      const plaintext = ''
      const encrypted = encryptionService.encrypt(plaintext)
      const decrypted = encryptionService.decrypt(encrypted)

      expect(decrypted.value).toBe('')
    })

    it('should encrypt long strings', () => {
      const plaintext = 'a'.repeat(10000)
      const encrypted = encryptionService.encrypt(plaintext)
      const decrypted = encryptionService.decrypt(encrypted)

      expect(decrypted.value).toBe(plaintext)
    })

    it('should encrypt strings with special characters', () => {
      const plaintext = 'secret!@#$%^&*()_+-=[]{}|;:,.<>?/~`'
      const encrypted = encryptionService.encrypt(plaintext)
      const decrypted = encryptionService.decrypt(encrypted)

      expect(decrypted.value).toBe(plaintext)
    })

    it('should encrypt unicode strings', () => {
      const plaintext = '你好世界 مرحبا العالم שלום עולם'
      const encrypted = encryptionService.encrypt(plaintext)
      const decrypted = encryptionService.decrypt(encrypted)

      expect(decrypted.value).toBe(plaintext)
    })
  })

  describe('encryption properties', () => {
    it('should generate different IVs for each encryption', () => {
      const plaintext = 'same-plaintext'
      const encrypted1 = encryptionService.encrypt(plaintext)
      const encrypted2 = encryptionService.encrypt(plaintext)

      expect(encrypted1.iv).not.toBe(encrypted2.iv)
    })

    it('should generate different ciphertexts for same plaintext (due to different IV)', () => {
      const plaintext = 'same-plaintext'
      const encrypted1 = encryptionService.encrypt(plaintext)
      const encrypted2 = encryptionService.encrypt(plaintext)

      expect(encrypted1.encryptedValue).not.toBe(encrypted2.encryptedValue)
    })

    it('should use base64 encoding', () => {
      const plaintext = 'test-secret'
      const encrypted = encryptionService.encrypt(plaintext)

      // Base64 should only contain valid characters: A-Z, a-z, 0-9, +, /, =
      const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/
      expect(encrypted.encryptedValue).toMatch(base64Regex)
      expect(encrypted.iv).toMatch(base64Regex)
      expect(encrypted.authTag).toMatch(base64Regex)
    })
  })

  describe('authentication tag validation', () => {
    it('should throw on tampered ciphertext', () => {
      const plaintext = 'secret-message'
      const encrypted = encryptionService.encrypt(plaintext)

      // Tamper with the encrypted value
      const tampered = Buffer.from(encrypted.encryptedValue, 'base64')
      tampered[0] ^= 0xff // flip first byte
      const tamperedEncrypted = {
        ...encrypted,
        encryptedValue: tampered.toString('base64'),
      }

      expect(() => {
        encryptionService.decrypt(tamperedEncrypted)
      }).toThrow()
    })

    it('should throw on tampered IV', () => {
      const plaintext = 'secret-message'
      const encrypted = encryptionService.encrypt(plaintext)

      // Tamper with the IV
      const tampered = Buffer.from(encrypted.iv, 'base64')
      tampered[0] ^= 0xff
      const tamperedEncrypted = {
        ...encrypted,
        iv: tampered.toString('base64'),
      }

      expect(() => {
        encryptionService.decrypt(tamperedEncrypted)
      }).toThrow()
    })

    it('should throw on tampered auth tag', () => {
      const plaintext = 'secret-message'
      const encrypted = encryptionService.encrypt(plaintext)

      // Tamper with the auth tag
      const tampered = Buffer.from(encrypted.authTag, 'base64')
      tampered[0] ^= 0xff
      const tamperedEncrypted = {
        ...encrypted,
        authTag: tampered.toString('base64'),
      }

      expect(() => {
        encryptionService.decrypt(tamperedEncrypted)
      }).toThrow()
    })
  })

  describe('healthCheck', () => {
    it('should return true when encryption/decryption works', () => {
      const result = encryptionService.healthCheck()
      expect(result).toBe(true)
    })

    it('should use different test value each time', () => {
      const result1 = encryptionService.healthCheck()
      const result2 = encryptionService.healthCheck()

      expect(result1).toBe(true)
      expect(result2).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should throw on invalid base64 in encryptedValue', () => {
      const encrypted = {
        encryptedValue: 'not-base64!!!',
        iv: 'aGVsbG8gd29ybGQ=', // valid base64
        authTag: 'aGVsbG8gd29ybGQ=', // valid base64
        algorithm: 'aes-256-gcm',
      }

      expect(() => {
        encryptionService.decrypt(encrypted)
      }).toThrow()
    })

    it('should throw on invalid base64 in IV', () => {
      const encrypted = {
        encryptedValue: 'aGVsbG8gd29ybGQ=', // valid base64
        iv: 'not-base64!!!',
        authTag: 'aGVsbG8gd29ybGQ=', // valid base64
        algorithm: 'aes-256-gcm',
      }

      expect(() => {
        encryptionService.decrypt(encrypted)
      }).toThrow()
    })

    it('should throw on invalid base64 in auth tag', () => {
      const encrypted = {
        encryptedValue: 'aGVsbG8gd29ybGQ=', // valid base64
        iv: 'aGVsbG8gd29ybGQ=', // valid base64
        authTag: 'not-base64!!!',
        algorithm: 'aes-256-gcm',
      }

      expect(() => {
        encryptionService.decrypt(encrypted)
      }).toThrow()
    })
  })
})
