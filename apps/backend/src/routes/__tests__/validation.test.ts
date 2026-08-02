import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';

/**
 * R1-b: every mutating route must reject malformed input with a 400
 * (VALIDATION_ERROR), never a 500. Before this, missing fields flowed into
 * Prisma and surfaced as opaque 500s (and a ZodError from an already-zod'd
 * route also 500'd, because the error handler mapped unknown errors to 500).
 */
describe('input validation on mutating routes (R1-b)', () => {
  let app: Express;
  let token: string;
  const email = `validation-user-${Date.now()}@example.com`;

  beforeAll(async () => {
    const config = await initConfig();
    app = createApp(config);

    // A real authenticated session: register, then use the accessToken cookie
    // set on the response (tokens are no longer returned in the JSON body —
    // see setAuthCookies in ../../routes/auth.ts).
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'a-valid-password-123' });
    token = (res.headers['set-cookie'] ?? []).map((c: string) => c.split(';')[0]).join('; ');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  const auth = () => ({ Cookie: token });

  describe('POST /api/auth/register (already zod-validated) now returns 400 not 500', () => {
    it('rejects an invalid email with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'not-an-email', password: 'a-valid-password-123' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a too-short password with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: `short-pw-${Date.now()}@example.com`, password: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/projects', () => {
    it('rejects a missing name with 400, not 500', async () => {
      const res = await request(app).post('/api/projects').set(auth()).send({ description: 'x' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an empty name with 400', async () => {
      const res = await request(app).post('/api/projects').set(auth()).send({ name: '' });

      expect(res.status).toBe(400);
    });

    it('accepts a valid body with 201', async () => {
      const res = await request(app)
        .post('/api/projects')
        .set(auth())
        .send({ name: 'My Project', description: 'desc' });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('My Project');
    });
  });

  describe('POST /api/documents', () => {
    it('rejects a missing title with 400, not 500', async () => {
      const res = await request(app)
        .post('/api/documents')
        .set(auth())
        .send({ content: 'body' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an invalid format enum value with 400', async () => {
      const res = await request(app)
        .post('/api/documents')
        .set(auth())
        .send({ title: 'T', content: 'body', format: 'NOT_A_FORMAT' });

      expect(res.status).toBe(400);
    });

    it('accepts a valid body with 201 and defaults the format', async () => {
      const res = await request(app)
        .post('/api/documents')
        .set(auth())
        .send({ title: 'Doc', content: 'hello' });

      expect(res.status).toBe(201);
      expect(res.body.data.format).toBe('MARKDOWN');
    });
  });

  describe('POST /api/images/generate', () => {
    it('rejects a missing prompt with 400, not 500', async () => {
      const res = await request(app).post('/api/images/generate').set(auth()).send({ width: 512 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a non-numeric width with 400 (no NaN reaching the database)', async () => {
      const res = await request(app)
        .post('/api/images/generate')
        .set(auth())
        .send({ prompt: 'a cat', width: 'huge' });

      expect(res.status).toBe(400);
    });

    it('accepts a valid body with 201', async () => {
      const res = await request(app)
        .post('/api/images/generate')
        .set(auth())
        .send({ prompt: 'a watercolor cat', width: 512, height: 512 });

      expect(res.status).toBe(201);
    });
  });

  describe('unauthenticated requests are rejected before validation', () => {
    it('returns 401 for a mutating route with no token', async () => {
      const res = await request(app).post('/api/projects').send({ name: 'x' });

      expect(res.status).toBe(401);
    });
  });
});
