# @synora/di

Part of the **shared kernel**. A minimal, explicit, ESM-native dependency injection
container — no decorators, no `reflect-metadata`, no magic. See
`docs/architecture/04-dependency-injection.md` and ADR-0004 for why a custom container
was chosen over InversifyJS/tsyringe/awilix.

- `createToken<T>(description)` — a typed injection token (identity is the object
  reference, not a string, so collisions are impossible).
- `Container` — `register`/`registerValue`/`resolve`/`createScope`, with `singleton`
  (default), `transient`, and `scoped` lifecycles.

The only place bindings are wired together is the **composition root**
(`apps/api-gateway/src/composition-root.ts`) plus each plugin's `register(context)` hook
— nothing inside the domain or application layers ever touches the container directly
(they receive their dependencies as constructor/function parameters, which is what makes
them testable without a container at all).
