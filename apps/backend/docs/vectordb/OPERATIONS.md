# Vector Database — Operations Guide

Covers security limits, metrics, health, and troubleshooting for the
vector DB subsystem. See `ARCHITECTURE.md` for the call pipeline these sit
in, and `PROVIDERS.md` for per-provider specifics.

## Security

All enforced at the `VectorDBService` boundary (`security.ts`) — a
provider never receives input this application hasn't already judged safe
to send:

- **`workspaceId` required and non-empty** on every operation — the
  tenant isolation boundary.
- **`maxDimensions`** (default 4096, `VECTORDB_SECURITY_MAX_DIMENSIONS`) —
  rejects an oversized vector before it reaches a provider.
- **`maxUpsertRequestSize`** (default 1000,
  `VECTORDB_SECURITY_MAX_UPSERT_REQUEST_SIZE`) — caps a single `upsert()`
  call's total vector count, independent of any individual provider's own
  (smaller) per-request batch limit, which `VectorDBService` handles by
  internally grouping into `provider.maxUpsertBatchSize`-sized chunks.
- **Dimension consistency** — every vector in one `upsert()` batch must
  have the same dimensionality (`VectorDBDimensionMismatchError` if not);
  most vector databases require a fixed dimension per collection/index,
  so a batch straddling two dimensionalities would fail at the provider
  regardless — this fails fast with a clear error instead.
- **`maxTopK`** (default 1000, `VECTORDB_SECURITY_MAX_TOP_K`) — caps how
  many results a single `query()` can request.
- **Delete-mode exclusivity** — a `delete()` call must specify exactly one
  of `ids`/`filter`/`deleteAll`, never zero or more than one, so an
  ambiguous request (e.g. both `ids` and `deleteAll` set) is rejected
  rather than silently picking one interpretation.
- **pgvector SQL injection guard** — metadata filter field names are
  validated against a strict identifier regex before being interpolated
  into raw SQL (values are always parameterized separately); see
  `PROVIDERS.md`'s pgvector section.

## Permission Filtering (defense-in-depth)

`QueryOptions.permissionFilter` is enforced in `service.ts` on **every**
query, regardless of provider. This exists because provider filter
push-down capability is uneven — Weaviate and Milvus's adapters only push
a fixed field set (`namespace`/`workspaceId`/`conversationId`) into their
native filter, so relying solely on `filter` for a permission check on any
other field would silently pass unfiltered results through those two
providers. Always pass `permissionFilter` on any query whose results reach
an end user — see `ARCHITECTURE.md`'s "Permission filtering" section for
the full reasoning.

## Metrics

`getVectorDBMetricsCollector().getMetrics(providerId)` returns, broken down
by operation (`upsert`/`query`/`delete`):

- `calls` / `errors` / `errorRate`
- `totalVectors` — cumulative vector count across all calls of that
  operation (useful for tracking index growth rate)
- `avgLatencyMs`

Monitor `query.errorRate` and `query.avgLatencyMs` most closely — a search
provider degrading directly impacts user-facing latency, unlike `upsert`/
`delete`, which are typically background operations.

## Health

`getVectorDBHealthChecker().check(providerId)` derives `healthy`/
`degraded`/`unhealthy` from the *combined* error rate across all three
operations (>50% = unhealthy, >10% = degraded, else healthy — `healthy` by
default when there have been no calls yet, since zero calls is not
evidence of a problem). There is no separate network ping: every
`upsert()`/`query()`/`delete()` call is already an HTTP round-trip whose
outcome is recorded, so a dedicated health-check ping would just be one
more request telling us nothing a real operation hasn't already told us
more recently.

## Scaling Considerations

- **Bulk upsert throughput**: `VectorDBService.upsert()` issues one
  provider call per `provider.maxUpsertBatchSize`-sized group,
  sequentially. Indexing a very large corpus (millions of vectors) should
  be driven by a background worker (see `../queue/` — the
  `generate_embeddings` job type is a natural place to also call
  `upsertVectors()` once an embedding is produced) rather than a
  synchronous request handler.
- **pgvector at scale**: pgvector's `vector` index types (HNSW/IVFFlat)
  need to be created explicitly for large tables — this provider's
  `ensureTable()` only creates a plain B-tree index on `namespace`/
  `workspace_id`, not a vector similarity index, since the right index
  type/parameters are workload-dependent. Add one manually
  (`CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)`) once table
  size makes sequential-scan cosine distance too slow — this is an
  operational tuning step, not something the provider can safely
  auto-decide.
- **Qdrant/Weaviate/Milvus single-collection design**: every workspace and
  namespace shares one collection/class per provider (see
  `ARCHITECTURE.md`'s namespace-isolation section). This is simpler to
  operate (no per-tenant collection lifecycle) but means a single very
  large collection serves every workspace — appropriate for this
  application's expected workspace cardinality; a deployment with an
  extreme number of workspaces and very high per-workspace vector counts
  might eventually want per-workspace collections instead, which would be
  a provider-adapter change, not an interface change.

## Troubleshooting

| Symptom | Likely cause | Where to look |
|---|---|---|
| `NoVectorDBProviderConfiguredError` | No provider's secret/config is set | Set at least one of `PINECONE_API_KEY`+`VECTORDB_PINECONE_HOST`, `VECTORDB_QDRANT_URL`, `VECTORDB_WEAVIATE_URL`, `VECTORDB_MILVUS_URL`, or `VECTORDB_PGVECTOR_ENABLED=true` |
| `VectorDBDimensionMismatchError` on upsert | Mixed embedding models/dimensions in one batch | Ensure every vector in a single `upsert()` call came from the same embedding model |
| Query returns nothing after a successful upsert | Wrong `namespace`, or querying a different `workspaceId` | Namespace isolation is strict — confirm the same `workspaceId`/`namespace` pair used for upsert is used for query |
| Weaviate/Milvus filter on a custom field returns unfiltered results | That field isn't in the fixed filterable-field set for that provider | Use `permissionFilter` for enforcement instead of relying on `filter` for non-`namespace`/`workspaceId`/`conversationId` fields — see PROVIDERS.md |
| pgvector query is slow at scale | No vector similarity index (HNSW/IVFFlat) created | See "Scaling Considerations" above — create one manually for your workload |
| High `query.errorRate` in metrics | Provider outage, network issue, or rate limiting on the provider's side | Check the provider's own status page; consider whether `maxUpsertBatchSize`/`maxTopK` are set higher than the provider actually allows |
