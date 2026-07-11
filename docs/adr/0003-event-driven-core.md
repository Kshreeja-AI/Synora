# 0003: Event-driven core via a swappable `EventBus`

## Status
Accepted

## Context
Cross-cutting concerns (observability, audit, billing, future products
reacting to another product's agent activity) shouldn't require the
publisher (`AgentRuntime`, `Orchestrator`) to know who's listening, and
shouldn't require a rewrite when we go from one gateway instance to many.

## Decision
`packages/core` defines `EventBus` (`publish`/`subscribe`) and a
`DomainEvent` envelope, plus a catalog of well-known event type strings
(`PlatformEvents`). `packages/event-bus` ships two implementations:
`InMemoryEventBus` (in-process fan-out, used by default and in tests) and
`RedisEventBus` (Redis pub/sub, for multi-instance deployments) — both
satisfy the identical interface, selected by the `EVENT_BUS_DRIVER`
config value. `AgentRuntime` and `Orchestrator` publish at every
meaningful transition (run started/completed/failed, tool
invoked/completed/failed, memory written/retrieved, guardrail blocked,
workflow step started/completed, agent handoff).

## Consequences
- A subscriber added later (e.g. a billing product metering agent runs)
  needs zero changes to orchestration code.
- `InMemoryEventBus` isolates a throwing subscriber from the publisher
  and from other subscribers — one broken listener can't break agent
  execution.
- Redis pub/sub is fire-and-forget (no delivery guarantee, no replay).
  That's an accepted tradeoff for a state-change notification bus, not
  a durable event log; a product needing exactly-once delivery or replay
  should consume events into its own store via a subscriber, not expect
  the bus itself to provide it.
