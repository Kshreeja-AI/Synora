# ADR-0006: `EventBus` port with an in-memory default and a NATS production adapter

**Status:** Accepted

## Context

`.env.example` specifies `DEFAULT_EVENT_BUS=nats` and `DEFAULT_MESSAGE_BUS=nats` (the same
underlying technology serving both concerns). Domain events need a transport that's swappable
without touching application/plugin code, and needs to work in tests/local dev without a
running NATS server.

## Decision

One `EventBus` port (`packages/shared/shared-event-bus`), two adapters: `InMemoryEventBus`
(same package — in-process `Map` of handlers, zero external dependency) and `NatsEventBus`
(`infra-nats` — one NATS subject per `event.eventName`, JSON payload). Both isolate
handler failures via an injectable `onHandlerError` callback instead of letting a bad
subscriber crash the publisher.

`apps/api-gateway`'s composition root wires `InMemoryEventBus` by default today rather
than eagerly connecting to NATS — see the consequences section.

## Alternatives considered

- **NATS JetStream (persistent streams) instead of core pub/sub** — deferred; core NATS
  pub/sub matches the in-memory adapter's at-most-once, fire-and-forget semantics closely
  enough to keep both adapters behaviorally interchangeable for now. JetStream (durable
  consumers, replay, exactly-once-ish delivery) is a legitimate future adapter
  (`infra-nats` could grow a second `JetStreamEventBus`) once a feature needs delivery
  guarantees beyond what core pub/sub offers — not a reason to complicate the port today.
- **A single adapter, no in-memory fallback** — rejected: every unit test that exercises a
  use case publishing a domain event would otherwise need a real NATS server, which is
  slow and makes tests flaky in CI. `plugins/example-task`'s use-case tests run entirely
  against `InMemoryEventBus`.
- **Eagerly connecting to NATS in the reference composition root** — rejected: it would
  make every environment without a reachable NATS server fail to boot the app at all, even
  though nothing currently publishes/subscribes across process boundaries. See the scope
  note in `04-dependency-injection.md`.

## Consequences

Production deployments that need cross-process event delivery must explicitly swap the
composition root's `InMemoryEventBus` for a connected `NatsEventBus`
(`await createNatsConnection(...)` before building the container, then pass the bridged
client into `new NatsEventBus(...)`) — a two-line, well-documented change, not a design
gap; `infra-nats` and its tests already prove the adapter works.
