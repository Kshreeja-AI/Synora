import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
} from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

/**
 * Prometheus metrics for the API process.
 *
 * One registry per process, exposed at GET /metrics (see app.ts). Everything
 * here is pull-based and dependency-free: no external agent is required, so
 * the endpoint is safe to enable everywhere — production Prometheus scrapes
 * it, and local curl works for debugging.
 */
export const metricsRegistry = new Registry();

collectDefaultMetrics({ register: metricsRegistry, prefix: 'synora_' });

/** Request duration, labelled by normalized route so cardinality stays bounded. */
export const httpRequestDuration = new Histogram({
  name: 'synora_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  // Web-latency oriented buckets: fast API calls to slow streaming setups.
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [metricsRegistry],
});

export const httpRequestsTotal = new Counter({
  name: 'synora_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [metricsRegistry],
});

/** Provider calls — the spend meter. Labelled by provider id and outcome. */
export const aiProviderCallsTotal = new Counter({
  name: 'synora_ai_provider_calls_total',
  help: 'AI provider calls by provider and outcome',
  labelNames: ['provider', 'outcome'] as const,
  registers: [metricsRegistry],
});

export const aiProviderCallDuration = new Histogram({
  name: 'synora_ai_provider_call_duration_seconds',
  help: 'AI provider call duration in seconds (full stream, first byte to close)',
  labelNames: ['provider'] as const,
  buckets: [0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
  registers: [metricsRegistry],
});

export const aiTokensTotal = new Counter({
  name: 'synora_ai_tokens_total',
  help: 'Tokens consumed by direction (input/output)',
  labelNames: ['provider', 'direction'] as const,
  registers: [metricsRegistry],
});

/** Background job outcomes across all BullMQ queues. */
export const queueJobsTotal = new Counter({
  name: 'synora_queue_jobs_total',
  help: 'Queue jobs by queue name and outcome',
  labelNames: ['queue', 'outcome'] as const,
  registers: [metricsRegistry],
});

export const queueJobDuration = new Histogram({
  name: 'synora_queue_job_duration_seconds',
  help: 'Queue job processing duration in seconds',
  labelNames: ['queue'] as const,
  buckets: [0.1, 0.5, 1, 5, 15, 60, 300, 900],
  registers: [metricsRegistry],
});

export const queueDepth = new Gauge({
  name: 'synora_queue_depth',
  help: 'Jobs currently waiting in each queue',
  labelNames: ['queue'] as const,
  registers: [metricsRegistry],
});

/**
 * Normalize a request path to its Express route pattern so metric label
 * cardinality is bounded by the number of routes, not the number of ids.
 * Falls back to a low-cardinality bucket for unmatched paths (404 scans
 * would otherwise mint one label value per probe).
 */
export function normalizeRoute(req: Request): string {
  const route = (req as Request & { route?: { path?: string } }).route?.path;
  if (route) return `${req.baseUrl || ''}${route}`;
  return req.baseUrl || 'unmatched';
}

/**
 * Express middleware: time every request into the histogram. Registered
 * before the routers so it observes everything, including 404s and errors.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const labels = {
      method: req.method,
      route: normalizeRoute(req),
      status_code: String(res.statusCode),
    };
    end(labels);
    httpRequestsTotal.inc(labels);
  });
  next();
}

/** Serialize the registry for the /metrics endpoint. */
export async function renderMetrics(): Promise<{ contentType: string; body: string }> {
  return {
    contentType: metricsRegistry.contentType,
    body: await metricsRegistry.metrics(),
  };
}
