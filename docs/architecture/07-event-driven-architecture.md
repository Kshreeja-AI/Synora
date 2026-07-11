# Event-Driven Architecture

## Domain events

An `AggregateRoot` (`@synora/domain`) records `DomainEvent`s as it mutates
(`protected addDomainEvent(event)`), without publishing them itself — publishing is an
application-layer concern (a use case decides _when_ it's safe to publish, typically after
a successful `repository.save(...)`). `pullDomainEvents()` drains and returns the queued
events. See `plugins/example-task/src/domain/task.ts`'s `Task.create`/`Task.complete` for
a concrete example, and `create-task.use-case.ts` for the publish-after-save pattern:

```ts
await this.repository.save(task);
await this.eventBus.publishAll(task.pullDomainEvents());
```

## The `EventBus` port

`@synora/event-bus` defines:

```ts
interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  publishAll(events: readonly DomainEvent[]): Promise<void>;
  subscribe<E extends DomainEvent>(eventName: string, handler: EventHandler<E>): Unsubscribe;
}
```

Two adapters implement it identically from the caller's point of view:

- **`InMemoryEventBus`** (in `@synora/event-bus` itself) — in-process `Map` of handlers,
  used in every unit test and as the default in `apps/api-gateway`'s composition root
  today (see the scope note in `04-dependency-injection.md` and `ADR-0006` for why NATS
  isn't the eager default).
- **`NatsEventBus`** (`packages/infrastructure/infra-nats`) — one NATS subject per
  `event.eventName`, JSON over the wire. Swapping the composition root from
  `InMemoryEventBus` to a connected `NatsEventBus` requires no changes anywhere else,
  because both satisfy the same `EventBus` interface.

A subtlety worth knowing: events published over NATS cross the wire as plain JSON, so a
subscriber receives a structurally-identical object, not an `instanceof DomainEvent`.
Handlers should only rely on the event's own fields (`eventName`, `occurredAt`,
`aggregateId`, and whatever fields the concrete event class adds) — never on `instanceof`
or prototype methods.

## Handler isolation

Both adapters isolate a throwing handler from other handlers subscribed to the same event
— one bad subscriber must never take down the publisher or other subscribers. Errors are
routed to an injectable `onHandlerError` callback (defaults to `console.error`) instead of
propagating, so the composition root can route them into `@synora/logger` — see
`composition-root.ts`.
