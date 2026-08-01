# Vector Search Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Semantic search using embeddings. Users query with natural language; system converts query to embedding and finds semantically similar messages/conversations using vector similarity in Pinecone or Weaviate.

---

## Database

No new tables. Uses Pinecone indices:
- `synora-messages` → message embeddings
- `synora-conversations` → conversation summary embeddings

---

## Service Layer

```typescript
class VectorSearchService {
  async embedMessage(message: Message): Promise<void>
  // Convert message content to embedding, upsert to Pinecone
  
  async embedConversation(
    conversationId: string,
    summary: string
  ): Promise<void>
  // Store conversation summary embedding
  
  async searchSimilarMessages(
    workspaceId: string,
    query: string,
    limit: number = 10
  ): Promise<SearchResult[]>
  
  async searchSimilarConversations(
    workspaceId: string,
    query: string,
    limit: number = 5
  ): Promise<ConversationResult[]>
}

interface SearchResult {
  messageId: string;
  conversationId: string;
  snippet: string;
  similarity: number;    // 0-1, cosine similarity
}

interface ConversationResult {
  conversationId: string;
  title: string;
  summary: string;
  similarity: number;
}
```

---

## API

```
POST /api/workspaces/:id/semantic-search/messages
Body: { query: "How to authenticate users?" }
Response 200: SearchResult[]

POST /api/workspaces/:id/semantic-search/conversations
Body: { query: "Authentication patterns" }
Response 200: ConversationResult[]
```

---

## Embedding Configuration

**Model:** OpenAI `text-embedding-3-small` (1536 dimensions)
- Cost: $0.02 per 1M tokens
- Speed: <100ms per document
- Accuracy: MTEB score 0.62

**Alternative:** Anthropic voyage-3 (1024 dimensions)
- Cost: $0.03 per 1M tokens
- Speed: <150ms
- Accuracy: MTEB score 0.65

---

## Pinecone Configuration

```typescript
{
  index: 'synora-messages',
  dimension: 1536,
  metric: 'cosine',           // cosine similarity
  pod_type: 'p1.x1',          // starter
  replicas: 3,
  shards: 4,
  metadata_config: {
    indexed: ['workspace_id', 'conversation_id', 'message_id', 'created_at']
  },
  retention: {
    hours: 2160                // 90 days
  }
}
```

---

## Indexing Strategy

1. **On Message Creation:** Queue embedding job (async)
2. **Batch Processing:** Embed in batches of 100 (every 5 min)
3. **Bulk Upsert:** Send to Pinecone in single request
4. **Retry:** Exponential backoff (1s, 2s, 4s, 8s)
5. **Fallback:** If Pinecone unavailable, queue for later

---

## Query Flow

1. User enters query
2. Embed query with same model as documents
3. Search Pinecone (k=10 neighbors)
4. Filter by workspace_id (metadata)
5. Rank by similarity score
6. Fetch full messages from PostgreSQL
7. Cache results (5-min TTL)

---

## Validation

- Query 1-500 chars
- Model must be available
- Workspace must exist
- Results limit 1-100

---

## Permissions

- User can search only workspaces they're member of
- Results filtered by conversation access (workspace member)
- Viewer role can search but each result still permission-checked

---

## Error Handling

| Code | Scenario | Recovery |
|------|----------|----------|
| 400 | Query too long | Truncate to 500 chars |
| 429 | Embedding rate limit | Queue and retry after 60s |
| 503 | Pinecone unavailable | Suggest full-text search fallback |
| 500 | Embedding model failed | Log, queue for retry |

---

## Retry Strategy

- Embedding failures: exponential backoff, max 5 attempts
- Upsert failures: retry at next batch interval
- Search failures: fallback to Elasticsearch
- Timeout (>10s): fail fast, return cached results

---

## Logging

```json
{
  "action": "vector_search",
  "workspaceId": "ws_123",
  "query": "authentication",
  "model": "text-embedding-3-small",
  "resultsCount": 8,
  "similarity_scores": [0.87, 0.82, 0.79],
  "duration_ms": 120,
  "userId": "user_123"
}
```

---

## Monitoring

- embedding_created_total{model}
- embedding_latency_ms{model, percentile}
- vector_search_requests_total
- vector_search_latency_ms{percentile}
- vector_search_similarity{percentile}
- pinecone_index_size_vectors
- embedding_queue_depth
- embedding_cost_usd{model}

---

## Testing

- Embed message successfully
- Search finds semantically similar messages
- Relevance ranking correct (highest similarity first)
- Pinecone unavailable → fallback to Elasticsearch
- Workspace isolation (no cross-workspace leakage)
- Embedding model failure → retry
- Query timeout → cached results

---

## Performance

- Embedding: <100ms per message
- Search: <500ms for 10 results
- Batch size: 100 documents per upsert
- Concurrency: 10 concurrent embeddings
- Cache: 5-min TTL on search results
- Rate limit: 100K embeddings/day per workspace

---

## Security

- JWT required
- Workspace isolation (metadata filtered)
- Embedding API keys in env (never logged)
- Query logging (no content, only metadata)
- PII masking in results (emails redacted)
- Access control per conversation

---

## Scalability

- Pinecone serverless (auto-scaling)
- Embedding queue distributed (Bull workers)
- Batch indexing: 1000 docs/min capacity
- Support 1B+ message embeddings
- Replication factor: 3 (high availability)
- Index sharding: automatic per Pinecone

---

## Cost Optimization

- Use text-embedding-3-small (cheaper)
- Batch embeddings (1000 at a time)
- Cache results aggressively (5-min TTL)
- Delete embeddings after 90 days
- Monitor token usage daily

---

## Future Enhancements

- User-specific ranking (personalization)
- Reranking with cross-encoder model
- Hybrid search (vector + full-text combined)
- Multi-language support
- Document chunking for long messages
- Embedding fine-tuning on user feedback

---

**Status:** Complete
