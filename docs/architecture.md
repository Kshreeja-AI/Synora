# Synora AI Platform - Architecture Documentation

**As of:** 2026-07-25 — Release 2, Milestone 3 (auth/account UX rebuild —
email verification, password reset, session management, account/profile
settings, avatar upload) complete on branch `claude/synora-ai-platform-h5q0k2`.

Everything in this document describes the code as it exists on that
branch today. Sections describing **future** architecture (queue, memory,
agents, self-hosted models) are explicitly labeled as not implemented and
say where the design work for them lives.

## High-Level Architecture

What actually runs today — no Redis, no S3, no queue, no CD, all
deliberate Release 2+ scope (see `RELEASE_2_PLAN.md`):

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                   │
│  TanStack Query + Zustand + typed API client (fetch     │
│  wrapper w/ single-flight refresh rotation), tokens in  │
│  localStorage; UI from @synora/design-system (dark-first │
│  token theme). next-auth/axios still declared-unused.    │
└────────────────────┬────────────────────────────────────┘
                     │ HTTPS, Authorization: Bearer <jwt>
┌────────────────────▼────────────────────────────────────┐
│              Backend API (Express.js)                    │
│  helmet → CORS → global rate limiter → express.json      │
│  → requestLogger → routes (zod-validated) → errorHandler  │
│  ├── auth (register/login/refresh/logout/forgot-reset/    │
│  │   verify-email/sessions/logout-all)                    │
│  ├── users (me, profile, avatar, password, preferences,   │
│  │   account deletion), projects, documents, images       │
│  ├── ai (text/code generation, 10 providers)              │
│  ├── mail (provider-agnostic mailer: console/SMTP)        │
│  ├── storage (provider-agnostic file storage: local today)│
│  ├── config (typed, stage-aware)                          │
│  └── secrets (audited reads, pluggable sources)           │
└────────────────────┬───────────────────┬─────────────────┘
                     │                   │
              ┌──────▼──────┐    ┌───────▼────────┐
              │ PostgreSQL  │    │  AI Provider    │
              │  (Prisma)   │    │  (Anthropic,    │
              │             │    │  OpenAI, etc.)  │
              └─────────────┘    └────────────────┘
```

## Technology Stack

### Frontend
- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **State Management**: TanStack Query (server state, provider in
  `src/app/providers.tsx`) + Zustand (`src/stores/`). The typed API
  client (`src/lib/api/client.ts`) wraps `fetch` with the backend's
  response envelope, bearer-token attachment, single-flight
  refresh-token rotation on 401, and multipart (`FormData`) upload
  support. `next-auth` remains declared but unused (reserved for a
  possible future OAuth flow); `axios` was removed in M3 once the last
  raw-fetch consumer was rebuilt.
- **Styling**: Tailwind CSS, configured via the shared preset
  `@synora/design-system/tailwind-preset` over CSS-variable design
  tokens (`@synora/design-system/styles.css`, dark theme is the
  default; light via `[data-theme="light"]`). Theme switching via
  `next-themes`. Typography: Geist Sans/Mono (bundled, no build-time
  network fetch).
- **Components**: React 19 + `@synora/design-system` (Radix-primitive
  based: Button, Input, Card, Dialog, Tabs, DropdownMenu, Tooltip,
  Avatar, Switch, Toaster/sonner, etc.), tested with Vitest +
  Testing Library
- **Testing**: Vitest

### Backend
- **Runtime**: Node.js 20+/22, ESM (`"type": "module"`)
- **Framework**: Express 4 with TypeScript (strict)
- **Database ORM**: Prisma 5
- **Authentication**: Custom JWT (access) + opaque rotating refresh
  tokens (`jsonwebtoken`, hand-rolled — not NextAuth.js, despite
  `next-auth` being a frontend dependency for a possible future OAuth
  flow)
- **Password hashing**: Argon2id (`argon2` package), bcrypt legacy hashes migrate transparently
- **Validation**: Zod schemas on every mutating route
- **Logging**: Winston (console-only in production; file transports in local dev only)
- **Testing**: Vitest + Supertest, against real Postgres (no DB mocks)

### Infrastructure
- **Database**: PostgreSQL 16
- **Cache**: none yet — Redis is Release 2 scope (M7/R2-c), needed once the
  app runs on more than one instance
- **Storage**: none yet — S3-compatible object storage is Release 2 scope
  (M7/R2-d's media generation needs it)
- **Container**: Docker (multi-stage, `node:22-bookworm-slim`)
- **Orchestration**: none — `infrastructure/k8s/` exists but is unused,
  explicitly Release 4 (hyperscale) scope
- **Deployment**: GitHub Actions CI (`test`/`security`/`docker` jobs);
  deploys today are manual (documented commands, no CD pipeline yet —
  Release 2, M10/R2-e)

## File Structure

The actual current layout — see `PROJECT_HANDOVER.md` §3 for the fuller,
annotated version:

```
synora/
├── apps/
│   ├── backend/          # Express REST API
│   │   ├── src/
│   │   │   ├── ai/       # Provider-agnostic AI abstraction (10 providers)
│   │   │   ├── mail/     # Provider-agnostic mailer (console/SMTP transports)
│   │   │   ├── storage/  # Provider-agnostic file storage (local provider)
│   │   │   ├── config/   # Typed, stage-aware config (zod-validated)
│   │   │   ├── db/       # Prisma client singleton
│   │   │   ├── middleware/
│   │   │   ├── routes/   # auth, users, projects, documents, images, ai
│   │   │   ├── secrets/  # SecretsManager + pluggable sources + audit log
│   │   │   ├── services/ # password, token, lockout, passwordReset,
│   │   │   │             # emailVerification, session, mfa/* (unwired)
│   │   │   ├── utils/    # logger, hashToken, etc.
│   │   │   ├── app.ts    # Express app assembly
│   │   │   └── index.ts  # Entry point: secrets → config → listen
│   │   └── tests/
│   └── web/              # Next.js frontend (App Router)
│       └── src/
│           ├── app/      # layout (fonts/theme/providers), page (landing),
│           │             # providers.tsx, auth/{login,register,
│           │             # forgot-password,reset-password,verify-email},
│           │             # dashboard, dashboard/settings/{profile,account,sessions}
│           ├── components/auth/ # PasswordInput (shared visibility toggle)
│           ├── hooks/    # useCurrentUser, useRequireAuth
│           ├── lib/
│           │   ├── api/  # client.ts (typed fetch + refresh rotation +
│           │   │         # multipart upload), auth.ts, account.ts,
│           │   │         # sessions.ts, types.ts
│           │   └── auth/ # token-storage.ts (localStorage, SSR-safe)
│           └── stores/   # auth-store.ts (Zustand)
├── packages/
│   ├── database/         # Prisma schema & migrations
│   ├── shared/           # Shared types, utilities, ApiException hierarchy
│   └── design-system/    # Design tokens + Tailwind preset + component library
│       ├── src/
│       │   ├── components/  # 17 components (Radix-primitive based) + tests
│       │   ├── lib/cn.ts    # clsx + tailwind-merge
│       │   └── styles/tokens.css  # CSS-variable tokens, dark default
│       ├── tailwind-preset.cjs    # shared Tailwind preset (+ .d.ts)
│       └── vitest.config.ts
└── infrastructure/
    ├── docker/
    └── k8s/               # present but unused — Release 4 scope
```

## Backend Architecture

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

**Config vs secrets** are deliberately separate systems:
`src/config/` holds typed, non-sensitive settings; `src/secrets/`
(SecretsManager) is the only thing that reads credentials, via a
pluggable source chain with audit-logged reads. Full detail:
`docs/security/SECRET_MANAGEMENT.md`,
`docs/operations/ENVIRONMENT_MANAGEMENT.md`.

## Frontend Architecture

- **Root layout** (`src/app/layout.tsx`): Geist Sans/Mono font variables,
  design-system token stylesheet, `Providers` (TanStack `QueryClient` +
  `next-themes` with `attribute="data-theme"`, `defaultTheme="dark"`),
  and the global `Toaster` outlet.
- **API layer** (`src/lib/api/`): `client.ts` exposes `api.get/post/patch/
  delete/upload` typed against the backend envelope `{ success, data,
  error }`. It attaches `Authorization: Bearer <accessToken>`, and on a
  401 performs a **single-flight** refresh (`POST /api/auth/refresh`) so
  the single-use rotating refresh token is never presented twice
  concurrently, then retries the original request once. Refresh failure
  clears tokens. `api.upload` sends `FormData` without a manually-set
  `Content-Type` (the browser adds the multipart boundary). `auth.ts`
  wraps login/register/logout/logoutEverywhere/forgotPassword/
  resetPassword/verifyEmail/resendVerificationEmail; `account.ts` wraps
  profile/avatar/password/preferences/account-deletion; `sessions.ts`
  wraps list/revoke.
- **Token storage** (`src/lib/auth/token-storage.ts`): localStorage under
  `synora.accessToken` / `synora.refreshToken`, SSR-safe guards.
- **Stores** (`src/stores/`): `auth-store.ts` holds `user` + `status`
  (`loading | authenticated | unauthenticated`), mirrored from
  `useCurrentUser` (below) rather than written to directly by pages.
  M4 added three small Zustand stores, each owning exactly one piece of
  UI-only state so it can be triggered from more than one place:
  `workspace-store.ts` (persisted `currentWorkspaceId`, via `zustand/
  middleware`'s `persist` — only the *id* is persisted, never workspace
  data itself, so there's no risk of serving stale workspace content from
  localStorage), `command-palette-store.ts` and
  `keyboard-shortcuts-store.ts` (open/close booleans for their respective
  dialogs), and `create-workspace-store.ts` (shared so the sidebar's
  workspace switcher and the command palette's "Create workspace" action
  open the same `CreateWorkspaceDialog` instance).
- **Hooks** (`src/hooks/`): `useCurrentUser` wraps `GET /api/users/me` in
  a TanStack Query (disabled with no access token; syncs the auth store
  on success, clears it on failure). `useRequireAuth` layers a redirect
  on top — `router.replace('/auth/login?next=<path>')` when there's no
  token or the query errors even after the client's refresh-retry; login
  reads `next` back off the URL. M4 added `useWorkspaces` (list query),
  `useCurrentWorkspace` (resolves the persisted id against the real list,
  falling back to — and persisting — the first workspace if the stored id
  is missing or stale), `useNotifications` (list + unread count, 30s
  poll — there's no websocket/SSE infrastructure yet, so polling is the
  honest choice rather than faking real-time behavior), and
  `useThemePreference` (bridges `next-themes`, instant/local, with
  `UserPreferences.theme`, server-side — hydrates from the server on
  load, updates both together on a user-initiated change).
- **Application shell** (`src/components/shell/`, M4): `Sidebar`
  (collapsible, keeps the M3 mobile-overlay behavior — `fixed` + backdrop
  below the `md` breakpoint), `Topbar` (breadcrumbs, a search-bar-styled
  button that opens the command palette rather than a separate content
  search that has nothing real to index yet, `NotificationsMenu`,
  `UserMenu`), `WorkspaceSwitcher` + `CreateWorkspaceDialog`,
  `NotificationsMenu`, `UserMenu` (profile links, a theme submenu, a
  keyboard-shortcuts trigger, logout), `Breadcrumbs` (derived from
  `usePathname()`), `CommandPalette` (global ⌘K/Ctrl+K via a
  `window` keydown listener; also binds ⌘/ to the shortcuts dialog),
  `KeyboardShortcutsDialog`. `components/shell/AppShell.tsx` composes
  these and renders the three dialog-based components (`CommandPalette`,
  `KeyboardShortcutsDialog`, `CreateWorkspaceDialog`) once, outside the
  scrollable content area, so they're available from anywhere in the
  shell.
- **Two authenticated route trees, one shell**: signed-in surfaces live
  under either `/dashboard/*` (`app/dashboard/layout.tsx`) or the
  `(dashboard)` route group, which holds the full-bleed surfaces that
  sit at the URL root — `/conversations/*` and `/knowledge/*`
  (`app/(dashboard)/layout.tsx`). Both layouts are thin wrappers around
  the same `AppShell`, so the auth guard (`useRequireAuth`) and the
  application frame are defined in exactly one place. The group layout
  passes empty content padding because every page in it brings its own
  chrome (the conversation rail, the knowledge tab bar). Adding a new
  authenticated tree means wrapping `AppShell`, never re-implementing
  the guard.
- **Workspace scoping in the UI**: no authenticated page is
  workspace-*routed*; there is no `/workspaces/:id/...` route. The
  active workspace comes from `useCurrentWorkspace()`. Reading
  `useParams().workspaceId` (or `.id`) on a route that has no such
  segment silently yields `undefined`, which disables every query on
  the page and leaves it stuck on an empty state — this was a real bug
  on the usage and knowledge pages.
- **Pages today**: landing/pricing/features/changelog (`(marketing)`
  route group, M2), `/auth/{login,register,forgot-password,
  reset-password,verify-email}`, `/dashboard` (real empty-state/
  workspace-overview, M4), `/dashboard/settings/{profile,account,
  sessions,workspace}`, `/dashboard/{projects,tools,usage,billing}`,
  and in the `(dashboard)` group `/conversations`,
  `/conversations/[id]`, `/knowledge/{prompts,templates}`; plus the
  unauthenticated `/share/[token]` and `/invite/[token]`. The sidebar
  links every one of these primary surfaces — composed from
  design-system components on
  the typed API client; no page reads `localStorage` directly or wires
  its own token logic. Pages that read a URL query param (`login`,
  `reset-password`, `verify-email`) split into a server `page.tsx`
  (`<Suspense>` wrapper) and a client `*Form.tsx` component, per Next's
  requirement that `useSearchParams()` sit inside a Suspense boundary.
  `/dashboard/[...catchAll]` (M4) unconditionally calls `notFound()` so
  the dashboard-scoped `not-found.tsx` (which keeps the sidebar/topbar
  chrome) is reachable for any unmatched path under `/dashboard/*` — a
  nested `not-found.tsx` is otherwise only reached from an explicit
  `notFound()` call within a segment that already matches a route.
- **Error boundaries** (M4): root `error.tsx`/`not-found.tsx` (safe to
  use design-system components — the root layout's CSS is guaranteed
  loaded by the time they render), `global-error.tsx` (replaces the
  entire root layout on a root-layout-level crash, so it uses inline
  styles only rather than assuming any CSS bundle loaded), and a
  dashboard-scoped `error.tsx`/`not-found.tsx` pair that keep the shell
  chrome visible.
- **Tailwind pipeline**: `postcss.config.js` (tailwindcss + autoprefixer —
  added in M1; before that no postcss config existed and Tailwind never
  actually compiled) + `tailwind.config.ts` consuming the design-system
  preset.

## Design System (`@synora/design-system`)

- **Tokens** (`src/styles/tokens.css`): HSL triples as CSS variables
  (`--background`, `--foreground`, `--primary`, `--muted`, `--border`,
  `--radius`, …). `:root` is the **dark** theme; `[data-theme="light"]`
  overrides. `color-scheme` is set per theme so native controls match.
- **Preset** (`tailwind-preset.cjs`): maps Tailwind color names to
  `hsl(var(--token) / <alpha-value>)`, radii to `var(--radius)`, fonts to
  `var(--font-sans)`/`var(--font-mono)`, plus shared keyframes
  (fade-in/fade-up/shimmer/gradient-x) and `tailwindcss-animate`.
  Consumed by `apps/web/tailwind.config.ts` via
  `@synora/design-system/tailwind-preset`.
- **Components** (18): Button (cva variants, `asChild` via Radix Slot,
  `loading` state), Input, Textarea, Label, Card (+5 subcomponents),
  Badge, Skeleton, Spinner, Separator, Kbd, Dialog, Tabs, Switch,
  Checkbox (M3), Tooltip, Avatar, DropdownMenu (Radix primitives
  throughout), Toaster (sonner) — all exported from `src/index.ts`
  alongside the `cn()` utility (clsx + tailwind-merge).
- **Build/consumption**: compiled with `tsc` to `dist/`; the web app
  consumes the built output (Turbo's `dependsOn: ["^build"]` guarantees
  order). Token CSS and the preset are exported as source via the
  package `exports` map.
- **Tests**: Vitest + Testing Library + jsdom (16 tests across Button,
  Input/Label, Card, Tabs, Badge, cn).

## Authentication Architecture

1. **Register/Login** — `POST /api/auth/register` or `/api/auth/login`
   returns an access token (15 min JWT, HS256, algorithm pinned,
   carrying a `sid` claim) and a refresh token (7 day by default — 30 day
   if `rememberMe: true` — opaque, SHA-256-hashed at rest, rotating). The
   deprecated `token` alias was removed in M3 once the last raw-fetch
   consumer (login/register pages) moved to the typed API client.
   Registration also issues an email-verification token and sends a
   verification email (best-effort; never blocks registration).
2. **Authenticated requests** send `Authorization: Bearer <accessToken>`.
   An expired/invalid token gets `401`.
3. **Refresh** — `POST /api/auth/refresh` with the refresh token returns a
   new pair (new `sid`) and revokes the old refresh token (single-use
   rotation with reuse detection). The API client does this
   automatically, single-flight, on any 401.
4. **Logout** — `POST /api/auth/logout` with the refresh token revokes it;
   `POST /api/auth/logout-all` (M3) revokes every session for the
   account, including the caller's own.
5. **Lockout** — per-account: 5 failed attempts → 15 min lock (both
   config-driven), DB-backed (single-instance correct; Redis in M7).
6. **Sessions** (M3) — every `RefreshToken` row doubles as a listable
   "session" (`GET /api/auth/sessions`), with device metadata (parsed
   User-Agent, IP, last-used time) captured at issue/rotation time. The
   access token's `sid` claim marks which session is "this device" client
   side.
7. **Password reset / email verification** (M3) — `PasswordResetToken`
   and `EmailVerificationToken` mirror `RefreshToken`'s hash-at-rest,
   single-use discipline. Consuming a reset token revokes every session
   for the account.

Storage today is `localStorage` + bearer header — **not** cookies, which
is why CSRF protection is correctly deferred until the cookie-auth
migration (M6/R2-b). Full detail: `docs/api.md`,
`docs/production/R1-c_REFRESH_TOKENS.md`.

## AI Engine Architecture / Provider Abstraction

`apps/backend/src/ai/` — the layer everything AI goes through. UI and
routes never touch a vendor SDK directly.

- **Facade** (`index.ts`): `generateText(request)` — the only entry point
  routes use.
- **Registry** (`registry.ts`): every provider ships an
  `AIProviderDescriptor` — `id`, `displayName`, `capabilities`,
  `isConfigured()` (checks SecretsManager/config, never throws),
  `create()` (builds the adapter). Adding a provider = adding one
  descriptor file; nothing else changes.
- **Resolver** (`resolver.ts`): a per-call `explicitProviderId` (Release 3
  M2 — how `Conversation.provider` overrides the process-wide default for
  one conversation) wins if passed; otherwise explicit `AI_PROVIDER` env
  override wins; otherwise the first *configured* provider in a fixed
  priority order (Anthropic first).
- **Providers** (10): Anthropic, OpenAI, Gemini, xAI, OpenRouter,
  DeepSeek, Together, Azure OpenAI, AWS Bedrock, Ollama. The
  OpenAI-compatible ones share one adapter parameterized by base URL.
  Bedrock deliberately requires an explicit `BEDROCK_REGION` so ambient
  AWS credentials can never silently activate a billable provider (bug
  found and fixed in R1 — see
  `docs/production/R1-e_AI_PROVIDER_ABSTRACTION.md`).
- **Errors**: adapters wrap vendor errors in `AIProviderError` with the
  provider id, so callers never see vendor-specific error shapes.

### Multi-provider / future self-hosted models

The contract is capability-based (`text-generation`, `code-generation`
today; media capabilities join in M7). A future self-hosted Synora model
is just another descriptor whose `create()` points at an internal
endpoint (the Ollama provider is the proof: it already serves
self-hosted models via a base URL with zero special-casing). Business
logic and UI are unaffected by provider swaps — that invariant is
non-negotiable (see `PROJECT_HANDOVER.md` "Things that must never be
changed"). Interface design for hyperscale self-hosted serving lives in
the `feature/synora-infra-interfaces` branch (unmerged design work).

### Conversation Generation Flow

Generation is **asynchronous**: the HTTP request enqueues a job and
returns immediately with an empty assistant placeholder, and the client
streams tokens over SSE. There is exactly one generation
implementation — the `generate_response` BullMQ worker
(`workers/generateResponse.worker.ts`) on top of `ai/streaming/*`.

```
POST .../messages (role=USER)
  → messageService.create() persists the user message (final, immediately)
  → messageService.createPlaceholder(ASSISTANT, parentId=userMessage.id)
  → messageService.enqueueGeneration() → StreamingJob(PENDING)
                                       → enqueueGenerateResponse() (BullMQ)
  ← 201 { userMessage, assistantMessage (empty), jobId }   [request ends here]

generate_response worker
  → StreamingRetryEngine.executeWithRetry (owns retries + StreamingJob state)
      → getStreamingResolver().resolve(conversation.provider)
      → provider streams tokens → StreamingAccumulator
           tokens published to Redis; the SSE endpoint relays them to the client
           cancellation: client → SSE cancel → Redis `job:<id>:control` → AbortController
      → TokenAccountant → ConversationUsage upserted
      success → assistant Message content filled in, StreamingJob COMPLETED
      failure → StreamingJob FAILED after the retry budget
```

Retries live in `StreamingRetryEngine`, not in the queue: the BullMQ job
is enqueued with `removeOnComplete` and no BullMQ-level retry, so there
is a single owner of retry policy and no risk of two layers each
retrying a billable provider call.

Two earlier generation services — `conversationGeneration.service.ts`
(synchronous, request-scoped) and `messageGeneration.service.ts`
(generator-based) — were deleted once this worker superseded them. Each
carried its own retry loop, prompt window, and usage accounting;
parallel generation paths are the kind of duplication that ends in
double-charging a customer for one reply.

Deliberately synchronous: there is no Redis-backed queue or SSE/WebSocket
transport in Release 3 M2 (see "Queue Architecture" and this section's
note below) — the entire exchange happens within the one HTTP request
that created the user message. An assistant `Message` row is only ever
created on a successful generation; there is no `PENDING` placeholder
message and no `Message.status` field — `StreamingJob` is the sole
"generation in flight" state, so there's exactly one place that can say
whether a reply is done, not two that could disagree.
`docs/archive/M2_IMPLEMENTATION_PLAN.md` §6, §7, and §12 have the full design
rationale, including the future path to an async/queued/streamed version
that changes *who calls* this service, not its internal retry/state-machine
logic.

## Mailer Abstraction {#mailer-abstraction}

`apps/backend/src/mail/` (Release 2 M3) — mirrors the AI abstraction's
shape exactly: routes/services never import a mail SDK directly.

- **Facade** (`mailer.ts`): `sendVerificationEmail`,
  `sendPasswordResetEmail`, `sendPasswordChangedEmail`,
  `sendAccountDeletedEmail` — the only functions callers use.
- **Registry** (`registry.ts`): `MailTransportDescriptor` per transport —
  `id`, `displayName`, `isConfigured()`, `create()`.
- **Resolver** (`resolver.ts`): unlike AI provider selection, transport
  choice is **never** auto-detected — `mail.transport` (env
  `MAIL_TRANSPORT`, default `console`) is the one explicit switch. Console
  is always "configured" (no external dependency), so silently
  "upgrading" to SMTP just because credentials happen to be present would
  be surprising — and SecretsManager's placeholder fallback in
  development/testing/qa means presence alone can't mean "really
  configured" anyway (see `secrets/sources/placeholderSource.ts`).
- **Transports**: `console` (default everywhere; logs the message and
  keeps a bounded in-memory record tests import directly to assert on —
  `getConsoleMailLog()`/`clearConsoleMailLog()`), `smtp`
  (nodemailer-based, real, activated by `MAIL_TRANSPORT=smtp` +
  `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`).
- **Templates** (`templates/`): plain functions returning
  `{ subject, html, text }`, sharing one dark-mode-friendly, inline-CSS
  layout (`layout.ts`) — no templating engine, no external dependency.

A real email provider is a launch-time config choice (per the founding
launch principle) — add SMTP env vars, no code change.

## Storage Abstraction {#storage-abstraction}

`apps/backend/src/storage/` (Release 2 M3) — same descriptor-registry
shape again, used today for avatar uploads; a future S3-compatible
provider (Release 2 M7's media pipeline) is a new descriptor, not a
call-site change.

- **Facade** (`index.ts`): `uploadAvatar({ userId, buffer, contentType })`,
  `avatarKeyFromUrl(url)` (extracts the storage key from a previously
  returned URL — returns `null` for anything not hosted by this app's own
  storage, so deletion never touches a URL it doesn't own),
  `deleteAvatar(key)`, `isAllowedAvatarContentType`.
- **Registry/resolver**: `storage.provider` (env `STORAGE_PROVIDER`,
  default `local`) is the explicit switch, mirroring `ai.provider` /
  `mail.transport`.
- **Providers**: `local` (writes under `storage.localDirectory`, served
  back out via `express.static` at `storage.publicBasePath` — mounted in
  `app.ts` only when the local provider is active, with
  `Cross-Origin-Resource-Policy: cross-origin` on that path only, since
  the web app runs on a different origin/port and needs to load these
  images directly). Correct for the single-instance deployment target,
  same posture as the DB-backed login lockout.
- **Upload path**: `POST /api/users/me/avatar` uses `multer` (memory
  storage) for multipart parsing; the route double-checks the configured
  size limit itself (multer's own ceiling is a generous static fallback,
  since `src/routes/users.ts` is imported — and its module-scope `multer()`
  call evaluated — before `initConfig()` has necessarily run).

### Agent architecture — implemented

CORRECTED: this section previously said no agent or orchestration layer
existed. Agents, a deterministic local planner, per-step approval gates
and provider-native tool calling all ship today. As designed, the layer
sits **above** `generateText()` and below routes, so it inherits
provider-agnosticism by construction rather than handling providers
itself. See `src/agents/` and the Universal Command Layer below.

## Universal Command Layer

The human-facing control language: a person describes an OUTCOME in their
own words, and Synora resolves it into real capabilities, real permission
answers, and real execution — or into an honest refusal. It lives in
`apps/backend/src/command/` and is reached through `/api/command/*`.

**It is deliberately deterministic and local.** Understanding, resolution,
decomposition, permission checks, approval flow and scheduling logic are
Synora's own code, not a model call. Three reasons, in order: a model asked
to interpret a hostile sentence can be *talked into* interpreting it
favourably (that is what prompt injection is, and a fixed grammar cannot be
argued with); understanding "show me what needs my decision" must work when
every provider is down; and a deterministic classifier that fails to
recognize a sentence says so, while a model always produces something whose
shape is indistinguishable from a correct answer. A model may LATER improve
ranking or phrasing coverage — it must never become required.

**The pipeline**, each stage separate on purpose:

```
sentence
  → understand   deterministic grammar → intent + subject   (identity-free)
  → decompose    one sentence → the actions it describes     (slice 14)
  → prepare      per-step: may THIS person, in THIS workspace
  → decide       capability? available here? risk class? approval?
  → approve      authoritative gate; server re-derives the action
  → execute      the SAME services the ordinary routes call
  → record       durable CommandExecution row, successes and refusals alike
```

**Ten execution states, never blurred**: `completed`, `not-authorized`,
`unavailable`, `not-implemented`, `not-bound`, `waiting-approval`,
`needs-input`, `rejected`, `expired`, `failed`. Each answers a different
question and sends a person to a different place for help — collapsing any
two is how a layer starts lying. `not-bound` in particular means "Synora
can do this, but not yet by being asked in plain language", which is
neither a missing capability nor a bug.

### Multi-step commands

`decompose.ts` splits one sentence into the actions it describes;
`plan.ts` resolves each step through the SAME `decideCommand` a single
command uses. A plan is not a privileged path — it is several ordinary
commands with an order between them.

- **No step inherits anything from its neighbours.** Permission,
  availability and approval are re-asked per step. Otherwise a harmless
  first step could carry a dangerous last one past the gate.
- **Under-split, never over-split.** Merging two actions is visible and
  harmless; inventing one means acting on a fabrication. Only segments
  that independently read as actions become steps.
- **Dependencies come from back-references** ("summarize *it*"). A step
  that refers to nothing waits for nothing; a step whose input will never
  exist is marked blocked rather than ready.
- **Capabilities, never vendors.** A step names `ai.generate`, not a
  provider; provider choice stays in the existing resolver.
- **Planning executes nothing** (`executed: false` is a literal type, and
  no durable record is written). `POST .../plan` resolves and reports;
  `POST .../plan/execute` is the endpoint that acts.

### Running a plan

`run-plan.ts` stores the plan (`CommandPlan` + `CommandPlanStep`) and runs
its steps in order. Each step is executed by the SAME `executeCommand` a
single command uses, so it re-derives its capability, re-checks the
caller's permission at the moment it runs, honours the approval gate, and
writes its own `CommandExecution` audit row — correlated by `planId` and
`planStepIndex`, so a trail reads PLAN → STEP → APPROVAL → outcome.

- **Durable, because plans pause.** A plan can stop at an approval someone
  answers tomorrow. In-memory state would mean a deploy silently discards
  work a person is waiting on, and they would never learn why.
- **Stop honestly; do not push on.** Execution halts at the first step that
  does not complete and does not skip ahead to later "independent" steps.
  A person who asked for four things and received an unpredictable subset
  has to reconstruct which; a plan that stops leaves a state describable in
  one sentence. Steps never reached are `skipped`, deliberately not
  `failed` — nothing was attempted, so nothing broke.
- **Never retries.** No capability here carries an idempotency key, so a
  retry could create a second schedule or a second conversation. The
  response's `safeToRetry` says plainly whether asking again would repeat
  anything: false as soon as any step completed.
- **`partially-completed` is first-class**, never collapsed into
  `completed` or `failed`. "Three of four ran" is the truth and both
  neighbours are lies about it.
- **A dependency that did not complete stops the dependent step.** Running
  it would act on an input that does not exist.

### Resuming after a decision

Deciding a paused step continues its plan, from the approval path itself
once the decision is durably recorded (never before — a resume that
crashed must not be able to lose the approval that authorised it).

- **An approval buys its own step and nothing else.** Every remaining step
  runs through `executeCommand`, so a later step that needs approval pauses
  the plan again. "Approve once, act broadly" is precisely what this layer
  exists to prevent.
- **The decided step is never re-run.** It already ran inside the approval
  transaction, and a person authorised it exactly once.
- **The requester's CURRENT role is re-fetched.** Roles change while plans
  sit in queues; a plan resumed tomorrow is entitled to what its requester
  can do today, not what they could do when they asked. If they have left
  the workspace, the remaining steps do not run under anyone else's
  authority.
- **A rejected step gives the plan status `rejected`**, distinct from
  `failed`: a person said no, nothing broke, and those send an operator to
  completely different places.
- **A failed resume never fails the approval.** The decision is recorded
  and the action already ran; throwing would report an authorised,
  completed action as an error and invite a repeat.

Not yet reachable end-to-end: an approved step that then COMPLETES. Every
capability requiring approval is currently unbound, so approving one
honestly yields `not-bound` and the plan stops. The resume path is
exercised directly against real stored plans until a sensitive capability
is bound.

## Queue Architecture — not implemented (M7)

There is no job queue today; text/code generation is served
synchronously because it fits in a request/response cycle.
`POST /api/images/generate` currently returns a hardcoded placeholder
URL and calls no provider. M7 (R2-c + R2-d) introduces: Redis →
async job queue → worker → S3-compatible object storage → 202-enqueue /
poll-or-notify API shape for image, video, and audio generation. Do not
read the current images route as a preview of that design.

## Memory Architecture — storage and retrieval real, semantic search disabled

Conversation memory **does** exist as of Release 3: `Memory` and related
tables in the Prisma schema, `memory.service` / `memoryRetrieval.service`
/ `memoryGdpr.service`, and routes mounted at
`/api/workspaces/:workspaceId/memories`. Storage, permissions
(PRIVATE/WORKSPACE/SHARED/PUBLIC), GDPR erasure, and retrieval are
implemented and tested.

Semantic search runs on two provider-agnostic subsystems that are fully
implemented and awaiting credentials:

- **`src/embeddings/`** — 7 providers (OpenAI, Voyage, Gemini, Cohere,
  Claude, Ollama, self-hosted) behind one `EmbeddingService`, with
  caching, rate limiting, retry, circuit breaking, metrics, chunking and
  workspace-scoped cost accounting built in.
- **`src/vectordb/`** — 5 providers (pgvector, Pinecone, Qdrant,
  Weaviate, Milvus) behind one `VectorDBService`, with namespace and
  workspace scoping plus defense-in-depth permission filtering.

`memoryEmbedding.service` owns no provider logic of its own; it calls
`embed()` and `upsertVectors()/queryVectors()` and lets each subsystem
select its provider from configuration. **Semantic search activates
automatically the moment an embedding provider and a vector database are
both configured** — no code change, no redeploy of application logic.
Until then it is *disabled, not approximated*: the semantic route returns
503, indexing skips rather than writing `embeddingId` values for vectors
that don't exist, and no approximate vector is ever generated.

Required credentials are listed in `.env.example` (`EMBEDDING_*`,
`VECTORDB_*`). `GET /api/capabilities` reports which capabilities are
live in a running deployment and what each unconfigured one currently
does instead — this is the confirmation step after adding credentials.

Retrieval stays useful meanwhile: `memoryRetrieval.service` ranks on
lexical term overlap, importance, recency, and access frequency, dropping
the semantic weight and renormalizing the rest so scores remain
comparable. Results carry `rankingDetails.semanticSearchUsed` so callers
can distinguish "no vector signal available" from "not similar".

When a real embedding provider and vector store are added, they plug in
behind the `IEmbeddingModel` / `IVectorDB` interfaces — pgvector ↔
dedicated vector DB is a configuration change, not a rewrite.

## Database Architecture

PostgreSQL 16 via Prisma 5; schema at
`packages/database/prisma/schema.prisma` (21 models), shared Prisma
client singleton in `apps/backend/src/db/` re-exported through
`@synora/database`.

Model groups:
- **Identity**: User (roles USER/ADMIN/MODERATOR, status, lockout
  fields), Account (OAuth placeholder), UserProfile, UserPreferences
- **Workspaces**: Workspace, WorkspaceMember (role enum OWNER→VIEWER) —
  create/list/get/rename routes shipped in M4, membership-checked;
  WorkspaceInvitation, ApiKey remain schema-only (M6 scope)
- **Content**: Project, Document, GeneratedImage, GeneratedVideo,
  GeneratedAudio (media rows are written by placeholder routes only)
- **Auth/session**: RefreshToken (hash-only storage, revocation, expiry,
  and — since M3 — device metadata doubling as the user-facing session
  list), PasswordResetToken, EmailVerificationToken (both M3, same
  hash-at-rest/single-use discipline), Session + VerificationToken
  (NextAuth placeholders, unused)
- **Notifications** (M4): Notification (type enum SECURITY/ACCOUNT/
  WORKSPACE/SYSTEM) — every row created at a real backend event, never
  seeded
- **Audit**: ActivityLog, MFAAuditLog (soft user reference — audit rows
  outlive users)

7 migrations applied: `init`, `add_refresh_token`, `add_login_lockout`,
`drop_redundant_unique_indexes`, `add_password_reset_token`,
`add_email_verification_and_session_metadata`,
`add_notification_model`. Every FK column is indexed; no redundant
indexes duplicating `@unique`. No seed script exists. Full column-level
docs: `docs/database.md`.

## API Flow Diagrams / Request Lifecycle

### Authenticated CRUD request (current)

```
Browser (React Query hook)
  → api.get('/api/projects')            [src/lib/api/client.ts]
    → fetch, Authorization: Bearer <access>
      → helmet → CORS → rate limit → json → requestLogger
        → authenticate middleware (JWT verify, HS256 pinned)
          → route handler (zod-validate → Prisma, scoped by userId)
        ← { success: true, data, meta }
    ← 401? → single-flight POST /api/auth/refresh → retry once
  ← typed T (envelope unwrapped) or ApiError { status, code, message }
```

### Text generation (current)

```
POST /api/ai/generate { prompt, mode?, model?, ... }
  → zod validation
  → ai facade generateText()
    → resolver: AI_PROVIDER override || first configured (priority order)
    → provider adapter (vendor SDK) — synchronous
  ← { text, provider, model, usage, finishReason }
```

### Media generation (M7 target shape — not built)

```
POST /api/images/generate → 202 { jobId }
  → enqueue (Redis) → worker → provider adapter → object storage
GET /api/images/:id → status/result (durable URL)
```

## Security Layers

See `docs/security.md` for the full, verified-against-source picture.
Summary of layers, outermost first: HTTPS (deployment), helmet headers,
CORS allowlist, IP rate limiting, zod input validation, JWT
verification (pinned algorithm), per-account lockout, Argon2id password
hashing (bcrypt migration on login), hashed single-use refresh tokens
with reuse detection, Prisma parameterized queries, centralized error
handling that hides internals outside development, secrets isolated in
SecretsManager with audited reads, CI gates (`pnpm audit` high+,
gitleaks, Snyk best-effort), Docker non-root user + no `.env` in image
layers. Not yet: MFA (M6), CSRF/cookie auth (M6), Redis-shared
rate-limit state (M7).

## Scaling Strategy

- **Today**: single backend instance, single Postgres. Lockout/rate-limit
  state is DB-backed — correct for one instance only.
- **M7 (R2-c)**: Redis-backed shared state → horizontal scaling of the
  API tier becomes safe; also the substrate for the M7 job queue.
- **Release 3/4**: read replicas, Kubernetes (`infrastructure/k8s/` is a
  placeholder), multi-region — explicitly out of scope now.
- **Design rule**: nothing added in Release 2 may assume single-instance
  state unless it's DB-backed (the M1 frontend is stateless per-tab, so
  it scales trivially).

## Deployment Architecture

### Development
- Local PostgreSQL via `docker-compose.dev.yml`; backend `:3001`, web
  `:3000`, both via `pnpm dev` outside Docker.

### Today — manual
- CI (GitHub Actions): `test` (lint, type-check, full suite against real
  Postgres, build, coverage), `security` (audit + gitleaks + Snyk
  best-effort), `docker` (build + non-root smoke test polling
  `/health`). All three block.
- Deploys are the documented manual sequence in `PROJECT_HANDOVER.md`:
  build image → `db:migrate` → run container → verify `/health`/`/ready`.
- Managed Postgres (RDS/Neon/Supabase/Railway) supplies backups/PITR.

### Planned (M10/R2-e) — not built
Tag → staging → production CD with approval gate and rehearsed
rollback. No blue-green, CDN, or auto-rollback exists today.

## Architectural Decisions (with reasons)

- **Monorepo (pnpm workspaces + Turbo)** — shared types/utilities between
  apps; single dependency graph; `packageManager`-pinned pnpm.
- **REST over GraphQL** — simpler for this stage, HTTP-cacheable; GraphQL
  can layer on later without breaking the envelope.
- **Prisma** — type-safe schema-first ORM; generated client keeps types
  in sync with migrations.
- **Custom JWT + rotating refresh tokens over NextAuth** — full control
  over token rotation/reuse detection; NextAuth stays a declared future
  option for OAuth.
- **Bearer tokens now, cookies later** — bearer isn't CSRF-vulnerable,
  letting CSRF land together with the cookie migration (M6) instead of
  as ceremony.
- **Design tokens as CSS variables + shared Tailwind preset** — theming
  is a data-attribute swap with no rebuild; every app consumes one
  source of truth; components stay class-based (tree-shakeable, SSR-safe).
- **Radix primitives under design-system components** — accessibility
  (focus traps, aria, keyboard) is inherited, not hand-rolled.
- **Geist via npm package, not next/font/google** — no build-time network
  fetch, so Docker/CI builds can't fail on font download.
- **Dist-consumption of design-system (tsc build)** — keeps the web build
  free of cross-package transpilation surprises; Turbo orders builds.
- **Config/secrets separation** — typed config is inert data; credential
  reads are centralized, audited, and pluggable per platform.
- **Synchronous text generation, async media later** — matches actual
  latency profiles; avoids building queue infrastructure before its
  first real consumer.
- **Mailer and storage as descriptor-registry abstractions (M3)** —
  identical shape to the AI provider abstraction (registry + resolver +
  facade), so a real SMTP provider or S3-compatible bucket is a
  launch-time config choice, never a rewrite. Deliberately **not**
  auto-detected the way AI providers are: SecretsManager's development/
  testing/qa placeholder fallback means every secret key "resolves" to
  *something* in those stages, so "credentials happen to be present"
  can't mean "really configured" the way it does for AI keys — transport/
  provider selection is always the explicit `MAIL_TRANSPORT`/
  `STORAGE_PROVIDER` env var.
- **Workspace packages declare `"type": "module"` (M3 fix)** —
  `@synora/shared` and `@synora/database` were missing this field, which
  Node's ESM loader tolerates via a "sniff and reparse" fallback in a
  plain script but not under `tsx watch` (the backend's `pnpm dev`),
  which failed with `does not provide an export named …` for both
  packages. Declaring `"type": "module"` explicitly (plus a `.js`
  extension on `@synora/shared`'s two relative `export *` specifiers,
  required for Node's ESM resolver even under `moduleResolution: "node"`
  at the TypeScript level) fixes it with no build or test impact — `tsup`
  (backend) and Next's bundler (web) never hit this class of bug, only
  the ESM-loader-native dev-mode path did.

## Testing Strategy

### What actually exists today
- **Backend**: 361 Vitest + Supertest tests against real Postgres (no DB
  mocks) — every mutating route has happy-path + validation-failure
  coverage; services, config, secrets, AI resolver/providers, mail
  (transport registry/resolver/facade via the console transport's
  in-memory log), storage (local provider against a real temp directory)
  all covered.
- **Web**: 98 tests — API client (envelope, errors, 401→refresh→retry
  single-flight, anonymous paths, multipart upload), token storage, auth
  store, `useCurrentUser`/`useRequireAuth`, every auth page
  (login/register/forgot-password/reset-password/verify-email), dashboard
  shell (incl. the mobile sidebar-overlay behavior), and every settings
  page (profile/account/sessions).
- **Design system**: 20 component/utility tests (Testing Library),
  including the M3 Checkbox component. A jsdom `ResizeObserver` polyfill
  (`apps/web/vitest.setup.ts`) is required for any test that renders
  Radix Checkbox/Switch — jsdom doesn't implement `ResizeObserver` at
  all, and the primitives construct one on mount via a layout effect.
- CI runs the full suite plus coverage upload on every push.

### Not implemented
- **E2E**: no Playwright suite yet — lands in M10 (R2-h) against the
  finished R2 feature set.
- **Coverage thresholds**: coverage is informational
  (`fail_ci_if_error: false`), not a gate.

## Release Roadmap Integration

- **Release 1** (complete): launchable core — auth, CRUD, AI text/code,
  security hardening, CI, Docker. Snapshot: `RELEASE_1_FINAL.md`.
- **Release 2** (in progress): complete customer-facing platform. M1
  (foundation) and M2 (marketing site) complete; M3 (redefined scope:
  auth/account UX — see `CURRENT_STATE.md`) is this document's baseline;
  onboarding wizard, workspace creation, and app shell (sidebar/topbar/
  command palette) — originally scoped into M3 by `RELEASE_2_PLAN.md` —
  are deferred to a later milestone. Original register items map
  R2-a/b→M6, R2-c/d→M7, R2-e/f/g/h→M10.
- **Release 3**: enterprise (workspace tenancy enforcement, SSO, audit,
  agents/memory candidates).
- **Release 4**: hyperscale (Kubernetes, multi-region, read replicas,
  self-hosted model serving per `feature/synora-infra-interfaces`).

---

**Last Updated**: 2026-07-25 (Release 2, Milestone 3)
