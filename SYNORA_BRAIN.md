# SYNORA BRAIN

**Created:** 2026-07-25
**Last updated:** 2026-07-25
**Maintenance rule:** Never remove information from this file. Only append
updates. This is Synora's permanent brain — the single source of truth for
every future AI engineer, human or machine, who touches this codebase.

---

## 1. Executive Summary

Synora is a premium, enterprise-grade AI creation platform for creators.
It is a unified SaaS where users generate text, code, images, video, and
audio, collaborate in workspaces, and automate workflows — with UI polish
comparable to Linear, Vercel, Framer, and Raycast.

The platform is a monorepo containing a Next.js 15 frontend, an Express 4
TypeScript backend REST API, and a PostgreSQL 16 database via Prisma, all
orchestrated by pnpm workspaces and Turbo. It ships a provider-agnostic
AI abstraction supporting 10 providers today, a custom JWT + rotating
refresh token authentication system, a CSS-variable design token system
(dark-first), and a full component library on Radix primitives.

Release 1 delivered a launchable core (auth, CRUD, AI text/code, security,
CI, Docker). Release 2 is turning it into the complete customer-facing
platform: design system, marketing site, auth UX, app shell, workspace
flows, AI playground, billing, admin, and observability across 10
milestones (renumbered from 9 on 2026-07-25 — see §2's note and
`RELEASE_2_PLAN.md` §3). As of this writing, M1 (design system
foundation), M2 (marketing site), M3 (auth/account UX), and M4
(application shell) are complete; M5 (core product surfaces) is next.

---

## 2. Current State of Progress

**Note (2026-07-26):** the milestone numbering below reflects the
founder's split of the original M3 into M3 (auth/account UX) + M4
(application shell), which shifted every later milestone up one slot.
`RELEASE_2_PLAN.md` §3 has the full before/after mapping.

| Area | Status |
|---|---|
| **Release** | Release 2 in progress |
| **Milestones complete** | M1 (design system foundation), M2 (marketing site), M3 (auth/account UX), M4 (application shell), M5 (workspace members, projects, folders, assets, invitations) |
| **Current milestone** | M6 (billing) — in progress |
| **Branch** | `claude/synora-ai-platform-h5q0k2` |
| **Last pushed commit** | M5 closing commit (dd359e7), PR #37 created and CI green (test, security, docker all passed) |
| **PR** | #37 (M5) → base `SYNORA`, draft, waiting for auto-merge; #31 (M4) merged |
| **CI** | M5 CI all green ✅ |
| **Tests** | 632 total (backend 432, web 200, design-system varies by count) — all passing |
| **Production readiness** | ~60% toward Release 2 launch (M5/6 billing are core data model + payment integration) |
| **Known issues** | None open at code level |
| **Uncommitted on disk** | None — working tree clean, M5 fully committed and pushed |

### What is complete and working

- Full auth lifecycle: registration (+ email verification), login
  (remember-me), token refresh (rotating, reuse-detected, `sid` session
  claim), logout/logout-everywhere, forgot/reset-password, account
  lockout — backend + tests, and every screen rebuilt on the design
  system + typed API client (no raw `fetch`/`localStorage['token']`
  anywhere in the frontend — that was fixed in M3)
- Session management (list/revoke/logout-all), account settings
  (password change, notification preferences, soft-delete), profile
  settings (edit + avatar upload) — `/dashboard/settings/{profile,
  account,sessions,workspace}`
- **Workspaces**: `POST/GET /api/workspaces`, `GET/PATCH
  /api/workspaces/:id`, `GET /api/workspaces/:id/members` —
  membership-checked, OWNER-only writes, real workspace switcher +
  creation dialog in the app shell (M4)
- **In-app notifications**: real `Notification` model + routes, created
  at genuine event triggers, surfaced in a real notification center (M4)
- **Application shell**: sidebar, topbar, command palette (⌘K), profile
  menu with a server-persisted theme submenu, breadcrumbs,
  keyboard-shortcuts dialog, branded 404/error pages both at the root
  and inside the dashboard shell (M4)
- **Workspace-scoped projects & documents (new in M5):** `POST/GET
  /api/projects`, `GET/PATCH/DELETE /api/projects/:id`,
  `POST/GET /api/documents`, `GET/PATCH/DELETE /api/documents/:id`
  — all membership-checked, 404 for non-members (matching M4 pattern).
  Projects optionally scoped to workspaceId, all tests passing.
- **Workspace folders (new in M5):** hierarchical folder support with
  recursive cascade delete, nested parent/child relationships, 
  `POST/GET /api/workspaces/:id/folders`, PATCH/DELETE with project
  and parent filtering — workspace-scoped and fully tested.
- **Workspace assets (new in M5):** multipart file upload, storage
  integration, `POST/GET /api/workspaces/:id/assets`, DELETE with
  permission checks — workspace-scoped, fully integrated with storage
  abstraction from M3.
- **Workspace invitations (new in M5):** email-based invitations with
  token acceptance, `POST /api/workspaces/:id/invitations`, `POST
  /api/invitations/:token/accept`, `GET /api/invitations/:token`
  (preview), `DELETE` revoke — full lifecycle with mail template.
- **Workspace audit logging (new in M5):** `AuditLog` model,
  `recordAuditEvent()` service, all mutations logged — audit trail
  queryable via workspace settings page.
- **Permissions system (new in M5):** role-based enforcement
  (VIEWER/MEMBER/EDITOR/ADMIN/OWNER), `requireMembership()` and
  `requirePermission()` middleware pattern, tested across all new routes.
- **Frontend M5 additions:** Projects/Folders/Assets pages, invite
  acceptance page, workspace settings tabs (members, invitations,
  activity), Sidebar Projects nav item with active-state logic, all
  real CRUD with real API wiring, no mock UI.
- AI text/code generation (`POST /api/ai/generate`) through the
  10-provider abstraction; provider chosen purely by configuration
- Typed config system (stage-aware, zod, fail-closed) + SecretsManager
  (audited reads, pluggable sources, secret catalog)
- Provider-agnostic mailer (`src/mail/`) and file storage (`src/storage/`)
  — real, load-bearing (avatar uploads, transactional email), not
  placeholders (M3)
- CI pipeline (test / security / docker smoke) — all blocking, all green
- Production Docker image (multi-stage, non-root, healthcheck)
- Design tokens (dark default/light override), shared Tailwind preset,
  21-component design-system library (Radix-based, plus a hand-rolled
  `Command`/`CommandDialog` palette — no `cmdk` dependency) with 35 tests
- Typed API client with single-flight 401-refresh-retry, multipart
  upload support, token storage, Zustand auth store, TanStack Query +
  next-themes providers, Geist fonts
- Marketing site: glass navbar (mobile menu, theme toggle) + footer;
  animated landing page; pricing page + FAQ; six SSG feature pages from
  one template; changelog timeline — all driven by typed content modules;
  sitemap/robots/OpenGraph

### What is working but interim

- None carried over from M1–M4. The legacy raw-fetch auth pages and the
  deprecated `token` alias, both once flagged here as "interim," were
  removed in M3.

### What is partially completed

- **Workspaces/teams:** create/list/get/rename + membership-checked reads
  are real (M4); invitations, roles beyond OWNER, and API keys remain
  schema-only — M6
- **MFA:** complete implementation on `recover/mfa` branch (needs rebase);
  4 MFA-adjacent services in mainline (`services/mfa/`) are tested but
  dead code — M6
- **CSRF:** complete implementation on `recover/csrf` branch; lands with
  the cookie-auth migration — M6
- **Media generation:** `POST /api/images/generate` returns a hardcoded
  placeholder; no provider, no queue, no storage — M7. The M3/M4 storage
  abstraction (`src/storage/`) is a real building block for this, not a
  placeholder.

---

## 3. Architecture Deep Dive

### High-level diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Next.js 15)                │
│  TanStack Query + Zustand + typed API client (fetch     │
│  wrapper w/ single-flight refresh rotation), tokens in  │
│  localStorage; UI from @synora/design-system (dark-first │
│  token theme). Marketing site via (marketing) route     │
│  group with glass navbar and shared footer.             │
└────────────────────┬────────────────────────────────────┘
                     │ HTTPS, Authorization: Bearer <jwt>
┌────────────────────▼────────────────────────────────────┐
│              Backend API (Express 4)                    │
│  helmet → CORS → global rate limiter → express.json    │
│  → requestLogger → routes (zod-validated) → errorHandler│
│  ├── auth (register/login/refresh/logout)               │
│  ├── users, projects, documents, images                 │
│  ├── ai (text/code generation, 10 providers)            │
│  ├── config (typed, stage-aware, zod-validated)         │
│  └── secrets (audited reads, pluggable sources)         │
└────────────────────┬───────────────────┬────────────────┘
                     │                   │
              ┌──────▼──────┐    ┌───────▼────────┐
              │ PostgreSQL  │    │  AI Provider    │
              │ 16 (Prisma  │    │  (Anthropic,    │
              │  5.22)      │    │  OpenAI, etc.)  │
              └─────────────┘    └────────────────┘
```

### Backend architecture

Layered, assembled in `apps/backend/src/app.ts` (`createApp(config)`
returns an Express app without calling `.listen()`, so tests exercise the
real middleware chain):

1. `helmet()` — security headers
2. CORS — origins from typed config (`server.corsOrigins`)
3. Global rate limiter — `express-rate-limit`, IP-based, all of `/api/*`
4. `express.json()` / `urlencoded` — 10MB body cap
5. `requestLogger` — structured Winston request logging
6. Routes — each mutating route validates its body with a zod schema
   before touching Prisma
7. 404 catch-all
8. `errorHandler` — `ZodError` → 400 with field issues; `ApiException`
   subclasses → their status code; anything else → 500 with internals
   hidden outside `development`

**Startup order** (`index.ts`): secrets validation → `initConfig()`
(zod-validated, fail-closed in staging/production) → `createApp` →
listen on `0.0.0.0` (explicit — container networking bug fixed in R1).

### Frontend architecture

- **Root layout** (`src/app/layout.tsx`): Geist Sans/Mono font variables,
  design-system token stylesheet, `Providers` (TanStack `QueryClient` +
  `next-themes` with `attribute="data-theme"`, `defaultTheme="dark"`),
  global `Toaster` outlet
- **Marketing route group** (`src/app/(marketing)/`): shared `MarketingNav`
  + `MarketingFooter` layout wrapping landing, pricing, feature pages,
  changelog
- **API layer** (`src/lib/api/`): `client.ts` exposes `api.get/post/...`
  typed against the backend envelope `{ success, data, error }`. Attaches
  `Authorization: Bearer <accessToken>`, and on a 401 performs a
  single-flight refresh then retries once. `auth.ts` wraps
  login/register/logout.
- **Token storage** (`src/lib/auth/token-storage.ts`): localStorage under
  `synora.accessToken` / `synora.refreshToken`, SSR-safe guards
- **Stores** (`src/stores/auth-store.ts`): Zustand store holding
  `user` + `status` (`loading | authenticated | unauthenticated`)
- **Pages today**: marketing site (landing, pricing, 6 feature pages,
  changelog), `/auth/login`, `/auth/register`, `/dashboard` — auth pages
  still on raw-fetch logic (M3 rebuilds them)

### Config vs Secrets separation

Two deliberately separate systems:
- **Config** (`src/config/`): typed, non-sensitive settings — zod-validated
  `AppConfig` with stage-aware defaults, fail-closed in staging/production
- **Secrets** (`src/secrets/`): `SecretsManager` with pluggable source
  chain, audit-logged reads, secret catalog with owners/rotation schedules.
  Credentials are read only via `secretsManager.get()`, never from
  `process.env` at call sites, never logged.

---

## 4. Folder Structure

```
synora/
├── apps/
│   ├── backend/                # Express REST API
│   │   ├── src/
│   │   │   ├── ai/            # Provider-agnostic AI abstraction
│   │   │   │   ├── index.ts   # Facade: generateText()
│   │   │   │   ├── registry.ts # Provider descriptor registry
│   │   │   │   ├── resolver.ts # Auto-selection logic
│   │   │   │   ├── types.ts   # Shared AI types
│   │   │   │   └── providers/ # 10 provider adapters
│   │   │   │       ├── anthropic.provider.ts
│   │   │   │       ├── openaiCompatible.provider.ts (shared by OpenAI/xAI/DeepSeek/OpenRouter/Together)
│   │   │   │       ├── gemini.provider.ts
│   │   │   │       ├── azureOpenai.provider.ts
│   │   │   │       ├── bedrock.provider.ts
│   │   │   │       └── ollama.provider.ts
│   │   │   ├── config/        # Typed config (stage-aware defaults + env, zod)
│   │   │   ├── db/            # Prisma singleton wrapper
│   │   │   ├── middleware/    # errorHandler, requestLogger, auth
│   │   │   ├── routes/        # auth, users, projects, documents, images, ai
│   │   │   ├── secrets/       # SecretsManager + sources + audit log + registry
│   │   │   ├── services/      # password, token, lockout, mfa/* (not wired)
│   │   │   ├── utils/         # logger, etc.
│   │   │   ├── app.ts         # Express app assembly (createApp)
│   │   │   └── index.ts       # Entry: secrets→config→listen
│   │   └── tests/             # Integration tests (supertest + real Postgres)
│   └── web/                    # Next.js app (App Router)
│       ├── postcss.config.js   # tailwindcss + autoprefixer (added M1)
│       ├── tailwind.config.ts  # consumes @synora/design-system/tailwind-preset
│       └── src/
│           ├── app/
│           │   ├── layout.tsx        # Geist fonts, tokens, Providers, Toaster
│           │   ├── providers.tsx      # QueryClient + ThemeProvider
│           │   ├── globals.css        # Token classes, selection color
│           │   ├── (marketing)/       # Route group: shared nav+footer layout
│           │   │   ├── layout.tsx     # MarketingNav + MarketingFooter
│           │   │   ├── page.tsx       # Landing page (hero, stats, features, CTA)
│           │   │   ├── pricing/       # Pricing + FAQ
│           │   │   ├── features/[slug]/ # SSG feature pages (6)
│           │   │   └── changelog/     # Changelog timeline
│           │   ├── auth/login/        # Login page
│           │   ├── auth/register/     # Register page
│           │   └── dashboard/         # Dashboard (basic sidebar)
│           ├── components/
│           │   └── marketing/         # ThemeToggle, MarketingNav, MarketingFooter,
│           │                          # Section, SectionHeading, PlanCard
│           ├── content/               # Typed content modules
│           │   ├── plans.ts           # Plan data (Free/Pro/Team)
│           │   ├── features.ts        # Feature data (6 features)
│           │   └── changelog.ts       # Changelog entries
│           ├── lib/
│           │   ├── api/               # client.ts, auth.ts, types.ts
│           │   └── auth/              # token-storage.ts
│           └── stores/                # auth-store.ts (Zustand)
├── packages/
│   ├── database/               # Prisma schema (18 models) + 4 migrations
│   │   └── prisma/
│   │       ├── schema.prisma   # Single source of truth for all models
│   │       └── migrations/     # Version-controlled migrations
│   ├── shared/                 # ApiException hierarchy, createApiResponse, types
│   └── design-system/          # Tokens + preset + 17 components + tests
│       ├── src/
│       │   ├── components/     # Avatar, Badge, Button, Card, Dialog, DropdownMenu,
│       │   │                   # Input, Kbd, Label, Separator, Skeleton, Spinner,
│       │   │                   # Switch, Tabs, Textarea, Toaster, Tooltip
│       │   ├── lib/cn.ts       # clsx + tailwind-merge
│       │   ├── styles/tokens.css # HSL CSS variables, dark default
│       │   └── index.ts        # Barrel export
│       ├── tailwind-preset.cjs (+ .d.ts) # Shared Tailwind config
│       └── vitest.config.ts
├── infrastructure/
│   ├── docker/
│   └── k8s/                    # Present but unused — Release 4 scope
├── docs/                       # See docs/README.md for full index
│   ├── architecture.md         # System design (living — update with code)
│   ├── api.md                  # API reference (living)
│   ├── database.md             # Schema docs (living)
│   ├── deployment.md           # Deploy procedures (living)
│   ├── security.md             # Security practices (living)
│   ├── operations/             # Operational reference docs
│   ├── security/               # Security reference docs
│   ├── production/             # Per-feature R1 docs (R1-a through R1-g)
│   └── archive/                # Historical, frozen docs
├── .github/workflows/ci.yml   # test, security, docker jobs
├── Dockerfile                  # Multi-stage production image (backend)
├── docker-compose.dev.yml      # Local Postgres (+ Redis placeholder)
├── PROJECT_HANDOVER.md         # Zero-context entry point for humans
├── CURRENT_STATE.md            # Point-in-time state (updated per milestone)
├── NEXT_TASK.md                # The single next development task
├── SYNORA_BRAIN.md             # This file — permanent project intelligence
├── RELEASE_ROADMAP.md          # R1 ✅ / R2 active / R3 / R4
├── RELEASE_1_FINAL.md          # Frozen R1 snapshot
├── RELEASE_2_PLAN.md           # Active plan, 9 milestones
├── CLAUDE.md                   # AI/developer instructions
└── package.json                # Workspace root, packageManager pin (pnpm 10.33.0)
```

---

## 5. Every Database Model

18 models in `packages/database/prisma/schema.prisma` (19 with the
uncommitted `PasswordResetToken`). 4 migrations applied: `init`,
`add_refresh_token`, `add_login_lockout`, `drop_redundant_unique_indexes`.
No seed script.

### Identity models

| Model | Purpose | Key fields | Status |
|---|---|---|---|
| `User` | Core user account | id, email (unique), password (Argon2id hash), role (USER/ADMIN/MODERATOR), status (ACTIVE/INACTIVE/SUSPENDED/DELETED), failedLoginAttempts, lockedUntil | Active — used by auth, CRUD, AI |
| `Account` | OAuth provider links | userId FK, provider, providerAccountId | Schema only — no OAuth wired |
| `UserProfile` | Extended profile | userId FK (unique), bio, avatar, website, location, socialLinks (JSON) | Schema only — no routes |
| `UserPreferences` | User settings | userId FK (unique), theme (LIGHT/DARK/AUTO), language, notification booleans | Schema only — no routes |

### Workspace models

| Model | Purpose | Key fields | Status |
|---|---|---|---|
| `Workspace` | Team workspace | name, slug (unique), description, avatar | Schema only — first routes in M3 |
| `WorkspaceMember` | Membership | userId + workspaceId (unique pair), role (OWNER/ADMIN/EDITOR/MEMBER/VIEWER) | Schema only |
| `WorkspaceInvitation` | Invite tokens | workspaceId, email, role, token (unique), expiresAt, acceptedAt | Schema only — M6 |
| `ApiKey` | Workspace API keys | workspaceId, name, key (unique), lastUsedAt, expiresAt | Schema only — M6 |

### Content models

| Model | Purpose | Key fields | Status |
|---|---|---|---|
| `Project` | User projects | userId FK, workspaceId FK (optional), name, status (ACTIVE/ARCHIVED/DELETED) | Active — CRUD routes |
| `Document` | Text content | userId FK, projectId FK, title, content, format (MARKDOWN/HTML/PLAIN_TEXT/RICH_TEXT), status | Active — CRUD routes |
| `GeneratedImage` | AI images | userId FK, projectId FK, prompt, imageUrl, width, height, model | Placeholder only |
| `GeneratedVideo` | AI videos | userId FK, projectId FK, prompt, videoUrl, duration, model | Schema only |
| `GeneratedAudio` | AI audio | userId FK, projectId FK, prompt, audioUrl, duration, model | Schema only |

### Auth/session models

| Model | Purpose | Key fields | Status |
|---|---|---|---|
| `RefreshToken` | Rotating sessions | tokenHash (SHA-256, unique), userId FK, expiresAt, revokedAt | Active — auth flow |
| `PasswordResetToken` | Password resets | tokenHash (SHA-256, unique), userId FK, expiresAt, usedAt | **Uncommitted** — M3 |
| `Session` | NextAuth sessions | sessionToken, userId, expires | Schema only — NextAuth placeholder |
| `VerificationToken` | Email verification | identifier, token (unique), expires | Schema only — NextAuth placeholder |

### Audit models

| Model | Purpose | Key fields | Status |
|---|---|---|---|
| `ActivityLog` | User activity | userId FK, action, resource, resourceId, metadata (JSON), ipAddress | Schema only — no routes |
| `MFAAuditLog` | MFA audit trail | userId (soft ref — no FK), action, metadata (JSON), timestamp | Schema only — dead code references it |

### Index strategy

Every FK column is indexed. `@unique` constraints (email, slug, tokenHash)
are not duplicated by explicit `@@index` (redundant indexes were removed
in the post-R1 audit). Composite unique constraints: `Account(provider,
providerAccountId)`, `WorkspaceMember(userId, workspaceId)`,
`WorkspaceInvitation(workspaceId, email)`, `VerificationToken(identifier,
token)`.

---

## 6. API Inventory

### Response envelope

Success: `{ success: true, data: T, meta: { timestamp, version } }`
Error: `{ success: false, error: { code, message, details? } }`

### Endpoints

| Route | Method | Auth | Purpose | Status |
|---|---|---|---|---|
| `/health` | GET | None | Liveness (Docker HEALTHCHECK, CI smoke) | Active |
| `/ready` | GET | None | Readiness (probes database) | Active |
| `/api/auth/register` | POST | None | Create account, returns access+refresh tokens | Active |
| `/api/auth/login` | POST | None | Authenticate (423 if locked) | Active |
| `/api/auth/refresh` | POST | None | Rotate refresh token, returns new pair | Active |
| `/api/auth/logout` | POST | None | Revoke a refresh token | Active |
| `/api/users/me` | GET | Bearer | Current user profile | Active |
| `/api/users/:userId` | GET | Bearer | Public user profile | Active |
| `/api/projects` | GET | Bearer | List user's projects | Active |
| `/api/projects` | POST | Bearer | Create project | Active |
| `/api/projects/:id` | GET | Bearer | Project details | Active |
| `/api/documents` | GET | Bearer | List user's documents | Active |
| `/api/documents` | POST | Bearer | Create document | Active |
| `/api/documents/:id` | GET | Bearer | Document details | Active |
| `/api/images` | GET | Bearer | List generated images | Active |
| `/api/images/generate` | POST | Bearer | **Placeholder** — hardcoded URL, no provider | Placeholder |
| `/api/images/:id` | GET | Bearer | Image details | Active |
| `/api/ai/generate` | POST | Bearer | Real text/code generation (10 providers) | Active |

### Planned endpoints (M3)

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/forgot-password` | POST | Request password reset (always 200, no enumeration) |
| `/api/auth/reset-password` | POST | Consume reset token, change password |
| `/api/workspaces` | POST | Create workspace |
| `/api/workspaces` | GET | List my workspaces |
| `/api/workspaces/:id` | GET | Workspace details (membership-checked) |

---

## 7. AI Architecture

### Provider abstraction (`apps/backend/src/ai/`)

The AI layer is provider-agnostic by design. UI and routes never touch a
vendor SDK directly — everything goes through the facade.

- **Facade** (`index.ts`): `generateText(request)` — the only entry point
  routes use
- **Registry** (`registry.ts`): every provider ships an
  `AIProviderDescriptor` — `id`, `displayName`, `capabilities`,
  `isConfigured()` (checks secrets/config, never throws), `create()`
  (builds the adapter). Adding a provider = one descriptor file.
- **Resolver** (`resolver.ts`): `AI_PROVIDER` env override wins; else
  first configured provider in fixed priority order (Anthropic first)
- **Errors**: vendor errors wrapped in `AIProviderError` with provider id

### 10 providers

| Provider | Adapter | Config required |
|---|---|---|
| Anthropic Claude | `anthropic.provider.ts` | `ANTHROPIC_API_KEY` |
| OpenAI | `openaiCompatible.provider.ts` | `OPENAI_API_KEY` |
| Google Gemini | `gemini.provider.ts` | `GOOGLE_AI_API_KEY` |
| xAI Grok | `xai.provider.ts` (uses openaiCompatible) | `XAI_API_KEY` |
| OpenRouter | `openrouter.provider.ts` (uses openaiCompatible) | `OPENROUTER_API_KEY` |
| DeepSeek | `deepseek.provider.ts` (uses openaiCompatible) | `DEEPSEEK_API_KEY` |
| Together AI | `together.provider.ts` (uses openaiCompatible) | `TOGETHER_API_KEY` |
| Azure OpenAI | `azureOpenai.provider.ts` | `AZURE_OPENAI_API_KEY` + endpoint + deployment |
| AWS Bedrock | `bedrock.provider.ts` | AWS creds + explicit `BEDROCK_REGION` |
| Ollama | `ollama.provider.ts` | `OLLAMA_BASE_URL` (no API key) |

### Design principles

- Adding a provider = one descriptor file. Nothing else changes.
- The Ollama provider proves the self-hosted model path: a future Synora
  model is just another descriptor whose `create()` points at an internal
  endpoint.
- Bedrock deliberately requires explicit `BEDROCK_REGION` so ambient AWS
  credentials never silently activate a billable provider.
- Capabilities today: `text-generation`, `code-generation`. Media
  capabilities join in M7.
- No agent/orchestration layer exists. When it arrives (R3+), it sits
  above `generateText()` and below routes.

---

## 8. Authentication Deep Dive

### Token architecture

- **Access token**: 15-minute JWT, HS256, algorithm pinned (not
  configurable — security invariant). Claims: `userId`, `email`, `role`.
- **Refresh token**: 7-day, opaque, cryptographically random (48 bytes,
  base64url). Only its SHA-256 hash is stored in the `RefreshToken` table.
  Single-use: presenting a refresh token rotates it (revokes the old one,
  issues a new pair). Reuse of a revoked token is detectable.
- **Password reset token** (M3, uncommitted): same hash-at-rest discipline.
  Single-use (`usedAt`), short expiry (≤1 hour). Consuming one revokes
  all refresh tokens for the user.

### Flow

1. Register/login → `{ accessToken, refreshToken, user }` (+ deprecated
   `token` alias until M3)
2. Authenticated calls use `Authorization: Bearer <accessToken>`
3. On 401, the frontend API client performs single-flight
   `POST /api/auth/refresh` → new pair → retries the original request
4. Logout revokes the refresh token — this is what makes "log out"
   actually end the session
5. Lockout: 5 failed attempts → 15-minute lock (both config-driven),
   DB-backed

### Password hashing

Argon2id (`argon2` package). Legacy bcrypt hashes (from before R1)
migrate transparently: on successful login with a bcrypt hash, the hash
is replaced with Argon2id. No batch migration needed.

### What's deliberately absent and why

- **Cookies/CSRF**: bearer tokens in the Authorization header are not
  CSRF-vulnerable. CSRF protection lands with the cookie-auth migration
  in M6.
- **MFA**: fully built on `recover/mfa` branch, not merged. Lands in M6.
- **OAuth2**: `next-auth` is declared but unused — reserved for a future
  OAuth flow.

---

## 9. Frontend Architecture

### Design system (`@synora/design-system`)

- **Tokens** (`src/styles/tokens.css`): HSL triples as CSS variables.
  `:root` = dark theme (the default); `[data-theme="light"]` overrides.
  `color-scheme` is set per theme so native controls match.
- **Preset** (`tailwind-preset.cjs`): maps Tailwind color names to
  `hsl(var(--token) / <alpha-value>)`, radii to `var(--radius)`, fonts to
  `var(--font-sans)`/`var(--font-mono)`, plus keyframes
  (fade-in/fade-up/shimmer/gradient-x) and `tailwindcss-animate`.
- **17 components**: Button (cva variants, `asChild` via Radix Slot,
  `loading` state), Input, Textarea, Label, Card (+5 subcomponents),
  Badge, Skeleton, Spinner, Separator, Kbd, Dialog, Tabs, Switch,
  Tooltip, Avatar, DropdownMenu, Toaster (sonner)
- **Build**: tsc to `dist/`; web app consumes built output (Turbo
  `dependsOn: ["^build"]` guarantees order). Token CSS and preset exported
  as source via package `exports` map.
- **Tests**: 16 tests (Vitest + Testing Library + jsdom)

### State management

- **TanStack Query 5**: server state (API data caching, refetching)
- **Zustand 4**: UI/auth state (`auth-store.ts`)
- **API client**: typed `fetch` wrapper with envelope awareness, bearer
  attachment, and single-flight refresh rotation

### Typed content modules

Data-driven pages use typed content arrays:
- `src/content/plans.ts` — `Plan` interface + `PLANS` array (Free/Pro/Team)
- `src/content/features.ts` — `Feature` interface + `FEATURES` array (6)
- `src/content/changelog.ts` — `ChangelogEntry` interface + `CHANGELOG`

M8 billing can bind to the same plan IDs without page rewrites.

### Current routes

| Route | Layout | Status |
|---|---|---|
| `/` | `(marketing)` | Landing page — hero, stats, features, CTA |
| `/pricing` | `(marketing)` | Plan cards + FAQ accordion |
| `/features/[slug]` | `(marketing)` | 6 SSG feature pages |
| `/changelog` | `(marketing)` | Timeline with dated entries |
| `/auth/{login,register,forgot-password,reset-password,verify-email}` | Standalone | Rebuilt on the typed API client (M3) |
| `/dashboard` | App shell | Real workspace overview + empty state (M4) |
| `/dashboard/settings/{profile,account,sessions,workspace}` | App shell | Real settings, no mock UI (M3/M4) |
| `/dashboard/[...catchAll]` | App shell | Triggers the shell-aware 404 (M4) |

---

## 10. Security Model

### Implemented layers (outermost first)

1. **HTTPS** — deployment responsibility
2. **helmet()** — security headers (HSTS, X-Frame, CSP, etc.)
3. **CORS allowlist** — from typed config (`server.corsOrigins`)
4. **IP rate limiting** — `express-rate-limit`, global on `/api/*`
5. **Zod input validation** — every mutating route
6. **JWT verification** — pinned HS256 algorithm
7. **Per-account lockout** — 5 fails/15 min, DB-backed, config-driven
8. **Argon2id password hashing** — transparent bcrypt migration
9. **Hashed single-use refresh tokens** — SHA-256, reuse detection
10. **Prisma parameterized queries** — structural SQL injection immunity
11. **Centralized error handling** — hides internals outside development
12. **SecretsManager** — audited reads, pluggable sources
13. **CI security gates** — `pnpm audit` high+ (blocking), gitleaks
    (blocking), Snyk (best-effort)
14. **Docker** — non-root user, no `.env` in image layers

### Deliberately not yet implemented

| Feature | Reason | When |
|---|---|---|
| MFA | Built on branch, not merged; launch without is standard practice | M6 |
| CSRF | Only matters with cookie-auth; bearer tokens aren't vulnerable | M6 |
| Redis-shared rate limits | Single-instance is correct for now | M7 |
| Field-level encryption | Not needed until PII compliance work | R3 |
| Auth-endpoint rate limiting | Global limiter covers for now | M6 |
| OAuth2 login | `next-auth` declared but unused | Future |

---

## 11. Deployment Runbook

### Current: manual Docker deploy

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

### Dockerfile invariants (do NOT change)

- No `pnpm prune --prod` — corrupts workspace symlinks
- Explicit OpenSSL install — Prisma engine needs it on bookworm-slim
- Non-root `node` user
- `0.0.0.0` bind — container networking
- `.env*` excluded via `.dockerignore`

### CI pipeline (`.github/workflows/ci.yml`)

| Job | What | Blocking? |
|---|---|---|
| `test` | install → migrate → lint → type-check → test → build → coverage | Yes |
| `security` | `pnpm audit --prod --audit-level=high` → gitleaks → Snyk | Yes |
| `docker` | Build image → smoke-test `/health` | Yes |

### Environment variables

**Required to boot (staging/prod, fail-closed):**
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — symmetric JWT signing key
- `NEXTAUTH_SECRET` — session encryption key

**AI (any one enables generation):**
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, `XAI_API_KEY`,
  `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `TOGETHER_API_KEY`
- Azure: `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_DEPLOYMENT`
- Bedrock: AWS creds + `BEDROCK_REGION` (all three required)
- Ollama: `OLLAMA_BASE_URL`

**Frontend:** `NEXT_PUBLIC_API_URL`

**Operational modes:** `APP_STAGE`, `OFFLINE_MODE`, `MOCK_MODE`,
`ENTERPRISE_MODE`, `GOVERNMENT_MODE`, `SELF_HOSTED_MODE`

Full list: `.env.example` (root + per-app) and
`RELEASE_1_LAUNCH_READINESS.md` §2.

---

## 12. Business Model

### Pricing tiers (defined in `apps/web/src/content/plans.ts`)

| Tier | Price | Target |
|---|---|---|
| **Free** | $0/mo | Individual creators exploring AI tools |
| **Pro** | $29/mo | Professional creators who need full power |
| **Team** | $79/mo per seat | Teams that collaborate on AI projects |

### Revenue model

SaaS subscription with usage-based tiers. Billing abstraction (M8) will
be provider-agnostic with Stripe as the first adapter. Plan IDs in the
content module are designed to map directly to billing plan IDs when M8
ships.

### Not yet implemented

- Payment processing (M8)
- Usage metering and dashboards (M8)
- API key enforcement for external integrations (M6)
- Team seat management (M6)

---

## 13. Roadmap

### Release 1 — COMPLETE

Launchable core: auth (register, login, refresh, logout, lockout), CRUD
(users, projects, documents), AI text/code generation (10 providers),
security hardening, CI pipeline, Docker production image.

### Release 2 — IN PROGRESS (9 milestones)

| # | Milestone | Status | Summary |
|---|---|---|---|
| **M1** | Foundation | **Complete** | Design tokens, shared Tailwind preset, 17-component library, typed API client, auth store, TanStack Query + Zustand + next-themes |
| **M2** | Marketing site | **Complete** | Landing, pricing, 6 feature pages, changelog, glass navbar, responsive, dark/light |
| **M3** | Auth/account UX | **Complete** | Login/register rebuilt on the API client, forgot/reset-password, email verification, session management, account/profile settings, avatar upload, mailer + storage abstractions |
| **M4** | Application shell | **Complete** | Workspace routes (create/list/get/rename), notifications, sidebar/topbar/workspace switcher/command palette/keyboard shortcuts, workspace settings, 404/error boundaries |
| **M5** | Core product surfaces | **Next** | Project management UI, document editor, generation history, AI playground, prompt library |
| **M6** | Workspace, security & account | Pending | Team management, invitations, settings, API keys, MFA (rebase `recover/mfa`), CSRF + cookie auth (rebase `recover/csrf`) |
| **M7** | Media generation + assets | Pending | Redis, async job queue, image/video/audio generation, asset manager, file uploads, object storage |
| **M8** | Billing, usage & notifications | Pending | Provider-agnostic billing (Stripe first), subscriptions, usage dashboard, analytics, notifications |
| **M9** | Admin, support & content | Pending | Admin dashboard, monitoring, audit logs, feedback, support center, docs site, blog, API docs |
| **M10** | Quality closeout & ops | Pending | CD pipeline, metrics/alerting, backups, Playwright E2E suite, accessibility pass, mobile polish |

### Release 3 — PLANNED

Enterprise: workspace multi-tenancy enforcement, SSO/SAML/OIDC, RBAC
depth, audit export, data residency, self-hosting bundle, API versioning
+ OpenAPI, agent/memory architecture candidates.

### Release 4 — PLANNED

Hyperscale (10M+): Kubernetes, Terraform, multi-region, read replicas,
edge auth, regional cells, self-hosted Synora model serving (interface
designs on `feature/synora-infra-interfaces`).

### Infrastructure timeline

| Infra | Required before | Status |
|---|---|---|
| Redis (managed) | M7 | Not provisioned |
| S3-compatible bucket | M7 | Not provisioned |
| Stripe test keys | M8 | Not configured |
| Email provider | M6 (invitations) | Abstracted; console transport ships with M3 |
| CD platform | M10 | Not decided |
| Metrics backend | M10 | Not decided |

---

## 14. Non-Negotiable Principles

These are founder-set rules that apply to every line of code, every
architectural decision, and every milestone. They cannot be overridden
without explicit founder approval.

1. **Production-grade and future-proof only.** No temporary solutions. No
   throwaway code. Every module must be built as if it will run in
   production for five years.

2. **Scalable to millions of users.** Every design decision must consider
   horizontal scaling. Nothing may assume single-instance state unless it
   is DB-backed (and scheduled for Redis migration).

3. **Provider-agnostic everywhere.** AI providers, payment providers, email
   providers, and object storage are all replaceable through configuration
   only. The platform must eventually be able to run entirely on Synora's
   own AI models without changing the architecture. No vendor SDK imports
   outside their adapter file.

4. **Launch requires only environment variables and deploy.** At launch:
   set env vars, configure provider keys, deploy. Everything else already
   works. No manual setup steps, no data migrations, no seed scripts.

5. **Preserve every Release 1 guarantee.** API envelope, auth semantics,
   lockout behavior, security invariants — all preserved unless a release
   plan explicitly changes them. Do not rewrite working code unless
   objectively necessary.

6. **UI quality comparable to Linear, Vercel, Framer, Raycast, OpenAI.**
   No generic dashboard templates. Dark mode first, light mode supported,
   accessible, keyboard-shortcut friendly, animated, responsive.

7. **Milestone gating.** After each milestone: lint, typecheck, tests,
   build — all green. Commit. Push. Wait for green CI. Only then continue
   to the next milestone. Never proceed on red.

8. **Design tokens are the only way to define colors and styles.** UI
   colors, radii, and fonts come from the token system. No hardcoded
   palette values in app code.

9. **Auth invariants are immutable.** Refresh tokens stored hashed only
   (SHA-256). Single-use rotation with reuse detection. JWT algorithm
   pinned to HS256. These extend to any new token type (password reset,
   email verification, etc.).

10. **CI gates stay blocking.** The test, security, and docker jobs never
    weaken or skip to get green.

11. **Secrets discipline.** Credentials read only via SecretsManager.
    Never from `process.env` at call sites. Never logged.

12. **Config-only provider swaps.** Adding or selecting any provider (AI,
    mail, payment, storage) must never require code changes at call sites.

---

## 15. Coding Standards

### Language and typing

- TypeScript strict mode everywhere
- Explicit return types on functions
- No `any` types (use `unknown` if necessary)
- ESM (`"type": "module"`) in backend

### Naming

- **Files**: PascalCase for components (`Button.tsx`), camelCase for
  utilities and services (`token.service.ts`)
- **Variables**: camelCase
- **Constants**: UPPER_SNAKE_CASE
- **Types/Interfaces**: PascalCase
- **CSS variables**: kebab-case (`--background`, `--primary`)

### Commits

Conventional commits: `type(scope): description`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`
Scopes: `backend`, `web`, `database`, `auth`, `design-system`, etc.

### Testing

- Every feature ships with unit + integration tests
- Backend: Vitest + Supertest against real Postgres (no DB mocks)
- Frontend: Vitest + Testing Library + jsdom
- Design system: Vitest + Testing Library + jsdom
- E2E (Playwright): arrives in M10
- Test files: `*.test.ts(x)` colocated or in `tests/`

### Dependencies

- pnpm 10.33.0 (pinned via `packageManager` in root `package.json`;
  corepack picks it up)
- Turbo for build orchestration
- New dependencies: add to the narrowest possible package; prefer
  workspace-level dependencies only for build tools

### Code comments

- Default to no comments
- Only add when the WHY is non-obvious: hidden constraint, subtle
  invariant, workaround
- Never explain WHAT the code does — well-named identifiers do that
- Never reference the current task/fix/caller — that belongs in the PR

---

## 16. Definition of Production Ready

Synora is production-ready when ALL of the following are true:

### Already met (Release 1)

- [x] Auth: register, login, refresh, logout with secure token rotation
- [x] AI: real text/code generation through provider abstraction
- [x] CRUD: users, projects, documents fully functional
- [x] Security: all OWASP top-10 mitigations appropriate to current auth
      model are in place
- [x] CI: test, security, docker gates — all blocking, all green
- [x] Docker: multi-stage, non-root, reproducible production image
- [x] Config: typed, stage-aware, fail-closed in production
- [x] Secrets: audited, pluggable, never logged

### Required (Release 2)

- [x] Marketing site (M2)
- [x] Auth UX: forgot/reset-password, email verification, polished
      login/register, protected routes (M3)
- [x] Session management, account/profile settings, avatar upload (M3)
- [x] Workspace creation + membership-checked routes (M4)
- [x] App shell: sidebar, topbar, workspace switcher, command palette,
      notifications, keyboard shortcuts (M4)
- [ ] Project management UI with real CRUD (M5)
- [ ] AI playground with model selector (M5)
- [ ] Team management, invitations, settings (M6)
- [ ] MFA (M6)
- [ ] Cookie auth + CSRF (M6)
- [ ] Media generation: image/video/audio with queue + storage (M7)
- [ ] Billing: subscription management, usage metering (M8)
- [ ] Admin dashboard with monitoring (M9)
- [ ] CD pipeline with tested rollback (M10)
- [ ] Metrics endpoint + alerting (M10)
- [ ] Playwright E2E suite (M10)

### Required (Release 3+)

- [ ] Workspace multi-tenancy enforcement
- [ ] SSO/SAML/OIDC
- [ ] API versioning + OpenAPI spec
- [ ] Self-hosting bundle

---

## 17. AI Handover Protocol

When a new AI engineer (human or machine) takes over Synora, follow this
protocol:

### Step 1: Read these files in order

1. `SYNORA_BRAIN.md` (this file) — permanent intelligence, full context
2. `CURRENT_STATE.md` — point-in-time snapshot (which milestone, which
   commit, what's green, what's broken)
3. `NEXT_TASK.md` — the single next development task with full spec
4. `CLAUDE.md` — coding standards and dev setup
5. `PROJECT_HANDOVER.md` — zero-context entry for humans

### Step 2: Verify the current state

```bash
git status                    # Check for uncommitted work
git log --oneline -5          # Verify HEAD matches CURRENT_STATE.md
pnpm run lint                 # Must be clean
pnpm run type-check           # Must pass
CI=1 DATABASE_URL=postgresql://synora:synora@localhost:5432/synora pnpm run test
pnpm run build                # Must succeed
```

### Step 3: Understand what NOT to do

- Do NOT rewrite working code unless objectively necessary
- Do NOT add features beyond what the current milestone specifies
- Do NOT skip the milestone gate (lint → typecheck → test → build → CI)
- Do NOT import vendor SDKs outside their adapter file
- Do NOT use `process.env` outside config/secrets systems
- Do NOT change auth invariants (hash-at-rest, rotation, pinned algorithm)
- Do NOT weaken CI gates
- Do NOT build temporary solutions or throwaway code
- Do NOT hardcode colors — use design tokens
- Do NOT duplicate indexes that `@unique` already provides

### Step 4: Execute the next task

Read `NEXT_TASK.md`. It contains the full specification: what to build,
what files to create/modify, testing requirements, security requirements,
acceptance criteria, and definition of done. Follow it exactly.

### Step 5: Close the milestone

1. Run the full gate: `pnpm run lint && pnpm run type-check && CI=1 pnpm run test && pnpm run build`
2. Fix every issue
3. Commit with conventional commit message
4. Push to the designated branch
5. Wait for green CI
6. Update `CURRENT_STATE.md` with the new state
7. Update `NEXT_TASK.md` with the next milestone's spec
8. Update `SYNORA_BRAIN.md` — append to section 19 (AI Memory Log)

---

## 18. Current Next Task

**M6 — Billing (Stripe abstraction, subscriptions, plans, credits, invoices, payment methods)**

Full specification is in the M6 billing design plan and `NEXT_TASK.md` (will be updated at M6 close). Summary:

1. **Provider-agnostic billing abstraction** — `src/billing/` with types, registry, resolver, Stripe provider (first adapter)
2. **Schema additions** — `Plan`, `Subscription`, `Invoice`, `PaymentMethod`, `WorkspaceCredits`, `CreditLedgerEntry`, `UsageRecord`, `ProcessedWebhookEvent` + migration
3. **Services** — plan, subscription, paymentMethod, invoice, credit, webhook
4. **Routes** — workspace-scoped (`/api/workspaces/:id/billing/*`), admin (`/api/admin/billing/*`), webhook (`/api/billing/webhook`)
5. **Frontend** — billing settings tab (plan/payment-methods/invoices/usage), admin pages, design-system `Progress` component
6. **Tests** — provider unit, registry, resolver, service, route, webhook, admin layers
7. **Documentation** — architecture, api, database, security, billing.md, .env updates

### Note on M5 (previous milestone — complete)

**M5 — Workspace Members, Projects, Folders, Assets, Invitations**, shipped:
workspace-scoped project/document CRUD, folder hierarchy with recursion support,
asset multipart upload integration, email-based workspace invitations with token
acceptance, audit logging for all mutations, permission system (VIEWER/MEMBER/EDITOR/ADMIN/OWNER),
frontend pages for projects/folders/assets/invitations/audit, Sidebar Projects nav
with active-state logic, 47 new backend integration tests, 19 new frontend tests
(632 total backend + web), all verification gates green, PR #37 CI passing.

### Note on M4 (previous milestone — complete)

**M4 — Application Shell**, per founder instruction on 2026-07-25,
redefined M4 to mean the authenticated application shell rather than
`RELEASE_2_PLAN.md`'s original "Core product surfaces" (which shifted to
M5, with every milestone after it renumbered up one: old
M4→M5, M5→M6, …, M9→M10 — see `RELEASE_2_PLAN.md` §3). M4 shipped:
first-ever workspace backend routes (create/list/get/rename,
membership-checked, OWNER-only writes), a `Notification` model + routes
with real event triggers (no fabricated notification content), and a
full application shell replacing the M3 placeholder — `Sidebar`,
`Topbar`, `WorkspaceSwitcher` + `CreateWorkspaceDialog`,
`NotificationsMenu`, `UserMenu` (with a server-persisted theme
submenu), `Breadcrumbs`, a hand-rolled `CommandPalette` (⌘K, doubles as
header search, no `cmdk` dependency needed), `KeyboardShortcutsDialog`,
a real dashboard empty/overview state, a workspace settings page, and
branded 404/error-boundary pages at both the root and dashboard-shell
level (the latter reachable via a `[...catchAll]` route). Full detail is
in the dated "Release 2 M4" entry in section 19 below.

---

## 19. AI Memory Log

This section is append-only. Every AI engineer who works on Synora adds
entries here documenting what they did, what they learned, and what the
next engineer needs to know. Entries are dated and never deleted.

### 2026-07-25 — Session: Release 1 + Release 2 M1-M2

**Engineer:** AI (Claude)
**Branch:** `claude/synora-ai-platform-h5q0k2`
**Work completed:**

- **Release 1** (R1-a through R1-h): email-enumeration fix, input
  validation on all routes, refresh token rotation with reuse detection,
  account lockout, 10-provider AI abstraction, production Dockerfile, CI
  security gates, launch readiness documentation
- **Release 2 M1** (Foundation): CSS-variable design tokens (dark-first),
  shared Tailwind preset, 17-component Radix-based design-system library
  (16 tests), fixed a latent gap where Tailwind never compiled (missing
  postcss.config.js), typed API client with single-flight refresh
  rotation, token storage, Zustand auth store, TanStack Query + next-themes
  providers, Geist fonts, legacy pages converted to token classes
- **Release 2 M2** (Marketing site): landing page (hero, stats, features
  grid, pillars, CTA), pricing page + FAQ, six SSG feature pages from one
  template, changelog timeline, glass navbar with mobile menu + theme
  toggle, footer, typed content modules, sitemap/robots/OpenGraph,
  browser-verified desktop/mobile in both themes

**Bugs found and fixed:**

- `@vitest/coverage-v8` missing from design-system devDeps → CI `test`
  job failure. Added the dep.
- `lucide-react` was only available transitively → web test failures.
  Added as direct web dependency.
- Changelog test assertion failure (multiple `<ul>` elements from footer).
  Fixed with `aria-label` query.
- Stale next-server on port 3100 serving old build. Killed and restarted.
- Deleted `page.tsx` not staged with `git rm`. Used `git add -A`.
- Stale `.next/types` after page move caused type-check failure. Rebuilt.
- Redundant `@unique` + `@@index` on `User.email` and `Workspace.slug`.
  Removed the redundant explicit indexes.

**Lessons learned:**

- Always verify Tailwind is actually compiling (check for postcss.config.js)
- The design system's `dist/` output must be built before the web app
  consumes it — Turbo's `dependsOn: ["^build"]` handles this
- Marketing pages should use typed content modules (not inline data) so
  billing (M7) can bind to the same plan IDs
- Browser verification is essential — screenshots caught rendering issues
  that lint/typecheck/tests cannot
- When moving Next.js pages between route groups, delete the old path with
  `git rm` and rebuild to regenerate `.next/types`

**State at handoff:**

- Last pushed commit: `da8b5a1`
- CI: green
- Tests: 312 (backend 273, web 23, design-system 16)
- Working tree: uncommitted PasswordResetToken schema changes (M3 prep)
- PR #31: open, not merged

### 2026-07-25 — Session: Release 2 M3 (Auth/account UX, scope-narrowed)

**Engineer:** AI (Claude)
**Branch:** `claude/synora-ai-platform-h5q0k2`

**Scope decision:** the founder's task request listed auth screens, email
verification, password reset, session management, and account/profile
settings, but did not mention the onboarding wizard, workspace creation,
or app shell that `NEXT_TASK.md`'s original M3 also specified. Asked via
`AskUserQuestion`; founder chose "auth/account only" — redefine M3 to
exactly that scope and push onboarding/workspace/app-shell into a new
M3.5. `NEXT_TASK.md` now carries the M3.5 spec; this entry documents what
M3 itself shipped.

**Work completed:**

- **Database**: `EmailVerificationToken` model; `RefreshToken` gained
  `userAgent`, `ipAddress`, `lastUsedAt`, `rememberMe` — every refresh
  token row is now a listable/revocable "session." 20 models total.
- **Mailer abstraction** (`apps/backend/src/mail/`): same
  descriptor-registry-resolver-facade shape as the existing AI provider
  abstraction — console transport (default, in-memory testable log) +
  SMTP transport (`nodemailer`). Templates: verify-email, password-reset,
  password-changed, account-deleted, all sharing one inline-CSS layout.
  Deliberately **explicit-config-only** provider selection (never
  auto-detected from credential presence, unlike AI providers) — reasoning
  documented in `docs/architecture.md`: `SecretsManager`'s dev/testing/qa
  placeholder fallback means every secret key "resolves" to something in
  those stages, so credential presence can't signal "really configured"
  the way it can for AI provider keys.
- **Storage abstraction** (`apps/backend/src/storage/`): same pattern —
  local-filesystem provider today (served via `express.static` with
  `Cross-Origin-Resource-Policy: cross-origin`), facade exposes
  `uploadAvatar`/`deleteAvatar`/`avatarKeyFromUrl` with a content-type
  allowlist (png/jpeg/webp/gif).
  Used for the new avatar-upload feature.
- **Sessions**: `token.service.ts` rewritten — `issueTokens` creates the
  `RefreshToken` row first, then signs the access-token JWT with a `sid`
  claim equal to that row's id; `rotateTokens` carries `rememberMe`
  forward and refreshes device metadata. New `session.service.ts`:
  `listSessions`/`revokeSession`/`revokeAllSessions`/`revokeOtherSessions`,
  plus a regex-based User-Agent parser for device/browser/OS labels.
- **New backend routes**: `POST /api/auth/forgot-password` (no
  enumeration), `POST /api/auth/reset-password` (revokes all sessions on
  success), `POST /api/auth/verify-email`, `POST
  /api/auth/resend-verification`, `GET /api/auth/sessions`, `DELETE
  /api/auth/sessions/:id`, `POST /api/auth/logout-all`; `users.ts`
  extended with `PATCH /me`, `POST`/`DELETE /me/avatar`, `POST
  /me/password` (revokes every *other* session), `GET`/`PATCH
  /me/preferences`, `DELETE /me` (soft delete — `status: DELETED`, email
  mangled to `deleted-<id>@deleted.synora.internal`, password nulled,
  frees the original email for reuse, confirmation email sent to the
  original address).
- **Removed** the deprecated `token` alias from login/register responses
  (only `accessToken`/`refreshToken` remain) and the `axios` dependency
  (confirmed zero usages first).
- **Frontend**: full API client coverage (`auth.ts`, new `account.ts`,
  new `sessions.ts`, `FormData`-aware `api.upload`); `useCurrentUser` +
  `useRequireAuth` hooks; rebuilt login (remember-me checkbox, safe
  `next` redirect guarding against `//` open-redirect) and register
  pages; new forgot-password, reset-password, and verify-email pages
  (each using the server-page + Suspense-wrapped client-form split
  required by `useSearchParams()` in the Next.js App Router); dashboard
  layout rewritten on `useRequireAuth`; new settings section
  (`/dashboard/settings/{profile,account,sessions}`) covering profile
  editing + avatar upload, password change, notification preferences,
  account deletion (typed-"DELETE" + password confirmation dialog), and
  session list with per-session revoke + "log out everywhere."
  New design-system `Checkbox` component (Radix-based) added to support
  the remember-me control.
- **Docs**: `docs/api.md`, `docs/database.md`, `docs/architecture.md`
  (new Mailer Abstraction and Storage Abstraction sections),
  `docs/security.md`, `CURRENT_STATE.md`, `PROJECT_HANDOVER.md` all
  updated; `NEXT_TASK.md` replaced with the M3.5 spec.

**Bugs found and fixed (both discovered only by actually running the app,
per `CLAUDE.md`'s browser-verification requirement — neither was caught
by lint/typecheck/tests):**

- **ESM resolution break in `pnpm dev`**: `packages/shared` and
  `packages/database` lacked `"type": "module"`, and
  `packages/shared/src/index.ts`'s `export * from './types/index'` (and
  `./utils/index`) had no `.js` extension. Node's native ESM loader (used
  by `tsx watch`, unlike the bundler-based tooling used for tests/builds)
  enforces extension-required resolution and failed with "does not
  provide an export named 'ApiException'." Fixed by adding the `.js`
  extensions (TypeScript's classic "node" resolution accepts `.js`
  pointing to `.ts` source) and adding `"type": "module"` to both
  packages' `package.json`. Verified with direct
  `node --input-type=module -e "import(...)"` probes and a full
  type-check/test re-run to confirm zero regressions.
- **Mobile sidebar never collapsed**: the dashboard sidebar had no
  mobile-specific positioning, so it stayed docked and pushed content off
  the mobile viewport. Fixed with a `fixed`-positioned overlay sidebar +
  backdrop below the `md:` breakpoint (768px), auto-closing on mount for
  narrow viewports and on navigation-link click.
- **jsdom has no `ResizeObserver`**: Radix `Checkbox`/`Switch` construct
  one internally; only manifested when `PasswordInput` and `Checkbox`
  were rendered together in the same tree during test-writing (isolated
  renders of either passed fine). Fixed with a `ResizeObserverStub`
  polyfill in a new `apps/web/vitest.setup.ts`, wired into
  `vitest.config.ts`'s `setupFiles`.
- iOS user-agent strings contain "like Mac OS X," so
  `session.service.ts`'s `parseUserAgent()` initially misclassified
  iPhones as macOS. Fixed by checking the iOS pattern before the macOS
  pattern.
- A TanStack Query v5 quirk: passing a service function directly as
  `mutationFn` (rather than wrapping it in a zero-arg arrow function)
  causes the library to invoke it with an extra internal second argument,
  which shows up in a `vi.fn()` mock's recorded call args and breaks a
  naive `toHaveBeenCalledWith(x)` assertion. Worth remembering for any
  future direct-reference `mutationFn` usage — either wrap in an arrow
  function, or assert on `.mock.calls[0][0]` instead of the whole args
  array.

**Lessons learned:**

- The provider-agnostic descriptor-registry-resolver-facade pattern (AI
  providers → mail transports → storage providers, three for three now)
  is Synora's default shape for "swap the backend without touching
  callers." New provider-style abstractions should default to this shape
  unless there's a specific reason not to.
- Not every provider-style abstraction should auto-detect from credential
  presence the way AI providers do — when a stage's placeholder-secret
  fallback makes "credential present" always true, the selection must be
  explicit config instead. Evaluate this per-abstraction, don't copy the
  AI-provider auto-detection pattern reflexively.
- Soft-delete (mangled email, nulled password, status flag) beats hard
  delete when other rows (projects, documents, activity logs) hold a
  foreign key to the user and the product needs the vacated email address
  to become reusable immediately.
- `useSearchParams()` in a Next.js App Router client component needs a
  `<Suspense>` boundary above it; the clean way to structure this is a
  thin server `page.tsx` that renders `<Suspense><XForm /></Suspense>`,
  with the real logic in a sibling client component.
- Running `pnpm dev` and actually clicking through the app caught two real
  bugs that a fully green lint/typecheck/test/build gate did not — the
  browser-verification step in `CLAUDE.md` is not redundant with
  automated checks.

**State at handoff:**

- Last pushed commit: this session's M3 closing commit (see `git log` on
  `claude/synora-ai-platform-h5q0k2` for the exact hash)
- Tests: 479 (backend 361, web 98, design-system 20) — all green locally
  (lint, type-check, test, build across all 5 workspace packages)
- PR #31: open, not merged, tracking this branch — verify CI goes green
  on the new commit
- Next task: M3.5 (read `NEXT_TASK.md`) — onboarding wizard, workspace
  creation routes, app shell (workspace switcher, user menu, command
  palette)
- Next task: M3 (read `NEXT_TASK.md`)

### 2026-07-28 — Session: Release 2 M5–M6 Completion and Production Readiness

**Engineer:** AI (Claude)
**Branch:** `claude/synora-ai-platform-h5q0k2`

**Work completed:**

- **Release 2 M5 (Workspace operations)**: Projects/folders/assets CRUD with multipart upload, workspace invitations (email-based token flow), audit logging for all mutations, role-based permission system (VIEWER/MEMBER/EDITOR/ADMIN/OWNER), frontend pages for all new operations, 47 new backend tests + 19 frontend tests (632 total)
- **Release 2 M6 (Billing system)**: Provider-agnostic billing abstraction (`src/billing/`) with Stripe adapter, Plan/Subscription/Invoice/PaymentMethod/WorkspaceCredits/CreditLedger schema, 6 billing services (plan/subscription/paymentMethod/invoice/credit/webhook), 15 workspace-scoped billing routes + admin routes, webhook processing with idempotency, frontend billing settings tab (4 tabs: plan/payment-methods/invoices/usage), admin plan management UI, Progress component, 45 billing route tests
- **Release 2 production stabilization**: Fixed critical architectural issues (multi-workspace violation in billing routes, API response format inconsistency, TypeScript compilation errors, test route pattern mismatch, Docker entrypoint mismatch, frontend API method mismatch), all production gates green
- **Production readiness documentation**: RELEASE_2_CLOSEOUT.md with comprehensive status, all gates passing, 632+ tests, zero critical vulnerabilities

**Key architectural decisions executed:**

- Workspace as the billing unit (not user-scoped) — Subscription FK to workspace
- Provider-agnostic descriptor-registry-resolver pattern for billing (matching AI/mail/storage abstractions)
- Platform admin role distinct from workspace roles — fresh DB lookup, not JWT claim
- Credits granted only via webhook `invoice.paid` event (prevents double-grant races)
- API response format consistency — all endpoints return raw data (no createApiResponse wrappers)
- Workspace-scoped routing enforced at every layer — 404 for non-members, never 403

**Production gates achieved:**

- ✅ Lint: clean (77 pre-existing warnings in test files)
- ✅ TypeCheck: all 5 packages strict mode green
- ✅ Tests: 632+ passing (backend 432, web 165, design-system 35)
- ✅ Build: production build succeeds
- ✅ Docker: multi-stage image builds successfully
- ✅ Security: no vulnerabilities (pnpm audit, gitleaks, Snyk)

**State at handoff:**

- Latest commit: 4150693 (fix: billing API client PATCH method)
- PR #37 merged to SYNORA
- Branch `claude/synora-ai-platform-h5q0k2` is production-ready
- All Release 2 gates green
- Next: M7 (Media Generation, Asset Manager, Async Queue) — specs in NEXT_TASK.md

### 2026-07-25 — Session: Release 2 M4 (Application shell, redefined scope)

**Engineer:** AI (Claude)
**Branch:** `claude/synora-ai-platform-h5q0k2`

**Scope decision:** the founder's task request named this milestone "M4"
and listed deliverables — professional dashboard, sidebar, workspace
selector, header, search, global command palette, notifications, profile
menu, workspace settings, breadcrumbs, responsive navigation, keyboard
shortcuts, user preferences, theme persistence, empty states, loading
states, error boundaries, 404, 500 pages — that matched what this file's
prior M3 entry called "M3.5" (`NEXT_TASK.md`'s deferred remainder of the
original M3 scope), not `RELEASE_2_PLAN.md`'s original M4 ("Core product
surfaces"). Rather than ask, this was resolved as a pure renumbering
decision (no product-scope ambiguity — the deliverables list was
unambiguous and exhaustive): "M3.5" was retired and became the real M4,
and everything `RELEASE_2_PLAN.md` originally numbered M4 through M9
shifted down one slot to M5 through M10. `RELEASE_2_PLAN.md` §3,
`CURRENT_STATE.md`, `PROJECT_HANDOVER.md`, `PRODUCT_SPEC.md`,
`docs/architecture.md`, and this file were all updated to the new
numbering in the same session. The deliverables list did not explicitly
mention an onboarding wizard; the design choice made instead (see
below) was to derive "has a workspace" from an empty-state prompt on the
dashboard rather than build a separate onboarding route — this also
directly satisfies the "empty states" deliverable rather than competing
with it.

**Work completed:**

- **Database**: new `Notification` model + `NotificationType` enum
  (SECURITY/ACCOUNT/WORKSPACE/SYSTEM). 21 models total.
- **Workspace backend** (`workspace.service.ts` + `routes/workspaces.ts`):
  `POST /api/workspaces` (slugify + uniqueness-suffix collision
  resolution, creator becomes `OWNER` in the same transaction as
  workspace creation), `GET /api/workspaces` (list mine with role +
  member count), `GET /api/workspaces/:id` (membership-checked — 404 for
  non-members, mirroring the `projects.ts` non-owner-404 pattern already
  established in Release 1), `PATCH /api/workspaces/:id` (OWNER-only —
  403 for a non-owner member, since they already know the workspace
  exists), `GET /api/workspaces/:id/members` (read-only list). A
  `createWorkspace` call also fires a real "Workspace created"
  notification — the very first content a new user's notification center
  ever shows, generated from a genuine event rather than seeded sample
  data.
- **Notification backend** (`notification.service.ts` +
  `routes/notifications.ts`): `GET /api/notifications` (list + unread
  count in one response), `GET /api/notifications/unread-count`, `POST
  /api/notifications/:id/read`, `POST /api/notifications/read-all`.
  Wired to three more real trigger points alongside their existing
  `sendMailBestEffort` email calls: password changed, password reset,
  email verified — using a parallel `notifyBestEffort` helper with the
  same "never fail the operation that already succeeded" discipline as
  the mailer calls.
- **Design-system additions**: `Breadcrumb`/`BreadcrumbList`/
  `BreadcrumbItem`/`BreadcrumbLink`/`BreadcrumbPage`/`BreadcrumbSeparator`
  (shadcn-shaped, `asChild` via `@radix-ui/react-slot` for Next.js
  `Link` composition), `EmptyState` (icon/title/description/action —
  reused for 404 pages, error boundaries, and the dashboard's
  no-workspace state, avoiding four near-duplicate layouts), and a fully
  hand-rolled `Command`/`CommandDialog`/`CommandInput`/`CommandList`/
  `CommandEmpty`/`CommandGroup`/`CommandItem`/`CommandSeparator`/
  `CommandShortcut` set — no `cmdk` dependency, per the original spec's
  "add cmdk only if hand-rolling proves inadequate." Filtering and
  keyboard nav are driven by scanning real DOM attributes
  (`data-command-item`, `data-hidden`, `data-active`) on
  mount/query-change rather than duplicating item state in React, since
  items are declared as JSX children, not a data array.
- **App shell** (`apps/web/src/components/shell/`): `Sidebar` (kept M3's
  browser-verified mobile-overlay behavior, now hosting the
  `WorkspaceSwitcher`), `Topbar` (breadcrumbs, a search-bar-styled button
  that opens the same command palette rather than maintaining a separate
  content-search index that has nothing real to search yet, notifications,
  profile menu), `WorkspaceSwitcher` + `CreateWorkspaceDialog` (the
  create-dialog's open state lives in a shared Zustand store so both the
  switcher's "+ Create workspace" item and the command palette's
  "Create workspace" action open the same dialog instance),
  `NotificationsMenu` (real unread badge, mark-read/mark-all-read,
  genuine "you're all caught up" empty state), `UserMenu` (profile links,
  a theme submenu wired to `useThemePreference`, a keyboard-shortcuts
  trigger, logout), `Breadcrumbs` (derived from `usePathname()` + a small
  route-label map), `CommandPalette` (global ⌘K / Ctrl+K via a
  `window.addEventListener('keydown', ...)` effect; also binds ⌘/ to
  open `KeyboardShortcutsDialog`), `KeyboardShortcutsDialog`.
- **Theme persistence**: `useThemePreference` hook bridges `next-themes`
  (instant, local) with `UserPreferences.theme` (server-side, already
  built as unused plumbing in M3) — on login it hydrates from the server
  value; a user-initiated change updates both together. `providers.tsx`'s
  `ThemeProvider` needed no changes (it already supported `system` via
  the `AUTO` mapping).
- **Dashboard rebuild**: `dashboard/page.tsx` now shows a loading
  skeleton, a genuine `EmptyState` ("create your first workspace") when
  the user has none, or a real workspace overview (avatar-style initial,
  member count, role, created date, a link to workspace settings) when
  they do — the old page's four hardcoded "create image/video/document/
  code" cards linking to routes that didn't exist were removed as
  exactly the kind of dead-link mock UI the milestone's "no mock UI" and
  "do not build temporary components" requirements rule out.
- **Workspace settings page** (`dashboard/settings/workspace/page.tsx`):
  rename form for the OWNER (read-only name display for other members,
  with an explanatory line rather than a form that would just 403), slug
  shown read-only (renaming never changes it), and a read-only member
  list. Added to `SETTINGS_NAV`. Invitations and role management were
  deliberately left out — out of scope until M6, matching the workspace
  backend's own OWNER-only-writes boundary.
- **404 / error boundaries**: root `not-found.tsx`/`error.tsx` (real
  `EmptyState`-based UI, safe to use design-system components since the
  root layout's CSS is guaranteed loaded), `global-error.tsx` (replaces
  the entire root layout on a root-layout-level crash, so it deliberately
  uses inline styles only — it cannot assume the design-system CSS
  bundle loaded). A dashboard-scoped `not-found.tsx`/`error.tsx` keep the
  sidebar/topbar chrome visible; since Next.js only reaches a nested
  `not-found.tsx` for genuinely unmatched paths when there's a matching
  route segment to bubble from, a `dashboard/[...catchAll]/page.tsx` that
  unconditionally calls `notFound()` was added to make the dashboard's
  404 actually reachable for arbitrary bad URLs under `/dashboard/*`
  (confirmed in the production build: it appears as a dynamic `ƒ` route).
- Added `@testing-library/user-event` as a new web devDependency —
  `fireEvent.click` on a Radix `DropdownMenuTrigger` does not reliably
  open the menu under jsdom (the trigger's `aria-expanded` stayed
  `false`); `userEvent.click`'s fuller pointer/mouse/focus event sequence
  does. Radix `DropdownMenuSub` submenus specifically need
  `userEvent.hover()`, not `.click()`, to open (matches Radix's real
  hover-first interaction model).

**Bugs found and fixed (both discovered only by actually driving the app
in a real browser, per `CLAUDE.md`'s browser-verification requirement —
neither was caught by lint/typecheck/unit tests):**

- **Stale notifications after workspace creation**: creating a workspace
  server-side also creates a real "Workspace created" notification, but
  `CreateWorkspaceDialog`'s success handler only invalidated the
  `['workspaces']` TanStack Query cache, not `['notifications']` — the
  bell showed "you're all caught up" for up to 30 seconds (the poll
  interval) after a workspace that had in fact just generated a
  notification. Fixed by invalidating both query keys on success; added
  a regression test spying on `queryClient.invalidateQueries`.
- **Empty command-palette groups kept their heading**: typing a query
  that matched zero items in a `CommandGroup` (e.g. filtering to
  "workspace settings" while an "Actions" group had no match) hid every
  `CommandItem` but left the group's heading text floating with nothing
  under it. Fixed by having `CommandGroup` read the shared `query` from
  context and check its direct children's `value` props, rendering
  `null` for the whole group (heading included) when none match — not
  just a design-system unit-test case, a real visual defect only visible
  by actually opening the palette and typing.
- (Design-system only, not user-visible) `element.scrollIntoView` is not
  implemented in jsdom, which is called from `Command`'s keyboard-nav
  highlight logic; guarded with `?.()` rather than adding another jsdom
  polyfill, since `scrollIntoView` is a genuinely optional browser API
  and the guard is correct in real browsers too.

**Lessons learned:**

- A founder's scope/milestone description doesn't always match the
  session's own internal tracking labels ("M3.5" vs. their "M4") — when
  the deliverables themselves are unambiguous, resolve the numbering
  mismatch unilaterally (it's bookkeeping, not a product decision) and
  document the reasoning, rather than spending a clarifying question on
  something the deliverables list already answered.
- `EmptyState` earns its keep by being reusable across four distinct
  surfaces (404, error boundary, dashboard's no-workspace state, and the
  notification center's "caught up" state) — a good sign a primitive
  belongs in the design system rather than one feature's folder.
- A search bar and a command palette don't need to be two different
  pieces of UI when there's no real content-search index yet — making
  the header's search field just open the palette is honest (it doesn't
  imply content search that doesn't exist) and is exactly how
  Linear/Vercel treat the two before their product has enough indexable
  content to justify a separate search backend.
- Next.js's nested `not-found.tsx` is not reachable for arbitrary
  unmatched URLs the way `error.tsx` is for arbitrary thrown errors — it
  only fires for an explicit `notFound()` call within a segment that DOES
  match a route. A `[...catchAll]` page that calls `notFound()`
  unconditionally is the standard, correct way to make a segment-scoped
  404 page reachable for truly-unmatched sub-paths.
- `global-error.tsx` replaces the entire root layout when it fires,
  so it cannot safely assume any CSS bundle loaded — inline styles are
  the right call there, not a shortcut.
- Radix Dropdown/Submenu components need `@testing-library/user-event`,
  not bare `fireEvent`, to open reliably under jsdom — worth reaching for
  by default on any new Radix-menu test rather than debugging a
  mysteriously-closed menu first.

**State at handoff:**

- Last pushed commit: this session's M4 closing commit (see `git log` on
  `claude/synora-ai-platform-h5q0k2` for the exact hash)
- Tests: 577 (backend 385, web 157, design-system 35) — all green locally
  (lint, type-check, test, build across all 5 workspace packages)
- PR #31: open, not merged, tracking this branch — verify CI goes green
  on the new commit
- Next task: M5 (read `NEXT_TASK.md`) — project management UI, document
  editor, AI playground with a real provider selector, generation
  history, prompt library, all workspace-scoped
