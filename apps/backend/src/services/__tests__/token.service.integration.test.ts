import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { prisma } from '@synora/database';
import { initConfig } from '../../config';
import { secretsManager } from '../../secrets';
import {
  issueTokens,
  rotateTokens,
  revokeAllUserTokens,
  revokeAllUserTokensExcept,
} from '../token.service';

describe('token.service (sid claim, device metadata, remember-me)', () => {
  const testEmails: string[] = [];

  beforeAll(async () => {
    await initConfig();
  });

  afterEach(async () => {
    if (testEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
      testEmails.length = 0;
    }
  });

  async function makeUser() {
    const email = `token-svc-${Date.now()}-${Math.random()}@example.com`;
    testEmails.push(email);
    return prisma.user.create({ data: { email, password: 'irrelevant-for-this-test' } });
  }

  async function decodeAccessToken(token: string): Promise<jwt.JwtPayload> {
    const secret = await secretsManager.get('JWT_SECRET', 'test');
    return jwt.verify(token, secret) as jwt.JwtPayload;
  }

  it('embeds sid in the access token matching the persisted RefreshToken id', async () => {
    const user = await makeUser();
    const tokens = await issueTokens({ userId: user.id, email: user.email, role: user.role });

    const claims = await decodeAccessToken(tokens.accessToken);
    expect(claims.sid).toBe(tokens.sessionId);

    const record = await prisma.refreshToken.findUnique({ where: { id: tokens.sessionId } });
    expect(record).not.toBeNull();
  });

  it('persists device metadata and rememberMe on issue', async () => {
    const user = await makeUser();
    const tokens = await issueTokens(
      { userId: user.id, email: user.email, role: user.role },
      { userAgent: 'TestAgent/1.0', ipAddress: '203.0.113.5', rememberMe: true }
    );

    const record = await prisma.refreshToken.findUnique({ where: { id: tokens.sessionId } });
    expect(record?.userAgent).toBe('TestAgent/1.0');
    expect(record?.ipAddress).toBe('203.0.113.5');
    expect(record?.rememberMe).toBe(true);
  });

  it('gives a remember-me session a longer expiry than a normal one', async () => {
    const user = await makeUser();
    const normal = await issueTokens({ userId: user.id, email: user.email, role: user.role });
    const remembered = await issueTokens(
      { userId: user.id, email: user.email, role: user.role },
      { rememberMe: true }
    );

    const normalRecord = await prisma.refreshToken.findUnique({ where: { id: normal.sessionId } });
    const rememberedRecord = await prisma.refreshToken.findUnique({ where: { id: remembered.sessionId } });

    expect(rememberedRecord!.expiresAt.getTime()).toBeGreaterThan(normalRecord!.expiresAt.getTime());
  });

  it('rotation issues a new sid matching the new RefreshToken row, and revokes the old one', async () => {
    const user = await makeUser();
    const original = await issueTokens({ userId: user.id, email: user.email, role: user.role });

    const rotated = await rotateTokens(original.refreshToken);
    expect(rotated).not.toBeNull();
    expect(rotated!.sessionId).not.toBe(original.sessionId);

    const oldClaims = await decodeAccessToken(original.accessToken);
    const newClaims = await decodeAccessToken(rotated!.accessToken);
    expect(newClaims.sid).not.toBe(oldClaims.sid);

    const oldRecord = await prisma.refreshToken.findUnique({ where: { id: original.sessionId } });
    expect(oldRecord?.revokedAt).not.toBeNull();
  });

  it('rotation carries rememberMe forward and refreshes device metadata to the new request', async () => {
    const user = await makeUser();
    const original = await issueTokens(
      { userId: user.id, email: user.email, role: user.role },
      { rememberMe: true, userAgent: 'Old/1.0', ipAddress: '10.0.0.1' }
    );

    const rotated = await rotateTokens(original.refreshToken, {
      userAgent: 'New/2.0',
      ipAddress: '10.0.0.2',
    });

    const newRecord = await prisma.refreshToken.findUnique({ where: { id: rotated!.sessionId } });
    expect(newRecord?.rememberMe).toBe(true);
    expect(newRecord?.userAgent).toBe('New/2.0');
    expect(newRecord?.ipAddress).toBe('10.0.0.2');
  });

  it('revokeAllUserTokens revokes every active session for the user', async () => {
    const user = await makeUser();
    const a = await issueTokens({ userId: user.id, email: user.email, role: user.role });
    const b = await issueTokens({ userId: user.id, email: user.email, role: user.role });

    const count = await revokeAllUserTokens(user.id);
    expect(count).toBe(2);

    const recordA = await prisma.refreshToken.findUnique({ where: { id: a.sessionId } });
    const recordB = await prisma.refreshToken.findUnique({ where: { id: b.sessionId } });
    expect(recordA?.revokedAt).not.toBeNull();
    expect(recordB?.revokedAt).not.toBeNull();
  });

  it('revokeAllUserTokensExcept leaves the excepted session untouched', async () => {
    const user = await makeUser();
    const keep = await issueTokens({ userId: user.id, email: user.email, role: user.role });
    const other = await issueTokens({ userId: user.id, email: user.email, role: user.role });

    const count = await revokeAllUserTokensExcept(user.id, keep.sessionId);
    expect(count).toBe(1);

    const keptRecord = await prisma.refreshToken.findUnique({ where: { id: keep.sessionId } });
    const otherRecord = await prisma.refreshToken.findUnique({ where: { id: other.sessionId } });
    expect(keptRecord?.revokedAt).toBeNull();
    expect(otherRecord?.revokedAt).not.toBeNull();
  });
});
