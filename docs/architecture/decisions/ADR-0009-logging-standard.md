# ADR-0009: pino-backed structured logging with `AsyncLocalStorage` correlation ids

**Status:** Accepted

## Context

Every layer needs to log, but layers above the shared kernel must not depend on a
specific logging library directly (that would be an infrastructure dependency leaking
into domain/application code), and request tracing needs to work across use cases and
plugin event handlers without threading a request id through every function signature.

## Decision

`@synora/logger` wraps `pino` behind a small `Logger` interface
(`fatal`/`error`/`warn`/`info`/`debug`/`trace`/`child`). Correlation ids propagate via
`node:async_hooks`' `AsyncLocalStorage` (`runWithCorrelationId`/`getCorrelationId`)
rather than being passed explicitly as a parameter.

## Alternatives considered

- **Winston** — comparable feature set to pino, but pino's JSON-first, low-overhead design
  (widely benchmarked as faster than Winston for structured JSON output) is the better fit
  for a platform that expects to run at meaningful request volume.
- **Passing a request-scoped logger/correlation id explicitly through every function
  call** — the more "pure" approach (no implicit context), but would require every port
  interface (`UseCase.execute`, every repository method, ...) to accept a context
  parameter purely for logging, polluting signatures that otherwise have nothing to do
  with observability. `AsyncLocalStorage` buys the same traceability without that
  signature pollution, at the cost of the implicit-context tradeoff below.
- **No correlation ids at all** — rejected; debugging a specific failed request across
  multiple use cases/plugin event handlers without one is materially harder.

## Consequences

`AsyncLocalStorage`-based implicit context is a well-known tradeoff: it's invisible in
function signatures (a reader can't tell a function relies on ambient correlation-id
context just by reading its type), and it only propagates correctly through code that
stays within the same async execution chain as the `runWithCorrelationId` call (true for
normal request-handling flow in this codebase, but would need care if a future feature
schedules genuinely detached background work, e.g. a `setInterval` started outside a
request). Every `PluginContext.logger` is pre-scoped per plugin
(`logger.child({ plugin: id })`), so this cost is paid once at the framework level, not by
every plugin author.
