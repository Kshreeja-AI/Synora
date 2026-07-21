# P0-10: Prisma Client Singleton + P0-9: Real Readiness Probe

**Status:** ✅ Complete
**Master plan item:** P0-10 (connection-pool exhaustion), P0-9 (health check has no DB probe)
**Date:** 2026-07-21

## What was wrong (verified, not assumed)

Independently re-confirmed by direct source read before making any change:

```
apps/backend/src/routes/auth.ts:      const prisma = new PrismaClient();
apps/backend/src/routes/users.ts:     const prisma = new PrismaClient();
apps/backend/src/routes/projects.ts:  const prisma = new PrismaClient();
apps/backend/src/routes/documents.ts: const prisma = new PrismaClient();
apps/backend/src/routes/images.ts:    const prisma = new PrismaClient();
```

Five route modules, each constructing its own `PrismaClient`, each owning its own connection pool (Prisma defaults to `num_cpus * 2 + 1` connections per client). In a running process that's 5+ independent pools against one Postgres instance, multiplied again per horizontally-scaled replica. Postgres's default `max_connections` (100) is reachable with a small number of replicas before any real traffic arrives — the failure mode is "FATAL: too many connections" and a full outage, not a graceful degradation.

Separately, `GET /health` returned a static `{status: 'ok'}` with **no dependency check at all** — it would report healthy while the database was completely unreachable, which is worse than no health check for any orchestrator using it to gate rollouts or restarts.

## What changed

### 1. `@synora/database` now exports a shared client, not just a schema

New file: `packages/database/src/index.ts`. Exports:
- `prisma`: a single `PrismaClient` instance, guarded against duplication across hot-reload in dev via a `globalThis` sentinel (production is unaffected — the module evaluates once per process).
- `export * from '@prisma/client'`: re-exports the generated `Prisma` namespace, model types, and enums (e.g. `UserRole`), so every consumer has one import site for anything database-related instead of reaching into `@prisma/client` directly.

`packages/database/package.json` gained a real `build` script (`prisma generate && tsc`), `main`/`types`/`exports` fields matching the existing `@synora/shared` convention exactly, and a `tsconfig.json` extending the workspace root — this was previously a schema-only package with no compiled output.

### 2. Every route now imports the shared client

`apps/backend/src/routes/{auth,users,projects,documents,images}.ts`: `import { PrismaClient } from '@prisma/client'; const prisma = new PrismaClient();` → `import { prisma } from '@synora/database';`. Five call sites, one pool.

### 3. App construction separated from process bootstrapping (required for #4, and a genuine testability fix)

New file `apps/backend/src/app.ts`: `createApp(config, deps?)` builds and returns a fully-wired `Express` app — every middleware, both health endpoints, all five routers, the 404 handler, the error handler — **without calling `.listen()`**. `apps/backend/src/index.ts` is now the thin process entrypoint: validate secrets, load config, `createApp(config)`, `.listen()`, register shutdown handlers.

This was necessary, not incidental: without it, there is no way to get a handle on the Express app in a test without also binding a live network port, which is exactly the kind of untestable coupling the master plan's testing findings called out. It's a two-file split, not a rewrite, and the exported `appPromise` contract from `index.ts` is unchanged.

### 4. `/ready` added; `/health` scope clarified

- `GET /health` — liveness only, unchanged behavior, now documented in-code as deliberately dependency-free (a DB outage must not also trigger a restart-loop via liveness).
- `GET /ready` — new. Runs a real `SELECT 1` through the shared Prisma client with a 2-second timeout race. Returns `200 {status: 'ready', checks: {database: {status:'ok', latencyMs}}}` when reachable, `503 {status: 'not_ready', checks: {database: {status:'error', latencyMs, error}}}` when not (including on timeout). This is what a Kubernetes readiness probe or load-balancer health check should point at.

The database check is injected (`CreateAppDeps.checkDatabase`, defaulting to a real `prisma.$queryRaw` call) specifically so its failure branch is testable by substituting a rejecting/never-resolving function — not by asserting against a parallel construct that doesn't touch the real route (an earlier draft of this test made exactly that mistake during this session and was corrected before being counted as done).

### 5. Graceful shutdown drains the pool

`SIGTERM`/`SIGINT` handlers now `await prisma.$disconnect()` before `process.exit(0)`, so Postgres reclaims connections promptly on deploy/restart instead of waiting out TCP idle timeouts.

## Tests (all against a real Postgres 16 instance, not mocks)

- `apps/backend/src/db/__tests__/client.test.ts` (4 tests): the exported client has model delegates, Prisma enums are re-exported correctly, the `globalThis` singleton guard is actually holding the same instance, and a live `SELECT 1` succeeds through the shared pool.
- `apps/backend/src/__tests__/health.test.ts` (4 tests): `/health` returns liveness fields and never a `checks` block; `/ready` returns 200 + `database.status: 'ok'` against the real test database; `/ready` returns 503 with the real error message when the injected probe rejects; `/ready` returns 503 when the injected probe exceeds the 2s budget.

## Security review

- No new attack surface: `/ready` reveals only `{status, latencyMs, error-message-string}` — no connection string, no query plan, no stack trace. The error string surfaced is `error.message`, and Prisma connection-failure messages do not include credentials (verified: they report host/reason, not the DSN).
- `/ready` is unauthenticated by design (orchestrators probing it have no session) — consistent with `/health`'s existing exposure and industry convention (K8s probes are never authenticated).
- Shared singleton does not change trust boundaries: all five routes already shared one database and one set of credentials; this only changes how many pooled connections are opened to reach it.

## Architecture review

- Removes a real anti-pattern (multiple `PrismaClient` instances) flagged independently by this engagement's own architecture review, without introducing a service layer or DI container — deliberately minimal, matching the master plan's sequencing (P0-10 is meant to be a small, mechanical fix, not a rewrite).
- `createApp`/`index.ts` split is the smallest change that makes the app testable; it does not change runtime behavior for the deployed process (bootstrap still validates secrets → loads config → builds app → listens, in the same order).
- `@synora/database` now has a real build step in the Turbo graph (`prisma generate && tsc`); confirmed `test:coverage`'s existing `dependsOn: ["^build"]` already builds workspace dependencies before running backend tests, so this required no CI changes.

## Performance review

- Connection pool count drops from 5 independent pools to 1 for the whole backend process — the single biggest connection-count risk identified in the earlier performance review is closed.
- `/ready`'s `SELECT 1` is the cheapest possible round-trip query; the 2-second timeout bounds worst-case probe latency without masking a genuinely slow/down database.
- No hot-path latency regression: routes call the exact same Prisma client API surface as before: `.findMany()`, `.create()`, etc. — only the construction site moved.

## Production verification

Run against a real Postgres 16 instance provisioned for this session (not mocked, not SQLite):

| Step | Result |
|---|---|
| `pnpm --filter @synora/database build` | ✅ `prisma generate` + `tsc` succeed, `dist/index.js` + `.d.ts` produced |
| `pnpm run type-check` (all 8 packages) | ✅ 8/8 successful |
| `pnpm run lint` (all packages) | ✅ 0 errors (pre-existing warnings unrelated to this change) |
| `pnpm run test:coverage` (real Postgres) | ✅ — see commit for exact pass count |
| `pnpm run build` (all packages) | ✅ |

## Git

Committed as a single, reviewable change to `apps/backend/src/{app.ts,index.ts,routes/*.ts}`, `packages/database/{package.json,tsconfig.json,src/index.ts}`, plus the two new test files, pushed to `claude/synora-ai-platform-h5q0k2`.
