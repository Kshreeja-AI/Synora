# Environment Management System

Status: Active | Owner: Platform | Last Updated: 2026-07-20

This document describes how Synora determines what environment it's
running in, how that maps to typed, validated configuration, and how to
add a new config field, stage, or mode.

## 1. Principles

1. **Every configuration value comes from an environment variable**, with
   an explicit, documented default per deployment stage — never a bare
   literal buried in application code.
2. **No feature hardcodes a URL, provider, or credential.** URLs
   (`BACKEND_URL`, `FRONTEND_URL`, CORS origins) and provider
   enabled-flags flow through the typed `AppConfig`; credentials flow
   through [`SecretsManager`](../security/SECRET_MANAGEMENT.md) — nothing
   reads `process.env.SOME_URL` or `process.env.SOME_API_KEY` directly
   outside `apps/backend/src/config` and `apps/backend/src/secrets`.
3. **Config is validated once, loudly, at startup** — not discovered
   field-by-field at first use, three requests into production traffic.
4. **Types and runtime validation cannot drift**, because there's only one
   definition: `AppConfig` is `z.infer<typeof AppConfigSchema>`, not a
   hand-written interface that happens to resemble the zod schema.

## 2. Two axes: stage and mode

Support for "Development, Testing, QA, Staging, Production, Offline Mode,
Mock Mode, Enterprise Mode, Government Mode, Self-Hosted Mode" is
deliberately modeled as **two independent axes**, not ten flat states:

- **`DeploymentStage`** — exactly one at a time: `development` |
  `testing` | `qa` | `staging` | `production`. Which lifecycle stage this
  process is running as.
- **`OperatingMode`** — zero or more at once: `offline` | `mock` |
  `enterprise` | `government` | `self-hosted`. Behavioral toggles that
  apply *within* any stage.

A flat 10-value enum can't express "a staging deployment running a QA demo
against mocked providers" or "a self-hosted, government-mode production
deployment" — those are two stage+mode combinations, not two more enum
values. `AppConfig.stage` and `AppConfig.modes` are separate fields for
exactly this reason.

```
apps/backend/src/config/
├── types.ts                DeploymentStage, OperatingMode, OperatingModeFlags, AppConfig (z.infer)
├── schema.ts                 zod schemas — the single source of truth AppConfig is inferred from
├── stage.ts                    detectStage() — APP_STAGE, falls back to NODE_ENV, then "development"
├── modes.ts                     detectModes() — discrete booleans + APP_MODES CSV, unioned
├── defaults.ts                    per-stage default values (+ enterprise-mode override)
├── errors.ts                        ConfigValidationError, ConfigNotInitializedError, GovernmentModeComplianceError
├── governmentCompliance.ts           the one concrete Government Mode check today (HSM required)
├── configLoader.ts                    loadConfig() — assembles + validates the full AppConfig
└── index.ts                            initConfig()/getConfig() — the app-wide accessor pair
```

## 3. Environment variables

### Stage & mode selection

| Variable | Values | Default | Notes |
|---|---|---|---|
| `APP_STAGE` | `development` \| `testing` \| `qa` \| `staging` \| `production` | falls back to `NODE_ENV`, then `development` | Authoritative. Set explicitly in staging/production. |
| `NODE_ENV` | `development` \| `production` \| `test` | — | Fallback only; can't express `testing` vs `qa` vs `staging` on its own. |
| `OFFLINE_MODE` | `true`/`false` | `false` | |
| `MOCK_MODE` | `true`/`false` | `false` | Also widens the secrets placeholder fallback into staging/production — see [Secret Management](../security/SECRET_MANAGEMENT.md#3-environments). |
| `ENTERPRISE_MODE` | `true`/`false` | `false` | Tightens the rate-limit default (see §5). |
| `GOVERNMENT_MODE` | `true`/`false` | `false` | Startup fails unless a real HSM is configured (see §6). |
| `SELF_HOSTED_MODE` | `true`/`false` | `false` | |
| `APP_MODES` | comma-separated mode names | — | Convenience bulk form, e.g. `APP_MODES=mock,offline`. ORed with the discrete flags above. |

### Application configuration

| Variable | Field | Default (varies by stage — see §4) |
|---|---|---|
| `PORT` | `server.port` | `3001` |
| `CORS_ORIGINS` | `server.corsOrigins` (comma-separated) | `http://localhost:3000` |
| `RATE_LIMIT_WINDOW_MS` | `rateLimit.windowMs` | `900000` (prod: same, tightened `maxRequests`) |
| `RATE_LIMIT_MAX_REQUESTS` | `rateLimit.maxRequests` | `100` (prod: `60`, enterprise: `30`) |
| `LOG_LEVEL` | `logging.level` | `info` (dev/qa: `debug`, prod: `warn`) |
| `JWT_EXPIRY` | `auth.jwtExpiry` | `15m` |
| `JWT_REFRESH_EXPIRY` | `auth.jwtRefreshExpiry` | `7d` |
| `BACKEND_URL` | `urls.backendUrl` | `http://localhost:3001` |
| `FRONTEND_URL` | `urls.frontendUrl` | `http://localhost:3000` |
| `DATABASE_URL` | `database.url` | resolved via `SecretsManager` — see [Secret Management](../security/SECRET_MANAGEMENT.md) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `REPLICATE_API_KEY` | `providers.*Enabled` (presence only — the key itself never appears in `AppConfig`) | resolved via `SecretsManager` |

`LOG_LEVEL` is the one deliberate exception to "everything reads from
`config`" — `apps/backend/src/utils/logger.ts` reads it directly from
`process.env` at module load, before `initConfig()` has run, so that
logging (including logging a config *validation failure*) works even if
config assembly itself fails.

## 4. Stages in detail

| Stage | Log level default | Rate limit default | Placeholder secrets | Missing required secret |
|---|---|---|---|---|
| `development` | `debug` | 100 req / 15 min | Yes | Warns only |
| `testing` | `warn` | 1000 req / 1 min (generous — test runs shouldn't get rate-limited) | Yes | Warns only |
| `qa` | `debug` | 100 req / 15 min | Yes | Warns only |
| `staging` | `info` | 100 req / 15 min | Only if `MOCK_MODE=true` | **Fails startup** |
| `production` | `warn` | 60 req / 15 min (30 with `ENTERPRISE_MODE=true`) | Only if `MOCK_MODE=true` | **Fails startup** |

## 5. Modes in detail

- **Offline Mode** (`OFFLINE_MODE`) — signals that no outbound network
  calls to third-party services should happen. Defined and typed today;
  no feature in this codebase currently makes an outbound third-party
  call, so there's nothing yet to gate on it. The contract: any future
  integration that calls out to a third-party HTTP API must check
  `config.modes.offline` and short-circuit (or refuse to configure the
  provider) when true.
- **Mock Mode** (`MOCK_MODE`) — widens the secrets source chain to allow
  placeholder fallback even in staging/production (an explicit, audited
  opt-in — see [Secret Management §3](../security/SECRET_MANAGEMENT.md#3-environments)).
  This is also the flag the (separate) Provider Abstraction Layer's
  `USE_MOCK_PROVIDERS` convention is meant to align with, if/when that
  system lands on this codebase.
- **Enterprise Mode** (`ENTERPRISE_MODE`) — concretely tightens the
  rate-limit default (`defaults.ts#applyModeOverrides`). Intended to also
  imply stricter operational posture (mandatory audit log retention, SSO)
  as those features are built — not fabricated here ahead of the features
  that would need them.
- **Government Mode** (`GOVERNMENT_MODE`) — concretely asserts a real HSM
  is configured at startup (`governmentCompliance.ts`); throws
  `GovernmentModeComplianceError` and aborts boot if `StubHsmProvider` is
  still in use. This is the one thing checked in code — data residency,
  FIPS-validated crypto, and audit retention requirements are compliance
  concerns this function cannot verify and does not claim to.
- **Self-Hosted Mode** (`SELF_HOSTED_MODE`) — signals the deployment
  should not depend on Synora-managed cloud services (telemetry beacons,
  hosted storage, etc.). Defined and typed; wire real behavior into it as
  those managed-service dependencies are introduced.

Modes combine freely with any stage and with each other — `APP_STAGE=production
GOVERNMENT_MODE=true SELF_HOSTED_MODE=true` is a normal, expected
combination, not a special case.

## 6. Type-safe configuration

```ts
import { getConfig } from './config';

const config = getConfig(); // fully typed AppConfig, throws if called before initConfig()
config.server.port;         // number
config.stage;                // 'development' | 'testing' | 'qa' | 'staging' | 'production'
config.modes.government;      // boolean
```

`AppConfig` is `z.infer<typeof AppConfigSchema>` (`config/types.ts`) — the
TypeScript type and the runtime validator are generated from the same
definition, so they cannot silently drift apart the way a hand-maintained
interface next to a hand-maintained validator eventually does.

## 7. Validation

`loadConfig()` builds a candidate object from env vars + stage defaults,
then runs it through `AppConfigSchema.safeParse()`. On failure, every
violation is collected into one `ConfigValidationError` — a deployment
finds out about all of its misconfigurations in one startup attempt:

```
ConfigValidationError: Configuration failed validation:
  - server.port: Number must be greater than 0
  - server.corsOrigins.0: Invalid url
```

## 8. Startup sequence

```ts
// apps/backend/src/index.ts
await secretsManager.validateRequired(); // secrets first — config depends on DATABASE_URL etc.
const config = await initConfig();        // assembles + validates + runs government-mode check
// ... app.listen(config.server.port, ...)
```

`getConfig()` throws `ConfigNotInitializedError` if called before this
completes — a clear failure instead of `undefined` propagating through
request handling.

## 9. Adding a new config field

1. Add it to `AppConfigSchema` in `config/schema.ts` with a real
   constraint (not just `z.string()` if it's a URL, a number, an enum,
   etc.).
2. Add a default to `defaults.ts` if one makes sense per-stage.
3. Read it from an env var in `configLoader.ts`.
4. Add it to every relevant `.env.example`.
5. Use `getConfig().yourField` in application code — never
   `process.env.YOUR_VAR` directly.

## 10. Adding a new stage or mode

- **New stage**: add it to `DeploymentStageSchema` (`schema.ts`), give it
  entries in `STAGE_OVERRIDES` (`defaults.ts`) for anything that should
  differ from the base defaults, and decide whether it belongs in the
  "soft-fail" set for secrets (`testing`/`qa`/`development` today — see
  `secretsManager.ts#validateRequired`) or the "hard-fail" set
  (`staging`/`production`).
- **New mode**: add it to `OperatingModeSchema` and `OperatingModeFlags`
  (`types.ts`/`schema.ts`), a boolean env var mapping in `modes.ts`, and
  wire whatever concrete behavior it should have — following the pattern
  in §5, don't fabricate behavior for a mode ahead of the feature that
  actually needs to check it.
