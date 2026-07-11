# @synora/domain

The **Domain layer** kernel. Zero dependencies on any other `@synora/*` package or on
infrastructure/frameworks — this is the innermost ring of Clean Architecture.

This package does **not** contain business entities (Synora is domain-independent). It contains
the DDD building blocks every feature/plugin uses to define its own domain model:

- `Entity<Props>` — identity-based equality
- `AggregateRoot<Props>` — an `Entity` that records `DomainEvent`s to be published after persistence
- `ValueObject<Props>` — structural-equality, immutable
- `Identifier<T>` — typed wrapper around an id value
- `DomainEvent` — base class for events raised by aggregates
- `DomainError` — base class for domain rule violations (distinct from `@synora/errors`'
  `AppError`, which is for application/infrastructure/presentation failures — see
  `docs/architecture/13-error-handling-standards.md`)

See `docs/architecture/08-domain-layer.md`.
