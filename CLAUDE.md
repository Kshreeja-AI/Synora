# Synora AI Platform - Development Guide

## Project Overview

**Synora AI** is a premium, enterprise-grade AI platform for creators, built with modern web technologies and a focus on production quality, security, and user experience.

### Vision
A unified platform that integrates AI-powered tools for content creation, automation, and collaboration across multiple mediums (text, images, video, audio, code, presentations, and more).

### Technology Stack
- **Backend**: Node.js 20+, Express.js, TypeScript
- **Frontend**: Next.js 15+, React 19+, TypeScript
- **Database**: PostgreSQL 16+
- **Authentication**: NextAuth.js v5 + JWT + OAuth2
- **ORM**: Prisma
- **Design System**: React components with Tailwind CSS, shadcn/ui
- **Testing**: Jest, Playwright, Vitest
- **Package Manager**: npm workspaces (monorepo)
- **Build Tool**: Turbo
- **Deployment**: Docker, Vercel, Railway, or self-hosted

## Repository Structure

```
synora/
├── apps/
│   ├── backend/              # Node.js REST API
│   │   ├── src/
│   │   │   ├── api/         # Route handlers
│   │   │   ├── services/    # Business logic
│   │   │   ├── middleware/  # Auth, logging, etc.
│   │   │   ├── utils/       # Helpers
│   │   │   └── index.ts     # Server entry
│   │   ├── tests/
│   │   └── package.json
│   └── web/                  # Next.js frontend
│       ├── src/
│       │   ├── app/         # App router pages
│       │   ├── components/  # React components
│       │   ├── hooks/       # Custom hooks
│       │   ├── lib/         # Client utilities
│       │   ├── styles/      # Global styles
│       │   └── types/       # Type definitions
│       ├── tests/
│       └── package.json
├── packages/
│   ├── database/             # Database schema & migrations
│   │   ├── schema/
│   │   ├── migrations/
│   │   ├── prisma/
│   │   └── package.json
│   ├── shared/              # Shared types & utilities
│   │   ├── src/
│   │   │   ├── types/       # Shared type definitions
│   │   │   ├── utils/       # Shared utilities
│   │   │   └── constants/   # Shared constants
│   │   └── package.json
│   └── design-system/       # Reusable React components
│       ├── src/
│       │   ├── components/  # Shared UI components
│       │   ├── hooks/       # Shared hooks
│       │   ├── styles/      # Design tokens
│       │   └── index.ts
│       └── package.json
├── infrastructure/          # Deployment & DevOps
│   ├── docker/
│   ├── k8s/                # Kubernetes manifests (future)
│   └── terraform/          # IaC (future)
├── docs/                   # Documentation
│   ├── architecture.md
│   ├── api.md
│   ├── database.md
│   ├── deployment.md
│   ├── security.md
│   └── changelog.md
├── .github/
│   ├── workflows/          # GitHub Actions CI/CD
│   └── ISSUE_TEMPLATE/
├── turbo.json             # Turbo configuration
├── tsconfig.json          # Root TypeScript config
├── package.json           # Root workspace config
├── .env.example           # Environment variables template
└── README.md              # Project overview
```

## Environment Setup

### Prerequisites
- Node.js 20+ (LTS)
- npm 10+
- PostgreSQL 16+
- Docker (for local development)
- Git

### Initial Setup

```bash
# Clone the repository
git clone <repo-url>
cd synora

# Install dependencies
npm install

# Generate database types
npm run db:generate

# Create environment files
cp .env.example .env.local
cp apps/backend/.env.example apps/backend/.env.local
cp apps/web/.env.example apps/web/.env.local

# Start PostgreSQL (Docker)
docker-compose up -d postgres

# Run database migrations
npm run db:migrate

# Seed database (optional)
npm run db:seed

# Start development servers
npm run dev
```

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
npm run dev              # Start all apps in development mode

# Building
npm run build            # Build all apps
npm run build --scope=backend   # Build specific app

# Testing
npm run test             # Run all tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Generate coverage report

# Code Quality
npm run lint             # Run linters
npm run format           # Format code with Prettier
npm run type-check       # Type check all TypeScript

# Database
npm run db:generate      # Generate Prisma types
npm run db:migrate       # Run pending migrations
npm run db:seed          # Seed database
```

### Git Workflow

1. Create a feature branch: `git checkout -b feature/description`
2. Make changes following the coding standards (see below)
3. Run tests and linting: `npm run lint && npm run test`
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
npm run test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# Specific package
npm run test --scope=backend
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

All documentation is kept in sync with code:

- **`architecture.md`**: System design and component relationships
- **`api.md`**: API endpoints, authentication, examples
- **`database.md`**: Schema documentation, relationships
- **`deployment.md`**: Deployment procedures
- **`security.md`**: Security practices and guidelines
- **`changelog.md`**: Version history and breaking changes

## Contributing

1. Follow the code standards and style guide above
2. Write tests for new features
3. Ensure all tests pass: `npm run test`
4. Run linters: `npm run lint`
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

**Last Updated**: 2026-01-13  
**Status**: Active Development - Milestone 1
