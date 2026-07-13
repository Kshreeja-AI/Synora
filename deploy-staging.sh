#!/bin/bash

##############################################################################
# Synora Staging Deployment Script
# Production-ready staging environment deployment
##############################################################################

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$PROJECT_DIR/logs/deployment_$TIMESTAMP.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Create logs directory
mkdir -p "$PROJECT_DIR/logs"

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Synora Staging Environment Deployment${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""

# Step 1: Check prerequisites
echo -e "${YELLOW}[1/7] Checking prerequisites...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker found: $(docker --version)${NC}"

if ! docker compose version &> /dev/null; then
    echo -e "${RED}✗ Docker Compose is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker Compose found${NC}"

# Step 2: Generate environment variables
echo ""
echo -e "${YELLOW}[2/7] Generating environment variables...${NC}"
cat > "$PROJECT_DIR/.env.staging" << EOF
# Environment
NODE_ENV=staging
LOG_LEVEL=debug

# Database
DB_PASSWORD=synora_staging_$(openssl rand -base64 8 | tr -d '/' | tr -d '+' | cut -c1-16)
DATABASE_URL=postgresql://synora:synora_staging@postgres:5432/synora_staging

# Authentication
JWT_SECRET=$(openssl rand -base64 32)
NEXTAUTH_SECRET=$(openssl rand -base64 32)

# Redis
REDIS_PASSWORD=redis_staging_$(openssl rand -base64 8 | tr -d '/' | tr -d '+' | cut -c1-16)

# CORS
CORS_ORIGINS=http://localhost:3000,http://localhost:8080,https://staging.synora.local

# API
PORT=3001
EOF
echo -e "${GREEN}✓ Environment file created: .env.staging${NC}"

# Step 3: Clean up existing deployment
echo ""
echo -e "${YELLOW}[3/7] Cleaning up existing deployment...${NC}"
docker compose -f "$PROJECT_DIR/docker-compose.staging.yml" down --remove-orphans 2>&1 | grep -v "no matching resources" || true
echo -e "${GREEN}✓ Cleanup complete${NC}"

# Step 4: Create required directories
echo ""
echo -e "${YELLOW}[4/7] Creating required directories...${NC}"
mkdir -p "$PROJECT_DIR/logs/nginx/staging"
mkdir -p "$PROJECT_DIR/infrastructure/ssl/staging"
echo -e "${GREEN}✓ Directories created${NC}"

# Step 5: Generate self-signed SSL certificates (if needed)
echo ""
echo -e "${YELLOW}[5/7] Checking SSL certificates...${NC}"
if [ ! -f "$PROJECT_DIR/infrastructure/ssl/staging/cert.pem" ]; then
    echo "Generating self-signed certificates..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$PROJECT_DIR/infrastructure/ssl/staging/key.pem" \
        -out "$PROJECT_DIR/infrastructure/ssl/staging/cert.pem" \
        -subj "/C=US/ST=CA/L=San Francisco/O=Synora/CN=staging.synora.local" \
        2>/dev/null
    echo -e "${GREEN}✓ SSL certificates generated${NC}"
else
    echo -e "${GREEN}✓ SSL certificates found${NC}"
fi

# Step 6: Start services
echo ""
echo -e "${YELLOW}[6/7] Starting services...${NC}"
docker compose -f "$PROJECT_DIR/docker-compose.staging.yml" \
    --env-file "$PROJECT_DIR/.env.staging" \
    up -d 2>&1 | tee -a "$LOG_FILE"
echo -e "${GREEN}✓ Services started${NC}"

# Step 7: Wait for services and verify
echo ""
echo -e "${YELLOW}[7/7] Verifying deployment...${NC}"
echo "Waiting for services to be healthy..."

MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -f http://localhost:8080/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ API is healthy${NC}"
        break
    fi

    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
        echo -e "${YELLOW}⚠ Health check timeout (API may still be starting)${NC}"
        break
    fi

    sleep 1
done

# Final status
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Staging Deployment Complete${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""

# Display service information
echo -e "${BLUE}Service Status:${NC}"
docker compose -f "$PROJECT_DIR/docker-compose.staging.yml" ps

echo ""
echo -e "${BLUE}Access Points:${NC}"
echo "  API (HTTP):  http://localhost:8080"
echo "  API (HTTPS): https://localhost:8443"
echo "  Health:      http://localhost:8080/health"
echo ""

echo -e "${BLUE}Database:${NC}"
echo "  Host:     localhost"
echo "  Port:     5433"
echo "  Database: synora_staging"
echo "  User:     synora"
echo ""

echo -e "${BLUE}Redis:${NC}"
echo "  Host: localhost"
echo "  Port: 6380"
echo ""

echo -e "${BLUE}Nginx:${NC}"
echo "  HTTP:  localhost:8080"
echo "  HTTPS: localhost:8443"
echo ""

echo -e "${BLUE}Logs:${NC}"
echo "  Deployment: $LOG_FILE"
echo "  Container:  docker compose -f docker-compose.staging.yml logs -f"
echo ""

echo -e "${BLUE}Documentation:${NC}"
echo "  See docs/STAGING_DEPLOYMENT.md for detailed information"
echo ""

echo -e "${YELLOW}Next Steps:${NC}"
echo "  1. Verify all services are healthy: docker compose ps"
echo "  2. Test API endpoint: curl http://localhost:8080/health"
echo "  3. Check logs: docker compose logs -f api"
echo "  4. Run migrations: docker compose exec api npm run db:migrate"
echo ""
