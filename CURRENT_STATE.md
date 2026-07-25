# Synora — Current State

**Snapshot date:** 2026-07-25
**Maintenance rule:** update this file at the end of every milestone
(same commit as the milestone's closing work). Everything below is
verified against the repository, not assumed.

## Release / Milestone position

- **Current release:** Release 2 — "Complete customer-facing platform"
  (`RELEASE_2_PLAN.md`)
- **Current milestone:** M2 (Marketing site) **complete**; M3 (Auth UX +
  onboarding + app shell) is the active next task (`NEXT_TASK.md`)
- **Current branch:** `claude/synora-ai-platform-h5q0k2`
- **Current commit:** `88496ca` — feat(web): Release 2 M2 — marketing
  site (landing, pricing, features, changelog)
- **Current PR:** #31 → `SYNORA`, open, not merged (base tip `7bd7f5d`)
- **Current CI status:** ✅ green through `337641c` (docs commit
  `323f284` and the M2 push verified after this snapshot; gate rule: M3
  does not start until the M2 push is green)

## Completed features (working end-to-end)

- Registration, login, token refresh (rotating, reuse-detected), logout,
  account lockout — backend + tests
- User/me, projects CRUD (list/create/get), documents CRUD
  (list/create/get) — scoped by userId
- AI text/code generation (`POST /api/ai/generate`) through the
  10-provider abstraction; provider chosen purely by configuration
- Typed config system (stage-aware, zod, fail-closed) + SecretsManager
  (audited reads, pluggable sources, secret catalog)
- CI pipeline (test / security / docker smoke) — all blocking, all green
- Production Docker image (multi-stage, non-root, healthcheck)
- **M1 foundation:** design tokens (dark default/light override), shared
  Tailwind preset, 17-component design-system library (Radix-based) with
  16 tests, working Tailwind pipeline (postcss config added — Tailwind
  had never compiled before M1), typed API client with single-flight
  401-refresh-retry, token storage, Zustand auth store, TanStack Query +
  next-themes providers, Geist fonts, token-styled pages
- **M2 marketing site:** `(marketing)` route group with glass navbar
  (mobile menu, theme toggle) + footer; animated landing page; pricing
  page + FAQ; six SSG feature pages from one template; changelog
  timeline — all driven by typed content modules under
  `apps/web/src/content/`; sitemap/robots/OpenGraph; browser-verified
  desktop/mobile in both themes

## Working but interim (functional today, scheduled for replacement)

- Login/register/dashboard pages: styled with the design system but
  still using their original raw `fetch` + `localStorage['token']` logic
  — rebuilt on the new API client + auth store in **M3**
- Landing page: token-styled placeholder — replaced by the real
  marketing site in **M2**
- Backend auth responses carry a deprecated `token` alias for
  `accessToken` until M3 removes the last consumer

## Partially completed features

- **Workspaces/teams:** full Prisma schema (Workspace, Member,
  Invitation, ApiKey) exists; zero routes/UI — M5
- **MFA:** complete implementation on `recover/mfa` branch (needs
  rebase); 4 MFA-adjacent services in mainline (`services/mfa/`) are
  tested but dead code — M5
- **CSRF:** complete implementation on `recover/csrf` branch; lands with
  the cookie-auth migration — M5
- **Media generation:** `POST /api/images/generate` returns a hardcoded
  placeholder URL; GeneratedImage/Video/Audio models exist — real
  pipeline (Redis, queue, workers, object storage) is M6

## Pending features (not started)

Marketing site (M2); onboarding, workspace creation flow, app shell,
command palette (M3); AI playground, prompt library, model selector UI,
provider management UI, generation history (M4); team management,
org/security/account settings, session management UI, API key UI (M5);
image/video/audio generation + asset manager + uploads (M6); billing,
subscriptions, usage dashboard, analytics, notifications (M7); admin +
monitoring dashboards, audit log viewer, feedback, support center, docs
site, blog, API docs (M8); Playwright E2E, CD, `/metrics`, alerting,
backups (M9).

## Current UI

4 routes: `/` (placeholder landing), `/auth/login`, `/auth/register`,
`/dashboard` — all dark-first, token-styled, design-system components,
Geist type. No marketing pages, no app shell beyond the basic dashboard
sidebar. Verified rendering in a real browser (Chromium screenshots)
during M1.

## Current backend

Express 4 / TS strict / ESM. Routes: `/health`, `/ready`, `/api/auth/*`
(4), `/api/users/*` (2), `/api/projects/*` (3), `/api/documents/*` (3),
`/api/images/*` (3, generate = placeholder), `/api/ai/generate`.
Middleware chain and startup order documented in
`docs/architecture.md`. Unchanged in M1 except nothing — M1 was
frontend-only plus docs.

## Current AI engine

Text/code only, synchronous, 10 providers (Anthropic, OpenAI, Gemini,
xAI, OpenRouter, DeepSeek, Together, Azure OpenAI, Bedrock, Ollama),
descriptor registry + resolver, `AI_PROVIDER` override or first-configured
priority order. No queue, no media, no agents, no memory.

## Current authentication

JWT access (15 min, HS256 pinned) + opaque rotating refresh (7 d,
SHA-256 at rest, single-use, reuse-detected), bearer header transport,
DB-backed lockout (5 fails/15 min). Frontend M1 client automates
refresh; legacy pages still use the old single-token flow until M3.
No MFA, no cookies, no CSRF (deliberate — see plan).

## Current API status

All routes above functional and tested; envelope
`{ success, data|error, meta }` stable. Placeholder: images/generate.
No versioning yet, no public API keys enforcement (ApiKey model unused).

## Current database

PostgreSQL 16, Prisma 5.22, 18 models, 4 migrations applied, every FK
indexed, no seed script. Local dev DB matches CI credentials
(`postgresql://synora:synora@localhost:5432/synora`).

## Current tests

**303 passing**: backend 273 (vitest+supertest, real Postgres), web 14,
design-system 16. E2E: none (M9). Coverage: uploaded, not gated.

## Current deployment readiness

- Backend: deployable today via the manual Docker sequence
  (`PROJECT_HANDOVER.md` §12); needs only `DATABASE_URL`, `JWT_SECRET`,
  `NEXTAUTH_SECRET` + one AI key.
- Web: builds clean (`next build`, 7 static routes) but has **no
  deployment story yet** (no Dockerfile stage, no Vercel config) —
  decided in M9.
- No CD pipeline, no metrics/alerting, no app-owned backups (managed-
  Postgres PITR assumed).

## Current known issues

- None open at the code level: lint 0 errors (22 pre-existing backend
  warnings, all `no-explicit-any`/`no-console` in MFA dead code and
  scripts), typecheck clean, all tests green, CI green.
- Process-level: `v1.0.0` tag + GitHub Release for R1 still need someone
  with full repo write access (session credentials are branch-scoped).

## Current blockers

None for M2–M5 (pure code). Before M6: provision managed Redis + an
S3-compatible bucket. Before M7: Stripe test keys (abstraction itself
needs none). Before M9: choose CD platform + metrics backend.

## Production readiness

**~35% toward the Release 2 definition of launch-ready.** Rationale:
backend core (auth, CRUD, AI text, security, CI, Docker) is
production-grade and was audited as such
(`PRODUCTION_READINESS_AUDIT.md`); frontend foundation now exists; but
the majority of the customer-facing surface (marketing, real auth UX,
teams, billing, media, admin, observability, E2E) is still ahead.

**Already production-grade:** backend auth/session model, AI
abstraction, config/secrets systems, error handling, DB schema +
migrations, CI gates, Docker image, design-system foundation + frontend
API layer (tested).

**Still requires work:** everything listed under "Pending features",
plus MFA/CSRF wiring, Redis-backed state, media pipeline, CD,
observability, E2E suite, web deployment story, workspace tenancy
enforcement.
