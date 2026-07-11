# ADR-0011: Ports owned by the application layer, one default adapter per `.env.example` provider

**Status:** Accepted

## Context

`.env.example` commits the platform to a specific set of default providers (Postgres,
Redis, Qdrant, NATS, OpenRouter, better-auth, S3-compatible storage, Temporal) while the
platform overall must stay provider-agnostic at its core — swapping any one of these later
must not require touching domain/application/plugin code.

## Decision

Every provider gets: (1) a port interface owned by `@synora/application`
(`Cache`, `Queue`, `VectorStore`, `LlmProvider`, `EmbeddingProvider`, `ObjectStorage`,
`AuthProvider`, `WorkflowEngine` — plus `EventBus` in the shared kernel and
`SecretManager` alongside `@synora/config`, both for reasons specific to those two, see
ADR-0006/ADR-0007), and (2) exactly one concrete adapter package under
`packages/infrastructure/` implementing it against the `.env.example` default, built
against a minimal hand-rolled `*Like` interface rather than the vendor SDK type directly
(so tests never need the real service running — see `10-infrastructure-layer.md`).

## Alternatives considered

- **Adapters implementing the vendor SDK's interface directly, no port** — rejected; this
  is exactly the coupling "provider-agnostic" rules out. A plugin depending on
  `ioredis.Redis` directly instead of `Cache` can never be pointed at a different cache
  without touching that plugin.
- **A registry/factory pattern where the _port_ itself decides which adapter to construct
  based on config** (e.g. `Cache.create(config)` branching internally on
  `providers.cache`) — rejected; this would put infrastructure-selection logic inside the
  application layer (which must not know Redis exists), and duplicates what the DI
  container's binding already does at the composition root. The composition root is the
  single place provider selection happens.
- **One infra package covering multiple unrelated ports** (e.g. combining `infra-redis`
  and `infra-postgres` into one "infra-storage" package) — rejected for the two ports that
  _do_ share a package (`infra-redis` covers both `Cache` and `Queue`) that decision was
  made because both ride the same Redis connection, not because they're conceptually
  related; ports without that shared-connection justification stay in separate packages
  (see the port/package table in `10-infrastructure-layer.md`).

## Consequences

Not every port has a bound adapter in the reference composition root yet
(`AUTH_PROVIDER`, `WORKFLOW_ENGINE` — see `04-dependency-injection.md`'s scope note) even
though the adapter package and its tests exist and pass. This is intentional: an adapter
existing and being tested is decoupled from whether the _current_ composition root chooses
to eagerly construct it, which matters specifically for adapters whose vendor client
connects at construction time.
