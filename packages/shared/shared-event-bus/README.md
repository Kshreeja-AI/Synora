# @synora/event-bus

Part of the **shared kernel** (depends only on `@synora/domain`, for the `DomainEvent`
base type). Defines the `EventBus` port and ships one adapter, `InMemoryEventBus`,
suitable for unit tests and single-process development.

The production adapter, backed by NATS (`DEFAULT_EVENT_BUS=nats` /
`DEFAULT_MESSAGE_BUS=nats`), lives in `packages/infrastructure/infra-nats` — it implements
the exact same `EventBus` interface, so application/plugin code that only depends on this
port never knows which transport is behind it. See
`docs/architecture/07-event-driven-architecture.md` and ADR-0006.

Typical flow: an `AggregateRoot` records `DomainEvent`s → a use case calls
`repository.save(aggregate)` then `eventBus.publishAll(aggregate.pullDomainEvents())` →
subscribers (other use cases, other plugins) registered via `eventBus.subscribe(eventName, handler)`
react asynchronously.
