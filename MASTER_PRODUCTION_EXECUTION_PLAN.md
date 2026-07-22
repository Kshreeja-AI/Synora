# MASTER PRODUCTION EXECUTION PLAN

**Owner roles for this document:** Principal Architect · CTO · Principal Security Engineer · Principal DevOps · Principal Reviewer
**Date:** 2026-07-21
**Author's mandate:** Verified from Git history and live source code only. Every markdown claim in the repo — including my own prior reports — was treated as unverified until re-confirmed against actual files. Nothing here is planned to be a placeholder, mock, TODO, or temporary shim, because the founder's launch condition forbids it.

---

## 0. The One Sentence This Plan Serves

> "When development is complete, the ONLY thing I should ever need to do before launching is add environment variables / API keys and deploy."

That sentence is the acceptance test for **every** item below. An item is "done" only when it needs no code change to go live — only a secret value and a deploy. This document is the complete, ranked list of what stands between today and that sentence being true. **No code is being changed in this step. This is the roadmap only, as requested.**

---

## 1. Verified Current Reality (from source, not docs)

I re-derived this from `git`, `package.json` files, the Prisma schema, the route files, and the CI config — not from any report.

| Question | Verified answer | Evidence |
|---|---|---|
| What API endpoints actually exist? | 13 handlers across 5 route files: auth (register/login/logout), users (me, :id), projects (list/create/get), documents (list/create/get), images (list/generate/get) | `grep router.(get\|post) apps/backend/src/routes` |
| Is MFA wired into the running app? | **No.** Zero MFA/CSRF references in `index.ts`, routes, or middleware | `grep -rin mfa\|csrf\|totp` returns nothing in app wiring |
| Do the 4 MFA-adjacent services (audit/rate-limiter/monitoring/alerting) get called? | **No.** Not imported anywhere outside their own tests | `grep -rn services/mfa` outside that dir → empty |
| Does real MFA code exist anywhere? | **Yes — on lost branch `recover/mfa`:** `totp.service.ts`, `challenge-token.service.ts`, `setup-token.service.ts`, `recovery-code.service.ts`, `mfa.service.ts`, `routes/mfa.ts`, 4 frontend components, `useMFASetup` hook, RFC 4226/6238 test vectors, DB migration | `git ls-tree recover/mfa` |
| Does real CSRF code exist anywhere? | **Yes — on lost branch `recover/csrf`:** `csrfProtection.ts`, `utils/csrf.ts`, `useCsrfToken.ts`, DB migration, integration tests, docs | `git ls-tree recover/csrf` |
| Is a Dockerfile in the tree? | **No.** One existed in reverted "Milestone 2" (`8b5c2d7`) and original build (`cfbd8ad`); both reverted out | `git log --diff-filter=A -- Dockerfile` |
| Does a real AI provider integration exist? | **No in tree.** A multi-provider `aiService.ts` (OpenAI/Anthropic/Replicate) existed in reverted Milestone 2. Current `images.ts` returns a hardcoded `placeholder.com` URL | `git show 8b5c2d7 --stat`; `apps/backend/src/routes/images.ts:31` |
| Frontend state management? | **None in code.** `apps/web/package.json` *declares* `next-auth`, `@tanstack/react-query`, `zustand`, `axios`, but code uses raw `fetch` + `useState` + `localStorage` only | `package.json` vs `grep useState/fetch/localStorage` |
| Backend infra deps? | `express, @prisma/client, bcryptjs, jsonwebtoken, zod, winston, cors, helmet, express-rate-limit, dotenv` only. **No redis, no queue, no otel, no metrics lib** | `apps/backend/package.json` |
| Secrets/config wired? | **Yes, genuinely.** Used by auth route + auth/error middleware; boot fails-closed via `validateRequired()` | `apps/backend/src/index.ts:20-21` |
| CI state? | Single job: install → db:generate → migrate → lint → type-check → test:coverage → build; plus a **non-blocking** Snyk job (`continue-on-error: true`) | `.github/workflows/ci.yml` |

**Plain-language summary for the founder:** Synora today is a thin, working login + basic CRUD API with an excellent secrets/config foundation, an unfinished prototype frontend, and **no real AI features** (the "generate image" button returns a fake picture URL). The two hardest security features you were told were "complete" — MFA and CSRF — were actually built well, then accidentally lost from the main line during branch resets. They are recoverable. Almost everything needed to *deploy* (container, pipeline, monitoring, backups) does not exist yet.

---

## 2. The Central Risk: Two "Complete" Features Are Off the Main Line

This is the single most important finding and it reframes the whole plan.

- **MFA and CSRF are not missing — they are stranded.** Full, tested implementations sit on local-only branches `recover/mfa` and `recover/csrf`. They are **not** on `SYNORA` (what would deploy) and **not** pushed to any remote. If this container is reclaimed, they are permanently lost and would have to be rebuilt from scratch.
- **Immediate, zero-feature-work action (P0, do before anything else):** push `recover/mfa` and `recover/csrf` to the remote so the work is durable. This is not "development" — it is preventing the loss of completed work. Everything else in this plan assumes these branches survive.
- Until they are reintegrated and wired, the running app has **no MFA and no CSRF protection**, regardless of what any report or task list claims.

---

## 3. Master Issue Register — Ranked by Production Risk

Risk tiers: **P0 = blocks launch / data-loss / security breach** · **P1 = required for a safe public launch** · **P2 = required to scale or operate maturely** · **P3 = polish / long-term.**

Every item states what it is, why it matters to a *non-technical founder*, and the definition of done. None are placeholders — each is a finished, production-grade requirement.

### P0 — Launch Blockers (nothing ships until every one is green)

| # | Item | Why it blocks launch | Done when |
|---|---|---|---|
| P0-1 | **Preserve stranded work**: push `recover/mfa` + `recover/csrf` to remote | Completed MFA/CSRF is one container-recycle from permanent loss | Both branches exist on origin |
| P0-2 | **Reintegrate + wire CSRF** into the live app | Without it, any logged-in user can be tricked into destructive actions by a malicious website (classic account-takeover vector) | CSRF middleware active on all state-changing routes; tests green on `SYNORA` |
| P0-3 | **Reintegrate + wire MFA** end to end (setup/verify/recovery, routes, frontend) | It's the *named deliverable* of Module 1 and a table-stakes security feature for "enterprise-ready" | User can enroll TOTP, log in with a code, use a recovery code; all via real endpoints |
| P0-4 | **Refresh-token + logout invalidation** (security audit CRITICAL-002/005) | Today tokens can't be revoked; a stolen 7-day token = 7 days of access even after "logout" | Server-side session/refresh store; logout truly invalidates; verified by test |
| P0-5 | **Account lockout wired to auth** (CRITICAL-003) | The rate-limiter service exists but nothing calls it; brute-force login is currently unthrottled per-account | Failed logins increment a shared counter and lock the account; test proves it |
| P0-6 | **Email-enumeration fix** (CRITICAL-004) | Attackers can currently discover which emails have accounts (privacy + phishing target list) | Login/register return identical shape+timing for known vs unknown emails |
| P0-7 | **Real AI provider integration** (replace placeholder image/doc/code generation) | The product's entire value prop — "generate content" — currently returns fake data. A non-technical founder cannot "just add an API key" to a placeholder; the integration code must exist first | Image/text/etc. calls hit a real provider selected by config; adding the API key is the *only* thing needed to activate it |
| P0-8 | **Dockerfile + reproducible build artifact** | There is no way to deploy this app at all today; docs describe a Dockerfile that doesn't exist | `docker build` produces a running image; non-root; healthcheck baked in |
| P0-9 | **`/ready` health check with real DB probe** | Orchestrators need to know if the app can actually serve traffic; current `/health` says "ok" even if the DB is down | `/ready` returns 503 when DB unreachable; `/health` = liveness |
| P0-10 | **Single Prisma client (connection pooling)** | 6 separate `PrismaClient` instances will exhaust Postgres connections under real traffic → site down | One shared client exported from `@synora/database`; all routes use it |
| P0-11 | **Native password hashing (argon2id or native bcrypt)** | `bcryptjs` (pure JS) blocks the server ~300ms per login, freezing all other users during login spikes → DoS-by-popularity | Hashing runs off the event loop; measured non-blocking |
| P0-12 | **Secrets committed durably + no secrets in tree** | `.env.staging` with real-looking secret values sits untracked in the working dir; the security audit itself lived only in scratchpad | Secret-scan gate in CI; no secret material in any tracked file |

### P1 — Required for a Safe Public Launch

| # | Item | Why it matters | Done when |
|---|---|---|---|
| P1-1 | **All remaining security-audit Highs (8) fixed** + regression test each | Each is exploitable; without a test, a future edit silently reopens it | Every High has a fix + a test that fails if the fix is removed |
| P1-2 | **Redis-backed rate-limiting, lockout, token-revocation** | In-memory counters reset on deploy and don't work across ≥2 servers — your security controls silently break the moment you scale | Shared Redis store; verified correct across 2 instances |
| P1-3 | **Multi-tenant isolation enforced** (`workspaceId` required + scoped queries) | Cheap to enforce now (near-zero data), catastrophic later. One un-scoped query = one customer seeing another's data | Every content query is workspace-scoped; cross-tenant access test fails to leak |
| P1-4 | **Frontend auth rewrite**: HTTP-only cookies, typed API client, real session guard (use the already-declared next-auth/react-query/zustand) | `localStorage` tokens = any injected script steals the account; the deps are already paid for but unused | No token in `localStorage`; route guard in middleware; one API client |
| P1-5 | **CD pipeline** (build+push image on tag → deploy staging → prod on approval) with **tested rollback** | Without this, every deploy is manual and every bad deploy is an outage with no fast undo | Tagging a release deploys it; a documented, rehearsed rollback exists |
| P1-6 | **Metrics endpoint + real alerting** (feed the existing monitoring service to `/metrics`; one real alert channel) | When something breaks at 2am, you need to be paged, not find out from users | Prometheus-scrapeable `/metrics`; a real alert fires to Slack/email |
| P1-7 | **Correlation IDs + structured request tracing** | Without a request ID threading web→API→DB, diagnosing a production incident is guesswork | Every log line carries a request ID; returned in a response header |
| P1-8 | **Automated DB backups + one rehearsed restore** | "Daily backups (depends on provider)" in docs is not a backup. Data loss with no tested restore is company-ending | Scheduled backup job + a documented restore drill that was actually run |
| P1-9 | **API input validation everywhere (zod on every mutating route)** | `POST /images/generate` currently trusts arbitrary request bodies (mass-assignment risk) | Every route parses/validates input; invalid input → 400, never a 500 |
| P1-10 | **Blocking dependency/security scan in CI** | Snyk is `continue-on-error: true` — a critical CVE currently produces a green check | A high-severity vuln fails the build |
| P1-11 | **E2E + security-regression test suites in CI** | The whole auth flow and every fixed vuln need automated proof they still work | Playwright covers login/MFA/logout; each P0/P1 security fix has a CI test |
| P1-12 | **Async job queue for AI generation** | AI calls take seconds-to-minutes; doing them on the request thread freezes the API. The schema already implies async (`PROCESSING` status) with no worker behind it | Generation enqueues a job, returns 202; a worker processes it |

### P2 — Required to Scale and Operate Maturely

| # | Item | Why it matters | Done when |
|---|---|---|---|
| P2-1 | **Service layer + repository seam** (thin routes → services → data) | Business logic lives in route handlers today; can't be unit-tested or reused, and every cross-cutting rule gets copy-pasted | Routes only parse/serialize; services own logic + transactions |
| P2-2 | **Dependency injection via a composition root** | Module-level singletons make testing and multi-mode (enterprise/self-host) wiring hard | Services constructed once in `bootstrap()` and passed down |
| P2-3 | **API versioning (`/api/v1`) + OpenAPI spec generated from zod** | First breaking change with no version = broken clients; hand-written API docs drift | `/api/v1` prefix live; OpenAPI emitted from the same schemas the code validates |
| P2-4 | **Object storage abstraction (S3-compatible) for generated media** | Generated images/video/audio need durable storage; none exists | Media persisted to configured bucket; provider swappable by config |
| P2-5 | **Autoscaling config** — only *after* P1-2 (shared state) lands | Scaling before shared state = broken rate limits/locks | HPA/scaling policy exists and is safe under multi-instance |
| P2-6 | **Caching layer (read-through where measured)** | Reduce DB load at scale; only where profiling justifies it | Cache with invalidation on the hottest reads |
| P2-7 | **OpenTelemetry tracing** (once ≥2 services exist: API + worker) | Distributed traces to find latency across services | Traces span web→API→worker→DB |
| P2-8 | **Self-hosting one-command bundle** (`docker-compose.yml`: web+api+postgres+redis+worker) | Enterprise/self-host buyers need a turnkey stack; today only a dev DB compose exists | `docker compose up` runs the whole product with placeholder secrets |
| P2-9 | **Enterprise capabilities**: SSO/SAML/OIDC, audit-log export, RBAC beyond basic roles, data-residency honoring the existing gov/enterprise config modes | These are gated deals; the config hooks exist but nothing behind them | Each enterprise mode toggles real, tested behavior |
| P2-10 | **Blue-green / canary deploy mechanism** | Zero-downtime deploys and safe gradual rollout | Traffic can shift gradually; auto-rollback on health failure |

### P3 — Polish, Developer Experience, Long-Term

| # | Item | Why it matters | Done when |
|---|---|---|---|
| P3-1 | **Domain-first folder structure** (`modules/<domain>/…`) | Scales cleaner than organizing by technical kind | New features land as self-contained modules |
| P3-2 | **ADRs for key decisions** (JWT vs NextAuth, hashing choice, monolith boundary, soft-FK on audit log) | Records *why*, so future engineers don't relitigate or undo | An `adr/` dir with numbered decisions |
| P3-3 | **Architecture / sequence / deployment diagrams (as code, Mermaid)** | The one existing diagram is stale/aspirational; zero sequence/deploy diagrams | Diagrams checked in, render in GitHub, match reality |
| P3-4 | **Accessibility: axe in CI + keyboard/screen-reader pass** | Legal + UX requirement for a public product; zero a11y tooling today | Automated axe gate; manual pass on auth+dashboard |
| P3-5 | **Cross-browser matrix (Chromium+WebKit) incl. private-mode storage** | `localStorage` auth breaks in Safari private mode with no fallback today | E2E runs on both engines; storage-blocked path handled |
| P3-6 | **CDN + edge strategy** | Global latency + static asset offload | CDN in front; cache-control strategy defined |
| P3-7 | **Cost model tied to chosen providers** | Founder needs to know run-rate; none exists | A living cost sheet per environment |
| P3-8 | **CONTRIBUTING.md, CHANGELOG.md, doc reconciliation** | Referenced-but-missing files; 5 of 6 core docs are 6 months stale and describe tech not in the code | Docs match code; missing files created |

---

## 4. Coverage of the 20 Requested Dimensions (nothing omitted)

Every requested category, mapped to the register above so none is dropped:

1. **Every remaining issue** — §3 in full (P0–P3).
2. **Hidden technical debt** — Phantom deps (next-auth/react-query/zustand/axios declared, unused: P1-4); dead Prisma models `Session`/`VerificationToken` (unused: fold into P0-4); soft-FK on `MFAAuditLog` (document via ADR P3-2); the 4 orphan MFA-adjacent services (wire via P0-3/P0-5 or delete).
3. **Missing production features** — Real AI providers (P0-7), object storage (P2-4), async jobs (P1-12), refresh tokens (P0-4).
4. **Architectural weaknesses** — No service layer (P2-1), no DI (P2-2), 6 Prisma clients (P0-10), logic in routes (P2-1).
5. **Scalability issues** — In-memory rate-limit/lockout break at ≥2 instances (P1-2); sync AI on request thread (P1-12); no autoscaling (P2-5); no caching (P2-6). Verdict by scale in §6.
6. **Security issues** — CSRF unwired (P0-2), MFA unwired (P0-3), no token revocation (P0-4), no lockout (P0-5), email enumeration (P0-6), 8 audit Highs (P1-1), localStorage tokens (P1-4), non-blocking vuln scan (P1-10), unvalidated bodies (P1-9).
7. **Deployment blockers** — No Dockerfile (P0-8), no CD (P1-5), no rollback (P1-5), no `/ready` (P0-9).
8. **Documentation blockers** — Stale/contradictory core docs, missing CONTRIBUTING/CHANGELOG, no ADRs, no diagrams, no OpenAPI (P2-3, P3-2, P3-3, P3-8).
9. **Testing blockers** — Zero route/API tests, zero integration/E2E/security-regression/concurrency/a11y/perf tests (P1-11, P3-4, P3-5); test-vs-reality drift (the 134 existing tests cover unwired code).
10. **DevOps blockers** — No CD, no backups, no rollback, non-blocking scan (P1-5, P1-8, P1-10).
11. **Monitoring blockers** — No metrics endpoint, no alerting (P1-6).
12. **Observability blockers** — No correlation IDs, no tracing (P1-7, P2-7).
13. **API blockers** — No versioning, no OpenAPI, inconsistent validation, unauthenticated `GET /users/:id`, placeholder generation endpoints (P0-7, P1-9, P2-3).
14. **Infrastructure blockers** — No Redis in app, no queue, no object storage, no self-host bundle (P1-2, P1-12, P2-4, P2-8).
15. **Missing CI/CD capability** — No deploy stage, no image publish, non-blocking security job, no E2E stage (P1-5, P1-10, P1-11).
16. **Missing enterprise capability** — SSO/SAML/OIDC, RBAC depth, audit export, data residency (P2-9).
17. **Missing self-hosting capability** — One-command full-stack compose + turnkey secret placeholders (P2-8).
18. **Missing developer experience** — Domain structure, DI, ADRs, diagrams, contributor docs (P2-1, P2-2, P3-1, P3-2, P3-3, P3-8).
19. **Dependency problems** — Phantom unused deps (P1-4 resolves by *using* them); `bcryptjs` perf (P0-11); missing prod deps not yet added (redis, queue lib, otel, metrics, storage SDK, argon2 — added as their features land); `next-auth` on a beta version (pin/validate under P1-4).
20. **Duplicated implementations** — Env-var docs duplicated across 4 places; two parallel "MFA" concepts (the wired-nowhere audit/monitoring services vs the real `recover/mfa` implementation) must be reconciled into one under P0-3; stale vs current security docs (P3-8).

---

## 5. Execution Sequence (dependency-ordered, not just priority-ordered)

The order matters because some fixes are cheap now and brutal later, and some unlock others.

**Phase 0 — Stop the bleeding (days):** P0-1 (push recover branches), P0-12 (secret hygiene). Pure preservation, no feature work.

**Phase 1 — Security & correctness foundation (1–2 weeks):** P0-10, P0-11 (Prisma singleton, native hashing — hours each, remove landmines), then P0-2/P0-3/P0-4/P0-5/P0-6 (reintegrate CSRF + MFA, refresh/lockout/enumeration). These are mostly *reintegration + wiring* of already-written code, not greenfield.

**Phase 2 — Make it deployable (1 week):** P0-8, P0-9 (Dockerfile, `/ready`), P1-10 (blocking scan). After this, the app can actually run somewhere reproducibly.

**Phase 3 — Make the product real (2–3 weeks):** P0-7 (real AI providers behind config — this is what makes "just add an API key" literally true), P1-12 (job queue), P2-4 (object storage), P1-9 (validation).

**Phase 4 — Safe to open the doors (2 weeks):** P1-1 (Highs + regression tests), P1-2 (Redis shared state), P1-3 (tenancy), P1-4 (frontend auth), P1-11 (E2E/security tests).

**Phase 5 — Operate like a company (2 weeks):** P1-5 (CD+rollback), P1-6/P1-7 (metrics/alerting/tracing), P1-8 (backups+restore drill).

**Phase 6 — Scale & enterprise (ongoing):** P2 and P3 items as traffic and deals demand.

**Rough order-of-magnitude to a safe public launch: ~8–11 focused weeks**, front-loaded by the fact that MFA/CSRF/AI-integration are recoverable rather than net-new. Beta (closed, no real customer PII) is reachable at the end of Phase 3, ~4–5 weeks.

---

## 6. Can It Handle Load? (verdict per tier, from architecture as-is)

| Users | Verdict today | After which phases |
|---|---|---|
| 1,000 | Infra: yes. Safe to expose: **no** until Phase 1 (unwired CSRF/MFA, no lockout) | Phase 1 |
| 10,000 | **No** — `bcryptjs` login stalls freeze the API under login bursts | Phase 1 (native hashing) |
| 100,000 | **No** — needs ≥2 instances; in-memory rate-limit/lockout break; 6 Prisma clients exhaust connections | Phase 1 (P0-10) + Phase 4 (P1-2) |
| 1,000,000 | **No** — needs job queue, read replicas, shared cache, worker fleet | Phases 3–6 |
| 10,000,000 | **No** — needs edge auth, regional cells, partitioned audit/data | Beyond this plan's core; P2/P3 groundwork required |

---

## 7. Definition of "Done" — the founder's exact condition, made testable

Synora meets *"only add environment variables/API keys and deploy"* when **all** of these are true (no code edit required for any):

1. Every P0 and P1 item above is green.
2. A single `docker build` (or CD tag) produces the deployable artifact — no per-deploy code edits.
3. Every external service (AI providers, storage, email, Redis, DB) is selected and activated **purely by an env var / secret**; the integration code already exists and is tested against a real provider.
4. Booting with a required secret missing **fails closed with a clear message** (already true for existing secrets via `validateRequired()` — extend to all new ones).
5. There are **no** `TODO`, `placeholder`, `mock`, or `FIXME` markers in production code paths (a CI grep gate enforces this).
6. CI is green including E2E + security-regression + a blocking vuln scan; a backup/restore drill has been run once for real.
7. Rollback is one command and has been rehearsed.

Until items 1–7 hold, "just add keys and deploy" is not yet true — and this document is the exact, ranked list of what makes it true.

---

## 8. What I Recommend You Approve Next

This is the roadmap only; no code was changed. The natural next step is **Phase 0 + the two cheapest P0s (P0-10, P0-11)** and **reintegrating the recovered CSRF/MFA work (P0-2, P0-3)** — because that work is *already written and tested*, is one container-recycle from being lost forever, and closes four of six critical security gaps. Say the word and I'll begin with Phase 0 (preserve the stranded branches) and proceed down the sequence, one production-grade increment at a time — no placeholders, per your mandate.

---

*Evidence basis: this plan was verified against `git log/reflog/ls-tree`, `apps/backend/src/**`, `apps/web/**`, `packages/database/prisma/schema.prisma`, `package.json` files, and `.github/workflows/ci.yml` on 2026-07-21. Prior reports were read but not trusted; where this plan agrees with them, it is because the underlying code independently confirmed it.*
