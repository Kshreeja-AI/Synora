# Synora — Current State

**Snapshot date:** 2026-07-26 (updated after M5 completion)
**Maintenance rule:** update this file at the end of every milestone
(same commit as the milestone's closing work). Everything below is
verified against the repository, not assumed.

## Release / Milestone position

- **Current release:** Release 2 — "Complete customer-facing platform"
  (`RELEASE_2_PLAN.md`)
- **Current milestone:** M6 (Billing) **in progress**. Prior completion: M5
  (Workspace members, projects, folders, assets, invitations) — workspace-scoped
  CRUD, folder hierarchy, asset multipart upload, email invitations, audit logging,
  permission system, all tests passing, PR #37 CI green. M4 milestone was redefined
  to mean the authenticated application shell (per founder 2026-07-25); `RELEASE_2_PLAN.md`'s
  milestone table was renumbered accordingly (old M4→M5, M5→M6, …, M9→M10).
- **Current branch:** `claude/synora-ai-platform-h5q0k2`
- **Current commit:** M5 closing commit (dd359e7), PR #37 created and CI green
  (test ✅, security ✅, docker ✅). Ready to rebase onto merged M5 and continue M6.
- **Current PR:** #37 (M5) → `SYNORA`, draft, CI green; #31 (M4) merged
- **Current CI status:** M5 all green; M6 implementation starting from fresh working tree

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
- **Workspaces (new in M4):** `POST /api/workspaces` (create — slug
  auto-generated + uniqueness-suffixed, creator becomes `OWNER`), `GET
  /api/workspaces` (list mine), `GET /api/workspaces/:id`
  (membership-checked — 404, not 403, for non-members), `PATCH
  /api/workspaces/:id` (OWNER-only rename — 403 for a non-owner member),
  `GET /api/workspaces/:id/members` (read-only member list) — backend +
  tests. Invitations, roles beyond OWNER, and API keys remain out of
  scope (land in M6).
- **In-app notifications (new in M4):** `Notification` model + `GET
  /api/notifications`, `GET /api/notifications/unread-count`, `POST
  /api/notifications/:id/read`, `POST /api/notifications/read-all` —
  every notification is created at a real event trigger (password
  changed, password reset, email verified, workspace created), never
  fabricated for display — backend + tests
- Provider-agnostic mailer (`src/mail/`) and file storage (`src/storage/`)
  — unchanged from M3, still real and load-bearing (avatar uploads,
  transactional email)
- **Workspace-scoped projects & documents (new in M5):** all CRUD ops now
  membership-checked, 404 for non-members (same pattern M4 established for
  workspace routes) — full test coverage
- **Workspace folders (new in M5):** hierarchical folder support with
  recursive cascade delete, nested parent/child relationships, full CRUD
  with permission checks
- **Workspace assets (new in M5):** multipart file upload via storage abstraction,
  `POST/GET /api/workspaces/:id/assets`, DELETE with permission checks
- **Workspace invitations (new in M5):** email-based with token acceptance,
  `POST /api/workspaces/:id/invitations`, `POST /api/invitations/:token/accept`,
  `GET` preview, DELETE revoke — full lifecycle with mail template
- **Workspace audit logging (new in M5):** `AuditLog` model, `recordAuditEvent()`
  service, all mutations logged, queryable via workspace settings page
- **Permissions system (new in M5):** role-based enforcement (VIEWER/MEMBER/EDITOR/ADMIN/OWNER),
  `requireMembership()` and `requirePermission()` middleware pattern across all new routes
- **Frontend M5 additions:** Projects/Folders/Assets pages, invite acceptance page,
  workspace settings tabs (members, invitations, activity), Sidebar Projects nav
  with active-state logic, all real CRUD with real API wiring
- AI text/code generation (`POST /api/ai/generate`) through the
  10-provider abstraction; provider chosen purely by configuration
- Typed config system (stage-aware, zod, fail-closed) + SecretsManager
- CI pipeline (test / security / docker smoke) — all blocking
- Production Docker image (multi-stage, non-root, healthcheck)
- **M1 foundation:** design tokens, shared Tailwind preset, now a
  21-component design-system library (Radix-based; M4 added `Breadcrumb`,
  `EmptyState`, and a hand-rolled `Command`/`CommandDialog` palette
  primitive — no `cmdk` dependency) with 35 tests, typed API client
  (single-flight 401-refresh-retry, multipart upload support)
- **M2 marketing site:** unchanged — landing/pricing/feature pages/
  changelog, content-driven
- **M3 auth/account UX:** unchanged — every auth screen rebuilt on the
  design system + typed API client, `/dashboard/settings/{profile,
  account,sessions}` pages
- **M4 application shell:** dashboard layout rebuilt on
  `components/shell/*` — `Sidebar` (collapsible, keeps M3's
  browser-verified mobile overlay behavior), `Topbar` (breadcrumbs,
  search trigger, notifications, profile menu), `WorkspaceSwitcher` +
  `CreateWorkspaceDialog` (real workspace CRUD, no mock data),
  `NotificationsMenu` (real unread badge + mark-read/mark-all-read),
  `UserMenu` (profile links, theme submenu, keyboard-shortcuts trigger,
  logout), `Breadcrumbs` (derived from the route), `CommandPalette`
  (global ⌘K — doubles as the header's "search," navigates real pages
  and runs real actions: create workspace, switch theme, log out),
  `KeyboardShortcutsDialog`. Dashboard home page now has a genuine empty
  state ("create your first workspace") when the user has none, and a
  real workspace overview (member count, role, created date) when they
  do — no fabricated "recent projects" list. New
  `/dashboard/settings/workspace` page (rename form for owners, read-only
  for non-owners, member list). Theme selection persists server-side via
  `UserPreferences.theme` (`useThemePreference` hook), not just
  `next-themes`' local storage. New 404/error-boundary pages: root
  `not-found.tsx`/`error.tsx`/`global-error.tsx`, and a
  dashboard-scoped `not-found.tsx`/`error.tsx` that keep the sidebar/
  topbar chrome visible (reachable for any unmatched `/dashboard/*` path
  via a `[...catchAll]` route that calls `notFound()`). Browser-verified:
  register → empty-state workspace creation → full shell walkthrough
  (switcher, palette, notifications, profile menu, workspace settings,
  breadcrumbs, both 404 variants, mobile overlay, light theme) — two real
  bugs were found and fixed this way (notifications cache not invalidated
  after workspace creation; an empty command-palette group left its
  heading visible), neither catchable by lint/typecheck/unit tests alone.

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

**M6** (in progress): Billing (Stripe abstraction, subscriptions, plans, credits,
invoices, payment methods, admin controls, webhook processing).
**M7**: image/video/audio generation + asset manager + uploads (Redis, queues).
**M8**: AI playground, prompt library, model selector UI, provider management UI,
generation history.
**M9**: admin + monitoring dashboards, audit log viewer, feedback, support center,
docs site, blog, API docs.
**M10**: Playwright E2E, CD, `/metrics`, alerting, backups.

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
**`/api/workspaces/*`** (5: create, list, get, patch, members — new in
M4), **`/api/notifications/*`** (4: list, unread-count, read, read-all —
new in M4). Middleware-adjacent subsystems: `src/mail/`, `src/storage/`
(unchanged), plus new `src/services/workspace.service.ts` and
`src/services/notification.service.ts`. Middleware chain and startup
order documented in `docs/architecture.md`.

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

**577 passing**: backend 385 (vitest+supertest, real Postgres), web 157,
design-system 35. E2E: none (M10). Coverage: uploaded, not gated.

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

**~50% toward the Release 2 definition of launch-ready.** Rationale:
backend core, full auth/account surface, and the application shell
(dashboard, workspace switching/creation, command palette, notifications,
settings navigation, error/404 handling) are all production-grade and
browser-verified; still ahead: real product surfaces (projects/playground/
prompt library), teams/invitations, billing, media, admin, observability,
E2E.

**Already production-grade:** backend auth/session model, workspace
model (create/list/get/rename), in-app notification system, AI
abstraction, mailer abstraction, storage abstraction, config/secrets
systems, error handling, DB schema + migrations, CI gates, Docker image,
design-system foundation + frontend API layer (tested), full auth/account
UX, and the authenticated application shell.

**Still requires work:** everything listed under "Pending features",
plus MFA/CSRF wiring, Redis-backed state, media pipeline, CD,
observability, E2E suite, web deployment story, workspace tenancy
enforcement beyond the current membership checks.
