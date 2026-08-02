import { PrismaClient } from '@prisma/client';

/**
 * Process-wide singleton PrismaClient.
 *
 * Every consumer in the platform MUST import `prisma` from this package
 * rather than constructing `new PrismaClient()`. A PrismaClient owns a
 * connection pool; constructing one per route/module multiplies pools and
 * exhausts Postgres `max_connections` under load, which manifests as
 * intermittent "too many clients already" errors and hard outages. A single
 * shared instance keeps one pool for the whole process.
 *
 * The `globalThis` guard prevents duplicate instances across module reloads
 * in watch/dev mode (tsx/Next.js hot reload re-evaluate modules), which would
 * otherwise leak pools during local development. In production the guard is a
 * no-op — the module is evaluated once.
 */
const globalForPrisma = globalThis as unknown as {
  __synoraPrisma__?: PrismaClient;
};

/**
 * Ensures the connection pool is explicitly bounded. Prisma's own default
 * (num_cpus * 2 + 1 per instance) is unbounded from the operator's
 * perspective and multiplies across every horizontally-scaled instance —
 * with N app pods that adds up fast against Postgres `max_connections`
 * (default 100), causing "too many clients already" outages under scale-out.
 * `connection_limit`/`pool_timeout` set explicitly in DATABASE_URL (e.g. a
 * PgBouncer DSN) are always respected as-is; this only fills in a safe
 * default when the operator hasn't set one.
 */
function withPoolDefaults(databaseUrl: string): string {
  if (!databaseUrl) return databaseUrl;

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    // Not a parseable URL (e.g. placeholder/test DSN) — pass through untouched.
    return databaseUrl;
  }

  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set(
      'connection_limit',
      process.env.DB_CONNECTION_LIMIT || '10'
    );
  }
  if (!url.searchParams.has('pool_timeout')) {
    url.searchParams.set('pool_timeout', process.env.DB_POOL_TIMEOUT || '20');
  }

  return url.toString();
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: withPoolDefaults(process.env.DATABASE_URL || ''),
      },
    },
    // Quiet in production; verbose locally. Query logging in prod would leak
    // parameter values into logs and add overhead on the hot path.
    log:
      process.env.NODE_ENV === 'production'
        ? ['warn', 'error']
        : ['warn', 'error'],
  });
}

export const prisma: PrismaClient =
  globalForPrisma.__synoraPrisma__ ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__synoraPrisma__ = prisma;
}

/**
 * Re-export the full `@prisma/client` surface (the `Prisma` namespace, model
 * types, and generated enums such as `UserRole`, `ContentStatus`) so callers
 * have a single import site for everything database-related and never reach
 * into `@prisma/client` directly.
 */
export * from '@prisma/client';
