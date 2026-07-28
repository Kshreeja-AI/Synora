# Conversation Search Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Full-text search across conversations, messages, and metadata using Elasticsearch. Enables fast discovery and filtering of conversations by title, description, and message content.

---

## Database

No new tables. Uses Elasticsearch indices:
- `conversations-{workspace_id}` → conversation metadata
- `messages-{workspace_id}` → message content (rolling 90-day retention)

---

## Service Layer

```typescript
class ConversationSearchService {
  async indexConversation(conversation: Conversation): Promise<void>
  // Called on conversation create/update
  
  async indexMessage(message: Message): Promise<void>
  // Called on message completion (async via worker)
  
  async searchConversations(
    workspaceId: string,
    query: string,
    filters?: {
      projectId?: string;
      archived?: boolean;
      from?: Date;
      to?: Date;
    },
    limit: number = 20,
    offset: number = 0
  ): Promise<{
    items: SearchResult[];
    total: number;
    hasMore: boolean;
  }>
  
  async searchMessages(
    workspaceId: string,
    conversationId: string,
    query: string,
    limit: number = 50
  ): Promise<Message[]>
  
  async reindexWorkspace(workspaceId: string): Promise<void>
  // Nightly job to refresh indices
}

interface SearchResult {
  conversationId: string;
  title: string;
  description?: string;
  snippet: string;        // preview of matching content
  lastMessageAt: Date;
  messageCount: number;
}
```

---

## API

```
GET /api/workspaces/:id/search/conversations?q=authentication&project=proj_123
Query params: q (required), project, archived, from, to, limit, offset
Response 200: {
  items: [{
    conversationId,
    title,
    description,
    snippet,
    lastMessageAt,
    messageCount
  }],
  total,
  hasMore
}

GET /api/workspaces/:id/conversations/:conversationId/search/messages?q=API+endpoint
Query params: q (required), limit, offset
Response 200: Message[]
```

---

## Elasticsearch Mapping

```json
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "analysis": {
      "analyzer": {
        "default": {
          "type": "standard",
          "stopwords": "_english_"
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "conversationId": { "type": "keyword" },
      "workspaceId": { "type": "keyword" },
      "title": { 
        "type": "text",
        "analyzer": "standard",
        "fields": { "keyword": { "type": "keyword" } }
      },
      "description": { "type": "text" },
      "messageContent": { "type": "text" },
      "messageId": { "type": "keyword" },
      "messageRole": { "type": "keyword" },
      "createdAt": { "type": "date" },
      "updatedAt": { "type": "date" },
      "archived": { "type": "boolean" },
      "projectId": { "type": "keyword" },
      "userId": { "type": "keyword" }
    }
  }
}
```

---

## Validation

- Query string 1-500 chars (truncate longer)
- Limit 1-100
- Offset 0-10000
- Project/folder IDs must exist and be accessible

---

## Permissions

- User can search only workspaces they're member of
- Search results filtered by user's conversation access
- Archived conversations only if user is editor+

---

## Error Handling

| Code | Scenario | Recovery |
|------|----------|----------|
| 400 | Invalid query syntax | Suggest corrections |
| 404 | Workspace not found | Check membership |
| 503 | Elasticsearch unavailable | Return cached results or error |
| 500 | Index corruption | Reindex affected documents |

---

## Retry Strategy

- Indexing failures: queue for retry (exponential backoff)
- Search failures: fallback to database query (slower)
- Connection failures: circuit breaker (fail fast after 3 attempts)

---

## Logging

```json
{
  "action": "conversation_search",
  "workspaceId": "ws_123",
  "query": "api endpoint",
  "resultsCount": 15,
  "duration_ms": 45,
  "userId": "user_123"
}
```

---

## Monitoring

- search_requests_total{workspace_id, type}
- search_latency_ms{workspace_id, percentile}
- search_result_count{workspace_id}
- elasticsearch_indexing_lag_ms
- elasticsearch_cluster_health{status}
- elasticsearch_index_size_bytes{index}

---

## Testing

- Search conversations by title
- Search messages by content
- Filter by project, date range
- Pagination works
- Special characters in query
- Empty result handling
- Elasticsearch downtime fallback

---

## Performance

- Elasticsearch cluster: 3 nodes minimum
- Shard allocation: 3 shards, 1 replica (auto-rebalance)
- Index refresh interval: 30 seconds
- Rolling indices: daily for messages (archive old)
- Query timeout: 5 seconds
- Cache results (10-min TTL): popular queries

---

## Security

- JWT required
- Workspace membership enforced
- Query validation (prevent injection)
- PII redaction in snippets (emails masked)
- Audit log all searches
- RBAC: viewer can search but not access details (conversation still checked)

---

## Scalability

- Dedicated Elasticsearch cluster
- Auto-scaling: add nodes as index size grows
- Index sharding strategy: shards per workspace (high-volume only)
- Bulk indexing (batch 1000 docs)
- Connection pooling (10 per node)
- Query DSL: bool queries with filters (cached)

---

## Future Enhancements

- Synonym expansion (API ↔ endpoint)
- Fuzzy matching (typo tolerance)
- Faceted search (filter by date, author, etc.)
- Search analytics (trending queries)
- Personalized ranking (user's history)

---

**Status:** Complete
