# Application Layer

`@synora/application` depends only on `@synora/domain` and the shared kernel
(`@synora/errors`, `@synora/di`). It defines the shape every use case takes and the ports
every use case depends on — never a concrete implementation.

## `UseCase<Input, Output>`

```ts
interface UseCase<Input, Output> {
  execute(input: Input): Promise<Output>;
}
```

Every application-layer operation across the platform is a class implementing this — a
single, named, independently-testable unit of orchestration between the domain layer and
whatever ports it depends on. Presentation-layer code (HTTP controllers, event
subscribers, CLI commands) is the only caller of `execute()`; it never reaches into the
domain layer or a repository directly. See
`plugins/example-task/src/application/create-task.use-case.ts` for the canonical shape:
constructor-inject every port the use case needs, `execute()` orchestrates domain objects

- ports, nothing else.

## `ApplicationError`

`abstract class ApplicationError extends AppError` — the base for use-case-level failures
(validation, business-rule violations translated from a caught `DomainError`, ...). See
`13-error-handling-standards.md`.

## Ports owned by this layer

Two categories:

1. **Use-case-local ports**, defined by the feature that needs them (e.g.
   `plugins/example-task/src/application/task-repository.port.ts`'s `TaskRepository`) —
   these live with the feature, not in the platform kernel, because only that feature's
   infrastructure implements them.
2. **Platform-wide ports**, defined once in `packages/application/src/ports/*.ts` because
   every plugin might need them: `Clock`, `IdGenerator`, `Cache`, `Queue`, `VectorStore`,
   `LlmProvider`, `EmbeddingProvider`, `ObjectStorage`, `AuthProvider`, `WorkflowEngine`.
   Each has exactly one default adapter in `packages/infrastructure/*` (see
   `10-infrastructure-layer.md`) and a `@synora/di` `Token` exported from
   `packages/application/src/tokens.ts` for resolving it from the container.

`Clock`/`IdGenerator` exist specifically so use cases never call `new Date()` or
`crypto.randomUUID()` directly — going through a port keeps them deterministic under test
(`@synora/test-utils`' `FixedClock`/`SequentialIdGenerator`).
