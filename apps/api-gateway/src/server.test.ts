import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { config } from './config.js';
import { rootLogger } from './logger.js';
import { buildServer } from './server.js';

describe('api-gateway server', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer({ config, logger: rootLogger });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health responds without needing any external service', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: { status: 'ok', version: config.app.version },
    });
  });

  it('GET /unknown-route returns a 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/unknown-route' });
    expect(response.statusCode).toBe(404);
  });

  it('POST /tasks is registered by the example-task plugin (fails gracefully with no Postgres reachable)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: { title: 'Write docs' },
    });

    // No live Postgres in this test environment: the InfrastructureError -> 502 mapping is
    // itself what we're verifying here (the plugin's route exists and errors are handled,
    // not crashed on). Against a real database this would be 201 — see plugins/example-task's
    // own use-case tests for that path with a fake repository.
    expect([201, 502]).toContain(response.statusCode);
  });
});
