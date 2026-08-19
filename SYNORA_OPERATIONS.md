# Synora — Operations

**The operational source of truth.** How to run Synora, configure it, deploy
it, check it is healthy, and recover when it is not.

Written for a founder who is not an engineer. Every command says where it
belongs. Nothing here assumes you already understand Docker, DNS, or
PostgreSQL — where a concept matters, `SYNORA_LEARNING.md` explains it.

For what Synora *is* and how it is architected, see `SYNORA_MASTER_BLUEPRINT.md`.

---

## 1. The one rule about secrets

A secret is anything that would let someone act as you: API keys, database
passwords, tokens. Synora's rule, without exception:

**Secrets live in `apps/backend/.env.local` and nowhere else.**

That file is git-ignored and untracked, so it cannot be committed or pushed.
Never paste a secret into a chat window, an issue, a commit message, or a
screenshot. If a secret is ever seen by anyone, it is *spent* — replace it
rather than hoping.

Anything Synora can generate for itself, it does. You are only ever asked for
credentials that an outside company issued to you.

---

## 2. Running Synora on your laptop

### Prerequisites

| Software | Why |
|---|---|
| Node.js 20+ | Runs the application |
| pnpm 10+ | Installs dependencies (`corepack enable` picks the pinned version) |
| PostgreSQL 16+ | The database |
| Redis 7+ | Background job queue |
| Git | Version control |

### First-time setup

**RUN IN POWERSHELL**, from `F:\Synora-SYNORA`:

```powershell
pnpm install
pnpm run db:generate
powershell -ExecutionPolicy Bypass -File scripts\init-env.ps1
```

`init-env.ps1` builds `apps/backend/.env.local`. It **merges, never
overwrites** — real values you already set are preserved byte-for-byte, and it
generates any missing internal secrets itself.

### Check the configuration is valid

**RUN IN POWERSHELL:**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check-env.ps1
```

Reports `PASS` or `FAIL` per variable. It shows **status and length only** —
never a value. Exit code 0 means every required variable is present and
well-formed.

### Start it

```powershell
pnpm run dev
```

---

## 3. What you must provide, and what Synora provides itself

| You provide | Why only you can |
|---|---|
| `SELF_HOSTED_TEXT_API_KEY` | Issued by your AI router |
| `HOSTINGER_API_TOKEN` | Issued by Hostinger |

| Synora generates | Notes |
|---|---|
| `JWT_SECRET` | Signs login sessions. Changing it logs everyone out. |
| `TOOL_SECRET_MASTER_KEY` | Encrypts stored tool credentials. **After launch, changing it makes stored credentials permanently unreadable.** |
| `NEXTAUTH_SECRET` | Reserved for a future sign-in flow |
| `POSTGRES_PASSWORD` | Only the containers ever read it |

| Discovered automatically | Source |
|---|---|
| `VPS_ID`, `VPS_IP` | The Hostinger API |
| Model identifiers | The AI router's own model list |

Everything else — optional AI providers, object storage, payments, error
tracking — stays blank until you actually want that feature. **A blank
optional value is not a problem and never blocks launch.**

### Quantum computing needs nothing from you

Synora has a quantum capability layer (blueprint Part XI). Its default
configuration reaches only a free simulator that runs inside the Synora
process — no account, no credential, no bill, nothing to set up.

It stays that way unless someone deliberately changes three things at once:
raise `QUANTUM_MAX_EXECUTION_LEVEL` above 0, set
`QUANTUM_PAID_QPU_ENABLED=true`, and set a non-zero
`QUANTUM_MAX_COST_PER_EXECUTION_CENTS`. Any two of the three without the
third refuses to run, and in production the server refuses to START if the
paid switch is on without a cost ceiling.

**If you do nothing, nothing costs anything.** That is the intended
permanent state until there is a reason to change it.

A per-variable walkthrough — what each founder-managed setting means, where
each credential comes from, and how local and production addresses differ —
is in `docs/operations/FOUNDER_ENVIRONMENT_GUIDE.md`.

---

## 4. Rotating a credential

Do this whenever a secret has been seen by anyone, or on a schedule.

**Secrets Synora generates** — **RUN IN POWERSHELL:**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\init-env.ps1 -Rotate
```

Replaces every auto-generated secret with a fresh one. Values are written
straight to the file and never displayed.

**Secrets someone else issued** (AI router, Hostinger) — only the issuer can
replace them:

1. **DO THIS IN HOSTINGER** (or your router's dashboard): delete the old
   token, create a new one.
2. **RUN IN POWERSHELL:** `notepad apps\backend\.env.local`
3. Replace the value on that one line, save, close.
4. **RUN IN POWERSHELL:** `powershell -File scripts\check-env.ps1`

Deleting the old token at the issuer is the step that actually revokes it.
Replacing your copy alone leaves the old one working for whoever has it.

---

## 5. Verifying a build before deployment

**RUN IN POWERSHELL**, from the repository root:

```powershell
pnpm run type-check     # every package compiles
pnpm run lint           # code standards
pnpm run test           # the test suite
pnpm audit              # known vulnerabilities in dependencies
powershell -File scripts\check-env.ps1
```

All five must be clean before deploying. **A test that cannot run is not a
test that passed** — if something is skipped, it is `NOT VERIFIED`, and that
is a different thing from `PASS`.

---

## 6. Production architecture

```
Internet
   │
   ▼  HTTPS (443)
Reverse proxy  ──────────── the only thing exposed to the internet
   │
   ├──▶ Synora Web      (Next.js frontend)
   └──▶ Synora API      (Express backend)
              │
              ├──▶ PostgreSQL   ─┐  private network only,
              ├──▶ Redis        ─┘  never reachable from the internet
              └──▶ AI Router    (external, over HTTPS)
```

The server is a Hostinger VPS: **1 vCPU, 4 GB RAM, 50 GB disk, AlmaLinux 9**,
`id=1891213`, IP `200.234.32.93`.

**AI inference never runs on this machine.** One CPU cannot serve a language
model at usable speed. Inference is always an outbound call to the configured
router, which is also why swapping AI providers is a configuration change
rather than a rewrite.

Only ports **80** and **443** are public, plus SSH. PostgreSQL and Redis
listen on the private network only.

---

## 7. Deployment

> **NOT YET PERFORMED on the VPS.** Every step below has been executed against
> the identical stack locally. TLS is the one step that cannot be rehearsed —
> it needs DNS pointing at the server.

Deployment is reproducible from the repository: the same steps on a fresh
server produce the same result, so recovery never depends on remembering what
was typed once. **Never deployed by hand** — manual server edits drift from
the repository and become undiagnosable.

### Release manifest — Release 1

| | |
|---|---|
| Repository state | clean |
| Backend tests | 77/77 files |
| Web tests | 108/108 files |
| Typecheck | 8/8 packages |
| Lint | 0 errors (213 pre-existing warnings) |
| Dependency audit | 0 vulnerabilities |
| Guardrails | 8/8 |
| Migrations | 40, applied and gate-proven |
| Backup → restore | proven (121 tables, 40 migrations, row-level integrity) |
| AI generation | proven against the real router |
| Spend accounting | proven (cost and tokens recorded) |
| Provider independence | verified |
| TLS | NOT VERIFIED — deploy-time only |
| Off-host backup | DOES NOT EXIST |

### Runbook

Steps 1–14 are **safe before DNS**: they touch only the VPS, and the live site
keeps serving from its current host throughout. Step 15 onward **changes
production** and needs explicit approval.

**SAFE BEFORE DNS**

1. Preflight: confirm VPS reachable, `docker --version`, `docker compose version`, free disk.
2. Clone the repository to the VPS.
3. Create `.env.production` **on the VPS**. It never travels from a laptop.
4. Generate production secrets on the VPS; they must not match any development value.
5. Validate: every required variable present, no loopback address, no placeholder.
6. `docker compose -f docker-compose.production.yml --env-file .env.production build`
7. `up -d postgres redis` — wait for both healthy.
8. `up -d migrate` — **must exit 0.** A non-zero exit stops the deployment here.
9. Verify: `prisma migrate status` reports the schema up to date.
10. `up -d app` — wait for healthy; check `/health` and `/ready`.
11. `up -d web` — wait for healthy.
12. Smoke test internally: register, log in, one AI generation.
13. Confirm the spend ledger recorded cost and tokens.
14. Confirm logs contain no secret material.

**REQUIRES FOUNDER APPROVAL — CHANGES PRODUCTION**

15. DNS cutover (§8). This is the irreversible-in-practice step.
16. `up -d caddy` — issues TLS. Requires DNS already pointing here.
17. Verify HTTPS, the HTTP→HTTPS redirect, and the certificate.
18. Public smoke test, then watch logs and the spend ledger.

**Rollback decision point** is after step 17: if HTTPS or the smoke test fails,
restore the DNS records in §8 and the previous site returns.

---

## 8. Domain and DNS

**Current state** — `trysynora.com` points at Hostinger's shared hosting and
CDN, *not* at your VPS. That is why the placeholder page appears.

| Record | Now | Required |
|---|---|---|
| `trysynora.com` A | `88.222.243.226`, `93.127.173.230` | `200.234.32.93` |
| `www` CNAME | `...cdn.hstgr.net` | `200.234.32.93` |
| Nameservers | `lunar`/`solar.dns-parking.com` | unchanged |

**DNS is changed last, only after the application is confirmed healthy on the
VPS, and only with your explicit approval.** Until then the placeholder page
stays up, which means a failed deployment breaks nothing that is currently
working.

**Rollback:** restore the original A records. Propagation is minutes to a few
hours — the old values are recorded above precisely so rollback needs no
research.

---

## 9. Health checks

| Endpoint | Answers |
|---|---|
| `/health` | Is the process alive? |
| `/ready` | Can it reach the database and Redis? |

`/health` passing while `/ready` fails means the application is running but a
dependency is down — that distinction is the first thing to check when
something looks broken.

---

## 10. Backups

**WRITTEN, NEVER RUN.** `docker-compose.production.yml` defines a `backup`
service: a daily `pg_dump` into `./backups`, keeping the newest 14 and
deleting older ones.

That is a real design, and it is *not* the same as having backups. Two gaps
remain, and both matter:

1. **It has never executed.** Nothing has been deployed, so no dump exists.
2. **The dumps stay on the same server as the database.** A disk failure or a
   destroyed VPS takes the database and every backup with it. Backups need to
   leave the machine they protect.

A restore has also never been tested. **A backup nobody has restored is a
hope, not a backup** — the failure mode is discovering the dump was empty on
the day you need it. Before real users arrive: move copies off the server, and
perform one restore into a scratch database to prove the file works.

---

## 11. When something breaks

| Symptom | Likely cause |
|---|---|
| Site loads, live updates don't | `CORS_ORIGINS` missing the real domain |
| "Nothing was generated" | AI router unreachable, or model has no price and a cost cap is set |
| Everyone logged out at once | `JWT_SECRET` changed |
| Startup refuses with a config error | Production configured with a `localhost` address — deliberate, not a bug |
| Uploads or jobs stuck | Redis unreachable |

Check `/ready` first: it names which dependency is down and saves guessing.

---

## 12. Safety rules

Actions that are never taken automatically, and always need your approval:

- Changing DNS
- Deleting or resetting a database
- Rebooting or destroying the VPS
- Rotating a credential issued by someone else
- Force-pushing or rewriting git history
- Anything that costs money

Your uncommitted work is preserved on the branch
`founder-wip/pre-reconcile-2026-08-10`. Nothing is ever discarded to make a
process simpler.

---

## 13. Appendix — original project handover

*Merged from `PROJECT_HANDOVER.md` on 2026-08-10. Retained for the zero-context onboarding detail it carries; sections above supersede it wherever they disagree.*

> **File references inside this merged section are historical.** They name
> documents that existed when it was written; those were consolidated on
> 2026-08-10 into `SYNORA_MASTER_BLUEPRINT.md`, `SYNORA_OPERATIONS.md` and
> `SYNORA_LEARNING.md`. The text is preserved unedited rather than rewritten,
> because editing an archived record to look current is how a record stops
> being evidence.

## Synora — Project Handover

**As of:** 2026-07-28 — **Release 2 COMPLETE and PRODUCTION-READY**. All
milestones M1–M6 complete (design system + frontend infrastructure; marketing
site; auth/account UX; application shell; workspace operations with projects/
folders/assets/invitations/audit; billing system with Stripe integration).
Branch `claude/synora-ai-platform-h5q0k2`, PR #37 merged, all CI gates green
(lint, typecheck, test, docker, security).

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

### 1. Vision and long-term goals

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

### 2. Current architecture (summary)

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
  cookies — CSRF deferred with the cookie migration to M6).
- **AI**: provider-agnostic abstraction, 10 providers, config-only
  selection (`AI_PROVIDER` override or first-configured priority order).
- **Config/secrets**: two separate systems — typed zod-validated
  `AppConfig` vs audited `SecretsManager` reads.

Full detail: `docs/architecture.md` (kept current; includes request
lifecycle, security layers, scaling, and future queue/memory/agent
sections explicitly marked not-implemented).

### 3. Folder structure

```
synora/
├── apps/
│   ├── backend/                # Express API
│   │   ├── src/
│   │   │   ├── ai/            # Provider-agnostic AI abstraction (10 providers)
│   │   │   ├── mail/           # Provider-agnostic mailer (console/SMTP) — M3
│   │   │   ├── storage/        # Provider-agnostic file storage (local) — M3
│   │   │   ├── config/        # Typed config (stage-aware defaults + env, zod)
│   │   │   ├── db/            # Prisma singleton wrapper
│   │   │   ├── middleware/    # errorHandler, requestLogger, auth
│   │   │   ├── routes/        # auth, users, projects, documents, images, ai
│   │   │   ├── secrets/       # SecretsManager + sources + audit log + registry
│   │   │   ├── services/      # password, token, lockout, passwordReset,
│   │   │   │                  # emailVerification, session, mfa/* (not wired)
│   │   │   ├── utils/         # logger, hashToken, etc.
│   │   │   ├── app.ts         # Express app assembly
│   │   │   └── index.ts       # Entry: secrets→config→listen
│   │   └── tests/
│   └── web/                    # Next.js app (App Router)
│       ├── vitest.setup.ts     # jest-dom + ResizeObserver polyfill — M3
│       ├── postcss.config.js   # tailwindcss + autoprefixer (added M1 — Tailwind
│       │                       # never compiled before this existed)
│       ├── tailwind.config.ts  # consumes @synora/design-system/tailwind-preset
│       └── src/
│           ├── app/            # layout (fonts/theme/providers), page, providers.tsx,
│           │                   # auth/{login,register,forgot-password,
│           │                   # reset-password,verify-email}, dashboard,
│           │                   # dashboard/settings/{profile,account,sessions}
│           ├── components/auth/ # PasswordInput (shared visibility toggle) — M3
│           ├── hooks/          # useCurrentUser, useRequireAuth — M3
│           ├── lib/api/        # client.ts, auth.ts, account.ts, sessions.ts,
│           │                   # types.ts (+tests)
│           ├── lib/auth/       # token-storage.ts (+tests)
│           └── stores/         # auth-store.ts (+tests)
├── packages/
│   ├── database/               # Prisma schema (20 models) + 6 migrations
│   ├── shared/                 # ApiException hierarchy, createApiResponse, types
│   └── design-system/          # tokens + preset + 18 components + 20 tests
│       ├── src/components/     # Button, Input, Textarea, Label, Card, Badge,
│       │                       # Skeleton, Spinner, Separator, Kbd, Dialog, Tabs,
│       │                       # Switch, Checkbox (M3), Tooltip, Avatar,
│       │                       # DropdownMenu, Toaster
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

### 4. Tech stack

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

### 5. Completed milestones

**Release 1 (complete — see `RELEASE_1_FINAL.md`):** R1-a..R1-h — auth
with rotating refresh tokens + lockout, user/project/document CRUD, AI
text/code generation behind the 10-provider abstraction, config/secrets
systems, security hardening, full CI stabilization (see
`docs/archive/RELEASE_1_VERIFICATION_REPORT.md` for every bug found/fixed), Docker
production image, docs consolidation.

**Release 2 — M1–M6: COMPLETE (see `docs/archive/RELEASE_2_CLOSEOUT.md`):**

- **M1: Foundation** — design tokens, 21-component library, typed API client, TanStack Query + Zustand
- **M2: Marketing site** — landing, pricing, features, changelog with glass navbar
- **M3: Auth/account UX** — login/register/forgot-password/reset-password/verify-email, session management, profile + account settings, avatar upload, mailer + storage abstractions
- **M4: Application shell** — workspace CRUD, notifications, sidebar/topbar/workspace-switcher/command-palette/notifications/profile-menu/breadcrumbs/keyboard-shortcuts, error boundaries, 404 pages
- **M5: Workspace operations** — projects/folders/assets (multipart upload), invitations (email token flow), audit logging, permissions system (VIEWER/MEMBER/EDITOR/ADMIN/OWNER)
- **M6: Billing system** — Stripe integration, subscriptions, plans, invoices, payment methods, credits/usage tracking, webhooks, admin controls, frontend billing UI

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

**Release 2 — M2: Marketing site (complete):** `(marketing)` route group
with glass navbar + footer; animated landing page; pricing page + FAQ;
six SSG feature pages from one template; changelog timeline — all
content-driven (`apps/web/src/content/`).

**Release 2 — M3: Auth/account UX rebuild (complete, scope narrowed by
founder decision 2026-07-25 — see `CURRENT_STATE.md`):**
- Every auth screen rebuilt on the design system + typed API client:
  login (remember-me, password visibility toggle, redirect-back-to-
  `next`), register, forgot-password, reset-password, verify-email — no
  raw `fetch`/`localStorage['token']` remains anywhere in the frontend;
  the deprecated `token` response alias was removed from the backend
- Provider-agnostic mailer (`src/mail/`: console default, real SMTP
  transport via `nodemailer`, never auto-detected) with 4 templates
- Provider-agnostic storage (`src/storage/`: local-filesystem provider,
  served via `express.static`) — powers avatar upload
- Password reset (`PasswordResetToken`) and email verification
  (`EmailVerificationToken`) — hash-at-rest, single-use, same discipline
  as refresh tokens
- Session management: every `RefreshToken` row now carries device
  metadata and doubles as a listable/revocable session
  (`GET/DELETE /api/auth/sessions`, `POST /api/auth/logout-all`); the
  access JWT carries a `sid` claim identifying "this device"
- Account/profile settings: `/dashboard/settings/{profile,account,
  sessions}` — profile editing, avatar upload/removal, password change,
  notification preferences, password-confirmed account deletion
  (soft-delete, frees the email for reuse)
- `useRequireAuth`/`useCurrentUser` hooks replace every page's ad-hoc
  auth-checking logic; `axios` (unused) removed from web dependencies
- **Fixed a pre-existing, unrelated bug**: `@synora/shared` and
  `@synora/database` were missing `"type": "module"`, which broke
  `pnpm --filter @synora/backend run dev` (`tsx watch`) — never surfaced
  before because tests/builds use bundlers (tsup, Next) that don't hit
  Node's native ESM loader the way `tsx watch` does. `pnpm dev` (backend
  and web) now verified working end-to-end.
- Full golden path browser-verified (headless Chromium, both themes,
  desktop + mobile) against the real backend: register → dashboard →
  profile edit → avatar upload → password change → session list →
  logout → login with new password + remember-me → unauthenticated
  redirect guard → forgot-password. Also fixed a real mobile bug found
  during that verification: the dashboard sidebar never collapsed below
  `md`, squeezing all content into a sliver on a phone-width viewport —
  now a proper fixed-overlay drawer with a backdrop, closing on
  navigation or backdrop click.
- Onboarding wizard, workspace creation, and app shell (sidebar/topbar/
  command palette) — all originally scoped into M3 by
  `RELEASE_2_PLAN.md` — were deferred to M4.

**Release 2 — M4: Application shell (complete):**
- First workspace backend routes: `POST/GET /api/workspaces`, `GET/PATCH
  /api/workspaces/:id`, `GET /api/workspaces/:id/members` — slug
  auto-generated + uniqueness-suffixed, creator becomes `OWNER`,
  membership-checked reads (404, not 403, for non-members), OWNER-only
  writes (403 for a non-owner member)
- New `Notification` model + `GET/POST /api/notifications*` — every
  notification created at a real event trigger (password changed/reset,
  email verified, workspace created), never fabricated for display
- Real dashboard application shell replacing M3's placeholder:
  `components/shell/{Sidebar,Topbar,WorkspaceSwitcher,
  CreateWorkspaceDialog,UserMenu,NotificationsMenu,Breadcrumbs,
  CommandPalette,KeyboardShortcutsDialog}.tsx` — workspace switching/
  creation, a global ⌘K command palette (also the header's "search"),
  a real notification center, a profile menu with a theme submenu
  (persisted server-side via `UserPreferences.theme`, not just
  `next-themes` locally), route-derived breadcrumbs, and a keyboard-
  shortcuts dialog
- Dashboard home page rebuilt with a genuine empty state ("create your
  first workspace") and a real workspace overview (member count, role,
  created date) — no onboarding wizard route; workspace creation happens
  inline from the empty state or the switcher, matching how Linear
  handles a user's first workspace
- New `/dashboard/settings/workspace` page (owner-only rename, read-only
  member list)
- New design-system primitives: `Breadcrumb`, `EmptyState`, and a
  hand-rolled `Command`/`CommandDialog` palette (no `cmdk` dependency —
  hand-rolling proved adequate)
- New 404/error-boundary pages: root `not-found.tsx`/`error.tsx`/
  `global-error.tsx`, and a dashboard-scoped `not-found.tsx`/`error.tsx`
  that keep the sidebar/topbar chrome — reachable for any unmatched
  `/dashboard/*` path via a `[...catchAll]` route that calls `notFound()`
- Full shell browser-verified (headless Chromium, both themes, desktop +
  mobile): register → empty-state workspace creation → switcher →
  command palette (open/filter/navigate) → notifications → profile menu
  → workspace settings → breadcrumbs → both 404 variants → mobile
  overlay → light theme. Two real bugs were found and fixed this way,
  neither catchable by lint/typecheck/unit tests: the notifications
  query cache wasn't invalidated after workspace creation (the bell
  stayed stale until the next 30s poll), and an empty command-palette
  group left its heading rendered with no items under it.
- Per founder instruction, `RELEASE_2_PLAN.md`'s milestone table was
  renumbered: everything after the original M4 ("Core product surfaces")
  shifted down one slot (old M4→M5, …, M9→M10) — see `RELEASE_2_PLAN.md`
  §3.

### 6. Current branch / PR / CI / Git status

- **Branch**: `claude/synora-ai-platform-h5q0k2` (all Release 2 work, now complete)
- **PR**: #37 → base `SYNORA`, **MERGED** ✅. Contains all Release 2 M1–M6 work.
- **CI**: All production gates passing (lint ✅, typecheck ✅, test ✅, docker ✅, security ✅) as of commit 4150693
- **Working tree**: clean — Release 2 fully committed and pushed
- Session git credentials are scoped to push only this branch.

### 7. Database models

20 models in `packages/database/prisma/schema.prisma` (full column docs:
`docs/database.md`):

- **Identity**: `User` (role USER/ADMIN/MODERATOR, status, lockout
  fields), `Account` (OAuth placeholder, unused), `UserProfile`,
  `UserPreferences`
- **Workspaces** (schema ready, no routes yet — deferred out of M3, see
  `NEXT_TASK.md`): `Workspace`, `WorkspaceMember`
  (OWNER/ADMIN/EDITOR/MEMBER/VIEWER), `WorkspaceInvitation`, `ApiKey`
- **Content**: `Project`, `Document`, `GeneratedImage`, `GeneratedVideo`,
  `GeneratedAudio` (media rows only written by placeholder routes today)
- **Auth**: `RefreshToken` (SHA-256 hash only, revocation, expiry, and —
  since M3 — device metadata doubling as the user-facing session list),
  `PasswordResetToken`, `EmailVerificationToken` (both M3, same
  hash-at-rest/single-use discipline), `Session`/`VerificationToken`
  (NextAuth placeholders, unused)
- **Audit**: `ActivityLog`, `MFAAuditLog` (soft user reference by design)

Migrations applied (6): `init`, `add_refresh_token`,
`add_login_lockout`, `drop_redundant_unique_indexes`,
`add_password_reset_token`,
`add_email_verification_and_session_metadata`. No seed script.

### 8. Authentication flow

Register/login → `{ accessToken (15m JWT, carries a `sid` session
claim), refreshToken (7d opaque, rotating — 30d with `rememberMe`),
user }`. Authenticated calls use `Authorization: Bearer`. Refresh rotates
and revokes single-use; reuse is detected. Logout revokes one session;
`POST /api/auth/logout-all` (M3) revokes every session. Lockout: 5 fails
→ 15 min (config-driven), DB-backed. Forgot/reset-password
(`PasswordResetToken`, 1h expiry, revokes every session on consumption)
and email verification (`EmailVerificationToken`, 24h expiry) are real,
hash-at-rest, single-use flows (M3). The API client automates the 401 →
refresh → retry cycle single-flight. Bearer-not-cookies is deliberate
(CSRF lands with the cookie migration, M6). The deprecated `token`
response alias was removed in M3.
Detail: `docs/api.md`, `docs/production/R1-c_REFRESH_TOKENS.md`.

### 9. AI provider architecture

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

### 10. API routes

Envelope: success `{ success: true, data, meta }`; error
`{ success: false, error: { code, message, details? } }`. Detail with
examples: `docs/api.md`.

| Route | Methods | Auth | Notes |
|---|---|---|---|
| `/health` | GET | — | liveness (Docker HEALTHCHECK, CI smoke test) |
| `/ready` | GET | — | readiness, probes DB |
| `/api/auth/register`, `/login`, `/refresh`, `/logout` | POST | — | see §8 |
| `/api/auth/forgot-password`, `/reset-password`, `/verify-email` | POST | — | M3, see §8 |
| `/api/auth/resend-verification`, `/logout-all` | POST | Bearer | M3 |
| `/api/auth/sessions`, `/sessions/:id` | GET/DELETE | Bearer | M3 — list/revoke sessions |
| `/api/users/me` | GET/PATCH | Bearer | M3: PATCH updates name/profile fields |
| `/api/users/me/avatar` | POST/DELETE | Bearer | M3 — multipart upload/removal |
| `/api/users/me/password` | POST | Bearer | M3 — change password |
| `/api/users/me/preferences` | GET/PATCH | Bearer | M3 — notification preferences |
| `/api/users/me` | DELETE | Bearer | M3 — password-confirmed account deletion |
| `/api/users/:id` | GET | — | public profile |
| `/api/projects` `/`, `/:id` | GET/POST/GET | Bearer | scoped by userId |
| `/api/documents` `/`, `/:id` | GET/POST/GET | Bearer | scoped by userId |
| `/api/images` `/`, `/generate`, `/:id` | GET/POST/GET | Bearer | `/generate` is a **placeholder** (hardcoded URL, no provider call) until M7 |
| `/api/ai/generate` | POST | Bearer | real text/code generation, synchronous |

### 11. Frontend architecture & design system

See `docs/architecture.md` §Frontend and §Design System for the full
description. Key points: dark-first token theming (`data-theme`
attribute, next-themes), shared Tailwind preset, typed API client with
automatic refresh rotation and multipart upload support, TanStack Query/
Zustand wired, `useCurrentUser`/`useRequireAuth` hooks. 15 routes as of
M3: marketing pages, `/auth/{login,register,forgot-password,
reset-password,verify-email}`, `/dashboard`,
`/dashboard/settings/{profile,account,sessions}` — no page reads
`localStorage` directly or hand-rolls its own token logic; the M3 gate
required removing every remaining raw-fetch consumer before the
deprecated `token` alias could be dropped from the backend. The design
system is the only sanctioned way to build UI; do not hand-roll one-off
styled controls.

### 12. Current deployment strategy

Manual, backend-only Docker image (the web app is not yet part of the
deploy story — that decision lands with M10/CD):

```bash
docker build -t synora-backend:latest -f Dockerfile .
DATABASE_URL="<prod>" pnpm --filter @synora/database db:migrate
docker run -d -e NODE_ENV=production -e APP_STAGE=production \
  -e DATABASE_URL=... -e JWT_SECRET=... -e NEXTAUTH_SECRET=... \
  -e ANTHROPIC_API_KEY=... -p 3001:3001 synora-backend:latest
curl -f http://<host>:3001/health && curl -f http://<host>:3001/ready
```

Managed Postgres (RDS/Neon/Supabase/Railway) supplies backups/PITR. No
CD until M10 (R2-e). Dockerfile subtleties that must not be "cleaned up":
no `pnpm prune --prod` (corrupts workspace symlinks), explicit OpenSSL
install (Prisma on bookworm-slim), non-root user, `0.0.0.0` bind — all
documented in `docs/archive/RELEASE_1_VERIFICATION_REPORT.md`.

### 13. Environment variables

Authoritative list: `.env.example` (root + per-app) and
`docs/archive/RELEASE_1_LAUNCH_READINESS.md` §2. Summary:
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
- **Mail (M3)**: `MAIL_TRANSPORT` (default `console`), `MAIL_FROM_ADDRESS`,
  `MAIL_FROM_NAME`, `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE` + secrets
  `SMTP_USER`/`SMTP_PASSWORD` (only required if `MAIL_TRANSPORT=smtp`)
- **Storage (M3)**: `STORAGE_PROVIDER` (default `local`),
  `STORAGE_LOCAL_DIRECTORY`, `STORAGE_PUBLIC_BASE_PATH`,
  `STORAGE_MAX_UPLOAD_BYTES`
- Secret catalog with owners/rotation: `apps/backend/src/secrets/registry.ts`

### 14. Security architecture

Layered: helmet → CORS allowlist → IP rate limiting → zod validation →
pinned-algorithm JWT (now carrying a `sid` session claim) → per-account
lockout → Argon2id (+bcrypt migration) → hashed single-use refresh
tokens with reuse detection → hashed single-use password-reset/
email-verification tokens (M3, same discipline) → Prisma parameterized
queries → error handler hiding internals → audited secret reads → CI
security gates (audit high+, gitleaks, Snyk best-effort) → non-root
Docker, no `.env` in layers. Deliberately not yet: MFA (M6), CSRF/cookies
(M6), Redis-shared limits (M7). Full doc: `docs/security.md`.

### 15. Testing status

- **Backend**: 361 tests (vitest + supertest, real Postgres) — includes
  M3's mail (console transport log, SMTP transport mocked, registry/
  resolver), storage (local provider against a real temp dir), password
  reset, email verification, session service, and every new/extended
  auth+users route
- **Web**: 98 tests — API client (incl. 401-refresh-retry, single-flight,
  multipart upload), token storage, auth store, `useCurrentUser`/
  `useRequireAuth`, every auth page, dashboard shell (incl. mobile
  sidebar overlay), every settings page
- **Design system**: 20 tests (components + cn, incl. M3's Checkbox)
- **Total: 479, green locally** — verify CI on push
- E2E (Playwright): none yet — M10 (R2-h). Coverage uploaded, not gated.
- Local run needs `DATABASE_URL` exported (CI value:
  `postgresql://synora:synora@localhost:5432/synora`) and `CI=1` to
  stop vitest watch mode. The web suite additionally needs
  `apps/web/vitest.setup.ts`'s `ResizeObserver` polyfill (jsdom doesn't
  implement it; Radix Checkbox/Switch construct one on mount).

### 16. Documentation hierarchy

`docs/README.md` is the index. Living reference docs (update with code):
`docs/architecture.md`, `api.md`, `database.md`, `deployment.md`,
`security.md`; plus `docs/operations/`, `docs/security/`,
`docs/production/` (one doc per shipped R1 item). Frozen history:
`docs/archive/` (see its README). Root-level: this file,
`CURRENT_STATE.md`, `NEXT_TASK.md`, `RELEASE_ROADMAP.md`,
`RELEASE_1_FINAL.md`, `RELEASE_2_PLAN.md`, plus R1 verification/audit
reports. There is no changelog file — release history lives in the
roadmap + release docs.

### 17. Known limitations

- MFA not wired (code on `recover/mfa` + 4 dead mainline services under
  `services/mfa/`) — M6
- No CSRF (bearer tokens make it moot until cookie auth) — M6
- Single-instance only (DB-backed lockout/rate-limit state) — M7
- Media generation is a placeholder route; no queue, no object storage
  yet — M7. The M3 storage abstraction (`src/storage/`) is a real,
  working building block for this, not a placeholder — it's already used
  for avatar uploads.
- Manual deploys; no CD, no `/metrics`, no alerting — M10
- Workspace tenancy enforcement covers create/list/get/rename/members
  only (M4) — invitations, roles beyond OWNER, and API keys remain
  schema-only until M6
- Mailer defaults to the console transport everywhere (logs, doesn't
  deliver) until `MAIL_TRANSPORT=smtp` + SMTP credentials are configured
  — a real provider is a launch-time env choice, per the launch principle
- `next-auth` declared but unused (reserved for a possible future OAuth
  flow); `axios` was removed in M3
- No real product surfaces yet (project management UI, document editor,
  AI playground, prompt library, generation history) — that's M5, see
  `NEXT_TASK.md`. The application shell that hosts them (sidebar, command
  palette, workspace switching) shipped in M4.
- `infrastructure/k8s/` is an unused placeholder — R4

### 18. Production readiness

Backend is production-ready **for a single-instance, text/code-only
launch** (that was Release 1's bar — see `docs/archive/PRODUCTION_READINESS_AUDIT.md`),
and the customer-facing auth/account surface (real auth screens, email
verification, password reset, session management, profile/account
settings, avatar upload) reached that same bar in M3, followed by the
authenticated application shell (dashboard, workspace switching/
creation, command palette, notifications, settings navigation, 404/error
handling) in M4. The full customer-facing platform is **not yet**
launch-ready: real product surfaces, billing, teams, media generation,
admin, observability remain ahead. Track precise per-area status in
`CURRENT_STATE.md`.

### 19. Exact next task

**M7 — Media Generation, Asset Manager, Async Queue.** Always read `NEXT_TASK.md`
(single source of truth for the next task); it currently specifies this in full:
Redis integration, Bull job queue for async media generation (image/video/audio via
existing AI abstraction), gallery UI, usage tracking integration (M6 credits), all
workspace-scoped with proper permissions. Milestone gate: lint/typecheck/test/build
→ commit → push → green CI before M8.

### 20. Things that must never be changed

1. **Provider-agnosticism**: no route, service, or UI may import a vendor
   AI SDK directly — everything goes through `apps/backend/src/ai/`.
2. **Config-only provider swaps**: adding/selecting providers must never
   require code changes at call sites.
3. **Secrets discipline**: credentials are read only via SecretsManager;
   never from `process.env` at call sites; never logged.
4. **Auth invariants**: refresh tokens stored hashed only; single-use
   rotation with reuse detection; JWT algorithm stays pinned. Extends to
   password-reset and email-verification tokens (M3): hashed at rest,
   single-use, short expiry.
4a. **Mailer/storage provider-agnosticism** (M3): no route or service may
   import a mail SDK (`nodemailer`) or storage SDK outside their one
   adapter file under `apps/backend/src/mail/`/`src/storage/`; transport/
   provider selection is config-only (`MAIL_TRANSPORT`/
   `STORAGE_PROVIDER`), never auto-detected from credential presence.
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

### 21. Coding standards

Per `CLAUDE.md` (authoritative): TypeScript strict, explicit return
types, no `any` (use `unknown`); conventional commits
(`type(scope): description`); components PascalCase files, utils
camelCase; tests colocated (`*.test.ts(x)`) or in `tests/`; every
feature ships with unit + integration tests (E2E suite arrives M10);
accessibility required (the design system's Radix base helps but
doesn't absolve page-level semantics); update the relevant `docs/*` file
whenever a change touches it.

### 22. Architectural decisions and reasons

Consolidated with rationale in `docs/architecture.md` §"Architectural
Decisions" — monorepo, REST-first, Prisma, custom JWT over NextAuth,
bearer-now/cookies-later, CSS-variable tokens + shared preset, Radix
primitives, Geist-via-npm (no build-time font fetch), dist-consumed
design system, config/secrets separation, sync-text/async-media split,
mailer/storage as descriptor-registry abstractions mirroring the AI
provider pattern (M3).

### 23. Release roadmap / future roadmap

- **R1** ✅ launchable core (frozen: `RELEASE_1_FINAL.md`)
- **R2** ▶ complete customer-facing platform. `RELEASE_2_PLAN.md`'s
  milestone table, after the founder's 2026-07-25 renumbering, is: M1
  foundation; M2 marketing site; M3 auth/account UX; M4 application
  shell; M5 projects/playground/prompt library; M6 teams/settings/API
  keys + MFA + CSRF; M7 Redis/queue/media/assets; M8
  billing/usage/analytics; M9 admin/support/docs-site/blog; M10
  E2E/CD/observability/closeout. **Actual status**: M1 ✅, M2 ✅, M3 ✅
  (auth/account UX — see `CURRENT_STATE.md`), M4 ✅ (application shell —
  dashboard, workspace switching/creation, command palette,
  notifications, settings navigation, 404/error handling), M5 next (see
  `NEXT_TASK.md`).
- **R3** enterprise: workspace tenancy enforcement, SSO, deeper audit,
  agent/memory candidates
- **R4** hyperscale: Kubernetes, multi-region, read replicas,
  self-hosted Synora model serving (interface designs exist on
  `feature/synora-infra-interfaces`)
