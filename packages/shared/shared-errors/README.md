# @synora/errors

Part of the **shared kernel** (see `docs/architecture/03-service-boundaries.md`) — zero
dependencies, usable from the application layer upward. See
`docs/architecture/13-error-handling-standards.md` and ADR-0008 for the full standard;
summary:

- **`AppError`** — abstract base for every _expected_, handled failure that crosses a
  layer boundary (application/infrastructure/presentation). Carries a stable `code`,
  an `httpStatus` for presentation-layer mapping, and `isOperational` (operational errors
  are safe to expose a message for; programmer errors are not).
- Common concrete subclasses: `ValidationError`, `NotFoundError`, `ConflictError`,
  `UnauthorizedError`, `ForbiddenError`, `InfrastructureError`.
- **`Result<T, E>`** — `Ok`/`Err` union for _expected_-failure return values inside a layer
  (e.g. a use case returning "task not found" is often better modeled as a `Result` than a
  thrown error — reserve exceptions for truly exceptional/unexpected failures).

Note: the **domain layer** does not depend on this package — `@synora/domain`'s
`DomainError` is intentionally separate (see that package's README).
