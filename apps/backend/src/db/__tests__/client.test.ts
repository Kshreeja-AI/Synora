import { describe, it, expect, afterAll } from 'vitest';
import { prisma, UserRole } from '@synora/database';

/**
 * Verifies the shared PrismaClient singleton exported by @synora/database.
 * The production risk being guarded against is connection-pool exhaustion
 * from multiple `new PrismaClient()` instances; these tests assert that a
 * single, live, reusable instance is what the rest of the app receives.
 */
describe('@synora/database shared Prisma client', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('exports a configured PrismaClient with model delegates', () => {
    expect(prisma).toBeDefined();
    expect(typeof prisma.$connect).toBe('function');
    expect(typeof prisma.$disconnect).toBe('function');
    expect(prisma.user).toBeDefined();
    expect(prisma.mFAAuditLog).toBeDefined();
  });

  it('re-exports generated Prisma enums so callers have one import site', () => {
    expect(UserRole.USER).toBe('USER');
    expect(UserRole.ADMIN).toBe('ADMIN');
  });

  it('registers a single process-global instance (pool reuse guard)', () => {
    // Vitest runs with NODE_ENV=test, so the dev/test global guard is active;
    // the exported instance must be the one stored on globalThis, proving that
    // a re-import of this module reuses the same pool rather than creating one.
    const globalRef = globalThis as unknown as { __synoraPrisma__?: unknown };
    expect(globalRef.__synoraPrisma__).toBe(prisma);
  });

  it('executes a live query through the shared connection pool', async () => {
    const rows = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`;
    expect(rows[0].ok).toBe(1);
  });
});
