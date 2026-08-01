import { randomBytes } from 'crypto';
import { logger } from '../utils/logger';

/**
 * Lightweight structured tracing for the embeddings subsystem: no external
 * APM/tracing backend dependency, just span start/end events through the
 * existing Winston logger with a generated span id and duration — the same
 * "structured logging is the trace" approach `../queue/audit.ts` and
 * `../middleware/requestLogger.ts` already take elsewhere in this codebase.
 * A deployment that wants these correlated in Jaeger/Honeycomb/Datadog can
 * ship the resulting log lines to one, keyed by `spanId`/`parentSpanId`,
 * without any code change here.
 */
export interface Span {
  readonly spanId: string;
  readonly name: string;
  readonly startedAt: number;
  readonly attributes: Record<string, unknown>;
}

export function startSpan(name: string, attributes: Record<string, unknown> = {}): Span {
  const span: Span = { spanId: randomBytes(8).toString('hex'), name, startedAt: Date.now(), attributes };
  logger.debug('[EmbeddingTrace] span started', { spanId: span.spanId, name, ...attributes });
  return span;
}

export function endSpan(span: Span, extra: Record<string, unknown> = {}): void {
  logger.debug('[EmbeddingTrace] span ended', {
    spanId: span.spanId,
    name: span.name,
    durationMs: Date.now() - span.startedAt,
    ...extra,
  });
}

export function endSpanWithError(span: Span, error: unknown): void {
  logger.debug('[EmbeddingTrace] span ended with error', {
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
