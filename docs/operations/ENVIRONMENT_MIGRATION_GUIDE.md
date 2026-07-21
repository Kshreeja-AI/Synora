# Environment Management: Migration Guide

Status: Active | Owner: Platform | Last Updated: 2026-07-20

Who this is for: anyone updating deployment configuration, CI/CD
pipelines, or application code written before the Environment Management
System (`apps/backend/src/config`) landed.

## 1. Variable renames

| Old | New | Why |
|---|---|---|
| `APP_ENV` | `APP_STAGE` | "Environment" was ambiguous once Operating Modes were introduced as a second axis — "stage" is unambiguous. |
| `APP_ENV=local` | `APP_STAGE=development` | `local` is no longer a distinct stage — see §2. |

`NODE_ENV` is unchanged and still works as a fallback when `APP_STAGE` is
unset (see [Environment Management §3](ENVIRONMENT_MANAGEMENT.md#3-environment-variables)).

**Action required**: update `.env.local` files, CI/CD variable groups,
Kubernetes `ConfigMap`s, and any platform dashboard (Vercel/Netlify)
environment variable settings that currently set `APP_ENV` to set
`APP_STAGE` instead. `APP_ENV` is not read by anything after this change —
it will be silently ignored, not an error, so audit for it explicitly
rather than relying on something failing loudly.

## 2. The `local` stage was folded into `development`

Before Operating Modes existed, the secrets subsystem treated a
developer's own machine (`local`) as a stage distinct from a shared
`development` environment. That distinction is now expressed correctly as
**stage `development` + mode flags** instead of a fourth/fifth stage
value:

- A developer's laptop with nothing configured: `APP_STAGE=development`
  (the default), no modes set — behaves exactly as `local` used to
  (placeholder secrets, verbose logging).
- A developer's laptop deliberately running against mocked external
  providers: `APP_STAGE=development MOCK_MODE=true`.
- A shared development server: `APP_STAGE=development`, same as before.

If you had `APP_ENV=local` anywhere, replace it with `APP_STAGE=development`.
Nothing else changes — `development` already had the same placeholder
fallback behavior `local` did.

## 3. Two new stages: `testing` and `qa`

If your CI pipeline runs the test suite without setting `APP_STAGE`, it
falls back to `NODE_ENV`. Vitest and most Node test runners set
`NODE_ENV=test`, which `detectStage()` maps to `testing` automatically —
**no action required** for most CI setups. Set `APP_STAGE=testing`
explicitly only if you want to be certain, or `APP_STAGE=qa` for a
dedicated QA environment (previously indistinguishable from `staging` or
`development` depending on how it was configured).

## 4. Moving application code off raw `process.env`

If you're adding a new feature and are tempted to write
`process.env.SOME_VAR`, don't — here's the mapping:

| What you need | Old pattern | New pattern |
|---|---|---|
| A URL, port, timeout, non-secret setting | `process.env.X \|\| 'default'` scattered per file | Add to `AppConfigSchema` (`config/schema.ts`) + `defaults.ts`, read via `getConfig().yourField` |
| A credential, API key, connection string | `process.env.X \|\| ''` | Add to `SECRET_CATALOG` (`secrets/registry.ts`), read via `secretsManager.get('X')` |
| "Are we in production?" | `process.env.NODE_ENV === 'production'` | `getConfig().stage === 'production'` |
| "Is mock/offline/enterprise/government/self-hosted mode on?" | (didn't exist) | `getConfig().modes.mock` etc. |

Existing call sites already migrated as part of this system landing:
`apps/backend/src/index.ts` (server bootstrap: port, CORS, rate limit),
`apps/backend/src/middleware/errorHandler.ts` (stage check for whether to
expose stack traces), `apps/backend/src/routes/auth.ts` and
`apps/backend/src/middleware/auth.ts` (JWT secret + expiry). Use these as
the reference pattern for migrating anything remaining.

## 5. `index.ts` bootstrap is now async

`apps/backend/src/index.ts` previously constructed the Express `app` and
called `.listen()` synchronously at module load, with `secretsManager.validateRequired()`
layered on top as a `.then()`. It's now a single `async function bootstrap()`
that awaits secrets validation, then `initConfig()`, then builds and starts
the app — because CORS origins, rate limits, and the port itself now come
from the validated config object, which requires an async resolution step
(`DATABASE_URL` and provider keys route through `SecretsManager.tryGet()`).

If anything imported the default export of `index.ts` expecting a
synchronous `Express` app, it now gets `Promise<Express>` — check for that
before relying on this module's default export elsewhere (nothing in this
repo currently imports it).

## 6. Rollback

If you need to revert to the pre-Environment-Management behavior for any
reason: `git revert` this change's commit. There's no data migration
involved — this system only reads env vars and re-derives config at
process startup; it doesn't persist anything that would need reversing.
