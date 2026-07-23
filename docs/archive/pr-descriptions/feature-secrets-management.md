# feat(secrets): add provider-agnostic secret management system

**Branch**: `feature/secrets-management` → `SYNORA`
**Commit**: `f0f22dc` (1 commit, rebase-verified up to date with `origin/SYNORA` @ `8f1635a`)
**Type**: New subsystem
**Merge order**: 2nd, immediately after `chore/pnpm-ci-migration` ([Merge Plan](../MERGE_PLAN.md))

## Summary

Adds `SecretsManager`: a provider-agnostic abstraction over secret
storage so the rest of the codebase never reads `process.env` directly
for anything sensitive. Versioned records, rotation with a grace
period so a token signed just before rotation still validates, audit
logging with no value ever captured at the type level, and a
placeholder fallback in non-strict stages that hard-fails in
staging/production. Establishes the pattern the Bible's §16 provider
architecture later generalizes to every other subsystem this session
built.

## What changed

- **New `apps/backend/src/secrets/` module**: `types.ts`, `errors.ts`, `secretsManager.ts` (orchestrator), `registry.ts`, `serverOnly.ts`, `factory.ts`; `interfaces/` (`secretSource.ts`, `auditLog.ts`, `hsm.ts`); `sources/` (env var, Docker, Kubernetes, placeholder); `audit/loggerAuditLog.ts`; `hsm/stubHsmProvider.ts`.
- **`apps/backend/src/middleware/auth.ts`**: rewritten to verify JWTs against every known secret version (newest first) via `secretsManager.getVersions('JWT_SECRET')`, so a token signed moments before a rotation still validates during the grace window instead of forcing every logged-in user to re-authenticate. Converted to `async` throughout; error paths now go through `next(...)` instead of throwing synchronously.
- **`apps/backend/src/routes/auth.ts`**: reads `JWT_SECRET` through `secretsManager.get(...)` instead of `process.env.JWT_SECRET` directly.
- **`apps/backend/src/index.ts`**: wires secrets validation into startup.
- **`scripts/check-no-client-secrets.mjs`**: static CI check that fails the build if a secret-shaped value is reachable from frontend code.
- **New docs**: `docs/security/SECRET_MANAGEMENT.md` (full design doc — architecture, rotation flow, platform integration examples for Docker/Kubernetes); `docs/security.md` gets a pointer to it.
- **New example manifests**: `infrastructure/docker/docker-compose.secrets.example.yml`, `infrastructure/k8s/secret.example.yaml`.
- **`.env.example`** (root, backend, web): documents the secret catalog shape without any real values.
- **`package.json`**: adds `secrets:check` script running the static checker.

## Pre-existing vs. introduced (baseline comparison)

Compared lint/typecheck output against `origin/SYNORA`'s unmodified versions of every file this branch touches:

| File | Baseline | This branch | Verdict |
|---|---|---|---|
| `middleware/auth.ts` | 2 lint errors (unused `error` catch var ×2), 2 typecheck errors (`id`/`userId` shape mismatch) | 1 lint error, 2 typecheck errors | **Improved** — the refactor's `catch {}` (no bound variable) in `optionalAuthMiddleware` incidentally removed one baseline lint error. The typecheck errors are the same pre-existing `id` vs `userId` field-name mismatch (a global type expects `id`, JWT payloads use `userId` per `security.md`'s documented token structure) — the branch's new local `JwtPayload` interface preserves the same field name as baseline rather than introducing a new mismatch. |
| `routes/auth.ts` | 1 lint error (unused `createApiError` import), 2 typecheck errors (`jwt.sign` overload) | Same 1 lint error, same 2 typecheck errors | **Unchanged** — this branch didn't touch the `jwt.sign` call site's types or the unused import; it only changed how the secret value is *fetched* (`secretsManager.get(...)` vs `process.env`), not signed. |
| `middleware/errorHandler.ts` | 1 lint error | 1 lint error (file untouched — confirmed via `diff`, zero changes) | **Unchanged, not touched** |
| `utils/logger.ts` | 1 typecheck error | 1 typecheck error (file untouched) | **Unchanged, not touched** |

**No new lint or typecheck errors were introduced by this branch.** Nothing required fixing under step 5 of the merge-plan process.

## Quality checks

| Check | Result |
|---|---|
| Rebase onto `origin/SYNORA` | No-op — already a direct child, base unmoved |
| Install verification (`pnpm install`, temp-patched pins pending `chore/pnpm-ci-migration`) | ✅ Succeeds |
| Lint | 3 errors, all pre-existing baseline (see table above) |
| Type check | 5 errors, all pre-existing baseline (2× `middleware/auth.ts`, 2× `routes/auth.ts` `jwt.sign`, 1× `logger.ts`) |
| Tests | **27/27 passing** — 5 pre-existing (`utils.test.ts`) + 22 new (`secrets.test.ts`) |
| Documentation accuracy | `SECRET_MANAGEMENT.md` correctly describes the rotation/grace-period verification behavior implemented in `middleware/auth.ts`'s `verifyToken()` |
| Secret scan | No hardcoded credentials in the diff (checked patterns like `key/secret/password/token: "..."`) |
| Temp/debug code scan | No `console.log`/`debugger`/`TODO`/`FIXME` in new `secrets/` files |
| Test artifacts | No `.only`/`.skip` in `secrets.test.ts` |
| Conflict check (`git merge-tree`) | Clean against `origin/SYNORA`, clean against `chore/pnpm-ci-migration`, clean against the full downstream doc/feature stack tip |

## Test plan

- [x] `pnpm install` succeeds
- [x] Lint/typecheck show zero new errors vs. baseline (verified file-by-file)
- [x] 27/27 tests pass
- [x] `SECRET_MANAGEMENT.md` matches actual `verifyToken()` behavior
- [x] No secrets, debug code, or test-only artifacts in the diff
- [x] No conflicts against `SYNORA`, `chore/pnpm-ci-migration`, or the rest of the stack
