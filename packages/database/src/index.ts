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

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
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
