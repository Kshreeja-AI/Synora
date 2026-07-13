# Synora Staging Deployment Guide

## Overview

This guide covers deploying Synora AI Platform to a staging environment for pre-production testing and validation.

## Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- PostgreSQL 16+ (or use containerized version)
- Redis 7+ (or use containerized version)
- Nginx 1.21+ (or use containerized version)
- 2GB+ available RAM
- 10GB+ available disk space

## Quick Start - Local Staging

Deploy a complete staging stack locally with Docker Compose:

```bash
# Set environment variables
export JWT_SECRET=$(openssl rand -base64 32)
export NEXTAUTH_SECRET=$(openssl rand -base64 32)
export DB_PASSWORD=$(openssl rand -base64 16)
export REDIS_PASSWORD=$(openssl rand -base64 16)
export CORS_ORIGINS="http://localhost:3000,https://staging.synora.local"

# Create SSL certificates for staging
mkdir -p infrastructure/ssl/staging
cd infrastructure/ssl/staging
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout key.pem -out cert.pem \
  -subj "/C=US/ST=CA/L=San Francisco/O=Synora/CN=staging.synora.local"
cd ../../..

# Start staging stack
docker-compose -f docker-compose.staging.yml up -d

# Verify services are healthy
docker-compose -f docker-compose.staging.yml ps

# Check logs
docker-compose -f docker-compose.staging.yml logs -f api
```

## Environment Configuration

### Staging-Specific Variables

Create `.env.staging`:

```bash
# Environment
NODE_ENV=staging
LOG_LEVEL=debug

# Database
DATABASE_URL=postgresql://synora:${DB_PASSWORD}@postgres:5432/synora_staging
DB_PASSWORD=synora_staging

# Authentication
JWT_SECRET=<32-byte-random-string>
NEXTAUTH_SECRET=<32-byte-random-string>
JWT_EXPIRATION=15m
REFRESH_TOKEN_EXPIRATION=7d

# CORS
CORS_ORIGINS=https://staging.synora.example.com,http://localhost:3000

# Redis
REDIS_PASSWORD=redis_staging
REDIS_URL=redis://:redis_staging@redis:6379/0

# API Configuration
PORT=3001
API_TIMEOUT=60000
MAX_REQUEST_SIZE=100mb

# AI Provider Keys (staging)
OPENAI_API_KEY=sk-...
REPLICATE_API_KEY=...
ANTHROPIC_API_KEY=...
RUNWAYML_API_KEY=...
SYNTHESIA_API_KEY=...

# Monitoring
SENTRY_DSN=<sentry-dsn-for-staging>
DATADOG_API_KEY=<datadog-key>

# Feature Flags
ENABLE_VIDEO_GENERATION=true
ENABLE_COLLABORATION=true
ENABLE_ANALYTICS=true
```

### Load Environment

```bash
# Load from file
source .env.staging

# Pass to Docker Compose
docker-compose -f docker-compose.staging.yml --env-file .env.staging up -d
```

## Service Deployment

### Services Included

1. **API Server** (Node.js/Express)
   - Port: 3001 (internal), 8080/8443 (via Nginx)
   - Health check: `http://localhost:3001/health`
   - Metrics: `http://localhost:3001/metrics`

2. **PostgreSQL** (Database)
   - Port: 5433 (mapped from 5432)
   - Database: `synora_staging`
   - User: `synora`
   - Volumes: `postgres_staging_data`

3. **Redis** (Cache/Session Store)
   - Port: 6380 (mapped from 6379)
   - Password: `${REDIS_PASSWORD}`
   - Persistence: Enabled with AOF
   - Volumes: `redis_staging_data`

4. **Nginx** (Reverse Proxy)
   - HTTP: Port 8080
   - HTTPS: Port 8443
   - Config: `infrastructure/nginx.staging.conf`
   - SSL Certificates: `infrastructure/ssl/staging/`

## Deployment Steps

### 1. Build Docker Image

```bash
# Build image
docker build -t synora:staging-latest .

# Build with specific version
docker build -t synora:staging-v3.0 .

# Verify build
docker image ls | grep synora
```

### 2. Start Services

```bash
# Start all services
docker-compose -f docker-compose.staging.yml up -d

# Wait for services to be healthy
docker-compose -f docker-compose.staging.yml ps

# Expected output:
# NAME                       STATUS
# synora-api-staging         Up (healthy)
# synora-postgres-staging    Up (healthy)
# synora-redis-staging       Up (healthy)
# synora-nginx-staging       Up
```

### 3. Initialize Database

```bash
# Run migrations
docker-compose -f docker-compose.staging.yml exec api npm run db:migrate

# Seed database (optional)
docker-compose -f docker-compose.staging.yml exec api npm run db:seed

# Verify database
docker-compose -f docker-compose.staging.yml exec postgres psql -U synora -d synora_staging -c "\dt"
```

### 4. Verify Deployment

```bash
# Check API health
curl http://localhost:8080/health

# Check HTTPS health
curl --insecure https://localhost:8443/health

# Check metrics
curl http://localhost:8080/metrics

# View logs
docker-compose -f docker-compose.staging.yml logs api -f

# Test database connection
docker-compose -f docker-compose.staging.yml exec api npm run test

# Run API tests
docker-compose -f docker-compose.staging.yml exec api npm run test:api
```

## Remote Staging Deployment

### Prerequisites

- Ubuntu 20.04+ or CentOS 8+ server
- Docker and Docker Compose installed
- Domain name (e.g., staging.synora.example.com)
- SSH access to server
- Valid SSL certificates or certbot configured

### Deployment to Remote Server

```bash
# 1. SSH into staging server
ssh deploy@staging.synora.example.com

# 2. Clone repository
git clone https://github.com/kshreeja-ai/synora.git
cd synora

# 3. Create environment file
cat > .env.staging << EOF
NODE_ENV=staging
JWT_SECRET=$(openssl rand -base64 32)
NEXTAUTH_SECRET=$(openssl rand -base64 32)
DB_PASSWORD=$(openssl rand -base64 16)
REDIS_PASSWORD=$(openssl rand -base64 16)
CORS_ORIGINS=https://staging.synora.example.com
EOF

# 4. Generate SSL certificates
certbot certonly --standalone -d staging.synora.example.com

# 5. Create directories for certs
mkdir -p infrastructure/ssl/staging
cp /etc/letsencrypt/live/staging.synora.example.com/* infrastructure/ssl/staging/

# 6. Update Nginx config
sed -i 's/staging.synora.local/staging.synora.example.com/g' infrastructure/nginx.staging.conf

# 7. Start services
docker-compose -f docker-compose.staging.yml up -d

# 8. Verify deployment
docker-compose -f docker-compose.staging.yml ps
curl https://staging.synora.example.com/health
```

## Monitoring & Logs

### View Logs

```bash
# API logs
docker-compose -f docker-compose.staging.yml logs api -f --tail=100

# Database logs
docker-compose -f docker-compose.staging.yml logs postgres -f

# Redis logs
docker-compose -f docker-compose.staging.yml logs redis -f

# Nginx logs
docker-compose -f docker-compose.staging.yml logs nginx -f

# All logs
docker-compose -f docker-compose.staging.yml logs -f
```

### Health Checks

```bash
# API health
curl -X GET http://localhost:8080/health | jq .

# Database connectivity
docker-compose -f docker-compose.staging.yml exec postgres pg_isready -U synora

# Redis connectivity
docker-compose -f docker-compose.staging.yml exec redis redis-cli ping

# Nginx status
docker-compose -f docker-compose.staging.yml exec nginx nginx -t
```

### Performance Monitoring

```bash
# View container stats
docker stats

# Check API response times
docker-compose -f docker-compose.staging.yml logs nginx | grep "rt="

# Monitor database connections
docker-compose -f docker-compose.staging.yml exec postgres psql -U synora -d synora_staging -c "SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname;"
```

## Testing in Staging

### API Testing

```bash
# Run full test suite
docker-compose -f docker-compose.staging.yml exec api npm test

# Run integration tests
docker-compose -f docker-compose.staging.yml exec api npm run test:integration

# Run with coverage
docker-compose -f docker-compose.staging.yml exec api npm run test:coverage
```

### Load Testing

```bash
# Install Apache Bench or wrk
apt-get install apache2-utils

# Simple load test
ab -n 1000 -c 10 http://localhost:8080/api/videos

# More detailed load testing with wrk
wrk -t4 -c100 -d30s http://localhost:8080/api/videos
```

## Data Management

### Database Backups

```bash
# Create backup
docker-compose -f docker-compose.staging.yml exec postgres pg_dump -U synora synora_staging > synora_staging_backup.sql

# Restore from backup
docker-compose -f docker-compose.staging.yml exec -T postgres psql -U synora synora_staging < synora_staging_backup.sql

# Automated daily backups
0 2 * * * cd /home/deploy/synora && docker-compose -f docker-compose.staging.yml exec postgres pg_dump -U synora synora_staging | gzip > backups/synora_staging_$(date +\%Y\%m\%d).sql.gz
```

### Database Reset

```bash
# Drop staging database
docker-compose -f docker-compose.staging.yml exec postgres dropdb -U synora synora_staging

# Recreate database
docker-compose -f docker-compose.staging.yml exec postgres createdb -U synora synora_staging

# Run migrations
docker-compose -f docker-compose.staging.yml exec api npm run db:migrate
```

## Troubleshooting

### Services Won't Start

```bash
# Check Docker daemon
docker ps

# Check compose file syntax
docker-compose -f docker-compose.staging.yml config

# Check resource availability
df -h
free -h

# Remove dangling containers
docker-compose -f docker-compose.staging.yml down
docker system prune -f
```

### Database Connection Errors

```bash
# Check PostgreSQL logs
docker-compose -f docker-compose.staging.yml logs postgres

# Verify database exists
docker-compose -f docker-compose.staging.yml exec postgres psql -U synora -l

# Check network connectivity
docker-compose -f docker-compose.staging.yml exec api ping postgres
```

### High Memory Usage

```bash
# Check container memory limits
docker stats

# Monitor Redis memory
docker-compose -f docker-compose.staging.yml exec redis redis-cli info memory

# Clear Redis cache
docker-compose -f docker-compose.staging.yml exec redis redis-cli FLUSHALL
```

## Cleanup

### Stop Services

```bash
# Stop all services
docker-compose -f docker-compose.staging.yml down

# Stop and remove volumes (CAREFUL!)
docker-compose -f docker-compose.staging.yml down -v

# Remove Docker image
docker rmi synora:staging-latest
```

## Scaling for Production

For production deployment:

1. Use managed database (AWS RDS, Google Cloud SQL)
2. Use managed Redis (AWS ElastiCache, Google Cloud Memorystore)
3. Deploy on Kubernetes (EKS, GKE, AKS)
4. Use managed SSL (ACM, Google Certificate Manager)
5. Setup auto-scaling and load balancing
6. Enable comprehensive monitoring (CloudWatch, Datadog, NewRelic)
7. Configure automated backups and disaster recovery
8. Setup CI/CD pipeline (GitHub Actions, GitLab CI, Jenkins)

See `docs/deployment.md` for complete production deployment guide.

## Support

For issues or questions:
1. Check logs: `docker-compose -f docker-compose.staging.yml logs -f`
2. Review health checks: `curl http://localhost:8080/health`
3. Check resource usage: `docker stats`
4. File an issue with logs and environment details

---

**Last Updated**: 2026-01-13
**Status**: Production Ready
**Next Review**: Milestone 4
