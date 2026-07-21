# ARCHITECTURE_REVIEW_v2.md

**Reviewer:** Staff Software Architect (independent review)
**Date:** 2026-07-21
**Scope:** Entire Synora monorepo — merged `SYNORA` branch as ground truth, unmerged feature branches noted where relevant
**Method:** Full source read of `apps/backend`, `apps/web`, `packages/*`, CI, Prisma schema, docs

## Architecture Score: 54 / 100

**One-line verdict:** Strong platform *substrate* (config, secrets, monorepo tooling) wrapped around an application core that skipped its middle layers — no service layer on the request path, no data-access abstraction, no DI, a frontend that is a prototype, and a growing gap between what the docs claim and what the code does.

Score breakdown:

| Area | Weight | Score | Notes |
|---|---|---|---|
| Monorepo / folder structure | 10 | 7/10 | Clean workspace layout; web app hollow |
| Backend layering (service/repo) | 15 | 4/15 | Logic in route handlers; Prisma everywhere |
| Data layer (Prisma/DB) | 10 | 6/10 | Good schema; client lifecycle wrong; migrations just repaired |
| Provider/Capability layers | 10 | 3/10 | Well designed but **unmerged** — exists only on feature branches |
| Frontend (React/state/hooks) | 10 | 3/10 | Raw fetch, localStorage tokens, no state mgmt, no components dir |
| Cross-cutting (DI, caching, logging, monitoring) | 15 | 7/15 | Logging good; DI absent; caching absent; monitoring unwired |
| Ops (CI, deployment, scalability) | 10 | 7/10 | CI now green end-to-end; single-node assumptions remain |
| Enterprise readiness (multi-tenant, self-hosted, versioning, plugins) | 10 | 4/10 | Workspace model is a seed; nothing enforced |
| Documentation/code coherence | 10 | 5/10 | Excellent docs volume; several claims untrue in code |

A note on what this score is *not*: it is not a security score (see `AUTH_SYSTEM_SECURITY_AUDIT_v2.md`, 28/100 — several criticals remain open) and it is not a completeness score. It measures whether the current structure can carry the stated vision (multi-capability AI platform, enterprise, self-hosted, multi-tenant) without a rewrite. Today the honest answer is "partially."

---

## 1. Folder Structure

**Current design.** npm→pnpm workspace monorepo: `apps/backend`, `apps/web`, `packages/{database,shared,design-system}`, `infrastructure/`, `docs/`, Turbo pipeline. Backend organizes by technical kind (`routes/`, `middleware/`, `services/`, `config/`, `secrets/`, `utils/`).

**What's good.** The workspace split is correct and future-proof; `packages/database` as the single schema owner is the right call; `docs/` is unusually rich for a project this age.

**Weaknesses.**
- `apps/web/src` has only `app/` — the documented `components/`, `hooks/`, `lib/`, `types/` directories don't exist. The design system exports exactly one component (`Button`).
- Backend `services/` contains only MFA services, and those are **not referenced by any route** — the service directory is currently dead weight on the request path (see §2).
- Organization by technical kind (`routes/`, `services/`) rather than by domain (`auth/`, `projects/`, `media/`) will smear each future domain across four directories.

**Why problematic.** Structure is aspiration, not enforcement. Nothing stops a new route from importing Prisma directly, because that is the established pattern.

**Future impact.** Each new feature deepens the "fat route" pattern; extraction cost grows linearly with endpoint count.

**Recommended architecture.** Domain-first modules inside the backend: `src/modules/<domain>/{routes,service,repository,schemas}.ts`, with `src/platform/` for config/secrets/logging. Keep `packages/*` as-is.

**Migration strategy.** Introduce the module layout for the *next* domain built; back-fill auth and users when touching them (they need security work anyway). No big-bang move.

**Complexity:** Low. **Risk:** Low.

---

## 2. Service Layer

**Current design.** Route handlers in `apps/backend/src/routes/*.ts` contain the entire business logic: validation (zod inline), data access (Prisma inline), token minting (jwt inline), response shaping. E.g. `routes/auth.ts` does schema parse → user lookup → bcrypt → `jwt.sign` → response in one closure. The only real services (MFA audit/monitoring/rate-limiter/alerting) are orphans — well-tested, never called.

**Why problematic.**
- Untestable without HTTP: there is no unit under the route to test, which is why backend tests cluster around config/secrets/MFA (the only extracted logic) and the API surface has effectively zero test coverage.
- No transaction boundaries: multi-step operations (create user + profile + preferences) have nowhere to be atomic.
- The MFA subsystem — the most heavily engineered code in the repo, 134 tests — provides zero product value until something calls it.

**Future impact.** Every cross-cutting requirement (audit logging on mutations, per-tenant checks, rate limiting by user, caching) must be re-implemented per route or bolted on via middleware guesswork. This is the single largest structural debt in the repo.

**Recommended architecture.** Thin routes → typed service functions: routes do parse/authn/serialize only; services own business rules and transactions (`prisma.$transaction`), take a `PrismaClient` (or repository, §5) as a constructor argument like `MFAAuditService` already correctly does. Wire the MFA services into the auth flow — they are the template the rest of the backend should follow, not an appendix.

**Migration strategy.** (1) Extract `authService` first — it's small, high-risk, and the security-audit fixes land there anyway. (2) Mandate the pattern for new endpoints. (3) Extract remaining CRUD routes opportunistically. Roughly 1–2 days per domain.

**Complexity:** Medium. **Risk:** Low (behavior-preserving extraction with tests added as you go).

---

## 3. Provider Layer & 4. Capability Layer

**Current design.** A provider abstraction (mock providers, integrations directory, service facades) and a 20-capability layer (`Capability` enum, `ICapabilityProvider`, registry, resolver, config/secrets-aware factory, local dev runtime with cassette record/replay) were designed, built, and tested — **on `feature/capability-layer`, `feature/local-dev-runtime`, and `feature/synora-infra-interfaces`, none of which are merged.** The merged tree contains no provider or capability code at all; the dashboard advertises image/video/document/code generation with no backing endpoints.

**Why problematic.** This is the heart of the product ("unified AI platform") and it lives only on branches that drift further from `SYNORA` with every merge to main (the recent CI overhaul touched `turbo.json`, backend scripts, and vitest config — all likely conflict points). Stranded work is depreciating work.

**Future impact.** Two bad outcomes compound: (a) merge conflicts grow until the branches are effectively rewrites; (b) new backend code (routes, config keys) is written without the capability layer's contracts, so the eventual merge forces retrofits on both sides.

**Recommended architecture.** The design itself is sound and matches what I'd recommend (capability enum → provider interface → resolver → config-driven selection; mocks/cassettes for dev). The architectural problem is *integration debt*, not design.

**Migration strategy.** Freeze new backend surface area until `feature/capability-layer` and `feature/local-dev-runtime` are rebased onto current `SYNORA`, re-verified, and merged (tasks already exist for this: #65–67). Budget 1–2 days for rebase pain now versus weeks later. Then expose the first real endpoint (`POST /api/generate/text`) through the resolver so the pattern is load-bearing.

**Complexity:** Medium (rebase + wiring). **Risk:** Medium — the risk of *not* doing it is higher.

---

## 5. Repository Pattern & 6. Database & 7. Prisma

**Current design.** Five route files and every test file call `new PrismaClient()` independently — six client instances in the production process, each with its own connection pool. No repository layer; Prisma types leak into every layer. Schema itself is good: proper enums, FKs, composite indexes on `MFAAuditLog`, `@updatedAt` audit columns. Migrations were just repaired (single generated `20260721000000_init` + `migration_lock.toml`) after shipping in a state that could never deploy to a fresh database. `Session`/`VerificationToken` models exist for a NextAuth integration that isn't present; JWT auth ignores them.

**Why problematic.**
- Multiple `PrismaClient`s exhaust Postgres connections under load and defeat Prisma's own pooling; this is the canonical Prisma anti-pattern.
- No repository seam means no place to add tenant scoping (§19), soft-delete filtering (the `status` enums imply soft delete but nothing enforces reading only `ACTIVE` rows), or caching.
- Dead models document intent that code contradicts — a trap for the next engineer.

**Future impact.** Connection exhaustion is a production incident waiting for the first traffic spike. Tenant scoping added later without a repository seam means auditing every query by hand.

**Recommended architecture.** One `PrismaClient` singleton exported from `packages/database` (with dev hot-reload guard); repositories only where behavior is needed (tenant scoping, soft deletes) — a full generic-repository layer over Prisma is ceremony, don't build it. Delete or implement `Session`/`VerificationToken`.

**Migration strategy.** The singleton is a one-hour, low-risk change (export `db` from `@synora/database`, replace six constructor calls). Do it immediately. Introduce the first repository when multi-tenancy work starts.

**Complexity:** Low. **Risk:** Low.

---

## 8. API

**Current design.** REST under `/api/*`, consistent envelope via `createApiResponse` and a typed `ApiException` hierarchy with centralized `errorHandler` (dev/prod stack-trace gating — good). Global IP rate limit. No API versioning, no OpenAPI spec, no pagination on list endpoints, zod validation inline and inconsistent (auth has schemas; users `GET /:id` validates nothing), and `GET /users/:id` is unauthenticated by design without any privacy consideration.

**Why problematic.** The envelope discipline is genuinely good, but contract-less REST means the frontend hand-rolls types (`interface User` re-declared in `dashboard/page.tsx` — already drifting from `packages/shared`). Unpaginated lists become slow queries then outages.

**Future impact.** Without `/api/v1` from day one, the first breaking change forces either silent breakage or an awkward retrofit; enterprise/self-hosted customers (§18) pin versions.

**Recommended architecture.** Prefix `/api/v1` now (one line per router mount). Generate the contract from zod: shared request/response schemas in `packages/shared`, inferred types on both sides, OpenAPI emitted from the same schemas (`zod-openapi`). Cursor pagination as the default list contract.

**Migration strategy.** Version prefix + keep `/api/*` as alias for one release. Move auth schemas to `packages/shared` as the pilot.

**Complexity:** Low–Medium. **Risk:** Low.

---

## 9. Frontend / 10. React / 11. State Management / 12. Hooks

**Current design.** Next.js App Router with six files. Every page is `'use client'`. Auth: token in `localStorage`, checked in `useEffect`, redirect via `window.location.href`. Data: raw `fetch` with `process.env.NEXT_PUBLIC_API_URL` inline. State: `useState` only. No custom hooks, no TanStack Query, no Zustand (both promised in CLAUDE.md), no error boundaries, no loading skeletons beyond a text node, no auth middleware — `/dashboard` is client-guarded only.

**Why problematic.**
- `localStorage` tokens are readable by any XSS payload; combined with the backend's 7-day-signed JWTs and no logout invalidation (security audit CRITICAL-005), one XSS = full account takeover with no revocation path.
- Client-only auth guard flashes protected content and does nothing for SEO/SSR correctness.
- Every future page will copy the `fetch`+`useState`+redirect boilerplate; there is no `lib/api.ts` to fix behavior in one place (no 401 handling, no retry, no base-URL handling).

**Future impact.** This is the layer where the prototype pattern metastasizes fastest, because pages are added most often. Retrofitting a query cache and HTTP-only cookie auth across 30 pages is a multi-week slog; across 6 pages it's two days.

**Recommended architecture.** (1) HTTP-only secure cookie session (pairs with the backend CSRF work already merged), Next.js `middleware.ts` for route guarding, server components for initial data. (2) A single typed API client in `src/lib/api.ts` consuming the shared zod schemas. (3) TanStack Query for server state; Zustand only if genuine client-global state appears (it hasn't yet). (4) Actual `components/` extraction — the dashboard's four copy-pasted cards are the first candidate.

**Migration strategy.** Do it *now*, while the surface is six files. Cookie auth first (backend sets cookie at login), then the API client, then Query. ~3–4 days total.

**Complexity:** Medium. **Risk:** Low–Medium (auth flow change needs an E2E test — conveniently, A4 is next on the roadmap).

---

## 13. Dependency Injection

**Current design.** Module-scope singletons everywhere: `export const secretsManager = ...`, `const prisma = new PrismaClient()` per file, `logger` imported directly. The MFA services are the exception — constructor injection with factory functions, which is why they're the only well-tested code.

**Why problematic.** Import-time side effects (secrets validation, client construction) make units untestable without env scaffolding, and make boot order implicit. The repo has already hit this: config tests must dance around `secretsManager`'s module init.

**Future impact.** Multi-tenant and self-hosted variants (§18–19) need different wiring of the same components; singletons force `if (mode)` branches inside modules instead of composition at the edge.

**Recommended architecture.** Not a DI container — plain constructor injection with a single composition root in `index.ts` `bootstrap()`: build `db`, `secrets`, `config`, services, then pass them to route factories (`createAuthRouter(deps)`). The codebase is small enough that a container (tsyringe/inversify) would be pure overhead.

**Migration strategy.** Piggyback on the service-layer extraction (§2); each extracted service is born injected. Convert route files to router factories as they're touched.

**Complexity:** Low–Medium. **Risk:** Low.

---

## 14. Caching

**Current design.** None. No Redis, no in-process cache, no HTTP cache headers, and — more urgently — the things that *need* shared state (express-rate-limit counters, future session revocation, MFA lockout state) are in-process or in Postgres-on-the-hot-path.

**Why problematic.** Rate limiting in process memory resets on deploy and is per-instance — two replicas double every attacker's budget (this converts a security control into a suggestion). The A3 rate limiter queries `MFAAuditLog` per attempt: correct for audit, expensive as the primary counter under attack traffic.

**Future impact.** First horizontal scale-out silently breaks rate limiting and any future in-memory state (the A3 `AlertingService` stores alerts in a process-local `Map` — gone on restart, invisible to other replicas).

**Recommended architecture.** Redis as the first piece of shared infrastructure: rate-limit store (`rate-limit-redis`), token-revocation list, MFA attempt counters (audit log remains the immutable record; Redis is the counter), then read-through caching only where measured. Keep it optional for self-hosted small installs via an interface (in-memory impl for single node).

**Migration strategy.** Add Redis to docker-compose + config/secrets catalog (the catalog pattern makes this clean); swap the rate-limit store; move `AlertingService` storage behind its existing interface.

**Complexity:** Medium. **Risk:** Low.

---

## 15. Logging & 16. Monitoring

**Current design.** Winston with structured JSON-ish output, request logger middleware, secrets subsystem has a real audit log with actor attribution (genuinely good). But: `console.log/error` still used inside MFA services (bypassing winston), no request/correlation IDs, no OpenTelemetry, `/health` returns static ok (no DB probe), and the entire A3 monitoring/alerting subsystem is — again — unwired: nothing calls `detectUserAnomalies`, alert channels are stubs, there is no `/metrics`.

**Why problematic.** Without correlation IDs, the first production incident across web→backend→DB is archaeology. A health check that doesn't check the database will happily report `ok` while every request 500s — worse than no health check for orchestrators doing rollout gating.

**Future impact.** Enterprise/self-hosted buyers ask for Prometheus metrics and SIEM export on day one; the A3 interfaces anticipate this but stubs don't demo.

**Recommended architecture.** (1) Correlation ID middleware (`AsyncLocalStorage`) with the ID in every log line and response header. (2) `/health` = liveness, `/ready` = DB ping + migrations applied. (3) Replace MFA `console.*` with the injected logger. (4) `prom-client` `/metrics` endpoint fed by the A3 `MonitoringService` — it already computes the right numbers; give it a scrape surface instead of ad-hoc queries. (5) OTel tracing when there are ≥2 services to trace.

**Migration strategy.** Items 1–3 are a day. Metrics endpoint ~1 day. Fold into A3's "production verification" which is currently marked pending.

**Complexity:** Low–Medium. **Risk:** Low.

---

## 17. Scalability

**Current design.** Single stateless-ish Express node (stateless except in-memory rate limits and alerts), single Postgres, no queue, synchronous request path for what will become long-running AI generation jobs (`GeneratedVideo.status = PROCESSING` implies async, but no worker/queue exists).

**Why problematic.** AI generation is seconds-to-minutes work; doing it on the request path ties worst-case latency to provider latency and pins concurrency to node count. The schema already anticipates async (status enums, `completedAt`) — the compute model doesn't.

**Future impact.** The first real video-generation feature either blocks HTTP workers or forces an emergency queue retrofit.

**Recommended architecture.** Job queue (BullMQ on the Redis from §14) with a worker entrypoint in the same backend image (`node dist/worker.js`) — separate deployable, shared code. API enqueues, returns `202` + job id; client polls or subscribes. This also becomes the natural seam for microservice extraction (§20).

**Migration strategy.** Build the queue alongside the first capability endpoint, not before.

**Complexity:** Medium. **Risk:** Low if done with the first feature; High if retrofitted after.

---

## 18. Plugin Architecture, Enterprise, Self-Hosted

**Current design.** No plugin system. Enterprise/government *modes* exist in config (`modes`, `governmentCompliance.ts`) with real hooks — a strong foundation. Self-hosted story: docker-compose example for secrets, Docker/K8s secret sources implemented; no published image, no single-node compose for the full stack, no license/entitlement mechanism.

**Assessment.** The capability layer (once merged) *is* the plugin architecture — a new provider is a plugin. Don't build a second, generic plugin system; formalize provider packages (`@synora/provider-*` with a manifest: capabilities, config keys, secret requirements) loaded through the existing registry. For self-hosted: one `docker-compose.yml` running web+backend+postgres(+redis) with the placeholder secret source is achievable in days and is the best sales demo an enterprise pipeline can have.

**Complexity:** Medium. **Risk:** Low.

---

## 19. Multi-Tenant Support

**Current design.** `Workspace`/`WorkspaceMember`/`WorkspaceInvitation`/`ApiKey` models exist with roles — but `workspaceId` is *optional* on `Project` and absent from `Document`/`Generated*` (they hang off `Project?`), no query in the codebase filters by workspace, JWT carries no tenant claim, and nothing prevents user A reading workspace B's data if endpoints existed.

**Why problematic.** Tenancy is the classic "cannot retrofit safely by hand" property. Every un-scoped query written today is a future cross-tenant data-leak candidate — the most expensive class of enterprise bug.

**Future impact.** SOC 2 / enterprise deals will require demonstrable tenant isolation; auditing hundreds of hand-written Prisma calls is how that estimate becomes a quarter.

**Recommended architecture.** Decide the tenancy model **now** (recommended: workspace = tenant, personal workspace auto-created per user, `workspaceId` **required** on all content tables). Enforce in one place: a tenant-scoped Prisma client (Prisma client extensions can inject `where: { workspaceId }` per request context) — this is the repository seam from §5 earning its keep. Add `workspaceId` + role to the JWT/session claims. Postgres RLS as defense-in-depth later.

**Migration strategy.** Schema migration (backfill personal workspaces, make FK required) while data is near-zero — this is *the* thing that is cheap today and brutal later. 2–3 days now.

**Complexity:** Medium now / Very High later. **Risk:** Low now / Critical later. **This is the highest-leverage item in the review.**

---

## 20. Microservice Migration

**Current design.** Modular monolith (correct for team size). No service boundaries drawn beyond the frontend/backend split.

**Recommendation.** Stay a monolith deliberately. The future seams are already visible and should be kept clean rather than pre-split: (1) worker/queue (§17) — first real second deployable; (2) capability providers behind the resolver — extractable to sidecar services per provider if isolation/scaling demands; (3) secrets/config already interface-driven. Write this down as an ADR ("monolith until: >8 engineers, or a capability needs independent scaling/hardware") so the decision is principled, not inertial.

**Complexity:** N/A. **Risk:** The risk here is premature extraction, not delay.

---

## 21. Offline Support

**Current design.** None; also not plausibly required for a server-side AI generation product beyond (a) graceful degradation when providers are down and (b) resumable/queued jobs — both of which fall out of the queue architecture (§17) and capability fallback logic in the resolver. Recommend explicitly de-scoping true offline (local-first editing) until a document-editor roadmap exists; if it comes, it arrives as CRDTs in the document domain only.

**Complexity:** N/A now. **Risk:** Low.

---

## 22. Versioning

**Current design.** No API versioning (§8), no schema-migration versioning discipline beyond Prisma defaults, packages all pinned `0.1.0` with no changesets, docs carry version claims that drift.

**Recommended.** `/api/v1` now; Changesets for `packages/*` when anything external consumes them; a `CHANGELOG.md` fed by conventional commits (already in use — the commit discipline in history is good and free to harvest).

**Complexity:** Low. **Risk:** Low.

---

## 23. Technical Debt Register (ranked)

| # | Debt | Cost to fix now | Cost in 6 months | Verdict |
|---|---|---|---|---|
| 1 | Tenancy not enforced, `workspaceId` optional | 2–3 days | Weeks + breach risk | **Fix now** |
| 2 | Capability/provider/dev-runtime work stranded on unmerged branches | 1–2 days rebase | Rewrite-grade conflicts | **Fix now** |
| 3 | Six `PrismaClient` instances | 1 hour | Prod incident | **Fix now** |
| 4 | Frontend auth via localStorage + no API client | 3–4 days | Multi-week retrofit + security exposure | **Fix now** (overlaps security audit criticals) |
| 5 | No service layer; MFA subsystem unwired | 1–2 days/domain | Grows per endpoint | Fix with next domain touched |
| 6 | In-memory rate limits & alerts (scale-out breaks security) | 1–2 days w/ Redis | Silent control failure | Fix before 2nd replica |
| 7 | No correlation IDs / real health checks | 1 day | Incident MTTR | Quick win |
| 8 | No `/api/v1`, contracts not shared | 1 day | Breaking-change trap | Quick win |
| 9 | Docs claim NextAuth/TanStack/Zustand/atomic design that don't exist | Half day | Onboarding mistrust | Correct CLAUDE.md |
| 10 | Dead models (`Session`, `VerificationToken`), placeholder dashboards linking to nonexistent routes | Half day | Confusion | Sweep |

Security debt (JWT refresh, lockout, logout invalidation, email enumeration, etc.) is tracked separately in the security audit and remains **production-blocking** independent of this review.

---

## Recommended Sequence (next ~3 weeks)

1. **Week 1 — Foundations that get expensive later:** Prisma singleton → tenancy schema decision + migration → merge stranded capability branches → `/api/v1` prefix.
2. **Week 2 — The two rewrites while they're cheap:** frontend auth to HTTP-only cookies + typed API client + TanStack Query; extract `authService` and wire MFA audit/rate-limiter into it (kills two security criticals and makes the orphaned code load-bearing).
3. **Week 3 — Production surface:** Redis (rate limits, revocation), correlation IDs + `/ready`, `/metrics` from A3 MonitoringService, single-command self-hosted compose file.

Done in this order, the score re-baselines in the mid-70s, and every subsequent feature lands on rails instead of adding to the debt register.

---

*This review supersedes the 2026-07-20 architecture audit for structural findings; security findings remain owned by AUTH_SYSTEM_SECURITY_AUDIT_v2.md.*
