import { randomBytes } from 'crypto';
import { logger } from '../utils/logger';

/**
 * Lightweight structured tracing for the vector DB subsystem: no external
 * APM/tracing backend dependency, just span start/end events through the
 * existing Winston logger with a generated span id and duration. Mirrors
 * `../embeddings/tracing.ts` — kept as an independent copy, the same way
 * `../ai`, `../queue`, and `../embeddings` are independent siblings.
 */
export interface Span {
  readonly spanId: string;
  readonly name: string;
  readonly startedAt: number;
  readonly attributes: Record<string, unknown>;
}

export function startSpan(name: string, attributes: Record<string, unknown> = {}): Span {
  const span: Span = { spanId: randomBytes(8).toString('hex'), name, startedAt: Date.now(), attributes };
  logger.debug('[VectorDBTrace] span started', { spanId: span.spanId, name, ...attributes });
  return span;
}

export function endSpan(span: Span, extra: Record<string, unknown> = {}): void {
  logger.debug('[VectorDBTrace] span ended', {
    spanId: span.spanId,
    name: span.name,
    durationMs: Date.now() - span.startedAt,
    ...extra,
  });
}

export function endSpanWithError(span: Span, error: unknown): void {
  logger.debug('[VectorDBTrace] span ended with error', {
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
