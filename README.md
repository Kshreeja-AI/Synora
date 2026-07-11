# Synora

Synora is a modular, provider-agnostic AI platform — the foundation for
multiple AI products, not a single application. It provides clean,
domain-independent building blocks for talking to LLMs, running
multi-agent workflows, remembering things long-term, reacting to events,
and staying secure and observable. **Kshreeja AI** is the first product
built on it.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design
and [`docs/adr/`](docs/adr) for the reasoning behind each major decision.

## What's in here

```
packages/
  core            domain entities + port interfaces (zero dependencies)
  config          validated environment configuration
  observability   structured logging, tracing, metrics
  event-bus       in-memory + Redis EventBus implementations
  providers       Anthropic + OpenAI ModelProvider adapters
  memory          working/episodic/semantic memory over in-memory or pgvector stores
  tools           zod-validated tool definitions + guarded executor
  orchestration   single-agent runtime + declarative multi-agent workflow engine
  security        API-key auth, scopes, rate limiting, guardrails
apps/
  gateway         the platform's HTTP API — composes every package via DI
  kshreeja-ai     the first product: agents, tools, and a workflow, built purely on the packages above
```

## Quickstart

```bash
cp .env.example .env        # add ANTHROPIC_API_KEY and/or OPENAI_API_KEY
pnpm install

# optional: only needed for the redis/pgvector drivers instead of the in-memory defaults
docker compose up -d postgres redis

pnpm build
pnpm --filter @synora/kshreeja-ai dev
```

Then:

```bash
curl -H "Authorization: Bearer dev-key.dev-secret" http://localhost:8080/v1/agents

curl -X POST http://localhost:8080/v1/chat \
  -H "Authorization: Bearer dev-key.dev-secret" -H "Content-Type: application/json" \
  -d '{"agentId": "kshreeja.coordinator", "message": "What is the capital of France?"}'
```

(`dev-key.dev-secret` comes from the default `API_KEYS` value in
`.env.example` — replace it before deploying anywhere real.)

## Building a new product on the platform

1. `mkdir apps/<product>`, add a `package.json` depending on
   `@synora/gateway`, `@synora/config`, `@synora/core`, `@synora/tools`.
2. Call `buildPlatformContainer(loadConfig())`.
3. Register your `AgentDefinition`s, tools (`defineTool`), and
   `WorkflowDefinition`s onto the returned container.
4. Call `createServer(container)` and `.listen()`.

No changes to `packages/*` are required — see `apps/kshreeja-ai/src/index.ts`
for the reference implementation.

## Scripts

| Command | What it does |
|---|---|
| `pnpm build` | Builds every package/app (via Turborepo) |
| `pnpm test` | Runs the vitest suite across the workspace |
| `pnpm typecheck` | Type-checks every package/app |
| `pnpm lint` | Runs Biome |
| `pnpm --filter @synora/kshreeja-ai dev` | Runs Kshreeja AI locally with hot reload |
| `pnpm --filter @synora/gateway dev` | Runs the bare platform gateway (no product agents registered) |

## License

MIT — see [`LICENSE`](LICENSE).
