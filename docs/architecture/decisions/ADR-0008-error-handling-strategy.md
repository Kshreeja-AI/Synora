# ADR-0008: `AppError` hierarchy (separate from `DomainError`) + `Result<T,E>` for expected-failure flows

**Status:** Accepted

## Context

The platform needs one consistent way for failures to cross layer boundaries and reach the
presentation layer as a well-formed HTTP response, without domain logic depending on
HTTP concepts, and without every use case being forced into a `Result`-returning style
even when a plain thrown error is clearer.

## Decision

- `AppError` (`@synora/errors`) — abstract base with `code`/`httpStatus`/`isOperational`,
  used for application/infrastructure/presentation failures. Concrete subtypes cover the
  common cases (`ValidationError`, `NotFoundError`, `ConflictError`, `UnauthorizedError`,
  `ForbiddenError`, `InfrastructureError`).
- `DomainError` (`@synora/domain`) — separate hierarchy, zero dependencies, for business
  rule violations. See `08-domain-layer.md` for the full rationale.
- `Result<T, E>` (`@synora/errors`) — available for use cases/adapters where an expected
  failure is a normal outcome worth modeling in the return type rather than the control
  flow, used selectively rather than as the default return shape for every use case.

## Alternatives considered

- **One error hierarchy for everything, including domain** — rejected; would force
  `@synora/domain` to depend on `@synora/errors`, breaking its zero-dependency guarantee
  (see ADR-0002/`08-domain-layer.md`) for what would be a purely cosmetic simplification.
- **`Result<T, E>` as the mandatory return type for every use case** (an "errors as
  values" style throughout) — considered and rejected as the default: it makes every
  caller of every use case handle a `Result` even for failures that are genuinely
  exceptional (a DB connection dropped mid-query), adding boilerplate without a
  corresponding benefit for those cases. `Result` remains available and is the right
  choice for specific expected-failure flows — a documented option, not a blanket rule.
- **Exceptions only, no `Result` type at all** — rejected; some expected-failure flows
  (e.g., a private repository helper distinguishing "not found" from "found") read more
  clearly and test more easily as a `Result` than as a throw/catch, and the type is nearly
  free to have available.

## Consequences

Contributors need to internalize the `isOperational` distinction correctly — getting it
backwards on a new `AppError` subtype means either leaking an internal error message to a
client (`isOperational: true` on something that shouldn't be) or hiding a legitimately
user-facing message (`isOperational: false` on something that should surface). Code review
for a new error subtype should check this explicitly.
