# ADR-0005: Plugin model — `Plugin` + `PluginContext` + `PluginRegistry`, no manifest file

**Status:** Accepted

## Context

The platform needs to let product features register HTTP routes, DI bindings, and event
subscriptions without the platform kernel knowing about them at compile time (see
`06-plugin-architecture.md`).

## Decision

A `Plugin` is a plain object (`{ id, version, dependsOn?, register(context) }`) —
`register()` is a real function that does real DI/route/event registration by calling
methods on the `PluginContext` it receives, not a declarative JSON manifest interpreted by
a generic engine. `PluginRegistry.loadAll()` resolves load order from `dependsOn` via
topological sort.

## Alternatives considered

- **JSON/YAML manifest + convention-based file discovery** (à la many CMS plugin systems)
  — declarative and toolable, but for a TypeScript-first platform it trades away type
  safety and IDE navigability for a flexibility (loading plugins the platform's own build
  never saw) this platform doesn't currently need — every plugin is a workspace package,
  known at build time.
- **A heavier plugin framework with lifecycle hooks beyond register/(future) deregister**
  (`onStart`, `onStop`, `onHealthCheck`, ...) — deferred; `register()` covers everything
  the reference plugin needs. Additional lifecycle hooks are an additive change to the
  `Plugin` interface if/when a real plugin needs one, not a redesign.
- **No `dependsOn`/load-order resolution — plugins register independently in any order**
  — rejected because a plugin binding a DI token another plugin's routes need to resolve
  requires a defined order; silently depending on registration-call order (whatever order
  `PluginRegistry.register()` happened to be called in call sites) would be a footgun.

## Consequences

Every plugin is a workspace package resolved and bundled at build time — there's no
runtime plugin discovery/hot-loading in this pass (deferred; would be a filesystem/npm
package scanner added to `PluginRegistry` without changing the `Plugin` interface itself).
`PluginRegistry` throws hard errors (`DuplicatePluginError`,
`MissingPluginDependencyError`, `PluginDependencyCycleError`) rather than warning and
continuing — a broken plugin graph should fail application startup, not degrade silently.
