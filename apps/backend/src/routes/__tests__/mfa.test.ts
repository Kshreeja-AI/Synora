import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';
import { TOTPService } from '../../services/mfa/totp.service';
import { ChallengeTokenService } from '../../services/mfa/challenge-token.service';

/**
 * End-to-end MFA: enrollment through the real routes, the login challenge
 * gate, and session establishment via POST /api/auth/mfa/verify — all against
 * real Postgres.
 */
describe('MFA end-to-end', () => {
  let app: Express;
  const password = 'the-correct-password-123';

  beforeAll(async () => {
    const config = await initConfig();
    app = createApp(config);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Register a fresh user and return an agent holding its auth cookies. */
  async function registerUser(label: string) {
    const email = `mfa-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/register').send({ email, password });
    expect(res.status).toBe(201);
    const user = await prisma.user.findUnique({ where: { email } });
    return { email, agent, userId: user!.id };
  }

  /** Drive the full enrollment flow so the account ends up with ACTIVE TOTP. */
  async function enroll(agent: ReturnType<typeof request.agent>) {
    const initiate = await agent.post('/api/auth/mfa/setup/initiate').send({});
    expect(initiate.status).toBe(200);
    const { setupToken, secret } = initiate.body.data;
    expect(secret).toBeTruthy();

    const verify = await agent
      .post('/api/auth/mfa/setup/verify')
      .send({ setupToken, code: TOTPService.getCurrentCode(secret) });
    expect(verify.status).toBe(200);
    const { recoveryCodes, codeHashes } = verify.body.data;
    expect(recoveryCodes.length).toBeGreaterThan(0);

    const confirm = await agent
      .post('/api/auth/mfa/setup/confirm')
      .send({ setupToken, recoveryCodes: codeHashes });
    expect(confirm.status).toBe(200);

    return { secret, recoveryCodes };
  }

  it('leaves login unchanged for accounts without MFA', async () => {
    const { email } = await registerUser('nomfa');

    const res = await request(app).post('/api/auth/login').send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.data.mfaRequired).toBeUndefined();
    expect(res.body.data.user.email).toBe(email);
    // Session cookies are set immediately — no second factor in the way.
    expect(String(res.headers['set-cookie'])).toContain('accessToken=');
  });

  it('reports status transitions across enrollment', async () => {
    const { agent } = await registerUser('status');

    const before = await agent.get('/api/auth/mfa/status');
    expect(before.status).toBe(200);
    expect(before.body.data.enabled).toBe(false);

    await enroll(agent);

    const after = await agent.get('/api/auth/mfa/status');
    expect(after.body.data.enabled).toBe(true);
    expect(after.body.data.status).toBe('ACTIVE');
    expect(after.body.data.recoveryCodesRemaining).toBeGreaterThan(0);
  });

  it('withholds tokens at login once MFA is enabled, then issues them after verify', async () => {
    const { email, agent } = await registerUser('gate');
    const { secret } = await enroll(agent);

    // Password alone must no longer establish a session.
    const login = await request(app).post('/api/auth/login').send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body.data.mfaRequired).toBe(true);
    expect(login.body.data.mfaChallengeToken).toBeTruthy();
    expect(login.body.data.user).toBeUndefined();
    expect(String(login.headers['set-cookie'] ?? '')).not.toContain('accessToken=');

    // Redeeming the challenge with a valid code completes the login.
    const verify = await request(app).post('/api/auth/mfa/verify').send({
      mfaChallengeToken: login.body.data.mfaChallengeToken,
      code: TOTPService.getCurrentCode(secret),
    });

    expect(verify.status).toBe(200);
    expect(verify.body.data.mfaVerified).toBe(true);
    expect(verify.body.data.user.email).toBe(email);
    expect(String(verify.headers['set-cookie'])).toContain('accessToken=');
  });

  it('rejects a wrong TOTP code and issues no session', async () => {
    const { email, agent } = await registerUser('wrongcode');
    const { secret } = await enroll(agent);

    const login = await request(app).post('/api/auth/login').send({ email, password });
    const wrong = TOTPService.getCurrentCode(secret) === '000000' ? '111111' : '000000';

    const verify = await request(app)
      .post('/api/auth/mfa/verify')
      .send({ mfaChallengeToken: login.body.data.mfaChallengeToken, code: wrong });

    expect(verify.status).toBeGreaterThanOrEqual(400);
    expect(String(verify.headers['set-cookie'] ?? '')).not.toContain('accessToken=');
  });

  it('accepts a recovery code and burns it so it cannot be reused', async () => {
    const { email, agent } = await registerUser('recovery');
    const { recoveryCodes } = await enroll(agent);
    const recoveryCode = recoveryCodes[0];

    const login = await request(app).post('/api/auth/login').send({ email, password });
    const first = await request(app)
      .post('/api/auth/mfa/verify')
      .send({ mfaChallengeToken: login.body.data.mfaChallengeToken, recoveryCode });

    expect(first.status).toBe(200);
    expect(first.body.data.mfaVerified).toBe(true);

    // The same code against a brand new challenge must now fail.
    const login2 = await request(app).post('/api/auth/login').send({ email, password });
    const second = await request(app)
      .post('/api/auth/mfa/verify')
      .send({ mfaChallengeToken: login2.body.data.mfaChallengeToken, recoveryCode });

    expect(second.status).toBeGreaterThanOrEqual(400);
  });

  it('treats a challenge token as single-use', async () => {
    const { email, agent } = await registerUser('replay');
    const { secret } = await enroll(agent);

    const login = await request(app).post('/api/auth/login').send({ email, password });
    const token = login.body.data.mfaChallengeToken;

    const first = await request(app)
      .post('/api/auth/mfa/verify')
      .send({ mfaChallengeToken: token, code: TOTPService.getCurrentCode(secret) });
    expect(first.status).toBe(200);

    // Replaying the consumed token must not mint a second session.
    const replay = await request(app)
      .post('/api/auth/mfa/verify')
      .send({ mfaChallengeToken: token, code: TOTPService.getCurrentCode(secret) });

    expect(replay.status).toBeGreaterThanOrEqual(400);
    expect(String(replay.headers['set-cookie'] ?? '')).not.toContain('accessToken=');
  });

  it('rejects an unknown challenge token', async () => {
    const res = await request(app)
      .post('/api/auth/mfa/verify')
      .send({ mfaChallengeToken: 'a'.repeat(64), code: '123456' });

    expect(res.status).toBe(401);
  });

  it('requires exactly one of code or recoveryCode', async () => {
    const { email, agent } = await registerUser('exclusive');
    const { secret, recoveryCodes } = await enroll(agent);
    const login = await request(app).post('/api/auth/login').send({ email, password });
    const token = login.body.data.mfaChallengeToken;

    const neither = await request(app)
      .post('/api/auth/mfa/verify')
      .send({ mfaChallengeToken: token });
    expect(neither.status).toBeGreaterThanOrEqual(400);

    const both = await request(app).post('/api/auth/mfa/verify').send({
      mfaChallengeToken: token,
      code: TOTPService.getCurrentCode(secret),
      recoveryCode: recoveryCodes[0],
    });
    expect(both.status).toBeGreaterThanOrEqual(400);
  });

  it('carries rememberMe across the second factor', async () => {
    const { email, agent } = await registerUser('remember');
    await enroll(agent);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email, password, rememberMe: true });

    const challenge = await ChallengeTokenService.verifyToken(login.body.data.mfaChallengeToken);
    expect(challenge).not.toBeNull();
    expect(challenge.rememberMe).toBe(true);
  });

  it('scopes a challenge token to its owner when a user id is supplied', async () => {
    const { email, agent } = await registerUser('scope');
    await enroll(agent);
    const other = await registerUser('scope-other');

    const login = await request(app).post('/api/auth/login').send({ email, password });
    const token = login.body.data.mfaChallengeToken;

    // Same-length cuid belonging to a different account must not validate.
    // crypto.timingSafeEqual returns false here rather than throwing, so a
    // check that ignored its result would wrongly accept this.
    expect(await ChallengeTokenService.verifyToken(token, other.userId)).toBeNull();
    expect(await ChallengeTokenService.verifyToken(token, login.body.data.userId ?? '')).toBeNull();
  });

  it('requires the account password to disable MFA', async () => {
    const { agent } = await registerUser('disable');
    await enroll(agent);

    const wrong = await agent.post('/api/auth/mfa/disable').send({ password: 'not-the-password' });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect((await agent.get('/api/auth/mfa/status')).body.data.enabled).toBe(true);

    const right = await agent.post('/api/auth/mfa/disable').send({ password });
    expect(right.status).toBe(200);
    expect((await agent.get('/api/auth/mfa/status')).body.data.enabled).toBe(false);
  });

  it('requires authentication for enrollment and management endpoints', async () => {
    for (const call of [
      request(app).get('/api/auth/mfa/status'),
      request(app).post('/api/auth/mfa/setup/initiate').send({}),
      request(app).get('/api/auth/mfa/recovery-codes'),
    ]) {
      expect((await call).status).toBe(401);
    }
  });
});
