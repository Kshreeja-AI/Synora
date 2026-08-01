# Synora Final Architecture

**Date**: 2026-07-28
**Commit**: `e122248`
**Status**: Architecture verified sound; Release 3 presentation layer absent

---

## System Overview

Synora is a pnpm-workspace monorepo containing two applications and three shared packages, backed by PostgreSQL and orchestrated by Turbo.

```
┌─────────────────────────────────────────────────────────────┐
│  apps/web  —  Next.js 15 App Router, React 19               │
│  22 pages · TanStack Query (server state) · Zustand (UI)    │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS / JSON
┌────────────────────────▼────────────────────────────────────┐
│  apps/backend  —  Express + TypeScript                      │
│  17 route modules · 23 services · Zod validation            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Routes    → HTTP, validation, response shaping      │   │
│  │  Services  → business logic + permission enforcement │   │
│  │  Prisma    → data access                             │   │
│  └──────────────────────────────────────────────────────┘   │
│  Cross-cutting: config · secrets · AI capability layer      │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│  PostgreSQL 16  —  Prisma ORM, 12 migrations                │
└─────────────────────────────────────────────────────────────┘

Shared packages:
  @synora/database       Prisma schema, client singleton
  @synora/shared         Types, ApiException hierarchy, helpers
  @synora/design-system  30 React components
```

---

## Layering

**Routes → Services → Prisma.** Strictly one-directional. No inversions, no circular dependencies between packages.

| Layer | Responsibility | Does not do |
|-------|---------------|-------------|
| Route | Parse and validate input (Zod), shape response, forward errors to middleware | Business logic, permission checks, DB access |
| Service | Business logic, **permission enforcement**, transaction boundaries | HTTP concerns, response formatting |
| Prisma | Data access, relations, cascades | Anything else |

### Why permission checks live in services, not middleware

This is the single most consequential architectural decision in the codebase, and it is correct.

Middleware-based authorization fails **open**: a new route that forgets to attach the middleware is unprotected, and nothing catches it. Service-layer authorization fails **closed**: the check lives inside the function that performs the work, so it cannot be bypassed by a routing mistake.

Every Release 3 service method independently resolves the caller's `WorkspaceMember` row and validates role before acting:

```
create(userId, workspaceId, input)
  → resolve WorkspaceMember(userId, workspaceId)
  → reject if absent (ForbiddenException)
  → reject if role === VIEWER (ForbiddenException)
  → perform work
```

Cost: the check is repeated in every method. Benefit: it cannot be forgotten at the routing layer. For a multi-tenant system, that trade is right.

---

## Data Architecture

### Multi-tenancy

Every domain entity is scoped to a `Workspace`. Users hold a `WorkspaceMember` row per workspace, carrying a role:

```
VIEWER  <  MEMBER  <  EDITOR  <  ADMIN  <  OWNER
```

`VIEWER` is read-only and rejected on every mutating path. Foreign keys cascade from `Workspace` downward, so deleting a workspace removes all dependent data with no orphans.

**Isolation is enforced in application code only.** There is no row-level security backstop. Current code is correct, but a single future omission becomes a cross-tenant breach. RLS is recommended as defense in depth.

### Release 3 chat schema — 17 tables

| Group | Tables |
|-------|--------|
| Core | `Conversation`, `Message`, `MessageBranch`, `MessageAttachment` |
| Organization | `ConversationFolder`, `ConversationTag` |
| Templates | `PromptTemplate`, `ConversationTemplate`, `AIMemory` |
| Collaboration | `SharedConversation`, `ConversationCollaborator`, `ConversationActivity` |
| Versioning | `ConversationVersion`, `StreamingJob` |
| Tools | `Tool`, `ToolCall` |
| Analytics | `ConversationUsage` |

**Message tree**: `Message.parentId` self-references, forming a tree. `MessageBranch` marks alternative continuations from a given message, with `isMainBranch` designating the canonical path. This models conversational branching — "regenerate this response" creates a sibling, not an overwrite.

**Folder tree**: `ConversationFolder.parentId` self-references with cascade, giving arbitrary nesting.

**Indexes**: 30+, covering `(workspaceId, createdAt)`, `(conversationId, createdAt)`, `parentId`, `folderId`, `isArchived`, `isPinned`, and every foreign key.

### Migration integrity — a resolved failure

The Prisma schema and the hand-written migration SQL had diverged across **8 tables**, describing structurally different databases. Prisma generated a client for one shape; the migration created another. Every Release 3 query failed at runtime.

This was found and fixed during this audit (see `FINAL_AUDIT.md`, DEFECT-01 through DEFECT-08).

**Architectural lesson**: hand-written migrations have no drift detection. Generate migrations with `prisma migrate dev` and add a CI step running `prisma migrate diff --exit-code` so the build fails the moment schema and migrations disagree.

---

## AI Capability Layer

The most mature subsystem in the codebase. Ten providers sit behind a single capability-oriented interface.

```
Service code
    │
    ▼
CapabilityResolver  ──  selects a provider for a requested Capability,
    │                   honoring config, availability, and preference order
    ▼
ICapabilityProvider  ──  uniform interface across all providers
    │
    ├── Anthropic   ├── OpenAI    ├── Google   ├── Mistral  ├── Cohere
    └── ... (10 total, all swappable via configuration)
```

**Properties verified**:
- No provider-specific types leak into service code
- Providers are selected by configuration, never hardcoded at a call site
- A dev runtime decorator supports deterministic replay (cassettes) and seeded PRNG for reproducible tests
- Adding a provider requires implementing one interface and registering it — no changes to consuming code

This is the abstraction that makes the platform's "provider-agnostic" claim real rather than aspirational.

---

## Configuration and Secrets

**Config**: a Zod schema defines the entire configuration surface and is validated at startup. The process **refuses to boot** on invalid or missing required values rather than failing at first use. Stage-aware (`development` / `staging` / `production`) with `government` and `enterprise` modes that tighten defaults.

**Secrets**: read through an audited `SecretsManager` rather than direct `process.env` access in service code. Every read is logged. Multiple backends (env, file, stubbed HSM) selected by stage.

No hardcoded secrets exist in the codebase; `.env.example` carries placeholders and generation instructions only.

---

## Frontend Architecture

Next.js App Router with Server Components by default and explicit opt-in to Client Components.

| Concern | Choice |
|---------|--------|
| Server state | TanStack Query |
| UI state | Zustand (6 stores) |
| Styling | Tailwind CSS + design tokens |
| Components | 30 in `@synora/design-system` |
| Data access | Typed API clients in `src/lib/api/` (12 modules) |

Bundle: 102 kB shared JS; largest route 175 kB first load. Marketing routes are statically prerendered.

### The Release 3 gap

The frontend has **no chat implementation**. Absent: pages (`/dashboard/chat`, `/dashboard/chat/[id]`), API clients (`conversations.ts`, `messages.ts`, `streaming.ts`), types (`Conversation`, `Message`), hooks (`useConversation`, `useMessages`, `useStreamingMessage`), stores, and every chat component.

The backend is complete and correct. Nothing calls it. This is the launch blocker documented in `FINAL_AUDIT.md`.

---

## Streaming Design (specified, not implemented)

`StreamingJob` models the lifecycle of a server-sent-events response:

```
PENDING ──► RUNNING ──► COMPLETED
                   ├──► FAILED
                   └──► CANCELED
```

`StreamingService` implements the full lifecycle including stale-job cleanup. **No HTTP endpoint serves it.** The model and service exist; the SSE route does not.

`StreamingJob` also lacks an `error` column, so a failed stream is unexplainable after the fact.

---

## Verified Architectural Properties

| Property | Status | Evidence |
|----------|--------|----------|
| Layering is one-directional | Verified | No route imports Prisma; no service imports Express |
| No circular package dependencies | Verified | Turbo build graph resolves cleanly |
| Permission checks cannot be bypassed by routing | Verified | Enforcement is inside service methods |
| Providers are swappable via config | Verified | 10 providers, one interface, zero call-site changes |
| Tenant data cannot leak across workspaces | Verified in code | Every service resolves membership first |
| Config errors fail fast at boot | Verified | Zod validation before server start |
| Errors are centrally handled | Verified | `ApiException` hierarchy + error middleware |

---

## Known Architectural Weaknesses

1. **No database-level tenant isolation.** Application code is correct today; one future omission is a breach. Add PostgreSQL RLS.
2. **Hand-written migrations with no drift detection.** Root cause of the 8 schema defects fixed in this audit. Add `prisma migrate diff --exit-code` to CI.
3. **`StreamingJob` records failures without diagnostics.** Add an `error` column.
4. **MFA is implemented but unwired.** Dead security code. Wire it or remove it.
5. **No default page size on `getConversationHistory`.** Unbounded result sets as conversations grow.
6. **Search uses `contains` without a trigram index.** Acceptable at launch scale; add GIN before 10k conversations per workspace.

---

## Deferred to Release 4

`infrastructure/k8s/` is present but empty — correctly scoped, not claimed as ready. Redis is provisioned in `docker-compose.dev.yml` but not consumed by application code. Both are documented as Release 4 in `RELEASE_4_PLAN.md`.
