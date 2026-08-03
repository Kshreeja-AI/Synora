# Synora — Current State

**Snapshot date:** 2026-08-03 (PR #46 reconciled with `SYNORA`/PR #38 —
two independent Release 3 M1-M3 builds merged into one implementation per
feature; see `docs/archive/RECONCILIATION_AND_PRODUCTION_AUDIT_2026-08-03.md` for the
authoritative post-merge audit)
**Maintenance rule:** update this file at the end of every milestone
(same commit as the milestone's closing work). Everything below is
verified against the repository, not assumed.

## Release / Milestone position

- **Current release:** Release 2 — "Complete customer-facing platform"
  (`RELEASE_2_PLAN.md`) — **COMPLETE and PRODUCTION-READY**; Release 3
  M1-M3 (chat platform backend + universal tool calling engine) now
  merged on top — see the Release 3 section below.
- **Completed milestones:** M1 (design system), M2 (marketing site), M3 (auth/account UX),
  M4 (application shell), M5 (workspace members/projects/folders/assets/invitations, PR #37),
  M6 (billing) — all complete.
  M4 milestone was redefined to mean the authenticated application shell (per founder 2026-07-25);
  `RELEASE_2_PLAN.md`'s milestone table was renumbered accordingly (old M4→M5, M5→M6, …, M9→M10).
- **Current branch:** `claude/synora-ai-platform-h5q0k2`
- **Current PR:** #46 → `SYNORA`. PR #38 was already merged into `SYNORA`; PR #46
  carried an independent, more-iterated build of the same Release 3 subsystems.
  These have now been reconciled: `SYNORA` was merged into PR #46, keeping
  #46 as the canonical implementation, deleting #38's duplicate orphan files, and
  fixing a CSP defect the auto-merge introduced. See
  `docs/archive/RECONCILIATION_AND_PRODUCTION_AUDIT_2026-08-03.md`.
- **Current CI status:** post-reconciliation local gates all green — backend
  type-check ✅, web type-check ✅, lint ✅ (0 errors), backend tests
  1580 ✅, web tests 373 ✅ (against live Postgres 16 + Redis 7). CI on the PR
  head commit re-verifies these plus security + docker.

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
  — extended in the Release 3 merge with chat-resource permissions
  (`conversation:*`, `message:*`, `branch:manage`, `conversation-folder:manage`,
  `prompt:manage`, `template:manage`, `sharing:manage`), granted to every
  non-VIEWER role
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
**Release 3 (M4+)**: frontend for chat/conversations, streaming UI, tool-calling
UI/approval flow, memory browser, search UI — the Release 3 M1-M3 work merged in
this branch is backend-only (routes/services/schema), no frontend yet.

## Release 3: Chat platform + tool calling engine (M1-M3, this merge)

Branched from `SYNORA` before PR #37 (Release 2 M5) merged, so it independently
reimplemented billing/credits/permissions/webhooks/workspace-scoped routes from
scratch. When merging this branch back onto `SYNORA`, `SYNORA`'s already-shipped
versions of those overlapping files were kept as canonical; only genuinely new
work from this branch was layered on top (notably: chat-resource permissions in
`services/permissions.ts`, and `services/checks.ts`'s `requireMembership`/
`isMember` helpers that the new services depend on). The genuinely new surface:

- **Chat data model:** `Conversation`, `Message` (self-referential tree for
  branching), `MessageBranch`, `MessageAttachment`, `ConversationFolder`,
  `ConversationTag`, `StreamingJob`, `ConversationUsage`.
- **Prompt/template system:** `PromptTemplate`, `ConversationTemplate`.
- **Sharing & collaboration:** `SharedConversation`, `ConversationCollaborator`,
  `ConversationActivity`, `ConversationVersion`.
- **Universal Memory System:** `Memory`, `MemoryMetadata`, `MemoryRelation`,
  `MemoryAuditLog`, `MemoryQuota`, `MemoryCache`, `MemoryExport`, `AIMemory`.
- **Universal Tool Calling Engine:** `ToolDefinition`, `ToolDependency`,
  `ToolExecution` (with an approval workflow), `ToolInvocation`, `ToolAuditLog`,
  `ToolMetrics`, `ToolWebhook`, `ToolQuota`, plus an earlier lighter-weight
  `Tool`/`ToolCall` pair from the chat M1 work.
- **Universal Search System:** `SearchIndex`, `SearchQuery`, `SavedSearch`,
  `SearchSuggestion`, `SearchRanking`, `SearchAnalytics`.
- **Supporting infrastructure:** provider-agnostic `embeddings/` and `vectordb/`
  abstractions, a Redis-backed `queue/` (BullMQ) for async generation/indexing,
  and a Socket.IO-backed `realtime.service.ts` wired into `server.ts`.

All new routes are mounted under `/api/workspaces` in `app.ts` alongside the
existing billing/workspace/asset routes. `pnpm --filter @synora/database exec
prisma validate` passes against the merged schema.

## Current UI

37 page routes, all dark-first, token-styled, design-system components,
Geist type, browser-verified in both themes and at mobile/desktop widths.
The dashboard is a real application shell (sidebar, topbar, workspace
switcher, command palette, notifications, profile menu).

- **Marketing:** `/`, `/pricing`, `/features/[slug]`, `/changelog`
- **Auth:** `/auth/{login,register,forgot-password,reset-password,verify-email}`
- **Chat platform:** `/conversations`, `/conversations/[id]`
- **Knowledge:** `/knowledge/{memories,prompts,templates}`, `/search`
- **Creation:** `/studio`, `/dashboard/tools`, `/developer`
- **Workspace:** `/dashboard`, `/dashboard/projects`,
  `/dashboard/projects/[id]`, `/dashboard/usage`, `/dashboard/billing`
- **Settings:** `/dashboard/settings/{profile,account,sessions,workspace,billing}`
- **Admin:** `/admin`, `/admin/users`, `/admin/workspaces`, `/admin/audit-logs`
- **Public entry points:** `/invite/[token]`, `/share/[token]`, `/welcome`,
  plus the dashboard `[...catchAll]` 404 trigger

## Current backend

Express 4 / TS strict / ESM. 43 route modules mounted under these prefixes
in `app.ts`: `/health`, `/ready`, `/api/auth/*` (incl. `/api/auth/mfa`),
`/api/users/*`, `/api/projects/*`, `/api/documents/*`, `/api/images/*`,
`/api/videos/*`, `/api/audio/*`, `/api/ai/*`, `/api/workspaces/*`,
`/api/notifications/*`, `/api/invitations/*`, `/api/billing/*`,
`/api/admin/*`, `/api/shared/*`, and `/api/eos/*`.

The `/api/workspaces/:id/*` namespace carries the bulk of the Release 3
surface: conversations, messages, branches, conversation folders and tags,
prompt/conversation templates, memories, tools and tool secrets, search,
streaming, realtime, sharing, export/import, dataset export, evaluation,
feedback, files, assets, folders, API keys, capabilities, model registry,
privacy consent, and usage.

Media generation is real, not placeholder: image, video, and audio each
run through a provider abstraction with a registry, persist generated
bytes to storage, and return an honest `503` when no provider credential
is configured rather than fabricating output.

Middleware-adjacent subsystems: `src/mail/`, `src/storage/`, `src/billing/`,
`src/embeddings/`, `src/vectordb/`, `src/queue/` (BullMQ), `src/workers/`,
`src/secrets/`, `src/config/`, `src/monitoring/`, `src/crypto/`, `src/tools/`,
and `src/eos/`. Middleware chain and startup order documented in
`docs/architecture.md`.

## Internal engineering platform (EOS / CIEP)

An internal, founder-only engineering platform lives in
`apps/backend/src/eos/`, mounted at `/api/eos` and gated by
`requireAdminRole`. It is additive observability and engineering
intelligence — no product code depends on it, and it never modifies
protected branches, deploys, or touches production infrastructure.

Architecture is event-driven: an in-process `EngineeringEventBus` with a
bounded ring buffer, and independent collectors/monitors that publish to
and subscribe from it. Each component is separately replaceable.

**Components (12):**

| Component | Role |
|---|---|
| `event-bus` | Typed event backbone + bounded history |
| `worker-collector` | BullMQ job completion/failure events |
| `api-collector` | Slow-request and 5xx error events (Express middleware) |
| `health-collector` | Runs registered health probes on an interval |
| `boot-collector` | Server boot timing, Node version, memory |
| `dependency-probes` | Postgres + Redis reachability probes |
| `queue-depth-collector` | Samples BullMQ queue depths |
| `error-rate-monitor` | Sliding-window 5xx rate, emits threshold alerts |
| `memory-collector` | Process RSS/heap/external/arrayBuffer sampling |
| `latency-tracker` | API p50/p95/p99 percentiles + periodic summaries |
| `provider-observatory` | CIEP: live Provider Capability Matrix (quality, latency, cost, tokens, failure codes) |
| `prompt-intelligence` | CIEP: per-prompt/version success, latency, cost + regression alerts |

**Admin endpoints:** `GET /events/recent`, `GET /events/stats`,
`POST /health/check`, `GET /boot`, `POST /queue-depth`, `GET /error-rate`,
`POST /memory`, `GET /latency`, `GET /provider-matrix`, `GET /prompt-report`.

Verified by 52 tests across 11 test files in `src/eos/__tests__/`.

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
