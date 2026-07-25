# Synora — Current State

**Snapshot date:** 2026-07-25
**Maintenance rule:** update this file at the end of every milestone
(same commit as the milestone's closing work). Everything below is
verified against the repository, not assumed.

## Release / Milestone position

- **Current release:** Release 2 — "Complete customer-facing platform"
  (`RELEASE_2_PLAN.md`)
- **Current milestone:** M3 (Auth/account UX rebuild) **complete**, with
  a founder-approved scope change (2026-07-25): `RELEASE_2_PLAN.md`'s
  original M3 also specified an onboarding wizard, workspace creation,
  and an app-shell redesign (sidebar/topbar/command palette) — those
  three are **deferred** to a later milestone (folded into M4 or a new
  M3.5, to be decided when that work starts). What M3 actually delivered:
  auth screens rebuilt on the design system + API client, email
  verification, password reset, session management (list/revoke/logout-
  everywhere/remember-me), account settings (password change, deletion),
  and profile settings (edit + avatar upload) — see `NEXT_TASK.md` for
  the next task this closes into.
- **Current branch:** `claude/synora-ai-platform-h5q0k2`
- **Current commit:** pending push of this milestone's work (M3 closing
  commit) — see `git log` for the exact hash once pushed
- **Current PR:** #31 → `SYNORA`, open, not merged
- **Current CI status:** verify on push; local gate (lint + typecheck +
  test + build across all 5 workspace packages) is green as of this
  snapshot

## Completed features (working end-to-end)

- Registration (now also issues an email-verification token and sends a
  verification email), login (now accepts `rememberMe` for a 30-day vs
  7-day refresh token), token refresh (rotating, reuse-detected, `sid`
  claim identifies the session), logout, logout-everywhere, account
  lockout — backend + tests
- Forgot-password / reset-password (`PasswordResetToken`, 1h expiry,
  single-use, revokes every session on consumption) — backend + tests
- Email verification / resend (`EmailVerificationToken`, 24h expiry,
  single-use) — backend + tests
- Session management: `GET /api/auth/sessions` (device label parsed from
  User-Agent, IP, last-used, "this device" flag via the access token's
  `sid` claim), `DELETE /api/auth/sessions/:id`, `POST
  /api/auth/logout-all` — backend + tests
- Profile editing (`PATCH /api/users/me`: name/bio/website/location),
  avatar upload/removal (`POST`/`DELETE /api/users/me/avatar`, provider-
  agnostic local-filesystem storage today), password change (revokes
  every *other* session), notification preferences (`GET`/`PATCH
  /api/users/me/preferences`), account deletion (`DELETE /api/users/me`,
  password-confirmed, soft-delete, frees the email for reuse) — backend
  + tests
- Provider-agnostic mailer (`src/mail/`: console transport default
  everywhere, SMTP transport real via `nodemailer`, activated only by
  explicit `MAIL_TRANSPORT=smtp` — never auto-detected) with 4 templates
  (verification, password reset, password changed, account deleted)
- Provider-agnostic file storage (`src/storage/`: local-filesystem
  provider today, served via `express.static`; an S3-compatible provider
  is a future descriptor, not a rewrite) — used for avatar uploads
- User/me, projects CRUD (list/create/get), documents CRUD
  (list/create/get) — scoped by userId
- AI text/code generation (`POST /api/ai/generate`) through the
  10-provider abstraction; provider chosen purely by configuration
- Typed config system (stage-aware, zod, fail-closed) + SecretsManager
  (audited reads, pluggable sources, secret catalog — now including
  `SMTP_USER`/`SMTP_PASSWORD`)
- CI pipeline (test / security / docker smoke) — all blocking
- Production Docker image (multi-stage, non-root, healthcheck)
- **M1 foundation:** design tokens, shared Tailwind preset, 18-component
  design-system library (Radix-based, +Checkbox in M3) with 20 tests,
  typed API client (now with single-flight 401-refresh-retry **and**
  multipart upload support), token storage, Zustand auth store, TanStack
  Query + next-themes providers, Geist fonts
- **M2 marketing site:** `(marketing)` route group, landing/pricing/
  feature pages/changelog, all content-driven
- **M3 auth/account UX:** every auth screen (login, register,
  forgot-password, reset-password, verify-email) rebuilt on the design
  system + typed API client — no raw `fetch`/`localStorage['token']`
  remains anywhere in the frontend; dashboard shell now guards routes via
  `useRequireAuth` and has a working mobile sidebar overlay (a
  pre-existing bug — the sidebar never collapsed below `md` — was fixed
  as part of verifying this milestone in a real browser); new
  `/dashboard/settings/{profile,account,sessions}` pages, all backed by
  real mutations (no mock UI); browser-verified in both themes, desktop
  and mobile, via a headless-Chromium driver script (golden-path
  register→dashboard→settings→logout→login→forgot-password all
  exercised against the real backend)

## Working but interim (functional today, scheduled for replacement)

- None carried over from M1/M2 remain — the legacy raw-fetch auth pages
  and the deprecated `token` alias, both flagged in the M1/M2 snapshots
  as "scheduled for replacement in M3," were removed in this milestone.

## Partially completed features

- **Workspaces/teams:** full Prisma schema (Workspace, Member,
  Invitation, ApiKey) exists; zero routes/UI — M5 (onboarding + workspace
  creation UI, deferred out of M3, likely lands alongside this)
- **MFA:** complete implementation on `recover/mfa` branch (needs
  rebase); 4 MFA-adjacent services in mainline (`services/mfa/`) are
  tested but dead code — M5
- **CSRF:** complete implementation on `recover/csrf` branch; lands with
  the cookie-auth migration — M5
- **Media generation:** `POST /api/images/generate` returns a hardcoded
  placeholder URL; GeneratedImage/Video/Audio models exist — real
  pipeline (Redis, queue, workers, object storage) is M6. Note: M3's
  avatar-upload storage abstraction (`src/storage/`) is a real,
  functioning building block M6 can extend, not a placeholder.

## Pending features (not started)

Onboarding wizard, workspace creation flow, app shell (sidebar/topbar/
command palette) — deferred from M3, land in a follow-up milestone; AI
playground, prompt library, model selector UI, provider management UI,
generation history (M4); team management, org/security settings, API key
UI (M5); image/video/audio generation + asset manager + uploads (M6);
billing, subscriptions, usage dashboard, analytics, notifications (M7);
admin + monitoring dashboards, audit log viewer, feedback, support
center, docs site, blog, API docs (M8); Playwright E2E, CD, `/metrics`,
alerting, backups (M9).

## Current UI

15 routes: `/` (+ marketing pages), `/auth/{login,register,
forgot-password,reset-password,verify-email}`, `/dashboard`,
`/dashboard/settings/{profile,account,sessions}` — all dark-first,
token-styled, design-system components, Geist type, browser-verified in
both themes and at mobile/desktop widths. Dashboard sidebar collapses to
a full-screen overlay below `md` (fixed in M3; previously it never
collapsed at all, squeezing content on a phone-width viewport).

## Current backend

Express 4 / TS strict / ESM. Routes: `/health`, `/ready`, `/api/auth/*`
(11: register, login, refresh, logout, forgot-password, reset-password,
verify-email, resend-verification, sessions [GET], sessions/:id [DELETE],
logout-all), `/api/users/*` (8: me [GET/PATCH], me/avatar [POST/DELETE],
me/password [POST], me/preferences [GET/PATCH], me [DELETE], :id [GET]),
`/api/projects/*` (3), `/api/documents/*` (3), `/api/images/*` (3,
generate = placeholder), `/api/ai/generate`. New middleware-adjacent
subsystems: `src/mail/` (provider-agnostic mailer), `src/storage/`
(provider-agnostic file storage). Middleware chain and startup order
documented in `docs/architecture.md`.

## Current AI engine

Text/code only, synchronous, 10 providers (Anthropic, OpenAI, Gemini,
xAI, OpenRouter, DeepSeek, Together, Azure OpenAI, Bedrock, Ollama),
descriptor registry + resolver, `AI_PROVIDER` override or first-configured
priority order. No queue, no media, no agents, no memory.

## Current authentication

JWT access (15 min, HS256 pinned, carries a `sid` session claim) + opaque
rotating refresh (7 d, or 30 d with `rememberMe`; SHA-256 at rest,
single-use, reuse-detected), bearer header transport. Every `RefreshToken`
row doubles as a listable, revocable "session" with device metadata
(User-Agent parsed to a display label, IP, last-used time). Forgot/reset-
password and email-verification flows are real, hash-at-rest, single-use.
The frontend API client automates refresh, single-flight. No MFA, no
cookies, no CSRF (deliberate — see plan).

## Current API status

All routes above functional and tested; envelope
`{ success, data|error, meta }` stable. The deprecated `token` alias on
auth responses was removed in M3 (no consumer remained). Placeholder:
images/generate. No versioning yet, no public API keys enforcement
(ApiKey model unused).

## Current database

PostgreSQL 16, Prisma 5.22, 20 models, 6 migrations applied, every FK
indexed, no seed script. Local dev DB matches CI credentials
(`postgresql://synora:synora@localhost:5432/synora`). M3 added
`PasswordResetToken`, `EmailVerificationToken`, and four columns on
`RefreshToken` (`userAgent`, `ipAddress`, `lastUsedAt`, `rememberMe`).

## Current tests

**479 passing**: backend 361 (vitest+supertest, real Postgres), web 98,
design-system 20. E2E: none (M9). Coverage: uploaded, not gated.

## Current deployment readiness

- Backend: deployable today via the manual Docker sequence
  (`PROJECT_HANDOVER.md` §12); needs only `DATABASE_URL`, `JWT_SECRET`,
  `NEXTAUTH_SECRET` + one AI key. Mailer defaults to the console
  transport (logs, doesn't deliver) until `MAIL_TRANSPORT=smtp` +
  SMTP credentials are set — a real provider is a launch-time env choice,
  not a code change.
- Web: builds clean (`next build`, 24 routes) but has **no deployment
  story yet** (no Dockerfile stage, no Vercel config) — decided in M9.
- No CD pipeline, no metrics/alerting, no app-owned backups (managed-
  Postgres PITR assumed).

## Current known issues

- None open at the code level: lint 0 errors (22 pre-existing backend
  warnings, all `no-explicit-any`/`no-console` in MFA dead code and
  scripts — unchanged by M3), typecheck clean across all 5 packages, all
  tests green, build green.
- Fixed in M3 (pre-existing, unrelated to the milestone's feature scope):
  `@synora/shared` and `@synora/database` were missing `"type": "module"`
  in `package.json`, which broke `pnpm --filter @synora/backend run dev`
  (`tsx watch`) with `does not provide an export named …` errors — never
  surfaced before because `pnpm test`/`pnpm build` (tsup/Next's bundler)
  don't hit Node's native ESM loader the way `tsx watch` does. Fixed by
  declaring `"type": "module"` on both packages and adding the `.js`
  extension Node's ESM resolver requires on `@synora/shared`'s two
  relative `export *` specifiers. `pnpm dev` (both backend and web) now
  verified working end-to-end.
- Process-level: `v1.0.0` tag + GitHub Release for R1 still need someone
  with full repo write access (session credentials are branch-scoped).

## Current blockers

None for M4–M5 (pure code). Before M6: provision managed Redis + an
S3-compatible bucket. Before M7: Stripe test keys (abstraction itself
needs none). Before M9: choose CD platform + metrics backend.

## Production readiness

**~45% toward the Release 2 definition of launch-ready.** Rationale:
backend core (auth, CRUD, AI text, security, CI, Docker) is
production-grade; the full customer-facing auth/account surface (real
auth screens, email verification, password reset, session management,
profile/account settings, avatar upload) is now production-grade too and
browser-verified; still ahead: onboarding/workspace creation/app shell,
teams, billing, media, admin, observability, E2E.

**Already production-grade:** backend auth/session model (including
password reset, email verification, and session management), AI
abstraction, mailer abstraction, storage abstraction, config/secrets
systems, error handling, DB schema + migrations, CI gates, Docker image,
design-system foundation + frontend API layer (tested), full auth/account
UX (login/register/forgot/reset/verify + profile/account/sessions
settings).

**Still requires work:** everything listed under "Pending features",
plus MFA/CSRF wiring, Redis-backed state, media pipeline, CD,
observability, E2E suite, web deployment story, workspace tenancy
enforcement.
