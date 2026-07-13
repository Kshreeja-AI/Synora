# Synora AI - Deployment Guide

## Deployment Overview

Synora AI can be deployed to various platforms:

- **Vercel** - Frontend (Next.js) - Free tier available
- **Railway/Fly.io** - Backend (Node.js) - Pay as you go
- **AWS/GCP/Azure** - Self-hosted - Full control
- **Local Docker** - Development and testing

## Environment Setup

### 1. Environment Variables

Create `.env.production` with:

```env
NODE_ENV=production
DATABASE_URL=postgresql://user:password@host:5432/synora
JWT_SECRET=<generate-with-openssl-rand-base64-32>
NEXTAUTH_SECRET=<generate-with-openssl-rand-base64-32>
NEXTAUTH_URL=https://yourdomain.com
BACKEND_URL=https://api.yourdomain.com
CORS_ORIGINS=https://yourdomain.com
```

### 2. Database Setup

#### PostgreSQL on AWS RDS

```bash
# Create RDS PostgreSQL instance
aws rds create-db-instance \
  --db-instance-identifier synora-prod \
  --db-instance-class db.t4g.micro \
  --engine postgres \
  --engine-version 16.1 \
  --master-username synora \
  --allocated-storage 100 \
  --publicly-accessible false
```

Then run migrations:

```bash
DATABASE_URL="postgresql://..." npm run db:migrate
```

## Deployment Strategies

### Option 1: Vercel (Frontend) + Railway (Backend)

**Frontend Deployment (Vercel)**

1. Push code to GitHub
2. Connect repository to Vercel
3. Set environment variables in Vercel dashboard
4. Deploy automatically on push

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

**Backend Deployment (Railway)**

1. Connect GitHub repository to Railway
2. Create PostgreSQL plugin
3. Set environment variables
4. Deploy

### Option 2: Docker + Kubernetes

**Build Docker Image**

```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3001 3000

CMD ["npm", "start"]
```

**Build and Push**

```bash
docker build -t synora:latest .
docker tag synora:latest myregistry/synora:latest
docker push myregistry/synora:latest
```

**Kubernetes Deployment**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: synora-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: synora-api
  template:
    metadata:
      labels:
        app: synora-api
    spec:
      containers:
      - name: synora-api
        image: myregistry/synora:latest
        ports:
        - containerPort: 3001
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: synora-secrets
              key: database-url
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: synora-secrets
              key: jwt-secret
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: synora-api-service
spec:
  type: LoadBalancer
  selector:
    app: synora-api
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3001
```

### Option 3: Self-Hosted (VPS)

**Prerequisites**
- VPS with Ubuntu 22.04+
- Domain name
- SSL certificate (Let's Encrypt)

**Setup**

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Install Nginx
sudo apt install -y nginx

# Clone repository
git clone <repo-url>
cd synora
npm ci

# Setup environment
cp .env.example .env.production

# Build
npm run build

# Start with PM2
npm install -g pm2
pm2 start npm --name "synora-backend" -- start
pm2 startup
pm2 save
```

**Nginx Configuration**

```nginx
upstream backend {
    server localhost:3001;
}

upstream frontend {
    server localhost:3000;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name yourdomain.com api.yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

## Monitoring & Logging

### Application Monitoring

```bash
# Install monitoring tools
npm install pm2-logrotate
pm2 install pm2-logrotate

# Monitor processes
pm2 monit
pm2 log synora-backend
```

### Error Tracking (Sentry)

```typescript
// apps/backend/src/index.ts
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});

app.use(Sentry.Handlers.requestHandler());
// ... routes ...
app.use(Sentry.Handlers.errorHandler());
```

## Database Backup Strategy

### Automated Backups (AWS RDS)

```bash
# Enable automated backups
aws rds modify-db-instance \
  --db-instance-identifier synora-prod \
  --backup-retention-period 30 \
  --preferred-backup-window "03:00-04:00"
```

### Manual Backups

```bash
# PostgreSQL dump
pg_dump -h host -U user -d synora > backup.sql

# Restore
psql -h host -U user -d synora < backup.sql
```

## CI/CD Pipeline

### GitHub Actions to Vercel + Railway

```yaml
name: Deploy

on:
  push:
    tags:
      - 'v*.*.*'

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy Frontend to Vercel
        run: npm run deploy:vercel
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
      
      - name: Deploy Backend to Railway
        run: railway up
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

## Health Checks

### Frontend Health Check

```typescript
// pages/api/health.ts
export default function handler(req, res) {
  res.status(200).json({ status: 'ok' });
}
```

### Backend Health Check

```typescript
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

## Performance Optimization

### CDN Setup (Cloudflare)

1. Update DNS nameservers to Cloudflare
2. Enable caching for static assets
3. Enable Gzip compression
4. Set up WAF rules

### Database Optimization

```sql
-- Create indexes
CREATE INDEX idx_user_email ON "User"(email);
CREATE INDEX idx_project_user ON "Project"("userId");
CREATE INDEX idx_document_user ON "Document"("userId");
CREATE INDEX idx_activity_user ON "ActivityLog"("userId", "createdAt");

-- Analyze query plans
EXPLAIN ANALYZE SELECT * FROM "User" WHERE email = 'test@example.com';
```

### Caching Strategy

```typescript
// Redis caching example
import redis from 'redis';

const client = redis.createClient();

// Cache user data
const cacheKey = `user:${userId}`;
const cached = await client.get(cacheKey);

if (cached) {
  return JSON.parse(cached);
}

const user = await prisma.user.findUnique({ where: { id: userId } });
await client.setex(cacheKey, 3600, JSON.stringify(user));
```

## Rollback Procedures

### Frontend Rollback

```bash
# Vercel
vercel rollback

# Or redeploy previous commit
git checkout previous-commit
vercel --prod
```

### Backend Rollback

```bash
# Railway
railway deploy previous-version

# Or restart with previous Docker image
docker run -d myregistry/synora:v0.1.0
```

## Scaling Strategy

### Horizontal Scaling

1. Run multiple backend instances
2. Use load balancer (Nginx, AWS ALB)
3. Share sessions in Redis
4. Use read replicas for database

### Vertical Scaling

1. Increase instance size (CPU, RAM)
2. Optimize code and queries
3. Implement caching layers

## Troubleshooting

### Database Connection Issues

```bash
# Test connection
psql -h host -U user -d synora -c "SELECT 1"

# Check connection pool
SELECT datname, numbackends FROM pg_stat_database;
```

### High Memory Usage

```bash
# Monitor with PM2
pm2 plus

# Check memory usage
pm2 monit
```

### API Response Slow

```bash
# Enable slow query logging
# In PostgreSQL: log_min_duration_statement = 1000;

# Profile with Node.js
node --prof app.js
node --prof-process isolate-*.log > profile.txt
```

---

**Last Updated**: 2026-01-13
