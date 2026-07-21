import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { ChallengeTokenService } from '../challenge-token.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('ChallengeTokenService', () => {
  const userId = 'test-user-123';
  const sessionId = 'session-456';
  const ipAddress = '127.0.0.1';
  const userAgent = 'Mozilla/5.0';

  describe('generateToken', () => {
    it('should generate token with 64-character hex format', async () => {
      const { token } = await ChallengeTokenService.generateToken(userId, sessionId, ipAddress, userAgent);

      expect(token).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(token)).toBe(true);
    });

    it('should return future expiry time', async () => {
      const now = new Date();
      const { expiresAt } = await ChallengeTokenService.generateToken(userId, sessionId, ipAddress, userAgent);

      expect(expiresAt.getTime()).toBeGreaterThan(now.getTime());
      expect(expiresAt.getTime()).toBeLessThanOrEqual(now.getTime() + 5 * 60 * 1000 + 1000); // ~5 mins
    });

    it('should store only hash in database', async () => {
      const { token } = await ChallengeTokenService.generateToken(userId, sessionId, ipAddress, userAgent);
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const storedToken = await prisma.mFAChallengeToken.findUnique({
        where: { tokenHash },
      });

      expect(storedToken).toBeDefined();
      expect(storedToken?.tokenHash).toBe(tokenHash);
      expect(storedToken?.userId).toBe(userId);
      expect(storedToken?.sessionId).toBe(sessionId);
      expect(storedToken?.ipAddress).toBe(ipAddress);
      expect(storedToken?.userAgent).toBe(userAgent);

      // Cleanup
      await prisma.mFAChallengeToken.delete({ where: { id: storedToken!.id } });
    });

    it('should generate unique tokens', async () => {
      const tokens = new Set<string>();

      for (let i = 0; i < 10; i++) {
        const { token } = await ChallengeTokenService.generateToken(userId, sessionId, ipAddress, userAgent);
        tokens.add(token);
      }

      expect(tokens.size).toBe(10);

      // Cleanup
      const allTokens = await prisma.mFAChallengeToken.findMany({
        where: { userId },
      });
      await prisma.mFAChallengeToken.deleteMany({
        where: { id: { in: allTokens.map((t) => t.id) } },
      });
    });
  });

  describe('verifyToken', () => {
    it('should verify valid token', async () => {
      const { token } = await ChallengeTokenService.generateToken(userId, sessionId, ipAddress, userAgent);

      const verified = await ChallengeTokenService.verifyToken(token, userId);

      expect(verified).toBeDefined();
      expect(verified.userId).toBe(userId);
      expect(verified.sessionId).toBe(sessionId);

      // Cleanup
      await prisma.mFAChallengeToken.delete({ where: { id: verified.id } });
    });

    it('should reject token for different user', async () => {
      const { token } = await ChallengeTokenService.generateToken(userId, sessionId, ipAddress, userAgent);

      const verified = await ChallengeTokenService.verifyToken(token, 'different-user');

      expect(verified).toBeNull();

      // Cleanup
      const storedToken = await prisma.mFAChallengeToken.findUnique({
        where: { tokenHash: crypto.createHash('sha256').update(token).digest('hex') },
      });
      await prisma.mFAChallengeToken.delete({ where: { id: storedToken!.id } });
    });

    it('should reject non-existent token', async () => {
      const fakeToken = crypto.randomBytes(32).toString('hex');

      const verified = await ChallengeTokenService.verifyToken(fakeToken, userId);

      expect(verified).toBeNull();
    });

    it('should reject expired token', async () => {
      const { token } = await ChallengeTokenService.generateToken(userId, sessionId, ipAddress, userAgent);
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      // Manually expire the token
      await prisma.mFAChallengeToken.update({
        where: { tokenHash },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const verified = await ChallengeTokenService.verifyToken(token, userId);

      expect(verified).toBeNull();

      // Cleanup
      await prisma.mFAChallengeToken.delete({ where: { tokenHash } });
    });

    it('should reject already-used token', async () => {
      const { token } = await ChallengeTokenService.generateToken(userId, sessionId, ipAddress, userAgent);
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const storedToken = await prisma.mFAChallengeToken.findUnique({ where: { tokenHash } });
      await prisma.mFAChallengeToken.update({
        where: { id: storedToken!.id },
        data: { usedAt: new Date() },
      });

      const verified = await ChallengeTokenService.verifyToken(token, userId);

      expect(verified).toBeNull();

      // Cleanup
      await prisma.mFAChallengeToken.delete({ where: { tokenHash } });
    });
  });

  describe('consumeToken', () => {
    it('should mark token as used', async () => {
      const { token } = await ChallengeTokenService.generateToken(userId, sessionId, ipAddress, userAgent);
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const storedToken = await prisma.mFAChallengeToken.findUnique({ where: { tokenHash } });
      const result = await ChallengeTokenService.consumeToken(storedToken!.id);

      expect(result).toBe(true);

      const usedToken = await prisma.mFAChallengeToken.findUnique({ where: { tokenHash } });
      expect(usedToken?.usedAt).toBeDefined();

      // Cleanup
      await prisma.mFAChallengeToken.delete({ where: { tokenHash } });
    });

    it('should prevent token reuse after consumption', async () => {
      const { token } = await ChallengeTokenService.generateToken(userId, sessionId, ipAddress, userAgent);
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const storedToken = await prisma.mFAChallengeToken.findUnique({ where: { tokenHash } });
      await ChallengeTokenService.consumeToken(storedToken!.id);

      // Try to verify after consumption
      const verified = await ChallengeTokenService.verifyToken(token, userId);

      expect(verified).toBeNull();

      // Cleanup
      await prisma.mFAChallengeToken.delete({ where: { tokenHash } });
    });

    it('should handle non-existent token ID gracefully', async () => {
      const result = await ChallengeTokenService.consumeToken('non-existent-id');

      expect(result).toBe(false);
    });
  });

  describe('cleanupExpired', () => {
    it('should mark expired tokens as used', async () => {
      // Create an expired token
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const createdToken = await prisma.mFAChallengeToken.create({
        data: {
          userId,
          tokenHash,
          sessionId,
          ipAddress,
          userAgent,
          expiresAt: new Date(Date.now() - 10000), // Expired
        },
      });

      const cleanedCount = await ChallengeTokenService.cleanupExpired();

      expect(cleanedCount).toBeGreaterThanOrEqual(1);

      const markedToken = await prisma.mFAChallengeToken.findUnique({
        where: { id: createdToken.id },
      });

      expect(markedToken?.usedAt).toBeDefined();

      // Cleanup
      await prisma.mFAChallengeToken.delete({ where: { tokenHash } });
    });

    it('should not clean already-used tokens', async () => {
      // Create a used token
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const createdToken = await prisma.mFAChallengeToken.create({
        data: {
          userId,
          tokenHash,
          sessionId,
          ipAddress,
          userAgent,
          expiresAt: new Date(Date.now() - 10000), // Expired
          usedAt: new Date(),
        },
      });

      const beforeCount = await prisma.mFAChallengeToken.count({
        where: { id: createdToken.id, usedAt: { not: null } },
      });

      await ChallengeTokenService.cleanupExpired();

      const afterCount = await prisma.mFAChallengeToken.count({
        where: { id: createdToken.id, usedAt: { not: null } },
      });

      expect(afterCount).toBe(beforeCount);

      // Cleanup
      await prisma.mFAChallengeToken.delete({ where: { tokenHash } });
    });
  });

  describe('getExpiryTime', () => {
    it('should return future date', () => {
      const now = new Date();
      const expiry = ChallengeTokenService.getExpiryTime();

      expect(expiry.getTime()).toBeGreaterThan(now.getTime());
      expect(expiry.getTime()).toBeLessThanOrEqual(now.getTime() + 5 * 60 * 1000 + 1000);
    });
  });

  describe('Security Properties', () => {
    it('should use sufficient entropy', async () => {
      const tokens = new Set<string>();

      for (let i = 0; i < 50; i++) {
        const { token } = await ChallengeTokenService.generateToken(userId, sessionId, ipAddress, userAgent);
        tokens.add(token);
      }

      expect(tokens.size).toBe(50);

      // Cleanup
      const allTokens = await prisma.mFAChallengeToken.findMany({ where: { userId } });
      await prisma.mFAChallengeToken.deleteMany({
        where: { id: { in: allTokens.map((t) => t.id) } },
      });
    });

    it('should not store raw token', async () => {
      const { token } = await ChallengeTokenService.generateToken(userId, sessionId, ipAddress, userAgent);
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const storedToken = await prisma.mFAChallengeToken.findUnique({ where: { tokenHash } });

      // Should not store raw token anywhere
      const tokenAsString = JSON.stringify(storedToken);
      expect(tokenAsString).not.toContain(token);

      // Cleanup
      await prisma.mFAChallengeToken.delete({ where: { id: storedToken!.id } });
    });
  });
});
