# Synora — Production Launch Runbook

**Audience**: a non-technical founder executing a first public launch, with
Claude Code doing every technical step. **Scope**: the ~10,000
registered-user topology (which is NOT 10,000 simultaneous AI generations —
capacity math must use concurrent requests, not registrations).

**Status honesty**: items marked ☐ are not done. Nothing here claims
readiness that has not been verified. CI has not validated any recent
commit (GitHub runner outage); LOCAL VERIFIED ≠ CI VERIFIED.

---

## 1. Topology (minimum sustainable cost)

```
Users → HTTPS (Caddy/platform TLS)
  → Next.js frontend (Vercel free tier, or same VPS)
  → Express backend + workers (one small VPS or PaaS container, ~$4–6/mo)
      → managed/VPS PostgreSQL (pgvector required)
      → Redis (same VPS or Upstash free tier)
      → filesystem storage now → S3-compatible when needed
      → AI: provider abstraction → any configured provider
          → remote GPU box (Ollama behind token+TLS proxy) and/or
            Groq free tier and/or Anthropic (prepaid, AFTER caps)
```

Portable by construction: plain Docker, plain Postgres, Redis-protocol,
S3-compatible, OpenAI-compatible AI endpoints. No host-specific code.

## 2. Environment contract (canonical: `apps/backend/.env.example`)

| Variable | Class | Notes |
|---|---|---|
| `DATABASE_URL` | REQUIRED_PRODUCTION · DATABASE · SECRET | pgvector-capable Postgres |
| `JWT_SECRET`, `NEXTAUTH_SECRET` | REQUIRED_PRODUCTION · AUTH · SECRET | fresh, generated; never dev values |
| `REDIS_URL` | REQUIRED_PRODUCTION · CACHE · SECRET | BullMQ + pub/sub + cache |
| `NODE_ENV=production`, `PORT` | REQUIRED_PRODUCTION · DEPLOYMENT | |
| `CORS_ORIGINS`, `FRONTEND_URL`, `BACKEND_URL` | REQUIRED_PRODUCTION · DEPLOYMENT · PUBLIC | all three default to `http://localhost:300x` and production does NOT override them. Unset, the site's browser requests and realtime connections are rejected, every reset/verification/invitation email links to the recipient's own machine, and uploaded files resolve to an unreachable address — with the server reporting itself perfectly healthy. Now BOOT-ENFORCED: staging/production refuse to start when these are still loopback (config/productionGates.ts) |
| `AI_GLOBAL_MAX_COST_PER_DAY_CENTS`, `AI_GLOBAL_MAX_TOKENS_PER_DAY` | REQUIRED_PRODUCTION · AI_PROVIDER | the kill switch; set BEFORE any paid key — now BOOT-ENFORCED: staging/production refuse to start with a real metered key and no cap (config/productionGates.ts) |
| `TOOL_SECRET_MASTER_KEY` | REQUIRED_PRODUCTION · SECURITY · SECRET | AES-256-GCM master key for stored tool secrets; min 32 chars, boot-validated |
| `OLLAMA_BASE_URL`, `OLLAMA_API_KEY`, `OLLAMA_MODEL`, `OLLAMA_MODELS` | OPTIONAL_PRODUCTION · AI_PROVIDER | remote GPU box; API_KEY is SECRET |
| `SELF_HOSTED_TEXT_BASE_URL/_API_KEY/_MODEL/_MODELS` | OPTIONAL_PRODUCTION · AI_PROVIDER | vLLM/TGI seam; swap runtimes with env only |
| `EMBEDDING_OLLAMA_BASE_URL/_API_KEY/_MODEL` | OPTIONAL_PRODUCTION · AI_PROVIDER | local embeddings |
| `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`, … | OPTIONAL_PRODUCTION · AI_PROVIDER · SECRET | every provider optional, none architectural |
| `AI_PROVIDER` | OPTIONAL_PRODUCTION | explicit provider pin; omit for auto-detect |
| `SMTP_*`, `MAIL_*` | OPTIONAL_PRODUCTION · EMAIL | console transport until set |
| `STORAGE_*` (S3) | OPTIONAL_PRODUCTION · STORAGE · SECRET | filesystem until multi-instance |
| `AI_RATE_LIMIT_*` | OBSERVABILITY/limits | redis backend required multi-instance |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | OPTIONAL until billing ships · SECRET | billing resolver degrades honestly without them; become REQUIRED_PRODUCTION when payments launch |
| `DATABASE_URL` (localhost), test JWT | DEVELOPMENT_ONLY / TEST_ONLY | never production |

Rules: secrets only via environment/secret manager; never in git, logs, or
`NEXT_PUBLIC_*`; `.env.example` holds placeholders only.

Boot gates (enforced, with tests): staging/production refuse to start when
a required secret is missing, is a known dev value copied from this
repository, is an unfilled `<template>`, or is shorter than its minimum
(secrets/registry.ts + validateRequired); when a real metered AI key
resolves with no global spend cap; and when `CORS_ORIGINS`, `FRONTEND_URL`
or `BACKEND_URL` is still pointing at loopback (both
config/productionGates.ts). A localhost entry ALONGSIDE the real domain in
`CORS_ORIGINS` is allowed — pointing a local frontend at staging is
deliberate; only having nothing but localhost is the unset default.

## 3. FOUNDER ACTIONS (everything only you can do)

1. ☐ **Local test database** (unblocks the deferred DB test set now):
   EITHER install Docker Desktop (free) — Claude Code does the rest — OR
   put the Supabase DB password into `apps/backend/.env.local` yourself
   (Supabase dashboard → Settings → Database). Never paste it in chat.
2. ☐ **GPU box** (when you rent it): create the account (RunPod/Vast/
   Lambda class), start one 24–48 GB VRAM instance, run the setup script
   Claude Code will provide (installs Ollama + Caddy token proxy + pulls
   the chosen models), then put `OLLAMA_BASE_URL` + `OLLAMA_API_KEY` into
   the environment. ~$0.20–0.80/hr, stop when idle.
3. ☐ **Optional free hosted AI**: create a Groq account, put
   `GROQ_API_KEY` into the environment.
4. ☐ **Anthropic (optional)**: buy PREPAID credits, put
   `ANTHROPIC_API_KEY` into the environment — ONLY after confirming the
   global spend caps are set (§2).
5. ☐ **Public hosting**: VPS or PaaS account + payment (~$4–6/mo);
   domain (~$10–12/yr); DNS records (Claude Code will name them exactly
   when the host exists).
6. ☐ **Production secrets**: approve generation of fresh `JWT_SECRET`/
   `NEXTAUTH_SECRET` into the host's secret store.
7. ☐ **GitHub email-privacy decision** (current push blocker — see
   session report).

## 4. AUTOMATED ACTIONS (Claude Code, no founder input)

Build/typecheck/lint/tests; migrations (`prisma migrate deploy`); Docker
image; Caddy + proxy configs; health/readiness wiring (probes already
registered); spend-cap configuration; smoke tests below; backup script
(`pg_dump` nightly + restore drill); deployment and rollback (previous
image + `prisma migrate resolve`); documentation sync.

## 5. Launch gate (all must pass; mocks prove wiring, never provider availability)

Build ✚ typecheck ✚ lint ✚ unit ✚ integration (DB set included — currently
☐ DEFERRED, blocked on Founder Action 1) ✚ migration validation on a
production-shaped DB ✚ auth smoke (register/login/refresh/reset) ✚ AI
generation smoke against the REAL configured endpoint ✚ streaming smoke
(incl. cancel) ✚ storage smoke ✚ health probes green ✚ rate-limit 429 ✚
spend-cap 429 with honest message ✚ provider-failure fallback ✚ env
validation (fail closed on missing REQUIRED_PRODUCTION).

## 6. 10,000-user capacity notes (assumptions stated, not proven)

Stateless API + BullMQ workers scale horizontally; file-backed KeyedStores
(schedules/workflows/plugins) require SINGLE-instance-with-volume until
DB-backed — a known, documented ceiling; Postgres pooling via pgbouncer
when >~50 connections; per-user rate limiters are per-process (memory
store) — acceptable single-instance, Redis store before multi-instance;
AI concurrency is bounded by spend caps + outbound limiter + queue
backpressure, not by registrations.

## 7. Known security gaps (tracked, honest)

- `SB-013` (no secrets in logs) is advisory — no scanning test yet.
- Malware-scanning seam for uploads: interface only, no scanner wired.
- ~~Dependency audit not run since CI outage began~~ — run locally
  2026-08-07: `pnpm audit` clean; the seven security override floors were
  silently inactive under pnpm 10 (wrong manifest location) and are
  re-activated in pnpm-workspace.yaml.
- CSRF/cookie/CORS values need a real-domain pass at deploy time.
