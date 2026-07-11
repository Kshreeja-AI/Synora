# Plugin Architecture

`@synora/plugin-system` lets a product feature register itself with the platform without
the platform core knowing about it at compile time. See `ADR-0005`.

## The model

```ts
interface Plugin {
  id: string;
  version: string;
  dependsOn?: readonly string[];
  register(context: PluginContext): void | Promise<void>;
}

interface PluginContext {
  container: Container; // @synora/di — resolve platform ports here
  eventBus: EventBus; // @synora/event-bus
  logger: Logger; // pre-scoped per plugin by the loader
  config: AppConfig;
  routes: RouteRegistrar; // framework-agnostic HTTP route registration
}
```

`register()` is where a plugin does its own composition: build its repository from a
resolved DB handle, construct its use cases, register its HTTP routes, subscribe to
events. `PluginRegistry.register(plugin)` collects plugins; `loadAll(context)` resolves
load order from `dependsOn` (topological sort — throws `PluginDependencyCycleError` or
`MissingPluginDependencyError` if the graph is invalid) and calls each plugin's
`register(context)` in that order.

## Why a framework-agnostic `RouteRegistrar`

`PluginContext.routes` is `{ route(method, path, handler) }` where `handler` takes a
plain `HttpRequest` and returns a plain `HttpResponse` — no Fastify types anywhere in
`@synora/plugin-system` or in a plugin's `src/presentation`. `apps/api-gateway`'s
`createFastifyRouteRegistrar` is the only place that bridges this to Fastify. Swapping web
frameworks means rewriting one adapter file, not every plugin's routes.

## Reference implementation

`plugins/example-task` is a complete example of the pattern: its own
`domain`/`application`/`infrastructure`/`presentation`, composed together in `plugin.ts`.
It is explicitly **not** a real product feature (see its README) — delete it once one
exists. It exists so this document describes something that actually runs and is tested,
not a hypothetical.

## What a plugin must never do

Import another plugin's internals directly (only the platform kernel and
`packages/infrastructure/*`), or reach for `process.env`/a concrete adapter instead of
resolving a port token from `context.container`. Both are enforced the same way as the
rest of the dependency rule — see `03-service-boundaries.md`.
