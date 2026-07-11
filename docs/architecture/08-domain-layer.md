# Domain Layer

`@synora/domain` is the innermost ring: zero dependencies on any other `@synora/*`
package, no framework, no I/O. It ships the DDD building blocks every plugin's own domain
model is built from — it does not itself define any business entity, because Synora is
domain-independent (see `01-clean-architecture.md`).

## Building blocks

- **`Entity<Props>`** — identity-based equality (`equals()` compares `id`, not props).
- **`AggregateRoot<Props>`** extends `Entity` — the consistency boundary for a cluster of
  domain objects, and the only kind of object application code holds a reference to
  directly. Records `DomainEvent`s via `protected addDomainEvent()`;
  `pullDomainEvents()` drains them for the application layer to publish.
- **`ValueObject<Props>`** — structural equality, immutable (`Object.freeze`d props).
- **`Identifier<T>`** — a typed wrapper around an id string, so a `TaskId` and a `UserId`
  can't be passed where the other is expected even though both are strings underneath.
  `Identifier.generate()` produces a new random one (`node:crypto`'s `randomUUID`).
- **`DomainEvent`** — abstract base every event extends; carries `eventId`, `occurredAt`,
  `aggregateId`, and requires a stable `eventName` string used for `EventBus` subscription
  routing.
- **`DomainError`** — abstract base for business rule violations (e.g.
  `plugins/example-task`'s `TaskAlreadyCompletedError`).

## `DomainError` vs. `AppError`

`DomainError` (this package) and `AppError` (`@synora/errors`, the shared kernel) are
**intentionally separate class hierarchies**, not a shared base. The domain layer must
stay at zero dependencies, and a domain rule violation ("a Task cannot be completed
twice") is conceptually different from an application/infrastructure/presentation failure
("the database is unreachable", "the request body failed validation"). Application-layer
code that catches a `DomainError` typically translates it into (or lets it propagate as,
mapped by the presentation layer's error handler) an appropriate `AppError` before it
crosses further out — see `13-error-handling-standards.md`.

## Writing a plugin's domain model

Extend these base classes exactly the way `plugins/example-task/src/domain/task.ts` does:
a private constructor, a `static create(...)` factory that raises the "created" event, and
mutation methods that enforce invariants (throwing a `DomainError` subclass on violation)
and raise further events. Keep persistence entirely out of this layer — `Task` has no
idea Postgres exists.
