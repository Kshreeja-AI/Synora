import { trace, context, SpanStatusCode, type Tracer } from '@opentelemetry/api';
import { NodeTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { normalizeRoute } from './metrics';

/**
 * OpenTelemetry distributed tracing.
 *
 * Credential-gated like Sentry: without OTEL_EXPORTER_OTLP_ENDPOINT no
 * provider is registered and the middleware costs one boolean check per
 * request. With an endpoint configured (any OTLP/HTTP collector — Grafana
 * Tempo, Jaeger, Honeycomb, a vendor agent), each API request becomes a span
 * carrying route, method, status and the correlation id, exported in batches.
 *
 * Deliberately manual instrumentation rather than the auto-instrumentation
 * meta-package: the request span is the unit operators actually alert on, and
 * the manual tracer keeps the dependency surface and startup cost small. Finer
 * spans (DB, provider calls) can be nested under it later via `getTracer()`.
 */

let provider: NodeTracerProvider | undefined;
let tracer: Tracer | undefined;

export function initializeTracing(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    logger.info('[monitoring] Tracing disabled — no OTEL_EXPORTER_OTLP_ENDPOINT configured');
    return;
  }
  if (provider) return;

  const serviceName = process.env.OTEL_SERVICE_NAME || 'synora-backend';
  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: process.env.SENTRY_RELEASE || '0.1.0',
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` })
      ),
    ],
  });
  provider.register();
  tracer = trace.getTracer(serviceName);
  logger.info('[monitoring] OpenTelemetry tracing initialized', { endpoint, serviceName });
}

export function isTracingEnabled(): boolean {
  return provider !== undefined;
}

/** The process tracer for nesting custom spans; undefined when disabled. */
export function getTracer(): Tracer | undefined {
  return tracer;
}

/**
 * Express middleware: one span per request, named `METHOD route`, closed on
 * response finish with the status code recorded. No-op when tracing is off.
 */
export function tracingMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!tracer) return next();

  const span = tracer.startSpan(`${req.method} ${req.path}`, {
    attributes: {
      'http.request.method': req.method,
      'url.path': req.path,
      'synora.correlation_id': (req.headers['x-correlation-id'] as string) ?? '',
    },
  });

  res.on('finish', () => {
    // The route pattern is only resolved after routing, so record it at
    // finish time; update the name too so trace UIs group by route.
    const route = normalizeRoute(req);
    span.updateName(`${req.method} ${route}`);
    span.setAttribute('http.route', route);
    span.setAttribute('http.response.status_code', res.statusCode);
    if (res.statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
    span.end();
  });

  context.with(trace.setSpan(context.active(), span), next);
}

/** Flush and stop the exporter on graceful shutdown. */
export async function shutdownTracing(): Promise<void> {
  if (!provider) return;
  await provider.shutdown();
  provider = undefined;
  tracer = undefined;
}

/** Test seam. */
export function resetTracingForTests(): void {
  provider = undefined;
  tracer = undefined;
}
