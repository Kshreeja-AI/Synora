# feat(config): add type-safe Environment Management System

**Branch**: `feature/environment-management` → `SYNORA`
**Commit**: `18fa6c0` (1 commit, correctly stacked on `feature/secrets-management` @ `f0f22dc`)
**Type**: New subsystem
**Merge order**: 3rd, immediately after `feature/secrets-management` ([Merge Plan](../MERGE_PLAN.md))
**Baseline reference**: [Baseline Health Report](../BASELINE_HEALTH_REPORT.md) (updated by this branch's own review — see below)

## Summary

Adds a type-safe, zod-validated `AppConfig` built on two independent
axes — `DeploymentStage` (exactly one of `development`/`testing`/`qa`/
`staging`/`production`) and `OperatingMode` (zero or more of `offline`/
`mock`/`enterprise`/`government`/`self-hosted`) — replacing scattered
`process.env` reads with a single, validated config object assembled
and checked once at startup. Migrates several existing `process.env`
reads (`JWT_EXPIRY`, `NODE_ENV`) to the new system as the reference
example of the pattern the Bible later generalizes in §10.1.

## What changed

- **New `apps/backend/src/config/` module**: `types.ts`, `errors.ts`, `schema.ts` (zod schema, the `AppConfigSchema`), `defaults.ts`, `stage.ts`, `modes.ts`, `governmentCompliance.ts`, `configLoader.ts`, `index.ts`.
- **`apps/backend/src/index.ts`**: wires `initConfig()`/validation into startup; server bootstrap is now async (`appPromise`) so config validation can complete before the app is created.
- **`apps/backend/src/routes/auth.ts`**: `expiresIn: process.env.JWT_EXPIRY || '15m'` → `expiresIn: getConfig().auth.jwtExpiry` (2 call sites).
- **`apps/backend/src/middleware/errorHandler.ts`**: `process.env.NODE_ENV === 'development'` → `getConfig().stage === 'development'` (2 usages).
- **`apps/backend/src/secrets/*`**: reconciled with the new stage/mode taxonomy (`factory.ts`, `registry.ts`, `secretsManager.ts`, `types.ts`, `index.ts` all touched) so both systems share one source of truth for "what environment am I running in."
- **New docs**: `docs/operations/ENVIRONMENT_MANAGEMENT.md` (design doc — the two-axis model, mode details, config shape), `docs/operations/ENVIRONMENT_MIGRATION_GUIDE.md` (how to migrate a remaining `process.env` read). `docs/security/SECRET_MANAGEMENT.md` updated for the reconciliation.
- **`.env.example`** (root, backend): documents the new stage/mode env vars.

## Comparison against the Baseline Health Report

Per the updated process, every finding below was checked against `docs/BASELINE_HEALTH_REPORT.md` rather than re-derived from scratch:

| Finding | Existing ID | This branch's status |
|---|---|---|
| `middleware/auth.ts` unused catch var, `id`/`userId` mismatch | `LINT-1`, `TYPE-1` | Unchanged — this branch doesn't touch `middleware/auth.ts` at all |
| `errorHandler.ts` unused `next` param | `LINT-2` | Unchanged — this branch adds an import and an `isDevelopment` line but doesn't touch the unused-param signature; error persists at a shifted line number (9→10) from the new import |
| `routes/auth.ts` unused import, `jwt.sign` overload | `LINT-3`, `TYPE-2` | Unchanged — this branch changes *where* the expiry string comes from (`getConfig()` instead of `process.env`), not its type (`string`); the overload mismatch is identical, shifted (43→44, 79→80) from the new import |
| `logger.ts` timestamp unknown | `TYPE-3` | Unchanged — file not touched |
| Backend build `TS2742` non-portable Router/app types | `BUILD-1` | Present at a new site: `index.ts`'s exported symbol changed from `app` to `appPromise` as part of this branch's async-bootstrap restructuring — same root cause (missing explicit type annotation), not a new one |
| `CORS_ORIGINS` no production-default enforcement | `CONFIG-1` | **Confirmed directly against this branch's code for the first time** (previously audit-only): `schema.ts` line 28 has no stage-conditional check. Baseline Health Report updated with this confirmation |
| `pnpm run build` blocked by `turbo.json`/`packageManager` | **New — `CI-5`** | Found while verifying this branch: turbo 2.10.5 (resolved fresh, no committed lockfile on this branch) rejects `turbo.json`'s `version`/`extends` keys and needs `packageManager` in `package.json` for pnpm-workspace detection — both already fixed on `chore/pnpm-ci-migration`, not a bug in this branch. Documented as `CI-5`, added to the Baseline Health Report |

**Zero new regressions.** One existing finding (`CONFIG-1`) moved from "audit-cited" to "directly verified." One new, non-regression, verification-tooling-only finding (`CI-5`) logged.

## Quality checks

| Check | Result |
|---|---|
| Rebase | No-op — already correctly stacked on `feature/secrets-management` @ `f0f22dc` (confirmed: `18fa6c0` was never touched by any later change, remains the direct child it always was) |
| Conflicts | None |
| Install verification | ✅ (temp-patched `jsonwebtoken`/`next-auth` pins pending `chore/pnpm-ci-migration`, per established pattern) |
| Build | Fails only on `BUILD-1`/`BUILD-2` (pre-existing) once `CI-5`'s turbo/packageManager blockers are worked around locally (not committed) |
| Lint | 3 backend errors, all pre-existing (`LINT-1` ×1, `LINT-2`, `LINT-3`) |
| Type check | 5 errors, all pre-existing (`TYPE-1` ×2, `TYPE-2` ×2, `TYPE-3`) |
| Tests | **53/53 passing** — 27 pre-existing (`utils.test.ts` + `secrets.test.ts`) + 26 new (`config.test.ts`) |
| Security scan | `CONFIG-1` directly verified (see above); no new security-relevant gaps found |
| Documentation accuracy | `ENVIRONMENT_MANAGEMENT.md`'s documented `CORS_ORIGINS` default (`http://localhost:3000`) matches `defaults.ts`; the doc does not overclaim a production hard-fail that doesn't exist (consistent with `CONFIG-1`) |
| Secret scan | No hardcoded credentials in the diff |
| Temp/debug code scan | No `console.log`/`debugger`/`TODO`/`FIXME` in new `config/` files |
| Test artifacts | No `.only`/`.skip` in `config.test.ts` |
| Final conflict check (`git merge-tree`) | Clean against `origin/SYNORA`, `chore/pnpm-ci-migration`, `feature/secrets-management`, and `docs/baseline-health-report` (the full downstream doc/feature stack tip) |

## Test plan

- [x] Rebase verified as already correct (no-op)
- [x] Install succeeds
- [x] Lint/typecheck show zero new errors vs. Baseline Health Report
- [x] 53/53 tests pass
- [x] `CONFIG-1` confirmed and Baseline Health Report updated
- [x] `CI-5` (new, non-regression) documented in Baseline Health Report
- [x] Documentation matches actual `corsOrigins`/stage behavior
- [x] No secrets, debug code, or test-only artifacts
- [x] No conflicts against `SYNORA`, `chore/pnpm-ci-migration`, `feature/secrets-management`, or the rest of the stack
