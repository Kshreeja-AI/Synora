# Logging Standards

`@synora/logger` wraps `pino`. Nothing else in the codebase imports `pino` directly — the
`Logger` interface (`fatal`/`error`/`warn`/`info`/`debug`/`trace`, all
`(message: string, meta?: Record<string, unknown>) => void`, plus `.child(bindings)`) is
what every layer above the shared kernel depends on.

## Structured, not string-concatenated

Every call is `logger.info('Task created', { taskId, title })` — a message plus a
structured metadata object — never string interpolation of variables into the message.
Output is JSON in every environment except local dev (`pretty: true` when
`NODE_ENV=development`, using `pino-pretty`), so log lines are queryable in whatever
aggregator ingests them.

## Correlation ids

`runWithCorrelationId(id, fn)` (backed by `node:async_hooks`' `AsyncLocalStorage`) makes
`id` available to every `Logger` call made anywhere inside `fn` — including calls made
deep inside a use case or a plugin's event handler, with no need to thread a request id
through every function signature. `apps/api-gateway`'s `server.ts` sets this up in an
`onRequest` hook: the request's `x-correlation-id` header, or a freshly generated one, for
the lifetime of that request.

## Scoped loggers

`PluginContext.logger` (see `06-plugin-architecture.md`) is already
`logger.child({ plugin: id })` — every log line a plugin emits is automatically tagged
with which plugin emitted it, no manual bookkeeping required.

## Redaction

`createLogger()` configures pino's `redact` for common secret-shaped keys
(`password`, `token`, `apiKey`, `secret`, `authorization`) — logging an object that
happens to contain one of these keys never leaks the value, it's replaced with
`[REDACTED]`. Extending the redact list is a one-line change in
`packages/shared/shared-logger/src/logger.ts`.

## Level

Controlled by `LOG_LEVEL` (`.env.example`), read through `AppConfig`, never hardcoded.
