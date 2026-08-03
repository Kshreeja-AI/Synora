# Synora Operational Cost Audit

**Status:** Living document — update whenever a cost source is added, removed, or re-measured.
**First audit:** 2026-08-03, under the Engineering Constitution (quality first, cost second, evidence always).

## How to read this

Every recurring cost Synora incurs — or will incur at launch — is listed with
where it comes from, how it scales, what could reduce it, and a
classification under the Quality Impact Assessment rule:

- **SAFE** — no measurable quality degradation; implement.
- **CONDITIONAL** — needs validation before acting.
- **REJECT** — saves money by degrading something that matters; do not do.

A cost that buys quality is not waste. This audit distinguishes spend that
buys nothing (duplicate CI runs) from spend that buys trust (full-history
secret scanning), and only ever cuts the former.

---

## 1. The headline finding: CI ran everything twice

**Source:** `.github/workflows/ci.yml` triggered on both `push` to
`claude/*` branches AND `pull_request` into `SYNORA` — the same commits,
so every push to a PR branch ran the full 4-job pipeline (test, e2e,
docker, security) twice.

**Evidence, not estimation:**
- Paired duplicate runs observed on identical head SHAs (e.g. runs
  30859062654 and 30859065741, both on `6128d61`, 2026-08-03).
- 288 commits pushed in the 7 days before this audit.
- Full pipeline ≈ 20–30 runner-minutes (Postgres service + migrations +
  drift check + lint + typecheck + coverage + build; Playwright e2e;
  Docker buildx; full-history gitleaks). Doubled: 40–60 min per push.
- Consequence observed directly: the organization's Actions minutes were
  exhausted — 100+ consecutive jobs failed with `runner_id: 0` (no
  machine ever assigned) in ~2 seconds each with no logs.

**Fix (SAFE, implemented 2026-08-03):**
1. Removed `claude/*` from the push triggers — feature branches get their
   single full pipeline through the PR, which this development model opens
   immediately. Long-lived branches (`main`, `develop`, `SYNORA`) keep
   push CI.
2. Added a `concurrency` group cancelling superseded PR runs — rapid
   consecutive pushes stop paying for commits that no merge decision will
   ever be made on. Never cancels long-lived-branch builds.

**Measured benefit:** exactly one pipeline per change instead of two —
a ≥50% reduction in Actions consumption at identical coverage, more under
rapid pushing. **Confidence: high** (the duplication is directly observed;
the halving is arithmetic, not projection).

## 2. Full recurring-cost inventory

### Paying or metered today

| Cost | Source | Scales with | State after this audit |
|---|---|---|---|
| GitHub Actions minutes | `ci.yml`, private repo, metered per-minute | pushes × pipeline length | Halved (§1). Remaining spend buys real verification. |

That table is deliberately one row. **Everything else is $0 today**, which
is what the Constitution's local-first rule demands — verified below rather
than assumed.

### Local-first, $0 until launch (verified in code)

| Cost surface | Implementation today | Future cost driver |
|---|---|---|
| AI inference | Provider abstraction with mock providers + dev-runtime cassettes; no production keys exist | The dominant launch cost. Measurement already built: EOS cost monitor (per-provider spend + anomaly detection), media pricing (explicit `pricingBasis`), evidence router (quality/cost/latency-aware recommendations). |
| Database | Local PostgreSQL 16 via `docker-compose.dev.yml` | Managed Postgres at launch; Supabase guides exist but nothing paid is wired. |
| Redis / queues | Local Redis 7 via compose; BullMQ workers | Managed Redis at launch; queue-depth collector already measures load. |
| Object storage | Local storage provider (`apps/backend/uploads/`, gitignored) | S3-compatible at launch; abstraction seam already in place. |
| Email | Mailer abstraction, log/no-op provider by default | Transactional email service at launch. |
| Observability | Winston structured logs + self-hosted EOS collectors (latency, error-rate, memory, cost, drift) | Deliberately self-hosted; the EOS **is** the observability layer, per directive it must not become a paid dependency or a point of failure. |
| Embeddings/vectors | pgvector store + provider adapters, credential-blocked | Embedding API calls at launch; caching seam exists. |

### External services in CI (free tier / inert)

| Service | Cost today | Assessment |
|---|---|---|
| Codecov upload | Free tier, non-blocking | Keep. CONDITIONAL to remove — coverage visibility is quality infrastructure. |
| Snyk scan | No token configured; step runs and exits, ~1 min/pipeline | Keep for now (CONDITIONAL): non-blocking, becomes useful the day a token is added. Revisit if it ever blocks or slows the pipeline materially. |
| gitleaks full-history scan (`fetch-depth: 0`) | Extra checkout time, ~seconds | **Justified cost — do not cut.** Whole-history secret scanning is exactly the spend-that-buys-trust category. |
| Docker build | GHA cache already enabled (`cache-from/to: type=gha`) | Already optimized. |

## 3. Costs examined and found already conforming

- **Duplicate systems:** the generation-path and search dedup work
  (2026-07/08 audits) already removed the parallel implementations; no
  duplicate services currently ship.
- **Ignore hygiene:** coverage, logs, uploads, build outputs are
  gitignored; repo root holds only living documents per `CLAUDE.md`, with
  frozen reports in `docs/archive/`.
- **Dev infrastructure:** compose runs exactly two containers (postgres,
  redis), both alpine images. Nothing paid, nothing oversized.

## 4. Optimisations considered and REJECTED

Recorded so they are not re-proposed later without new evidence:

- **Skip e2e/docker jobs on PR pushes** — REJECT: removes real
  verification from the commits a merge decision is made on.
- **Shallow-clone the security job** — REJECT: blinds the secret scan to
  history, which is most of its value.
- **Drop the migration drift check** — REJECT: it exists because drift
  actually shipped once; its cost is seconds, its value is the production
  schema staying true.
- **Reduce test coverage runs to save minutes** — REJECT on principle:
  never trade measurable quality for cost.

## 5. Standing rule for future cost decisions

Before any optimisation: classify SAFE / CONDITIONAL / REJECT with the
evidence written down. Implement SAFE only. When launch-time costs begin
(AI inference first), the EOS cost monitor is the meter — decisions come
from its measurements, not from provider price pages alone.
