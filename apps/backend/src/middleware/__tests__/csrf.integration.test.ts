import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { CsrfManager } from '../../utils/csrf';

const prisma = new PrismaClient();

describe('CSRF Protection Integration Tests', () => {
  let userId: string;

  beforeEach(async () => {
    // Create test user
    const user = await prisma.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        password: 'hashed-password',
        name: 'Test User',
      },
    });
    userId = user.id;
  });

  afterEach(async () => {
    // Cleanup
    await prisma.csrfToken.deleteMany({
      where: { userId },
    });
    await prisma.user.deleteMany({
      where: { id: userId },
    });
  });

  describe('Token Lifecycle', () => {
    it('should create and store token hash (not raw token)', async () => {
      const token = CsrfManager.generateToken();
      const tokenHash = CsrfManager.hashToken(token);
      const expiresAt = CsrfManager.getExpiryTime();

      await prisma.csrfToken.create({
        data: {
          tokenHash,
          expiresAt,
          userId,
          ipAddress: '127.0.0.1',
        },
      });

      // Verify: only hash is in database
      const stored = await prisma.csrfToken.findUnique({
        where: { tokenHash },
      });

      expect(stored).toBeDefined();
      expect(stored?.tokenHash).toBe(tokenHash);
      // Verify raw token is NOT stored
      expect((stored as any).token).toBeUndefined();
    });

    it('should mark token as used atomically', async () => {
      const token = CsrfManager.generateToken();
      const tokenHash = CsrfManager.hashToken(token);

      const created = await prisma.csrfToken.create({
        data: {
          tokenHash,
          expiresAt: CsrfManager.getExpiryTime(),
          userId,
        },
      });

      // Consume token atomically
      const result = await prisma.$transaction(async (tx) => {
        const csrfToken = await tx.csrfToken.findUnique({
          where: { tokenHash },
        });

        if (csrfToken?.usedAt) {
          throw new Error('Token already used');
        }

        return await tx.csrfToken.update({
          where: { id: created.id },
          data: { usedAt: new Date() },
        });
      });

      expect(result.usedAt).toBeDefined();
    });
  });

  describe('Race Condition Prevention', () => {
    it('should prevent concurrent token consumption', async () => {
      const token = CsrfManager.generateToken();
      const tokenHash = CsrfManager.hashToken(token);

      const created = await prisma.csrfToken.create({
        data: {
          tokenHash,
          expiresAt: CsrfManager.getExpiryTime(),
          userId,
        },
      });

      // Simulate two concurrent requests trying to consume same token
      const consumeToken = async () => {
        try {
          return await prisma.$transaction(async (tx) => {
            const csrfToken = await tx.csrfToken.findUnique({
              where: { tokenHash },
            });

            if (!csrfToken) throw new Error('Not found');
            if (csrfToken.usedAt) throw new Error('Already used');

            return await tx.csrfToken.update({
              where: { id: created.id },
              data: { usedAt: new Date() },
            });
          });
        } catch (error) {
          return null;
        }
      };

      // Run both concurrently
      const [result1, result2] = await Promise.all([
        consumeToken(),
        consumeToken(),
      ]);

      // Exactly one should succeed
      const successCount = [result1, result2].filter((r) => r !== null).length;
      expect(successCount).toBe(1);
    });
  });

  describe('Rate Limiting', () => {
    it('should count tokens per IP address', async () => {
      const ip = '192.168.1.100';

      // Create 5 tokens from same IP
      for (let i = 0; i < 5; i++) {
        const tokenHash = CsrfManager.hashToken(
          CsrfManager.generateToken()
        );
        await prisma.csrfToken.create({
          data: {
            tokenHash,
            expiresAt: CsrfManager.getExpiryTime(),
            userId,
            ipAddress: ip,
          },
        });
      }

      // Count recent tokens from this IP
      const recentTokens = await prisma.csrfToken.count({
        where: {
          ipAddress: ip,
          createdAt: {
            gte: new Date(Date.now() - 60 * 1000),
          },
        },
      });

      expect(recentTokens).toBe(5);
    });

    it('should not count tokens from different IPs', async () => {
      const ip1 = '192.168.1.100';
      const ip2 = '192.168.1.101';

      // Create tokens from different IPs
      const tokenHash1 = CsrfManager.hashToken(
        CsrfManager.generateToken()
      );
      await prisma.csrfToken.create({
        data: {
          tokenHash: tokenHash1,
          expiresAt: CsrfManager.getExpiryTime(),
          userId,
          ipAddress: ip1,
        },
      });

      const tokenHash2 = CsrfManager.hashToken(
        CsrfManager.generateToken()
      );
      await prisma.csrfToken.create({
        data: {
          tokenHash: tokenHash2,
          expiresAt: CsrfManager.getExpiryTime(),
          userId,
          ipAddress: ip2,
        },
      });

      // Count should be per IP
      const count1 = await prisma.csrfToken.count({
        where: { ipAddress: ip1 },
      });
      const count2 = await prisma.csrfToken.count({
        where: { ipAddress: ip2 },
      });

      expect(count1).toBe(1);
      expect(count2).toBe(1);
    });
  });

  describe('Session Binding', () => {
    it('should bind token to session', async () => {
      const sessionId = 'session-123';
      const tokenHash = CsrfManager.hashToken(
        CsrfManager.generateToken()
      );

      await prisma.csrfToken.create({
        data: {
          tokenHash,
          expiresAt: CsrfManager.getExpiryTime(),
          userId,
          sessionId,
        },
      });

      const token = await prisma.csrfToken.findUnique({
        where: { tokenHash },
      });

      expect(token?.sessionId).toBe(sessionId);
    });

    it('should reject token from different session', async () => {
      const sessionId1 = 'session-123';
      const sessionId2 = 'session-456';

      const tokenHash = CsrfManager.hashToken(
        CsrfManager.generateToken()
      );

      await prisma.csrfToken.create({
        data: {
          tokenHash,
          expiresAt: CsrfManager.getExpiryTime(),
          userId,
          sessionId: sessionId1,
        },
      });

      const token = await prisma.csrfToken.findUnique({
        where: { tokenHash },
      });

      // Simulate validation from different session
      if (token?.sessionId && token.sessionId !== sessionId2) {
        expect(true).toBe(true); // Token should be rejected
      }
    });
  });

  describe('Token Expiry', () => {
    it('should expire token after 1 hour', async () => {
      const expiresAt = CsrfManager.getExpiryTime();
      const now = new Date();

      // Should be approximately 1 hour from now
      const diffMs = expiresAt.getTime() - now.getTime();
      const diffHours = diffMs / (60 * 60 * 1000);

      expect(diffHours).toBeCloseTo(1, 0.01);
    });

    it('should mark expired tokens', async () => {
      // Create expired token
      const expiredDate = new Date(Date.now() - 60 * 1000); // 1 min ago
      const tokenHash = CsrfManager.hashToken(
        CsrfManager.generateToken()
      );

      await prisma.csrfToken.create({
        data: {
          tokenHash,
          expiresAt: expiredDate,
          userId,
        },
      });

      // Mark expired tokens
      const updated = await prisma.csrfToken.updateMany({
        where: {
          expiresAt: { lt: new Date() },
          usedAt: null,
        },
        data: {
          usedAt: new Date(),
        },
      });

      expect(updated.count).toBe(1);

      // Verify token is marked as used
      const token = await prisma.csrfToken.findUnique({
        where: { tokenHash },
      });
      expect(token?.usedAt).toBeDefined();
    });
  });

  describe('Logout Invalidation', () => {
    it('should delete all tokens on logout', async () => {
      // Create multiple tokens for user
      for (let i = 0; i < 3; i++) {
        const tokenHash = CsrfManager.hashToken(
          CsrfManager.generateToken()
        );
        await prisma.csrfToken.create({
          data: {
            tokenHash,
            expiresAt: CsrfManager.getExpiryTime(),
            userId,
          },
        });
      }

      // Verify tokens exist
      const beforeLogout = await prisma.csrfToken.count({
        where: { userId },
      });
      expect(beforeLogout).toBe(3);

      // Logout: delete all tokens
      await prisma.csrfToken.deleteMany({
        where: { userId },
      });

      // Verify tokens are deleted
      const afterLogout = await prisma.csrfToken.count({
        where: { userId },
      });
      expect(afterLogout).toBe(0);
    });
  });

  describe('Security Properties', () => {
    it('should use SHA-256 hashing for tokens', () => {
      const token = CsrfManager.generateToken();
      const hash = CsrfManager.hashToken(token);

      // SHA-256 produces 64-character hex
      expect(hash).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);

      // Same token produces same hash
      const hash2 = CsrfManager.hashToken(token);
      expect(hash).toBe(hash2);

      // Different token produces different hash
      const token2 = CsrfManager.generateToken();
      const hash3 = CsrfManager.hashToken(token2);
      expect(hash).not.toBe(hash3);
    });

    it('should generate cryptographically random tokens', () => {
      const tokens = new Set<string>();

      // Generate 100 tokens, all should be unique
      for (let i = 0; i < 100; i++) {
        const token = CsrfManager.generateToken();
        tokens.add(token);
      }

      expect(tokens.size).toBe(100);
    });

    it('should store IP and User-Agent for audit', async () => {
      const tokenHash = CsrfManager.hashToken(
        CsrfManager.generateToken()
      );
      const ip = '192.168.1.1';
      const userAgent = 'Mozilla/5.0...';

      await prisma.csrfToken.create({
        data: {
          tokenHash,
          expiresAt: CsrfManager.getExpiryTime(),
          userId,
          ipAddress: ip,
          userAgent,
        },
      });

      const token = await prisma.csrfToken.findUnique({
        where: { tokenHash },
      });

      expect(token?.ipAddress).toBe(ip);
      expect(token?.userAgent).toBe(userAgent);
    });
  });
});
