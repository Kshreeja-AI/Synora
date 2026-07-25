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
flows, AI playground, billing, admin, and observability across 9
milestones. As of this writing, M1 (design system foundation) and M2
(marketing site) are complete; M3 (auth UX + onboarding + app shell) is
next.

---

## 2. Current State of Progress

| Area | Status |
|---|---|
| **Release** | Release 2 in progress |
| **Milestones complete** | M1 (design system foundation), M2 (marketing site) |
| **Current milestone** | M3 (auth UX + onboarding + app shell) — not started |
| **Branch** | `claude/synora-ai-platform-h5q0k2` |
| **Last pushed commit** | `da8b5a1` — "docs: close M2 — update CURRENT_STATE, set NEXT_TASK to M3" |
| **PR** | #31 → base `SYNORA`, open, not merged |
| **CI** | Green on `da8b5a1` |
| **Tests** | 312 total (backend 273, web 23, design-system 16) |
| **Production readiness** | ~35-40% toward Release 2 launch |
| **Known issues** | None open at code level |
| **Uncommitted on disk** | `PasswordResetToken` model added to Prisma schema + migration SQL (M3 prep, NOT committed) |

### What is complete and working

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
- Design tokens (dark default/light override), shared Tailwind preset,
  17-component design-system library (Radix-based) with 16 tests
- Working Tailwind pipeline (postcss config added in M1 — Tailwind had
  never compiled before)
- Typed API client with single-flight 401-refresh-retry, token storage,
  Zustand auth store, TanStack Query + next-themes providers, Geist fonts
- Marketing site: glass navbar (mobile menu, theme toggle) + footer;
  animated landing page; pricing page + FAQ; six SSG feature pages from
  one template; changelog timeline — all driven by typed content modules;
  sitemap/robots/OpenGraph

### What is working but interim

- Login/register/dashboard pages: styled with the design system but still
  using their original raw `fetch` + `localStorage['token']` logic —
  rebuilt on the new API client + auth store in M3
- Backend auth responses carry a deprecated `token` alias for
  `accessToken` until M3 removes the last consumer

### What is partially completed

- **Workspaces/teams:** full Prisma schema exists; zero routes/UI — M3
  creates the first workspace routes, M5 completes
- **MFA:** complete implementation on `recover/mfa` branch (needs rebase);
  4 MFA-adjacent services in mainline (`services/mfa/`) are tested but
  dead code — M5
- **CSRF:** complete implementation on `recover/csrf` branch; lands with
  the cookie-auth migration — M5
- **Media generation:** `POST /api/images/generate` returns a hardcoded
  placeholder; no provider, no queue, no storage — M6

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
| `WorkspaceInvitation` | Invite tokens | workspaceId, email, role, token (unique), expiresAt, acceptedAt | Schema only — M5 |
| `ApiKey` | Workspace API keys | workspaceId, name, key (unique), lastUsedAt, expiresAt | Schema only — M5 |

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
  capabilities join in M6.
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
  in M5.
- **MFA**: fully built on `recover/mfa` branch, not merged. Lands in M5.
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

M7 billing can bind to the same plan IDs without page rewrites.

### Current routes

| Route | Layout | Status |
|---|---|---|
| `/` | `(marketing)` | Landing page — hero, stats, features, CTA |
| `/pricing` | `(marketing)` | Plan cards + FAQ accordion |
| `/features/[slug]` | `(marketing)` | 6 SSG feature pages |
| `/changelog` | `(marketing)` | Timeline with dated entries |
| `/auth/login` | Standalone | Styled but still raw-fetch (M3 rebuild) |
| `/auth/register` | Standalone | Styled but still raw-fetch (M3 rebuild) |
| `/dashboard` | Standalone | Basic sidebar (M3 replaces with app shell) |

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
| MFA | Built on branch, not merged; launch without is standard practice | M5 |
| CSRF | Only matters with cookie-auth; bearer tokens aren't vulnerable | M5 |
| Redis-shared rate limits | Single-instance is correct for now | M6 |
| Field-level encryption | Not needed until PII compliance work | R3 |
| Auth-endpoint rate limiting | Global limiter covers for now | M5 |
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

SaaS subscription with usage-based tiers. Billing abstraction (M7) will
be provider-agnostic with Stripe as the first adapter. Plan IDs in the
content module are designed to map directly to billing plan IDs when M7
ships.

### Not yet implemented

- Payment processing (M7)
- Usage metering and dashboards (M7)
- API key enforcement for external integrations (M5)
- Team seat management (M5)

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
| **M3** | Auth UX + onboarding + app shell | **Next** | Rebuild login/register on API client, forgot-password flow, onboarding wizard, workspace creation, app shell (sidebar/topbar/command palette), keyboard shortcuts |
| **M4** | Core product surfaces | Pending | Project management UI, document editor, generation history, AI playground, prompt library |
| **M5** | Workspace, security & account | Pending | Team management, invitations, settings, API keys, MFA (rebase `recover/mfa`), CSRF + cookie auth (rebase `recover/csrf`) |
| **M6** | Media generation + assets | Pending | Redis, async job queue, image/video/audio generation, asset manager, file uploads, object storage |
| **M7** | Billing, usage & notifications | Pending | Provider-agnostic billing (Stripe first), subscriptions, usage dashboard, analytics, notifications |
| **M8** | Admin, support & content | Pending | Admin dashboard, monitoring, audit logs, feedback, support center, docs site, blog, API docs |
| **M9** | Quality closeout & ops | Pending | CD pipeline, metrics/alerting, backups, Playwright E2E suite, accessibility pass, mobile polish |

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
| Redis (managed) | M6 | Not provisioned |
| S3-compatible bucket | M6 | Not provisioned |
| Stripe test keys | M7 | Not configured |
| Email provider | M5 (invitations) | Abstracted; console transport ships with M3 |
| CD platform | M9 | Not decided |
| Metrics backend | M9 | Not decided |

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
- E2E (Playwright): arrives in M9
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

- [ ] Marketing site (M2 — **done**)
- [ ] Auth UX: forgot-password, polished login/register, protected routes (M3)
- [ ] App shell: sidebar, topbar, command palette, keyboard shortcuts (M3)
- [ ] Onboarding: post-registration wizard (M3)
- [ ] Workspace creation flow (M3)
- [ ] Project management UI with real CRUD (M4)
- [ ] AI playground with model selector (M4)
- [ ] Team management, invitations, settings (M5)
- [ ] MFA (M5)
- [ ] Cookie auth + CSRF (M5)
- [ ] Media generation: image/video/audio with queue + storage (M6)
- [ ] Billing: subscription management, usage metering (M7)
- [ ] Admin dashboard with monitoring (M8)
- [ ] CD pipeline with tested rollback (M9)
- [ ] Metrics endpoint + alerting (M9)
- [ ] Playwright E2E suite (M9)

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

**M3 — Auth UX + Onboarding + App Shell**

Full specification is in `NEXT_TASK.md`. Summary:

1. **Auth rebuild** — login/register pages rewritten on the M1 API client
   + Zustand auth store (delete raw-fetch + localStorage['token'] logic)
2. **Forgot-password flow** — password-reset tokens (hashed at rest,
   single-use, ≤1h expiry) + provider-agnostic mailer abstraction with
   console/dev transport + forgot/reset pages
3. **Onboarding wizard** — post-registration: name → workspace creation →
   theme preference; skippable; runs once
4. **Workspace creation** — first workspace routes (create + list mine +
   get, slug uniqueness, creator becomes OWNER)
5. **App shell** — collapsible sidebar, topbar with workspace switcher +
   user menu, command palette (Cmd+K), keyboard shortcuts, protected routes
6. **Cleanup** — remove deprecated `token` alias, remove `axios` dependency

### Partial work on disk (uncommitted)

- `packages/database/prisma/schema.prisma` — `PasswordResetToken` model
  added + `passwordResetTokens` relation on `User`
- `packages/database/prisma/migrations/20260725061000_add_password_reset_token/migration.sql`
  — migration SQL

This work was started before the user requested this document and halted.
It should be committed as part of M3's first batch.

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
- Next task: M3 (read `NEXT_TASK.md`)
