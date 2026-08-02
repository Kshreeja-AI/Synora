import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';
import { getConsoleMailLog, clearConsoleMailLog } from '../../mail/transports/console.transport';

/**
 * Release 2 M3: forgot/reset password, email verification, session
 * management, remember-me — end to end through the real /api/auth routes
 * against real Postgres, using the console mail transport (the test-stage
 * default) to recover tokens the way a developer would from server logs.
 */
describe('auth account flows (M3)', () => {
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

  // Tokens are now issued as HttpOnly cookies, not in the JSON body (see
  // setAuthCookies in ../auth.ts). `cookieHeader` builds a `Cookie` header
  // value (both accessToken and refreshToken) suitable for `.set('Cookie', ...)`
  // on an authenticated request; `extractCookieValue` pulls out one cookie's
  // raw value for tests that need the literal token (e.g. to send it in a
  // request body, or to hash it for a DB lookup).
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

  async function register(email: string, password: string) {
    const res = await request(app).post('/api/auth/register').send({ email, password });
    return {
      accessToken: cookieHeader(res.headers['set-cookie']),
      refreshToken: extractCookieValue(res.headers['set-cookie'], 'refreshToken'),
      user: res.body.data.user as { id: string; email: string; emailVerified: boolean },
    };
  }

  describe('POST /api/auth/forgot-password', () => {
    it('returns an identical generic response for an unknown email (no enumeration)', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'never-registered@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.data.message).toMatch(/if an account exists/i);
      expect(getConsoleMailLog()).toHaveLength(0);
    });

    it('sends a reset email for a known email and returns the same generic response', async () => {
      const email = uniqueEmail('forgot');
      await register(email, 'a-valid-password-123');
      clearConsoleMailLog();

      const res = await request(app).post('/api/auth/forgot-password').send({ email });

      expect(res.status).toBe(200);
      expect(res.body.data.message).toMatch(/if an account exists/i);
      const log = getConsoleMailLog();
      expect(log).toHaveLength(1);
      expect(log[0].subject).toMatch(/reset/i);
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('resets the password, revokes existing sessions, and the new password logs in', async () => {
      const email = uniqueEmail('reset');
      const oldPassword = 'the-old-password-123';
      const newPassword = 'the-new-password-456';
      const registered = await register(email, oldPassword);
      clearConsoleMailLog();

      await request(app).post('/api/auth/forgot-password').send({ email });
      const token = extractTokenFromLink(getConsoleMailLog()[0].text);

      const resetRes = await request(app)
        .post('/api/auth/reset-password')
        .send({ token, newPassword });
      expect(resetRes.status).toBe(200);

      // The pre-reset refresh token must no longer work.
      const refreshAttempt = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: registered.refreshToken });
      expect(refreshAttempt.status).toBe(401);

      // Old password fails, new password succeeds.
      const oldLogin = await request(app).post('/api/auth/login').send({ email, password: oldPassword });
      expect(oldLogin.status).toBe(400);
      const newLogin = await request(app).post('/api/auth/login').send({ email, password: newPassword });
      expect(newLogin.status).toBe(200);
    });

    it('rejects an unknown or already-used token with 401', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'not-a-real-token', newPassword: 'whatever-password-1' });
      expect(res.status).toBe(401);
    });

    it('rejects a short new password with 400', async () => {
      const email = uniqueEmail('reset-short');
      await register(email, 'a-valid-password-123');
      clearConsoleMailLog();
      await request(app).post('/api/auth/forgot-password').send({ email });
      const token = extractTokenFromLink(getConsoleMailLog()[0].text);

      const res = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'short' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/verify-email and /api/auth/resend-verification', () => {
    it('registration issues a verification email and the token verifies the account', async () => {
      const email = uniqueEmail('verify');
      const registered = await register(email, 'a-valid-password-123');
      expect(registered.user.emailVerified).toBe(false);

      const log = getConsoleMailLog();
      expect(log).toHaveLength(1);
      expect(log[0].subject).toMatch(/verify/i);
      const token = extractTokenFromLink(log[0].text);

      const verifyRes = await request(app).post('/api/auth/verify-email').send({ token });
      expect(verifyRes.status).toBe(200);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user?.emailVerified).not.toBeNull();
    });

    it('rejects an invalid verification token with 401', async () => {
      const res = await request(app).post('/api/auth/verify-email').send({ token: 'bogus-token' });
      expect(res.status).toBe(401);
    });

    it('resend-verification requires auth and sends a fresh token', async () => {
      const email = uniqueEmail('resend');
      const registered = await register(email, 'a-valid-password-123');
      clearConsoleMailLog();

      const unauthed = await request(app).post('/api/auth/resend-verification');
      expect(unauthed.status).toBe(401);

      const res = await request(app)
        .post('/api/auth/resend-verification')
        .set('Cookie', registered.accessToken);
      expect(res.status).toBe(200);
      expect(getConsoleMailLog()).toHaveLength(1);
    });

    it('resend-verification reports already-verified without sending mail again', async () => {
      const email = uniqueEmail('resend-verified');
      const registered = await register(email, 'a-valid-password-123');
      const token = extractTokenFromLink(getConsoleMailLog()[0].text);
      await request(app).post('/api/auth/verify-email').send({ token });
      clearConsoleMailLog();

      const res = await request(app)
        .post('/api/auth/resend-verification')
        .set('Cookie', registered.accessToken);
      expect(res.status).toBe(200);
      expect(res.body.data.message).toMatch(/already verified/i);
      expect(getConsoleMailLog()).toHaveLength(0);
    });
  });

  describe('remember me', () => {
    it('gives a remember-me login a further-out refresh token expiry than a normal login', async () => {
      const email = uniqueEmail('remember');
      const password = 'a-valid-password-123';
      await register(email, password);

      const normal = await request(app).post('/api/auth/login').send({ email, password });
      const remembered = await request(app)
        .post('/api/auth/login')
        .send({ email, password, rememberMe: true });

      const { createHash } = await import('node:crypto');
      const normalHash = createHash('sha256')
        .update(extractCookieValue(normal.headers['set-cookie'], 'refreshToken'))
        .digest('hex');
      const rememberedHash = createHash('sha256')
        .update(extractCookieValue(remembered.headers['set-cookie'], 'refreshToken'))
        .digest('hex');

      const normalRecord = await prisma.refreshToken.findUnique({ where: { tokenHash: normalHash } });
      const rememberedRecord = await prisma.refreshToken.findUnique({
        where: { tokenHash: rememberedHash },
      });

      expect(rememberedRecord?.rememberMe).toBe(true);
      expect(normalRecord?.rememberMe).toBe(false);
      expect(rememberedRecord!.expiresAt.getTime()).toBeGreaterThan(normalRecord!.expiresAt.getTime());
    });
  });

  describe('GET/DELETE /api/auth/sessions and POST /api/auth/logout-all', () => {
    it('lists the current session and marks it isCurrent', async () => {
      const email = uniqueEmail('sessions-current');
      const registered = await register(email, 'a-valid-password-123');

      const res = await request(app)
        .get('/api/auth/sessions')
        .set('Cookie', registered.accessToken);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].isCurrent).toBe(true);
    });

    it('lists multiple devices and lets one be revoked without affecting the other', async () => {
      const email = uniqueEmail('sessions-multi');
      const password = 'a-valid-password-123';
      const deviceA = await register(email, password);
      const deviceBLogin = await request(app).post('/api/auth/login').send({ email, password });
      const deviceB = {
        accessToken: cookieHeader(deviceBLogin.headers['set-cookie']),
        refreshToken: extractCookieValue(deviceBLogin.headers['set-cookie'], 'refreshToken'),
      };

      const listRes = await request(app)
        .get('/api/auth/sessions')
        .set('Cookie', deviceA.accessToken);
      expect(listRes.body.data).toHaveLength(2);

      const otherSession = listRes.body.data.find((s: { isCurrent: boolean }) => !s.isCurrent);
      const revokeRes = await request(app)
        .delete(`/api/auth/sessions/${otherSession.id}`)
        .set('Cookie', deviceA.accessToken);
      expect(revokeRes.status).toBe(200);

      // Device B's refresh token no longer works; device A's still does.
      const refreshB = await request(app).post('/api/auth/refresh').send({ refreshToken: deviceB.refreshToken });
      expect(refreshB.status).toBe(401);
      const refreshA = await request(app).post('/api/auth/refresh').send({ refreshToken: deviceA.refreshToken });
      expect(refreshA.status).toBe(200);
    });

    it('returns 404 revoking a session that does not belong to the caller', async () => {
      const emailA = uniqueEmail('sessions-owner');
      const emailB = uniqueEmail('sessions-attacker');
      const userA = await register(emailA, 'a-valid-password-123');
      const userB = await register(emailB, 'a-valid-password-123');

      const sessionsA = await request(app)
        .get('/api/auth/sessions')
        .set('Cookie', userA.accessToken);
      const sessionId = sessionsA.body.data[0].id;

      const res = await request(app)
        .delete(`/api/auth/sessions/${sessionId}`)
        .set('Cookie', userB.accessToken);
      expect(res.status).toBe(404);
    });

    it('logout-all revokes every session, including the caller\'s own', async () => {
      const email = uniqueEmail('logout-all');
      const password = 'a-valid-password-123';
      const registered = await register(email, password);
      await request(app).post('/api/auth/login').send({ email, password });

      const res = await request(app)
        .post('/api/auth/logout-all')
        .set('Cookie', registered.accessToken);
      expect(res.status).toBe(200);
      expect(res.body.data.revokedCount).toBe(2);

      const refreshAttempt = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: registered.refreshToken });
      expect(refreshAttempt.status).toBe(401);
    });
  });
});
