# 0004: Long-term memory as layered ports (working / vector / domain)

## Status
Accepted

## Context
Agents need two different kinds of memory: the live conversation
transcript for the current session ("working memory"), and durable,
searchable recall across sessions ("long-term memory" — episodic,
semantic, procedural). These have different storage shapes, different
lifetimes, and different scaling stories, and the platform must not
force one storage technology on every future product.

## Decision
Three ports, three implementations layered on each other:
- `ConversationStore` (`append`/`history`/`clear`) — per-session
  transcript. `InMemoryConversationStore` today.
- `VectorStore` (`upsert`/`query`/`delete`) — raw vector storage, no
  domain knowledge. `InMemoryVectorStore` (brute-force cosine
  similarity) for dev/small tenants, `PgVectorStore` (Postgres +
  pgvector) for production, both behind `VECTOR_STORE_DRIVER`.
- `MemoryStore` (`write`/`search`/`forget`/`touch`) — the port
  `AgentRuntime` actually calls. `VectorMemoryStore` implements it by
  embedding content through an `EmbeddingProvider` and delegating to a
  `VectorStore`, injecting `tenantId`/`agentId`/`kind` into every
  record's metadata and every query's filter so recall never crosses
  tenant or agent boundaries even when they share one vector index.

## Consequences
- A product that doesn't need long-term memory just doesn't set
  `memoryEnabled: true` on its agents; the gateway leaves `memoryStore`
  undefined when no embedding credentials are configured, and routes
  that depend on it return 503 rather than crashing.
- Moving from `InMemoryVectorStore` to `PgVectorStore` is a config
  change (`VECTOR_STORE_DRIVER=pgvector` + `DATABASE_URL`), not a code
  change, because `VectorMemoryStore` only depends on the `VectorStore`
  port.
- Embedding model choice is decoupled from chat model choice
  (`EmbeddingProvider` is a separate port from `ModelProvider.embed`) so
  a product can use Claude for chat and OpenAI (or any future
  standalone embedding service) for recall.
