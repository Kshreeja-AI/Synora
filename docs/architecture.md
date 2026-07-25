# Synora AI Platform - Architecture Documentation

## System Overview

What Release 1 actually runs — no Redis, no S3, no queue, all deliberate
Release 2/3 scope (see `RELEASE_2_PLAN.md`):

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
│  ├── auth (register/login/refresh/logout)                │
│  ├── users, projects, documents, images                  │
│  ├── ai (text/code generation, 10 providers)              │
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
  response envelope, bearer-token attachment, and single-flight
  refresh-token rotation on 401. `next-auth` and `axios` remain declared
  but unused (`next-auth` reserved for a possible future OAuth flow).
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
- **Cache**: none yet — Redis is Release 2 scope (R2-c), needed once the
  app runs on more than one instance
- **Storage**: none yet — S3-compatible object storage is Release 2 scope
  (R2-d's media generation needs it)
- **Container**: Docker (multi-stage, `node:22-bookworm-slim`)
- **Orchestration**: none — `infrastructure/k8s/` exists but is unused,
  explicitly Release 4 (hyperscale) scope
- **Deployment**: GitHub Actions CI (`test`/`security`/`docker` jobs);
  deploys today are manual (documented commands, no CD pipeline yet —
  Release 2, R2-e)

## Directory Structure

The actual current layout — see `PROJECT_HANDOVER.md` §3 for the fuller,
annotated version:

```
synora/
├── apps/
│   ├── backend/          # Express REST API
│   │   ├── src/
│   │   │   ├── ai/       # Provider-agnostic AI abstraction (10 providers)
│   │   │   ├── config/   # Typed, stage-aware config (zod-validated)
│   │   │   ├── db/       # Prisma client singleton
│   │   │   ├── middleware/
│   │   │   ├── routes/   # auth, users, projects, documents, images, ai
│   │   │   ├── secrets/  # SecretsManager + pluggable sources + audit log
│   │   │   ├── services/ # password, token, lockout, mfa/* (unwired)
│   │   │   ├── utils/    # logger, etc.
│   │   │   └── index.ts
│   │   └── tests/
│   └── web/              # Next.js frontend (App Router)
│       └── src/app/
├── packages/
│   ├── database/         # Prisma schema & migrations
│   ├── shared/           # Shared types, utilities, ApiException hierarchy
│   └── design-system/    # Reusable React components
└── infrastructure/
    ├── docker/
    └── k8s/               # present but unused — Release 4 scope
```

## Data Flow

### Authentication Flow

1. **Register/Login** — `POST /api/auth/register` or `/api/auth/login`
   returns an access token (15 min JWT) and a refresh token (7 day,
   opaque, rotating). The frontend's current storage is `localStorage`
   (not an HTTP-only cookie — that would require the CSRF work Release 2
   couples to a cookie-auth migration).
2. **Authenticated requests** send `Authorization: Bearer <accessToken>`.
   An expired/invalid token gets `401`.
3. **Refresh** — before (or after) the access token expires,
   `POST /api/auth/refresh` with the refresh token returns a new pair and
   revokes the old refresh token (single-use rotation with reuse
   detection).
4. **Logout** — `POST /api/auth/logout` with the refresh token revokes it;
   this is what makes logout actually end the session.

Full detail: `docs/api.md`'s Auth Endpoints section,
`docs/production/R1-c_REFRESH_TOKENS.md`.

### Text/Code Generation Flow (the one AI flow that's actually wired)

1. Client sends `POST /api/ai/generate` with a prompt (and optional mode,
   model, maxTokens, temperature, systemPrompt).
2. The route validates the body with zod, then calls the AI facade
   (`apps/backend/src/ai/index.ts`).
3. The facade resolves a provider — either `AI_PROVIDER` set explicitly,
   or the first configured provider in a fixed priority order (Anthropic
   first) — and calls that provider's adapter directly, **synchronously**.
   There is no job queue: text/code generation is fast enough to serve
   within a single request/response cycle.
4. The response (text, provider, model, token usage, finish reason) comes
   straight back to the client — no polling, no webhook.

Full detail: `docs/production/R1-e_AI_PROVIDER_ABSTRACTION.md`.

### Image/video/audio generation — not implemented

`POST /api/images/generate` exists as a route but returns a hardcoded
placeholder URL (`imageUrl: 'https://via.placeholder.com/...'`) — it does
not call any AI provider. Real media generation needs an async job queue
and object storage, neither of which exist yet; this is Release 2 scope
(`RELEASE_2_PLAN.md`, R2-d). Don't read the route's current shape as a
preview of the real implementation — it will change materially once R2-d
lands.

## Architectural Decisions

### Monorepo Strategy
- **Reason**: Shared code (types, utilities) between frontend/backend
- **Tool**: pnpm workspaces (not npm — see `packageManager` in the root `package.json`)
- **Alternative considered**: Separate repos (more flexibility but code duplication)

### REST API over GraphQL
- **Reason**: Simpler for initial version, easier to cache with HTTP
- **Future**: Can add GraphQL layer if needed

### Prisma as ORM
- **Reason**: Type-safe, great developer experience, auto-migrations
- **Type generation**: Automatic, keeps types in sync with schema

### Tailwind CSS over other solutions
- **Reason**: Utility-first, smaller bundle, great for design system

### JWT + refresh-token authentication
- **Reason**: Stateless access tokens, scalable across multiple servers; a
  revocable refresh token for real sessions/logout
- **Tokens**: 15-min access + 7-day, single-use, rotating refresh
- **Storage today**: `localStorage` on the frontend, sent as
  `Authorization: Bearer <token>` — not an HTTP-only cookie. Moving to
  cookies is coupled to the Release 2 CSRF work (R2-b), since cookies are
  what make CSRF a live concern in the first place.

## Deployment Architecture

### Development
- Local PostgreSQL via `docker-compose.dev.yml`
- Backend on `localhost:3001`, frontend on `localhost:3000`, both run
  directly with `pnpm dev` (not inside Docker)

### Today (Release 1) — manual
- No CD pipeline yet. Deploys are the documented manual sequence in
  `PROJECT_HANDOVER.md` §6: build the Docker image, run migrations, start
  the container, verify `/health`/`/ready`.
- Database is expected to be a managed Postgres provider (RDS, Neon,
  Supabase, Railway) chosen for its automated backups/PITR — that choice
  is a deployment decision, not application code.

### Planned (Release 2, R2-e) — not built yet
Automated CD (tag → staging → production on approval, rehearsed
rollback). Don't assume blue-green deployment, a CDN, or auto-rollback
exist today — none do.

## Security Architecture

See `docs/security.md` for the full, verified-against-source security
picture (authentication, rate limiting, CORS, CSRF status, dependency/
secret scanning, and the explicit list of what's deliberately not yet
implemented). Duplicating it here would just create a second copy to keep
in sync — this section intentionally doesn't.

## Performance Optimization

### Backend
- Every foreign-key column is indexed (`userId`, `workspaceId`,
  `projectId`, etc.); no redundant indexes duplicating a `@unique`
  constraint (fixed in the post-Release-1 audit — see
  `PRODUCTION_READINESS_AUDIT.md`)
- A single shared Prisma client, not one per request (fixed pre-Release-1
  as P0-10 — see `docs/production/P0-10_PRISMA_SINGLETON.md`)
- Request bodies capped at 10MB (`express.json({ limit: '10mb' })`)
- Redis caching: not implemented — Release 2 scope (R2-c), needed once
  the app runs on more than one instance

### Frontend
- Code splitting with Next.js dynamic imports
- Image optimization with Next.js Image component
- CSS tree-shaking with Tailwind
- Component lazy loading

## Monitoring & Observability

### Logging
- Winston, structured. Console-only in production (a container's
  filesystem is ephemeral, so file logs there would just be lost on
  restart); `logs/error.log` + `logs/all.log` files in local development
  only.
- Request/response logging via `requestLogger` middleware — visible in
  the log stream, but there is no dedicated metrics aggregation on top of
  it today.

### Metrics — not implemented
No `/metrics` endpoint, no error-rate dashboard, no query-performance
tracking exist yet. This is Release 2 scope (`RELEASE_2_PLAN.md`, R2-f).
Don't assume request timing or error rates are tracked anywhere beyond
what's visible in raw log lines today.

### Health Checks
- `/health` — liveness only, no DB check. Used by the Docker
  `HEALTHCHECK` and CI's smoke test.
- `/ready` — additionally probes the database; use this for orchestrator
  readiness gating.
- No frontend error boundary exists yet.

## Scaling Strategy

### Current (Release 1)
- Single-instance backend, single-instance database
- Login lockout and rate-limit state are DB-backed — correct for one
  instance, will not correctly share state across two or more (see
  `docs/security.md`)

### Release 2 (R2-c)
- Redis-backed shared state, enabling horizontal scaling
- A load balancer and multiple backend instances become viable once R2-c lands

### Longer-term (Release 3/4, not scoped yet)
- Database read replicas, Kubernetes orchestration, multi-region — all
  explicitly out of scope until Releases 1–3 are done (see
  `RELEASE_ROADMAP.md`'s Release 4 definition)

## Testing Strategy

### What actually exists today
- **Unit/integration tests**: Vitest + Supertest, 273 backend tests + 1
  frontend test, run against a real Postgres instance in CI (no database
  mocks anywhere in the suite)
- Every mutating route has both a happy-path test and a validation-
  failure test

### Not implemented
- **E2E tests**: no Playwright (or other) end-to-end suite exists yet,
  despite `CLAUDE.md`'s tech-stack section naming Playwright as part of
  the intended stack. Release 2, R2-h.
- **Coverage thresholds**: `pnpm run test:coverage` runs and uploads to
  Codecov, but nothing in CI currently fails the build on a coverage
  percentage (`fail_ci_if_error: false`). Treat coverage as informational
  today, not a gate.

---

**Last Updated**: 2026-07-23 (Release 1)
