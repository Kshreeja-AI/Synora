# Synora AI Platform - Development Guide

## Project Overview

**Synora AI** is a premium, enterprise-grade AI platform for creators, built with modern web technologies and a focus on production quality, security, and user experience.

### Vision
A unified platform that integrates AI-powered tools for content creation, automation, and collaboration across multiple mediums (text, images, video, audio, code, presentations, and more).

### Technology Stack
- **Backend**: Node.js 20+, Express.js, TypeScript
- **Frontend**: Next.js 15+, React 19+, TypeScript
- **Database**: PostgreSQL 16+
- **Authentication**: Custom JWT + rotating refresh tokens (`next-auth` is a declared frontend dependency for a possible future OAuth2 flow, not yet wired in)
- **ORM**: Prisma
- **Design System**: React components with Tailwind CSS, shadcn/ui
- **Testing**: Vitest (Jest and Playwright are named here as an original intent; the actual test suite is Vitest + Supertest, no Playwright E2E suite exists yet — no Playwright E2E suite yet)
- **Package Manager**: pnpm workspaces (monorepo)
- **Build Tool**: Turbo
- **Deployment**: Docker, Vercel, Railway, or self-hosted

## Repository Structure

```
synora/
├── apps/
│   ├── backend/              # Express REST API
│   │   ├── src/
│   │   │   ├── ai/          # Provider-agnostic AI abstraction (10 providers)
│   │   │   ├── config/      # Typed, stage-aware config
│   │   │   ├── db/          # Prisma client singleton
│   │   │   ├── middleware/  # Auth, error handling, logging
│   │   │   ├── routes/      # auth, users, projects, documents, images, ai
│   │   │   ├── secrets/     # SecretsManager + audited reads
│   │   │   ├── services/    # password, token, lockout, mfa/* (unwired)
│   │   │   ├── utils/       # Helpers
│   │   │   └── index.ts     # Server entry
│   │   ├── tests/
│   │   └── package.json
│   └── web/                  # Next.js frontend (App Router)
│       ├── src/app/
│       └── package.json
├── packages/
│   ├── database/             # Prisma schema & migrations
│   │   ├── prisma/
│   │   └── package.json
│   ├── shared/                # Shared types, utilities, ApiException hierarchy
│   │   └── package.json
│   └── design-system/         # Reusable React components
│       └── package.json
├── infrastructure/
│   ├── docker/
│   └── k8s/                  # present but unused — Release 4 scope
├── docs/                     # See docs/README.md for the full hierarchy
│   ├── architecture.md, api.md, database.md, deployment.md, security.md
│   ├── operations/, security/, production/  # living reference docs
│   └── archive/              # historical, point-in-time reports — every
│                             # frozen release/audit report lives here, not
│                             # at the repo root
├── .github/workflows/ci.yml  # test, security, docker jobs; test also
│                             # asserts migrations reproduce schema.prisma
├── turbo.json                # Turbo configuration
├── package.json               # Root workspace config, packageManager pin
├── .env.example               # Environment variables template
├── SYNORA_MASTER_BLUEPRINT.md # Architecture source of truth
├── SYNORA_OPERATIONS.md       # How to run/deploy/recover
├── SYNORA_LEARNING.md         # Engineering concepts, explained
└── README.md                  # Project overview
```

Synora keeps exactly three authoritative documents:
`SYNORA_MASTER_BLUEPRINT.md` (what Synora is and how it is architected),
`SYNORA_OPERATIONS.md` (how to run, configure, deploy and recover it), and
`SYNORA_LEARNING.md` (the engineering concepts behind those choices).
Do not add a fourth: put permanent knowledge in one of these three.

## Environment Setup

### Prerequisites
- Node.js 20+ (LTS)
- pnpm 10+ (this is a pnpm workspace monorepo — corepack picks up the
  pinned version from the root `package.json`'s `packageManager` field
  automatically)
- PostgreSQL 16+
- Docker (for local development)
- Git

### Initial Setup

```bash
# Clone the repository
git clone <repo-url>
cd synora

# Install dependencies
pnpm install

# Generate database types
pnpm run db:generate

# Create environment files
cp .env.example .env.local
cp apps/backend/.env.example apps/backend/.env.local
cp apps/web/.env.example apps/web/.env.local

# Start PostgreSQL (Docker) — docker-compose.dev.yml also provisions Redis
# for future use; it isn't consumed by the app yet, so starting just
# postgres is enough for local development today
docker-compose -f docker-compose.dev.yml up -d postgres

# Run database migrations
pnpm run db:migrate

# Start development servers
pnpm run dev
```

There is no seed script — Release 1 ships with no seed data.

### Environment Variables

**Root `.env.local`:**
```
NODE_ENV=development
DATABASE_URL=postgresql://user:password@localhost:5432/synora
NEXTAUTH_SECRET=<generate-with-openssl-rand-base64-32>
NEXTAUTH_URL=http://localhost:3000
BACKEND_URL=http://localhost:3001
```

**Backend `.env.local`:**
```
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://user:password@localhost:5432/synora
JWT_SECRET=<generate-with-openssl-rand-base64-32>
```

**Web `.env.local`:**
```
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXTAUTH_SECRET=<generate-with-openssl-rand-base64-32>
NEXTAUTH_URL=http://localhost:3000
```

## Development Workflow

### Available Commands

```bash
# Development
pnpm run dev              # Start all apps in development mode

# Building
pnpm run build            # Build all apps
pnpm --filter @synora/backend build   # Build specific app

# Testing
pnpm run test             # Run all tests
pnpm run test:watch       # Run tests in watch mode
pnpm run test:coverage    # Generate coverage report

# Code Quality
pnpm run lint             # Run linters
pnpm run format           # Format code with Prettier
pnpm run type-check       # Type check all TypeScript

# Database
pnpm run db:generate      # Generate Prisma types
pnpm run db:migrate       # Run pending migrations
```

### Git Workflow

1. Create a feature branch: `git checkout -b feature/description`
2. Make changes following the coding standards (see below)
3. Run tests and linting: `pnpm run lint && pnpm run test`
4. Commit with descriptive messages: `git commit -m "type(scope): description"`
5. Push and create a Pull Request

### Commit Message Format

```
type(scope): description

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`
Scopes: `backend`, `web`, `database`, `auth`, `design-system`, etc.

Example:
```
feat(auth): add two-factor authentication support
```

## Architecture

### Backend Architecture

**REST API** built with Express.js following these principles:

- **Layered Architecture**: Routes → Controllers → Services → Data Access
- **API-First Design**: All features exposed via REST endpoints
- **Error Handling**: Centralized error middleware with proper HTTP status codes
- **Logging**: Structured logging with Winston
- **Validation**: Input validation with Zod schemas
- **Authentication**: NextAuth.js backend integration + JWT for stateless auth

### Frontend Architecture

**Next.js** with App Router:

- **Server Components**: Default; opt-in to Client Components where needed
- **API Routes**: Proxy to backend or small server-side operations
- **State Management**: TanStack Query for server state, Zustand for UI state
- **Component Structure**: Atomic design principles
- **Styling**: Tailwind CSS + CSS Modules for scoped styles

### Database Architecture

**PostgreSQL** with Prisma ORM:

- **Schema-Driven**: Single source of truth in `schema.prisma`
- **Migrations**: Version-controlled with Prisma Migrate
- **Relationships**: Proper foreign keys and constraints
- **Indexes**: Optimized for common queries
- **Audit Trail**: Created/updated timestamps on all entities

### Authentication Flow

1. User signs up/logs in via NextAuth.js
2. NextAuth generates JWT token + session
3. Frontend stores session in secure HTTP-only cookie
4. Backend validates JWT for API requests
5. OAuth2 providers (Google, GitHub) supported
6. Session management with automatic refresh

## Code Standards

### TypeScript
- Strict mode enabled
- Explicit return types on functions
- No `any` types (use `unknown` if necessary)
- Meaningful type names

### React/Components
- Functional components with hooks
- Props interfaces clearly defined
- No prop drilling; use Context for shared state
- Atomic design: Atoms, Molecules, Organisms, Templates
- Accessible markup (ARIA labels, semantic HTML)

### Naming Conventions
- **Files**: kebab-case for components (Button.tsx), camelCase for utils (userService.ts)
- **Variables**: camelCase
- **Constants**: UPPER_SNAKE_CASE
- **Classes**: PascalCase

### Testing
- Unit tests for utilities and logic
- Integration tests for API endpoints
- E2E tests for critical user flows
- Aim for >80% coverage on business logic
- File naming: `*.test.ts` or `*.spec.ts`

## Testing

### Running Tests

```bash
# All tests
pnpm run test

# Watch mode
pnpm run test:watch

# Coverage report
pnpm run test:coverage

# Specific package
pnpm --filter @synora/backend test
```

### Test Structure

- **Unit Tests**: `src/utils/myFunction.test.ts`
- **Integration Tests**: `tests/api/routes.test.ts`
- **E2E Tests**: `tests/e2e/auth.spec.ts`

## Deployment

### Staging
- Deployed via GitHub Actions on push to `develop`
- Runs full test suite before deploy
- Environment: Railway/Vercel staging

### Production
- Deployed on tag creation: `v*.*.*`
- Requires passing CI/CD pipeline
- Blue-green deployment strategy
- Automatic rollback on health check failure

See `docs/deployment.md` for detailed instructions.

## Security

### Data Protection
- Passwords hashed with bcrypt
- Sensitive data encrypted at rest
- HTTPS enforced in production
- CORS configured for allowed origins
- SQL injection prevented via Prisma parameterized queries

### Authentication
- JWT with expiration (15min access, 7d refresh)
- CSRF tokens for state-changing operations
- Rate limiting on auth endpoints
- Session invalidation on logout

See `docs/security.md` for comprehensive security guidelines.

## Monitoring & Logging

### Backend Logging
- Structured logging with Winston
- Log levels: error, warn, info, debug
- Request/response logging middleware
- Performance monitoring with timing

### Frontend Monitoring
- Error boundary integration
- Console error logging in development
- Performance metrics tracking
- User analytics (privacy-first)

## Performance Optimization

### Backend
- Database query optimization with indexes
- Caching with Redis (future)
- Pagination for list endpoints
- Compression middleware
- Connection pooling

### Frontend
- Code splitting with dynamic imports
- Image optimization with Next.js Image
- CSS tree-shaking with Tailwind
- Component lazy loading
- Cache headers optimization

## Documentation

Synora keeps exactly three authoritative documents:
`SYNORA_MASTER_BLUEPRINT.md` (what Synora is and how it is architected),
`SYNORA_OPERATIONS.md` (how to run, configure, deploy and recover it), and
`SYNORA_LEARNING.md` (the engineering concepts behind those choices).
Do not add a fourth: put permanent knowledge in one of these three.

The engineering reference under `docs/` stays in sync with code — update the
relevant one whenever a change touches it:

- **`docs/architecture.md`**: System design and component relationships
- **`docs/api.md`**: API endpoints, authentication, examples
- **`docs/database.md`**: Schema documentation, relationships
- **`docs/deployment.md`**: Deployment procedures
- **`docs/security.md`**: Security practices and guidelines

There is no `changelog.md`. Release history lives in
`SYNORA_MASTER_BLUEPRINT.md`.

## Contributing

1. Follow the code standards and style guide above
2. Write tests for new features
3. Ensure all tests pass: `pnpm run test`
4. Run linters: `pnpm run lint`
5. Update documentation
6. Create clear commit messages
7. Submit PR for review

## Useful Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Express.js Guide](https://expressjs.com/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Tailwind CSS](https://tailwindcss.com/docs)

## Support & Questions

For questions or issues:
1. Check existing documentation and issues
2. Ask in the team Slack/Discord channel
3. Open a GitHub issue with detailed context

---

**Last Updated**: 2026-07-23
**Status**: Release 1 complete — see `SYNORA_MASTER_BLUEPRINT.md`
