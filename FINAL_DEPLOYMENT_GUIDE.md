# Synora Production Deployment Guide

**Date**: 2026-07-28
**Commit**: `36d25ce`
**Audience**: Engineer performing a production deployment with no prior context

---

## Before you begin

Read `FINAL_AUDIT.md` first. It documents a launch blocker: **Release 3 has no frontend**. If you are deploying to serve users a chat product, stop — the chat interface does not exist. This guide describes how to deploy what is built (Releases 1–2: auth, workspaces, projects, folders, assets, billing).

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 20 LTS or newer | Runtime for both apps |
| pnpm | 10+ | `corepack enable` picks up the pinned version from root `package.json` |
| PostgreSQL | 16+ | Managed instance strongly preferred |
| Docker | 24+ | Only if deploying containers |
| TLS certificate | — | Required; HTTPS is enforced in production |

---

## Step 1 — Provision the database

Create a PostgreSQL 16 database and a dedicated role. Do not use a superuser for the application.

```sql
CREATE DATABASE synora;
CREATE USER synora_app WITH PASSWORD '<generated>';
GRANT ALL PRIVILEGES ON DATABASE synora TO synora_app;
```

Require TLS on the connection. Your `DATABASE_URL` should end with `?sslmode=require`.

**Take a snapshot before proceeding.** Migrations are not automatically reversible.

---

## Step 2 — Configure environment

Every variable is documented in `FINAL_ENVIRONMENT_VARIABLES.md`, including types, defaults, and rotation impact. Generate fresh secrets:

```bash
openssl rand -base64 32   # JWT_SECRET
openssl rand -base64 32   # NEXTAUTH_SECRET
```

Minimum viable production set:

```bash
# Backend
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://synora_app:<pass>@<host>:5432/synora?sslmode=require
JWT_SECRET=<generated>
CORS_ORIGINS=https://app.yourdomain.com
FORCE_HTTPS=true
ANTHROPIC_API_KEY=<key>          # at least one provider required
MAIL_BACKEND=smtp                 # console silently discards mail
SMTP_HOST=<host>
SMTP_USER=<user>
SMTP_PASSWORD=<pass>
MAIL_FROM=noreply@yourdomain.com
STORAGE_BACKEND=s3                # local storage does not survive restarts
S3_BUCKET=<bucket>
S3_REGION=<region>
S3_ACCESS_KEY_ID=<key>
S3_SECRET_ACCESS_KEY=<secret>
LOG_FORMAT=json

# Web
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXTAUTH_SECRET=<generated>
NEXTAUTH_URL=https://app.yourdomain.com
```

**Verify before continuing**: no secret appears in a `NEXT_PUBLIC_*` variable, `CORS_ORIGINS` contains no wildcard and no localhost, and `AI_DEV_RUNTIME` is unset.

The application validates all configuration with a Zod schema at startup and **refuses to boot** on anything invalid. A boot failure here is the config system working correctly — read the error, it names the offending variable.

---

## Step 3 — Install and build

```bash
pnpm install --frozen-lockfile
pnpm run db:generate
pnpm run build
```

`--frozen-lockfile` ensures the deployed dependency tree matches the lockfile exactly. If it fails, the lockfile is out of date — fix that before deploying, do not drop the flag.

---

## Step 4 — Run migrations

```bash
pnpm run db:migrate
```

This applies all 12 migrations in order. Expected output ends with every migration marked applied.

### If a migration fails

Prisma marks the migration as failed and **blocks all subsequent migrations** (error P3009). This is a safety mechanism, not a bug.

```bash
# Inspect what happened
pnpm --filter @synora/database exec prisma migrate status

# After fixing the underlying cause, mark it resolved
pnpm --filter @synora/database exec prisma migrate resolve --rolled-back <migration_name>
```

Do not delete rows from `_prisma_migrations` to force progress. Restore from the snapshot taken in Step 1 and investigate.

---

## Step 5 — Verify before exposing traffic

```bash
pnpm run type-check    # expect: 8/8 packages, 0 errors
pnpm run lint          # expect: 0 errors
pnpm run test          # expect: all suites pass
pnpm audit --prod      # expect: No known vulnerabilities found
```

`pnpm audit` without `--prod` reports 8 dev-only findings. These are in vitest/vite/esbuild and never ship. See `FINAL_SECURITY_AUDIT.md`.

---

## Step 6 — Start

```bash
# Backend
node apps/backend/dist/index.js

# Web
pnpm --filter @synora/web start
```

Under a process manager, ensure both restart on failure and that the backend starts before the web app.

---

## Step 7 — Smoke test

Do not consider the deployment complete until each of these passes against the production URL:

```bash
# 1. Backend is up
curl -f https://api.yourdomain.com/health

# 2. Frontend serves
curl -f https://app.yourdomain.com/

# 3. Registration works end to end
#    → register a test account in a browser
#    → confirm the verification email arrives (if MAIL_BACKEND=smtp, it must actually arrive)
#    → verify, then log in

# 4. Workspace creation works
#    → create a workspace, confirm it appears in the switcher

# 5. Asset upload works
#    → upload a file, confirm it round-trips from S3

# 6. HTTPS is enforced
curl -I http://api.yourdomain.com/health    # expect a redirect to https
```

If step 3's email does not arrive, `MAIL_BACKEND` is still `console` — mail is being silently discarded.

---

## Rollback

| Scenario | Action |
|----------|--------|
| Application fails to boot | Read the config validation error; it names the variable. Fix and restart. |
| Application boots, behaves incorrectly | Redeploy the previous build artifact. No database change needed if no migration ran. |
| Migration applied, must revert | Restore the Step 1 snapshot. Prisma migrations are not auto-reversible. |
| Secrets compromised | Rotate per the table in `FINAL_ENVIRONMENT_VARIABLES.md`. Rotating `JWT_SECRET` logs out every user. |

**Rollback is only safe if you took the snapshot.** Take it.

---

## Docker

`infrastructure/docker/` currently contains only `docker-compose.secrets.example.yml`. The CI `docker` job builds successfully, so Dockerfiles exist in the repository, but a complete production compose stack is not checked in.

For local development:

```bash
docker-compose -f docker-compose.dev.yml up -d postgres
```

The dev compose file also provisions Redis. **Redis is not consumed by any application code** — it is provisioned ahead of Release 4. Starting postgres alone is sufficient.

`infrastructure/k8s/` is present but empty, correctly scoped to Release 4.

---

## CI/CD

`.github/workflows/ci.yml` runs three jobs on every PR: `test`, `security`, `docker`. All three must pass before merge.

**There is no deployment job.** Deployment is manual, following this guide.

### Known CI gaps

1. **Node 20 deprecation** — `actions/checkout@v4`, `actions/setup-node@v4`, and `pnpm/action-setup@v4` target Node 20, which GitHub is removing. Upgrade before the runners drop support.
2. **No migration drift check** — nothing verifies that `schema.prisma` and the migration SQL agree. This gap allowed 9 schema defects to reach CI during the pre-launch audit (see `FINAL_AUDIT.md`). Add:
   ```yaml
   - run: pnpm --filter @synora/database exec prisma migrate diff \
           --from-migrations ./prisma/migrations \
           --to-schema-datamodel ./prisma/schema.prisma \
           --shadow-database-url $SHADOW_DATABASE_URL \
           --exit-code
   ```

---

## Post-deployment

- [ ] Snapshot taken before migration, and retention confirmed
- [ ] Every smoke test in Step 6 passed
- [ ] Log aggregation is receiving JSON logs from the backend
- [ ] TLS certificate expiry is monitored
- [ ] Database backup schedule is active (automated backups are Release 4 scope — until then, verify your provider's defaults)
- [ ] `CORS_ORIGINS` verified to contain only production origins
- [ ] Test account created during smoke testing has been removed

---

## Deferred to Release 4

Automated backups, point-in-time recovery, Kubernetes manifests, Redis caching, distributed tracing, and Prometheus metrics are specified in `RELEASE_4_PLAN.md` and are not part of this deployment. Until they land, rely on your database provider's managed backups and confirm their retention policy explicitly.
