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

  async function registerAndGetTokens() {
    const res = await request(app).post('/api/auth/register').send({ email, password });
    return res.body.data as { accessToken: string; refreshToken: string };
  }

  it('issues both an access and a refresh token on register', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: `reg-${Date.now()}@example.com`, password });

    expect(res.status).toBe(201);
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(typeof res.body.data.refreshToken).toBe('string');
    // Clean up this extra user.
    await prisma.user.deleteMany({ where: { email: res.body.data.user.email } });
  });

  it('exchanges a valid refresh token for a new pair and rotates (old token is revoked)', async () => {
    const { refreshToken: original } = await registerAndGetTokens();

    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: original });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toBeDefined();
    expect(refreshed.body.data.refreshToken).toBeDefined();
    expect(refreshed.body.data.refreshToken).not.toBe(original);

    // The original (now rotated-out) token must no longer work — reuse detection.
    const reused = await request(app).post('/api/auth/refresh').send({ refreshToken: original });
    expect(reused.status).toBe(401);

    // The new token must work.
    const secondRefresh = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: refreshed.body.data.refreshToken });
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

  it('rejects refresh/logout with a missing body field (400 validation)', async () => {
    const refresh = await request(app).post('/api/auth/refresh').send({});
    const logout = await request(app).post('/api/auth/logout').send({});
    expect(refresh.status).toBe(400);
    expect(logout.status).toBe(400);
  });
});
