# Synora AI Platform - Architecture Documentation

## System Overview

Synora AI is built as a modular, scalable platform with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                   │
│              React Components + TanStack Query           │
└────────────────────┬────────────────────────────────────┘
                     │ HTTPS
┌────────────────────▼────────────────────────────────────┐
│               API Gateway / Proxy Layer                  │
│            Rate Limiting, CORS, Auth Validation         │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│              Backend API (Express.js)                    │
│  ├── Auth Service (JWT, Sessions)                       │
│  ├── Content Services (Documents, Images, Videos, etc)  │
│  ├── User Management                                    │
│  ├── Project Management                                 │
│  └── AI Integration Layer                               │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┼────────────┬──────────────┐
        │            │            │              │
┌───────▼──┐  ┌─────▼───┐  ┌────▼────┐  ┌─────▼──┐
│PostgreSQL│  │  Redis  │  │   S3    │  │ AI API │
│ Database │  │  Cache  │  │ Storage │  │Provider│
└──────────┘  └─────────┘  └─────────┘  └────────┘
```

## Technology Stack

### Frontend
- **Framework**: Next.js 15+ with App Router
- **Language**: TypeScript
- **State Management**: TanStack Query (server state) + Zustand (UI state)
- **Styling**: Tailwind CSS + CSS Modules
- **Components**: React 19+ with shadcn/ui based design system
- **Testing**: Vitest + React Testing Library

### Backend
- **Runtime**: Node.js 20+
- **Framework**: Express.js with TypeScript
- **Database ORM**: Prisma
- **Authentication**: JWT + NextAuth.js
- **Validation**: Zod schemas
- **Logging**: Winston
- **Testing**: Vitest

### Infrastructure
- **Database**: PostgreSQL 16+
- **Cache**: Redis (optional, for future scaling)
- **Storage**: S3-compatible (AWS S3, Minio, etc.)
- **Container**: Docker + Docker Compose
- **Orchestration**: Kubernetes (future)
- **Deployment**: GitHub Actions + Vercel/Railway/Self-hosted

## Directory Structure

```
synora/
├── apps/
│   ├── backend/          # Node.js REST API
│   │   ├── src/
│   │   │   ├── api/      # API controllers
│   │   │   ├── services/ # Business logic
│   │   │   ├── middleware/
│   │   │   ├── routes/   # Express routes
│   │   │   ├── utils/    # Helpers
│   │   │   └── index.ts
│   │   └── tests/
│   └── web/              # Next.js frontend
│       ├── src/
│       │   ├── app/      # Next.js App Router pages
│       │   ├── components/
│       │   ├── hooks/
│       │   ├── lib/
│       │   ├── styles/
│       │   └── types/
│       └── tests/
├── packages/
│   ├── database/         # Prisma schema & migrations
│   ├── shared/          # Shared types & utilities
│   └── design-system/   # Reusable React components
└── infrastructure/      # Docker, k8s, terraform
```

## Data Flow

### Authentication Flow

1. **User Registration/Login**
   - Frontend sends credentials to `/api/auth/register` or `/api/auth/login`
   - Backend validates credentials and generates JWT
   - Frontend stores token in localStorage (HTTP-only cookie in production)
   - Subsequent requests include `Authorization: Bearer <token>`

2. **Token Validation**
   - Every protected API route validates JWT
   - If invalid/expired, returns 401 Unauthorized
   - Frontend redirects to login

### Content Creation Flow

1. **User initiates content creation** (e.g., image generation)
2. **Frontend sends request** to `/api/images/generate` with prompt
3. **Backend receives request**:
   - Validates authentication
   - Validates input with Zod
   - Creates database record with PROCESSING status
   - Queues job for AI processing
4. **AI Processing**:
   - Calls external AI provider (OpenAI, Anthropic, etc.)
   - Processes response
   - Uploads result to S3
   - Updates database record with URL and COMPLETED status
5. **Frontend polls for completion** or receives webhook notification
6. **User can view/download content**

## Architectural Decisions

### Monorepo Strategy
- **Reason**: Shared code (types, utilities) between frontend/backend
- **Tool**: npm workspaces (native npm feature)
- **Alternative considered**: Separate repos (more flexibility but code duplication)

### REST API over GraphQL
- **Reason**: Simpler for initial version, easier to cache with HTTP
- **Future**: Can add GraphQL layer if needed

### Prisma as ORM
- **Reason**: Type-safe, great developer experience, auto-migrations
- **Type generation**: Automatic, keeps types in sync with schema

### Tailwind CSS over other solutions
- **Reason**: Utility-first, smaller bundle, great for design system
- **Custom components**: Built with Tailwind + class-variance-authority

### JWT Authentication
- **Reason**: Stateless, scalable, works with multiple servers
- **Tokens**: Short-lived (15min) + refresh tokens (7d)
- **Storage**: HTTP-only cookies in production

## Deployment Architecture

### Development
- Local PostgreSQL + Redis (docker-compose)
- Backend on `localhost:3001`
- Frontend on `localhost:3000`

### Staging
- Automated on `develop` branch push
- Separate PostgreSQL instance
- Vercel for frontend, Railway for backend

### Production
- Tagged releases (`v*.*.*`)
- Blue-green deployment
- Auto-rollback on health check failure
- CDN for static assets

## Security Architecture

### Network Security
- HTTPS everywhere
- CORS configured for allowed origins
- Helmet.js for security headers
- Rate limiting on auth endpoints

### Data Security
- Passwords hashed with bcryptjs
- Sensitive data encrypted at rest
- SQL injection prevented via Prisma parameterized queries
- CSRF tokens for state-changing operations

### Application Security
- Input validation with Zod
- JWT with expiration
- Session invalidation on logout
- No sensitive data in logs

## Performance Optimization

### Backend
- Database indexes on frequently queried columns
- Pagination for list endpoints (default 20 items)
- Redis caching for session data (future)
- Connection pooling

### Frontend
- Code splitting with Next.js dynamic imports
- Image optimization with Next.js Image component
- CSS tree-shaking with Tailwind
- Component lazy loading

## Monitoring & Observability

### Logging
- Winston for structured logging
- Log levels: error, warn, info, debug
- Separate error and combined logs

### Metrics
- Request/response timing
- Error rates
- API endpoint performance
- Database query performance (future)

### Health Checks
- `/health` endpoint on backend
- Frontend error boundary integration

## Scaling Strategy

### Current (MVP)
- Single instance backend
- Single instance database
- Basic monitoring

### Short-term
- Horizontal scaling with load balancer
- Redis for session caching
- Database read replicas

### Long-term
- Kubernetes orchestration
- Microservices for specialized services
- Event-driven architecture with message queues

## Testing Strategy

### Unit Tests
- Business logic in services
- Utility functions
- Custom hooks (frontend)

### Integration Tests
- API endpoints
- Database interactions
- Authentication flows

### E2E Tests
- Critical user journeys
- Auth flow
- Content creation flow

### Coverage Goals
- >80% for business logic
- >70% for overall codebase

---

**Last Updated**: 2026-01-13
