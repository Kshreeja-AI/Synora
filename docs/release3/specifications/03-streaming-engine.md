# Streaming Engine Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Streams AI-generated message tokens via SSE (Server-Sent Events) for real-time token-by-token display. Client subscribes to a unique stream URL, receives tokens as they're generated, and consumes completion event.

---

## Database

No new tables. Uses Redis streams for buffering:
- `stream:{conversationId}` — Redis XADD for token events
- TTL: 1 hour (auto-expire old streams)

---

## API

### Subscribe to Message Stream

```
GET /api/workspaces/:workspaceId/conversations/:conversationId/stream
  ?messageId=msg_002
Authorization: Bearer <jwt>
Accept: text/event-stream

Response 200 (streaming):
event: token
data: {"token":"Hello"}

event: token
data: {"token":" there"}

event: token
data: {"token":","}

event: done
data: {"messageId":"msg_002","inputTokens":10,"outputTokens":20}

Connection: Keep-Alive (indefinite)
```

---

## Service Layer

```typescript
class StreamingService {
  async streamMessage(
    res: Response,
    conversationId: string,
    messageId: string,
    userId: string
  ): Promise<void>
    // Set SSE headers
    // Subscribe to Redis stream
    // Emit tokens as they arrive
    // Emit done event
    // Close connection

  async emitToken(
    conversationId: string,
    messageId: string,
    token: string
  ): Promise<void>
    // Emit token to Redis stream

  async emitStreamComplete(
    conversationId: string,
    messageId: string,
    inputTokens: number,
    outputTokens: number
  ): Promise<void>
    // Emit completion event
}
```

---

## Interfaces

```typescript
interface StreamTokenEvent {
  messageId: string;
  token: string;
  timestamp: number;
}

interface StreamCompleteEvent {
  messageId: string;
  inputTokens: number;
  outputTokens: number;
  completedAt: string;
}
```

---

## Validation

- Conversation exists
- User has access
- Message exists
- Message is in STREAMING or COMPLETE status

---

## Permissions

- Must be workspace member
- Must have access to conversation

---

## Failure Handling

| Error | Cause | Recovery |
|-------|-------|----------|
| Connection timeout | Client disconnect | Graceful close |
| Message not found | Invalid messageId | 404 error |
| Stream closed | Message completion | Normal close |
| Redis unavailable | Cache down | 503 error |

---

## Retry Strategy

- Client: Auto-reconnect with exponential backoff (1s, 2s, 4s, 8s)
- Server: Persistent Redis stream (no retry needed)
- Idempotent: Yes (streaming is always fresh)

---

## Logging

```json
{
  "action": "stream_opened",
  "conversationId": "conv_123",
  "messageId": "msg_002",
  "userId": "user_123",
  "timestamp": "2026-07-28T12:00:00Z"
}

{
  "action": "token_emitted",
  "messageId": "msg_002",
  "token": "Hello",
  "count": 1
}

{
  "action": "stream_complete",
  "messageId": "msg_002",
  "totalTokens": 250,
  "duration_ms": 5000
}
```

---

## Monitoring

**Metrics:**
- stream_opened_total
- stream_closed_total
- stream_tokens_emitted_total
- stream_duration_ms{messageId}
- stream_connection_errors_total

**Alerts:**
- Stream error rate > 1%
- Token latency > 100ms (P99)

**SLOs:**
- Token latency P99 < 50ms
- Stream uptime 99.95%

---

## Testing

**Unit Tests:**
- Token emitted to Redis
- Completion event sent
- Connection closed on error

**Integration Tests:**
- Open stream → receive tokens → receive done
- Disconnect → Redis stream still exists
- Invalid messageId → 404

**E2E Tests:**
- User sends message → tokens appear in chat
- Verify token latency
- Test connection loss recovery

---

## Performance

**Optimizations:**
1. Redis XREAD with BLOCK 1000ms (efficient polling)
2. Buffer tokens (emit every 50ms or 5 tokens)
3. HTTP/2 push for low latency
4. Compression disabled (defeats streaming purpose)

**Targets:**
- Token latency P99 < 50ms
- Connection overhead < 100ms

---

## Security

- JWT authentication required
- Workspace membership verified
- Message belongs to accessible conversation
- No PII in token streams
- Timeout after 5 minutes idle

---

## Scalability

- Redis Streams handle 10K+ concurrent streams
- Multi-instance: Redis pub/sub for stream distribution
- Horizontal: One node per 1K concurrent streams

---

## Future Extensibility

- Chunked tokens (group 5-10 into batch)
- Compression (gzip for large payloads)
- WebSocket alternative (lower latency)
- Prioritized streams (high-priority messages first)

---

**Status:** Complete, ready for implementation
