import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { SetupTokenService } from '../setup-token.service';
import { TOTPService } from '../totp.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('SetupTokenService', () => {
  const userId = 'test-user-123';

  describe('createToken', () => {
    it('should generate token with 64-character hex format', async () => {
      const { token } = await SetupTokenService.createToken(userId);

      expect(token).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(token)).toBe(true);

      // Cleanup
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await prisma.mFASetupToken.delete({ where: { tokenHash } });
    });

    it('should generate valid TOTP secret', async () => {
      const { secret } = await SetupTokenService.createToken(userId);

      expect(secret).toHaveLength(32);
      expect(/^[A-Z2-7=]*$/.test(secret)).toBe(true);

      // Cleanup
      const allTokens = await prisma.mFASetupToken.findMany({ where: { userId } });
      await prisma.mFASetupToken.deleteMany({
        where: { id: { in: allTokens.map((t) => t.id) } },
      });
    });

    it('should return valid otpauth URI', async () => {
      const { token, secret, uri } = await SetupTokenService.createToken(userId);

      expect(uri).toContain('otpauth://totp/');
      expect(uri).toContain(userId);
      expect(uri).toContain(`secret=${secret}`);

      // Cleanup
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await prisma.mFASetupToken.delete({ where: { tokenHash } });
    });

    it('should return future expiry time', async () => {
      const now = new Date();
      const { token, expiresAt } = await SetupTokenService.createToken(userId);

      expect(expiresAt.getTime()).toBeGreaterThan(now.getTime());
      expect(expiresAt.getTime()).toBeLessThanOrEqual(now.getTime() + 10 * 60 * 1000 + 1000);

      // Cleanup
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await prisma.mFASetupToken.delete({ where: { tokenHash } });
    });

    it('should store only hash in database', async () => {
      const { token } = await SetupTokenService.createToken(userId);
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const storedToken = await prisma.mFASetupToken.findUnique({ where: { tokenHash } });

      expect(storedToken).toBeDefined();
      expect(storedToken?.tokenHash).toBe(tokenHash);
      expect(storedToken?.userId).toBe(userId);
      expect(storedToken?.verified).toBe(false);

      // Verify raw token is not stored
      const tokenAsString = JSON.stringify(storedToken);
      expect(tokenAsString).not.toContain(token);

      // Cleanup
      await prisma.mFASetupToken.delete({ where: { tokenHash } });
    });

    it('should generate unique secrets', async () => {
      const secrets = new Set<string>();

      for (let i = 0; i < 10; i++) {
        const { token, secret } = await SetupTokenService.createToken(userId);
        secrets.add(secret);

        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        await prisma.mFASetupToken.delete({ where: { tokenHash } });
      }

      expect(secrets.size).toBe(10);
    });
  });

  describe('verifyToken', () => {
    it('should verify valid token with correct code', async () => {
      const { token, secret } = await SetupTokenService.createToken(userId);
      const code = TOTPService.getCurrentCode(secret);

      const result = await SetupTokenService.verifyToken(token, code, userId);

      expect(result).toBeDefined();
      expect(result?.secret).toBe(secret);

      // Verify token is marked as verified
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const storedToken = await prisma.mFASetupToken.findUnique({ where: { tokenHash } });
      expect(storedToken?.verified).toBe(true);

      // Cleanup
      await prisma.mFASetupToken.delete({ where: { tokenHash } });
    });

    it('should reject token with invalid code', async () => {
      const { token } = await SetupTokenService.createToken(userId);

      const result = await SetupTokenService.verifyToken(token, '000000', userId);

      expect(result).toBeNull();

      // Cleanup
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await prisma.mFASetupToken.delete({ where: { tokenHash } });
    });

    it('should reject token for different user', async () => {
      const { token, secret } = await SetupTokenService.createToken(userId);
      const code = TOTPService.getCurrentCode(secret);

      const result = await SetupTokenService.verifyToken(token, code, 'different-user');

      expect(result).toBeNull();

      // Cleanup
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await prisma.mFASetupToken.delete({ where: { tokenHash } });
    });

    it('should reject non-existent token', async () => {
      const fakeToken = crypto.randomBytes(32).toString('hex');

      const result = await SetupTokenService.verifyToken(fakeToken, '123456', userId);

      expect(result).toBeNull();
    });

    it('should reject expired token', async () => {
      const { token, secret } = await SetupTokenService.createToken(userId);
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const code = TOTPService.getCurrentCode(secret);

      // Manually expire the token
      await prisma.mFASetupToken.update({
        where: { tokenHash },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const result = await SetupTokenService.verifyToken(token, code, userId);

      expect(result).toBeNull();

      // Cleanup
      await prisma.mFASetupToken.delete({ where: { tokenHash } });
    });

    it('should accept code from ±1 time window', async () => {
      const { token, secret } = await SetupTokenService.createToken(userId);

      // Get current and previous codes
      const currentCode = TOTPService.getCurrentCode(secret);
      expect(await SetupTokenService.verifyToken(token, currentCode, userId)).toBeDefined();

      // Cleanup
      let tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await prisma.mFASetupToken.delete({ where: { tokenHash } });
    });
  });

  describe('getVerified', () => {
    it('should return verified token', async () => {
      const { token, secret } = await SetupTokenService.createToken(userId);
      const code = TOTPService.getCurrentCode(secret);

      // Verify the token first
      await SetupTokenService.verifyToken(token, code, userId);

      // Now get verified
      const result = await SetupTokenService.getVerified(token, userId);

      expect(result).toBeDefined();
      expect(result?.secret).toBe(secret);

      // Cleanup
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await prisma.mFASetupToken.delete({ where: { tokenHash } });
    });

    it('should reject unverified token', async () => {
      const { token } = await SetupTokenService.createToken(userId);

      const result = await SetupTokenService.getVerified(token, userId);

      expect(result).toBeNull();

      // Cleanup
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await prisma.mFASetupToken.delete({ where: { tokenHash } });
    });

    it('should reject expired verified token', async () => {
      const { token, secret } = await SetupTokenService.createToken(userId);
      const code = TOTPService.getCurrentCode(secret);
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      // Verify the token
      await SetupTokenService.verifyToken(token, code, userId);

      // Expire the token
      await prisma.mFASetupToken.update({
        where: { tokenHash },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const result = await SetupTokenService.getVerified(token, userId);

      expect(result).toBeNull();

      // Cleanup
      await prisma.mFASetupToken.delete({ where: { tokenHash } });
    });

    it('should reject token for different user', async () => {
      const { token, secret } = await SetupTokenService.createToken(userId);
      const code = TOTPService.getCurrentCode(secret);

      // Verify for original user
      await SetupTokenService.verifyToken(token, code, userId);

      // Try to get for different user
      const result = await SetupTokenService.getVerified(token, 'different-user');

      expect(result).toBeNull();

      // Cleanup
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await prisma.mFASetupToken.delete({ where: { tokenHash } });
    });
  });

  describe('deleteToken', () => {
    it('should delete setup token', async () => {
      const { token } = await SetupTokenService.createToken(userId);
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const result = await SetupTokenService.deleteToken(tokenHash);

      expect(result).toBe(true);

      // Verify token is deleted
      const storedToken = await prisma.mFASetupToken.findUnique({ where: { tokenHash } });
      expect(storedToken).toBeNull();
    });

    it('should handle deletion of non-existent token', async () => {
      const result = await SetupTokenService.deleteToken('non-existent-hash');

      expect(result).toBe(false);
    });
  });

  describe('cleanupExpired', () => {
    it('should delete expired tokens', async () => {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const secret = TOTPService.generateSecret();

      const createdToken = await prisma.mFASetupToken.create({
        data: {
          userId,
          tokenHash,
          secret,
          expiresAt: new Date(Date.now() - 10000), // Expired
        },
      });

      const cleanedCount = await SetupTokenService.cleanupExpired();

      expect(cleanedCount).toBeGreaterThanOrEqual(1);

      const deletedToken = await prisma.mFASetupToken.findUnique({
        where: { tokenHash },
      });

      expect(deletedToken).toBeNull();
    });

    it('should not delete non-expired tokens', async () => {
      const { token } = await SetupTokenService.createToken(userId);
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const beforeCount = await prisma.mFASetupToken.count({
        where: { tokenHash },
      });

      await SetupTokenService.cleanupExpired();

      const afterCount = await prisma.mFASetupToken.count({
        where: { tokenHash },
      });

      expect(afterCount).toBe(beforeCount);

      // Cleanup
      await prisma.mFASetupToken.delete({ where: { tokenHash } });
    });
  });

  describe('getExpiryTime', () => {
    it('should return future date approximately 10 minutes away', () => {
      const now = new Date();
      const expiry = SetupTokenService.getExpiryTime();

      expect(expiry.getTime()).toBeGreaterThan(now.getTime());
      expect(expiry.getTime()).toBeLessThanOrEqual(now.getTime() + 10 * 60 * 1000 + 1000);
    });
  });

  describe('Security Properties', () => {
    it('should generate unique tokens', async () => {
      const tokens = new Set<string>();

      for (let i = 0; i < 20; i++) {
        const { token } = await SetupTokenService.createToken(userId);
        tokens.add(token);

        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        await prisma.mFASetupToken.delete({ where: { tokenHash } });
      }

      expect(tokens.size).toBe(20);
    });

    it('should prevent token reuse after verification', async () => {
      const { token, secret } = await SetupTokenService.createToken(userId);
      const code = TOTPService.getCurrentCode(secret);

      // First verification succeeds
      const result1 = await SetupTokenService.verifyToken(token, code, userId);
      expect(result1).toBeDefined();

      // Second verification with same code should fail (token already verified)
      const result2 = await SetupTokenService.verifyToken(token, code, userId);
      expect(result2).toBeNull();

      // Cleanup
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await prisma.mFASetupToken.delete({ where: { tokenHash } });
    });
  });
});
