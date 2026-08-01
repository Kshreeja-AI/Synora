# Vector Database Abstraction — Architecture

## Overview

`apps/backend/src/vectordb/` is the provider-agnostic abstraction for
storing and searching vector embeddings. It mirrors the design of `src/ai/`
(text generation), `src/queue/` (background jobs), and `src/embeddings/`
(embedding generation): application code never talks to a vector database's
SDK/API directly, never picks a provider by name in business logic, and
never re-implements namespace isolation, permission enforcement, or bulk
write patterns per call site.

```
apps/backend/src/vectordb/
├── types.ts               Core contracts: VectorDBProvider, requests/results, errors
├── descriptor.ts            VectorDBProviderDescriptor — what a provider publishes about itself
├── registry.ts                VECTORDB_PROVIDER_REGISTRY — every known provider, priority order
├── resolver.ts                  resolveVectorDBProvider() — the only place selection happens
├── security.ts                    Input validation (dimensions, batch size, topK, delete-mode)
├── metrics.ts                       Per-provider, per-operation call/latency/error metrics
├── health.ts                          Metrics-derived health status
├── tracing.ts                          Structured span logging
├── service.ts                            VectorDBService — the orchestrator every caller uses
├── factory.ts                              Composition root: config -> wired VectorDBService
├── shared.ts                                HTTP helper + namespace-string builder
├── index.ts                                  Public API surface
├── providers/                                  5 provider files (see PROVIDERS.md)
└── __tests__/ + providers/*.test.ts              Unit tests for every module above
```

**Design principle**: a vector database is a distinct capability from
embeddings generation (`../embeddings/`) — it stores and searches vectors
that embeddings *produce*, with its own request/response shape (upsert/
query/delete against an index, not text-in-vector-out) and its own
production concerns (namespace isolation, metadata filtering, bulk write
batching) that have no equivalent in embeddings generation. It is a
sibling module, not a sub-feature.

## Call flow

```
getVectorDBService()                     (factory.ts, lazy singleton)
  └─ createVectorDBService()
       reads getConfig().vectordb
       ├─ initMetricsCollector()
       └─ initHealthChecker(metrics)
       → new VectorDBService(metrics, health, securityLimits)

upsert(vectors, { workspaceId, namespace? })
  1. validateWorkspaceId() / validateUpsertBatch()      (security.ts — dimension consistency, batch size)
  2. resolveVectorDBProvider()                          (resolver.ts — the only provider-selection point)
  3. chunk vectors into groups of provider.maxUpsertBatchSize
  4. for each group: provider.upsert({...})             (metrics recorded per group)
  5. return { upsertedCount }

query({ workspaceId, namespace?, vector, topK, filter?, permissionFilter? })
  1. validateWorkspaceId() / validateQueryVector()
  2. resolveVectorDBProvider()
  3. provider.query({...})                              (sparseVector/hybridAlpha stripped if !provider.supportsHybridSearch)
  4. matches.filter(permissionFilter)                   (defense-in-depth, always applied — see "Permission filtering" below)
  5. return { matches }

delete({ workspaceId, namespace?, ids? | filter? | deleteAll? })
  1. validateWorkspaceId() / validateDeleteRequest()     (exactly one of ids/filter/deleteAll)
  2. resolveVectorDBProvider()
  3. provider.delete({...})
```

Every operation is wrapped in a `tracing.ts` span and recorded in
`metrics.ts`, broken down by provider *and* by operation (`upsert`/`query`/
`delete`) — a slow query rate and a slow upsert rate are different signals.

## Namespace isolation vs. workspace isolation

Every operation takes a `VectorScope`: a mandatory `workspaceId` plus an
optional `namespace`. These are two distinct isolation levels:

- **Workspace isolation** is the tenant boundary — mandatory on every
  request, never optional, the same posture `../embeddings/`'s
  `workspaceId` requirement takes.
- **Namespace isolation** is finer-grained scoping *within* a workspace —
  e.g. separating a "documents" vector space from a "conversations" vector
  space in the same workspace, so a similarity search against one never
  returns matches from the other.

`shared.ts`'s `buildNamespace(workspaceId, namespace?)` computes the single
effective namespace string every provider adapter uses:
`` workspace:{workspaceId} `` or `` workspace:{workspaceId}:{namespace} ``.

**How each provider implements it** (see `PROVIDERS.md` for full detail):
only Pinecone has a genuinely native namespace concept. Qdrant, Weaviate,
and Milvus have no native namespace — this abstraction uses a single
collection/class per provider with the computed namespace string stored as
a filterable field, and every operation's filter always includes a match on
that field. pgvector stores it as an indexed `namespace` column. This keeps
provider adapters simple (no per-namespace collection lifecycle to manage)
at the cost of those four providers doing namespace filtering in the query
layer rather than at the storage-partition level — acceptable for the
workspace/namespace cardinality this application expects, and documented
here rather than silently assumed.

## Permission filtering

`QueryOptions.permissionFilter` is a caller-supplied predicate
(`(match: VectorMatch) => boolean`) applied to every returned match,
**always**, regardless of what the underlying provider's own filter
push-down supports. This matters because provider filter capability is
uneven: Pinecone and Qdrant push arbitrary metadata filters down to the
storage layer, but Weaviate and Milvus's adapters only push a fixed set of
fields (`namespace`, `workspaceId`, `conversationId`) into their native
filter — see `PROVIDERS.md`. A caller relying solely on `filter` for some
other field would get an *unfiltered* result from those two providers.
`permissionFilter` is provider-independent and enforced in `service.ts`
itself, so a caller can never accidentally get a permission leak from a
provider whose filter translation is incomplete.

## Bulk upsert & incremental indexing

`VectorDBService.upsert()` accepts any number of vectors and internally
chunks them into `provider.maxUpsertBatchSize`-sized groups — this is both
"bulk upsert" (pass a large array once) and "incremental indexing" (call
`upsertOne()`, a one-vector convenience wrapper, repeatedly after an
initial bulk load) through the exact same code path. There is no separate
"bulk mode" — a single record and a 10,000-record array are the same
operation at different scale, batched transparently.

## Delete operations

Three delete modes, mutually exclusive (`security.ts` enforces exactly
one is set):

- **`ids`** — delete specific vector ids.
- **`filter`** — delete every vector matching a `MetadataFilter`.
- **`deleteAll`** — delete every vector in the given scope (namespace, or
  the entire workspace if `namespace` is omitted).

Two convenience methods build on `filter`/`deleteAll`:
- **`deleteByWorkspace(workspaceId)`** — `deleteAll: true` with no namespace, removing every vector across every namespace in that workspace.
- **`deleteByConversation(workspaceId, conversationId)`** — `filter: { conversationId: { eq: conversationId } }`, the concrete use case Release 3's conversation deletion needs.

## Similarity search & hybrid-ready interface

`query()` performs dense-vector similarity search (cosine, by convention —
every provider adapter here configures cosine distance/similarity). The
request also accepts an optional `sparseVector` (indices/values pair) and
`hybridAlpha` for **hybrid** (dense + sparse) search — `VectorDBService`
strips both before calling a provider whose `supportsHybridSearch` is
`false`, so passing them is always safe regardless of which provider is
active; only Pinecone's adapter currently honors them (see `PROVIDERS.md`
for why the others don't yet). This is "hybrid-ready" rather than
"hybrid-complete": the interface shape is final, so wiring in Qdrant's or
Weaviate's native hybrid support later is an adapter-only change, not an
interface change.

## Configuration

Non-secret settings live in `getConfig().vectordb` (see
`src/config/schema.ts`), following the same stage-defaults + environment
override pattern as every other subsystem. Connection secrets
(`PINECONE_API_KEY`, `QDRANT_API_KEY`, `WEAVIATE_API_KEY`, `MILVUS_TOKEN`)
live in `SecretsManager`, read directly by each provider's descriptor.
Every environment variable is documented in `apps/backend/.env.example`.

## Health & observability

- `getVectorDBMetricsCollector().getMetrics(providerId)` — call counts,
  error rates, vector volume, and average latency, broken down by
  `upsert`/`query`/`delete`.
- `getVectorDBHealthChecker().check(providerId)` — `healthy`/`degraded`/
  `unhealthy`, derived from the combined error rate across all three
  operations rather than a separate network ping: every operation is
  already an HTTP round-trip whose success/failure is recorded, so a
  dedicated ping would just be one more request telling us nothing a real
  operation hasn't already told us more recently.
- Structured tracing (`tracing.ts`): every `upsert()`/`query()`/`delete()`
  call is wrapped in a span logged at `debug` level, the same approach
  `../embeddings/tracing.ts` takes.

None of these are wired to an HTTP endpoint by this phase — exposing them
is left to whichever route/dashboard consumes them.

## Best practices

1. **Always pass a real `workspaceId`.** It is the tenant isolation
   boundary for every operation.
2. **Use `namespace` to separate unrelated vector spaces within one
   workspace** (e.g. "documents" vs. "conversations"), not to partition by
   tenant — that's what `workspaceId` is for.
3. **Always supply `permissionFilter` on any query whose results are shown
   to an end user**, not just a `filter` condition — it's the only
   enforcement guaranteed to apply across every provider.
4. **Prefer `upsert()` with an array over looping `upsertOne()`** when
   indexing more than a handful of vectors — it batches provider calls.
5. **Use `deleteByConversation()`/`deleteByWorkspace()`** for their
   respective use cases rather than hand-building an equivalent `filter`/
   `deleteAll` call — same effect, less room for a typo'd field name.
