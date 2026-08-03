# Synora AI - Deployment Guide

This document covers what Release 1 actually supports today. For the
complete, copy-pasteable command sequence, see `PROJECT_HANDOVER.md` §6
and `docs/archive/RELEASE_1_LAUNCH_READINESS.md` — this document explains the *why*
behind those commands and the platform choices around them.

## What Release 1 deploys

A single Docker image (backend API only — see `Dockerfile` at the repo
root) against a managed PostgreSQL instance. There is no automated CD
pipeline yet (Release 2, R2-e): every deploy today is the manual sequence
below, run by hand or wrapped in whatever the operator's platform of
choice provides.

## Environment Setup

### 1. Environment Variables

Copy `.env.example` — don't hand-write this list, it drifts. The
authoritative, currently-accurate reference for what's required vs.
optional (with defaults) is `docs/archive/RELEASE_1_LAUNCH_READINESS.md` §2. Minimum
required to boot in production: `DATABASE_URL`, `JWT_SECRET`,
`NEXTAUTH_SECRET`. At least one AI provider key (e.g.
`ANTHROPIC_API_KEY`) is needed for real AI generation, though the app
boots and serves auth/CRUD routes without one.

### 2. Database

**Use a managed Postgres provider** (AWS RDS, Neon, Supabase, Railway,
etc.) with automated backups and point-in-time recovery enabled. This is
a deliberate Release 1 choice, not a placeholder: owning an in-app backup
job is Release 2 scope (R2-g); until then, the provider's backup/PITR
*is* the backup strategy, and choosing one that has it is a real
production checklist requirement.

Once you have a `DATABASE_URL`, run migrations before starting the app:

```bash
DATABASE_URL="postgresql://..." pnpm --filter @synora/database db:migrate
```

`db:migrate` runs `prisma migrate deploy` — safe to run on every deploy,
including when there's nothing pending.

## Docker Deployment

The real `Dockerfile` (repo root) is multi-stage, `node:22-bookworm-slim`
based (not Alpine — the `argon2` native addon and Prisma's query engine
are both smoother on glibc), installs OpenSSL explicitly in both stages
(bookworm-slim ships none by default, and Prisma's query engine needs it
to load — see `docs/archive/RELEASE_1_VERIFICATION_REPORT.md` Issue 7 for the full
story of why this is required), and runs as the base image's non-root
`node` user.

```bash
# Build
docker build -t synora-backend:latest -f Dockerfile .

# Run
docker run -d --name synora-backend \
  -e NODE_ENV=production -e APP_STAGE=production -e PORT=3001 \
  -e DATABASE_URL="<prod-db-url>" \
  -e JWT_SECRET="<generated>" -e NEXTAUTH_SECRET="<generated>" \
  -e ANTHROPIC_API_KEY="<real-key>" \
  -p 3001:3001 synora-backend:latest

# Verify
curl -f http://<host>:3001/health   # liveness — no DB check
curl -f http://<host>:3001/ready    # readiness — probes the database
```

The image bakes a `HEALTHCHECK` hitting `/health`; use `/ready` for your
orchestrator's own readiness gating if it has one.

**Not implemented**: Kubernetes manifests (`infrastructure/k8s/` exists
but is unused and untested — explicitly Release 4/hyperscale scope),
blue-green or canary rollout, auto-rollback on health-check failure. Any
of these you build today would be new infrastructure work, not a
configuration of something already there.

## Hosting the frontend

`apps/web` is a standard Next.js 15 app — deploy it wherever you'd deploy
any Next.js app (Vercel is the path of least resistance; a Node server or
static export are also options depending on what the app actually needs
once its state-management gap, see `PROJECT_HANDOVER.md` §11, is closed).
There is no Synora-specific frontend deployment tooling to document yet.

## CI/CD Pipeline

`.github/workflows/ci.yml` runs three jobs on every push — `test`,
`security`, `docker` — all currently green. Full detail:
`PROJECT_HANDOVER.md` §8. **This is CI, not CD**: nothing in this
workflow deploys anywhere. There is no `deploy.yml` or equivalent. Adding
automated deployment (tag → staging → production, with rehearsed
rollback) is Release 2 scope (R2-e) — don't assume a push to `main` or a
tag triggers any real-world deployment today.

## Monitoring & Logging

Winston, console-only in production (a container's filesystem is
ephemeral — file logs there would just be lost on restart). No
centralized log aggregation, no error-tracking service (Sentry or
similar), no `/metrics` endpoint, and no alerting exist yet — all
Release 2 scope (R2-f). Rely on your platform's own log capture
(`docker logs`, or whatever your hosting provider aggregates) until then.

## Rollback

There is no automated rollback today. To roll back manually: redeploy the
previous known-good Docker image tag (build images with a tag you can
reference later, e.g. the git SHA), and if the rollback needs to undo a
database migration, write and apply a new down-migration by hand — Prisma
does not auto-generate reverse migrations.

## Scaling

Release 1 is single-instance by design (see `docs/architecture.md`'s
Scaling Strategy section) — login lockout and rate-limit state are
DB-backed, correct for one instance, not yet correct for more than one.
Horizontal scaling behind a load balancer becomes viable once Redis-backed
shared state lands (Release 2, R2-c) — don't attempt to run multiple
instances of the current codebase behind a load balancer and expect
lockout/rate-limiting to behave correctly.

## Troubleshooting

### Database connection issues
```bash
psql -h host -U user -d synora -c "SELECT 1"
```
Or hit `/ready` — its response includes the actual database probe
latency and error, if any, which is usually more informative than a raw
`psql` failure.

### Container won't become healthy
Check `docker logs <container>` first. Two real, non-obvious causes this
project has hit before (see `docs/archive/RELEASE_1_VERIFICATION_REPORT.md` for the
full history): the app failing to bind reachably inside the container,
and Prisma's query engine failing to load due to a missing system
library. Both are fixed in the current `Dockerfile`/`index.ts` — if you
see either symptom again after a dependency bump, that history is the
first place to look.

---

**Last Updated**: 2026-07-23 (Release 1)
