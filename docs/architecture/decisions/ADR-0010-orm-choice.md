# ADR-0010: Drizzle ORM for `infra-postgres`, over Prisma/TypeORM/Kysely

**Status:** Accepted

## Context

`DEFAULT_DATABASE=postgres`. The platform needs a way for plugins to define and query
their own Postgres schemas (each plugin owns its schema entirely — see
`10-infrastructure-layer.md`) that's TypeScript-first and doesn't fight the "swap the
adapter, not the caller" goal every other infra package follows.

## Decision

Drizzle ORM. `infra-postgres` provides `createPostgresClient()` (a `pg.Pool` wrapped in a
Drizzle database handle) and `mapPostgresError()`; each plugin defines its own
`pgTable(...)` schema and writes its own repository against the Drizzle query builder —
see `plugins/example-task/src/infrastructure/{schema,postgres-task.repository}.ts`.

## Alternatives considered

- **Prisma** — excellent DX, but its code-generation step (a build-time schema →
  generated-client pipeline, with its own CLI and a single global `schema.prisma` file by
  default) fits a single-schema application much better than a monorepo where every
  plugin should be able to own an independent schema without a shared generation step
  gating all of them. Prisma can be pushed into a multi-schema shape, but it's fighting
  the tool's default posture rather than working with it.
- **TypeORM** — decorator-heavy (`@Entity()`, `@Column()`), the same friction with
  `verbatimModuleSyntax`/pure-ESM/no-decorators-by-default posture already ruled out for
  DI in ADR-0004; also blurs the entity/repository line in a way that doesn't map cleanly
  onto this platform's domain-entity-vs-persistence-row separation (`Task` the domain
  aggregate vs. the `tasks` table row are deliberately different shapes, reconciled in the
  repository — see `Task.reconstitute()`).
- **Kysely** — a strong alternative, arguably even lighter-weight than Drizzle (pure
  query builder, no schema-definition layer at all). Drizzle was chosen over it mainly for
  its built-in schema-definition + `drizzle-kit` migration generation story
  (`plugins/example-task/drizzle.config.ts`), which Kysely leaves entirely to the
  consumer. Kysely remains a reasonable adapter-level choice for a future plugin that
  wants pure SQL-builder ergonomics instead — nothing in the port design prevents mixing
  approaches per plugin, since each plugin's persistence code is entirely its own.

## Consequences

Every plugin that uses Postgres owns its own Drizzle schema file and migrations
(`drizzle-kit generate`, per-plugin `drizzle.config.ts`) — there's no single global schema
file to coordinate across plugins, which is the point, but does mean migrations must be
run per-plugin rather than as one repo-wide migration set.
