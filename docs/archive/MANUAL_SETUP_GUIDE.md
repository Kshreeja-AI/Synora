# Manual Infrastructure Setup Guide

For issues that cannot be resolved in code and require operational configuration.

## Category C & D: Infrastructure & Deployment Requirements

### 1. Database Testing Environment (Category C)

**Issue:** 499 integration tests fail with "Can't reach database server at localhost:5432"

**Status:** Not a code defect; tests are correctly written and pass in CI

**Setup Instructions:**

```bash
# Start PostgreSQL locally for testing
docker-compose -f docker-compose.dev.yml up -d postgres

# Wait for PostgreSQL to be ready
sleep 5

# Run migrations
pnpm run db:migrate

# Run tests
pnpm run test
```

**Verification:** Tests should pass once PostgreSQL is running

---

### 2. Database Rollback Procedure (Category D)

**Issue:** No documented SOP for production database rollback

**Fix:** Prisma Migrate handles rollbacks via:

```bash
# List applied migrations
pnpm exec prisma migrate status

# Rollback last migration
pnpm exec prisma migrate resolve --rolled-back <migration_name>

# Example:
pnpm exec prisma migrate resolve --rolled-back 002_release_3_schema

# Verify rollback
pnpm exec prisma migrate status
```

**Connection String Required:**
```bash
export DATABASE_URL=postgresql://user:pass@host:5432/synora
```

---

### 3. Backup & Restore Procedures (Category D)

**Backup:**
```bash
# Full database backup
pg_dump -h localhost -U synora synora > backup-$(date +%Y%m%d-%H%M%S).sql

# Compressed backup (recommended)
pg_dump -h localhost -U synora synora | gzip > backup-$(date +%Y%m%d-%H%M%S).sql.gz
```

**Restore:**
```bash
# From uncompressed backup
psql -h localhost -U synora synora < backup.sql

# From compressed backup
gunzip -c backup.sql.gz | psql -h localhost -U synora synora
```

**Verification:**
```bash
psql -h localhost -U synora synora -c "SELECT COUNT(*) FROM conversations;"
```

---

### 4. Sentry Observability Setup (Category D)

**Currently:** Sentry integration is stubbed (intentional for Release 3)

**To Enable in Production:**

```bash
# 1. Create Sentry project at https://sentry.io/

# 2. Obtain DSN from project settings

# 3. Set environment variables:
export SENTRY_DSN=https://abc123@o456789.ingest.sentry.io/789012
export SENTRY_ENVIRONMENT=production
export SENTRY_RELEASE=$(git describe --tags --always)

# 4. Uncomment Sentry initialization in src/monitoring/sentry.ts
# Replace initializeSentry() stub with:
# Sentry.init({
#   dsn: appConfig.sentry.dsn,
#   environment: appConfig.stage,
#   release: process.env.SENTRY_RELEASE,
#   tracesSampleRate: 0.1,
# });

# 5. Redeploy
```

---

### 5. GDPR Data Retention (Category D)

**Policy Implementation:**

```bash
# 1. Define retention periods in config:
GDPR_RETENTION_DAYS=90  # Soft-delete grace period
GDPR_HARD_DELETE_DAYS=90  # After this, permanently delete

# 2. Create scheduled cleanup job:
pnpm exec ts-node scripts/gdpr-cleanup.ts

# 3. Audit log queries that were soft-deleted:
SELECT * FROM "Conversation"
WHERE "isDeleted" = true
  AND "deletedAt" < NOW() - INTERVAL '90 days';
```

---

### 6. CSP Headers Environment Setup (Category C - DevOps)

**Note:** CSP implementation will be committed to code (see REPOSITORY_REMEDIATION_REPORT.md)

**Production Deployment Checklist:**
- [ ] CSP directives tested in staging with `Content-Security-Policy-Report-Only` header first
- [ ] Report-only violations collected for 24 hours
- [ ] Exceptions whitelisted (fonts, CDNs, analytics)
- [ ] Switch to enforced `Content-Security-Policy` header
- [ ] Monitor error logs for CSP violations
- [ ] Test file uploads (form-data submission)
- [ ] Test image rendering
- [ ] Test script execution

---

### 7. Redis Setup for Future Workers (Category D)

**Currently:** Intentionally deferred to M3+ roadmap

**When Needed (M3+):**

```bash
# Start Redis
docker run -d -p 6379:6379 redis:7-alpine

# Set environment variable
export REDIS_URL=redis://localhost:6379

# Test connection
redis-cli ping  # Should respond with PONG

# Verify queue consumer
pnpm run worker
```

---

### 8. Elasticsearch Setup for Search (Category D)

**Currently:** Search services implemented; route wiring pending (see code fixes)

**When Needed (M3+):**

```bash
# Start Elasticsearch
docker run -d \
  -e discovery.type=single-node \
  -e xpack.security.enabled=false \
  -p 9200:9200 \
  docker.elastic.co/elasticsearch/elasticsearch:8.11.0

# Set environment variable
export ELASTICSEARCH_URL=http://localhost:9200

# Create index
curl -X PUT "localhost:9200/conversations"

# Verify
curl "localhost:9200/_cat/indices"
```

---

### 9. Vector Database Setup (Category D)

**Currently:** pgvector provider implemented and production-ready

**To Enable:**

```bash
# Already included in PostgreSQL schema
# pgvector extension auto-created in migrations

# Verify installation
psql -h localhost -U synora synora -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Test vector operations
psql -h localhost -U synora synora -c "SELECT vector_support();"
```

---

## Verification Checklist

- [ ] PostgreSQL running and migrations applied
- [ ] `pnpm test` passes locally
- [ ] Docker image builds and starts
- [ ] Gitleaks scan passes
- [ ] Lint and typecheck pass
- [ ] Build succeeds
- [ ] All endpoints accessible via curl/Postman
- [ ] CI pipeline green

---

## Rollout Timeline

**Phase 1 (T+0h):** Code fixes deployed (CSP, MFA, conversation API)
**Phase 2 (T+2h):** Database backup tested
**Phase 3 (T+4h):** Sentry configured in staging
**Phase 4 (T+8h):** Full production verification
**Phase 5 (T+24h):** M3+ infrastructure (Redis, Elasticsearch) prepared for staging

---

## Support & Debugging

- Database connectivity: `psql $DATABASE_URL -c "SELECT version();"`
- Redis connectivity: `redis-cli -u $REDIS_URL ping`
- Elasticsearch: `curl $ELASTICSEARCH_URL/_cluster/health`
- Logs: `docker logs <container_id>`
- Migrations status: `pnpm exec prisma migrate status`
