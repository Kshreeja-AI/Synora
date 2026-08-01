# Vector Database Providers Reference

Every provider is a file under `apps/backend/src/vectordb/providers/`,
publishing a `VectorDBProviderDescriptor` (`id`, `displayName`,
`isConfigured()`, `create()`) registered in `registry.ts`. This document is
the per-provider reference; see `ARCHITECTURE.md` for how selection,
namespace isolation, and permission filtering work.

**None of these providers use a Node SDK.** Every one is called via the
runtime's native `fetch` against the provider's plain REST/GraphQL API
(`shared.ts`'s `requestJson()` helper) — consistent with
`../embeddings/providers/voyage.provider.ts` and `cohere.provider.ts`'s
precedent of not adding an HTTP client or vendor SDK dependency for a
single-endpoint integration. **No new runtime dependencies were added for
this module.**

## Pinecone (`pinecone`)

- **API**: Pinecone's data-plane REST API (`/vectors/upsert`, `/query`,
  `/vectors/delete`). Index-specific — each Pinecone index has its own
  host (e.g. `my-index-abc123.svc.us-east1-aws.pinecone.io`), so this
  provider requires an explicit `VECTORDB_PINECONE_HOST` rather than
  trying to auto-discover it via Pinecone's separate control-plane API —
  the same "no assumed defaults" posture `../ai/providers/ollama.provider.ts`
  takes for its base URL.
- **Activation**: `PINECONE_API_KEY` secret + `VECTORDB_PINECONE_HOST`.
- **Batch limit**: 100 (conservative default; Pinecone's actual limit is a
  2MB payload cap, commonly cited as ~1000 vectors for typical
  dimensionality, but that shrinks as dimension grows — configurable via
  `VECTORDB_PINECONE_MAX_UPSERT_BATCH_SIZE`).
- **Namespace**: native. Pinecone's own `namespace` field on every request
  is set directly to the computed namespace string.
- **Metadata filtering**: full — arbitrary fields, translated from this
  module's generic `{eq,ne,in,nin,gt,gte,lt,lte}` DSL to Pinecone's
  identical `$eq`/`$ne`/`$in`/... operators.
- **Hybrid search**: `supportsHybridSearch: true` — `sparseVector` is
  passed through to Pinecone's `query` endpoint as-is (requires a
  dot-product index configured for sparse-dense vectors on Pinecone's
  side; this adapter does not validate that the target index is
  configured correctly).
- First in `VECTORDB_PROVIDER_REGISTRY`'s priority order — the
  auto-detected default when only its key+host are configured.

## Qdrant (`qdrant`)

- **API**: plain REST (`/collections/{name}/points`, `/points/search`,
  `/points/delete`), self-hosted or Qdrant Cloud.
- **Activation**: `VECTORDB_QDRANT_URL` (e.g. `http://localhost:6333`);
  `QDRANT_API_KEY` only required for Qdrant Cloud or an auth-enabled
  instance.
- **Batch limit**: 500 (no official hard cap documented; conservative
  default, configurable via `VECTORDB_QDRANT_MAX_UPSERT_BATCH_SIZE`).
- **Namespace**: Qdrant has no native namespace concept — only
  collections. This adapter uses a single collection (`synora_vectors`,
  created lazily on first upsert once the vector dimensionality is known)
  with the computed namespace stored as a payload field (`_namespace`),
  matched on every operation.
- **Metadata filtering**: full — translated to Qdrant's `must`/`match`/
  `range` filter DSL.
- **Hybrid search**: `supportsHybridSearch: false`. Qdrant does support
  sparse vectors via named vectors, but that requires declaring a named
  sparse vector field on the collection upfront; not modeled by this
  adapter.

## Weaviate (`weaviate`)

- **API**: REST batch-objects endpoint for writes, GraphQL for search
  (Weaviate's canonical query interface), self-hosted or Weaviate Cloud.
- **Activation**: `VECTORDB_WEAVIATE_URL`; `WEAVIATE_API_KEY` only required
  for Weaviate Cloud or an auth-enabled instance.
- **Batch limit**: 200 (no official hard cap documented; conservative
  default, configurable via `VECTORDB_WEAVIATE_MAX_UPSERT_BATCH_SIZE`).
- **Namespace**: same "single class + filterable field" strategy as
  Qdrant — one fixed class (`SynoraVector`) with a `namespace` property.
- **Metadata filtering — constrained.** Weaviate requires a fixed,
  pre-declared schema (unlike Pinecone/Qdrant's arbitrary JSON metadata).
  This adapter declares exactly three queryable properties — `namespace`,
  `workspaceId`, `conversationId` — matching precisely what
  `deleteByWorkspace()`/`deleteByConversation()` need. A `MetadataFilter`
  condition on any *other* field is not pushed down into Weaviate's
  `where` clause; the full metadata is still round-tripped (as a
  `metadataJson` property) for `VectorDBService`'s `permissionFilter` to
  check post-query — see "Permission filtering" in `ARCHITECTURE.md` for
  why this constraint doesn't create a permission gap.
- **Score conversion**: Weaviate's GraphQL API returns cosine *distance*
  (lower = more similar); this adapter converts it to `1 - distance` so
  every provider in this module returns a "higher = better" score.
- **Hybrid search**: `supportsHybridSearch: false`. Weaviate has native
  BM25+vector hybrid search (`hybrid` GraphQL argument), not modeled by
  this adapter.

## Milvus (`milvus`)

- **API**: Milvus's native RESTful `/v2/vectordb/*` API (Milvus 2.3+, or
  Zilliz Cloud) — not the gRPC protocol, which would need a dedicated SDK
  dependency.
- **Activation**: `VECTORDB_MILVUS_URL`; `MILVUS_TOKEN` only required for
  Zilliz Cloud or an auth-enabled self-hosted instance.
- **Batch limit**: 500 (no official hard cap documented; conservative
  default, configurable via `VECTORDB_MILVUS_MAX_UPSERT_BATCH_SIZE`).
- **Namespace / metadata filtering**: same constrained strategy as
  Weaviate — one fixed collection (`synora_vectors`, created lazily on
  first upsert), scalar fields limited to `namespace`/`workspaceId`/
  `conversationId`, everything else round-tripped as `metadataJson` and
  left to `permissionFilter` for anything beyond those three fields.
  Filters are translated to Milvus's string expression syntax (e.g.
  `` namespace == "workspace:ws1" && conversationId == "c1" ``).
- **Hybrid search**: `supportsHybridSearch: false`. Milvus supports
  sparse-dense hybrid search, not modeled by this adapter.

## pgvector (`pgvector`)

- **Not a separate database at all.** Reuses the application's own
  PostgreSQL instance via the shared `prisma` singleton from
  `@synora/database`, and the `vector` extension. Manages its own
  dedicated `vector_embeddings` table through raw SQL
  (`CREATE EXTENSION IF NOT EXISTS vector` / `CREATE TABLE IF NOT EXISTS`,
  run lazily on first operation) — **not** a Prisma-modeled table in
  `packages/database/prisma/schema.prisma`. This keeps this module's
  changes entirely inside `src/vectordb/`, never touching the shared
  schema file other in-flight application work also depends on.
- **Activation**: `VECTORDB_PGVECTOR_ENABLED=true` — an explicit opt-in
  flag, not "is a connection secret present", since pgvector is always
  *reachable* (it's the same database every other part of the app already
  requires) and shouldn't silently win auto-detection over a purpose-built
  vector database just because both happen to be reachable in a given
  deployment.
- **Dimensionality**: fixed at table-creation time via
  `VECTORDB_PGVECTOR_DIMENSIONS` (default 1536, OpenAI's common embedding
  size) — pgvector's `vector(n)` column type requires a fixed size.
- **Batch limit**: 500 (conservative; Postgres's own parameter-count
  ceiling is the real limit, configurable via
  `VECTORDB_PGVECTOR_MAX_UPSERT_BATCH_SIZE`).
- **Namespace**: an indexed `namespace` column, filtered on every query —
  the simplest of every provider here, since it's a real relational column
  rather than a filter-on-JSON-payload workaround.
- **Metadata filtering**: `workspaceId`/`conversationId` are real indexed
  columns; every other field filters against the `metadata JSONB` column
  via `metadata ->> 'field'`. Field names are validated against a strict
  identifier regex before being interpolated into SQL (values are always
  parameterized via Prisma's `Prisma.sql` tagged templates) — field names
  can't be parameterized the way values can, so this is the injection
  guard for that path.
- **Hybrid search**: `supportsHybridSearch: false`. Would require a
  separate `tsvector` column and a rank-fusion query; not implemented.

## Adding a new provider

1. Add one file under `providers/your-provider.provider.ts` exporting a
   `VectorDBProviderDescriptor`.
2. Register it in `registry.ts`'s `VECTORDB_PROVIDER_REGISTRY` array.
3. Implement `upsert()`/`query()`/`delete()` against the provider's REST
   API via `shared.ts`'s `requestJson()`, computing the namespace via
   `buildNamespace()`.
4. If it has a connection secret, add it to
   `src/secrets/registry.ts`'s `SECRET_CATALOG`.
5. Add any non-secret config (base URL, batch size) to
   `src/config/schema.ts` + `defaults.ts` + `configLoader.ts`, and document
   the env vars in `.env.example`.

Nothing in `resolver.ts`, `service.ts`, or any application code that calls
`upsertVectors()`/`queryVectors()`/`deleteVectors()` needs to change.
