import { randomBytes } from 'crypto';
import { logger } from '../utils/logger';

/**
 * Lightweight structured tracing, shared across provider-calling stacks.
 *
 * MOVED HERE FROM `embeddings/tracing.ts` (which now re-exports this file)
 * — unlike the rate limiter and metrics collector, this module was already
 * fully generic (no embeddings-specific concept anywhere in it), so it
 * needed no reshaping, only relocation.
 *
 * No external APM/tracing backend dependency: span start/end events go
 * through the existing Winston logger with a generated span id and
 * duration — the same "structured logging is the trace" approach
 * `../queue/audit.ts` and `../middleware/requestLogger.ts` already take
 * elsewhere in this codebase. A deployment that wants these correlated in
 * Jaeger/Honeycomb/Datadog can ship the resulting log lines to one, keyed
 * by `spanId`/`parentSpanId`, without any code change here.
 */
export interface Span {
  readonly spanId: string;
  readonly name: string;
  readonly startedAt: number;
  readonly attributes: Record<string, unknown>;
}

export function startSpan(name: string, attributes: Record<string, unknown> = {}): Span {
  const span: Span = { spanId: randomBytes(8).toString('hex'), name, startedAt: Date.now(), attributes };
  logger.debug('[Trace] span started', { spanId: span.spanId, name, ...attributes });
  return span;
}

export function endSpan(span: Span, extra: Record<string, unknown> = {}): void {
  logger.debug('[Trace] span ended', {
    spanId: span.spanId,
    name: span.name,
    durationMs: Date.now() - span.startedAt,
    ...extra,
  });
}

export function endSpanWithError(span: Span, error: unknown): void {
  logger.debug('[Trace] span ended with error', {
    spanId: span.spanId,
    name: span.name,
    durationMs: Date.now() - span.startedAt,
    error: error instanceof Error ? error.message : String(error),
  });
}

/** Runs `fn`, wrapping it in a span that always records success or failure. */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, unknown>,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const span = startSpan(name, attributes);
  try {
    const result = await fn(span);
    endSpan(span);
    return result;
  } catch (error) {
    endSpanWithError(span, error);
    throw error;
  }
}
