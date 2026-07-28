# Server-Sent Events (SSE) Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Server-Sent Events for token-by-token streaming of AI responses. Simpler than WebSocket, unidirectional, native browser support.

---

## Technical Overview

**HTTP Connection:**
- Keep-alive streaming (no polling)
- Unidirectional (server → client only)
- Auto-reconnect (built-in)
- Binary support (base64 encoded)

**Advantages Over WebSocket:**
- Simpler (HTTP/1.1 compatible)
- Auto-reconnect (standard)
- Text-only native (no binary)
- Lower overhead (no handshake)

**When to Use:**
- SSE: server push (messages, token streaming)
- WebSocket: bidirectional (collaboration, presence)

---

## Endpoint

```
GET /api/workspaces/:id/conversations/:conversationId/stream?messageId=msg_123
Accept: text/event-stream
Authorization: Bearer <jwt>
```

---

## Response Format

**HTTP Headers:**
```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

**Event Stream:**
```
event: token
data: {"token":"Hello"}

event: token
data: {"token":" "}

event: token
data: {"token":"world"}

event: done
data: {"messageId":"msg_123","inputTokens":45,"outputTokens":120,"completedAt":"2026-07-28T14:30:00Z"}
```

---

## Event Types

**token Event:**
```json
{
  "type": "content_block_delta",
  "delta": {
    "type": "text_delta",
    "text": "Hello "
  },
  "index": 0
}
```

**done Event:**
```json
{
  "type": "message_stop",
  "message": {
    "id": "msg_123",
    "role": "assistant",
    "content": "Hello world",
    "usage": {
      "input_tokens": 45,
      "output_tokens": 120
    }
  }
}
```

**error Event:**
```json
{
  "type": "error",
  "error": {
    "type": "rate_limit_error",
    "message": "Rate limit exceeded"
  }
}
```

---

## Implementation (Backend)

```typescript
router.get(
  '/conversations/:conversationId/stream',
  requireAuth,
  async (req, res) => {
    const { conversationId } = req.params;
    const { messageId } = req.query;
    
    // Validate access
    const conversation = await db.conversation.findUnique({
      where: { id: conversationId }
    });
    
    if (!conversation) {
      return res.status(404).json({ error: 'Not found' });
    }
    
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    try {
      // Get message
      const message = await db.message.findUnique({
        where: { id: messageId }
      });
      
      if (!message) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Message not found' })}\n\n`);
        res.end();
        return;
      }
      
      // Subscribe to Redis stream
      const stream = redis.getStream(`stream:${conversationId}`);
      
      for await (const event of stream) {
        if (event.messageId === messageId) {
          if (event.type === 'token') {
            res.write(`event: token\ndata: ${JSON.stringify(event)}\n\n`);
          } else if (event.type === 'done') {
            res.write(`event: done\ndata: ${JSON.stringify(event)}\n\n`);
            res.end();
            break;
          } else if (event.type === 'error') {
            res.write(`event: error\ndata: ${JSON.stringify(event)}\n\n`);
            res.end();
            break;
          }
        }
      }
    } catch (error) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
);
```

---

## Implementation (Client)

**Basic Usage:**
```typescript
function streamMessage(conversationId: string, messageId: string) {
  const eventSource = new EventSource(
    `/api/workspaces/ws_123/conversations/${conversationId}/stream?messageId=${messageId}`,
    { withCredentials: true }
  );
  
  let fullText = '';
  
  eventSource.addEventListener('token', (e) => {
    const data = JSON.parse(e.data);
    fullText += data.delta?.text || '';
    updateMessageUI(fullText);
  });
  
  eventSource.addEventListener('done', (e) => {
    const data = JSON.parse(e.data);
    console.log('Generation complete', data.message.usage);
    updateUsageUI(data.message.usage);
    eventSource.close();
  });
  
  eventSource.addEventListener('error', (e) => {
    const data = JSON.parse(e.data);
    console.error('Generation error:', data.error);
    showErrorToast(data.error.message);
    eventSource.close();
  });
}
```

**React Hook:**
```typescript
function useStreamMessage(conversationId: string, messageId: string) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    const eventSource = new EventSource(
      `/api/.../stream?messageId=${messageId}`
    );
    
    eventSource.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.delta?.text) {
        setContent(prev => prev + data.delta.text);
      }
    };
    
    eventSource.addEventListener('done', (e) => {
      setLoading(false);
      eventSource.close();
    });
    
    eventSource.addEventListener('error', (e) => {
      setError('Stream error');
      setLoading(false);
      eventSource.close();
    });
    
    return () => eventSource.close();
  }, [conversationId, messageId]);
  
  return { content, loading, error };
}
```

---

## Redis Streams (Backend Buffering)

**Emit Token:**
```typescript
async function emitToken(conversationId: string, token: string) {
  await redis.xadd(
    `stream:${conversationId}`,
    '*',
    'messageId', currentMessageId,
    'type', 'token',
    'text', token,
    'timestamp', Date.now()
  );
}

async function emitStreamComplete(conversationId: string, usage: any) {
  await redis.xadd(
    `stream:${conversationId}`,
    '*',
    'messageId', currentMessageId,
    'type', 'done',
    'inputTokens', usage.input_tokens,
    'outputTokens', usage.output_tokens,
    'timestamp', Date.now()
  );
  
  // Auto-expire after 1 hour
  await redis.expire(`stream:${conversationId}`, 3600);
}
```

---

## Reconnection Strategy

```typescript
// Automatic (built-in)
// Browser retries with exponential backoff
// EventSource.CONNECTING → EventSource.CLOSED → browser reconnects

// Manual (advanced)
const reconnectInterval = 1000;  // 1s
const maxReconnectInterval = 30000;  // 30s

function streamWithReconnect() {
  let attempt = 0;
  
  function connect() {
    const eventSource = new EventSource('/stream');
    
    eventSource.onerror = () => {
      eventSource.close();
      
      // Exponential backoff
      const delay = Math.min(
        reconnectInterval * Math.pow(2, attempt),
        maxReconnectInterval
      );
      
      attempt++;
      setTimeout(connect, delay);
    };
  }
  
  connect();
}
```

---## Headers & CORS

**Client Sends:**
```
GET /stream HTTP/1.1
Host: synora.ai
Authorization: Bearer <jwt>
Accept: text/event-stream
```

**Server Responds:**
```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
Access-Control-Allow-Origin: https://synora.ai
Access-Control-Allow-Credentials: true
```

---

## Performance Optimization

**Token Buffering:**
- Buffer every 50ms or 5 tokens (whichever is sooner)
- Reduces frame updates
- Improves smoothness

**Backpressure Handling:**
```typescript
// If client can't keep up
res.on('drain', () => {
  resumeTokenStream();  // resume from buffer
});

res.on('close', () => {
  cancelTokenStream();  // cleanup
});
```

**Connection Pooling:**
- Keep max 1000 concurrent streams per server
- Scale horizontally if needed

---

## Error Scenarios

| Scenario | Behavior | Recovery |
|----------|----------|----------|
| Network disconnect | EventSource closes | Auto-reconnect |
| Server error (5xx) | error event sent | Exponential backoff |
| Token timeout | close connection | Retry entire message |
| Invalid JWT | 401 response | Redirect to login |
| Message not found | 404 before open | Error displayed |

---

## Monitoring

- sse_connections_active{conversation_id}
- sse_tokens_emitted_total
- sse_stream_duration_ms
- sse_error_rate
- sse_reconnect_total

---

## Alerts

- Error rate > 5%
- Token latency > 100ms
- Connection timeouts > 10%

---

## Testing

- Stream opens successfully
- Tokens received in order
- Done event received with usage
- Connection closes on error
- Reconnect after disconnect
- Large response (1000+ tokens)
- No tokens lost
- Cancellation works
- Auth validation enforced

---

## Browser Compatibility

| Browser | SSE Support |
|---------|-------------|
| Chrome | ✓ |
| Firefox | ✓ |
| Safari | ✓ |
| Edge | ✓ |
| IE | ✗ (polyfill available) |

---

## Security

- JWT required (Authorization header)
- Conversation access validated
- HTTPS only (wss for WebSocket)
- No credentials in URL
- Same-origin policy enforced
- Timeout: 5 min idle (auto-close)

---

## Comparison: SSE vs WebSocket

| Feature | SSE | WebSocket |
|---------|-----|-----------|
| Bidirectional | ✗ | ✓ |
| Auto-reconnect | ✓ | ✗ |
| Simplicity | ✓ | ✗ |
| Throughput | Lower | Higher |
| Latency | ~100ms | ~50ms |
| Browser support | ✓ | ✓ |

---

## Future Enhancements

- Chunked tokens (batch every 5)
- Delta compression
- Binary streaming (reduce size)
- Multiplexed streams (one connection, multiple messages)
- Cancellation tokens (stop generation)
- Progress events (% complete)

---

**Status:** Complete
