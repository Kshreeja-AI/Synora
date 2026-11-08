import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * REGISTRATION_MODE gate on POST /api/auth/register, through the real router.
 * The database is mocked so this needs no Postgres; what it proves is the
 * ORDER: a refused registration never reaches the user lookup or user creation.
 */
const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  invitationFindFirst: vi.fn(),
}));

vi.mock('@synora/database', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique, create: mocks.userCreate },
    workspaceInvitation: { findFirst: mocks.invitationFindFirst },
  },
}));

import authRouter from '../auth';
import { ApiException } from '@synora/shared';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  // Minimal stand-in for the app's error middleware: honour ApiException status codes.
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ApiException) {
      res.status((error as unknown as { statusCode: number }).statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'unexpected' });
  });
  return app;
}

const body = { email: 'stranger@example.com', password: 'a-long-enough-password', name: 'S' };

describe('POST /api/auth/register — REGISTRATION_MODE', () => {
  const originalMode = process.env.REGISTRATION_MODE;
  const originalAllowlist = process.env.REGISTRATION_ALLOWLIST;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invitationFindFirst.mockResolvedValue(null);
    mocks.userFindUnique.mockResolvedValue(null);
    delete process.env.REGISTRATION_ALLOWLIST;
  });

  afterEach(() => {
    if (originalMode === undefined) delete process.env.REGISTRATION_MODE;
    else process.env.REGISTRATION_MODE = originalMode;
    if (originalAllowlist === undefined) delete process.env.REGISTRATION_ALLOWLIST;
    else process.env.REGISTRATION_ALLOWLIST = originalAllowlist;
  });

  it('refuses an uninvited email with 403 in invite mode, before any user lookup or creation', async () => {
    process.env.REGISTRATION_MODE = 'invite';
    const res = await request(makeApp()).post('/api/auth/register').send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Registration is by invitation only.');
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it('treats an unset mode as invite (closed by default)', async () => {
    delete process.env.REGISTRATION_MODE;
    const res = await request(makeApp()).post('/api/auth/register').send(body);
    expect(res.status).toBe(403);
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it('treats a mistyped mode as invite', async () => {
    process.env.REGISTRATION_MODE = 'opne';
    const res = await request(makeApp()).post('/api/auth/register').send(body);
    expect(res.status).toBe(403);
  });

  it('lets an allowlisted email past the gate (the request then reaches the user lookup)', async () => {
    process.env.REGISTRATION_MODE = 'invite';
    process.env.REGISTRATION_ALLOWLIST = 'stranger@example.com';
    mocks.userFindUnique.mockResolvedValue({ id: 'existing' }); // stop right after the gate: "already registered"
    const res = await request(makeApp()).post('/api/auth/register').send(body);
    expect(res.status).not.toBe(403);
    expect(mocks.userFindUnique).toHaveBeenCalledTimes(1);
  });

  it('lets an email with a live invitation past the gate', async () => {
    process.env.REGISTRATION_MODE = 'invite';
    mocks.invitationFindFirst.mockResolvedValue({ id: 'inv1' });
    mocks.userFindUnique.mockResolvedValue({ id: 'existing' });
    const res = await request(makeApp()).post('/api/auth/register').send(body);
    expect(res.status).not.toBe(403);
    expect(mocks.userFindUnique).toHaveBeenCalledTimes(1);
  });

  it('open mode does not consult invitations at all', async () => {
    process.env.REGISTRATION_MODE = 'open';
    mocks.userFindUnique.mockResolvedValue({ id: 'existing' });
    await request(makeApp()).post('/api/auth/register').send(body);
    expect(mocks.invitationFindFirst).not.toHaveBeenCalled();
  });
});
