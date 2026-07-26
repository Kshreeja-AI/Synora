import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';
import { getConsoleMailLog, clearConsoleMailLog } from '../../mail/transports/console.transport';

describe('notifications routes (M4)', () => {
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
    clearConsoleMailLog();
  });

  function uniqueEmail(prefix: string): string {
    const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    testEmails.push(email);
    return email;
  }

  function extractTokenFromLink(text: string): string {
    const match = /token=([^\s&]+)/.exec(text);
    if (!match) throw new Error(`No token found in mail body: ${text}`);
    return decodeURIComponent(match[1]);
  }

  async function register(prefix: string, password = 'a-valid-password-123') {
    const email = uniqueEmail(prefix);
    const res = await request(app).post('/api/auth/register').send({ email, password });
    const data = res.body.data as { accessToken: string; user: { id: string } };
    return { accessToken: data.accessToken, userId: data.user.id, email, password };
  }

  describe('GET /api/notifications', () => {
    it('returns an empty list and zero unread count for a fresh user', async () => {
      const user = await register('empty');

      const res = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.notifications).toEqual([]);
      expect(res.body.data.unreadCount).toBe(0);
    });

    it('requires authentication', async () => {
      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(401);
    });
  });

  describe('mark read / mark all read', () => {
    async function createTwoNotifications(userId: string) {
      await prisma.notification.createMany({
        data: [
          { userId, type: 'SYSTEM', title: 'First', body: 'First body' },
          { userId, type: 'SYSTEM', title: 'Second', body: 'Second body' },
        ],
      });
    }

    it('marks a single notification read and excludes it from the unread count', async () => {
      const user = await register('read-one');
      await createTwoNotifications(user.userId);

      const list = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${user.accessToken}`);
      expect(list.body.data.unreadCount).toBe(2);

      const targetId = list.body.data.notifications[0].id;
      const readRes = await request(app)
        .post(`/api/notifications/${targetId}/read`)
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect(readRes.status).toBe(200);
      expect(readRes.body.data.readAt).not.toBeNull();

      const countRes = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${user.accessToken}`);
      expect(countRes.body.data.unreadCount).toBe(1);
    });

    it('returns 404 for a notification belonging to another user', async () => {
      const owner = await register('other-owner');
      const stranger = await register('other-stranger');
      await createTwoNotifications(owner.userId);

      const list = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      const targetId = list.body.data.notifications[0].id;

      const res = await request(app)
        .post(`/api/notifications/${targetId}/read`)
        .set('Authorization', `Bearer ${stranger.accessToken}`);

      expect(res.status).toBe(404);
    });

    it('marks every notification read via read-all', async () => {
      const user = await register('read-all');
      await createTwoNotifications(user.userId);

      const res = await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.count).toBe(2);

      const countRes = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${user.accessToken}`);
      expect(countRes.body.data.unreadCount).toBe(0);
    });
  });

  describe('real event triggers', () => {
    it('creates a SECURITY notification when the password is changed', async () => {
      const user = await register('changed');

      const changeRes = await request(app)
        .post('/api/users/me/password')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ currentPassword: user.password, newPassword: 'a-brand-new-password-789' });
      expect(changeRes.status).toBe(200);

      const res = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect(res.body.data.notifications).toHaveLength(1);
      expect(res.body.data.notifications[0]).toMatchObject({ type: 'SECURITY', title: 'Password changed' });
    });

    it('creates a SECURITY notification when the password is reset via a forgot-password token', async () => {
      const user = await register('reset-notify');
      clearConsoleMailLog();

      await request(app).post('/api/auth/forgot-password').send({ email: user.email });
      const token = extractTokenFromLink(getConsoleMailLog()[0].text);

      const resetRes = await request(app)
        .post('/api/auth/reset-password')
        .send({ token, newPassword: 'yet-another-new-password' });
      expect(resetRes.status).toBe(200);

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: 'yet-another-new-password' });
      const accessToken = loginRes.body.data.accessToken as string;

      const res = await request(app).get('/api/notifications').set('Authorization', `Bearer ${accessToken}`);
      expect(res.body.data.notifications).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'SECURITY', title: 'Password reset' })])
      );
    });

    it('creates an ACCOUNT notification when the email is verified', async () => {
      const user = await register('verify-notify');
      const token = extractTokenFromLink(getConsoleMailLog()[0].text);

      const verifyRes = await request(app).post('/api/auth/verify-email').send({ token });
      expect(verifyRes.status).toBe(200);

      const res = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect(res.body.data.notifications).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'ACCOUNT', title: 'Email verified' })])
      );
    });
  });
});
