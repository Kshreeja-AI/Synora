# Synora — Production Deployment

The whole path, start to finish. Every step is a command Claude Code can
run for you except the four marked **FOUNDER ACTION**, which need an
account, a payment, or DNS you own.

**Target**: one VPS, ~$5/month, HTTPS, automatic TLS renewal, nightly
backups. Portable by construction — plain Docker, plain Postgres, plain
Redis — so moving to a bigger host later is a config change.

---

## 0. What you need first

1. **FOUNDER ACTION** — a VPS (any provider; 2GB RAM minimum, 4GB
   comfortable). You get an IP address and SSH access.
2. **FOUNDER ACTION** — a domain. Point an `A` record at that IP.
   TLS needs nothing else: Caddy provisions the certificate itself.

Nothing else is required to go live. AI providers, email and payments are
all optional and can be added later without redeploying.

---

## 1. Prepare the environment file

```bash
cp .env.production.example .env.production
```

Claude Code fills the generated secrets (`POSTGRES_PASSWORD`, `JWT_SECRET`,
`NEXTAUTH_SECRET`, `TOOL_SECRET_MASTER_KEY`) with fresh random values, and
sets `SYNORA_DOMAIN`, `CORS_ORIGINS`, `BACKEND_URL`, `FRONTEND_URL` to your
domain. `.env.production` is git-ignored and must never be committed.

**The AI spend caps are not optional.** `AI_GLOBAL_MAX_COST_PER_DAY_CENTS`
and `AI_GLOBAL_MAX_TOKENS_PER_DAY` are pre-filled with conservative values.
Staging and production **refuse to boot** when a real metered AI key is
configured and no global cap is set — that gate is enforced in
`config/productionGates.ts`, not merely documented.

## 2. Bring the stack up

```bash
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build
```

Starts Caddy (TLS), the app, Postgres (pgvector), Redis, and the nightly
backup sidecar. Only Caddy binds a public port; Postgres and Redis are
reachable only from inside the compose network.

## 3. Migrate

```bash
docker compose -f docker-compose.production.yml --env-file .env.production \
  exec app npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
```

Migrations are **forward-only and never destructive**. Run them before
serving traffic on a new release.

## 4. Verify

```bash
curl -fsS https://<your-domain>/health   # liveness — process is up
curl -fsS https://<your-domain>/ready    # readiness — database reachable
```

`/ready` returns 503 until the database answers, so a load balancer will
not route to a broken instance.

## 5. Confirm TLS

Caddy obtains a Let's Encrypt certificate on first request. If it fails,
the cause is almost always DNS: confirm the `A` record resolves to this
box, then `docker compose logs caddy`.

---

## Deploying an update

```bash
git pull
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build
docker compose -f docker-compose.production.yml --env-file .env.production \
  exec app npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
curl -fsS https://<your-domain>/ready
```

## Rolling back

Application code:

```bash
git checkout <previous-good-commit>
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build
```

**Rolling back code is safe. Rolling back the database is not** — a
migration applied under the new release may have added columns the old one
does not know about, which is harmless, but a *reverted* migration can drop
data. Never `migrate resolve --rolled-back` on production without a restore
point. Restore from a dump instead:

```bash
docker compose -f docker-compose.production.yml --env-file .env.production \
  exec -T postgres pg_restore -U synora -d synora --clean /backups/<dump-file>
```

## Backups

The `backup` service writes a compressed `pg_dump` to `./backups` daily and
keeps 14 days. **A backup you have never restored is not a backup** — do a
restore drill into a scratch database before you have real users.

Copy `./backups` off the box periodically. A backup on the same disk as the
database survives a mistake, not a disk failure.

## Logs

```bash
docker compose -f docker-compose.production.yml logs -f app
```

Structured JSON. Secrets are never logged; secret *reads* are audited by
key name only.
