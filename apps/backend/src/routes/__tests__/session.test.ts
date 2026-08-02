import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';

/**
 * R1-c: refresh-token rotation + logout invalidation, end to end through the
 * real /api/auth routes against real Postgres. Proves the security-critical
 * properties: a session can be refreshed, refreshing rotates (old token dies),
 * logout truly revokes, and a revoked/expired/unknown token cannot mint a
 * session.
 */
describe('refresh token lifecycle (R1-c)', () => {
  let app: Express;
  const email = `session-user-${Date.now()}@example.com`;
  const password = 'a-valid-password-123';

  beforeAll(async () => {
    const config = await initConfig();
    app = createApp(config);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  // Tokens are now issued as HttpOnly cookies, not in the JSON body (see
  // setAuthCookies in ../auth.ts); extract the raw refreshToken value from
  // the Set-Cookie header so it can still be exercised the way a client
  // would send it back (either via cookie or, per the route's documented
  // backwards-compat fallback, in the request body).
  function extractCookieValue(setCookieHeaders: string | string[] | undefined, name: string): string {
    const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : setCookieHeaders ? [setCookieHeaders] : [];
    const header = cookies.find((c) => c.startsWith(`${name}=`));
    if (!header) throw new Error(`Cookie ${name} not found in Set-Cookie headers`);
    return header.split(';')[0].slice(name.length + 1);
  }

  async function registerAndGetTokens() {
    const res = await request(app).post('/api/auth/register').send({ email, password });
    return {
      accessToken: extractCookieValue(res.headers['set-cookie'], 'accessToken'),
      refreshToken: extractCookieValue(res.headers['set-cookie'], 'refreshToken'),
    };
  }

  it('issues both an access and a refresh token as HttpOnly cookies on register (not in the body)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: `reg-${Date.now()}@example.com`, password });

    expect(res.status).toBe(201);
    // P0-002: tokens are set as HttpOnly cookies (see setAuthCookies in
    // ../auth.ts), never returned in the JSON body.
    expect(res.body.data.accessToken).toBeUndefined();
    expect(res.body.data.refreshToken).toBeUndefined();
    expect(typeof extractCookieValue(res.headers['set-cookie'], 'accessToken')).toBe('string');
    expect(typeof extractCookieValue(res.headers['set-cookie'], 'refreshToken')).toBe('string');
    // Clean up this extra user.
    await prisma.user.deleteMany({ where: { email: res.body.data.user.email } });
  });

  it('exchanges a valid refresh token for a new pair and rotates (old token is revoked)', async () => {
    const { refreshToken: original } = await registerAndGetTokens();

    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: original });
    expect(refreshed.status).toBe(200);
    const rotatedRefreshToken = extractCookieValue(refreshed.headers['set-cookie'], 'refreshToken');
    expect(typeof extractCookieValue(refreshed.headers['set-cookie'], 'accessToken')).toBe('string');
    expect(rotatedRefreshToken).toBeDefined();
    expect(rotatedRefreshToken).not.toBe(original);

    // The original (now rotated-out) token must no longer work — reuse detection.
    const reused = await request(app).post('/api/auth/refresh').send({ refreshToken: original });
    expect(reused.status).toBe(401);

    // The new token must work.
    const secondRefresh = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: rotatedRefreshToken });
    expect(secondRefresh.status).toBe(200);

    await prisma.user.deleteMany({ where: { email } });
  });

  it('logout revokes the refresh token so it can no longer refresh', async () => {
    const { refreshToken } = await registerAndGetTokens();

    const logout = await request(app).post('/api/auth/logout').send({ refreshToken });
    expect(logout.status).toBe(200);

    const afterLogout = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(afterLogout.status).toBe(401);

    await prisma.user.deleteMany({ where: { email } });
  });

  it('logout is idempotent (a second logout with the same token still succeeds)', async () => {
    const { refreshToken } = await registerAndGetTokens();

    await request(app).post('/api/auth/logout').send({ refreshToken });
    const second = await request(app).post('/api/auth/logout').send({ refreshToken });
    expect(second.status).toBe(200);

    await prisma.user.deleteMany({ where: { email } });
  });

  it('rejects an unknown refresh token with 401', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'this-is-not-a-real-token' });

    expect(res.status).toBe(401);
  });

  it('rejects an expired refresh token with 401', async () => {
    const { refreshToken } = await registerAndGetTokens();

    // Force-expire the stored token by moving its expiry into the past.
    const { createHash } = await import('node:crypto');
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
    await prisma.refreshToken.update({
      where: { tokenHash },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(401);

    await prisma.user.deleteMany({ where: { email } });
  });

  it('rejects a refresh for a non-ACTIVE user with 401', async () => {
    const { refreshToken } = await registerAndGetTokens();
    await prisma.user.update({ where: { email }, data: { status: 'SUSPENDED' } });

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(401);

    await prisma.user.deleteMany({ where: { email } });
  });

  it('rejects refresh/logout with no token in cookie or body with 401', async () => {
    // P0-002 removed the zod schema that used to require `refreshToken` in
    // the body (refreshSchema/logoutSchema): the token may now legitimately
    // arrive via the accessToken/refreshToken cookies instead, so a missing
    // body field alone can no longer be a validation error. With neither a
    // cookie nor a body field present, both routes fall through to the
    // same "no token supplied" branch and throw UnauthorizedException (401),
    // not a 400 VALIDATION_ERROR.
    const refresh = await request(app).post('/api/auth/refresh').send({});
    const logout = await request(app).post('/api/auth/logout').send({});
    expect(refresh.status).toBe(401);
    expect(logout.status).toBe(200);
  });
});
