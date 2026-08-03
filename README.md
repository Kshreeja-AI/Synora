# Synora AI Platform

> Premium AI-powered platform for creators to generate content, automate workflows, and collaborate seamlessly.

![CI Pipeline](https://github.com/kshreeja-ai/synora/actions/workflows/ci.yml/badge.svg)
[![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL--1.1-yellow.svg)](https://github.com/kshreeja-ai/synora/blob/main/LICENSE)

**Status: Release 1 complete.** Real authentication (JWT + rotating
refresh tokens, per-account lockout), real AI text/code generation across
10 providers, a production Docker image, and blocking CI security gates
are all shipped and verified. See `RELEASE_1_FINAL.md` for the full
snapshot, or `PROJECT_HANDOVER.md` if you're new here and want the
zero-context tour.

## Features

Shipped in Release 1:
- **✍️ AI Text & Code Generation** — 10 providers (Anthropic, OpenAI,
  Gemini, xAI, OpenRouter, DeepSeek, Together, Azure OpenAI, Bedrock,
  Ollama) behind one provider-agnostic API, auto-selected by whichever
  API key is configured
- **🔐 Real Authentication** — JWT access + rotating refresh tokens,
  Argon2id password hashing, per-account login lockout, email-enumeration
  protection
- **📄 Document & Project Management** — CRUD with per-user isolation
- **🛡️ Blocking CI Security Gates** — dependency vulnerability scanning
  and secret scanning on every push

Not yet shipped (see `RELEASE_2_PLAN.md`):
- 🎨 Image/video/audio generation (routes exist, currently return
  placeholders — needs an async job queue + object storage)
- MFA and CSRF protection (both fully built on `recover/mfa` /
  `recover/csrf` branches, not yet rebased onto mainline)
- Team workspaces beyond the schema (no route currently uses them)

## Technology Stack

### Frontend
- **Next.js 15** — React framework with App Router
- **React 19**
- **TypeScript**
- **Tailwind CSS**
- `next-auth`, `@tanstack/react-query`, `zustand`, `axios` are declared
  dependencies for a planned future state-management layer — not yet
  wired into any page (current code uses raw `fetch` + `useState` +
  `localStorage`; see `PROJECT_HANDOVER.md` §11)

### Backend
- **Node.js 20+/22** — ESM
- **Express 4** with TypeScript (strict)
- **Prisma 5** — type-safe ORM
- **PostgreSQL 16**
- **JWT + opaque rotating refresh tokens** — custom, not NextAuth.js
- **Argon2id** — password hashing (`argon2` package)
- **Winston** — structured logging

### Infrastructure
- **Docker** — multi-stage production image
- **GitHub Actions** — CI (`test`/`security`/`docker`); no CD yet
- Frontend hosting and CD platform: not yet decided/documented

## Quick Start

### Prerequisites
- Node.js 20+
- **pnpm 10+** (this is a pnpm workspace monorepo — not npm; corepack
  will pick up the pinned version automatically)
- PostgreSQL 16+
- Docker & Docker Compose (optional, for local DB)

### Setup

1. **Clone the repository**
```bash
git clone https://github.com/kshreeja-ai/synora.git
cd synora
```

2. **Install dependencies**
```bash
pnpm install
```

3. **Configure environment**
```bash
cp .env.example .env.local
```
See `docs/archive/RELEASE_1_LAUNCH_READINESS.md` §2 for the full, currently-accurate
list of required vs. optional variables.

4. **Start PostgreSQL** (using Docker Compose)
```bash
docker-compose -f docker-compose.dev.yml up -d
```

5. **Set up the database**
```bash
pnpm run db:generate
pnpm run db:migrate
```
There is no seed script — Release 1 ships with no seed data.

6. **Start development servers**
```bash
pnpm run dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:3001

## Documentation

Start with `PROJECT_HANDOVER.md` (zero-context entry point) or
`RELEASE_1_FINAL.md` (the authoritative Release 1 snapshot). See
`docs/README.md` for the full documentation hierarchy — current reference
docs live in `docs/`, historical point-in-time reports live in
`docs/archive/`.

- **[Project Handover](./PROJECT_HANDOVER.md)** — start here
- **[Release 1 Final Summary](./RELEASE_1_FINAL.md)** — architecture, API, database, deployment, security, all in one place
- **[Architecture](./docs/architecture.md)**
- **[Database Schema](./docs/database.md)**
- **[API Reference](./docs/api.md)**
- **[Deployment Guide](./docs/deployment.md)**
- **[Security Policy](./docs/security.md)**
- **[Release Roadmap](./RELEASE_ROADMAP.md)** — what's done, what's next
- **[Release 2 Plan](./RELEASE_2_PLAN.md)**

## Testing

```bash
# Run all tests (all workspaces)
pnpm run test

# Watch mode
pnpm run test:watch

# Coverage report (uploaded to Codecov, not currently a CI gate)
pnpm run test:coverage

# Run tests for one workspace only
pnpm --filter @synora/backend test
pnpm --filter @synora/web test
```

## Project Structure

```
synora/
├── apps/
│   ├── backend/          # Express API
│   └── web/              # Next.js frontend
├── packages/
│   ├── database/         # Prisma schema and migrations
│   ├── shared/           # Shared types and utilities
│   └── design-system/    # Reusable React components
├── infrastructure/       # Docker, k8s (unused, Release 4 scope)
├── docs/                 # Documentation (see docs/README.md)
└── .github/workflows/    # CI pipeline
```

## Security & Privacy

- **Authentication**: custom JWT (access) + rotating refresh tokens (not NextAuth.js)
- **Password hashing**: Argon2id (bcrypt legacy hashes migrate transparently)
- **Rate limiting**: global, IP-based, on all of `/api/*`
- **Input validation**: Zod schema validation on every mutating route
- **CI gates**: blocking dependency audit (`pnpm audit --prod --audit-level=high`) and secret scanning (gitleaks) on every push

MFA and CSRF are not yet enforced — see `docs/security.md` for the full,
verified-against-source picture, including what's deliberately deferred
to Release 2 and why.

## Deployment

### Development
```bash
pnpm run dev
```

### Production Build
```bash
pnpm run build
```

### Docker
```bash
docker build -t synora-backend -f Dockerfile .
docker run -p 3001:3001 synora-backend
```
See `docs/deployment.md` for the full procedure including required
environment variables and health-check verification.

## Contributing

### Development Workflow

1. Create feature branch: `git checkout -b feature/description`
2. Make changes and commit: `git commit -m "type(scope): description"`
3. Run `pnpm run lint && pnpm run type-check && pnpm run test` before pushing
4. Push to branch: `git push origin feature/description`
5. Open a Pull Request

### Code Standards

- **TypeScript**: Strict mode enabled
- **Formatting**: Prettier
- **Linting**: ESLint

## License

Licensed under BUSL-1.1 (Business Source License). See [LICENSE](./LICENSE) for details.

## Support

- **Documentation**: [docs/](./docs/)
- **Issues**: [GitHub Issues](https://github.com/kshreeja-ai/synora/issues)
- **Discussions**: [GitHub Discussions](https://github.com/kshreeja-ai/synora/discussions)

## What's next

Release 2 (production hardening — MFA, CSRF/cookie auth, Redis-backed
shared state, media generation, CD pipeline, observability) is planned
but not started. See `RELEASE_2_PLAN.md` for objectives, priorities,
milestones, and dependencies.

## Authors

Created by the Synora AI Team

---

**Status**: Release 1 complete
**Last Updated**: 2026-07-23
