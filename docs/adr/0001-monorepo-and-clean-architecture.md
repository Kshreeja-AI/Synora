# 0001: Monorepo with clean-architecture package layering

## Status
Accepted

## Context
Synora must support multiple future products (Kshreeja AI first, others
later in research, automation, education, software development, business
operations, and creative AI) sharing one platform, without those products
ending up coupled to each other or to the platform's internal wiring.

## Decision
- A single pnpm + Turborepo monorepo with `packages/*` (platform) and
  `apps/*` (products + the gateway).
- `packages/core` holds domain entities and port interfaces only, with
  zero runtime dependencies. Every other package depends inward on it;
  it depends on nothing.
- Infrastructure packages (`providers`, `memory`, `event-bus`, `security`,
  `observability`) each implement one or more `packages/core` ports.
- Application packages (`orchestration`, `tools`) compose ports into
  behavior (the agent loop, the workflow engine) without knowing which
  concrete implementation is wired in.
- `apps/gateway` is the composition root: it is the only place that
  imports concrete implementations and wires them into a
  `PlatformContainer`.
- `apps/<product>` imports `apps/gateway`'s `buildPlatformContainer` /
  `createServer`, registers its own agents/tools/workflows, and starts
  its own process. Products never import each other.

## Consequences
- Adding a product never requires touching `packages/*`.
- Swapping an implementation (e.g. `InMemoryEventBus` → `RedisEventBus`)
  is a config change, not a code change, anywhere above `packages/event-bus`.
- The cost: an extra layer of indirection (ports + DI) for what could,
  for a single product, be simpler direct calls. Accepted deliberately —
  the whole point of this repo is to not be a single product.
