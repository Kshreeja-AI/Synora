# Synora — Launch and Model Readiness Audit

**Date**: 2026-08-06 · **Basis**: direct inspection of the repository, not
assumption. Every "exists" below was verified by reading the file or running
the test. Every gap is stated as a gap.

**The audit's headline**: Synora is much closer to the founder's local-first
objective than the directive assumed. The provider-agnostic layer is real and
used; a local-model adapter (Ollama) is **already implemented, tested and
registered**; the training data foundation (datasets, versions, evaluation
runs, model registry, benchmarks) is **already built and mounted**; consent
already defaults to deny. What is genuinely missing is narrower: spend caps,
a running local model, deployment plumbing, and the pipeline that turns
experience into datasets.

---

## A. Current state

- **Application**: pnpm/Turbo monorepo. Express+TS backend (265 test files,
  2,853 tests passing locally), Next.js 15 frontend (107 files, 740 tests),
  Prisma/PostgreSQL 16, Redis. Production `Dockerfile` at repo root;
  `docker-compose.dev.yml` for local infra. `infrastructure/k8s/` exists but
  is deliberately unused.
- **Universal Command Layer**: complete loop — understand → decompose → plan
  → authorise → approve → execute → observe → undo — all durable, all
  audited, all workspace-scoped.
- **Intelligence Kernel**: 2 of ~5 foundations done (behavior-rule registry
  with test-backed provenance; honest availability vocabulary incl.
  `needs-model`).
- **Provider layer**: `ai/registry.ts` + `ai/resolver.ts`; business logic
  never names a vendor. 12 text/streaming provider adapters implemented,
  including **Anthropic** (text + streaming, tested) and **Ollama** (local,
  tested, keyless, activated by `OLLAMA_BASE_URL`). Placeholder keys honestly
  read as *not configured* (slice 13).
- **Observability**: `eos/` (44 modules) — latency, error rate, provider
  degradation, prompt outcomes, **cost observation** (`pricing.ts`,
  `cost-monitor.ts`, `instrumentedGenerate.ts`), judges, graders, gates.
- **Security**: JWT + rotating refresh, MFA, CSRF, lockout, secrets manager
  with audited reads, role-based permissions enforced at service level,
  404-not-403, rate limiting (auth + resource + outbound text-path).
- **Consent**: `TrainingConsent`; `canUseForTraining` defaults **false**.

## B. Already production-useful — do not rebuild

| System | Evidence |
|---|---|
| Provider abstraction, actually used | resolver is the only path to providers; hostile-key tests |
| Anthropic adapter | `ai/providers/anthropic.provider.ts` + streaming + tests |
| **Ollama local adapter** | `ai/providers/ollama.provider.ts` + tests; registered in `registry.ts` |
| Training data schema | `Dataset(+Version/Sample/Label/Split)`, `EvaluationRun/Result`, `BenchmarkRun/Metric`, `ModelRegistry`, `ModelVersion` — all serviced **and mounted** |
| Dataset export | JSONL/JSON/CSV writers via worker |
| Consent (default-deny) | `privacyConsent.service.ts` |
| Cost *observation* | pricing tables + EOS cost monitor per provider/model |
| Command layer + undo + audit | 20 slices, all locally verified |
| Auth/permissions/secrets | Release 1–2 hardening |
| Accessibility baseline | command surface announces every outcome |

## C. Missing for an Anthropic-powered MVP

1. **`ANTHROPIC_API_KEY` set** — the only credential genuinely required.
   The adapter, resolution, resilience (timeout/retry/breaker), streaming
   and instrumentation are already built. Setting the key is activation,
   not development.
2. **Spend caps** (§18): cost is *observed* but nothing *stops* spend. No
   daily/monthly limit per workspace or globally. **Launch blocker.**
3. **A real-model verification pass**: the whole text path has only ever run
   against mocks/local planner. First key = a verification slice, not a
   feature.

## D. Missing for an open-source (local) model

1. **Ollama installed + a model pulled** on the dev machine (founder action,
   free). The adapter is done.
2. A verification slice proving end-to-end generation through
   `OLLAMA_BASE_URL`, and flipping `ai.generate` availability logic to
   recognise a configured local model (it already will: Ollama's
   `isConfigured()` keys off the URL).
3. Candidate-model selection (see M): licence, RAM fit, quantised inference
   on a normal laptop.

## E. Missing for training

1. **Experience record** (IK slice 3, next): the structured record that
   becomes training candidates.
2. **Experience → dataset conversion**: `DatasetSample` exists; nothing
   writes command-layer experience into it. Redaction + dedup + quality
   filter steps do not exist.
3. **A training job runner**: schema fields exist (`ModelVersion` etc.);
   no worker executes fine-tuning. Realistically this runs on rented GPU
   hours or a future owned GPU — **never on the laptop**.
4. **Benchmark suite with fixed baselines** wired to promotion/rollback
   (registry supports it; gates not wired).

## F. Missing for fully local operation

Works locally today: everything in B plus the entire app. Missing: local
model running (D), local email (or accepting console-mail), local object
storage for uploads at scale (filesystem storage exists), and self-hosted
deployment plumbing (reverse proxy, TLS, backups).

## G. Required infrastructure (three profiles)

**PROFILE A — solo development (current; ₹0/$0)**
Local Postgres, local Redis, local filesystem storage, console mailer, local
Docker, Vitest. Everything already works. *Optional adds*: Ollama (free),
`ANTHROPIC_API_KEY` (paid, usage-based).

**PROFILE B — low-cost public MVP (~$5–15/month + Anthropic usage)**
- Hosting: one small VPS (Hetzner/Contabo class, ~$4–6/mo) running the
  existing Dockerfile behind Caddy (free, automatic HTTPS) — or a free-tier
  PaaS accepting its limits. Replaceable later: yes (it's just Docker).
- Database: Postgres on the same VPS + nightly `pg_dump` to a second
  location. Managed DB is optional, not required.
- Cache/queues: Redis on the same VPS.
- Object storage: filesystem first; S3-compatible (e.g. R2 free tier) when
  needed. Abstraction already exists.
- Email: needed only for invites/verification. Free-tier SMTP (~100/day)
  or defer invites at launch.
- Domain: ~$10–12/year. DNS free with registrar/Cloudflare.
- Monitoring: EOS is built-in; add free uptime ping (UptimeRobot class).
- CI: GitHub Actions free tier — currently unusable (runner outage, §S).
- Model inference: Anthropic API (usage-based) and/or Ollama on the VPS
  (small models only at this VPS size).

**PROFILE C — Synora-owned local infrastructure (future)**
Owned GPU box(es): inference (Ollama/vLLM), fine-tuning (PEFT), Postgres,
Redis, MinIO object storage, Caddy, local backups. Everything in the app is
already provider-agnostic and Docker-shaped, so this is a *migration*, not a
rewrite. Training larger models: rented GPU hours until owned hardware
justifies itself.

## H. Required credentials — see `SYNORA_FOUNDER_INTAKE.md`

**Required for Anthropic MVP: exactly one — `ANTHROPIC_API_KEY`.**
Everything else has a local/generated alternative.

## I. Optional credentials

SMTP (invites/verification emails), S3-compatible storage, domain registrar,
VPS SSH key, uptime monitor. None block local development or the Anthropic
MVP loop.

## J. Estimated cost categories

| Category | Now | Public MVP | Notes |
|---|---|---|---|
| Development | $0 | $0 | all local |
| Anthropic | $0 until key set | usage-based; **caps required first** | prepaid credits recommended |
| Hosting | $0 | ~$4–6/mo | one VPS |
| Domain | $0 | ~$1/mo amortised | yearly |
| Email | $0 | $0 (free tier) | |
| Storage | $0 | $0 → free tier | |
| Training | $0 | $0 | later: rented GPU hours per run (~$5–50/run for PEFT on small models) |

## K. Offline capability matrix

| OFFLINE/LOCAL today | Auth, workspaces, conversations, command layer, plans, approvals, undo, scheduling, memory storage+FTS, workflows, audit, rule registry, evaluation harness, dataset/model registries, accessibility output |
| LOCAL once installed | Text generation via Ollama; semantic search via local embedding model (adapter exists) |
| REMOTE PROVIDER | Anthropic and other hosted AI; image/video/TTS providers |
| CREDENTIAL REQUIRED | Email (SMTP), S3 storage, payments (future) |
| INFRASTRUCTURE REQUIRED | Public hosting, HTTPS/domain |
| TRAINING REQUIRED | Any Synora-trained model |
| NOT IMPLEMENTED | Learning pipeline, experience→dataset conversion, spend caps, voice input |

## L. Provider dependency matrix (the §30 test)

| If X disappeared | Survives? | Why |
|---|---|---|
| Anthropic | **Yes** | one descriptor among 12; resolver falls through; local planner + Ollama path remain |
| Supabase | **Yes** | not used at runtime; DB is plain Postgres via Prisma |
| GitHub | **Runtime yes** | hosting/CI only; git is distributed; CI is one YAML file |
| Any cloud host | **Yes** | Docker + Postgres dump + filesystem/S3 abstraction = portable |

No architectural traps found. The one *practical* trap is CI being
GitHub-only — acceptable, replaceable, and currently broken anyway.

## M. Model training path (honest sequence)

1. **Serve** — Anthropic (paid) and/or Ollama (free) through the existing
   resolver. No training.
2. **Record** — experience records (IK slice 3) capture request,
   interpretation, outcome, correction, consent-at-the-moment.
3. **Curate** — consent check → redaction → quality filter → dedup →
   `DatasetSample` rows → versioned dataset → JSONL export (writer exists).
4. **Teach** — provider-agnostic "teacher" annotation: eligible tasks run
   through a stronger model (initially Anthropic, never hard-coded),
   outputs evaluated before becoming examples.
5. **Tune** — PEFT/LoRA fine-tuning of a small open-source base
   (candidate class: 3–8B, permissive licence — e.g. Qwen/Llama/Mistral
   families; exact pick is its own evaluated slice, per §11 criteria) on
   rented GPU hours. **Never from scratch; never on the laptop.**
6. **Judge** — `EvaluationRun` + `BenchmarkRun` against the frozen baseline;
   behavioral-rule evaluation from the registry; regression tests.
7. **Promote or reject** — `ModelVersion` status transition, human approval
   for promotion, rollback target recorded. Serve the artifact through the
   **same Ollama adapter** (GGUF), so promotion changes configuration, not
   code.
8. **Repeat** — scheduled, versioned, reversible. Nothing modifies weights
   from production traffic; nothing promotes without evaluation (`SB-015`).

Only after step 7 does anything earn the name **Synora Model**, with dataset
provenance, evaluation results, safety results, artifact identity, rollback.

## N. Public launch blockers (MUST HAVE)

1. Spend caps + per-workspace usage limits (§18) — **top blocker**
2. Automated DB backups + restore drill
3. Domain + HTTPS (Caddy makes this trivial once a VPS exists)
4. Production config pass (CORS origins, cookie domain, secrets via env)
5. Real-model verification slice (first Anthropic key, then first Ollama run)
6. Abuse protection review at the public boundary (limiters exist; registration flow needs a look)
7. A working CI run (blocked by the GitHub outage, or move CI)

**SHOULD HAVE**: email for verification/invites; uptime alerting; error
tracking beyond logs. **CAN WAIT**: payments, object storage, multi-region,
k8s, SSO.

## O. Security blockers

No known critical holes (differential permission probes, approval gate,
scoping all tested). Gaps: `SB-013` (no-secrets-in-logs) is advisory —
needs a scanning test; dependency-audit job hasn't run since CI died;
production cookie/CORS settings unverified against a real domain.

## P. Privacy/consent blockers

Consent model exists and default-denies. Blockers for *training* only:
redaction step (§19) not built; "delete my learning contribution" not built
(GDPR erasure exists for memory, not yet for training artifacts). Nothing
blocks the Anthropic MVP: no user data is used for training today, truthfully.

## Q. Accessibility blockers

Command surface is announced and tested. Confirmed defect outstanding in
`ProposalsPanel` (silent error). Rest of app un-surveyed by a trustworthy
(rendered) method. Not a hard launch blocker for a small MVP; a real one for
enterprise sales.

## R. Observability/recovery blockers

EOS is strong in-process. Missing: externally visible uptime check, backup
automation (N.2), and a documented restore/rollback runbook for the VPS
profile.

## S. Current test/CI status

**LOCAL VERIFIED**: 2,853 backend / 265 files; 740 frontend / 107 files;
typecheck 8/8; lint 0 errors; migration history reproduces schema exactly.
**CI: NOT VERIFIED** — GitHub Actions runner-provisioning outage
(`runner_id: 0`, no machine assigned), ~50 consecutive occurrences spanning
9+ hours. No commit in this period is CI-verified. Option if it persists:
run the same pnpm gates on the VPS or locally pre-push; the CI YAML is
portable.

## T. Exact next implementation sequence (after founder approval)

1. **Spend caps + usage limits** (blocker for any paid key; local, testable)
2. **Experience record** (IK slice 3 — everything in M depends on it)
3. **Anthropic activation slice** (founder provides key → verify real
   generation end-to-end → availability flips honestly)
4. **Ollama activation slice** (founder installs Ollama + pulls one small
   model → verify local generation → `needs-model` satisfied locally)
5. **Experience → dataset conversion** with consent + redaction
6. **Rule evaluation** ("did this interaction violate a rule?")
7. **VPS launch profile** (Caddy + backups + production config) — when the
   founder wants public users
8. **Teacher annotation + first PEFT run** (rented GPU) — when data exists

Each is a small verified slice with non-vacuity checks, per standing method.
