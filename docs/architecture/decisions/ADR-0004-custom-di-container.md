# ADR-0004: Custom minimal DI container over InversifyJS/tsyringe/awilix

**Status:** Accepted

## Context

The platform needs dependency injection to let the composition root bind ports to
adapters and let plugins resolve platform services without importing concrete adapters
directly (see `04-dependency-injection.md`).

## Decision

Build a small, explicit container in `@synora/di` (`Container.register`/`registerValue`/
`resolve`/`createScope`, `Token<T>` identity-by-reference) rather than adopting an
existing DI library.

## Alternatives considered

- **InversifyJS** — mature, widely used, but its idiomatic API leans on
  `@injectable()`/`@inject()` decorators and `reflect-metadata`, which requires
  `experimentalDecorators`/`emitDecoratorMetadata` compiler flags that interact poorly
  with `verbatimModuleSyntax` and pure-ESM output (`"type": "module"`, `NodeNext`
  resolution) — exactly the module system this platform standardizes on (see
  `12-coding-standards.md`). Usable without decorators, but then most of the ergonomic
  benefit disappears and it's a large dependency for a plain container.
- **tsyringe** — same decorator/`reflect-metadata` dependency, same friction with the
  chosen module system; also less actively maintained.
- **awilix** — no decorators (closer fit), but its "auto-resolve by constructor parameter
  name" convention mode is fragile under minification/bundling and its more explicit mode
  ends up close to what a from-scratch container this small would look like anyway.
- **No DI container — manual wiring everywhere** — works for a small app, but the platform
  is explicitly meant to support many plugins resolving platform ports; without a
  container every plugin would need the full concrete adapter graph threaded through it
  manually, defeating the "plugins depend on ports, not adapters" goal (ADR-0011).

## Consequences

The container is intentionally minimal — three lifecycles (`singleton`/`transient`/
`scoped`), no auto-wiring, no decorators. Every binding is explicit in
`composition-root.ts`, which is more verbose than decorator-based auto-wiring but keeps
the entire object graph readable in one file and has zero dependency on `reflect-metadata`
or non-standard TS compiler behavior. If the platform later needs constructor
auto-wiring or more advanced lifecycle management, that's an additive change to
`@synora/di` (or, if it grows enough, a point to revisit this ADR) — not a rewrite of
every consumer, since consumers only see `Token`/`Container`.
