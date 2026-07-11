# Error Handling Standards

## Two separate hierarchies, on purpose

- **`DomainError`** (`@synora/domain`) — business rule violations, zero dependencies,
  never carries an HTTP status (the domain layer doesn't know what HTTP is).
- **`AppError`** (`@synora/errors`, shared kernel) — every expected, handled failure that
  crosses an application/infrastructure/presentation boundary. Abstract fields every
  subclass must define: `code` (stable `SCREAMING_SNAKE_CASE`, safe to log and return to
  clients), `httpStatus`, `isOperational`.

See `08-domain-layer.md` for why these aren't unified into one hierarchy.

## `isOperational`

Operational errors (`ValidationError`, `NotFoundError`, `ConflictError`,
`UnauthorizedError`, `ForbiddenError`) are anticipated failure modes — their `.message` is
safe to send to a client. Non-operational errors (`InfrastructureError`) indicate
something broke that shouldn't have (a DB is unreachable, a driver threw something
unexpected) — the presentation layer's error handler logs the full error but returns a
generic message, never leaking internals. See `apps/api-gateway/src/error-handler.ts`.

## `Result<T, E>` vs. throwing

`@synora/errors` also exports `Result<T, E>` (`{ ok: true, value }` / `{ ok: false,
error }`, plus `ok()`/`err()`/`isOk()`/`isErr()` helpers) for **expected-failure flows
within a layer** where throwing would be overkill for a normal, common outcome (e.g. "no
rows matched this query" inside a repository's private helper). Reserve thrown `AppError`s
for failures that should short-circuit _across_ a layer boundary — a use case's `execute()`
signature stays `Promise<Output>`, not `Promise<Result<Output, SomeError>>`, unless the
caller genuinely needs to branch on a specific expected failure without a try/catch (rare;
most `AppError` subtypes are handled once, generically, by the presentation layer's error
handler — see `11-presentation-layer.md`).

## Translating errors across the domain → application boundary

A use case that catches a `DomainError` (e.g. `TaskAlreadyCompletedError`) is responsible
for deciding what that means for its caller — usually re-throwing it as (or wrapping it
in) an appropriate `ApplicationError`/`ConflictError` subtype, since `DomainError` itself
never crosses out of the application layer.

## Every concrete subclass needs its own constructor

`AppError` and `DomainError` both declare a `protected` constructor (only their own
subclasses may call `super()`). A concrete subclass that doesn't declare its own
constructor _inherits_ that `protected` accessibility — TypeScript will then refuse
`new SomeError(...)` from any other file, including sibling packages. Every concrete
error class must declare an explicit `constructor(...)` (even a trivial
`constructor(message: string) { super(message); }`) to become publicly constructible —
see every class in `common-errors.ts` for the pattern.

## Infrastructure adapters never leak vendor errors

Every `infra-*` adapter maps its vendor SDK's errors to `InfrastructureError` at the
boundary (e.g. `infra-postgres`'s `mapPostgresError()`). See `10-infrastructure-layer.md`.
