# PRODUCTION_READINESS_v2.md

**Reviewer:** DevOps Lead (independent review)
**Date:** 2026-07-21
**Scope:** Docker, CI/CD, secrets, environments, observability, health, backups/DR, migrations, rollout strategy, scaling, CDN, cost
**Method:** Full read of `.github/workflows/ci.yml`, all Docker/compose files, `infrastructure/`, secrets subsystem, and every deployment/database doc, cross-checked against what the repository actually contains (not what the docs claim).

## Production Readiness Score: 29 / 100

**One-line verdict:** There is no deployable artifact. `docs/deployment.md` documents `docker build -t synora:latest .` against a Dockerfile that does not exist anywhere in the repository, on any branch, in any commit. CI now runs green (build/lint/type-check/test), which is real and recent progress — but everything past "tests pass" — packaging, deployment, rollback, observability, backups — is either pure documentation with no backing automation, or entirely absent.

---

## Docker

**Finding: no Dockerfile exists.** Repository search for `Dockerfile*` across the entire tree returns zero results. What exists:
- `docker-compose.dev.yml` — Postgres 16 + Redis 7 for local development, with healthchecks. Correctly configured for its narrow purpose.
- `infrastructure/docker/docker-compose.secrets.example.yml` — an *example* showing how Docker secrets would feed the secrets subsystem, not a deployable file.
- `infrastructure/k8s/secret.example.yaml` — same pattern, K8s Secret example only.

None of these produce a runnable application container. `docs/deployment.md` §"Docker Deployment" gives a full multi-stage Dockerfile listing in prose and instructs `docker build -t synora:latest .` — this command would fail today with "no such file." This is the single highest-priority production-readiness gap: there is currently no way to containerize and ship this application by following the project's own documentation.

**Also unused:** the Redis container in `docker-compose.dev.yml` is provisioned but nothing in the application connects to it (confirmed: zero Redis client code anywhere in `apps/backend`). Infrastructure exists ahead of the code that would use it — harmless in dev, but a signal that "documented" and "wired" are two different states throughout this project.

## CI/CD & GitHub Actions

**What exists:** one workflow, `.github/workflows/ci.yml`, triggered on push to `main`/`develop`/`claude/*` and PRs to `main`/`develop`. Steps: checkout → pnpm setup → install (frozen lockfile) → `db:generate` → `db:migrate` (against a Postgres 16 service container) → lint → type-check → test:coverage → build → codecov upload (non-blocking) → separate `security` job running Snyk.

**What's genuinely good:** the pipeline is real, was recently repaired end-to-end (Prisma schema path, migration baseline, turbo env passthrough — see git history), and now passes cleanly: 134/134 tests, clean lint, clean type-check, successful build, verified against a real Postgres 16 instance.

**Gaps:**
- **No CD.** Nothing deploys anywhere. There is no `deploy.yml`, no environment-gated workflow, no artifact publishing step (no Docker image build/push, since there's no Dockerfile to build). CI validates correctness; nothing ships it anywhere.
- **Security job cannot fail the build.** `continue-on-error: true` on the Snyk step means a discovered critical vulnerability produces a green checkmark. This is a false-positive safety signal — worse than not running the scan, because it looks like a gate and isn't one.
- **Single workflow, single OS/Node version.** No matrix (Node LTS variants), no separate fast-feedback (lint-only) job ahead of the full suite, so a lint failure still waits through DB service startup and Prisma steps before surfacing.
- **No CI badge accuracy check** — the README badge points at this workflow, is accurate, but there's nothing else to badge (no deploy status, no coverage threshold badge with a real gate behind it).
- **No branch protection evidence in-repo** (not verifiable from the filesystem, but worth an explicit check: does `main`/`develop` require the CI job before merge?).

## Secrets

**This is the strongest area of the entire production-readiness review.** The `apps/backend/src/secrets/` subsystem is a genuinely well-designed abstraction: pluggable sources (env var, Docker secret file, Kubernetes mount, placeholder-for-dev) behind a single `SecretsManager`, a catalog declaring which secrets are required per environment, version history with rotation-grace-window support, and a structured audit log (`ISecretAuditLog`) that never logs values, only metadata. `validateRequired()` fails closed in staging/production and warns-only in development — the right default in both directions.

**Gaps relative to production use:**
- No real HSM/KMS integration — `stubHsmProvider.ts` is explicitly a stub; production secret storage still ultimately resolves to env vars or mounted files, not a managed secret store (AWS Secrets Manager, GCP Secret Manager, Vault). The interface is ready for this; the implementation isn't there yet.
- Audit log sink is Winston-to-file/console by default (`LoggerAuditLog`) — the code's own doc comment says this plainly: "local log files are not an acceptable long-term audit trail for production secret access." No SIEM-backed implementation exists yet.
- Per the performance review, every secret *read* (not just rotation) currently emits an audit-log line — at production request volume this drowns the meaningful signal (placeholder access, rotation) the subsystem exists to surface.
- An untracked `.env.staging` file with realistic-looking generated secrets sits in the repository working directory (correctly gitignored, confirmed **not** committed via `git ls-files`) — low risk today, but worth a hygiene rule (secret-scanning pre-commit hook) so this class of file is provably never one `git add -f` away from a leak.

## Environment

Three `.env.example` files (root, backend, web) plus two current operations docs (`ENVIRONMENT_MANAGEMENT.md`, `ENVIRONMENT_MIGRATION_GUIDE.md`, both dated 2026-07-20 and accurate). The stage/mode taxonomy (`config/stage.ts`, `config/modes.ts`) is a real, tested abstraction with government/enterprise compliance hooks already wired. This is production-grade design for a system that has nowhere yet to run in production.

**Gap:** no environment-specific deployment target actually exists (no Vercel project config beyond doc mentions, no Railway/AWS config, no Terraform despite `infrastructure/terraform/` being named in `CLAUDE.md`'s own repository-structure diagram — the directory doesn't exist).

## Observability: OpenTelemetry, Metrics, Prometheus, Grafana, Alerting

**All absent.** Repository-wide search for `opentelemetry`, `prometheus`, `grafana`, `prom-client`, `otel` returns zero matches in any source, config, or dependency file. Concretely:
- No tracing (no span, no trace context propagation) anywhere.
- No metrics endpoint (`/metrics`) despite the A3 `MonitoringService` already computing exactly the numbers a metrics endpoint would need (success rate, lockout rate, active users) — the data model for observability exists and has no scrape surface.
- No alerting integration beyond the A3 `AlertingService`'s channel *stubs* (`console.log` placeholders for email/webhook/SIEM) — nothing pages anyone about anything in this system today.
- Logging (Winston, structured JSON-ish, request logger middleware) is the one observability primitive that's real, but has no correlation/trace ID, so a single request's log lines can't be joined across middleware without manual timestamp correlation.
- Health check (`GET /health`) returns a static `{status: 'ok'}` with no database connectivity check — an orchestrator using this for rollout/liveness gating would see "ok" while the database is unreachable.

## Health Checks

One endpoint, liveness-only, no dependency checks. No `/ready` distinguishing "process is up" from "process can serve traffic" (the difference matters most exactly at deploy time and exactly during a database failover — the two moments health checks exist for).

## Backups & Disaster Recovery

**100% documentation, 0% automation.** `docs/database.md` and `docs/deployment.md` describe daily automated backups, 30-day point-in-time recovery, and read-replica failover — all "depends on hosting provider" / AWS RDS-flavored prose. Nothing in this repository provisions, schedules, tests, or verifies any backup. No backup script, no restore-drill documentation with actual run history, no `pg_dump` cron job, no IaC defining a backup policy. A team following only this repository has no disaster recovery capability today, only a paragraph describing what one would look like on a specific cloud provider's managed database.

## Database Migration & Rollback Strategy

**Migrations:** Prisma-managed, and — as of the CI-fix PR — actually correct: a single generated baseline migration (`20260721000000_init`) plus `migration_lock.toml`, verified via `prisma migrate deploy` against real Postgres 16 in this review's own session. This is a recent and real fix; before it, the migration set could not deploy to a fresh database at all (hand-written SQLite-syntax SQL against a Postgres schema).

**Rollback:** `docs/deployment.md` documents `vercel rollback` (frontend) and a backend rollback section — both assume hosting infrastructure (Vercel, presumably a container registry) that doesn't exist in this repository. No Prisma *down*-migration strategy is documented or scripted (Prisma's own tooling doesn't auto-generate down migrations; this needs an explicit runbook that doesn't exist). No tested procedure exists for "the last deploy is bad, revert the schema and the code together."

## Blue-Green / Canary Deployment

Mentioned in `docs/architecture.md` prose ("Blue-green deployment strategy," "Automatic rollback on health check failure") with zero supporting configuration anywhere — no load-balancer config, no traffic-splitting rule, no feature-flag/canary-cohort mechanism in code. This is aspirational documentation with no implementation path currently started.

## Scaling & Autoscaling

No autoscaling configuration exists (no K8s HPA manifest, no Vercel/Railway scaling config, no `infrastructure/k8s/` deployment manifests beyond the one secret example). More importantly, per the performance and architecture reviews, **the application is not currently safe to scale horizontally as-is**: in-memory rate limiting and the A3 `AlertingService`'s in-process alert store both silently lose correctness the moment a second replica exists. Any autoscaling policy configured today would scale a system that breaks its own security controls when it triggers.

## CDN / Cloudflare

No CDN configuration exists anywhere (no `cloudflare.toml`, no Vercel edge config, no CDN cache-control strategy documented for static assets). For the current app (server-rendered Next.js, no static asset-heavy workload yet), this is a low-urgency gap — but should be planned before any public launch given even modest global traffic, and pairs naturally with the performance review's Phase 4 recommendation to move JWT verification to the edge (which requires the RS256/EdDSA migration noted there).

## Cost Estimation

No cost model exists in any document. Given the current architecture (single Node backend, single Postgres, no queue, no cache layer, no CDN), a rough current-state estimate for a minimal always-on staging environment:

| Component | Minimal spec | Approx. monthly (USD, generic cloud pricing) |
|---|---|---|
| Backend compute (1 small instance) | 1 vCPU / 1GB | $15–30 |
| Postgres (managed, small) | 1 vCPU / 2GB, 20GB storage | $25–50 |
| Frontend hosting (Vercel/similar) | Hobby–Pro tier | $0–20 |
| Redis (provisioned, unused today) | Smallest managed tier | $10–15 |
| **Total (staging, no real traffic)** | | **~$50–115/mo** |

This is a rough order-of-magnitude placeholder, not a substitute for a real cost model tied to actual chosen providers — flagged here because none exists at all today, and the DevOps review would be incomplete without noting that gap explicitly rather than silently omitting cost.

---

## Production Readiness Checklist

| Item | Status |
|---|---|
| Dockerfile / deployable artifact | ❌ Does not exist |
| CI pipeline (build/lint/type-check/test) | ✅ Green, verified |
| CD / automated deployment | ❌ Does not exist |
| Security scan that can block a merge | ❌ `continue-on-error: true` |
| Secrets management design | ✅ Strong |
| Secrets management production backend (HSM/KMS/SIEM) | ❌ Stubs only |
| Environment/config system | ✅ Strong |
| Metrics endpoint | ❌ Does not exist |
| Tracing | ❌ Does not exist |
| Alerting (real channels) | ❌ Stubs only |
| Liveness/readiness health checks | ⚠️ Liveness only, no DB check |
| Backup automation | ❌ Documentation only |
| Disaster recovery runbook + drill history | ❌ Documentation only, untested |
| Migration strategy | ✅ Fixed and verified this cycle |
| Rollback strategy (tested) | ❌ Documentation only, assumes unbuilt infra |
| Blue-green/canary | ❌ Documentation only |
| Autoscaling | ❌ Does not exist; unsafe if it did (in-memory state) |
| CDN | ❌ Does not exist |
| Cost model | ❌ Does not exist |

---

## Roadmap

**Phase 0 — Make it shippable at all (3–5 days)**
1. Write the actual Dockerfile the docs already describe; multi-stage build, non-root user, healthcheck instruction hitting a real `/ready`.
2. Add `/ready` (DB ping) alongside the existing `/health` (liveness).
3. Make the Snyk job blocking (remove `continue-on-error`, or gate merge on a documented severity threshold).

**Phase 1 — Basic observability (1 week)**
4. `prom-client` `/metrics` endpoint fed by the already-built A3 `MonitoringService`.
5. Correlation IDs through logging (`AsyncLocalStorage`), one real alert channel (start with webhook-to-Slack) instead of a console stub.

**Phase 2 — Make scaling safe before making it automatic (1–2 weeks)**
6. Redis-backed rate limiting/lockout state (also a security and performance finding — one fix, three reports).
7. Only after Phase 2.6: introduce autoscaling config.

**Phase 3 — Real deployment lifecycle (1–2 weeks)**
8. CD workflow: build/push image on tag, deploy to a real staging target, automated migration step with a documented rollback runbook (including a Prisma down-migration or restore-from-backup procedure, tested at least once).
9. Automated backup job + one verified restore drill, replacing the current prose-only claim.

**Phase 4 — Scale-out readiness (as traffic demands)**
10. CDN + edge JWT verification (pairs with the performance review's RS256/EdDSA recommendation), blue-green or canary mechanism, real cost model tied to chosen providers.

---

## Score Rationale

| Dimension | Score | Why |
|---|---|---|
| Deployable artifact | 0/10 | No Dockerfile exists at all |
| CI | 7/10 | Real, currently green, but no CD and a non-blocking security gate |
| Secrets architecture | 8/10 | Genuinely strong design; production backends still stubbed |
| Environment/config | 8/10 | Genuinely strong, tested, documented |
| Observability | 1/10 | Logging exists; metrics/tracing/alerting are absent or stubbed |
| Health checks | 3/10 | Exists, but liveness-only with no dependency check |
| Backup/DR | 1/10 | Documentation with zero automation or tested procedure |
| Migration/rollback | 5/10 | Migrations fixed and verified; rollback is prose-only against unbuilt infra |
| Scaling readiness | 1/10 | Not just absent — unsafe if enabled today (in-memory state) |
| CDN/cost planning | 0/10 | Neither exists |
| **Overall** | **29/100** | Two genuinely strong subsystems (secrets, config) surrounded by an otherwise pre-production shell |

*Companion documents: AUTH_SYSTEM_SECURITY_AUDIT_v2.md, ARCHITECTURE_REVIEW_v2.md, PERFORMANCE_REVIEW_v2.md, TEST_COVERAGE_MASTER_REPORT.md, DOCUMENTATION_AUDIT_v2.md.*
