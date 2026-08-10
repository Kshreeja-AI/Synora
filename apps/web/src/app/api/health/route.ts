import { NextResponse } from 'next/server';

/**
 * Is the web server itself alive?
 *
 * Deliberately the narrowest possible question. It answers for THIS
 * process only — it does not call the backend, touch a database, or render
 * a page. A probe that checked the backend too would report the frontend
 * as down during a backend restart, and a supervisor would then restart a
 * perfectly healthy web server, turning one outage into two.
 *
 * Probing `/` instead would work but costs a full React render of the
 * marketing page every few seconds, forever, on a one-core machine.
 *
 * `force-dynamic` because a health check that was statically generated at
 * build time would return 200 from a cached file even with the server
 * wedged — a probe that cannot fail is not a probe.
 */
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json({ status: 'ok', service: 'web' });
}
