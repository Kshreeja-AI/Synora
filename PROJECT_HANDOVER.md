# Synora — Project Handover

**As of:** 2026-07-23, Release 1 complete and frozen (branch `claude/synora-ai-platform-h5q0k2`, tag/release pending — see §12)

This document is written for a senior engineer joining the project with
zero prior context. It covers what exists, how it's built, how to run it,
how to deploy it, and what's deliberately not done yet. Where a topic has
its own detailed doc already, this document summarizes and links rather
than duplicating.

**See also:** `RELEASE_1_FINAL.md` is the other authoritative Release 1
document — a single-file snapshot of features, API, database, deployment,
security, limitations, and the Release 2 starting point. This document
(`PROJECT_HANDOVER.md`) is oriented toward *how to work in the codebase*;
`RELEASE_1_FINAL.md` is oriented toward *what shipped*. `docs/README.md`
indexes everything else.

---

## 1. Current architecture

Synora is a monorepo SaaS: a Next.js frontend, an Express/TypeScript
backend REST API, and a PostgreSQL database via Prisma, all in one pnpm
workspace built with Turbo.

```
Browser
  │
  ▼
apps/web (Next.js 15, App Router)         — apps/backend (Express 4, TypeScript, ESM)
  fetch() + useState + localStorage          Routes → zod validation → Services → Prisma
  (no state library wired despite deps)      /health, /ready, /api/auth, /api/users,
                                              /api/projects, /api/documents, /api/images,
                                              /api/ai
                                                  │
                                                  ▼
                                          PostgreSQL 16 (via @synora/database's
                                          shared Prisma singleton)
```

**Request flow (backend):** `helmet` → CORS → global rate limiter
(`express-rate-limit`, IP-based, all of `/api/*`) → `express.json()` →
`requestLogger` → route handlers (each validates its body with a zod
schema before touching Prisma) → centralized `errorHandler` (maps
`ZodError` → 400, `ApiException` subclasses → their status code, anything
else → 500, with internals hidden outside `development` stage).

**Auth model:** stateless JWT access tokens (15 min, HS256, pinned
algorithm) + opaque, hashed, rotating refresh tokens (7 day) stored in
Postgres. Bearer tokens in the `Authorization` header — **not** cookies,
which is why CSRF protection was correctly deferred to Release 2 (see
`docs/production/R1-c_REFRESH_TOKENS.md`). Per-account login lockout
(5 failed attempts → 15 min lock, both config-driven) is DB-backed, not
Redis, because Release 1 runs single-instance (see
`docs/production/R1-d_ACCOUNT_LOCKOUT.md`).

**AI generation:** provider-agnostic abstraction (`apps/backend/src/ai/`)
supporting 10 providers (Anthropic, OpenAI, Gemini, xAI, OpenRouter,
DeepSeek, Together, Azure OpenAI, Bedrock, Ollama) behind one interface.
Auto-selects the first configured provider in priority order, or an
explicit `AI_PROVIDER` override. See
`docs/production/R1-e_AI_PROVIDER_ABSTRACTION.md` for the full design,
including a real bug found and fixed during Release 1 (ambient AWS
credentials silently activating Bedrock).

**Config and secrets:** two deliberately separate systems.
`apps/backend/src/config/` is a typed, zod-validated `AppConfig` assembled
once at startup (`initConfig()`) from stage-aware defaults + env vars —
never secrets. `apps/backend/src/secrets/` (`SecretsManager`) is the only
thing that reads actual credential values, from a pluggable source chain
(env var, Docker secret file, Kubernetes secret, in-memory placeholder for
local dev), with every read audit-logged. See
`docs/security/SECRET_MANAGEMENT.md` and
`docs/operations/ENVIRONMENT_MANAGEMENT.md`.

**Not yet wired into the running app** (code exists, not integrated):
MFA (`recover/mfa` branch) and CSRF (`recover/csrf` branch) — see §11
Known Limitations and `RELEASE_2_PLAN.md`.

Full architecture detail: `docs/architecture.md`, `docs/api.md`,
`docs/database.md`.

---

## 2. Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20+/22, Express 4, TypeScript (strict), ESM (`"type": "module"`) |
| Frontend | Next.js 15, React 19, TypeScript |
| Database | PostgreSQL 16, Prisma ORM 5.22 |
| Auth | Custom JWT (jsonwebtoken) + Argon2id password hashing (with transparent bcrypt migration) — NextAuth.js is a stated intent but not the current implementation |
| AI SDKs | `@anthropic-ai/sdk`, `openai` (also used for OpenAI-compatible providers), `@google/generative-ai`, `@aws-sdk/client-bedrock-runtime` |
| Validation | zod (every mutating route) |
| Logging | winston (console-only in production; file transports in dev only — see §7) |
| Testing | vitest (backend + web), supertest for HTTP-level tests, real Postgres (no DB mocks) |
| Build | tsup (backend bundle, esbuild-based — needed because `tsc` doesn't emit ESM-compatible extensioned imports), Next.js build (web), Turbo (monorepo orchestration) |
| Package manager | pnpm 10.33.0 (pinned via `packageManager` in root `package.json`; use corepack) |
| CI | GitHub Actions (`.github/workflows/ci.yml`) — 3 jobs: `test`, `security`, `docker` |
| Containerization | Docker, multi-stage, `node:22-bookworm-slim` |

---

## 3. Folder structure

```
synora/
├── apps/
│   ├── backend/                # Express API
│   │   ├── src/
│   │   │   ├── ai/            # Provider-agnostic AI abstraction (10 providers)
│   │   │   ├── config/        # Typed config (stage-aware defaults + env, zod-validated)
│   │   │   ├── db/            # Prisma singleton wrapper
│   │   │   ├── middleware/    # errorHandler, requestLogger, auth
│   │   │   ├── routes/        # auth, users, projects, documents, images, ai
│   │   │   ├── secrets/       # SecretsManager + pluggable sources + audit log
│   │   │   ├── services/      # password, token, lockout, mfa/* (not wired)
│   │   │   ├── utils/         # logger, etc.
│   │   │   ├── app.ts         # Express app assembly (middleware + route mounting)
│   │   │   └── index.ts       # Entry point: secrets→config→app.listen
│   │   └── tests/
│   └── web/                    # Next.js app (App Router)
│       └── src/app/
├── packages/
│   ├── database/                # Prisma schema + migrations + generated client re-export
│   │   └── prisma/
│   │       ├── schema.prisma    # 18 models: User, Account, Workspace(+Member/Invitation),
│   │       │                    # Project, Document, GeneratedImage/Video/Audio, ApiKey,
│   │       │                    # ActivityLog, Session, RefreshToken, MFAAuditLog, etc.
│   │       └── migrations/      # 3 applied: init, add_refresh_token, add_login_lockout
│   ├── shared/                   # Shared types, utils (ApiException hierarchy, etc.), constants
│   └── design-system/            # Shared React components
├── infrastructure/
│   ├── docker/
│   └── k8s/                     # Present but unused — R4 (hyperscale) work
├── docs/
│   ├── README.md                 # Full documentation hierarchy — read this first
│   ├── architecture.md, api.md, database.md, deployment.md, security.md
│   ├── operations/               # Environment management + migration guide
│   ├── security/                 # Secret management
│   ├── production/               # One doc per shipped R1 item (R1-a..R1-g, plus two
│   │                              # pre-R1 fixes), each with what-was-wrong /
│   │                              # what-changed / tests / verification
│   └── archive/                  # Historical, point-in-time reports — frozen, not
│                                  # living; see docs/archive/README.md
├── .github/workflows/ci.yml      # test, security, docker jobs
├── Dockerfile                    # Multi-stage production image
├── docker-compose.dev.yml        # Local Postgres for development
├── RELEASE_ROADMAP.md            # Living roadmap — R1 complete, R2-R4 planned
├── RELEASE_1_FINAL.md            # The authoritative Release 1 snapshot
├── RELEASE_1_LAUNCH_READINESS.md # R1's env vars, deploy commands, checklist
├── RELEASE_1_VERIFICATION_REPORT.md # Every CI issue found+fixed stabilizing R1's pipeline
├── PRODUCTION_READINESS_AUDIT.md # Final CTO-level audit after R1 shipped
├── RELEASE_2_PLAN.md             # Next release's plan
└── package.json                  # Root workspace config, packageManager pin
```

Every markdown file that predates Release 1's completion and described a
past, incomplete state (independent reviews, certification reports, a
git-forensics investigation, early PR-description drafts) has been moved
into `docs/archive/` — see `docs/archive/README.md` for why each is kept.
Nothing at the repo root today is a stale snapshot; if you find one that
is, that's a regression from this state, not the norm.

---

## 4. Environment variables

The authoritative, currently-accurate list — organized by required vs.
optional, with defaults — is `RELEASE_1_LAUNCH_READINESS.md` §2. Summary:

**Required to boot in staging/production** (the app fail-closed exits if
missing): `DATABASE_URL`, `JWT_SECRET`, `NEXTAUTH_SECRET`.

**Everything else has a working default** — `NODE_ENV`, `APP_STAGE`,
`PORT`, URLs, lockout thresholds, operating-mode flags. See
`.env.example` at the repo root for the complete, currently-accurate list
with inline comments — copy it, don't retype it.

Config is stage-aware (`APP_STAGE`: `development | testing | qa | staging
| production`) and mode-aware (`OFFLINE_MODE`, `MOCK_MODE`,
`ENTERPRISE_MODE`, `GOVERNMENT_MODE`, `SELF_HOSTED_MODE` — independent
flags, any combination). Full model: `docs/operations/ENVIRONMENT_MANAGEMENT.md`.

---

## 5. Required API keys

None are required for the app to boot or to serve auth/CRUD routes. For
real AI generation, set **at least one** provider's key — see
`RELEASE_1_LAUNCH_READINESS.md` §2.2 for the full priority-ordered list
(Anthropic is the default) and each provider's exact required variable(s).
Notably: AWS Bedrock requires `BEDROCK_REGION` explicitly (no default) in
addition to the AWS credential pair — this is deliberate, not an
oversight, see `docs/production/R1-e_AI_PROVIDER_ABSTRACTION.md`'s "Bug
found and fixed" section for why.

The full secret catalog (what each secret is for, which environments need
it, rotation cadence) is `apps/backend/src/secrets/registry.ts`, which is
also what `docs/security/SECRET_MANAGEMENT.md`'s environment matrix is
generated from.

---

## 6. Deployment steps

Full detail: `RELEASE_1_LAUNCH_READINESS.md` §3. Summary:

```bash
# 1. Build the image
docker build -t synora-backend:latest -f Dockerfile .

# 2. Run migrations (every deploy — idempotent)
DATABASE_URL="<prod-db-url>" pnpm --filter @synora/database db:migrate

# 3. Run the container
docker run -d --name synora-backend \
  -e NODE_ENV=production -e APP_STAGE=production -e PORT=3001 \
  -e DATABASE_URL="<prod-db-url>" \
  -e JWT_SECRET="<generated>" -e NEXTAUTH_SECRET="<generated>" \
  -e ANTHROPIC_API_KEY="<real-key>" \
  -p 3001:3001 synora-backend:latest

# 4. Verify
curl -f http://<host>:3001/health   # liveness
curl -f http://<host>:3001/ready    # readiness (probes DB)
```

Release 1 relies on a **managed** Postgres provider (RDS, Neon, Supabase,
Railway) for automated backups/PITR — this is a deployment choice, not
app code (owning the backup job in-app is R2-g, Release 2).

There is no CD pipeline yet (R2-e, Release 2) — every deploy above is
manual.

---

## 7. Database migration process

Prisma Migrate, standard workflow:

```bash
# Local dev — creates + applies a new migration, regenerates the client
pnpm run db:migrate:dev    # exposed at root too, both fan out to @synora/database

# CI / staging / production — applies pending migrations only, no prompts
pnpm run db:migrate        # runs `prisma migrate deploy`

# Regenerate the client without migrating (e.g. after a schema-only pull)
pnpm run db:generate

# Reset the local dev database (destructive — dev only)
pnpm run db:reset

# Open Prisma Studio
pnpm run db:studio
```

Schema lives at `packages/database/prisma/schema.prisma`; 4 migrations
currently applied (`20260721000000_init`,
`20260722000000_add_refresh_token`, `20260722010000_add_login_lockout`,
`20260723192205_drop_redundant_unique_indexes`). `migrate deploy` is safe
to run on every deploy, including when there's nothing pending. There is
no seed script and no seed data configured — an earlier `db:seed` script
referenced a `prisma/seed.ts` file that never existed and was removed in
the post-Release-1 audit.

**CI note:** the `test` job in `ci.yml` runs `db:generate` then
`db:migrate` against a real `postgres:16-alpine` service container before
running tests — no DB mocks anywhere in the test suite.

---

## 8. CI/CD pipeline

`.github/workflows/ci.yml`, three jobs, all currently green (see
`RELEASE_1_VERIFICATION_REPORT.md` for the full stabilization history —
worth reading before touching this file, since several of the fixes there
address non-obvious environment-specific failures):

| Job | What it does | Blocking? |
|---|---|---|
| `test` | install → `db:generate` → `db:migrate` (real Postgres service container) → lint → type-check → full test suite → build → coverage upload | Yes |
| `security` | `pnpm audit --prod --audit-level=high` (blocking, token-free) → gitleaks secret scan via `ghcr.io/gitleaks/gitleaks:v8.21.2` Docker image (blocking, token-free; false positives allowlisted in `.gitleaksignore`) → Snyk (best-effort, `continue-on-error: true`, needs `SNYK_TOKEN`) | Yes (first two gates) |
| `docker` | Buildx build of the production image → smoke test: run the container, poll `/health` for 30s | Yes |

No CD (auto-deploy on merge/tag) exists yet — that's R2-e.

**Non-obvious things to know before modifying this file:**
- The `docker` job's smoke test is the *only* thing that exercises the
  container as its actual non-root runtime user with real Docker
  networking — several Release 1 bugs (a winston file-logging permission
  crash, a missing explicit `0.0.0.0` bind, a missing-OpenSSL Prisma
  failure) were invisible in every host-level local verification and only
  surfaced here. Don't skip or weaken this smoke test.
- `pnpm prune --prod` is deliberately **not** used in the Dockerfile — at
  this workspace's root, it deletes production-dependency symlinks, not
  just dev ones (see `RELEASE_1_VERIFICATION_REPORT.md` Issue 2). The
  image ships the full, unpruned `node_modules`; this is an accepted,
  documented Release 1 tradeoff, not an oversight.

---

## 9. Docker deployment

Multi-stage `Dockerfile`, `node:22-bookworm-slim` base (glibc, not musl —
the argon2 native addon and Prisma's query engine are both smoother on
glibc). Builder stage: installs OpenSSL (required for Prisma's engine to
correctly detect the platform and load — bookworm-slim ships none by
default), installs the full workspace, runs `prisma generate` + the
backend's `tsup` bundle. Runtime stage: also installs OpenSSL, copies the
builder's entire `/app` (unpruned — see §8), runs as the base image's
non-root `node` user, `EXPOSE 3001`, bakes a `HEALTHCHECK` hitting
`/health`.

`.dockerignore` excludes `node_modules`, all build output, `.git`, and —
critically — every `.env*` file except `.env.example`, so no secret
material can enter an image layer.

Local dev uses `docker-compose.dev.yml` for a local Postgres instance
only; the app itself runs via `pnpm dev`, not in Docker, during
development.

---

## 10. Production checklist

Before a real launch, per `RELEASE_1_LAUNCH_READINESS.md`:

- [ ] Provision a managed Postgres instance with automated backups/PITR enabled
- [ ] Generate real `JWT_SECRET` and `NEXTAUTH_SECRET` (`openssl rand -base64 32` each)
- [ ] Set `APP_STAGE=production`, `NODE_ENV=production`
- [ ] Set at least one AI provider's API key (Anthropic recommended as the default)
- [ ] Run `db:migrate` against the production database
- [ ] Build and deploy the Docker image; verify `/health` and `/ready` both return 200
- [ ] Confirm CI is green on the commit being deployed (`test`, `security`, `docker`)
- [ ] Decide whether Release 2's MFA/CSRF work needs to land before this specific launch (see §11)

---

## 11. Known limitations

Deliberate Release 1 scope decisions — not bugs, but real gaps a new
engineer should know about before assuming feature parity with a mature
SaaS:

- **No MFA enforced anywhere.** The core implementation (TOTP,
  challenge/setup/recovery-code services, `routes/mfa.ts`, 4 frontend
  components, `useMFASetup` hook, RFC 4226/6238 test vectors, DB migration)
  exists only on the `recover/mfa` branch and needs rebasing onto the
  current base. Separately, 4 MFA-*adjacent* services already sit in
  mainline at `apps/backend/src/services/mfa/` (`audit.service.ts`,
  `rate-limiter.service.ts`, `monitoring.service.ts`,
  `alerting.service.ts`) with their own passing tests — but they are
  genuinely dead code today: nothing outside their own test files imports
  them. Both halves land together in Release 2, R2-a.
- **No CSRF protection**, despite a complete implementation existing on
  `recover/csrf`. Correctly deferred: R1 uses bearer tokens in the
  `Authorization` header, which aren't CSRF-vulnerable; CSRF only becomes
  necessary once auth moves to browser-auto-sent cookies. Release 2, R2-b.
- **Single-instance only.** Login lockout and rate-limiting are DB-backed,
  correct for one instance, but won't correctly share state across ≥2
  instances. Release 2, R2-c (Redis).
- **No image/video/audio generation** — only text/code, served
  synchronously. Media needs an async job queue + object storage, neither
  of which exist yet. Release 2, R2-d.
- **Manual deploys only** — no CD pipeline. Release 2, R2-e.
- **Minimal observability** beyond `/health`, `/ready`, and winston
  console logs — no `/metrics` endpoint, no alerting, no distributed
  tracing. Release 2, R2-f.
- **Backup/restore relies entirely on the managed Postgres provider** —
  the app owns no backup job of its own. Acceptable for Release 1
  (documented as a deployment requirement, not a gap), upgraded in
  Release 2, R2-g.
- **No workspace multi-tenancy enforcement** — routes scope by `userId`
  (basic per-user isolation exists and is correct), but full
  workspace-tenant isolation is Release 3 (enterprise) scope.
- **Frontend has no wired state management** — `zustand`,
  `@tanstack/react-query`, `axios` are declared dependencies but the
  actual `apps/web` code uses raw `fetch` + `useState` + `localStorage`.
  Not tracked in the current roadmap as an R2/R3 item; flag to the team if
  it should be.
- **`infrastructure/k8s/` exists but is unused** — Kubernetes manifests
  are explicitly Release 4 (hyperscale) scope; don't assume anything in
  that directory is current or tested.

---

## 12. Release 2 prerequisites

Full plan: `RELEASE_2_PLAN.md`. Before starting:

- **Infrastructure to provision:** a managed Redis instance (R2-c, and a
  hard dependency for R2-d's job queue); an S3-compatible object storage
  bucket (needed for R2-d's media results to persist); confirm the CD
  platform target (R2-e) and the metrics/alerting backend target (R2-f)
  before implementation, since both shape the concrete work.
- **Code already exists, needs rebasing not rebuilding:** `recover/mfa`
  and `recover/csrf` branches — both are complete implementations that
  predate several Release 1 changes (Prisma singleton, refresh-token
  schema, `app.ts` restructuring), so landing them is a rebase +
  re-verification job, not new development. The 4 already-in-mainline
  MFA-adjacent services at `apps/backend/src/services/mfa/` (see §11) will
  need re-review during that rebase too — confirm they still match
  whatever `recover/mfa`'s `mfa.service.ts` expects before wiring them in.
- **Outstanding administrative step from Release 1:** this session's git
  credentials were scoped to push only the `claude/synora-ai-platform-h5q0k2`
  branch — tagging the Release 1 commit as `v1.0.0` and creating the
  corresponding GitHub Release were both requested but blocked by that
  scope (tag push returned HTTP 403; no GitHub Release-creation tool was
  available in this session's toolset either). Whoever has full repo
  write access should tag the current HEAD of this branch (the frozen,
  final Release 1 state — confirm with `git log -1`) as `v1.0.0` and
  create the GitHub Release "Release 1.0.0 - Production Ready" before or
  alongside starting Release 2 work, so the tag exists as a real rollback
  point.
- **Founder decisions to reconfirm:** both decisions flagged in
  `RELEASE_ROADMAP.md` (MFA/CSRF deferred to R2; AI is text/code-first in
  R1) were correct as of Release 1's launch. If priorities have shifted,
  re-confirm before starting Release 2's M1 (auth hardening) or M3 (media).
