# Synora Release Roadmap

**Author:** Release Manager
**Date:** 2026-07-21
**Basis:** MASTER_PRODUCTION_EXECUTION_PLAN.md, re-verified against actual committed source and git history. Markdown claims not trusted.
**Objective:** A real, launchable SaaS for real paying customers — not a theoretical perfect system. Release 1 is the minimum for that; Releases 2–4 are hardening, enterprise, and hyperscale.

---

## Definition of each release

- **Release 1 — Launchable for real customers.** A person can sign up, authenticate securely, and get real value from the core product (real AI generation activated by an API key), deployed reproducibly on a single managed environment without losing data or leaking secrets. The founder's north star ("add env vars/keys and deploy") is true for the core product.
- **Release 2 — Production hardening.** MFA, CSRF + cookie auth, Redis-backed shared state, async media generation, CD pipeline, metrics/alerting/tracing, backups automation, full E2E/security regression suites.
- **Release 3 — Enterprise.** Workspace multi-tenancy enforcement, SSO/SAML/OIDC, RBAC depth, audit export, data residency, self-hosting bundle, API versioning + OpenAPI.
- **Release 4 — Hyperscale (10M+).** Kubernetes, Terraform, multi-region, read replicas, edge auth, regional cells, partitioned data. Explicitly out of scope until R1–R3 are done.

---

## Already completed this engagement (verified, on `origin/claude/synora-ai-platform-h5q0k2`)

| Item | Commit | Verified |
|---|---|---|
| JWT algorithm pinning (audit CRITICAL-001) | in merged #27 | ✅ HS256 pinned, code-read |
| P0-1 Preserve stranded CSRF/MFA work | `recover/csrf`, `recover/mfa` pushed | ✅ on remote |
| P0-9 Real `/ready` DB probe | `e9fa45d` | ✅ 4 tests, real Postgres |
| P0-10 Single Prisma client | `e9fa45d` | ✅ 6→1 pool, tests green |
| P0-11 Argon2id hashing + bcrypt migration | `cfe9a64` | ✅ 160 tests, real E2E migration test |

---

## Full remaining-task register (every task, all requested fields)

Effort: **S** ≤0.5d · **M** 0.5–2d · **L** 2–5d · **XL** >5d. Risk reflects blast radius if done wrong.

### Release 1 tasks

| ID | Task | Why required | Blocks R1? | Effort | Risk | Dependencies | Verification | Rollback |
|---|---|---|---|---|---|---|---|---|
| **R1-a** | **P0-6 Email-enumeration fix** | Real customers' account existence is currently discoverable via differing login/register responses — privacy + phishing-target leak | **YES** | S | Low | none | Test: identical response shape for known vs unknown email on login+register | Revert one file; behavior additive |
| **R1-b** | **P1-9 Input validation on every mutating route** | `POST /images/generate` etc. trust arbitrary bodies → 500s and mass-assignment; a customer-facing API must never 500 on bad input | **YES** | M | Low | none | Test: each mutating route returns 400 (not 500) on malformed/missing fields | Per-route revert |
| **R1-c** | **P0-4 Refresh token + logout invalidation** | 15-min access tokens with no refresh = re-login every 15 min (unusable); no revocation = "logout" is fake. Real sessions need both | **YES** | L | Med | Prisma singleton (done), `Session` model (exists) | Tests: login issues access+refresh; refresh rotates; logout revokes refresh; revoked refresh rejected | Feature-flag refresh; access tokens still work standalone |
| **R1-d** | **P0-5 Account lockout on login** | Per-account brute force is currently unthrottled; a real customer's account can be password-sprayed indefinitely | **YES** | M | Med | login-attempt recording | Test: N failed logins → lockout → correct password rejected during window → unlock after window | Config-driven threshold; disable by raising limit |
| **R1-e** | **P0-7 Real AI provider integration (text/code first)** | The product's value is AI generation; today it returns placeholder data. Adding an API key must activate real generation — the integration code must exist first | **YES** | XL | Med | config/secrets (done), provider abstraction | Tests: provider abstraction + Anthropic adapter with the HTTP boundary stubbed; config selects provider; missing key fails clean. Live call activates on real key (documented) | Config selects a safe default; provider swappable |
| **R1-f** | **P0-8 Dockerfile + reproducible artifact** | There is no way to deploy the app at all today | **YES** | M | Low | none | `docker build` produces a running non-root image; container `/ready` returns 200 against a DB | Dockerfile is additive; no runtime code change |
| **R1-g** | **P0-12 + P1-10 Secret hygiene + blocking CI secret/vuln scan** | Untracked `.env.staging` with real-looking secrets present; Snyk is non-blocking so a critical CVE passes green | **YES** | S | Low | none | CI fails on a planted secret and on a high-severity advisory; `git ls-files` shows no secret material | Scans are CI-only; no runtime impact |
| **R1-h** | **RELEASE_1_LAUNCH_READINESS.md** | The founder's deliverable: exact env vars, keys, deploy + migration commands, checklist | **YES (final)** | S | Low | all above | Doc lists only env/keys/commands; no code step remains | n/a |

### Release 2 tasks (production hardening — deferred, with reason)

| ID | Task | Why required | Blocks R1? | Effort | Risk | Dependencies | Verification | Rollback |
|---|---|---|---|---|---|---|---|---|
| R2-a | **P0-3 MFA reintegration** (from `recover/mfa`) | Valuable, and the named Module-1 deliverable — but a SaaS can and routinely does launch without mandatory MFA and add it shortly after. Already built, so low-cost later | No — see decision note | L | Med | rebase onto moved base (new migration, Prisma singleton, app.ts split) | Recover-branch tests re-green on current base; enroll/verify/recovery E2E | Feature-flag MFA off |
| R2-b | **P0-2 CSRF + P1-4 cookie auth** (CSRF from `recover/csrf`) | CSRF only matters once auth uses browser-auto-sent cookies. R1 keeps bearer tokens in the `Authorization` header, which are **not** CSRF-vulnerable. So CSRF is correctly coupled to the cookie migration and moves together to R2 | No — see decision note | L | Med | cookie-session migration | CSRF token required on cookie-auth mutations; XSS-token-theft path closed | Keep bearer-token path behind flag |
| R2-c | **P1-2 Redis-backed rate-limit/lockout/revocation** | Only needed for ≥2 app instances; R1 runs single-instance where in-process + DB-backed state is correct | No | M | Low | Redis provisioned | Two instances share limits/lockout state | Fall back to DB-backed store |
| R2-d | **P1-12 Async job queue + media generation (image/video/audio)** | Heavy media calls (10–60s) must not block the request thread. R1 ships fast text/code generation synchronously; media waits for the queue | No | L | Med | Redis (R2-c), object storage (R3) | Enqueue → 202 → worker completes; API stays responsive | Disable media endpoints |
| R2-e | **P1-5 CD pipeline + tested rollback** | R1 can deploy manually via the Dockerfile + documented commands; CD is an efficiency/safety upgrade | No | L | Med | Dockerfile (R1-f) | Tag → staging deploy → prod on approval; rehearsed rollback | Manual deploy remains |
| R2-f | **P1-6/P1-7 Metrics endpoint + alerting + correlation IDs/tracing** | R1 relies on the managed platform's logs/metrics + existing winston + `/health`,`/ready`. Real `/metrics` and paging are a hardening step | No | M | Low | monitoring service (exists) | `/metrics` scrapeable; alert fires; request IDs in logs | Additive |
| R2-g | **P1-8 Automated backup job + rehearsed restore** | R1 satisfies this by choosing a **managed Postgres** (RDS/Neon/Supabase) whose automated backups + PITR are the provider's job — documented as a launch requirement, not app code. Owning the backup job is an R2 upgrade | No (satisfied by managed DB in R1) | M | Med | infra choice | Restore drill executed and documented | Provider PITR |
| R2-h | **P1-1 remaining security Highs + regression tests; P1-11 E2E/security suites in CI** | The cheapest Highs fold into R1 items; the rest plus full E2E are hardening | Partial (cheap ones in R1 items) | L | Med | features exist | Each High has a failing-without-fix test; Playwright covers auth flow | Additive |

### Release 3 tasks (enterprise — deferred)

| ID | Task | Why | Blocks R1? | Effort | Risk | Deps | Verification | Rollback |
|---|---|---|---|---|---|---|---|---|
| R3-a | P1-3 Workspace multi-tenancy enforcement | Routes already scope by `userId` (basic per-user isolation exists); full workspace-tenant isolation is an enterprise concern | No | L | High | schema migration | Cross-tenant access test cannot leak | Migration reversible pre-data |
| R3-b | P2-3 API versioning (`/api/v1`) + OpenAPI from zod | Needed before external integrators pin versions | No | M | Low | zod schemas (R1-b) | `/api/v1` live; spec generated | Alias old paths |
| R3-c | P2-4 Object storage (S3-compatible) | Durable media storage; enables R2-d media | No | M | Med | provider config | Media persisted, provider swappable | Config default |
| R3-d | P2-8 Self-hosting one-command bundle | Enterprise/self-host buyers | No | M | Low | Dockerfile (R1-f) | `docker compose up` runs full stack | n/a |
| R3-e | P2-9 SSO/SAML/OIDC, RBAC depth, audit export, data residency | Gated enterprise deals; config hooks exist | No | XL | Med | auth model | Each enterprise mode toggles real behavior | Flags |
| R3-f | P2-1/P2-2 Service layer + DI composition root | Maintainability at team scale | No | L | Low | none | Routes thin; services own logic | Incremental |
| R3-g | P2-6 Caching; P2-10 blue-green/canary | Scale + zero-downtime | No | L | Med | Redis, CD | Cache invalidation correct; gradual rollout | Additive |

### Release 4 tasks (hyperscale 10M+ — explicitly deferred)

| ID | Task | Why | Blocks R1? | Effort | Risk | Deps |
|---|---|---|---|---|---|---|
| R4-a | Kubernetes manifests + HPA (P2-5) | Only at multi-node scale | No | L | Med | Docker, Redis |
| R4-b | Terraform / IaC | Reproducible cloud infra at scale | No | XL | Med | cloud choice |
| R4-c | Multi-region, read replicas, regional cells, edge auth | 10M+ latency/availability | No | XL | High | all above |
| R4-d | Banking/healthcare/government compliance depth | Regulated verticals | No | XL | High | enterprise base |

### Cross-cutting polish (fold into R2/R3 as touched)
P3-1 domain structure, P3-2 ADRs, P3-3 diagrams, P3-4 accessibility, P3-5 cross-browser, P3-6 CDN, P3-7 cost model, P3-8 doc reconciliation.

---

## Two decisions I flag for you (I am proceeding with the defaults; override anytime)

1. **MFA and CSRF are scoped to Release 2, not Release 1.** Rationale: a real SaaS launches for real customers without mandatory MFA every day (Stripe, Linear, Notion all did), and CSRF is only a live threat once auth moves to browser-auto-sent cookies — which R1 does not do (it uses bearer tokens in the `Authorization` header). Both are already built on the `recover/*` branches, so pulling them into R1 later is low-cost. **If you want MFA and/or cookie-auth+CSRF in the initial launch, say so and I'll move them into R1.** I am not blocking on this — none of the R1 blockers depend on it.

2. **R1 AI generation is text/code first (default provider: Anthropic Claude, per this repo's own guidance), with image/video/audio deferred to R2.** Rationale: text/code generation is fast enough to serve synchronously (no queue needed), high-value, and fits the "add an API key and it works" model cleanly; media needs object storage + an async queue (R2/R3). The provider layer will be an abstraction so more providers/modalities add cleanly. **If your launch must include image generation on day one, tell me and I'll pull the queue + storage forward into R1.**

---

## Release 1 blockers, sorted by dependency order (execution order)

1. **R1-a — Email-enumeration fix** (no deps; in `auth.ts`)
2. **R1-b — Input validation on all mutating routes** (no deps; produces the zod schemas R3-b later reuses)
3. **R1-f — Dockerfile** (no deps; unblocks deploy verification independently)
4. **R1-g — CI secret/vuln scan + secret hygiene** (no deps; CI only)
5. **R1-c — Refresh token + logout invalidation** (needs Prisma singleton ✓ + `Session` model ✓)
6. **R1-d — Account lockout on login** (builds on login-attempt recording introduced with R1-c)
7. **R1-e — Real AI provider integration** (needs config/secrets ✓; largest; provider abstraction)
8. **R1-h — RELEASE_1_LAUNCH_READINESS.md** (last; depends on all above)

Each executed with the full ceremony already established this engagement: implementation → tests (real infra) → docs → security/architecture/performance review → verification → commit → push. Executing now, in this order, continuing automatically.
