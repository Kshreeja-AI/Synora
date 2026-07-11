# ADR-0002: Enforce the Clean Architecture dependency rule three independent ways

**Status:** Accepted

## Context

Clean Architecture's value only holds if the dependency rule (`03-service-boundaries.md`)
actually holds over time, across many contributors and, eventually, many plugins the
platform team doesn't control code review for line-by-line. "We agreed not to do that" is
not an enforcement mechanism.

## Decision

Enforce the rule three ways, each catching what the others might miss:

1. **Package dependencies** (pnpm's strict `node_modules`, ADR-0001) — a package cannot
   `import` a `@synora/*` package it hasn't declared in `package.json`. This is the
   strongest guarantee (a build-time/runtime resolution failure, not a lint warning) but
   is coarse — it stops "domain imports infra-postgres" but can't stop "domain imports
   shared, and shared happens to also be a legal import for infra" style leakage if
   packages are scoped too broadly.
2. **TypeScript project references** (`tsconfig.json`'s `references` in every package) —
   must match the real dependency graph or `tsc -b` fails to build in the correct order.
   A second, independently-computed check of the same graph, from the type system's
   perspective rather than Node module resolution's.
3. **ESLint `eslint-plugin-boundaries`** (`eslint.config.js`, root) — classifies every
   source file into `domain`/`application`/`shared`/`infrastructure`/`plugin`/`app` by
   path pattern and fails lint on a disallowed import between element types. This is the
   most precise mechanism (evaluated per-file, not per-package) and the only one that
   would catch, e.g., a `shared` package accidentally importing from `infrastructure`
   despite that being technically permitted by package.json if someone declared the dep.

## Alternatives considered

- **Code review only** — doesn't scale, and the failure mode (an architecture violation
  merged and only discovered much later) is expensive to unwind.
- **A single custom lint rule instead of `eslint-plugin-boundaries`** — reinventing a
  well-tested wheel; the plugin's `element-types` rule already does exactly what's needed.
- **Relying only on package.json dependencies (skip 2 and 3)** — cheapest, but package
  granularity is coarser than file granularity; a package that legitimately depends on
  another for one thing could still leak an unrelated import from it.

## Consequences

Three mechanisms to keep in sync when adding a package: declare the dependency in
`package.json`, add the matching `references` entry in `tsconfig.json`, and make sure the
new package's file paths match the right `boundaries/elements` pattern in
`eslint.config.js` (usually automatic if it lives under the conventional directory for its
layer — see `02-monorepo-structure.md`).
