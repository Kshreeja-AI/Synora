import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../config', () => ({ getConfig: () => ({ stage: 'production' }) }));
vi.mock('../../monitoring/sentry', () => ({ captureException: vi.fn() }));
vi.mock('../../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { mountBodyParsers, DEFAULT_BODY_LIMIT, LARGE_BODY_LIMIT, LARGE_BODY_PATHS } from '../bodyLimits';
import { errorHandler } from '../errorHandler';

function makeApp() {
  const app = express();
  mountBodyParsers(app);
  const echo: express.RequestHandler = (req, res) => res.json({ bytes: JSON.stringify(req.body).length });
  app.post('/api/projects', echo);
  app.post('/api/documents', echo);
  app.post('/api/documents/:id/content', echo);
  app.use(errorHandler);
  return app;
}

const json = (bytes: number) => JSON.stringify({ text: 'x'.repeat(bytes) });

describe('request body limits', () => {
  it('uses small defaults', () => {
    expect(DEFAULT_BODY_LIMIT).toBe('100kb');
    expect(LARGE_BODY_LIMIT).toBe('2mb');
    expect(LARGE_BODY_PATHS).toEqual(['/api/documents']);
  });

  it('accepts a normal JSON body on an ordinary route', async () => {
    const res = await request(makeApp()).post('/api/projects').set('Content-Type', 'application/json').send(json(5_000));
    expect(res.status).toBe(200);
  });

  it('accepts just under 100kb on an ordinary route', async () => {
    const res = await request(makeApp()).post('/api/projects').set('Content-Type', 'application/json').send(json(90_000));
    expect(res.status).toBe(200);
  });

  it('rejects a body over 100kb on an ordinary route with 413, not 500', async () => {
    const res = await request(makeApp()).post('/api/projects').set('Content-Type', 'application/json').send(json(150_000));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects the old 10mb-scale body outright', async () => {
    const res = await request(makeApp()).post('/api/projects').set('Content-Type', 'application/json').send(json(5_000_000));
    expect(res.status).toBe(413);
  });

  it('lets document routes take a body over 100kb', async () => {
    const res = await request(makeApp()).post('/api/documents').set('Content-Type', 'application/json').send(json(500_000));
    expect(res.status).toBe(200);
    const nested = await request(makeApp()).post('/api/documents/abc/content').set('Content-Type', 'application/json').send(json(500_000));
    expect(nested.status).toBe(200);
  });

  it('still caps document routes at 2mb', async () => {
    const res = await request(makeApp()).post('/api/documents').set('Content-Type', 'application/json').send(json(3_000_000));
    expect(res.status).toBe(413);
  });

  it('limits urlencoded bodies the same way', async () => {
    const big = 'a=' + 'x'.repeat(150_000);
    const res = await request(makeApp()).post('/api/projects').set('Content-Type', 'application/x-www-form-urlencoded').send(big);
    expect(res.status).toBe(413);
  });

  it('answers malformed JSON with 400, not 500', async () => {
    const res = await request(makeApp()).post('/api/projects').set('Content-Type', 'application/json').send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BODY');
  });
});
