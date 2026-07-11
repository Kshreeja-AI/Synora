# Presentation Layer

`apps/api-gateway` is the platform's one presentation-layer app today (Fastify) and its
**composition root** — see `04-dependency-injection.md` for what that means. A future
second app (a worker process, a CLI, a different transport) would live alongside it under
`apps/*`, each with its own composition root reusing the same kernel/infra/plugin packages.

## Request flow

1. `main.ts` loads `AppConfig` (`@synora/config`), builds the root `Logger`
   (`@synora/logger`), calls `buildServer()`, then `listen()`s and wires
   `SIGTERM`/`SIGINT` → graceful `app.close()`.
2. `server.ts` builds the Fastify instance: a request-scoped correlation id (via
   `@synora/logger`'s `runWithCorrelationId`, attached in an `onRequest` hook so every log
   line for that request carries it — see `14-logging-standards.md`), the global error
   handler, the `/health` route, then `buildCompositionRoot()` (DI container + event bus)
   and a `PluginRegistry` that loads every plugin (currently just
   `plugins/example-task`'s `exampleTaskPlugin`).
3. Each plugin's `register(context)` calls `context.routes.route(...)` — adapted to real
   Fastify routes by `fastify-route-registrar.ts`, the only file that bridges
   `@synora/plugin-system`'s framework-agnostic `RouteRegistrar` to Fastify.

## The `ApiResponse` envelope

Every HTTP response (success or error) is `@synora/types`' `ApiResponse<T>`:
`{ success: true, data }` or `{ success: false, error: { code, message, details? } }`.
`error-handler.ts` is the one file that knows both `AppError` and this envelope together —
it maps `AppError.httpStatus`/`code`/`isOperational` (falling back to a generic message
for non-operational errors, logging the real one) to the response; unexpected
non-`AppError` throws become a generic `500`.

## Why Fastify specifically isn't leaked anywhere else

No plugin, no use case, no port imports anything from `fastify`. That's the entire point
of `RouteRegistrar`/`HttpRequest`/`HttpResponse` being framework-agnostic types owned by
`@synora/plugin-system` rather than Fastify types re-exported from there — a future
transport swap (or a second transport running alongside Fastify) touches
`fastify-route-registrar.ts` and nothing else.
