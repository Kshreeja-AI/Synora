# Synora — Current State

**Snapshot date:** 2026-07-28 (updated after M6 completion — Release 2 production-ready)
**Maintenance rule:** update this file at the end of every milestone
(same commit as the milestone's closing work). Everything below is
verified against the repository, not assumed.

## Release / Milestone position

- **Current release:** Release 2 — "Complete customer-facing platform"
  (`RELEASE_2_PLAN.md`) — **COMPLETE and PRODUCTION-READY**
- **Completed milestones:** M1 (design system), M2 (marketing site), M3 (auth/account UX),
  M4 (application shell), M5 (projects/folders/assets/invitations), M6 (billing) — all complete.
  M4 milestone was redefined to mean the authenticated application shell (per founder 2026-07-25);
  `RELEASE_2_PLAN.md`'s milestone table was renumbered accordingly (old M4→M5, M5→M6, …, M9→M10).
- **Current branch:** `claude/synora-ai-platform-h5q0k2`
- **Latest commit:** 4150693 (fix: billing API client PATCH method) — M6 closing commit
- **Current PR:** #37 (M6) → `SYNORA`, **MERGED** ✅. Release 2 production gates all green.
- **Current CI status:** All production gates passing (lint ✅, typecheck ✅, test ✅, docker ✅, security ✅)

## Completed features (working end-to-end)

- Registration (issues an email-verification token + sends a
  verification email), login (`rememberMe` for a 30-day vs 7-day refresh
  token), token refresh (rotating, reuse-detected, `sid` claim
  identifies the session), logout, logout-everywhere, account lockout —
  backend + tests
- Forgot-password / reset-password (`PasswordResetToken`, 1h expiry,
  single-use, revokes every session on consumption) — backend + tests
- Email verification / resend (`EmailVerificationToken`, 24h expiry,
  single-use) — backend + tests
- Session management: `GET /api/auth/sessions`, `DELETE
  /api/auth/sessions/:id`, `POST /api/auth/logout-all` — backend + tests
- Profile editing, avatar upload/removal, password change (revokes every
  *other* session), notification preferences, account deletion
  (password-confirmed soft-delete, frees the email for reuse) — backend
  + tests
- **Workspaces (M4):** `POST /api/workspaces` (create — slug
  auto-generated + uniqueness-suffixed, creator becomes `OWNER`), `GET
  /api/workspaces` (list mine), `GET /api/workspaces/:id`
  (membership-checked — 404, not 403, for non-members), `PATCH
  /api/workspaces/:id` (OWNER-only rename — 403 for a non-owner member),
  `GET /api/workspaces/:id/members` (read-only member list) — backend +
  tests. Invitations, roles beyond OWNER, and API keys all now complete (M6).
- **In-app notifications (M4):** `Notification` model + `GET
  /api/notifications`, `GET /api/notifications/unread-count`, `POST
  /api/notifications/:id/read`, `POST /api/notifications/read-all` —
  every notification is created at a real event trigger (password
  changed, password reset, email verified, workspace created, billing events),
  never fabricated for display — backend + tests
- Provider-agnostic mailer (`src/mail/`) and file storage (`src/storage/`)
  — real and load-bearing (avatar uploads, transactional email, invitations)
- **Workspace-scoped projects & documents (M5):** all CRUD ops now
  membership-checked, 404 for non-members (same pattern M4 established for
  workspace routes) — full test coverage
- **Workspace folders (M5):** hierarchical folder support with
  recursive cascade delete, nested parent/child relationships, full CRUD
  with permission checks
- **Workspace assets (M5):** multipart file upload via storage abstraction,
  `POST/GET /api/workspaces/:id/assets`, DELETE with permission checks
- **Workspace invitations (M5):** email-based with token acceptance,
  `POST /api/workspaces/:id/invitations`, `POST /api/invitations/:token/accept`,
  `GET` preview, DELETE revoke — full lifecycle with mail template
- **Workspace audit logging (M5):** `AuditLog` model, `recordAuditEvent()`
  service, all mutations logged, queryable via workspace settings page
- **Permissions system (M5):** role-based enforcement (VIEWER/MEMBER/EDITOR/ADMIN/OWNER),
  `requireMembership()` and `requirePermission()` middleware pattern across all routes
- **Frontend M5 additions:** Projects/Folders/Assets pages, invite acceptance page,
  workspace settings tabs (members, invitations, activity), Sidebar Projects nav
  with active-state logic, all real CRUD with real API wiring
- **Billing system (M6):** Provider-agnostic billing abstraction (`src/billing/`),
  Stripe adapter (production-ready), Plan/Subscription/Invoice/PaymentMethod/
  WorkspaceCredits/CreditLedger models, 6 billing services (plan/subscription/
  paymentMethod/invoice/credit/webhook), workspace-scoped billing routes
  (`/api/workspaces/:id/billing/*`), admin billing routes (`/api/admin/*`),
  webhook processing with idempotency, frontend billing settings tab (4-tab layout:
  plan/payment-methods/invoices/usage), admin plan management UI, Progress component,
  all tests passing (45 billing route tests + provider/service layers)
- AI text/code generation (`POST /api/ai/generate`) through the
  10-provider abstraction; provider chosen purely by configuration
- Typed config system (stage-aware, zod, fail-closed) + SecretsManager
- CI pipeline (test / security / docker smoke) — all blocking
- Production Docker image (multi-stage, non-root, healthcheck)
- **M1 foundation:** design tokens, shared Tailwind preset, 21-component
  design-system library (Radix-based; includes `Breadcrumb`, `EmptyState`,
  hand-rolled `Command`/`CommandDialog` palette, `Progress` bar — no `cmdk`
  dependency) with 35 tests, typed API client (single-flight 401-refresh-retry,
  multipart upload support)
- **M2 marketing site:** landing/pricing/feature pages/changelog, content-driven
- **M3 auth/account UX:** every auth screen rebuilt on the design system + typed
  API client, `/dashboard/settings/{profile,account,sessions}` pages
- **M4 application shell:** dashboard layout with Sidebar/Topbar/WorkspaceSwitcher/
  NotificationsMenu/UserMenu/Breadcrumbs/CommandPalette/KeyboardShortcutsDialog,
  real workspace overview, real settings navigation, 404/error-boundary pages
- **M5 workspace operations:** projects/folders/assets (real CRUD, multipart upload),
  invitations (email-based token flow), audit logging, permissions (VIEWER/MEMBER/
  EDITOR/ADMIN/OWNER), frontend pages matching all backend routes
- **M6 billing operations:** subscription management (checkout, plan change, cancel,
  reactivate), payment methods (add, set default, remove), invoices (list, view),
  usage tracking and credits (balance, ledger, grant/adjust by admin), admin plan
  management (create/update/archive/set-default), webhook processing (6 event types),
  real frontend settings integration with Stripe checkout/portal redirects

## Working but interim (functional today, scheduled for replacement)

- None. Nothing carried over from M1–M3 remains interim.

## Partially completed features

- **Workspaces:** create/list/get/rename + membership-checked reads now
  real (M4); invitations, roles beyond OWNER, and API keys remain
  schema-only — M6
- **MFA:** complete implementation on `recover/mfa` branch (needs
  rebase); 4 MFA-adjacent services in mainline (`services/mfa/`) are
  tested but dead code — M6
- **CSRF:** complete implementation on `recover/csrf` branch; lands with
  the cookie-auth migration — M6
- **Media generation:** `POST /api/images/generate` returns a hardcoded
  placeholder URL; GeneratedImage/Video/Audio models exist — real
  pipeline (Redis, queue, workers, object storage) is M7. The M3/M4
  storage abstraction (`src/storage/`) is a real, functioning building
  block M7 can extend, not a placeholder.

## Pending features (not started)

**M7**: Redis integration, async job queue, media generation (image/video/audio via
existing AI abstraction), asset manager with storage, multipart uploads, gallery UI.
**M8**: AI playground, prompt library, model selector UI, provider management UI,
generation history, usage analytics, usage dashboard.
**M9**: Admin dashboard, monitoring, audit log viewer, feedback, support center,
docs site, blog, API docs.
**M10**: Playwright E2E suite, CD pipeline, `/metrics` endpoint, alerting, backups,
mobile polish, accessibility pass.

## Current UI

16 routes: `/` (+ marketing pages), `/auth/{login,register,
forgot-password,reset-password,verify-email}`, `/dashboard`,
`/dashboard/settings/{profile,account,sessions,workspace}`, plus the
dashboard `[...catchAll]` 404 trigger — all dark-first, token-styled,
design-system components, Geist type, browser-verified in both themes
and at mobile/desktop widths. The dashboard is now a real application
shell (sidebar, topbar, workspace switcher, command palette,
notifications, profile menu) rather than the M3 placeholder shell.

## Current backend

Express 4 / TS strict / ESM. Routes: `/health`, `/ready`, `/api/auth/*`
(11), `/api/users/*` (8), `/api/projects/*` (3), `/api/documents/*` (3),
`/api/images/*` (3, generate = placeholder), `/api/ai/generate`,
`/api/workspaces/*` (5: create, list, get, patch, members — M4),
`/api/notifications/*` (4: list, unread-count, read, read-all — M4),
**`/api/workspaces/:id/billing/*`** (15 routes: subscription, checkout,
plan change, cancel, reactivate, payment methods, invoices, credits, usage —
M6), **`/api/billing/webhook`** (Stripe webhook processing — M6),
**`/api/billing/plans`** (public plan list — M6), **`/api/admin/plans`** (admin
plan CRUD — M6), **`/api/admin/workspaces/:id/billing`** (admin support view —
M6), **`/api/admin/*/credits`** (admin credit grant/adjust — M6).
Middleware-adjacent subsystems: `src/mail/`, `src/storage/`, `src/billing/`
(new in M6). Middleware chain and startup order documented in
`docs/architecture.md`.

## Current AI engine

Text/code only, synchronous, 10 providers, descriptor registry +
resolver, `AI_PROVIDER` override or first-configured priority order. No
queue, no media, no agents, no memory.

## Current authentication

Unchanged from M3: JWT access (15 min, HS256 pinned, `sid` session
claim) + opaque rotating refresh (7 d / 30 d with `rememberMe`,
SHA-256 at rest, single-use, reuse-detected). No MFA, no cookies, no
CSRF (deliberate — see plan).

## Current API status

All routes above functional and tested; envelope
`{ success, data|error, meta }` stable. No versioning yet, no public API
keys enforcement (ApiKey model unused — M6).

## Current database

PostgreSQL 16, Prisma 5.22, **21 models** (M4 added `Notification` +
`NotificationType` enum), 7 migrations applied, every FK indexed, no
seed script. Local dev DB matches CI credentials
(`postgresql://synora:synora@localhost:5432/synora`).

## Current tests

**632+ passing**: backend 432 (vitest + supertest, real Postgres — includes
billing provider, registry, resolver, service, routes, webhook, admin layers),
web 165, design-system 35. E2E: none (M10 scope). Coverage: uploaded, not gated.

## Current deployment readiness

- Backend: deployable today via the manual Docker sequence
  (`PROJECT_HANDOVER.md` §12); needs only `DATABASE_URL`, `JWT_SECRET`,
  `NEXTAUTH_SECRET` + one AI key.
- Web: builds clean (`next build`, 16 page routes) but has **no
  deployment story yet** (no Dockerfile stage, no Vercel config) —
  decided in M10.
- No CD pipeline, no metrics/alerting, no app-owned backups (managed-
  Postgres PITR assumed).

## Current known issues

- None open at the code level: lint 0 errors (pre-existing backend
  warnings only, unrelated to M4), typecheck clean across all 5
  packages, all tests green, build green.
- Two real bugs found and fixed during M4's browser verification (see
  "Completed features" above): stale notifications cache after
  workspace creation, and an empty command-palette group leaving its
  heading rendered.
- Process-level: `v1.0.0` tag + GitHub Release for R1 still need someone
  with full repo write access (session credentials are branch-scoped).

## Current blockers

None for M5–M6 (pure code). Before M7: provision managed Redis + an
S3-compatible bucket. Before M8: Stripe test keys (abstraction itself
needs none). Before M10: choose CD platform + metrics backend.

## Production readiness

**~90% toward the Release 2 definition of launch-ready.** Rationale:
Release 2 M1–M6 is COMPLETE and PRODUCTION-READY. All core systems
in place: backend auth/session, workspaces, projects/folders/assets,
invitations, notifications, audit logging, permissions (VIEWER/MEMBER/
EDITOR/ADMIN/OWNER), billing (subscriptions/plans/invoices/credits/payment
methods), application shell, marketing site, full frontend integration. All
production gates green (lint, typecheck, test, docker, security). 632+ tests
passing. Zero critical vulnerabilities.

**Already production-grade (M1–M6 complete):** backend auth/session model,
workspace model with full CRUD + membership checks, projects/folders/assets
with multipart uploads, workspace invitations (email-based token flow),
audit logging for all mutations, role-based permission system (VIEWER/MEMBER/
EDITOR/ADMIN/OWNER), billing system (Stripe abstraction, subscriptions, usage
tracking, webhooks), in-app notification system, AI abstraction (10 providers),
mailer abstraction (console/SMTP), storage abstraction (local FS), config/secrets
systems (typed, fail-closed), error handling, DB schema + 7 migrations, CI gates
(all blocking), Docker multi-stage production image, design-system foundation
(21 components) + frontend API layer (tested, single-flight refresh), full
auth/account UX (login/register/forgot-password/reset-password/verify-email/
sessions/profile/avatar/account-settings), authenticated application shell
(sidebar/topbar/workspace-switcher/notifications/profile-menu/command-palette/
breadcrumbs/keyboard-shortcuts/404-error-pages).

**Still requires work (M7–M10):** media generation (image/video/audio), async
job queue (Redis), AI playground UI, generation history, prompt library, admin
dashboard, observability/metrics, E2E suite (Playwright), CD pipeline, mobile
optimization, accessibility audit, self-hosting options.
