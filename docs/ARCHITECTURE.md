# Synora Architecture

Synora is a platform, not an application. It exists so that Kshreeja AI —
and every AI product built after it — shares the same foundation for
talking to models, remembering things, running agents, emitting events,
and staying secure and observable, without any product depending on
another product or on a specific vendor.

## Design goals

1. **Domain-independent.** Nothing under `packages/` knows what a
   "researcher agent" or a "support ticket" is. Domain concepts live in
   `apps/*` only.
2. **Provider-agnostic.** Swapping Anthropic for OpenAI (or adding a
   third vendor) is a new file in `packages/providers`, not a change
   anywhere else.
3. **Composable, not monolithic.** Every capability — memory,
   orchestration, guardrails, tracing — is a package with a narrow
   port (interface) in `packages/core` and one or more implementations.
   Callers depend on the port.
4. **Event-driven at the seams.** State transitions (agent started, tool
   invoked, memory written, guardrail blocked) are published as
   `DomainEvent`s. Observability, audit, billing, or a future product
   can subscribe without the publisher knowing they exist.
5. **Secure and observable by default.** Auth, rate limiting, guardrails,
   structured logs, traces, and metrics are wired into the gateway once;
   products inherit them for free.

## Layers

```
┌─────────────────────────────────────────────────────────────────┐
│ apps/kshreeja-ai, apps/future-product-2, ...                     │  ← domain-specific
│   agents, tools, workflows expressed as DATA over platform ports │
├─────────────────────────────────────────────────────────────────┤
│ apps/gateway                                                     │  ← interface layer
│   HTTP/SSE, auth, rate limiting, error mapping, DI composition   │
├─────────────────────────────────────────────────────────────────┤
│ packages/orchestration   packages/tools                          │  ← application layer
│   AgentRuntime, Orchestrator, workflow engine, tool executor      │
├─────────────────────────────────────────────────────────────────┤
│ packages/providers  packages/memory  packages/event-bus           │  ← infrastructure layer
│ packages/security   packages/observability  packages/config       │    (implements core ports)
├─────────────────────────────────────────────────────────────────┤
│ packages/core                                                     │  ← domain layer
│   Entities + ports only. Zero runtime dependencies. Everything    │
│   above depends inward on this; this depends on nothing.          │
└─────────────────────────────────────────────────────────────────┘
```

Dependencies only point downward/inward. `packages/core` never imports
from any other package. Products (`apps/*`) are the only place allowed
to know about a specific business domain.

## Package map

| Package | Responsibility |
|---|---|
| `@synora/core` | Domain entities (`Message`, `AgentDefinition`, `WorkflowDefinition`, ...) and port interfaces (`ModelProvider`, `EventBus`, `MemoryStore`, `Guardrail`, ...). No implementations. |
| `@synora/config` | zod-validated environment configuration, loaded once at process start. |
| `@synora/observability` | `Logger` (pino), `Tracer` (OpenTelemetry API), `MetricsRecorder` implementations. |
| `@synora/event-bus` | `EventBus` implementations: `InMemoryEventBus` (single process) and `RedisEventBus` (multi-instance), same interface. |
| `@synora/providers` | `ModelProvider` implementations: `AnthropicProvider`, `OpenAiProvider`, plus a registry and factory. |
| `@synora/memory` | `VectorStore` implementations (`InMemoryVectorStore`, `PgVectorStore`), `MemoryStore` (long-term recall), `ConversationStore` (working memory). |
| `@synora/tools` | `defineTool` (zod schema → validated tool + JSON Schema), `ToolRegistry`, guarded `executeTool`. |
| `@synora/orchestration` | `AgentRuntime` (single-agent tool-call loop with guardrails/memory/events) and `Orchestrator` (declarative multi-agent workflow graphs: sequence, parallel, condition, handoff). |
| `@synora/security` | `ApiKeyAuthenticator`, scopes, `RateLimiter`, built-in `Guardrail`s (prompt injection, PII, secret leakage) and a `GuardrailRegistry`. |
| `@synora/gateway` (app) | Composes every package into a `PlatformContainer` and exposes it as an HTTP API. Reusable: any product imports `buildPlatformContainer`/`createServer` instead of running the gateway standalone. |
| `@synora/kshreeja-ai` (app) | The first product: agent personas, tool grants, and a workflow, expressed as data over the ports above. Zero platform infrastructure of its own. |

## Provider-agnostic model calls

Everything above `packages/providers` calls `ModelProvider` (defined in
`packages/core/src/domain/provider.ts`):

```ts
interface ModelProvider {
  readonly id: string;
  readonly capabilities: { streaming; toolCalling; vision; embeddings };
  generate(options: GenerateOptions): Promise<GenerateResult>;
  stream(options: GenerateOptions): AsyncIterable<StreamEvent>;
  embed?(options: EmbeddingOptions): Promise<EmbeddingResult>;
}
```

`AnthropicProvider` and `OpenAiProvider` both implement it today. Adding
Bedrock, a self-hosted vLLM endpoint, or Gemini means writing one adapter
file and registering it in `createDefaultProviderRegistry` (or a
product's own registry) — no change to `AgentRuntime`, `Orchestrator`,
or any product code, because they only ever call `ModelProviderRegistry.get(id)`.

## Event-driven workflows

`packages/core` defines `EventBus` and a catalog of well-known event
types (`PlatformEvents.AgentRunStarted`, `.ToolInvoked`, `.MemoryWritten`,
`.GuardrailBlocked`, `.WorkflowStepCompleted`, ...). `AgentRuntime` and
`Orchestrator` publish these at every meaningful transition. Two
implementations exist today:

- `InMemoryEventBus` — synchronous fan-out within one process; used by
  default and in tests.
- `RedisEventBus` — pub/sub across processes, for when the gateway runs
  as more than one instance.

A subscriber (billing, audit log, a future analytics product) attaches
with `eventBus.subscribe('platform.agent_run.*', handler)` and never
needs the publisher to know it exists.

## Long-term memory

Three ports, three concerns:

- `ConversationStore` — the live, per-session transcript ("working
  memory"). `InMemoryConversationStore` ships today; swap for
  Redis/Postgres for multi-instance deployments.
- `VectorStore` — raw vector upsert/query/delete. `InMemoryVectorStore`
  (brute-force cosine similarity, fine for dev/small tenants) and
  `PgVectorStore` (Postgres + pgvector, for production) both implement it.
- `MemoryStore` — the domain-level port (`write`/`search`/`forget`)
  that `AgentRuntime` actually calls. `VectorMemoryStore` implements it
  by embedding content through an `EmbeddingProvider` and delegating to
  a `VectorStore`, with tenant/agent scoping baked into every query so
  agents (and tenants) never cross-contaminate recall.

## Multi-agent orchestration

- **`AgentRuntime`** runs one `AgentDefinition` end to end: input
  guardrails → memory recall → model call → tool-call loop (bounded by
  `maxToolRoundtrips`) → output guardrails → done, or a handoff. A
  handoff is implemented as a synthetic `handoff_to_agent` tool injected
  whenever `AgentDefinition.handoffTargets` is non-empty — the model
  decides when to hand off; the runtime just executes that decision.
- **`Orchestrator`** executes a declarative `WorkflowDefinition` graph —
  `sequence`, `parallel`, `condition`, `agent`, and `tool` steps — so a
  product can compose agents without writing imperative glue code. Agent
  steps transparently follow handoffs up to a configurable hop limit.
  Condition steps reference a named predicate registered via
  `registerCondition`, never `eval`'d code, so a stored/serialized
  workflow can't smuggle in arbitrary logic.

## Security model

- **AuthN**: `ApiKeyAuthenticator` resolves a `keyId.secret` bearer
  credential to a `Principal` (tenant, user, scopes) using constant-time
  comparison.
- **AuthZ**: scope-based (`agent:invoke`, `memory:read`, `memory:write`,
  `workflow:run`, `admin`); enforced per-route in the gateway via
  `requireScope`.
- **Rate limiting**: `InMemoryRateLimiter` (fixed window, per key) at the
  gateway edge; swap for a Redis-backed implementation behind the same
  `RateLimiter` interface for multi-instance deployments.
- **Guardrails**: pluggable `Guardrail`s run on model input and output.
  Platform ships prompt-injection, PII, and secret-leak heuristics;
  products register their own domain guardrails under their own names
  in a `GuardrailRegistry`.

## Observability

`Logger` (structured, redacts secrets by default), `Tracer` (thin
wrapper over `@opentelemetry/api` — the host process registers an actual
SDK/exporter, so instrumented code never couples to a specific backend),
and `MetricsRecorder` (counters/histograms/gauges) are ports in
`packages/core`, implemented in `packages/observability`. The gateway
logs every request, traces every chat call, and records latency
histograms out of the box.

## Adding a new product

1. Create `apps/<product>`.
2. Call `buildPlatformContainer(loadConfig())` from `@synora/gateway`.
3. Register your agents (`AgentDefinition`s), tools (`defineTool`), and
   workflows (`WorkflowDefinition`s) onto `container.agentRegistry` /
   `container.toolRegistry` / `container.workflows`.
4. Call `createServer(container)` and `.listen()`.

That's the entire integration surface — see `apps/kshreeja-ai/src/index.ts`
for the reference implementation. No platform package changes required.

## Local development

```bash
cp .env.example .env        # fill in ANTHROPIC_API_KEY / OPENAI_API_KEY
pnpm install
docker compose up -d postgres redis   # optional: only needed for pgvector/redis drivers
pnpm --filter @synora/core --filter @synora/config --filter @synora/observability \
     --filter @synora/event-bus --filter @synora/providers --filter @synora/memory \
     --filter @synora/tools --filter @synora/orchestration --filter @synora/security \
     --filter @synora/gateway --filter @synora/kshreeja-ai build
pnpm --filter @synora/kshreeja-ai dev
```

See `docs/adr/` for the reasoning behind each major decision.
