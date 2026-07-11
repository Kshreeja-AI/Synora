import { type Span as OtelSpan, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Span, Tracer } from '@synora/core';

class OtelSpanAdapter implements Span {
  constructor(private readonly span: OtelSpan) {}

  setAttribute(key: string, value: string | number | boolean): void {
    this.span.setAttribute(key, value);
  }

  recordException(error: Error): void {
    this.span.recordException(error);
  }

  end(status: 'ok' | 'error' = 'ok'): void {
    this.span.setStatus({ code: status === 'ok' ? SpanStatusCode.OK : SpanStatusCode.ERROR });
    this.span.end();
  }
}

/**
 * Thin wrapper over the OpenTelemetry API. Deliberately does not
 * register an SDK/exporter itself — the host process (apps/gateway)
 * bootstraps that once at startup, per environment (OTLP endpoint,
 * console, or none in tests). This package only ever depends on the
 * vendor-neutral @opentelemetry/api, so instrumented code never
 * couples to a specific backend.
 */
export function createTracer(instrumentationName: string): Tracer {
  const otelTracer = trace.getTracer(instrumentationName);

  return {
    async startSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
      return otelTracer.startActiveSpan(name, async (otelSpan) => {
        const span = new OtelSpanAdapter(otelSpan);
        try {
          const result = await fn(span);
          span.end('ok');
          return result;
        } catch (error) {
          span.recordException(error as Error);
          span.end('error');
          throw error;
        }
      });
    },
  };
}
