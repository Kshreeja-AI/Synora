# Dependency Injection

`@synora/di` is a minimal, explicit, ESM-native DI container — no decorators, no
`reflect-metadata`. See `ADR-0004` for why over InversifyJS/tsyringe/awilix.

## Core API

```ts
const token = createToken<MyPort>('MyPort');
container.register(token, (c) => new ConcreteAdapter(...), 'singleton'); // or 'transient' | 'scoped'
container.registerValue(token, alreadyConstructedValue);
const instance = container.resolve(token);
const scope = container.createScope(); // for per-request/per-plugin scoped lifecycles
```

`Token<T>` identity is the object reference, not its description string, so two tokens
with the same human-readable name never collide.

## Where tokens live

Platform-wide port tokens (`CLOCK`, `ID_GENERATOR`, `CACHE`, `QUEUE`, `VECTOR_STORE`,
`LLM_PROVIDER`, `EMBEDDING_PROVIDER`, `OBJECT_STORAGE`, `AUTH_PROVIDER`,
`WORKFLOW_ENGINE`) are exported from `@synora/application/src/tokens.ts` — the same
package that defines the port interfaces, since a token is just a typed handle for its
port. One exception: `POSTGRES_DATABASE` lives in `@synora/infra-postgres` itself, because
unlike the other ports there's exactly one concrete technology behind it and no
plugin-agnostic "port" abstraction makes sense for a raw Drizzle database handle — plugins
that need Postgres resolve this token directly and build their own repository on top
(see `plugins/example-task/src/infrastructure/postgres-task.repository.ts`).

## The composition root

`apps/api-gateway/src/composition-root.ts` is the **only** file in the repo that imports
both a port (from `@synora/application`) and its concrete adapter (from an `infra-*`
package) in the same place. Nothing in the domain, application, or plugin application
layers ever touches `Container` directly — they receive dependencies as constructor
parameters, which is what makes them unit-testable with zero DI machinery (see
`plugins/example-task/src/application/*.test.ts`, which construct use cases with plain
`new` and fakes from `@synora/test-utils`).

Plugins receive the container (already populated by the composition root) through
`PluginContext.container` and resolve what they need in `register()` — see
`06-plugin-architecture.md`.

## Scope note

Not every port is bound in `composition-root.ts` yet — `AUTH_PROVIDER` and
`WORKFLOW_ENGINE` are deliberately left unregistered because both adapters need a live
external service to construct safely (a configured better-auth instance; an actual
Temporal server connection), and no current feature resolves them. Wiring either is a
small, additive change once a feature needs it — the comment at the top of
`composition-root.ts` explains exactly what that change looks like.
