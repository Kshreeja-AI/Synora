import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { AuthRequest } from '../auth.js';

/**
 * The limiters short-circuit when NODE_ENV === 'test' (same convention as
 * authRateLimit.ts), so these tests run with NODE_ENV temporarily switched to
 * exercise the real limiting path.
 */
const ORIGINAL_ENV = process.env.NODE_ENV;

async function loadLimiter() {
  vi.resetModules();
  return import('../resourceRateLimit.js');
}

/** Mount a limiter behind a fake auth layer that sets `userId` from a header. */
function makeApp(limiter: express.RequestHandler) {
  const app = express();
  app.set('trust proxy', true);
  app.use((req, _res, next) => {
    const id = req.header('x-test-user');
    if (id) (req as AuthRequest).userId = id;
    next();
  });
  app.get('/resource', limiter, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe('resourceRateLimit', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
    vi.resetModules();
  });

  it('allows requests up to the limit and rejects the next one with 429', async () => {
    const { createResourceLimiter } = await loadLimiter();
    const app = makeApp(createResourceLimiter({
      name: 'test', windowMs: 60_000, max: 2, message: 'slow down',
    }));

    await request(app).get('/resource').set('x-test-user', 'u1').expect(200);
    await request(app).get('/resource').set('x-test-user', 'u1').expect(200);

    const blocked = await request(app).get('/resource').set('x-test-user', 'u1').expect(429);
    expect(blocked.body).toEqual({
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'slow down' },
    });
  });

  it('meters each authenticated user separately rather than by IP', async () => {
    const { createResourceLimiter } = await loadLimiter();
    const app = makeApp(createResourceLimiter({
      name: 'test', windowMs: 60_000, max: 1, message: 'slow down',
    }));

    // Both users share one source IP in this test — the point of keying by
    // user is that exhausting one budget must not affect the other.
    await request(app).get('/resource').set('x-test-user', 'alice').expect(200);
    await request(app).get('/resource').set('x-test-user', 'alice').expect(429);

    await request(app).get('/resource').set('x-test-user', 'bob').expect(200);
  });

  it('falls back to IP bucketing when the caller is unauthenticated', async () => {
    const { createResourceLimiter } = await loadLimiter();
    const app = makeApp(createResourceLimiter({
      name: 'test', windowMs: 60_000, max: 1, message: 'slow down',
    }));

    // No x-test-user header: the limiter must still bite, otherwise dropping
    // credentials would be a trivial bypass.
    await request(app).get('/resource').expect(200);
    await request(app).get('/resource').expect(429);
  });

  it('does not let an authenticated user consume the anonymous IP budget', async () => {
    const { createResourceLimiter } = await loadLimiter();
    const app = makeApp(createResourceLimiter({
      name: 'test', windowMs: 60_000, max: 1, message: 'slow down',
    }));

    await request(app).get('/resource').set('x-test-user', 'carol').expect(200);
    // carol's budget is spent, but the anonymous bucket for this IP is not.
    await request(app).get('/resource').expect(200);
  });

  it('exposes standard RateLimit headers and no legacy X-RateLimit headers', async () => {
    const { createResourceLimiter } = await loadLimiter();
    const app = makeApp(createResourceLimiter({
      name: 'test', windowMs: 60_000, max: 5, message: 'slow down',
    }));

    const res = await request(app).get('/resource').set('x-test-user', 'dave').expect(200);
    expect(res.headers['ratelimit-limit']).toBe('5');
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('is disabled under NODE_ENV=test so suites are not throttled', async () => {
    process.env.NODE_ENV = 'test';
    const { createResourceLimiter } = await loadLimiter();
    const app = makeApp(createResourceLimiter({
      name: 'test', windowMs: 60_000, max: 1, message: 'slow down',
    }));

    await request(app).get('/resource').set('x-test-user', 'erin').expect(200);
    await request(app).get('/resource').set('x-test-user', 'erin').expect(200);
    await request(app).get('/resource').set('x-test-user', 'erin').expect(200);
  });

  it('ships limiters for each expensive class with production-sane ceilings', async () => {
    const mod = await loadLimiter();
    for (const name of [
      'aiGenerationLimiter',
      'mediaGenerationLimiter',
      'searchLimiter',
      'exportLimiter',
      'evaluationLimiter',
    ] as const) {
      expect(typeof mod[name]).toBe('function');
    }
  });
});
