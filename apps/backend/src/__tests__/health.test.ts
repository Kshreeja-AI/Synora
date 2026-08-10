import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../app';
import { initConfig } from '../config';

/**
 * Exercises the real Express app (via createApp, no listening socket bound)
 * to verify /health (liveness) and /ready (readiness) behave as an
 * orchestrator depends on:
 *  - /health never depends on the database, so a DB outage doesn't cause a
 *    liveness-triggered restart loop on top of an existing DB outage.
 *  - /ready reflects actual ability to serve traffic, including going
 *    unready (503) when the database is unreachable.
 */
describe('health and readiness endpoints', () => {
  let app: Express;

  beforeAll(async () => {
    const config = await initConfig();
    app = createApp(config);
    // Warm the Prisma engine before asserting readiness. /ready's contract
    // is "ready when the database is reachable", enforced with a 2s probe
    // timeout that assumes a warm pool — which production has, because the
    // server connects at boot. A cold first connection on a slow machine
    // can exceed 2s on its own, and without this warm-up the test measures
    // engine start-up time instead of the contract.
    await prisma.$queryRaw`SELECT 1`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('GET /health', () => {
    it('returns 200 and liveness fields without touching the database', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.timestamp).toBeDefined();
      expect(res.body.stage).toBeDefined();
      expect(res.body.modes).toBeDefined();
      // /health must not report a `checks` block — that's /ready's contract.
      expect(res.body.checks).toBeUndefined();
    });
  });

  describe('GET /ready', () => {
    it('returns 200 with an ok database check when the database is reachable', async () => {
      const res = await request(app).get('/ready');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
      expect(res.body.checks.database.status).toBe('ok');
      expect(typeof res.body.checks.database.latencyMs).toBe('number');
    });

    it('returns 503 with an error database check when the database is unreachable', async () => {
      // Inject a failing probe via the same seam production wiring uses, so
      // this exercises the actual /ready route's failure branch rather than
      // a parallel construct.
      const config = await initConfig();
      const appWithBrokenDb = createApp(config, {
        checkDatabase: () => Promise.reject(new Error('connection refused')),
      });

      const res = await request(appWithBrokenDb).get('/ready');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('not_ready');
      expect(res.body.checks.database.status).toBe('error');
      expect(res.body.checks.database.error).toContain('connection refused');
    });

    it('returns 503 when the database probe exceeds the timeout budget', async () => {
      const config = await initConfig();
      const appWithSlowDb = createApp(config, {
        checkDatabase: () => new Promise(() => undefined), // never resolves
      });

      const res = await request(appWithSlowDb).get('/ready');

      expect(res.status).toBe(503);
      expect(res.body.checks.database.error).toContain('timed out');
    }, 5000);
  });
});
