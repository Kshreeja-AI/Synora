# @synora/api-gateway

The **Presentation layer** entrypoint and the platform's **composition root** — the one
place that knows about every concrete infra adapter and wires them to the ports defined in
`@synora/application`. See `docs/architecture/11-presentation-layer.md`.

```
src/
  config.ts               loads AppConfig (@synora/config) once at startup
  logger.ts                creates the root Logger (@synora/logger)
  adapters/                trivial system adapters with no natural infra-* home (SystemClock, CryptoIdGenerator)
  composition-root.ts      builds the DI Container, binds every port to its default adapter
  fastify-route-registrar.ts   adapts @synora/plugin-system's framework-agnostic RouteRegistrar to Fastify
  error-handler.ts         maps AppError -> HTTP response (the one place that knows the ApiResponse envelope + AppError together)
  health.route.ts          GET /health
  server.ts                builds the Fastify instance, request correlation-id hook, loads plugins
  main.ts                  process entrypoint: load config -> build server -> listen -> graceful shutdown
```

**Scope note:** `AUTH_PROVIDER` (better-auth) and `WORKFLOW_ENGINE` (Temporal) are _not_
wired into the composition root yet — both require a live external service to connect to
(a configured better-auth instance, a reachable Temporal server) that no current feature
needs. Wiring them is a two-line addition once a real plugin requires them — see the
comment in `composition-root.ts`.

Run locally: `pnpm --filter @synora/api-gateway dev` (requires `DATABASE_URL` for the
example plugin's `/tasks` routes to actually persist; `GET /health` works with no external
services at all).
