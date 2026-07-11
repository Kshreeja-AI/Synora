# @synora/application

The **Application layer** kernel. Depends only on `@synora/domain` and `@synora/errors`
(part of the shared kernel — see `docs/architecture/03-service-boundaries.md` for why shared
kernel packages sit alongside domain/application rather than in the infrastructure ring).

Contains the building blocks every feature/plugin uses to write use cases:

- `UseCase<Input, Output>` — the interface every application use case implements
- `ApplicationError` — base class for application-layer failures (extends `@synora/errors`' `AppError`)
- Cross-cutting **ports** owned by the application layer because they're inputs to use cases,
  not outputs of them: `Clock` (testable time), `IdGenerator` (testable id creation)

Concrete implementations of these ports (`SystemClock`, `UuidGenerator`, ...) live in
infrastructure packages; fakes for tests live in `@synora/test-utils`.

- Platform-wide infrastructure **ports**: `Cache`, `Queue`, `VectorStore`, `LlmProvider`,
  `EmbeddingProvider`, `ObjectStorage`, `AuthProvider`, `WorkflowEngine` — one per default
  provider in `.env.example`. Each has exactly one concrete adapter in
  `packages/infrastructure/*`.
- `tokens.ts` — the `@synora/di` `Token`s for every port above, so plugins resolve them
  from the `Container` instead of importing a concrete adapter.

See `docs/architecture/09-application-layer.md`.
