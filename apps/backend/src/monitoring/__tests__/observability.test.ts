import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('metrics', () => {
  it('serves the Prometheus registry with default process metrics', async () => {
    const { renderMetrics } = await import('../metrics');
    const { contentType, body } = await renderMetrics();

    expect(contentType).toContain('text/plain');
    expect(body).toContain('synora_process_cpu_user_seconds_total');
    expect(body).toContain('synora_http_request_duration_seconds');
  });

  it('observes request durations labelled by route pattern, not by raw path', async () => {
    const { metricsMiddleware, renderMetrics } = await import('../metrics');

    const app = express();
    app.use(metricsMiddleware);
    // Two different ids, one route pattern — must produce ONE label value.
    app.get('/api/things/:id', (_req, res) => {
      res.json({ ok: true });
    });

    await request(app).get('/api/things/abc-123').expect(200);
    await request(app).get('/api/things/def-456').expect(200);

    const { body } = await renderMetrics();
    expect(body).toContain('route="/api/things/:id"');
    expect(body).not.toContain('abc-123');
    expect(body).not.toContain('def-456');
  });

  it('buckets unmatched paths together so scans cannot explode cardinality', async () => {
    const { metricsMiddleware, renderMetrics } = await import('../metrics');

    const app = express();
    app.use(metricsMiddleware);

    await request(app).get('/probe-1-xyzzy').expect(404);
    await request(app).get('/probe-2-plugh').expect(404);

    const { body } = await renderMetrics();
    expect(body).not.toContain('probe-1-xyzzy');
    expect(body).not.toContain('probe-2-plugh');
  });

  it('records AI provider spend counters with provider and direction labels', async () => {
    const { aiTokensTotal, aiProviderCallsTotal, renderMetrics } = await import('../metrics');

    aiProviderCallsTotal.inc({ provider: 'test-provider', outcome: 'completed' });
    aiTokensTotal.inc({ provider: 'test-provider', direction: 'input' }, 120);
    aiTokensTotal.inc({ provider: 'test-provider', direction: 'output' }, 340);

    const { body } = await renderMetrics();
    expect(body).toMatch(/synora_ai_tokens_total\{provider="test-provider",direction="input"\} 120/);
    expect(body).toMatch(/synora_ai_tokens_total\{provider="test-provider",direction="output"\} 340/);
  });
});

describe('sentry', () => {
  beforeEach(async () => {
    const { resetSentryForTests } = await import('../sentry');
    resetSentryForTests();
    delete process.env.SENTRY_DSN;
  });

  it('stays disabled and no-ops without a DSN', async () => {
    const { initializeSentry, isSentryEnabled, captureException } = await import('../sentry');

    initializeSentry();
    expect(isSentryEnabled()).toBe(false);
    // Must not throw even though nothing is initialized.
    captureException(new Error('boom'));
  });

  it('initializes when a DSN is provided', async () => {
    const { initializeSentry, isSentryEnabled, resetSentryForTests } = await import('../sentry');

    // A syntactically valid dummy DSN — @sentry/node validates the format but
    // performs no network I/O at init time.
    initializeSentry('https://00000000000000000000000000000000@o0.ingest.sentry.io/0');
    expect(isSentryEnabled()).toBe(true);
    resetSentryForTests();
  });
});

describe('tracing', () => {
  afterEach(async () => {
    const { resetTracingForTests } = await import('../tracing');
    resetTracingForTests();
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  it('stays disabled without an OTLP endpoint and the middleware passes through', async () => {
    const { initializeTracing, isTracingEnabled, tracingMiddleware } = await import('../tracing');

    initializeTracing();
    expect(isTracingEnabled()).toBe(false);

    const app = express();
    app.use(tracingMiddleware);
    app.get('/ok', (_req, res) => {
      res.json({ ok: true });
    });
    await request(app).get('/ok').expect(200);
  });

  it('registers a tracer provider when an endpoint is configured', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    const { initializeTracing, isTracingEnabled, getTracer, shutdownTracing } = await import('../tracing');

    initializeTracing();
    expect(isTracingEnabled()).toBe(true);
    expect(getTracer()).toBeDefined();

    // Requests still succeed with tracing on (spans batched, nothing sent
    // synchronously, so no collector is needed for this test).
    const { tracingMiddleware } = await import('../tracing');
    const app = express();
    app.use(tracingMiddleware);
    app.get('/traced', (_req, res) => {
      res.json({ ok: true });
    });
    await request(app).get('/traced').expect(200);

    await shutdownTracing();
  });
});
