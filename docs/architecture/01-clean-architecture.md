# Clean Architecture

Synora follows the four classic Clean Architecture rings. Each ring maps onto a concrete
part of the repo, not just a conceptual grouping:

| Ring               | Repo location                                                                            | Depends on                           |
| ------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------ |
| **Domain**         | `packages/domain` (`@synora/domain`), plus each plugin's own `src/domain`                | Nothing platform-internal            |
| **Application**    | `packages/application` (`@synora/application`), plus each plugin's own `src/application` | Domain + shared kernel               |
| **Infrastructure** | `packages/infrastructure/*`, plus each plugin's own `src/infrastructure`                 | Domain + Application + shared kernel |
| **Presentation**   | `apps/api-gateway`, plus each plugin's own `src/presentation`                            | Everything                           |

## The dependency rule

Source code dependencies only point inward: Presentation and Infrastructure depend on
Application and Domain; Application depends on Domain; Domain depends on nothing
platform-internal. Nothing inside `@synora/domain` or `@synora/application` imports a
concrete adapter, a web framework, a database client, or an env var — those only exist in
Infrastructure and Presentation. See `03-service-boundaries.md` for exactly how this is
enforced (not just convention) and `ADR-0002` for why.

## Platform kernel vs. plugin features

Because Synora itself is domain-independent, `@synora/domain` and `@synora/application`
do **not** contain business entities — they contain the DDD/use-case _building blocks_
every feature reuses (`Entity`, `AggregateRoot`, `ValueObject`, `DomainEvent`, `UseCase`,
the cross-cutting ports). Actual business domains live inside `plugins/*`, each of which
has its own complete four-ring structure built on top of the kernel — see
`plugins/example-task` for the reference implementation and `06-plugin-architecture.md`
for how a plugin composes onto the platform.

## Why this over a simpler layout

A flatter, framework-centric layout (e.g. "controllers call the database directly") is
faster to start but couples business logic to Postgres/Fastify/whatever from day one —
exactly what "provider-agnostic foundation for future AI products" rules out. Clean
Architecture's cost (more files, an explicit port for every external dependency) buys
back: business logic that unit-tests without any infrastructure running, and swapping a
provider (e.g. Postgres → another store) touching one new `infra-*` package instead of
the whole codebase.
