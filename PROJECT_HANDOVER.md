# Synora — Project Handover

**As of:** 2026-07-25 — Release 2 in progress, **Milestone 1 complete**
(design system + frontend infrastructure), branch
`claude/synora-ai-platform-h5q0k2` @ `337641c`, CI green.

Written for a senior engineer (or CTO) joining with zero prior context.
It covers vision, what exists, how it's built, how to run and deploy it,
what's deliberately not done, and exactly what to do next. Where a topic
has its own detailed doc, this summarizes and links rather than
duplicating. Companion documents:

- `CURRENT_STATE.md` — the precise point-in-time state (updated per milestone)
- `NEXT_TASK.md` — the single next development task, always current
- `RELEASE_1_FINAL.md` — the frozen Release 1 snapshot
- `RELEASE_2_PLAN.md` — the active release plan (9 milestones)
- `docs/README.md` — index of everything else

---

## 1. Vision and long-term goals

Synora is to become **one of the world's best AI creation platforms**: a
premium, enterprise-grade SaaS where creators generate text, code,
images, video, and audio, collaborate in workspaces, and automate
workflows — with UI polish comparable to Linear, Vercel, Framer, Raycast.

Non-negotiable principles (founder-set, restated at every release):
- Production-grade and future-proof only; no temporary or throwaway code.
- Every module scalable to millions of users.
- **Provider-agnostic everywhere** — AI, payments, email, storage are all
  replaceable through configuration only; the platform must eventually be
  able to run entirely on Synora's own AI models without architectural
  change.
- Launch requires only: set env vars → configure payment/AI/email keys →
  deploy. Everything else already works.

## 2. Current architecture (summary)

Monorepo SaaS: Next.js 15 frontend, Express 4/TypeScript backend REST
API, PostgreSQL 16 via Prisma, one pnpm workspace built with Turbo.

- **Frontend**: App Router; TanStack Query + Zustand wired (M1); typed
  API client with single-flight refresh-token rotation; dark-first
  CSS-variable design tokens via `@synora/design-system`; Geist fonts.
- **Backend**: `helmet → CORS → rate limit → json → requestLogger →
  zod-validated routes → errorHandler`; startup is secrets → typed
  config (fail-closed in staging/prod) → listen on `0.0.0.0`.
- **Auth**: 15-min HS256 JWT access tokens + 7-day opaque, hashed,
  single-use rotating refresh tokens in Postgres; bearer header (not
  cookies — CSRF deferred with the cookie migration to M5).
- **AI**: provider-agnostic abstraction, 10 providers, config-only
  selection (`AI_PROVIDER` override or first-configured priority order).
- **Config/secrets**: two separate systems — typed zod-validated
  `AppConfig` vs audited `SecretsManager` reads.

Full detail: `docs/architecture.md` (kept current; includes request
lifecycle, security layers, scaling, and future queue/memory/agent
sections explicitly marked not-implemented).

## 3. Folder structure

```
synora/
├── apps/
│   ├── backend/                # Express API
│   │   ├── src/
│   │   │   ├── ai/            # Provider-agnostic AI abstraction (10 providers)
│   │   │   ├── config/        # Typed config (stage-aware defaults + env, zod)
│   │   │   ├── db/            # Prisma singleton wrapper
│   │   │   ├── middleware/    # errorHandler, requestLogger, auth
│   │   │   ├── routes/        # auth, users, projects, documents, images, ai
│   │   │   ├── secrets/       # SecretsManager + sources + audit log + registry
│   │   │   ├── services/      # password, token, lockout, mfa/* (not wired)
│   │   │   ├── utils/         # logger, etc.
│   │   │   ├── app.ts         # Express app assembly
│   │   │   └── index.ts       # Entry: secrets→config→listen
│   │   └── tests/
│   └── web/                    # Next.js app (App Router)
│       ├── postcss.config.js   # tailwindcss + autoprefixer (added M1 — Tailwind
│       │                       # never compiled before this existed)
│       ├── tailwind.config.ts  # consumes @synora/design-system/tailwind-preset
│       └── src/
│           ├── app/            # layout (fonts/theme/providers), page, providers.tsx,
│           │                   # auth/{login,register}, dashboard
│           ├── lib/api/        # client.ts, auth.ts, types.ts (+tests)
│           ├── lib/auth/       # token-storage.ts (+tests)
│           └── stores/         # auth-store.ts (+tests)
├── packages/
│   ├── database/               # Prisma schema (18 models) + 4 migrations
│   ├── shared/                 # ApiException hierarchy, createApiResponse, types
│   └── design-system/          # M1: tokens + preset + 17 components + 16 tests
│       ├── src/components/     # Button, Input, Textarea, Label, Card, Badge,
│       │                       # Skeleton, Spinner, Separator, Kbd, Dialog, Tabs,
│       │                       # Switch, Tooltip, Avatar, DropdownMenu, Toaster
│       ├── src/lib/cn.ts       # clsx + tailwind-merge
│       ├── src/styles/tokens.css
│       └── tailwind-preset.cjs (+ .d.ts)
├── infrastructure/docker/, infrastructure/k8s/   # k8s unused — R4 scope
├── docs/                       # See §19 Documentation hierarchy
├── .github/workflows/ci.yml    # test, security, docker jobs
├── Dockerfile                  # Multi-stage production image (backend)
├── docker-compose.dev.yml      # Local Postgres
├── PROJECT_HANDOVER.md         # This file
├── CURRENT_STATE.md            # Point-in-time state
├── NEXT_TASK.md                # The single next task
├── RELEASE_ROADMAP.md          # R1 ✅ / R2 active / R3 / R4
├── RELEASE_1_FINAL.md          # Frozen R1 snapshot
├── RELEASE_2_PLAN.md           # Active plan, 9 milestones
└── package.json                # Workspace root, packageManager pin (pnpm 10.33.0)
```

## 4. Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20+/22, Express 4, TypeScript (strict), ESM |
| Frontend | Next.js 15 (App Router), React 19, TypeScript |
| State | TanStack Query 5 (server state) + Zustand 4 (UI/auth state) |
| Styling | Tailwind CSS 3.4 + `@synora/design-system` tokens/preset, next-themes (dark-first), Geist fonts |
| Components | `@synora/design-system` on Radix primitives, cva, tailwind-merge, sonner |
| Database | PostgreSQL 16, Prisma 5.22 |
| Auth | Custom JWT (jsonwebtoken) + Argon2id (transparent bcrypt migration) |
| AI SDKs | `@anthropic-ai/sdk`, `openai` (also for OpenAI-compatible providers), `@google/generative-ai`, `@aws-sdk/client-bedrock-runtime` |
| Validation | zod (every mutating route + config schema) |
| Logging | winston (console-only in production) |
| Testing | vitest everywhere; supertest (backend HTTP); Testing Library + jsdom (web, design-system); real Postgres, no DB mocks |
| Build | tsup (backend), Next build (web), tsc (packages), Turbo |
| Package manager | pnpm 10.33.0 (pinned; use corepack) |
| CI | GitHub Actions: `test`, `security`, `docker` — all blocking |
| Container | Docker multi-stage, `node:22-bookworm-slim` |

## 5. Completed milestones

**Release 1 (complete — see `RELEASE_1_FINAL.md`):** R1-a..R1-h — auth
with rotating refresh tokens + lockout, user/project/document CRUD, AI
text/code generation behind the 10-provider abstraction, config/secrets
systems, security hardening, full CI stabilization (see
`RELEASE_1_VERIFICATION_REPORT.md` for every bug found/fixed), Docker
production image, docs consolidation.

**Release 2 — M1: Foundation (complete, commits `1dc9975` + `337641c`):**
- Design tokens (dark default, light override), shared Tailwind preset
- 17-component design-system library on Radix primitives, 16 tests
- **Fixed a latent R1 gap**: no `postcss.config.js` existed anywhere, so
  Tailwind had never actually compiled; pages were rendering unstyled
- Typed API client (envelope-aware, bearer, single-flight 401 refresh),
  auth API wrapper, SSR-safe token storage, Zustand auth store — 13 tests
- TanStack Query + next-themes providers, Geist fonts, root layout
- Legacy pages (landing, login, register, dashboard) converted to token
  classes; skeleton loading states
- Next 15 config cleanup (`swcMinify`/`appDir` removed, `remotePatterns`)
- `RELEASE_2_PLAN.md` rewritten for the expanded full-platform scope

## 6. Current branch / PR / CI / Git status

- **Branch**: `claude/synora-ai-platform-h5q0k2` (all work happens here)
- **HEAD**: `337641c` — "fix(design-system): add @vitest/coverage-v8 for CI test:coverage"
- **PR**: #31 → base `SYNORA`, **open, not merged**. Note: `SYNORA`'s tip
  is still `7bd7f5d` (a squash-merge of PR #30, an earlier parallel
  implementation); `f80cebe` on this branch merged that in with all
  conflicts resolved in favor of the verified implementation. All
  Release 1 + Release 2 work flows through PR #31.
- **CI**: green on `337641c` — run 30145780034: `test` ✅ `security` ✅
  `docker` ✅
- **Working tree**: clean at handover time (verify with `git status`)
- Session git credentials are scoped to push only this branch; the
  `v1.0.0` tag + GitHub Release for Release 1 still need someone with
  full repo access (see `RELEASE_1_FINAL.md`).

## 7. Database models

18 models in `packages/database/prisma/schema.prisma` (full column docs:
`docs/database.md`):

- **Identity**: `User` (role USER/ADMIN/MODERATOR, status, lockout
  fields), `Account` (OAuth placeholder, unused), `UserProfile`,
  `UserPreferences`
- **Workspaces** (schema ready, no routes yet — M5): `Workspace`,
  `WorkspaceMember` (OWNER/ADMIN/EDITOR/MEMBER/VIEWER),
  `WorkspaceInvitation`, `ApiKey`
- **Content**: `Project`, `Document`, `GeneratedImage`, `GeneratedVideo`,
  `GeneratedAudio` (media rows only written by placeholder routes today)
- **Auth**: `RefreshToken` (SHA-256 hash only, revocation, expiry),
  `Session`/`VerificationToken` (NextAuth placeholders, unused)
- **Audit**: `ActivityLog`, `MFAAuditLog` (soft user reference by design)

Migrations applied (4): `init`, `add_refresh_token`,
`add_login_lockout`, `drop_redundant_unique_indexes`. No seed script.

## 8. Authentication flow

Register/login → `{ accessToken (15m JWT), refreshToken (7d opaque,
rotating), user }` (+ deprecated `token` alias until M3 rewires the
legacy pages). Authenticated calls use `Authorization: Bearer`. Refresh
rotates and revokes single-use; reuse is detected. Logout revokes.
Lockout: 5 fails → 15 min (config-driven), DB-backed. The M1 API client
automates the 401 → refresh → retry cycle single-flight. Bearer-not-
cookies is deliberate (CSRF lands with the cookie migration, M5).
Detail: `docs/api.md`, `docs/production/R1-c_REFRESH_TOKENS.md`.

## 9. AI provider architecture

`apps/backend/src/ai/` — descriptor registry + resolver + facade
(`generateText()`). 10 providers: Anthropic, OpenAI, Gemini, xAI,
OpenRouter, DeepSeek, Together, Azure OpenAI, Bedrock, Ollama.
Selection: `AI_PROVIDER` override, else first configured in priority
order. Adding a provider = one descriptor file. Bedrock requires
explicit `BEDROCK_REGION` (no default) so ambient AWS credentials never
silently activate a billable provider. Vendor errors wrapped in
`AIProviderError`. Self-hosted future models plug in as descriptors
(Ollama already proves the path). Detail:
`docs/production/R1-e_AI_PROVIDER_ABSTRACTION.md`.

## 10. API routes

Envelope: success `{ success: true, data, meta }`; error
`{ success: false, error: { code, message, details? } }`. Detail with
examples: `docs/api.md`.

| Route | Methods | Auth | Notes |
|---|---|---|---|
| `/health` | GET | — | liveness (Docker HEALTHCHECK, CI smoke test) |
| `/ready` | GET | — | readiness, probes DB |
| `/api/auth/register`, `/login`, `/refresh`, `/logout` | POST | — | see §8 |
| `/api/users/me`, `/api/users/:id` | GET | Bearer | |
| `/api/projects` `/`, `/:id` | GET/POST/GET | Bearer | scoped by userId |
| `/api/documents` `/`, `/:id` | GET/POST/GET | Bearer | scoped by userId |
| `/api/images` `/`, `/generate`, `/:id` | GET/POST/GET | Bearer | `/generate` is a **placeholder** (hardcoded URL, no provider call) until M6 |
| `/api/ai/generate` | POST | Bearer | real text/code generation, synchronous |

## 11. Frontend architecture & design system

See `docs/architecture.md` §Frontend and §Design System for the full
description. Key points: dark-first token theming (`data-theme`
attribute, next-themes), shared Tailwind preset, typed API client with
automatic refresh rotation, TanStack Query/Zustand wired, 4 pages today
(landing placeholder, login, register, dashboard) — the login/register/
dashboard pages still run their original raw-fetch logic and are rebuilt
on the new client in M3. The design system is the only sanctioned way to
build UI from M2 onward; do not hand-roll one-off styled controls.

## 12. Current deployment strategy

Manual, backend-only Docker image (the web app is not yet part of the
deploy story — that decision lands with M9/CD):

```bash
docker build -t synora-backend:latest -f Dockerfile .
DATABASE_URL="<prod>" pnpm --filter @synora/database db:migrate
docker run -d -e NODE_ENV=production -e APP_STAGE=production \
  -e DATABASE_URL=... -e JWT_SECRET=... -e NEXTAUTH_SECRET=... \
  -e ANTHROPIC_API_KEY=... -p 3001:3001 synora-backend:latest
curl -f http://<host>:3001/health && curl -f http://<host>:3001/ready
```

Managed Postgres (RDS/Neon/Supabase/Railway) supplies backups/PITR. No
CD until M9 (R2-e). Dockerfile subtleties that must not be "cleaned up":
no `pnpm prune --prod` (corrupts workspace symlinks), explicit OpenSSL
install (Prisma on bookworm-slim), non-root user, `0.0.0.0` bind — all
documented in `RELEASE_1_VERIFICATION_REPORT.md`.

## 13. Environment variables

Authoritative list: `.env.example` (root + per-app) and
`RELEASE_1_LAUNCH_READINESS.md` §2. Summary:
- **Required to boot (staging/prod, fail-closed)**: `DATABASE_URL`,
  `JWT_SECRET`, `NEXTAUTH_SECRET`
- **Defaults exist for**: `NODE_ENV`, `APP_STAGE`, `PORT`, URLs, lockout
  thresholds, mode flags (`OFFLINE_MODE`, `MOCK_MODE`, etc.)
- **AI (any one enables generation)**: `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, `XAI_API_KEY`,
  `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `TOGETHER_API_KEY`,
  `AZURE_OPENAI_API_KEY`(+endpoint/deployment), AWS pair +
  `BEDROCK_REGION`, `OLLAMA_BASE_URL`; `AI_PROVIDER` to force one
- **Frontend**: `NEXT_PUBLIC_API_URL`
- Secret catalog with owners/rotation: `apps/backend/src/secrets/registry.ts`

## 14. Security architecture

Layered: helmet → CORS allowlist → IP rate limiting → zod validation →
pinned-algorithm JWT → per-account lockout → Argon2id (+bcrypt
migration) → hashed single-use refresh tokens with reuse detection →
Prisma parameterized queries → error handler hiding internals → audited
secret reads → CI security gates (audit high+, gitleaks, Snyk
best-effort) → non-root Docker, no `.env` in layers. Deliberately not
yet: MFA (M5), CSRF/cookies (M5), Redis-shared limits (M6). Full doc:
`docs/security.md`.

## 15. Testing status

- **Backend**: 273 tests (vitest + supertest, real Postgres)
- **Web**: 14 tests (API client incl. 401-refresh-retry and
  single-flight, token storage, auth store, page smoke)
- **Design system**: 16 tests (components + cn)
- **Total: 303, all green in CI** on `337641c`
- E2E (Playwright): none yet — M9 (R2-h). Coverage uploaded, not gated.
- Local run needs `DATABASE_URL` exported (CI value:
  `postgresql://synora:synora@localhost:5432/synora`) and `CI=1` to
  stop vitest watch mode.

## 16. Documentation hierarchy

`docs/README.md` is the index. Living reference docs (update with code):
`docs/architecture.md`, `api.md`, `database.md`, `deployment.md`,
`security.md`; plus `docs/operations/`, `docs/security/`,
`docs/production/` (one doc per shipped R1 item). Frozen history:
`docs/archive/` (see its README). Root-level: this file,
`CURRENT_STATE.md`, `NEXT_TASK.md`, `RELEASE_ROADMAP.md`,
`RELEASE_1_FINAL.md`, `RELEASE_2_PLAN.md`, plus R1 verification/audit
reports. There is no changelog file — release history lives in the
roadmap + release docs.

## 17. Known limitations

- MFA not wired (code on `recover/mfa` + 4 dead mainline services under
  `services/mfa/`) — M5
- No CSRF (bearer tokens make it moot until cookie auth) — M5
- Single-instance only (DB-backed lockout/rate-limit state) — M6
- Media generation is a placeholder route; no queue, no object storage — M6
- Manual deploys; no CD, no `/metrics`, no alerting — M9
- No workspace-tenancy route enforcement (schema only) — M5/R3
- Legacy pages (login/register/dashboard) still on raw fetch +
  `localStorage['token']` — rebuilt in M3
- `next-auth` + `axios` declared but unused (axios removal is queued for
  M3 when the last raw-fetch pages die)
- `infrastructure/k8s/` is an unused placeholder — R4

## 18. Production readiness

Backend is production-ready **for a single-instance, text/code-only
launch** (that was Release 1's bar — see `PRODUCTION_READINESS_AUDIT.md`).
The customer-facing platform is **not** launch-ready: marketing site,
real auth UX, billing, teams, media generation, admin, observability all
arrive across M2–M9. Track precise per-area status in
`CURRENT_STATE.md`.

## 19. Exact next task

**M2 — Marketing site.** Always read `NEXT_TASK.md` (single source of
truth for the next task); it currently specifies M2 in full: premium
animated landing page, pricing page, feature pages, changelog, built
exclusively from the design system, with the milestone gate
(lint/typecheck/test/build → commit → push → green CI) before M3.

## 20. Things that must never be changed

1. **Provider-agnosticism**: no route, service, or UI may import a vendor
   AI SDK directly — everything goes through `apps/backend/src/ai/`.
2. **Config-only provider swaps**: adding/selecting providers must never
   require code changes at call sites.
3. **Secrets discipline**: credentials are read only via SecretsManager;
   never from `process.env` at call sites; never logged.
4. **Auth invariants**: refresh tokens stored hashed only; single-use
   rotation with reuse detection; JWT algorithm stays pinned.
5. **Dockerfile load-bearing decisions**: no `pnpm prune --prod`;
   explicit OpenSSL; non-root user; `0.0.0.0` bind; `.env*` excluded.
6. **CI gates stay blocking** (test, security, docker smoke test) — never
   weaken or skip to get green.
7. **Milestone gate**: lint + typecheck + tests + build green, commit,
   push, green CI — before starting the next milestone.
8. **Design tokens**: UI colors/radii/fonts come from the token system;
   no hardcoded palette values in app code.
9. **Release 1 behavioral guarantees** (API envelope, auth semantics,
   lockout behavior) are preserved unless a release plan explicitly
   changes them.

## 21. Coding standards

Per `CLAUDE.md` (authoritative): TypeScript strict, explicit return
types, no `any` (use `unknown`); conventional commits
(`type(scope): description`); components PascalCase files, utils
camelCase; tests colocated (`*.test.ts(x)`) or in `tests/`; every
feature ships with unit + integration tests (E2E suite arrives M9);
accessibility required (the design system's Radix base helps but
doesn't absolve page-level semantics); update the relevant `docs/*` file
whenever a change touches it.

## 22. Architectural decisions and reasons

Consolidated with rationale in `docs/architecture.md` §"Architectural
Decisions" — monorepo, REST-first, Prisma, custom JWT over NextAuth,
bearer-now/cookies-later, CSS-variable tokens + shared preset, Radix
primitives, Geist-via-npm (no build-time font fetch), dist-consumed
design system, config/secrets separation, sync-text/async-media split.

## 23. Release roadmap / future roadmap

- **R1** ✅ launchable core (frozen: `RELEASE_1_FINAL.md`)
- **R2** ▶ complete customer-facing platform — 9 milestones in
  `RELEASE_2_PLAN.md`: M1 ✅ foundation; M2 marketing site; M3 auth
  UX/onboarding/app shell; M4 projects/playground/prompt library; M5
  teams/settings/API keys + MFA + CSRF; M6 Redis/queue/media/assets; M7
  billing/usage/notifications; M8 admin/support/docs-site/blog; M9
  E2E/CD/observability/closeout
- **R3** enterprise: workspace tenancy enforcement, SSO, deeper audit,
  agent/memory candidates
- **R4** hyperscale: Kubernetes, multi-region, read replicas,
  self-hosted Synora model serving (interface designs exist on
  `feature/synora-infra-interfaces`)
