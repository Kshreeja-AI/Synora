# Production Deployment Guide

**Date:** 2026-07-28  
**Release:** 3 Enterprise Hardening  
**Target:** Production environment

---

## Pre-Deployment Checklist

### Infrastructure Requirements
- [x] PostgreSQL 16+ server running (not included — deploy separately)
- [x] Redis 7+ (future, not required for M1-M7)
- [x] S3-compatible object storage (local or AWS S3)
- [x] DNS configured
- [x] SSL certificate ready (wildcard or specific domains)
- [x] Kubernetes cluster OR Docker host

### Configuration Files
Before deployment, prepare these environment-specific configurations:

**Backend Environment (`.env.production`)**
```bash
NODE_ENV=production
STAGE=production
PORT=3001

# Database
DATABASE_URL=postgresql://user:pass@db-host:5432/synora?sslmode=require

# Secrets
JWT_SECRET=<32+ bytes base64>
NEXTAUTH_SECRET=<32+ bytes base64>

# Security
CORS_ORIGINS=https://synora.com,https://app.synora.com
SECURE_COOKIES=true

# Logging
LOG_LEVEL=warn

# Email
MAIL_TRANSPORT=smtp
MAIL_SMTP_HOST=smtp.sendgrid.net
MAIL_SMTP_PORT=587
MAIL_SMTP_USER=apikey
MAIL_SMTP_PASS=<SendGrid API key>

# Storage
STORAGE_PROVIDER=s3
S3_REGION=us-east-1
S3_BUCKET=synora-prod-uploads
S3_ACCESS_KEY_ID=<AWS access key>
S3_SECRET_ACCESS_KEY=<AWS secret key>

# AI Providers
ANTHROPIC_API_KEY=<your key>
OPENAI_API_KEY=<your key>
```

**Frontend Environment (`.env.production.local`)**
```bash
NEXT_PUBLIC_API_URL=https://api.synora.com
NEXTAUTH_URL=https://app.synora.com
NEXTAUTH_SECRET=<same as backend>
```

---

## Deployment Options

### Option 1: Docker Compose (Simple, Single Instance)

**1. Build Docker Image**
```bash
docker build -t synora/backend:latest -f Dockerfile.backend .
docker build -t synora/web:latest -f Dockerfile.web .
```

**2. Docker Compose File**
```yaml
version: '3.9'
services:
  backend:
    image: synora/backend:latest
    ports:
      - "3001:3001"
    env_file: .env.production
    depends_on:
      - postgres
    healthcheck:
      test: curl -f http://localhost:3001/health
      interval: 30s
      timeout: 10s
      retries: 3

  web:
    image: synora/web:latest
    ports:
      - "3000:3000"
    environment:
      NEXT_PUBLIC_API_URL: http://backend:3001
    depends_on:
      - backend

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: synora
      POSTGRES_PASSWORD: <production password>
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

**3. Deploy**
```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Option 2: Kubernetes (Recommended for Scale)

**1. Create namespace**
```bash
kubectl create namespace synora
```

**2. Create secrets**
```bash
kubectl create secret generic backend-secrets \
  --from-literal=DATABASE_URL=$DATABASE_URL \
  --from-literal=JWT_SECRET=$JWT_SECRET \
  -n synora

kubectl create secret generic s3-credentials \
  --from-literal=AWS_ACCESS_KEY_ID=$KEY \
  --from-literal=AWS_SECRET_ACCESS_KEY=$SECRET \
  -n synora
```

**3. Deploy backend**
```bash
kubectl apply -f infrastructure/k8s/backend-deployment.yaml -n synora
kubectl apply -f infrastructure/k8s/backend-service.yaml -n synora
```

**4. Deploy frontend**
```bash
kubectl apply -f infrastructure/k8s/web-deployment.yaml -n synora
kubectl apply -f infrastructure/k8s/web-service.yaml -n synora
```

**5. Verify deployment**
```bash
kubectl get pods -n synora
kubectl logs -f deployment/synora-backend -n synora
```

---

## Database Migration

**Before deploying code that requires schema changes:**

```bash
# 1. Backup current database
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# 2. Test migration locally
DATABASE_URL=$DEV_DATABASE_URL pnpm run db:migrate:dev

# 3. Deploy and run in production
pnpm run db:migrate

# 4. Verify
psql $DATABASE_URL -c "SELECT version FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1;"
```

---

## Deployment Verification

### Health Check
```bash
# Liveness probe
curl http://api.synora.com/health
# Expected: { "status": "ok" }

# Readiness probe
curl http://api.synora.com/ready
# Expected: { "status": "ready", "db": true }
```

### Smoke Test
```bash
# Create workspace
curl -X POST http://api.synora.com/api/workspaces \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test"}'

# Expected: 201 with workspace ID
```

### Log Verification
```bash
# Check for errors
kubectl logs -f deployment/synora-backend -n synora | grep -i error

# Check startup
kubectl logs deployment/synora-backend -n synora | head -20
# Expected: Server listening on port 3001
```

---

## Post-Deployment Configuration

### Monitoring Setup (Recommended)

**1. Datadog Integration**
```bash
# Add Datadog agent
kubectl apply -f infrastructure/k8s/datadog-agent.yaml -n synora

# Configure dashboards
# See: docs/monitoring/datadog-setup.md
```

**2. Alerting**
```bash
# Email: Set up alert recipients
# Slack: Add Datadog bot to channels
# PagerDuty: Create integration for P1 alerts
```

### Backup Strategy

**1. Database Backups**
```bash
# Automated daily snapshots
# AWS: Enable RDS automated backups (retention: 30 days)
# Self-hosted: pg_dump daily + S3 upload
```

**2. File Storage Backups**
```bash
# S3: Enable versioning
# S3: Enable cross-region replication (optional)
```

### SSL/TLS Setup

**1. Obtain Certificate**
```bash
# Via Let's Encrypt + Certbot
certbot certonly --dns-route53 -d synora.com -d api.synora.com -d app.synora.com
```

**2. Configure Nginx/ALB**
```nginx
server {
  listen 443 ssl;
  server_name api.synora.com;
  
  ssl_certificate /path/to/cert.pem;
  ssl_certificate_key /path/to/key.pem;
  
  location / {
    proxy_pass http://synora-backend:3001;
    proxy_set_header Host $host;
  }
}
```

---

## Rollback Procedure

**If critical issue detected:**

### Option 1: Quick Rollback (Same Infrastructure)
```bash
# 1. Revert image to previous version
kubectl set image deployment/synora-backend \
  synora-backend=synora/backend:$PREVIOUS_VERSION -n synora

# 2. Verify
kubectl rollout status deployment/synora-backend -n synora

# 3. Check logs
kubectl logs -f deployment/synora-backend -n synora
```

### Option 2: Full Rollback (Different Cluster)
```bash
# 1. Deploy previous version to standby cluster
docker-compose -f docker-compose.prod.yml up

# 2. Update DNS to new cluster
# Route 53 / DNS provider: Update A record

# 3. Verify traffic
curl https://api.synora.com/health
```

---

## Scaling Strategy

### Horizontal Scaling (More Instances)
```bash
# Increase replicas
kubectl scale deployment synora-backend \
  --replicas=5 -n synora

# Verify
kubectl get pods -n synora | grep synora-backend
```

### Vertical Scaling (More Resources)
```yaml
# Update deployment resources
resources:
  requests:
    cpu: 500m
    memory: 1Gi
  limits:
    cpu: 2
    memory: 4Gi
```

### Database Scaling
```bash
# Add read replica (AWS)
aws rds create-db-instance-read-replica \
  --db-instance-identifier synora-replica \
  --source-db-instance-identifier synora-primary

# Update connection string for read operations
DATABASE_REPLICA_URL=postgresql://...
```

---

## Security Hardening (Post-Deployment)

### 1. Network Security
```bash
# Add Web Application Firewall (WAF)
# CloudFlare / AWS WAF: Block common attacks

# Network policies in K8s
kubectl apply -f infrastructure/k8s/network-policy.yaml -n synora
```

### 2. Secret Management
```bash
# Rotate JWT_SECRET
# 1. Generate new secret
# 2. Add to SecretsManager
# 3. Update environment variable
# 4. Redeploy instances
```

### 3. Security Updates
```bash
# Weekly dependency updates
pnpm update
pnpm audit

# Monthly security patching
# OS packages, Node.js, base images
```

---

## Runbook Links

- [docs/operations/RUNBOOK.md](./operations/RUNBOOK.md) — Daily operations
- [docs/production/DISASTER_RECOVERY.md](./DISASTER_RECOVERY.md) — Incident response
- [docs/production/MONITORING_GUIDE.md](./MONITORING_GUIDE.md) — Metrics & alerts

---

## Support & Escalation

| Issue | Severity | Contact | Response Time |
|-------|----------|---------|----------------|
| Errors >1% | P1 | On-call engineer | 5 minutes |
| Database down | P1 | On-call engineer | 5 minutes |
| Memory leak | P2 | Engineering team | 30 minutes |
| Performance degradation | P2 | Engineering team | 1 hour |
| Bug report | P3 | Product team | 24 hours |

---

**Deployment Date:** [fill in]  
**Deployed By:** [fill in]  
**Approval:** [fill in]
