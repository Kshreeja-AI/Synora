import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig, getConfig } from '../../config';
import { getConsoleMailLog, clearConsoleMailLog } from '../../mail/transports/console.transport';

describe('users routes (account/profile settings — M3)', () => {
  let app: Express;
  const testEmails: string[] = [];
  const testUserIds: string[] = [];

  beforeAll(async () => {
    const config = await initConfig();
    app = createApp(config);
  });

  afterEach(async () => {
    if (testEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
      testEmails.length = 0;
    }
    for (const userId of testUserIds) {
      await rm(join(process.cwd(), getConfig().storage.localDirectory, 'avatars', userId), {
        recursive: true,
        force: true,
      });
    }
    testUserIds.length = 0;
    clearConsoleMailLog();
  });

  function uniqueEmail(prefix: string): string {
    const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    testEmails.push(email);
    return email;
  }

  function cookieHeader(setCookieHeaders: string | string[] | undefined): string {
    const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : setCookieHeaders ? [setCookieHeaders] : [];
    return cookies.map((c) => c.split(';')[0]).join('; ');
  }

  function extractCookieValue(setCookieHeaders: string | string[] | undefined, name: string): string {
    const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : setCookieHeaders ? [setCookieHeaders] : [];
    const header = cookies.find((c) => c.startsWith(`${name}=`));
    if (!header) throw new Error(`Cookie ${name} not found in Set-Cookie headers`);
    return header.split(';')[0].slice(name.length + 1);
  }

  async function register(prefix: string, password = 'a-valid-password-123') {
    const email = uniqueEmail(prefix);
    const res = await request(app).post('/api/auth/register').send({ email, password });
    const data = res.body.data as { user: { id: string; email: string } };
    testUserIds.push(data.user.id);
    return {
      accessToken: cookieHeader(res.headers['set-cookie']),
      refreshToken: extractCookieValue(res.headers['set-cookie'], 'refreshToken'),
      user: data.user,
      email,
      password,
    };
  }

  describe('GET /api/users/me', () => {
    it('returns the profile with defaulted preferences and a boolean emailVerified', async () => {
      const user = await register('me');

      const res = await request(app).get('/api/users/me').set('Cookie', user.accessToken);

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe(user.email);
      expect(res.body.data.emailVerified).toBe(false);
      expect(res.body.data.preferences).toEqual({
        theme: 'AUTO',
        emailNotifications: true,
        pushNotifications: false,
        marketingEmails: false,
      });
    });

    it('rejects an unauthenticated request', async () => {
      const res = await request(app).get('/api/users/me');
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/users/me', () => {
    it('updates name and profile fields together', async () => {
      const user = await register('patch');

      const res = await request(app)
        .patch('/api/users/me')
        .set('Cookie', user.accessToken)
        .send({ name: 'Ada Lovelace', bio: 'Builds things.', website: 'https://example.com', location: 'London' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Ada Lovelace');
      expect(res.body.data.profile).toEqual({
        bio: 'Builds things.',
        website: 'https://example.com',
        location: 'London',
      });
    });

    it('rejects an invalid website URL with 400', async () => {
      const user = await register('patch-invalid');

      const res = await request(app)
        .patch('/api/users/me')
        .set('Cookie', user.accessToken)
        .send({ website: 'not-a-url' });

      expect(res.status).toBe(400);
    });
  });

  describe('avatar upload/removal', () => {
    it('uploads an avatar and sets it as the user image', async () => {
      const user = await register('avatar');

      const res = await request(app)
        .post('/api/users/me/avatar')
        .set('Cookie', user.accessToken)
        .attach('avatar', Buffer.from('fake-png-bytes'), { filename: 'avatar.png', contentType: 'image/png' });

      expect(res.status).toBe(200);
      expect(res.body.data.image).toMatch(/\/uploads\/avatars\//);

      const me = await request(app).get('/api/users/me').set('Cookie', user.accessToken);
      expect(me.body.data.image).toBe(res.body.data.image);
    });

    it('rejects an unsupported file type', async () => {
      const user = await register('avatar-bad-type');

      const res = await request(app)
        .post('/api/users/me/avatar')
        .set('Cookie', user.accessToken)
        .attach('avatar', Buffer.from('not an image'), { filename: 'file.txt', contentType: 'text/plain' });

      expect(res.status).toBe(400);
    });

    it('rejects a request with no file', async () => {
      const user = await register('avatar-missing');

      const res = await request(app)
        .post('/api/users/me/avatar')
        .set('Cookie', user.accessToken);

      expect(res.status).toBe(400);
    });

    it('replacing an avatar deletes the previous file', async () => {
      const user = await register('avatar-replace');

      const first = await request(app)
        .post('/api/users/me/avatar')
        .set('Cookie', user.accessToken)
        .attach('avatar', Buffer.from('first-image'), { filename: 'a.png', contentType: 'image/png' });
      // Strip "<publicBasePath>/" (e.g. "/uploads/") from the returned URL to get the storage key.
      const firstKey = (first.body.data.image as string).split(`${getConfig().storage.publicBasePath}/`)[1];
      const firstAbsolutePath = join(process.cwd(), getConfig().storage.localDirectory, firstKey);

      await request(app)
        .post('/api/users/me/avatar')
        .set('Cookie', user.accessToken)
        .attach('avatar', Buffer.from('second-image'), { filename: 'b.png', contentType: 'image/png' });

      const { readFile } = await import('node:fs/promises');
      await expect(readFile(firstAbsolutePath)).rejects.toThrow();
    });

    it('removes the avatar', async () => {
      const user = await register('avatar-remove');
      await request(app)
        .post('/api/users/me/avatar')
        .set('Cookie', user.accessToken)
        .attach('avatar', Buffer.from('image-bytes'), { filename: 'avatar.png', contentType: 'image/png' });

      const res = await request(app)
        .delete('/api/users/me/avatar')
        .set('Cookie', user.accessToken);
      expect(res.status).toBe(200);

      const me = await request(app).get('/api/users/me').set('Cookie', user.accessToken);
      expect(me.body.data.image).toBeNull();
    });
  });

  describe('POST /api/users/me/password', () => {
    it('changes the password, keeps the current session, and revokes others', async () => {
      const user = await register('changepw', 'the-old-password-123');
      const otherLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: user.password });
      const otherRefreshToken = extractCookieValue(otherLogin.headers['set-cookie'], 'refreshToken');

      const res = await request(app)
        .post('/api/users/me/password')
        .set('Cookie', user.accessToken)
        .send({ currentPassword: user.password, newPassword: 'the-new-password-456' });
      expect(res.status).toBe(200);

      // The other device's session is revoked...
      const otherRefresh = await request(app).post('/api/auth/refresh').send({ refreshToken: otherRefreshToken });
      expect(otherRefresh.status).toBe(401);

      // ...but the current session's own refresh token still works.
      const ownRefresh = await request(app).post('/api/auth/refresh').send({ refreshToken: user.refreshToken });
      expect(ownRefresh.status).toBe(200);

      // Old password no longer logs in; new password does.
      const oldLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: user.password });
      expect(oldLogin.status).toBe(400);
      const newLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: 'the-new-password-456' });
      expect(newLogin.status).toBe(200);

      expect(getConsoleMailLog().some((m) => m.subject.match(/changed/i))).toBe(true);
    });

    it('rejects an incorrect current password', async () => {
      const user = await register('changepw-wrong');

      const res = await request(app)
        .post('/api/users/me/password')
        .set('Cookie', user.accessToken)
        .send({ currentPassword: 'totally-wrong-password', newPassword: 'the-new-password-456' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET/PATCH /api/users/me/preferences', () => {
    it('creates preferences on first PATCH and persists them', async () => {
      const user = await register('prefs');

      const patchRes = await request(app)
        .patch('/api/users/me/preferences')
        .set('Cookie', user.accessToken)
        .send({ theme: 'LIGHT', marketingEmails: true });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.theme).toBe('LIGHT');
      expect(patchRes.body.data.marketingEmails).toBe(true);

      const getRes = await request(app)
        .get('/api/users/me/preferences')
        .set('Cookie', user.accessToken);
      expect(getRes.body.data.theme).toBe('LIGHT');
    });
  });

  describe('DELETE /api/users/me (account deletion)', () => {
    it('soft-deletes the account, revokes sessions, and frees the email for reuse', async () => {
      const user = await register('delete', 'a-valid-password-123');

      const res = await request(app)
        .delete('/api/users/me')
        .set('Cookie', user.accessToken)
        .send({ password: user.password });
      expect(res.status).toBe(200);

      const refreshAttempt = await request(app).post('/api/auth/refresh').send({ refreshToken: user.refreshToken });
      expect(refreshAttempt.status).toBe(401);

      const loginAttempt = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: user.password });
      expect(loginAttempt.status).toBe(400);

      // The original email is free again for a brand-new registration.
      const reRegister = await request(app)
        .post('/api/auth/register')
        .send({ email: user.email, password: 'a-different-password-789' });
      expect(reRegister.status).toBe(201);
      testUserIds.push(reRegister.body.data.user.id);

      expect(getConsoleMailLog().some((m) => m.subject.match(/deleted/i))).toBe(true);
    });

    it('rejects an incorrect password confirmation', async () => {
      const user = await register('delete-wrong');

      const res = await request(app)
        .delete('/api/users/me')
        .set('Cookie', user.accessToken)
        .send({ password: 'not-the-right-password' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/users/:id (public profile)', () => {
    it('returns a limited public view without email or role', async () => {
      const user = await register('public');

      const res = await request(app).get(`/api/users/${user.user.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(user.user.id);
      expect(res.body.data.email).toBeUndefined();
      expect(res.body.data.role).toBeUndefined();
    });

    it('returns 404 for an unknown user id', async () => {
      const res = await request(app).get('/api/users/not-a-real-id');
      expect(res.status).toBe(404);
    });
  });
});
