# @synora/infra-nats

**Infrastructure layer** adapter for `DEFAULT_EVENT_BUS=nats` / `DEFAULT_MESSAGE_BUS=nats`.
`NatsEventBus` implements the exact same `EventBus` port as `@synora/event-bus`'s
`InMemoryEventBus`, subject-per-event-name, so swapping between them (e.g. in-memory for
tests, NATS in production) requires no changes to application/plugin code.

Built against a minimal `NatsClientLike` interface rather than the concrete `nats`
`NatsConnection`, so tests inject a fake pub/sub instead of needing a live NATS server.
