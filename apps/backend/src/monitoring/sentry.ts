import * as Sentry from '@sentry/node';
import { logger } from '../utils/logger';

/**
 * Sentry error monitoring.
 *
 * Real @sentry/node integration, credential-gated: without SENTRY_DSN every
 * function here is a cheap no-op, so this module is safe to call
 * unconditionally from the error path in all environments. With a DSN set,
 * unhandled API errors and explicit captures are reported with release and
 * environment tags.
 */

let initialized = false;

export function initializeSentry(dsn?: string): void {
  const resolvedDsn = dsn ?? process.env.SENTRY_DSN;
  if (!resolvedDsn) {
    logger.info('[monitoring] Sentry disabled — no SENTRY_DSN configured');
    return;
  }
  if (initialized) return;

  Sentry.init({
    dsn: resolvedDsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE,
    // Error monitoring only by default. Trace sampling is opt-in via env so
    // Sentry tracing never silently competes with the OTEL pipeline
    // (see tracing.ts) — enable one, not both.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  });
  initialized = true;
  logger.info('[monitoring] Sentry initialized', {
    environment: process.env.NODE_ENV || 'development',
  });
}

export function isSentryEnabled(): boolean {
  return initialized;
}

/**
 * Capture an exception with optional structured context. No-op when Sentry
 * is not configured.
 */
export function captureException(
  error: Error,
  context?: Record<string, unknown>
): void {
  if (!initialized) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export function captureMessage(message: string): void {
  if (!initialized) return;
  Sentry.captureMessage(message);
}

/**
 * Flush pending events — call on graceful shutdown so buffered errors are not
 * lost when the process exits.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized) return;
  await Sentry.flush(timeoutMs);
}

/** Test seam: reset module state between unit tests. */
export function resetSentryForTests(): void {
  initialized = false;
}
