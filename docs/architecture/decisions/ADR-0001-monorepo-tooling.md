# ADR-0001: pnpm workspaces + Turborepo for the monorepo

**Status:** Accepted

## Context

Synora is a platform foundation meant to host many packages (domain/application kernel,
shared kernel, ~9 infrastructure adapters, plugins, apps) that need to be versioned and
released together, with fast, correctly-ordered builds as the package count grows.

## Decision

pnpm workspaces for package management (strict `node_modules`, no phantom dependencies —
a package can only import what it declares) + Turborepo for task orchestration
(`build`/`lint`/`typecheck`/`test`/`test:e2e`, cached and parallelized, task graph derived
from `dependsOn: ["^build"]`).

## Alternatives considered

- **Nx** — more powerful (generators, more sophisticated dependency graph visualization)
  but a heavier learning curve and more opinionated project structure than a from-scratch
  foundation needs on day one.
- **Yarn/npm workspaces without an orchestrator** — pnpm's strict `node_modules` is what
  makes the "a package can only import what it declares" half of the dependency-rule
  enforcement possible (see ADR-0002); npm/Yarn classic hoist everything into one flat
  `node_modules`, silently permitting phantom imports.
- **Lerna** — largely superseded by Nx/Turborepo for this use case; no longer the default
  recommendation in the ecosystem.

## Consequences

pnpm's strictness means every package must explicitly declare every `@synora/*` and
third-party dependency it uses — no relying on hoisting. This is more `package.json`
bookkeeping per package but is precisely the property that makes dependency-direction
violations impossible to introduce by accident rather than merely discouraged.
