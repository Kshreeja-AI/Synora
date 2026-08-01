/**
 * Sentry monitoring — stubbed for Release 3
 *
 * Full Sentry integration with @sentry/node is reserved for Release 3.
 * Placeholder stubs exported for build compatibility.
 */

export function initializeSentry(_dsn?: string): void {
  // Stub: Sentry initialization disabled in Release 1/2
}

export function captureException(_error: Error): void {
  // Stub: Exception capturing disabled in Release 1/2
}

export function captureMessage(_message: string): void {
  // Stub: Message capturing disabled in Release 1/2
}

export const sentryMiddleware = {
  requestHandler: (_req: any, _res: any, next: any) => next(),
  errorHandler: (_err: any, _req: any, _res: any, next: any) => next(_err),
};
