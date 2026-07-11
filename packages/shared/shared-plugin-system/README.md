# @synora/plugin-system

Part of the **shared kernel**. Lets product features (in `/plugins/*`) register themselves
with the platform — DI bindings, event subscriptions, HTTP routes — without the platform
core knowing about them at compile time. See `docs/architecture/06-plugin-architecture.md`
and ADR-0005.

- **`Plugin`** — `{ id, version, dependsOn?, register(context) }`. `register` is where a
  plugin wires its own composition (bind its ports to its adapters in the `Container`,
  subscribe to events, register HTTP routes).
- **`PluginContext`** — what a plugin receives: the DI `Container`, the `EventBus`, a
  `Logger` pre-scoped to the plugin (`logger.child({ plugin: id })`), the resolved
  `AppConfig`, and a `RouteRegistrar` (a framework-agnostic HTTP route registration hook —
  the actual Fastify wiring lives in `apps/api-gateway`, kept out of this package so the
  plugin system itself has no HTTP framework dependency).
- **`PluginRegistry`** — `register(plugin)` then `loadAll(context)`, which resolves load
  order from `dependsOn` (topological sort, throws on cycles or missing dependencies) and
  calls each plugin's `register(context)` in that order.
