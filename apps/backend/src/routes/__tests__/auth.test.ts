import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import bcryptjs from 'bcryptjs';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';

/**
 * End-to-end proof (real Postgres, real HTTP route, no mocks) that the
 * Argon2 migration in password.service.ts actually behaves correctly when
 * driven through the real /api/auth routes, not just at the unit level:
 *   1. A brand-new registration is stored as an Argon2id hash.
 *   2. A user with a pre-existing legacy bcrypt hash (simulating everyone
 *      who signed up before this change) can still log in.
 *   3. That login transparently rewrites the stored hash to Argon2id, with
 *      no visible change to the caller and no forced password reset.
 *   4. The now-migrated user can log in again on the same password.
 */
describe('POST /api/auth/register and /api/auth/login — password hashing', () => {
  let app: Express;
  const testEmails: string[] = [];

  beforeAll(async () => {
    const config = await initConfig();
    app = createApp(config);
  });

  afterEach(async () => {
    if (testEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
      testEmails.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('stores a new registration as an Argon2id hash', async () => {
    const email = `argon2-register-${Date.now()}@example.com`;
    testEmails.push(email);

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'brand-new-password-123' });

    expect(res.status).toBe(201);

    const stored = await prisma.user.findUnique({ where: { email } });
    expect(stored?.password?.startsWith('$argon2id$')).toBe(true);
  });

  it('logs in a legacy-bcrypt user and transparently migrates their hash to Argon2id', async () => {
    const email = `legacy-bcrypt-${Date.now()}@example.com`;
    const password = 'legacy-user-password-456';
    testEmails.push(email);

    // Simulate a user who registered before this change: their hash was
    // produced by bcrypt directly, bypassing the app (as the old code path
    // would have done), so the migration is genuinely exercised end to end.
    const legacyHash = await bcryptjs.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, password: legacyHash },
    });

    const preMigration = await prisma.user.findUnique({ where: { id: user.id } });
    expect(preMigration?.password?.startsWith('$2')).toBe(true);

    const loginRes = await request(app).post('/api/auth/login').send({ email, password });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.accessToken).toBeDefined();
    expect(loginRes.body.data.refreshToken).toBeDefined();

    const postMigration = await prisma.user.findUnique({ where: { id: user.id } });
    expect(postMigration?.password?.startsWith('$argon2id$')).toBe(true);
    expect(postMigration?.password).not.toBe(legacyHash);

    // The migrated hash must still authenticate the same password.
    const secondLoginRes = await request(app).post('/api/auth/login').send({ email, password });
    expect(secondLoginRes.status).toBe(200);
  });

  it('rejects the wrong password against a legacy bcrypt hash without migrating it', async () => {
    const email = `legacy-wrong-pw-${Date.now()}@example.com`;
    const password = 'correct-password-789';
    testEmails.push(email);

    const legacyHash = await bcryptjs.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, password: legacyHash },
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'wrong-password' });

    expect(res.status).toBe(400);

    const unchanged = await prisma.user.findUnique({ where: { id: user.id } });
    expect(unchanged?.password).toBe(legacyHash);
  });

  describe('email enumeration resistance (login)', () => {
    it('returns an identical 400 + generic message for an unknown email and a wrong password', async () => {
      const email = `enum-known-${Date.now()}@example.com`;
      const password = 'the-real-password';
      testEmails.push(email);
      await request(app).post('/api/auth/register').send({ email, password });

      const unknownEmailRes = await request(app)
        .post('/api/auth/login')
        .send({ email: `enum-unknown-${Date.now()}@example.com`, password: 'whatever' });

      const wrongPasswordRes = await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'not-the-real-password' });

      // Same status, same error code, same message — nothing distinguishes
      // "this account does not exist" from "wrong password for this account".
      expect(unknownEmailRes.status).toBe(400);
      expect(wrongPasswordRes.status).toBe(400);
      expect(unknownEmailRes.body.error.code).toBe(wrongPasswordRes.body.error.code);
      expect(unknownEmailRes.body.error.message).toBe(wrongPasswordRes.body.error.message);
      expect(unknownEmailRes.body.error.message).toBe('Invalid email or password');
    });
  });

  it('does not rewrite an already-current Argon2id hash on login', async () => {
    const email = `already-migrated-${Date.now()}@example.com`;
    testEmails.push(email);

    await request(app).post('/api/auth/register').send({ email, password: 'already-modern-pw' });
    const afterRegister = await prisma.user.findUnique({ where: { email } });

    await request(app).post('/api/auth/login').send({ email, password: 'already-modern-pw' });
    const afterLogin = await prisma.user.findUnique({ where: { email } });

    expect(afterLogin?.password).toBe(afterRegister?.password);
  });
});
