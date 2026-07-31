import * as Sentry from '@sentry/node';
import type { AppConfig } from '../config/types';

export function initializeSentry(config: AppConfig): void {
  if (!config.monitoring.sentryDsn) {
    console.warn('[monitoring] Sentry DSN not configured - error tracking disabled');
    return;
  }

  Sentry.init({
    dsn: config.monitoring.sentryDsn,
    environment: config.env,
    tracesSampleRate: config.env === 'production' ? 0.1 : 1.0,
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.OnUncaughtException(),
      new Sentry.Integrations.OnUnhandledRejection(),
    ],
    beforeSend(event) {
      // Filter out health checks and readiness checks
      if (event.request?.url?.includes('/health') || event.request?.url?.includes('/ready')) {
        return null;
      }
      return event;
    },
  });

  console.log('[monitoring] Sentry initialized with DSN:', config.monitoring.sentryDsn);
}

export function captureException(error: unknown, context?: Record<string, any>): void {
  if (context) {
    Sentry.captureException(error, { extra: context });
  } else {
    Sentry.captureException(error);
  }
}
