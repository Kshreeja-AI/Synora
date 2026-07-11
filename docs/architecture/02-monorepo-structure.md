# Monorepo Structure

pnpm workspaces + Turborepo. See `ADR-0001` for why this combination.

```
/apps                   deployable applications (presentation layer)
  api-gateway/           Fastify HTTP entrypoint + composition root
/packages
  domain/                 @synora/domain — DDD kernel
  application/              @synora/application — use-case kernel + platform ports
  shared/                     cross-cutting kernel packages (errors, logger, config, di, event-bus, plugin-system, types, test-utils)
  infrastructure/                one package per concrete provider adapter (infra-postgres, infra-redis, ...)
/plugins                a self-contained product feature per directory (domain+application+infra+presentation)
  example-task/           reference/example — not a real product feature, see its README
/docs
  architecture/            this directory
```

## Workspace globs

`pnpm-workspace.yaml` lists `apps/*`, `packages/*`, `packages/shared/*`,
`packages/infrastructure/*`, and `plugins/*`. Every package is `"private": true` (nothing
in this repo is published to a registry) and uses the `@synora/*` npm scope for internal
cross-package imports via `workspace:*`.

## Build orchestration

Turborepo (`turbo.json`) defines the task graph: `build`, `lint`, `typecheck`, `test`,
`test:e2e`, `dev`, `clean`. `build`/`lint`/`typecheck`/`test` all declare
`"dependsOn": ["^build"]` — a package's dependencies are built (their `.d.ts` files exist)
before the package itself is processed, which is what makes TypeScript project references
across packages resolve correctly. Turborepo caches task outputs (`dist/**`,
`coverage/**`) keyed by inputs, so unaffected packages aren't rebuilt/retested on every run.

## Per-package shape

Every package has the same skeleton:

```
package.json     name, scripts (build/clean/lint/typecheck/test), workspace: deps
tsconfig.json     extends the root tsconfig.base.json, composite:true, project references to its deps
README.md         what this package is, what layer it's in, what it depends on and why
src/              implementation + colocated *.test.ts files
```

Composite TypeScript project references (`references` in each `tsconfig.json`) mirror the
package's actual dependencies — this is not optional boilerplate, it's what makes
`tsc -b` build packages in the correct order and is a second enforcement mechanism for the
dependency rule (see `03-service-boundaries.md`).
