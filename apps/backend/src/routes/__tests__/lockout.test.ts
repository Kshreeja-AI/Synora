import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';

/**
 * R1-d: account lockout on login, end to end through the real
 * /api/auth/login route against real Postgres. The A3 rate-limiter service
 * exists (services/mfa/rate-limiter.service.ts) but is tightly coupled to
 * the MFAAuditLog table — a domain not reintegrated in Release 1 — so this
 * exercises the dedicated lockout.service instead, wired directly into login.
 */
describe('account lockout on login (R1-d)', () => {
  let app: Express;
  const email = `lockout-e2e-${Date.now()}@example.com`;
  const password = 'the-correct-password-123';

  beforeAll(async () => {
    const config = await initConfig();
    app = createApp(config);
    await request(app).post('/api/auth/register').send({ email, password });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it('allows failed attempts below the threshold (default 5) without locking', async () => {
    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'wrong-password' });
      expect(res.status).toBe(400);
    }

    // The account is not yet locked — the correct password still works.
    const res = await request(app).post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
  });

  it('locks the account after the 5th consecutive failed attempt', async () => {
    const lockEmail = `lockout-trigger-${Date.now()}@example.com`;
    await request(app).post('/api/auth/register').send({ email: lockEmail, password });

    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send({ email: lockEmail, password: 'wrong' });
    }

    // Even the CORRECT password must now be rejected — lockout blocks the
    // account for its duration, it doesn't just stop wrong guesses.
    const res = await request(app).post('/api/auth/login').send({ email: lockEmail, password });

    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(res.body.error.details.lockedUntil).toBeDefined();

    await prisma.user.deleteMany({ where: { email: lockEmail } });
  });

  it('unlocks automatically once the lockout window has elapsed', async () => {
    const unlockEmail = `lockout-unlock-${Date.now()}@example.com`;
    const user = await request(app)
      .post('/api/auth/register')
      .send({ email: unlockEmail, password });
    const userId = user.body.data.user.id;

    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send({ email: unlockEmail, password: 'wrong' });
    }

    // Simulate the lockout window having already elapsed by moving
    // lockedUntil into the past directly in the database — proves the
    // unlock is time-based (config-driven), not a manual admin action.
    await prisma.user.update({
      where: { id: userId },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });

    const res = await request(app).post('/api/auth/login').send({ email: unlockEmail, password });
    expect(res.status).toBe(200);

    await prisma.user.deleteMany({ where: { email: unlockEmail } });
  });

  it('resets the failed-attempt counter on a successful login', async () => {
    const resetEmail = `lockout-reset-${Date.now()}@example.com`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: resetEmail, password });
    const userId = reg.body.data.user.id;

    await request(app).post('/api/auth/login').send({ email: resetEmail, password: 'wrong' });
    await request(app).post('/api/auth/login').send({ email: resetEmail, password: 'wrong' });

    const beforeSuccess = await prisma.user.findUnique({ where: { id: userId } });
    expect(beforeSuccess?.failedLoginAttempts).toBe(2);

    await request(app).post('/api/auth/login').send({ email: resetEmail, password });

    const afterSuccess = await prisma.user.findUnique({ where: { id: userId } });
    expect(afterSuccess?.failedLoginAttempts).toBe(0);

    await prisma.user.deleteMany({ where: { email: resetEmail } });
  });
});
