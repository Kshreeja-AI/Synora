/**
 * Observability entrypoint: metrics (always on, pull-based), Sentry error
 * capture and OTEL tracing (both credential-gated no-ops until configured).
 */
import { initializeSentry, flushSentry } from './sentry';
import { initializeTracing, shutdownTracing } from './tracing';

export * from './metrics';
export * from './sentry';
export * from './tracing';

export function initObservability(): void {
  initializeSentry();
  initializeTracing();
}

export async function shutdownObservability(): Promise<void> {
  await Promise.allSettled([flushSentry(), shutdownTracing()]);
}
