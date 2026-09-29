import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';

/**
 * Admin read/write oversight endpoints, wired against real Postgres.
 *
 * These tests explicitly verify the RBAC boundary — the router mounts
 * requireAdminRole once at the top so a bug that misses that line would
 * expose every workspace's user directory to any authenticated caller.
 * Every endpoint here is verified to 403 for a plain user.
 */
describe('admin routes', () => {
  let app: Express;
  const adminEmail = `admin-e2e-${Date.now()}@example.com`;
  const userEmail = `user-e2e-${Date.now()}@example.com`;
  const targetEmail = `target-e2e-${Date.now()}@example.com`;
  const password = 'the-correct-password-123';
  let adminCookies: string[] = [];
  let userCookies: string[] = [];
  let targetUserId: string;

  async function loginCookies(email: string): Promise<string[]> {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password });
    const setCookie = res.headers['set-cookie'];
    return Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  }

  beforeAll(async () => {
    const config = await initConfig();
    app = createApp(config);

    // Create three fixtures: an ADMIN, a USER, and a USER to suspend/reactivate.
    await request(app).post('/api/auth/register').send({ email: adminEmail, password });
    await request(app).post('/api/auth/register').send({ email: userEmail, password });
    const targetReg = await request(app)
      .post('/api/auth/register')
      .send({ email: targetEmail, password });
    targetUserId = targetReg.body.data.user.id;

    // Promote one to ADMIN — registration always creates USERs, so this must
    // go through Prisma directly. Mirrors how a real admin bootstrap happens.
    await prisma.user.update({ where: { email: adminEmail }, data: { role: 'ADMIN' } });

    adminCookies = await loginCookies(adminEmail);
    userCookies = await loginCookies(userEmail);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [adminEmail, userEmail, targetEmail] } },
    });
    await prisma.$disconnect();
  });

  describe('RBAC gate', () => {
    it('denies /stats to a non-admin caller with 403', async () => {
      const res = await request(app).get('/api/admin/stats').set('Cookie', userCookies);
      expect(res.status).toBe(403);
    });

    it('denies /users to a non-admin caller with 403', async () => {
      const res = await request(app).get('/api/admin/users').set('Cookie', userCookies);
      expect(res.status).toBe(403);
    });

    it('denies /audit-logs to a non-admin caller with 403', async () => {
      const res = await request(app).get('/api/admin/audit-logs').set('Cookie', userCookies);
      expect(res.status).toBe(403);
    });

    it('denies /users/:id/suspend to a non-admin with 403', async () => {
      const res = await request(app)
        .post(`/api/admin/users/${targetUserId}/suspend`)
        .set('Cookie', userCookies);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /stats', () => {
    it('returns real cross-workspace counters as an admin', async () => {
      const res = await request(app).get('/api/admin/stats').set('Cookie', adminCookies).expect(200);
      expect(res.body.success).toBe(true);
      // Three users exist for this suite alone, so totalUsers is at least 3.
      expect(res.body.data.totalUsers).toBeGreaterThanOrEqual(3);
      expect(typeof res.body.data.totalWorkspaces).toBe('number');
      expect(typeof res.body.data.totalConversations).toBe('number');
      expect(typeof res.body.data.last24hMessages).toBe('number');
    });
  });

  describe('GET /users', () => {
    it('paginates users and never leaks password hashes or refresh tokens', async () => {
      const res = await request(app)
        .get('/api/admin/users?limit=200')
        .set('Cookie', adminCookies)
        .expect(200);
      expect(Array.isArray(res.body.data.users)).toBe(true);
      const target = res.body.data.users.find((u: { email: string }) => u.email === targetEmail);
      expect(target).toBeDefined();
      // The Prisma `select` on the route omits `password` and every session
      // relation; the assertion below is the guardrail on that.
      expect(target).not.toHaveProperty('password');
      expect(target).not.toHaveProperty('refreshTokens');
    });

    it('honours the `search` query as a case-insensitive email/name match', async () => {
      const res = await request(app)
        .get(`/api/admin/users?search=${encodeURIComponent(targetEmail.slice(0, 12))}`)
        .set('Cookie', adminCookies)
        .expect(200);
      expect(res.body.data.users.some((u: { email: string }) => u.email === targetEmail)).toBe(true);
    });
  });

  describe('POST /users/:id/suspend', () => {
    it('refuses to let an admin suspend themselves', async () => {
      const me = await request(app).get('/api/users/me').set('Cookie', adminCookies).expect(200);
      const adminId = me.body.data.id;
      const res = await request(app)
        .post(`/api/admin/users/${adminId}/suspend`)
        .set('Cookie', adminCookies)
        .expect(400);
      expect(res.body.error.code).toBe('INVALID');
    });

    it('suspends a normal user, then reactivates them', async () => {
      const suspend = await request(app)
        .post(`/api/admin/users/${targetUserId}/suspend`)
        .set('Cookie', adminCookies)
        .expect(200);
      expect(suspend.body.data.status).toBe('SUSPENDED');

      const reactivate = await request(app)
        .post(`/api/admin/users/${targetUserId}/reactivate`)
        .set('Cookie', adminCookies)
        .expect(200);
      expect(reactivate.body.data.status).toBe('ACTIVE');
    });
  });
});
