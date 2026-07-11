# Infrastructure Layer

One package per concrete provider, each implementing exactly one port from
`@synora/application` (or a feature-local port, for repositories) against the
corresponding `.env.example` default. See `ADR-0011`.

| Package                   | Port                                                              | Provider (`.env.example`)                                                         |
| ------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `infra-postgres`          | _(client factory + error mapper; repositories are feature-owned)_ | `DEFAULT_DATABASE=postgres`                                                       |
| `infra-redis`             | `Cache`, `Queue`                                                  | `DEFAULT_CACHE=redis`, `DEFAULT_QUEUE=redis`                                      |
| `infra-qdrant`            | `VectorStore`                                                     | `DEFAULT_VECTOR_DATABASE=qdrant`                                                  |
| `infra-nats`              | `EventBus`                                                        | `DEFAULT_EVENT_BUS=nats` / `DEFAULT_MESSAGE_BUS=nats`                             |
| `infra-llm-openrouter`    | `LlmProvider`, `EmbeddingProvider`                                | `DEFAULT_LLM_PROVIDER=openrouter`, `DEFAULT_EMBEDDING_PROVIDER=openai-compatible` |
| `infra-auth-better-auth`  | `AuthProvider`                                                    | `DEFAULT_AUTH_PROVIDER=better-auth`                                               |
| `infra-storage-s3`        | `ObjectStorage`                                                   | `DEFAULT_OBJECT_STORAGE=s3-compatible` / `DEFAULT_STORAGE_PROVIDER=s3`            |
| `infra-secrets-env`       | `SecretManager`                                                   | `DEFAULT_SECRET_MANAGER=environment`                                              |
| `infra-workflow-temporal` | `WorkflowEngine`                                                  | `DEFAULT_WORKFLOW_ENGINE=temporal`                                                |

## The "*Like" client interface pattern

Every adapter's class takes a minimal hand-written interface (`RedisLike`,
`VectorClientLike`, `NatsClientLike`, `S3ClientLike`, `TemporalClientLike`,
`SessionResolverLike`, `FetchLike`) in its constructor — never the concrete vendor SDK
type directly. A separate factory function (`createRedisClient`, `createQdrantClient`, ...)
builds the real vendor client and, where needed, a small bridge to the `*Like` interface.
This means:

- Tests inject a fast in-memory fake instead of needing a live Postgres/Redis/Qdrant/NATS/S3/Temporal
  instance — see every `*.test.ts` in `packages/infrastructure/*`.
- The port and the vendor SDK's exact API surface are decoupled: a vendor SDK major version
  bump only touches the adapter and its factory function, never the port or its consumers.

## Error translation

Infrastructure adapters translate driver-specific failures into `@synora/errors`'
`InfrastructureError` (`isOperational: false`, `httpStatus: 502`) at the boundary — see
`infra-postgres`'s `mapPostgresError()`. Callers above the infrastructure layer only ever
see `AppError` subtypes, never a raw `pg`/`ioredis`/etc. error.

## Scope: what's eagerly connected vs. not

`composition-root.ts` (`apps/api-gateway`) constructs every adapter it binds, but vendor
clients that don't connect at construction time (Postgres `Pool`, `ioredis` with
`lazyConnect: true`, the Qdrant REST client, the S3 client, `fetch`-based LLM/embedding
providers) are safe to always wire. Adapters whose vendor client **does** connect eagerly
at construction (`infra-workflow-temporal`'s `Connection.connect`) are deliberately left
unbound in the reference composition root until a real feature needs them — see the scope
note in `04-dependency-injection.md`.
