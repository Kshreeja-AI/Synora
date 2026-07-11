# @synora/infra-postgres

**Infrastructure layer** adapter for `DEFAULT_DATABASE=postgres`. Provides a shared
`createPostgresClient()` factory (a `pg.Pool` wrapped in a `drizzle-orm` database handle)
that plugins use to build their own repositories — this package does not itself define any
table schema or repository, since persistence models are owned by the feature that needs
them (see `plugins/example-task/src/infrastructure` for a concrete repository built on
top of this client).

ORM choice (Drizzle over Prisma/TypeORM/Kysely) is recorded in ADR-0010.

`mapPostgresError()` translates `pg` driver errors into `@synora/errors`' `InfrastructureError`
so plugin repositories don't leak driver-specific error shapes across the layer boundary.
