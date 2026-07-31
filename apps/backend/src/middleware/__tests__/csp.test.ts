import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { cspMiddleware } from '../csp';

describe('CSP Middleware', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(cspMiddleware);
    app.get('/test', (req, res) => {
      res.json({ ok: true });
    });
  });

  it('should set CSP header in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const response = await request(app).get('/test');

    expect(response.status).toBe(200);
    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");

    process.env.NODE_ENV = originalEnv;
  });

  it('should set CSP-Report-Only header in development', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const response = await request(app).get('/test');

    expect(response.status).toBe(200);
    expect(response.headers['content-security-policy-report-only']).toBeDefined();
    expect(response.headers['content-security-policy-report-only']).toContain("default-src 'self'");

    process.env.NODE_ENV = originalEnv;
  });

  it('should allow self-hosted scripts', async () => {
    const response = await request(app).get('/test');
    const csp = response.headers['content-security-policy-report-only'] ||
                 response.headers['content-security-policy'];
    expect(csp).toContain("script-src 'self'");
  });

  it('should allow self-hosted and inline styles', async () => {
    const response = await request(app).get('/test');
    const csp = response.headers['content-security-policy-report-only'] ||
                 response.headers['content-security-policy'];
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it('should allow self-hosted images and data URIs', async () => {
    const response = await request(app).get('/test');
    const csp = response.headers['content-security-policy-report-only'] ||
                 response.headers['content-security-policy'];
    expect(csp).toContain("img-src 'self' data: https:");
  });

  it('should restrict frame ancestors to none', async () => {
    const response = await request(app).get('/test');
    const csp = response.headers['content-security-policy-report-only'] ||
                 response.headers['content-security-policy'];
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('should restrict base URI to self', async () => {
    const response = await request(app).get('/test');
    const csp = response.headers['content-security-policy-report-only'] ||
                 response.headers['content-security-policy'];
    expect(csp).toContain("base-uri 'self'");
  });

  it('should restrict form action to self', async () => {
    const response = await request(app).get('/test');
    const csp = response.headers['content-security-policy-report-only'] ||
                 response.headers['content-security-policy'];
    expect(csp).toContain("form-action 'self'");
  });

  it('should block object embeds', async () => {
    const response = await request(app).get('/test');
    const csp = response.headers['content-security-policy-report-only'] ||
                 response.headers['content-security-policy'];
    expect(csp).toContain("object-src 'none'");
  });

  it('should upgrade insecure requests to HTTPS', async () => {
    const response = await request(app).get('/test');
    const csp = response.headers['content-security-policy-report-only'] ||
                 response.headers['content-security-policy'];
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('should allow HTTPS connections', async () => {
    const response = await request(app).get('/test');
    const csp = response.headers['content-security-policy-report-only'] ||
                 response.headers['content-security-policy'];
    expect(csp).toContain("connect-src 'self' https: wss: ws:");
  });
});
