# Release 1 — Final Summary

**Status:** Complete and frozen. This is the authoritative, single-document
snapshot of what Release 1 actually shipped, verified against the current
source at the time of writing — not aspirational, not a plan. For deeper
detail on any section, follow the pointers; don't duplicate them here as
the code evolves in Release 2.

---

## 1. Final Architecture

A pnpm-workspace monorepo: an Express/TypeScript REST API, a Next.js
frontend, and a Prisma-backed PostgreSQL database, built with Turbo.

```
Browser
  │  HTTPS, Authorization: Bearer <jwt>
  ▼
apps/web (Next.js 15, App Router)          apps/backend (Express 4, TypeScript, ESM)
  raw fetch + useState + localStorage        helmet → CORS → rate limiter → express.json
  (next-auth/react-query/zustand/axios         → requestLogger → routes (zod-validated)
   declared, not yet wired)                    → errorHandler
                                                  ├── auth (register/login/refresh/logout)
                                                  ├── users, projects, documents, images
                                                  ├── ai (text/code, 10 providers)
                                                  ├── config (typed, stage-aware)
                                                  └── secrets (audited reads)
                                                        │
                                          ┌─────────────┴─────────────┐
                                          ▼                           ▼
                                   PostgreSQL 16                AI Provider
                                   (Prisma, shared          (Anthropic, OpenAI,
                                    client singleton)         Gemini, etc.)
```

No Redis, no object storage, no job queue, no CD pipeline — all
deliberate Release 2+ scope. Full detail: `docs/architecture.md`.

---

## 2. Release Features

| Feature | What it does | Doc |
|---|---|---|
| **R1-a** Email-enumeration fix | Register/login return identical response shapes for "unknown email" vs. "wrong password" | `docs/production/R1-a_EMAIL_ENUMERATION.md` |
| **R1-b** Input validation | Every mutating route validates its body with zod; `ZodError` → 400, never 500 | `docs/production/R1-b_INPUT_VALIDATION.md` |
| **R1-c** Refresh tokens | 15-min JWT access + 7-day opaque rotating refresh tokens; single-use with reuse detection; real, revocable logout | `docs/production/R1-c_REFRESH_TOKENS.md` |
| **R1-d** Account lockout | 5 failed logins locks an account for 15 minutes (config-driven), DB-backed | `docs/production/R1-d_ACCOUNT_LOCKOUT.md` |
| **R1-e** AI provider abstraction | Provider-agnostic text/code generation across 10 providers, auto-selected by configured API key | `docs/production/R1-e_AI_PROVIDER_ABSTRACTION.md` |
| **R1-f** Production Dockerfile | Multi-stage, non-root, reproducible production image | `docs/production/R1-f_DOCKERFILE.md` |
| **R1-g** Supply-chain security | Blocking CI gates: `pnpm audit --prod --audit-level=high`, gitleaks secret scanning | `docs/production/R1-g_SUPPLY_CHAIN_SECURITY.md` |
| **R1-h** Launch readiness | Env vars, keys, deploy commands, launch checklist | `docs/archive/RELEASE_1_LAUNCH_READINESS.md` |

Plus two pre-Release-1 fixes carried forward: a shared Prisma client
singleton (`docs/production/P0-10_PRISMA_SINGLETON.md`) and Argon2id
password hashing with transparent bcrypt migration
(`docs/production/P0-11_ARGON2_PASSWORD_HASHING.md`).

Also fixed during Release 1's CI stabilization and final audits (not new
features, but real bugs caught and closed — see
`docs/archive/RELEASE_1_VERIFICATION_REPORT.md` and `docs/archive/PRODUCTION_READINESS_AUDIT.md`
for the full list): 7 CI pipeline bugs (a workspace-breaking `pnpm
prune`, a broken gitleaks install, a container logging-permission crash,
a Docker port-binding issue, a missing-OpenSSL Prisma failure, and
others), 2 redundant database indexes, and a set of freshly-disclosed
CVEs in the frontend's dependency tree.

---

## 3. API Summary

Full detail with request/response examples: `docs/api.md`.

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Liveness (no DB check) |
| `/ready` | GET | Readiness (probes the database) |
| `/api/auth/register` | POST | Create account, returns access+refresh tokens |
| `/api/auth/login` | POST | Authenticate, returns access+refresh tokens (423 if locked) |
| `/api/auth/refresh` | POST | Rotate refresh token, returns a new pair |
| `/api/auth/logout` | POST | Revoke a refresh token |
| `/api/users/me` | GET | Current user's profile |
| `/api/users/:userId` | GET | Public user profile |
| `/api/projects` | GET, POST | List/create projects |
| `/api/projects/:projectId` | GET | Project details |
| `/api/documents` | GET, POST | List/create documents |
| `/api/documents/:documentId` | GET | Document details |
| `/api/images` | GET | List generated images |
| `/api/images/generate` | POST | **Returns a hardcoded placeholder** — not wired to any AI provider yet (Release 2, R2-d) |
| `/api/images/:imageId` | GET | Image details |
| `/api/ai/generate` | POST | Real text/code generation across 10 providers |

Every mutating endpoint validates input with zod and returns a consistent
`{ success, data }` / `{ success: false, error }` envelope.

---

## 4. Database Summary

PostgreSQL 16, Prisma ORM, 18 models, 4 applied migrations. Full detail:
`docs/database.md`.

**Core models actually exercised by Release 1's routes:** `User`
(including `failedLoginAttempts`/`lockedUntil` for lockout),
`RefreshToken` (hashed, single-use, rotating), `Project`, `Document`,
`GeneratedImage` (placeholder only). **Provisioned but not yet wired to
any route:** `UserProfile`, `UserPreferences`, `Workspace` +
`WorkspaceMember` + `WorkspaceInvitation`, `ApiKey`, `ActivityLog`,
`Session`, `VerificationToken`, `MFAAuditLog`.

Indexes: every foreign-key column indexed; two redundant explicit indexes
duplicating `@unique` constraints (`User.email`, `Workspace.slug`) were
found and removed in the post-Release-1 audit.

---

## 5. Deployment Instructions

Full detail: `docs/deployment.md`, `PROJECT_HANDOVER.md` §6.

```bash
# 1. Build
docker build -t synora-backend:latest -f Dockerfile .

# 2. Migrate
DATABASE_URL="<prod-db-url>" pnpm --filter @synora/database db:migrate

# 3. Run
docker run -d --name synora-backend \
  -e NODE_ENV=production -e APP_STAGE=production -e PORT=3001 \
  -e DATABASE_URL="<prod-db-url>" \
  -e JWT_SECRET="<generated>" -e NEXTAUTH_SECRET="<generated>" \
  -e ANTHROPIC_API_KEY="<real-key>" \
  -p 3001:3001 synora-backend:latest

# 4. Verify
curl -f http://<host>:3001/health
curl -f http://<host>:3001/ready
```

No CD pipeline exists — every deploy is this manual sequence today
(Release 2, R2-e).

---

## 6. Environment Variables

Authoritative list: `docs/archive/RELEASE_1_LAUNCH_READINESS.md` §2, `.env.example`.

**Required to boot:** `DATABASE_URL`, `JWT_SECRET`, `NEXTAUTH_SECRET`.
**Everything else has a working default.** At least one AI provider key
(e.g. `ANTHROPIC_API_KEY`) is needed for real AI generation; the app
boots and serves auth/CRUD routes without one.

---

## 7. CI/CD Overview

`.github/workflows/ci.yml`, three jobs, all green:

| Job | What it does |
|---|---|
| `test` | install → migrate → lint → type-check → test → build → coverage upload |
| `security` | `pnpm audit --prod --audit-level=high` (blocking) → gitleaks (blocking) → Snyk (best-effort) |
| `docker` | build the production image → smoke-test it (`/health` responds 200) |

This is CI, not CD — nothing here deploys anywhere. Full stabilization
history (7 real bugs found and fixed, each with root cause and CI
evidence): `docs/archive/RELEASE_1_VERIFICATION_REPORT.md`.

---

## 8. Docker Overview

Multi-stage `Dockerfile`, `node:22-bookworm-slim` (glibc — smoother for
the `argon2` native addon and Prisma's query engine than Alpine/musl).
Both stages install OpenSSL explicitly (bookworm-slim ships none by
default, and Prisma's engine needs it to load correctly). The runtime
stage ships the full, unpruned `node_modules` the builder produced
(`pnpm prune --prod` was tried and rejected — it corrupts this
workspace's symlink layout, see `docs/archive/RELEASE_1_VERIFICATION_REPORT.md` Issue
2) and runs as the base image's non-root `node` user. A baked-in
`HEALTHCHECK` hits `/health`.

---

## 9. Security Summary

Full, verified-against-source detail: `docs/security.md`. Summary:

**Implemented:** JWT access tokens with pinned algorithm (`HS256`),
rotating single-use refresh tokens with reuse detection, Argon2id
password hashing, per-account login lockout, email-enumeration
protection, zod validation on every mutating route, structural SQL-
injection immunity (Prisma only, no raw queries), errors that don't leak
internals outside development, explicit CORS allowlist, `helmet()`
security headers, and two blocking CI gates (dependency audit, secret
scanning) that have already caught and blocked a real vulnerability set
once in this repository's history.

**Not yet implemented (tracked, not accidental):** MFA, CSRF protection,
OAuth2 login, password complexity rules beyond minimum length,
auth-endpoint-specific rate limiting, Redis-backed shared state for
multi-instance deployments, field-level encryption at rest, GDPR
data-export/anonymization tooling.

---

## 10. Limitations

- Single-instance only — login lockout and rate-limiting are DB-backed, correct for one instance, not for more than one
- No media generation — image/video/audio routes exist but don't call any AI provider
- No MFA, no CSRF (both fully built on `recover/mfa`/`recover/csrf` branches, not merged)
- No CD pipeline — every deploy is manual
- No `/metrics` endpoint or alerting beyond `/health`/`/ready`
- Backup/restore delegated entirely to the managed Postgres provider's own backup/PITR
- Frontend's declared state-management stack (`next-auth`, `@tanstack/react-query`, `zustand`, `axios`) isn't wired into any page yet
- No workspace multi-tenancy enforcement beyond per-user scoping (schema exists, no route uses it)

---

## 11. Known Issues

None open. Every issue found during Release 1's development, CI
stabilization, and final audits was fixed and verified before this
document was written — see `docs/archive/RELEASE_1_VERIFICATION_REPORT.md` and
`docs/archive/PRODUCTION_READINESS_AUDIT.md` for the complete, itemized history (root
cause, fix, verification, commit, and CI evidence for each).

---

## 12. Release 2 Starting Point

Full plan: `RELEASE_2_PLAN.md`. In priority order:

1. **M1 — Auth hardening**: rebase `recover/mfa` and `recover/csrf` onto
   the current base (both predate the Prisma singleton, refresh-token
   schema, and `app.ts` restructuring). Re-verify the 4 already-in-
   mainline, currently-unwired MFA-adjacent services at
   `apps/backend/src/services/mfa/` against whatever `recover/mfa`'s
   `mfa.service.ts` actually expects — don't assume they're still a
   drop-in fit.
2. **M2 — Redis** (R2-c): shared rate-limit/lockout state, unblocks M3.
3. **M3 — Media generation** (R2-d): async job queue + object storage for
   real image/video/audio generation.
4. **M4 — Ops maturity** (R2-e/f/g): CD pipeline, metrics/alerting,
   automated backup + rehearsed restore.
5. **M5 — Closeout** (R2-h): remaining security hardening, full E2E
   regression suite.

Infrastructure to provision before starting: a managed Redis instance, an
S3-compatible object storage bucket, and a decision on the CD platform
and metrics/alerting backend targets.

**Outstanding administrative item carried over from Release 1:** tag the
final Release 1 commit as `v1.0.0` and create the corresponding GitHub
Release — both were requested during Release 1 but blocked by this
session's git credential scope (push limited to one branch) and the
absence of a release-creation tool in the available toolset. Whoever has
full repo write access should do this before or alongside starting
Release 2, so the tag exists as a real rollback point.
