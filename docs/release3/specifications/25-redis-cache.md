# Redis Cache Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Caching layer for conversations, messages, sessions, rate limits, and streaming state. Reduces database load and improves latency.

---

## Redis Configuration

```typescript
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  db: 0,
  lazyConnect: false,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  reconnectOnError: (err) => {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      return true;  // reconnect
    }
    return false;
  },
  // Cluster support
  cluster: [
    { host: 'redis-1', port: 6379 },
    { host: 'redis-2', port: 6379 },
    { host: 'redis-3', port: 6379 },
  ]
});
```

---

## Key Patterns

**Conversations:**
```
conversation:{workspaceId}:{conversationId}
TTL: 15 minutes
Value: { id, title, description, messageCount, lastMessageAt }
Invalidated: on update/delete
```

**Messages:**
```
messages:{conversationId}
TTL: 30 minutes
Value: Message[]
Invalidated: on new message
```

**Conversation Lists:**
```
conversation_list:{workspaceId}:{userId}
TTL: 5 minutes
Value: Conversation[] (paginated)
Invalidated: on create/update
```

**Sessions:**
```
session:{sessionId}
TTL: 7 days
Value: { userId, workspaceId, ...sessionData }
Invalidated: on logout
```

**Rate Limits:**
```
ratelimit:{userId}:{endpoint}
TTL: 60 seconds
Value: number (request count)
Incrementing: each request
```

**Streams (Token Buffering):**
```
stream:{conversationId}
TTL: 1 hour
Value: [{ token, timestamp }, ...]
Expiring: auto on TTL
```

**User Presence:**
```
presence:{conversationId}
TTL: 5 minutes (refreshed on activity)
Value: { userId: { avatar, username, lastSeen } }
Invalidated: on disconnect
```

---

## Service Layer

```typescript
class CacheService {
  async getConversation(
    workspaceId: string,
    conversationId: string
  ): Promise<Conversation | null>
  
  async setConversation(
    workspaceId: string,
    conversationId: string,
    data: Conversation,
    ttl: number = 900  // 15 min
  ): Promise<void>
  
  async invalidateConversation(conversationId: string): Promise<void>
  
  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = 300
  ): Promise<T>
  // Cache-aside pattern
  
  async setRate(
    userId: string,
    endpoint: string,
    limit: number,
    window: number
  ): Promise<boolean>
  // Returns true if under limit
  
  async addTokenToStream(
    conversationId: string,
    token: string
  ): Promise<void>
  
  async getStreamTokens(conversationId: string): Promise<string[]>
  
  async addUserPresence(
    conversationId: string,
    userId: string,
    data: UserPresence
  ): Promise<void>
}
```

---

## Caching Strategy

**Cache-Aside (Lazy):**
```typescript
async function getConversation(conversationId: string) {
  const cached = await redis.get(`conversation:${conversationId}`);
  if (cached) return JSON.parse(cached);
  
  const data = await db.conversation.findUnique({ where: { id: conversationId } });
  await redis.setex(`conversation:${conversationId}`, 900, JSON.stringify(data));
  return data;
}
```

**Write-Through:**
```typescript
async function updateConversation(id: string, updates: any) {
  const data = await db.conversation.update({ where: { id }, data: updates });
  await redis.setex(`conversation:${id}`, 900, JSON.stringify(data));
  return data;
}
```

**Invalidation:**
```typescript
async function deleteConversation(id: string) {
  await db.conversation.delete({ where: { id } });
  await redis.del(`conversation:${id}`);
  await redis.del(`messages:${id}`);  // cascade invalidation
}
```

---

## TTL Configuration

| Key Pattern | TTL | Reason |
|------------|-----|--------|
| conversation:* | 15m | Balance freshness vs. hits |
| messages:* | 30m | Messages rarely change |
| conversation_list:* | 5m | User expects recent updates |
| session:* | 7d | Session lifetime |
| ratelimit:* | 60s | Time-window for rate limit |
| stream:* | 1h | Streaming buffer window |
| presence:* | 5m | User presence auto-cleanup |

---

## Memory Management

**Max Memory Policy:**
```
maxmemory: 2GB
maxmemory-policy: allkeys-lru  // evict LRU keys when full
```

**Monitoring:**
```typescript
async function getMemoryStats() {
  const info = await redis.info('memory');
  return {
    used_memory: info.used_memory_human,
    used_memory_percent: info.used_memory_percentage,
    evicted_keys: info.evicted_keys,
    eviction_rate: info.evicted_keys / uptime_seconds,
  };
}
```

---

## Cluster Topology

**Single-Node (Dev):**
```
Redis instance on localhost:6379
```

**Primary-Replica (Staging):**
```
Primary (master, writes)
  ↓ replication ↓
Replica (read-only, failover ready)
```

**Cluster (Production):**
```
3 primary nodes + 3 replica nodes
Auto-sharding (hash slots)
Sentinel for failover
```

---

## High Availability

**Redis Sentinel:**
```
sentinel monitor synora-redis 127.0.0.1 6379 2
sentinel down-after-milliseconds synora-redis 5000
sentinel parallel-syncs synora-redis 1
sentinel failover-timeout synora-redis 180000
```

**Connection Pool:**
```typescript
// Connection pooling via ioredis
const redis = new Redis.Cluster([
  { host: 'redis-1', port: 6379 },
  { host: 'redis-2', port: 6379 },
  { host: 'redis-3', port: 6379 },
], {
  maxRedirections: 16,
  retryDelayOnFailover: 100,
  retryDelayOnClusterDown: 300,
});
```

---

## Monitoring & Alerts

| Metric | Alert Threshold |
|--------|-----------------|
| Memory usage | > 80% of max |
| Eviction rate | > 100 keys/sec |
| Connection count | > 1000 concurrent |
| Hit rate | < 70% |
| Latency P99 | > 50ms |

---

## Testing

- Cache hit on second access
- Cache invalidation on update
- Rate limiting works
- Cluster failover
- Memory eviction under pressure
- Stream token buffering
- Session persistence

---

## Performance Targets

- Get: <5ms (in-memory)
- Set: <5ms
- Cluster failover: <30s detection
- Eviction impact: <10ms latency spike

---

## Security

- Redis password protected (AUTH)
- Encrypted in transit (TLS)
- No sensitive data unencrypted
- Access logs enabled
- Network isolation (private VPC)

---

## Disaster Recovery

**Backup Strategy:**
```
# RDB snapshots (point-in-time)
save 900 1       # 1 change in 15 min
save 300 10      # 10 changes in 5 min
save 60 10000    # 10K changes in 1 sec

# Replication (live backup)
slaveof primary-redis:6379
```

**Recovery Procedure:**
1. Identify issue (memory, connection, etc.)
2. Kill client connections if needed
3. Restart Redis (loads from RDB)
4. Resync replicas from primary
5. Validate cache consistency

---

## Cost Optimization

- Use smaller nodes for dev/staging
- Monitor eviction (memory pressure)
- Tune TTLs (reduce footprint)
- Use Redis 7+ (better compression)

---

## Future Enhancements

- Redis Streams for audit trail
- Pub/Sub for notifications
- Sorted sets for leaderboards
- HyperLogLog for unique counts
- Bloom filters for existence checks

---

**Status:** Complete
