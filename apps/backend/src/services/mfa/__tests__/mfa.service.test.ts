import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MFAService } from '../mfa.service';
import { TOTPService } from '../totp.service';
import { RecoveryCodeService } from '../recovery-code.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('MFAService', () => {
  const userId = 'test-user-mfa-123';

  // Cleanup helper
  async function cleanupUser() {
    try {
      const mfaMethods = await prisma.mFAMethod.findMany({ where: { userId } });
      for (const method of mfaMethods) {
        await prisma.mFAAttempt.deleteMany({ where: { mfaMethodId: method.id } });
        await prisma.mFARecoveryCode.deleteMany({ where: { mfaMethodId: method.id } });
      }
      await prisma.mFAMethod.deleteMany({ where: { userId } });
      await prisma.mFAChallengeToken.deleteMany({ where: { userId } });
      await prisma.mFASetupToken.deleteMany({ where: { userId } });
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  beforeEach(async () => {
    await cleanupUser();
  });

  afterEach(async () => {
    await cleanupUser();
  });

  describe('isEnabled', () => {
    it('should return false for user without MFA', async () => {
      const enabled = await MFAService.isEnabled(userId);

      expect(enabled).toBe(false);
    });

    it('should return true for user with ACTIVE MFA', async () => {
      // Create active MFA method
      await prisma.mFAMethod.create({
        data: {
          userId,
          type: 'TOTP',
          status: 'ACTIVE',
          secret: TOTPService.generateSecret(),
          backupCodesHash: ['hash1', 'hash2'],
          enabledAt: new Date(),
        },
      });

      const enabled = await MFAService.isEnabled(userId);

      expect(enabled).toBe(true);
    });

    it('should return true for user in RECOVERY_MODE', async () => {
      await prisma.mFAMethod.create({
        data: {
          userId,
          type: 'TOTP',
          status: 'RECOVERY_MODE',
          secret: TOTPService.generateSecret(),
          backupCodesHash: ['hash1'],
          enabledAt: new Date(),
        },
      });

      const enabled = await MFAService.isEnabled(userId);

      expect(enabled).toBe(true);
    });

    it('should return false for DISABLED MFA', async () => {
      await prisma.mFAMethod.create({
        data: {
          userId,
          type: 'TOTP',
          status: 'DISABLED',
          secret: TOTPService.generateSecret(),
          backupCodesHash: [],
        },
      });

      const enabled = await MFAService.isEnabled(userId);

      expect(enabled).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return disabled status for user without MFA', async () => {
      const status = await MFAService.getStatus(userId);

      expect(status.enabled).toBe(false);
      expect(status.type).toBeNull();
      expect(status.status).toBeNull();
    });

    it('should return active status with recovery code counts', async () => {
      const pairs = RecoveryCodeService.generateCodeHashPairs(10);
      const mfaMethod = await prisma.mFAMethod.create({
        data: {
          userId,
          type: 'TOTP',
          status: 'ACTIVE',
          secret: TOTPService.generateSecret(),
          backupCodesHash: pairs.map((p) => p.hash),
          enabledAt: new Date(),
        },
      });

      // Create recovery code records
      for (const pair of pairs) {
        await prisma.mFARecoveryCode.create({
          data: {
            mfaMethodId: mfaMethod.id,
            codeHash: pair.hash,
          },
        });
      }

      const status = await MFAService.getStatus(userId);

      expect(status.enabled).toBe(true);
      expect(status.type).toBe('TOTP');
      expect(status.status).toBe('ACTIVE');
      expect(status.recoveryCodesTotal).toBe(10);
      expect(status.recoveryCodesRemaining).toBe(10);
    });

    it('should count used recovery codes', async () => {
      const pairs = RecoveryCodeService.generateCodeHashPairs(10);
      const mfaMethod = await prisma.mFAMethod.create({
        data: {
          userId,
          type: 'TOTP',
          status: 'ACTIVE',
          secret: TOTPService.generateSecret(),
          backupCodesHash: pairs.map((p) => p.hash),
          enabledAt: new Date(),
        },
      });

      // Create recovery code records
      const codes = [];
      for (let i = 0; i < pairs.length; i++) {
        const code = await prisma.mFARecoveryCode.create({
          data: {
            mfaMethodId: mfaMethod.id,
            codeHash: pairs[i].hash,
          },
        });
        codes.push(code);
      }

      // Mark 3 as used
      for (let i = 0; i < 3; i++) {
        await prisma.mFARecoveryCode.update({
          where: { id: codes[i].id },
          data: { usedAt: new Date() },
        });
      }

      const status = await MFAService.getStatus(userId);

      expect(status.recoveryCodesRemaining).toBe(7);
      expect(status.recoveryCodesTotal).toBe(10);
    });
  });

  describe('startSetup', () => {
    it('should create setup token and return QR code', async () => {
      const result = await MFAService.startSetup(userId);

      expect(result).toHaveProperty('setupToken');
      expect(result).toHaveProperty('secret');
      expect(result).toHaveProperty('qrCode');
      expect(result).toHaveProperty('expiresAt');

      expect(result.secret).toHaveLength(32);
      expect(result.qrCode).toContain('otpauth://totp/');
    });

    it('should prevent setup if already enabled', async () => {
      await prisma.mFAMethod.create({
        data: {
          userId,
          type: 'TOTP',
          status: 'ACTIVE',
          secret: TOTPService.generateSecret(),
          backupCodesHash: ['hash1'],
          enabledAt: new Date(),
        },
      });

      const result = MFAService.startSetup(userId);

      await expect(result).rejects.toThrow('MFA is already enabled');
    });

    it('should allow setup if previously disabled', async () => {
      await prisma.mFAMethod.create({
        data: {
          userId,
          type: 'TOTP',
          status: 'DISABLED',
          secret: TOTPService.generateSecret(),
          backupCodesHash: [],
        },
      });

      const result = await MFAService.startSetup(userId);

      expect(result).toHaveProperty('setupToken');
      expect(result).toHaveProperty('secret');
    });
  });

  describe('verifySetupCode', () => {
    it('should verify code and return recovery codes', async () => {
      const { setupToken, secret } = await MFAService.startSetup(userId);
      const code = TOTPService.getCurrentCode(secret);

      const result = await MFAService.verifySetupCode(userId, setupToken, code);

      expect(result).toHaveProperty('recoveryCodes');
      expect(result).toHaveProperty('codeHashes');
      expect(result.recoveryCodes).toHaveLength(10);
      expect(result.codeHashes).toHaveLength(10);
      expect(result.setupToken).toBe(setupToken);

      // Verify recovery codes format
      result.recoveryCodes.forEach((code) => {
        expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      });
    });

    it('should reject invalid code', async () => {
      const { setupToken } = await MFAService.startSetup(userId);

      const result = MFAService.verifySetupCode(userId, setupToken, '000000');

      await expect(result).rejects.toThrow('Invalid verification code');
    });
  });

  describe('confirmSetup', () => {
    it('should complete MFA setup', async () => {
      const { setupToken, secret } = await MFAService.startSetup(userId);
      const code = TOTPService.getCurrentCode(secret);

      const verifyResult = await MFAService.verifySetupCode(userId, setupToken, code);
      const confirmResult = await MFAService.confirmSetup(
        userId,
        setupToken,
        verifyResult.recoveryCodes
      );

      expect(confirmResult.success).toBe(true);

      // Verify MFA method created
      const mfaMethod = await prisma.mFAMethod.findUnique({
        where: {
          userId_type: { userId, type: 'TOTP' },
        },
      });

      expect(mfaMethod).toBeDefined();
      expect(mfaMethod?.status).toBe('ACTIVE');
      expect(mfaMethod?.secret).toBe(secret);
    });

    it('should create recovery code records', async () => {
      const { setupToken, secret } = await MFAService.startSetup(userId);
      const code = TOTPService.getCurrentCode(secret);

      const verifyResult = await MFAService.verifySetupCode(userId, setupToken, code);
      await MFAService.confirmSetup(userId, setupToken, verifyResult.recoveryCodes);

      const mfaMethod = await prisma.mFAMethod.findUnique({
        where: {
          userId_type: { userId, type: 'TOTP' },
        },
      });

      const recoveryCodes = await prisma.mFARecoveryCode.findMany({
        where: { mfaMethodId: mfaMethod?.id },
      });

      expect(recoveryCodes).toHaveLength(10);
    });

    it('should reject invalid setup token', async () => {
      const result = MFAService.confirmSetup(userId, 'invalid-token', ['AAAA-1111']);

      await expect(result).rejects.toThrow('Setup token invalid or expired');
    });
  });

  describe('generateChallenge', () => {
    it('should generate challenge token', async () => {
      const sessionId = 'session-123';
      const ipAddress = '127.0.0.1';
      const userAgent = 'Mozilla/5.0';

      const result = await MFAService.generateChallenge(userId, sessionId, ipAddress, userAgent);

      expect(result).toHaveProperty('mfaChallengeToken');
      expect(result).toHaveProperty('expiresAt');
      expect(result.mfaChallengeToken).toHaveLength(64);
    });
  });

  describe('verifyChallengeCode', () => {
    it('should verify valid TOTP code', async () => {
      // Setup MFA first
      const { setupToken, secret } = await MFAService.startSetup(userId);
      const setupCode = TOTPService.getCurrentCode(secret);
      const verifyResult = await MFAService.verifySetupCode(userId, setupToken, setupCode);
      await MFAService.confirmSetup(userId, setupToken, verifyResult.recoveryCodes);

      // Generate challenge
      const { mfaChallengeToken } = await MFAService.generateChallenge(
        userId,
        'session-123',
        '127.0.0.1',
        'Mozilla'
      );

      // Verify challenge code
      const challengeCode = TOTPService.getCurrentCode(secret);
      const result = await MFAService.verifyChallengeCode(userId, mfaChallengeToken, challengeCode);

      expect(result.success).toBe(true);
    });

    it('should reject invalid TOTP code', async () => {
      // Setup MFA first
      const { setupToken, secret } = await MFAService.startSetup(userId);
      const setupCode = TOTPService.getCurrentCode(secret);
      const verifyResult = await MFAService.verifySetupCode(userId, setupToken, setupCode);
      await MFAService.confirmSetup(userId, setupToken, verifyResult.recoveryCodes);

      // Generate challenge
      const { mfaChallengeToken } = await MFAService.generateChallenge(
        userId,
        'session-123',
        '127.0.0.1',
        'Mozilla'
      );

      // Verify with wrong code
      const result = MFAService.verifyChallengeCode(userId, mfaChallengeToken, '000000');

      await expect(result).rejects.toThrow('Invalid MFA code');
    });

    it('should enforce lockout after max failed attempts', async () => {
      // Setup MFA
      const { setupToken, secret } = await MFAService.startSetup(userId);
      const setupCode = TOTPService.getCurrentCode(secret);
      const verifyResult = await MFAService.verifySetupCode(userId, setupToken, setupCode);
      await MFAService.confirmSetup(userId, setupToken, verifyResult.recoveryCodes);

      // Generate challenge
      const { mfaChallengeToken } = await MFAService.generateChallenge(
        userId,
        'session-123',
        '127.0.0.1',
        'Mozilla'
      );

      // Try 5 wrong attempts
      for (let i = 0; i < 5; i++) {
        try {
          await MFAService.verifyChallengeCode(userId, mfaChallengeToken, '000000');
        } catch {
          // Expected to fail
        }
      }

      // Next attempt should be blocked
      const result = MFAService.verifyChallengeCode(userId, mfaChallengeToken, '000000');

      await expect(result).rejects.toThrow('Too many failed attempts');
    });

    it('should record attempt in database', async () => {
      // Setup MFA
      const { setupToken, secret } = await MFAService.startSetup(userId);
      const setupCode = TOTPService.getCurrentCode(secret);
      const verifyResult = await MFAService.verifySetupCode(userId, setupToken, setupCode);
      await MFAService.confirmSetup(userId, setupToken, verifyResult.recoveryCodes);

      // Generate challenge
      const { mfaChallengeToken } = await MFAService.generateChallenge(
        userId,
        'session-123',
        '127.0.0.1',
        'Mozilla'
      );

      // Make a wrong attempt
      try {
        await MFAService.verifyChallengeCode(userId, mfaChallengeToken, '000000');
      } catch {
        // Expected
      }

      // Check attempt recorded
      const mfaMethod = await prisma.mFAMethod.findUnique({
        where: {
          userId_type: { userId, type: 'TOTP' },
        },
      });

      const attempts = await prisma.mFAAttempt.findMany({
        where: { mfaMethodId: mfaMethod?.id },
      });

      expect(attempts.length).toBeGreaterThan(0);
      expect(attempts[0].success).toBe(false);
      expect(attempts[0].code).toHaveLength(4); // Last 4 digits
    });
  });

  describe('verifyChallengeRecoveryCode', () => {
    it('should verify recovery code', async () => {
      // Setup MFA
      const { setupToken, secret } = await MFAService.startSetup(userId);
      const setupCode = TOTPService.getCurrentCode(secret);
      const verifyResult = await MFAService.verifySetupCode(userId, setupToken, setupCode);
      const recoveryCode = verifyResult.recoveryCodes[0];
      await MFAService.confirmSetup(userId, setupToken, verifyResult.recoveryCodes);

      // Generate challenge
      const { mfaChallengeToken } = await MFAService.generateChallenge(
        userId,
        'session-123',
        '127.0.0.1',
        'Mozilla'
      );

      // Verify recovery code
      const result = await MFAService.verifyChallengeRecoveryCode(
        userId,
        mfaChallengeToken,
        recoveryCode
      );

      expect(result.success).toBe(true);
      expect(result.warning).toContain('Recovery code used');
    });

    it('should prevent recovery code reuse', async () => {
      // Setup MFA
      const { setupToken, secret } = await MFAService.startSetup(userId);
      const setupCode = TOTPService.getCurrentCode(secret);
      const verifyResult = await MFAService.verifySetupCode(userId, setupToken, setupCode);
      const recoveryCode = verifyResult.recoveryCodes[0];
      await MFAService.confirmSetup(userId, setupToken, verifyResult.recoveryCodes);

      // Use recovery code
      const { mfaChallengeToken } = await MFAService.generateChallenge(
        userId,
        'session-123',
        '127.0.0.1',
        'Mozilla'
      );
      await MFAService.verifyChallengeRecoveryCode(userId, mfaChallengeToken, recoveryCode);

      // Try to reuse
      const { mfaChallengeToken: token2 } = await MFAService.generateChallenge(
        userId,
        'session-456',
        '127.0.0.1',
        'Mozilla'
      );

      const result = MFAService.verifyChallengeRecoveryCode(userId, token2, recoveryCode);

      await expect(result).rejects.toThrow('Recovery code already used');
    });

    it('should set status to RECOVERY_MODE', async () => {
      // Setup MFA
      const { setupToken, secret } = await MFAService.startSetup(userId);
      const setupCode = TOTPService.getCurrentCode(secret);
      const verifyResult = await MFAService.verifySetupCode(userId, setupToken, setupCode);
      const recoveryCode = verifyResult.recoveryCodes[0];
      await MFAService.confirmSetup(userId, setupToken, verifyResult.recoveryCodes);

      // Use recovery code
      const { mfaChallengeToken } = await MFAService.generateChallenge(
        userId,
        'session-123',
        '127.0.0.1',
        'Mozilla'
      );
      await MFAService.verifyChallengeRecoveryCode(userId, mfaChallengeToken, recoveryCode);

      // Check status
      const mfaMethod = await prisma.mFAMethod.findUnique({
        where: {
          userId_type: { userId, type: 'TOTP' },
        },
      });

      expect(mfaMethod?.status).toBe('RECOVERY_MODE');
    });
  });

  describe('disable', () => {
    it('should disable MFA', async () => {
      // Setup MFA first
      const { setupToken, secret } = await MFAService.startSetup(userId);
      const code = TOTPService.getCurrentCode(secret);
      const verifyResult = await MFAService.verifySetupCode(userId, setupToken, code);
      await MFAService.confirmSetup(userId, setupToken, verifyResult.recoveryCodes);

      // Disable
      const result = await MFAService.disable(userId);

      expect(result.success).toBe(true);

      // Verify disabled
      const mfaMethod = await prisma.mFAMethod.findUnique({
        where: {
          userId_type: { userId, type: 'TOTP' },
        },
      });

      expect(mfaMethod?.status).toBe('DISABLED');
    });
  });

  describe('getRecoveryCodes', () => {
    it('should return codes with status', async () => {
      // Setup MFA with recovery codes
      const { setupToken, secret } = await MFAService.startSetup(userId);
      const code = TOTPService.getCurrentCode(secret);
      const verifyResult = await MFAService.verifySetupCode(userId, setupToken, code);
      await MFAService.confirmSetup(userId, setupToken, verifyResult.recoveryCodes);

      // Get codes
      const result = await MFAService.getRecoveryCodes(userId);

      expect(result).toHaveProperty('codes');
      expect(result.codes).toHaveLength(10);

      result.codes.forEach((code) => {
        expect(code).toHaveProperty('prefix');
        expect(code).toHaveProperty('usedAt');
        expect(code.prefix).toHaveLength(8);
      });
    });

    it('should mask codes (not show plaintext)', async () => {
      // Setup MFA
      const { setupToken, secret } = await MFAService.startSetup(userId);
      const code = TOTPService.getCurrentCode(secret);
      const verifyResult = await MFAService.verifySetupCode(userId, setupToken, code);
      const recoveryCode = verifyResult.recoveryCodes[0];
      await MFAService.confirmSetup(userId, setupToken, verifyResult.recoveryCodes);

      // Get codes
      const result = await MFAService.getRecoveryCodes(userId);

      const codesString = JSON.stringify(result);
      expect(codesString).not.toContain(recoveryCode);
    });

    it('should show empty for user without MFA', async () => {
      const result = await MFAService.getRecoveryCodes(userId);

      expect(result.codes).toHaveLength(0);
    });
  });
});
