# M3: AI Streaming Engine - Implementation Plan

**Design Date**: 2026-07-30  
**Scope**: Release 3 M3 - Universal Conversation Engine Streaming Infrastructure  
**Status**: Design Phase - Ready for Implementation

---

## Executive Summary

Milestone 3 implements server-side streaming of AI-generated responses with **provider-agnostic protocol support** (SSE + WebSockets), **reliable chunk delivery**, **transparent token accounting**, and **production-grade observability**. Streaming responses appear in real-time to users; backend maintains a complete audit trail of every generated chunk and token count.

**Core Goals:**
1. Stream AI responses in real-time (token-by-token or chunk-by-chunk)
2. Handle provider-specific streaming APIs uniformly
3. Persist partial messages and track completion
4. Account for input/output tokens accurately
5. Support graceful reconnection and cancellation
6. Maintain observability without sacrificing performance

---

## 1. Streaming Protocol Design

### 1.1 Protocol Selection: SSE (Server-Sent Events)

**Decision**: Primary protocol = **Server-Sent Events (SSE)**; WebSocket fallback for real-time multiplayer (M5+).

**Rationale:**
- **Simplicity**: HTTP-based, no protocol upgrade; stateless from backend perspective
- **Browser native**: EventSource API built-in; no extra client library required
- **Statelessness**: Each connection independent; horizontal scaling without sticky sessions
- **Graceful degradation**: Client detects disconnect; automatic reconnect with backoff
- **Compatibility**: Works through proxies, CDNs, load balancers unchanged
- **Resource efficiency**: Lower memory footprint than WebSocket for large numbers of concurrent streams

**Limitations & Mitigation:**
| Limitation | Mitigation |
|-----------|-----------|
| Unidirectional (server→client only) | Client sends user message first; stream is response-only |
| No native binary support | Base64-encode binary if needed; out of scope for M3 |
| Browser idle timeout (60s+) | Send heartbeat every 30s if stream stalls |
| Limited concurrent connections (6 per origin) | Browser queues excess; acceptable for typical usage |

**WebSocket Fallback** (out of scope M3; planned M5):
- Detect SSE unsupported or stream failure
- Establish WebSocket connection on same topic
- Same event structure, different transport

### 1.2 Message Format

All SSE events follow this structure:

```typescript
// Server sends (plaintext)
event: token
data: {"token":"hello","model":"claude-opus","provider":"anthropic"}

event: chunk
data: {"chunk":"Hello, world!","inputTokens":42,"outputTokens":7}

event: done
data: {"messageId":"msg_123","inputTokens":150,"outputTokens":45,"model":"claude-opus","completedAt":"2026-07-30T06:00:00Z"}

event: error
data: {"code":"RATE_LIMIT","message":"Provider rate limit exceeded","retryAfter":60}

event: heartbeat
data: {"timestamp":"2026-07-30T06:00:15Z"}
```

**Field Semantics:**
- `token`: Single token string (may span multiple events if very long)
- `chunk`: Accumulated tokens since last chunk event (for efficiency)
- `inputTokens`: Cumulative input tokens (stable across events)
- `outputTokens`: Cumulative output tokens (increments with each event)
- `messageId`: Database record ID of the created assistant message
- `model`: AI model name used (e.g., "claude-opus", "gpt-4")
- `provider`: Provider ID (e.g., "anthropic", "openai")
- `retryAfter`: Seconds to wait before retry (from provider)
- `heartbeat`: Server-side keep-alive (no action required)

**Client Consumption** (Next.js EventSource):
```typescript
const eventSource = new EventSource(
  `/api/conversations/${id}/stream?messageId=${userMessageId}&workspaceId=${workspaceId}`
);

eventSource.addEventListener('token', (e) => {
  const { token } = JSON.parse(e.data);
  appendToUI(token);
});

eventSource.addEventListener('chunk', (e) => {
  const { chunk, outputTokens } = JSON.parse(e.data);
  updateUsageDisplay(outputTokens);
});

eventSource.addEventListener('done', (e) => {
  const { messageId, inputTokens, outputTokens } = JSON.parse(e.data);
  markMessageComplete(messageId);
  close();
});

eventSource.addEventListener('error', (e) => {
  const { code, retryAfter } = JSON.parse(e.data);
  showErrorToast(`${code}: wait ${retryAfter}s`);
  setTimeout(() => eventSource.close(), retryAfter * 1000);
});
```

---

## 2. Streaming Architecture

### 2.1 System Topology

```
Browser (Next.js)
  ├─ POST /api/conversations/{id}/messages (user message + role)
  ├─ [Backend creates Message record, spawns StreamingJob]
  ├─ GET /api/conversations/{id}/stream?messageId=... (open SSE)
  │  └─ Backend: Subscribe to job:${jobId}:stream Redis channel
  │
  └─ [Concurrent]
      WebWorker (Bull Queue Listener):
        ├─ Poll Redis: Bull queue topic "generate_response"
        ├─ Fetch conversation + message history
        ├─ Call AI provider stream API
        ├─ For each chunk:
        │  ├─ Emit to Redis channel job:${jobId}:stream
        │  ├─ Accumulate in-memory chunk buffer
        │  └─ Log to audit trail (async, non-blocking)
        ├─ On completion:
        │  ├─ Persist full message to DB
        │  ├─ Update StreamingJob status=COMPLETED
        │  ├─ Record usage in ConversationUsage
        │  └─ Emit 'done' event to stream
        └─ On error:
            ├─ Retry with backoff (up to MAX_ATTEMPTS)
            ├─ Emit 'error' event if exhausted
            └─ Update StreamingJob status=FAILED
```

### 2.2 Component Interactions

**Four concurrent threads of work:**

1. **API Route Handler** (`routes/streaming.ts`)
   - Accept SSE connection
   - Validate authorization (workspace membership + role)
   - Subscribe to Redis Pub/Sub channel
   - Stream events to client
   - Handle disconnection gracefully

2. **Message Service** (`services/message.service.ts`)
   - Create user message record (status: PENDING)
   - Return immediately to route layer
   - Enqueue generation job asynchronously

3. **Generation Worker** (Bull Queue processor)
   - Fetch full conversation context
   - Call provider.generateStream()
   - Write events to Redis channel per-chunk
   - Accumulate tokens for accounting
   - Handle provider-specific streaming protocols

4. **Persistence Layer** (async background task)
   - Receive final message text from worker
   - Store in DB with token counts
   - Update StreamingJob record
   - Record usage in ConversationUsage
   - Emit completion event

---

## 3. Provider Abstraction for Streaming

### 3.1 Provider Interface

All AI providers implement this streaming interface:

```typescript
interface TextGenerationStreamProvider {
  generateStream(input: GenerateStreamInput): AsyncIterable<StreamChunk>;
}

interface GenerateStreamInput {
  messages: Message[];
  model: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  systemPrompt?: string;
  abortSignal?: AbortSignal;  // for cancellation
}

interface StreamChunk {
  type: 'token' | 'error' | 'usage';
  
  // For type='token'
  token?: string;
  
  // For type='usage' (final chunk)
  inputTokens?: number;
  outputTokens?: number;
  
  // For type='error'
  error?: {
    code: string;
    message: string;
    retryAfter?: number;
  };
}
```

**Implementation Pattern:**

```typescript
// apps/backend/src/ai/providers/anthropic.ts
export class AnthropicStreamProvider implements TextGenerationStreamProvider {
  async *generateStream(input: GenerateStreamInput): AsyncIterable<StreamChunk> {
    const stream = await this.client.messages.stream({
      model: input.model,
      max_tokens: input.maxTokens || 1024,
      messages: input.messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      })),
      system: input.systemPrompt,
    });

    let inputTokens = 0;
    let outputTokens = 0;

    for await (const event of stream) {
      if (event.type === 'message_start') {
        inputTokens = event.message.usage.input_tokens;
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield {
            type: 'token',
            token: event.delta.text
          };
          outputTokens++;
        }
      } else if (event.type === 'message_delta') {
        outputTokens = event.usage.output_tokens;
      }
    }

    yield {
      type: 'usage',
      inputTokens,
      outputTokens
    };
  }
}

// apps/backend/src/ai/providers/openai.ts
export class OpenAIStreamProvider implements TextGenerationStreamProvider {
  async *generateStream(input: GenerateStreamInput): AsyncIterable<StreamChunk> {
    const response = await this.client.chat.completions.create({
      model: input.model,
      messages: input.messages,
      stream: true,
      max_tokens: input.maxTokens || 1024,
    });

    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of response) {
      if (chunk.choices[0]?.delta?.content) {
        yield {
          type: 'token',
          token: chunk.choices[0].delta.content
        };
        outputTokens++;
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }
    }

    yield {
      type: 'usage',
      inputTokens,
      outputTokens
    };
  }
}
```

### 3.2 Provider Registry & Resolution

```typescript
// apps/backend/src/ai/streamingResolver.ts
export class StreamingProviderResolver {
  private providers: Map<string, TextGenerationStreamProvider> = new Map();

  register(providerId: string, provider: TextGenerationStreamProvider) {
    this.providers.set(providerId, provider);
  }

  async resolve(providerId: string): Promise<TextGenerationStreamProvider> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new ProviderNotFoundException(`No streaming provider: ${providerId}`);
    }
    return provider;
  }
}

// app.ts initialization
const streamingResolver = new StreamingProviderResolver();
streamingResolver.register('anthropic', new AnthropicStreamProvider(...));
streamingResolver.register('openai', new OpenAIStreamProvider(...));
streamingResolver.register('synora-mock', new SynoraMockStreamProvider(...));
```

---

## 4. Chunk Lifecycle

### 4.1 State Transitions

Each streaming request follows this lifecycle:

```
┌─────────────┐
│   QUEUED    │  Job enqueued, waiting for worker pickup
└──────┬──────┘
       │ worker picks up
       ▼
┌─────────────┐
│  STREAMING  │  Active connection, chunks flowing
└──────┬──────┘
       │ provider completes
       ▼
┌─────────────┐
│ PERSISTING  │  Chunks accumulated, writing to DB
└──────┬──────┘
       │ message saved
       ▼
┌─────────────┐
│ COMPLETE    │  ✅ Full message in DB, usage recorded
└─────────────┘

[On error at any stage]
┌─────────────┐
│   FAILED    │  ❌ Error threshold exceeded, job abandoned
└─────────────┘
```

### 4.2 Data Structures

**In-Memory Chunk Buffer** (worker process):
```typescript
class StreamingAccumulator {
  private chunks: string[] = [];
  private tokenCount = 0;
  private startTime = Date.now();

  addChunk(token: string) {
    this.chunks.push(token);
    this.tokenCount++;
    
    // Emit heartbeat every 100 tokens or 5 seconds
    if (this.tokenCount % 100 === 0 || Date.now() - this.startTime > 5000) {
      this.emitHeartbeat();
    }
  }

  getFullText(): string {
    return this.chunks.join('');
  }

  getTokenCount(): number {
    return this.tokenCount;
  }

  reset() {
    this.chunks = [];
    this.tokenCount = 0;
  }
}
```

**Redis Stream Record** (for audit trail):
```typescript
// Key: message:${messageId}:chunks
// Type: Redis Stream (auto-pruning after TTL)
{
  "1626300000000-0": {
    "chunk": "Hello",
    "tokenCount": 1,
    "timestamp": "2026-07-30T06:00:00Z",
    "provider": "anthropic"
  },
  "1626300001000-0": {
    "chunk": " world",
    "tokenCount": 1,
    "timestamp": "2026-07-30T06:00:01Z",
    "provider": "anthropic"
  }
}
```

**Database Record** (persisted after completion):
```typescript
// Message model (updated after streaming)
{
  id: "msg_123",
  conversationId: "conv_456",
  content: "Hello world", // full accumulated text
  role: "assistant",
  inputTokens: 42,
  outputTokens: 2,
  status: "COMPLETE",
  provider: "anthropic",
  model: "claude-opus",
  createdAt: "2026-07-30T06:00:00Z",
  completedAt: "2026-07-30T06:00:02Z",
  streamingJobId: "job_789"
}
```

---

## 5. Reconnect Strategy

### 5.1 Browser-Side Reconnection (EventSource native)

EventSource automatically reconnects on disconnect with exponential backoff:

```typescript
const eventSource = new EventSource(url);

// Browser behavior (built-in):
// 1. Connection drops
// 2. Waits 1s, reconnects
// 3. If fails, waits 2s
// 4. If fails, waits 4s
// ... up to maximum backoff (typically 60s)
// Stops after browser default (often 30s total timeout)
```

**Client-side enhancement** (for longer-lived streams):

```typescript
class StreamClient {
  private eventSource?: EventSource;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  async connect(url: string) {
    this.eventSource = new EventSource(url);

    this.eventSource.addEventListener('error', (e) => {
      if (this.eventSource?.readyState === EventSource.CLOSED) {
        this.handleDisconnect();
      }
    });
  }

  private async handleDisconnect() {
    this.reconnectAttempts++;
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts exceeded');
      this.notifyUserStreamAborted();
      return;
    }

    const backoff = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`Reconnecting in ${backoff}ms...`);
    
    await delay(backoff);
    
    // Reconnect to same URL; server will resume from last chunk
    this.connect(this.currentUrl);
  }
}
```

### 5.2 Server-Side Resume Strategy

When client reconnects, server resumes from last known chunk:

```typescript
// routes/streaming.ts
app.get('/api/conversations/:id/stream', async (req, res) => {
  const { messageId, lastChunkIndex } = req.query;
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Validate user access
  const membership = await requireMembership(req.user.id, req.workspace.id);
  requirePermission(membership.role, 'message:read');

  // If resuming, fetch last persisted state from Redis
  if (lastChunkIndex) {
    const cachedChunks = await redis.xrange(
      `message:${messageId}:chunks`,
      `${lastChunkIndex}-0`,
      '+',
      'COUNT', 10
    );
    
    // Send cached chunks first
    for (const chunk of cachedChunks) {
      res.write(`event: token\ndata: ${JSON.stringify(chunk)}\n\n`);
    }
  }

  // Subscribe to new chunks
  const subscription = new Redis().subscribe(`job:${jobId}:stream`);
  
  subscription.on('message', (channel, message) => {
    const event = JSON.parse(message);
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
  });

  // Cleanup on disconnect
  req.on('close', () => {
    subscription.unsubscribe();
    subscription.disconnect();
  });
});
```

---

## 6. Retry Strategy

### 6.1 Generation Retry State Machine

```typescript
enum StreamingJobStatus {
  PENDING = 'PENDING',      // Queued, not started
  RUNNING = 'RUNNING',      // Active generation
  COMPLETED = 'COMPLETED',  // Success
  FAILED = 'FAILED'         // Exhausted retries
}

class StreamingJobRetryEngine {
  private readonly MAX_ATTEMPTS = 3;
  private readonly RETRY_BACKOFF_MS = [500, 1500];  // exponential: 0.5s, 1.5s

  async executeWithRetry(
    jobId: string,
    generateFn: () => Promise<GenerationResult>
  ): Promise<GenerationResult> {
    const job = await prisma.streamingJob.findUnique({ where: { id: jobId } });
    
    for (let attempt = 0; attempt < this.MAX_ATTEMPTS; attempt++) {
      try {
        logger.info(`[StreamingRetry] Attempt ${attempt + 1}/${this.MAX_ATTEMPTS}`, { jobId });
        
        // Increment attempt counter first (idempotent marker)
        await prisma.streamingJob.update({
          where: { id: jobId },
          data: {
            attempt: attempt + 1,
            status: StreamingJobStatus.RUNNING
          }
        });

        const result = await generateFn();
        
        logger.info(`[StreamingRetry] Success on attempt ${attempt + 1}`, { jobId });
        return result;
        
      } catch (error) {
        logger.warn(`[StreamingRetry] Attempt ${attempt + 1} failed`, {
          jobId,
          error: error.message
        });

        await prisma.streamingJob.update({
          where: { id: jobId },
          data: {
            lastError: error.message,
            status: attempt === this.MAX_ATTEMPTS - 1 
              ? StreamingJobStatus.FAILED 
              : StreamingJobStatus.PENDING
          }
        });

        if (attempt < this.MAX_ATTEMPTS - 1) {
          const backoffMs = this.RETRY_BACKOFF_MS[attempt];
          logger.info(`[StreamingRetry] Waiting ${backoffMs}ms before retry`, { jobId });
          await sleep(backoffMs);
        }
      }
    }

    throw new ServiceUnavailableException(
      `Streaming generation exhausted ${this.MAX_ATTEMPTS} attempts`
    );
  }
}
```

### 6.2 Retryable vs Non-Retryable Errors

```typescript
class ErrorClassifier {
  isRetryable(error: Error): boolean {
    // Retryable (transient)
    if (error.code === 'RATE_LIMIT_EXCEEDED') return true;
    if (error.code === 'TIMEOUT') return true;
    if (error.code === 'TEMPORARY_UNAVAILABLE') return true;
    if (error.code === 'CONNECTION_RESET') return true;
    
    // Non-retryable (permanent)
    if (error.code === 'INVALID_API_KEY') return false;
    if (error.code === 'INVALID_MODEL') return false;
    if (error.code === 'INSUFFICIENT_QUOTA') return false;
    if (error.code === 'AUTHENTICATION_ERROR') return false;
    
    // Default: don't retry unknown errors
    return false;
  }

  getRetryAfterSeconds(error: Error): number {
    if (error.retryAfter) {
      return error.retryAfter; // Provider's recommendation
    }
    return 60; // Default 1 minute
  }
}
```

---

## 7. Cancellation Strategy

### 7.1 Client-Initiated Abort

```typescript
// Client (Next.js)
const abortController = new AbortController();

const eventSource = new EventSource(url);

// User clicks "Cancel" button
cancelButton.onclick = () => {
  eventSource.close();
  abortController.abort();
  
  // Notify server of abort
  fetch(`/api/conversations/${id}/stream/${jobId}/cancel`, {
    method: 'POST'
  });
};
```

### 7.2 Server-Side Abort Handling

```typescript
// routes/streaming.ts
app.post('/api/conversations/:id/stream/:jobId/cancel', async (req, res) => {
  const { jobId } = req.params;

  // Validate authorization
  const job = await prisma.streamingJob.findUnique({ where: { id: jobId } });
  const conversation = await prisma.conversation.findUnique({
    where: { id: job.conversationId }
  });
  
  const membership = await requireMembership(req.user.id, conversation.workspaceId);
  requirePermission(membership.role, 'message:manage');

  // Mark job as cancelled
  await prisma.streamingJob.update({
    where: { id: jobId },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date()
    }
  });

  // Signal worker to stop (via Redis)
  await redis.publish(`job:${jobId}:control`, JSON.stringify({
    action: 'cancel',
    timestamp: new Date().toISOString()
  }));

  logger.info(`[CancelJob] Job cancelled by user`, { jobId, userId: req.user.id });

  res.json({ success: true });
});
```

### 7.3 Worker Cleanup on Abort

```typescript
// Bull Queue processor
queue.process('generate_response', async (job) => {
  const jobId = job.id;
  const abortController = new AbortController();

  // Listen for cancellation signal
  const cancelSubscription = redis.subscribe(`job:${jobId}:control`);
  cancelSubscription.on('message', (channel, message) => {
    const { action } = JSON.parse(message);
    if (action === 'cancel') {
      logger.info(`[Worker] Cancel signal received`, { jobId });
      abortController.abort();
    }
  });

  try {
    const provider = await streamingResolver.resolve(conversation.provider);
    
    for await (const chunk of provider.generateStream({
      ...input,
      abortSignal: abortController.signal
    })) {
      // Check for abort
      if (abortController.signal.aborted) {
        logger.info(`[Worker] Generation aborted`, { jobId });
        break;
      }

      // Process chunk...
    }
  } finally {
    cancelSubscription.unsubscribe();
    cancelSubscription.disconnect();
  }
});
```

---

## 8. Partial Message Persistence

### 8.1 Persistent Storage During Streaming

```typescript
// Message record with partial state
interface Message {
  id: string;
  conversationId: string;
  content: string;           // Accumulates during streaming
  role: 'assistant' | 'user' | 'system';
  inputTokens: number;       // Final count after streaming
  outputTokens: number;      // Accumulates, final after streaming
  status: 'PENDING' | 'STREAMING' | 'COMPLETE' | 'ERROR';
  streamingJobId?: string;   // Link to StreamingJob
  createdAt: Date;
  completedAt?: Date;        // Set after streaming done
}
```

**Update Strategy:**

```typescript
// Option A: Buffered writes (recommended for performance)
// - Accumulate chunks in memory during streaming (100-token buffer)
// - Flush to DB every 5 seconds or on buffer full
// - Reduces DB write load, eventual consistency acceptable

// Option B: Real-time writes (for audit-critical messages)
// - Every chunk persisted immediately
// - Higher DB load but complete audit trail
// - Can be toggled per-message via conversation metadata

class PartialMessagePersister {
  private flushInterval = 5000; // 5 seconds
  private bufferSize = 100;      // tokens

  async streamWithPersistence(
    messageId: string,
    chunks: AsyncIterable<StreamChunk>,
    options: { auditCritical?: boolean } = {}
  ) {
    let buffer = '';
    let tokenCount = 0;
    let lastFlush = Date.now();

    for await (const chunk of chunks) {
      buffer += chunk.token;
      tokenCount++;

      // Flush based on time or size
      const shouldFlush = 
        tokenCount >= this.bufferSize || 
        Date.now() - lastFlush >= this.flushInterval ||
        options.auditCritical;

      if (shouldFlush) {
        await prisma.message.update({
          where: { id: messageId },
          data: {
            content: buffer,
            outputTokens: tokenCount
          }
        });
        
        lastFlush = Date.now();
      }
    }

    // Final flush
    await prisma.message.update({
      where: { id: messageId },
      data: {
        content: buffer,
        outputTokens: tokenCount,
        status: 'COMPLETE',
        completedAt: new Date()
      }
    });
  }
}
```

### 8.2 Redis Cache for Real-Time Display

```typescript
// Cache latest chunk state during streaming
// Key: message:${messageId}:state
// TTL: 24 hours (auto-delete after message persisted)

interface MessageStreamState {
  content: string;           // Latest accumulated content
  outputTokens: number;      // Current token count
  status: 'STREAMING' | 'COMPLETE' | 'ERROR';
  lastUpdateAt: Date;
}

// Update on every chunk
await redis.set(
  `message:${messageId}:state`,
  JSON.stringify({
    content: currentContent,
    outputTokens: tokenCount,
    status: 'STREAMING',
    lastUpdateAt: new Date()
  }),
  'EX', 86400 // 24h expiry
);
```

---

## 9. Streaming State Machine

### 9.1 Job State Diagram

```
         ┌──────────────────────────────────────────┐
         │  POST /messages (user message created)   │
         └──────────────────────┬───────────────────┘
                               │
                         ┌─────▼──────┐
                         │   QUEUED   │ ──► [Waiting for worker]
                         └─────┬──────┘
                               │
                    ┌──────────▼──────────┐
                    │ Worker picks up job │
                    └──────────┬──────────┘
                               │
                         ┌─────▼──────────┐
                         │   STREAMING    │ ──► SSE stream to client
                         └─────┬──────────┘
                               │
                      ┌────────▼─────────┐
                      │ Accumulate full  │
                      │ message content  │
                      └────────┬─────────┘
                               │
                      ┌────────▼──────────┐
                      │ Persist message   │
                      │ Update StreamJob  │
                      └────────┬──────────┘
                               │
                         ┌─────▼────────┐
                         │  COMPLETED   │ ──► 'done' event sent
                         └──────────────┘

              [On error at any stage]
                         │
         ┌───────────────▼────────────────┐
         │ Can retry? (attempt < MAX)     │
         └───────────────┬────────────────┘
                         │
                    ┌────┴────┐
                    │          │
                   NO         YES
                    │          │
            ┌───────▼──┐  ┌───▼────────┐
            │  FAILED  │  │ RETRYING   │
            │ 'error'  │  │ (QUEUED)   │
            │ event    │  │ +backoff   │
            └──────────┘  └────┬───────┘
                                │
                          [back to STREAMING]
```

### 9.2 State Transition Implementation

```typescript
class StreamingJobStateMachine {
  constructor(private jobId: string) {}

  async transition(from: Status, to: Status, metadata?: any) {
    const job = await prisma.streamingJob.findUnique({
      where: { id: this.jobId }
    });

    // Validate transition
    if (!this.isValidTransition(job.status, to)) {
      throw new InvalidStateTransitionError(
        `Cannot transition from ${job.status} to ${to}`
      );
    }

    // Update state
    const updated = await prisma.streamingJob.update({
      where: { id: this.jobId },
      data: {
        status: to,
        ...(to === Status.STREAMING && { startedAt: new Date() }),
        ...(to === Status.COMPLETED && { completedAt: new Date() }),
        ...(to === Status.FAILED && { failedAt: new Date() }),
        ...(metadata && { metadata: JSON.stringify(metadata) })
      }
    });

    logger.info(`[StateMachine] Transition`, {
      jobId: this.jobId,
      from: job.status,
      to,
      metadata
    });

    return updated;
  }

  private isValidTransition(from: Status, to: Status): boolean {
    const validTransitions: Record<Status, Status[]> = {
      [Status.PENDING]: [Status.STREAMING, Status.FAILED],
      [Status.STREAMING]: [Status.COMPLETED, Status.FAILED, Status.CANCELLED],
      [Status.COMPLETED]: [], // terminal
      [Status.FAILED]: [Status.PENDING], // retry
      [Status.CANCELLED]: []   // terminal
    };

    return validTransitions[from]?.includes(to) ?? false;
  }
}
```

---

## 10. Error Recovery

### 10.1 Provider Error Handling

```typescript
class ProviderErrorHandler {
  async handleStreamError(error: Error, attempt: number): Promise<RecoveryAction> {
    // Network errors → retry
    if (error instanceof NetworkError) {
      return { action: 'retry', backoffMs: 500 * Math.pow(2, attempt) };
    }

    // Rate limiting → retry with backoff
    if (error.code === 'RATE_LIMIT_EXCEEDED') {
      const retryAfter = error.retryAfter || 60;
      return { action: 'retry', backoffMs: retryAfter * 1000 };
    }

    // Timeout → retry
    if (error instanceof TimeoutError) {
      return { action: 'retry', backoffMs: 1000 };
    }

    // Authentication → fail permanently
    if (error.code === 'INVALID_API_KEY') {
      return { action: 'fail', reason: 'Invalid provider credentials' };
    }

    // Model not found → fail permanently
    if (error.code === 'MODEL_NOT_FOUND') {
      return { action: 'fail', reason: 'Model not available' };
    }

    // Unknown → retry up to limit, then fail
    return { action: 'retry_then_fail', backoffMs: 500 };
  }
}
```

### 10.2 Partial Message Recovery

```typescript
// If streaming fails mid-generation, partial message is preserved
// User can:
// 1. Regenerate from this message (creates new job)
// 2. Continue from this message (append more tokens)
// 3. Edit this message (manual fix)

class PartialMessageRecovery {
  async handleStreamingFailure(messageId: string, error: Error) {
    const message = await prisma.message.findUnique({ where: { id: messageId } });

    // Mark as error but keep partial content
    await prisma.message.update({
      where: { id: messageId },
      data: {
        status: 'ERROR',
        errorMessage: error.message,
        // content preserved from streaming buffer
      }
    });

    // Log for observability
    logger.error(`[PartialMessageRecovery] Streaming failed`, {
      messageId,
      error: error.message,
      contentLength: message.content.length,
      tokensGenerated: message.outputTokens
    });

    // Notify client of failure
    await redis.publish(
      `job:${message.streamingJobId}:stream`,
      JSON.stringify({
        type: 'error',
        payload: {
          code: 'STREAMING_FAILED',
          message: 'Generation failed, partial message saved',
          messageId,
          contentLength: message.content.length
        }
      })
    );
  }
}
```

---

## 11. Rate Limiting

### 11.1 Multi-Level Rate Limiting Strategy

**Level 1: Per-User Rate Limit**
```typescript
// Max 10 concurrent message generations per user
// Max 100 message generations per hour per user

const userStreamLimit = new RateLimiter({
  key: `stream:user:${userId}`,
  max: 10,        // concurrent
  windowMs: 3600000, // 1 hour
  perMinute: true
});

if (!await userStreamLimit.allow()) {
  throw new TooManyRequestsException(
    'You have too many active generations. Please wait.'
  );
}
```

**Level 2: Per-Workspace Rate Limit**
```typescript
// Max 100 concurrent streams across workspace
// Max 1000 streams per hour per workspace

const workspaceStreamLimit = new RateLimiter({
  key: `stream:workspace:${workspaceId}`,
  max: 100,        // concurrent
  windowMs: 3600000, // 1 hour
});

if (!await workspaceStreamLimit.allow()) {
  throw new TooManyRequestsException(
    'Workspace generation limit exceeded. Please try again later.'
  );
}
```

**Level 3: Per-Provider Rate Limit**
```typescript
// Respect provider's rate limits via headers
// E.g., Anthropic: 50,000 tokens/min

const providerLimit = new RateLimiter({
  key: `stream:provider:${provider}:tokens`,
  max: 50000,
  windowMs: 60000, // 1 minute
});

const tokensUsedThisMinute = await redis.get(`stream:${provider}:tokens:used`);
if (tokensUsedThisMinute + estimatedTokens > 50000) {
  throw new TooManyRequestsException(
    `Provider rate limit would be exceeded. Current: ${tokensUsedThisMinute}/50000`
  );
}
```

### 11.2 Rate Limit Headers

```typescript
// Send rate limit info to client
res.setHeader('X-RateLimit-Limit', '10');
res.setHeader('X-RateLimit-Remaining', '9');
res.setHeader('X-RateLimit-Reset', Math.ceil((Date.now() + 3600000) / 1000));
res.setHeader('Retry-After', '60');
```

---

## 12. Token Accounting

### 12.1 Token Counting During Streaming

```typescript
interface TokenAccounting {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  model: string;
  provider: string;
}

class TokenAccountant {
  private inputTokens = 0;
  private outputTokens = 0;
  private lastReportedAt = Date.now();

  onChunkReceived(chunk: StreamChunk) {
    this.outputTokens++;
    
    // Report every 50 tokens or 5 seconds
    if (this.outputTokens % 50 === 0 || Date.now() - this.lastReportedAt > 5000) {
      this.reportProgress();
      this.lastReportedAt = Date.now();
    }
  }

  onStreamComplete(usage: { inputTokens: number; outputTokens: number }) {
    this.inputTokens = usage.inputTokens;
    this.outputTokens = usage.outputTokens;
    this.reportFinal();
  }

  private reportProgress() {
    logger.debug(`[TokenAccounting] Progress`, {
      outputTokens: this.outputTokens,
      estimatedInputTokens: this.inputTokens || '?'
    });
  }

  private reportFinal() {
    const cost = estimateCost(
      this.model,
      this.inputTokens,
      this.outputTokens
    );

    logger.info(`[TokenAccounting] Final`, {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      estimatedCostCents: cost
    });
  }
}
```

### 12.2 Token Estimation vs Actual

```typescript
// Some providers send final token counts in usage field
// Others don't; we must estimate from chunk count

class SmartTokenCounter {
  private chunkCount = 0;
  private finalTokenCount?: number;

  addChunk() {
    this.chunkCount++;
  }

  setFinalCount(count: number) {
    this.finalTokenCount = count;
  }

  getTokenCount(): number {
    // Use actual if available, otherwise estimate
    return this.finalTokenCount ?? this.chunkCount;
  }

  getAccuracy(): 'EXACT' | 'ESTIMATED' {
    return this.finalTokenCount ? 'EXACT' : 'ESTIMATED';
  }
}
```

---

## 13. Usage Updates

### 13.1 Post-Streaming Usage Recording

After streaming completes, record usage atomically:

```typescript
// Separate from streaming (to avoid holding DB locks during streaming)
// Run after message persisted

async function recordStreamingUsage(
  conversationId: string,
  messageId: string,
  inputTokens: number,
  outputTokens: number,
  model: string,
  provider: string
) {
  const cost = estimateCost(provider, model, inputTokens, outputTokens);

  // Upsert aggregate usage
  await prisma.conversationUsage.upsert({
    where: { conversationId },
    create: {
      conversationId,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCost: cost
    },
    update: {
      inputTokens: { increment: inputTokens },
      outputTokens: { increment: outputTokens },
      totalTokens: { increment: inputTokens + outputTokens },
      estimatedCost: { increment: cost }
    }
  });

  // Append to ledger for audit
  await prisma.usageEvent.create({
    data: {
      conversationId,
      messageId,
      provider,
      model,
      inputTokens,
      outputTokens,
      costCents: cost,
      createdAt: new Date()
    }
  });

  logger.info(`[UsageRecorded]`, {
    conversationId,
    messageId,
    provider,
    model,
    inputTokens,
    outputTokens,
    costCents: cost
  });
}
```

### 13.2 Real-Time Usage Display

Send usage events to client during streaming for UI updates:

```typescript
// Client receives usage updates periodically
eventSource.addEventListener('chunk', (e) => {
  const { outputTokens } = JSON.parse(e.data);
  
  // Update UI: "Tokens: 42"
  updateTokenCounter(outputTokens);
});

eventSource.addEventListener('done', (e) => {
  const { inputTokens, outputTokens } = JSON.parse(e.data);
  const cost = estimateCost(model, inputTokens, outputTokens);
  
  // Update UI: "Input: 42 | Output: 100 | Cost: $0.001"
  updateUsageDisplay(inputTokens, outputTokens, cost);
});
```

---

## 14. Abort Handling

### 14.1 Clean Abort Sequence

```typescript
// 1. Client initiates abort
eventSource.close();
await fetch(`/api/stream/${jobId}/cancel`, { method: 'POST' });

// 2. Server receives cancellation request
// - Updates StreamingJob status to CANCELLED
// - Publishes cancel signal to Redis

// 3. Worker receives signal
// - Calls abortController.abort()
// - Provider stream terminates early
// - Accumulated message persisted (partial)

// 4. Client receives no more events
// - User sees partial message in UI
// - "Message generation cancelled" toast

// 5. Cleanup
// - Redis subscription closed
// - Message marked as CANCELLED (status)
// - Job record updated with cancelledAt timestamp
```

### 14.2 Cleanup Guarantees

```typescript
class StreamCleanupManager {
  async cleanup(jobId: string) {
    const job = await prisma.streamingJob.findUnique({ where: { id: jobId } });

    // 1. Close Redis subscriptions
    await redis.unsubscribe(`job:${jobId}:stream`);
    await redis.unsubscribe(`job:${jobId}:control`);

    // 2. Close message streaming cache
    await redis.del(`message:${job.messageId}:chunks`);

    // 3. Mark job as terminated
    await prisma.streamingJob.update({
      where: { id: jobId },
      data: {
        status: StreamingJobStatus.CANCELLED,
        cancelledAt: new Date()
      }
    });

    // 4. Mark message as terminal (no more changes)
    if (job.messageId) {
      const message = await prisma.message.findUnique({
        where: { id: job.messageId }
      });
      
      await prisma.message.update({
        where: { id: job.messageId },
        data: {
          status: message.content ? 'COMPLETE' : 'CANCELLED'
        }
      });
    }

    logger.info(`[StreamCleanup] Complete`, { jobId });
  }
}
```

---

## 15. Queue Interaction

### 15.1 Message Generation Job Enqueue

When user sends message, enqueue generation job:

```typescript
// routes/messages.ts
app.post('/api/conversations/:id/messages', async (req, res) => {
  const { content, role } = req.body;

  // 1. Create user message
  const userMessage = await prisma.message.create({
    data: {
      conversationId: req.params.id,
      content,
      role,
      status: 'COMPLETE'
    }
  });

  // 2. If user message, trigger generation
  if (role === 'user') {
    // Create streaming job record
    const job = await prisma.streamingJob.create({
      data: {
        conversationId: req.params.id,
        status: 'PENDING',
        attempt: 0
      }
    });

    // Create assistant message placeholder
    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: req.params.id,
        content: '', // will be filled during streaming
        role: 'assistant',
        status: 'PENDING',
        streamingJobId: job.id
      }
    });

    // Enqueue generation job
    await queue.add(
      'generate_response',
      {
        jobId: job.id,
        conversationId: req.params.id,
        messageId: assistantMessage.id,
        userId: req.user.id
      },
      {
        attempts: 1, // We handle retries in worker
        backoff: {
          type: 'exponential',
          delay: 500
        },
        removeOnComplete: true
      }
    );

    logger.info(`[MessageRoute] Generation job enqueued`, {
      jobId: job.id,
      conversationId: req.params.id
    });
  }

  res.status(201).json({
    userMessage,
    assistantMessage: role === 'user' ? { id: assistantMessage.id, status: 'PENDING' } : null
  });
});
```

### 15.2 Job Priority & Routing

```typescript
// Different job priorities for different user tiers
const jobOptions = {
  tier: 'free',      // or 'pro', 'enterprise'
  priority: tier === 'enterprise' ? 1 : tier === 'pro' ? 5 : 10,
  timeout: tier === 'enterprise' ? 300000 : 120000  // 5min vs 2min
};

await queue.add('generate_response', jobData, jobOptions);
```

---

## 16. Worker Interaction

### 16.1 Bull Queue Processor

```typescript
// apps/backend/src/workers/generateResponse.worker.ts

queue.process('generate_response', async (bullJob) => {
  const { jobId, conversationId, messageId } = bullJob.data;

  const retryEngine = new StreamingJobRetryEngine();

  return await retryEngine.executeWithRetry(jobId, async () => {
    // 1. Fetch conversation + context
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: PROMPT_HISTORY_WINDOW
        }
      }
    });

    // 2. Build prompt
    const messages = buildPromptContext(conversation.messages);
    const systemPrompt = conversation.systemPrompt || DEFAULT_SYSTEM_PROMPT;

    // 3. Select provider
    const provider = await streamingResolver.resolve(conversation.provider);

    // 4. Stream generation
    const accumulator = new StreamingAccumulator();

    for await (const chunk of provider.generateStream({
      messages,
      model: conversation.model,
      systemPrompt,
      maxTokens: 1024
    })) {
      // Emit to client via Redis
      await redis.publish(
        `job:${jobId}:stream`,
        JSON.stringify({
          type: 'token',
          payload: {
            token: chunk.token,
            provider: conversation.provider,
            model: conversation.model
          }
        })
      );

      accumulator.addChunk(chunk.token);

      // Update progress in Bull job
      bullJob.progress(Math.min(99, accumulator.getTokenCount() / 2));
    }

    // 5. Persist complete message
    const finalText = accumulator.getFullText();
    
    const message = await prisma.message.update({
      where: { id: messageId },
      data: {
        content: finalText,
        inputTokens: chunk.usage?.inputTokens || estimateInputTokens(messages),
        outputTokens: chunk.usage?.outputTokens || accumulator.getTokenCount(),
        status: 'COMPLETE',
        completedAt: new Date()
      }
    });

    // 6. Update conversation
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: message.createdAt }
    });

    // 7. Record usage
    await recordStreamingUsage(
      conversationId,
      messageId,
      message.inputTokens,
      message.outputTokens,
      conversation.model,
      conversation.provider
    );

    // 8. Emit completion event
    await redis.publish(
      `job:${jobId}:stream`,
      JSON.stringify({
        type: 'done',
        payload: {
          messageId,
          inputTokens: message.inputTokens,
          outputTokens: message.outputTokens,
          model: conversation.model,
          completedAt: message.completedAt
        }
      })
    );

    logger.info(`[Worker] Generation complete`, {
      jobId,
      conversationId,
      messageId,
      tokensOutput: message.outputTokens
    });

    return { success: true, messageId };
  });
});
```

---

## 17. Background Processing

### 17.1 Async Non-Blocking Operations

During streaming, defer heavy operations:

```typescript
// DURING streaming (fast path)
// - Accumulate chunks in memory
// - Emit to Redis pub/sub
// - Count tokens
// - (all <10ms per chunk)

// AFTER streaming completes (deferred)
// - Persist message to DB (1 write)
// - Index in Elasticsearch (async queue)
// - Generate embeddings (async queue)
// - Update conversation metadata (1 write)
// - Record usage (1 upsert)
```

### 17.2 Deferred Task Scheduling

```typescript
// After message completion, schedule background tasks

async function schedulePostStreamingTasks(messageId: string, conversationId: string) {
  // Index for search
  await searchQueue.add('index_message', { messageId }, { delay: 1000 });

  // Generate semantic embeddings
  await embeddingQueue.add('generate_embedding', { messageId }, { delay: 2000 });

  // Update conversation summary (if needed)
  await summaryQueue.add('update_summary', { conversationId }, { delay: 5000 });

  // Cleanup streaming artifacts
  await cleanupQueue.add('cleanup_stream_cache', { messageId }, { delay: 60000 });
}
```

---

## 18. Observability

### 18.1 Metrics

```typescript
// Prometheus-style metrics for monitoring

interface StreamingMetrics {
  // Counters
  streams_started: Counter;       // Total streams initiated
  streams_completed: Counter;     // Total streams succeeded
  streams_failed: Counter;        // Total streams failed
  streams_cancelled: Counter;     // Total streams cancelled
  chunks_streamed: Counter;       // Total chunks sent
  tokens_generated: Counter;      // Total output tokens
  tokens_input: Counter;          // Total input tokens
  retries_triggered: Counter;     // Total retry attempts
  
  // Gauges
  active_streams: Gauge;          // Currently streaming conversations
  queue_depth: Gauge;             // Pending jobs in queue
  
  // Histograms
  stream_duration_ms: Histogram;  // Time to complete streaming
  time_to_first_token_ms: Histogram; // Latency to first token
  tokens_per_second: Histogram;   // Streaming speed
  chunk_size: Histogram;          // Bytes per chunk
}

// Record metrics
metrics.streams_started.inc({ provider: 'anthropic', model: 'claude-opus' });
metrics.tokens_generated.inc(outputTokens, { provider, model });
metrics.stream_duration_ms.observe(durationMs, { provider });
```

### 18.2 Distributed Tracing

```typescript
// OpenTelemetry instrumentation

const tracer = getTracer('synora-streaming');

const span = tracer.startSpan('streaming.generate', {
  attributes: {
    'conversation.id': conversationId,
    'message.id': messageId,
    'provider': provider,
    'model': model
  }
});

for await (const chunk of provider.generateStream(...)) {
  const chunkSpan = tracer.startSpan('streaming.chunk', {
    parent: span,
    attributes: {
      'chunk.tokens': chunk.token.length,
      'chunk.index': chunkIndex++
    }
  });

  // ... process chunk ...

  chunkSpan.end();
}

span.end();
```

### 18.3 Structured Logging

```typescript
// Every streaming event logged with context

logger.info(`[Streaming] Started`, {
  jobId,
  conversationId,
  userId,
  provider,
  model,
  timestamp: new Date().toISOString()
});

logger.debug(`[Streaming] Chunk received`, {
  jobId,
  chunkSize: chunk.token.length,
  outputTokens: currentTokenCount,
  elapsed: Date.now() - startTime
});

logger.error(`[Streaming] Failed`, {
  jobId,
  error: error.message,
  stack: error.stack,
  attempt,
  retriable: classifier.isRetryable(error)
});
```

---

## 19. Security

### 19.1 Authorization Checks

Every streaming endpoint enforces two-layer checks:

```typescript
// Layer 1: Workspace membership
const membership = await requireMembership(userId, workspaceId);

// Layer 2: Role-based permission
requirePermission(membership.role, 'message:send');  // for stream initiation
requirePermission(membership.role, 'message:read');   // for stream subscription
```

### 19.2 Input Validation

```typescript
// Validate all streaming inputs

const streamQuerySchema = z.object({
  messageId: z.string().cuid().min(1),
  workspaceId: z.string().cuid().min(1)
});

const { messageId, workspaceId } = streamQuerySchema.parse(req.query);
```

### 19.3 Secrets & Credentials

```typescript
// Never log or expose provider API keys

// ✅ Safe
logger.info(`[Provider] Initialized`, { provider: 'anthropic' });

// ❌ Unsafe
logger.info(`[Provider] Initialized`, { apiKey: 'sk-...' }); // Never!
```

### 19.4 Rate Limiting (DDoS Prevention)

```typescript
// Rate limit streaming endpoints

app.get('/api/conversations/:id/stream', 
  rateLimitByUser(10, '1 hour'),     // 10 concurrent streams
  rateLimitByWorkspace(100, '1 hour'), // 100 workspace streams
  (req, res) => { ... }
);
```

### 19.5 Connection Timeout

```typescript
// Prevent resource exhaustion from hung connections

const STREAM_TIMEOUT = 30 * 60 * 1000; // 30 minutes max

const timeout = setTimeout(() => {
  logger.warn(`[Streaming] Timeout`, { jobId });
  res.write(`event: timeout\ndata: {"reason":"Stream timeout"}\n\n`);
  res.end();
}, STREAM_TIMEOUT);

req.on('close', () => clearTimeout(timeout));
```

---

## 20. Testing Strategy

### 20.1 Unit Tests

```typescript
// services.streaming.test.ts

describe('StreamingAccumulator', () => {
  it('accumulates tokens correctly', () => {
    const acc = new StreamingAccumulator();
    acc.addChunk('Hello');
    acc.addChunk(' ');
    acc.addChunk('world');
    
    expect(acc.getFullText()).toBe('Hello world');
    expect(acc.getTokenCount()).toBe(3);
  });
});

describe('TokenAccountant', () => {
  it('reports tokens on progress intervals', () => {
    const accountant = new TokenAccountant();
    const reports: number[] = [];
    
    accountant.onReportProgress = (count) => reports.push(count);
    
    for (let i = 0; i < 150; i++) {
      accountant.onChunk();
    }
    
    expect(reports.length).toBeGreaterThan(1); // Multiple reports
    expect(reports[reports.length - 1]).toBe(150); // Final count
  });
});

describe('ErrorClassifier', () => {
  it('classifies rate limit as retryable', () => {
    const classifier = new ErrorClassifier();
    const error = new Error('Rate limit');
    error.code = 'RATE_LIMIT_EXCEEDED';
    
    expect(classifier.isRetryable(error)).toBe(true);
    expect(classifier.getRetryAfterSeconds(error)).toBeGreaterThan(0);
  });

  it('classifies auth error as non-retryable', () => {
    const error = new Error('Auth failed');
    error.code = 'INVALID_API_KEY';
    
    expect(classifier.isRetryable(error)).toBe(false);
  });
});
```

### 20.2 Integration Tests

```typescript
// routes.streaming.test.ts

describe('GET /api/conversations/:id/stream', () => {
  it('streams tokens from provider to client', async () => {
    const user = await createUser();
    const workspace = await createWorkspace(user);
    const conversation = await createConversation(workspace);
    const userMessage = await createMessage(conversation, 'user', 'Hello');

    // Subscribe to stream
    const response = await get(
      `/api/conversations/${conversation.id}/stream?messageId=${userMessage.id}`,
      { auth: user }
    );

    expect(response.headers['content-type']).toContain('text/event-stream');

    // Parse SSE events
    const events = parseSSEEvents(response.body);
    
    expect(events.some(e => e.type === 'token')).toBe(true);
    expect(events.some(e => e.type === 'done')).toBe(true);
  });

  it('handles reconnection with partial chunks', async () => {
    // Simulate connection drop
    // Reconnect with lastChunkIndex parameter
    // Verify cached chunks replayed first
  });

  it('returns 403 for unauthorized user', async () => {
    const response = await get(
      `/api/conversations/${conversation.id}/stream?messageId=${message.id}`,
      { auth: unauthorizedUser }
    );

    expect(response.status).toBe(403);
  });
});
```

### 20.3 Provider Mock Tests

```typescript
// ai.providers.mock.test.ts

describe('SynoraMockStreamProvider', () => {
  it('emits predictable token sequence', async () => {
    const provider = new SynoraMockStreamProvider();
    const chunks: StreamChunk[] = [];

    for await (const chunk of provider.generateStream({
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'mock-model'
    })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[chunks.length - 1].type).toBe('usage');
  });

  it('respects maxTokens limit', async () => {
    const provider = new SynoraMockStreamProvider();
    const tokens: string[] = [];

    for await (const chunk of provider.generateStream({
      messages: [{ role: 'user', content: 'test' }],
      model: 'mock-model',
      maxTokens: 10
    })) {
      if (chunk.type === 'token') tokens.push(chunk.token);
    }

    expect(tokens.length).toBeLessThanOrEqual(10);
  });

  it('handles abort signal', async () => {
    const provider = new SynoraMockStreamProvider();
    const abortController = new AbortController();
    const tokens: string[] = [];

    const gen = provider.generateStream({
      messages: [{ role: 'user', content: 'test' }],
      model: 'mock-model',
      abortSignal: abortController.signal
    });

    // Get first few tokens
    for (let i = 0; i < 5; i++) {
      const { value } = await gen.next();
      if (value?.type === 'token') tokens.push(value.token);
    }

    // Abort
    abortController.abort();
    const { done } = await gen.next();

    expect(done).toBe(true);
    expect(tokens.length).toBeLessThan(20);
  });
});
```

### 20.4 Load Tests

```typescript
// stress.test.ts using k6

import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  vus: 100,           // 100 virtual users
  duration: '5m',     // 5 minute test
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95th percentile < 500ms
    http_req_failed: ['rate<0.1']      // <10% failure rate
  }
};

export default function () {
  // Create message
  const createRes = http.post(`${BASE_URL}/api/conversations/${conversationId}/messages`, {
    content: 'Hello streaming world',
    role: 'user'
  }, {
    headers: { Authorization: `Bearer ${token}` }
  });

  check(createRes, {
    'message created': (r) => r.status === 201,
  });

  const messageId = createRes.json('assistantMessage.id');

  // Stream response
  const streamRes = http.get(
    `${BASE_URL}/api/conversations/${conversationId}/stream?messageId=${messageId}`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  );

  check(streamRes, {
    'stream started': (r) => r.status === 200,
    'is SSE': (r) => r.headers['Content-Type'].includes('text/event-stream')
  });

  sleep(5); // Pause between iterations
}
```

---

## 21. Documentation

### 21.1 Architecture Documentation

Create `docs/streaming-architecture.md` covering:

- High-level topology (browser → API → queue → worker → Redis → client)
- Protocol flow (SSE message format)
- Error scenarios and recovery
- Performance characteristics (latency, throughput, resource usage)

### 21.2 API Documentation

Document `/api/conversations/:id/stream` endpoint:

```markdown
# GET /api/conversations/:id/stream

Subscribe to real-time message generation stream.

## Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| messageId | string | yes | ID of the assistant message being generated |
| workspaceId | string | yes | Workspace scope |

## Response Headers

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 9
```

## Response Events

### token
```json
event: token
data: {"token":"Hello","provider":"anthropic","model":"claude-opus"}
```

### chunk
```json
event: chunk
data: {"chunk":"Hello world","outputTokens":5}
```

### done
```json
event: done
data: {"messageId":"msg_123","inputTokens":42,"outputTokens":2,"completedAt":"2026-07-30T06:00:00Z"}
```

### error
```json
event: error
data: {"code":"RATE_LIMIT","message":"Rate limit exceeded","retryAfter":60}
```

### heartbeat
```json
event: heartbeat
data: {"timestamp":"2026-07-30T06:00:15Z"}
```

## Error Codes

| Code | Status | Meaning | Action |
|------|--------|---------|--------|
| UNAUTHORIZED | 401 | User not authenticated | Login and retry |
| FORBIDDEN | 403 | User lacks permission | Check role |
| RATE_LIMIT | 429 | User/workspace rate limit | Wait and retry |
| GENERATION_FAILED | 500 | Provider error | Retry or contact support |
| STREAM_TIMEOUT | 500 | Stream exceeded 30min | Regenerate |
```

### 21.3 Developer Guide

Create `docs/streaming-guide.md` with:

- How to add a new streaming provider
- How to test streaming locally
- How to debug stream failures
- Performance tuning guide
- Monitoring setup

---

## 22. Acceptance Criteria

### 22.1 Functional Requirements

✅ **Streaming Protocol**
- [ ] SSE endpoint implemented and tested
- [ ] Message format matches spec (token, chunk, done, error, heartbeat)
- [ ] Events parseable by EventSource API

✅ **Provider Abstraction**
- [ ] Provider interface defined
- [ ] Anthropic implementation complete
- [ ] OpenAI implementation complete
- [ ] Mock provider for testing complete
- [ ] Provider resolver working

✅ **Chunk Lifecycle**
- [ ] Chunks accumulated in-memory
- [ ] Chunks persisted every 5s or at buffer size
- [ ] Final message saved with complete text
- [ ] Token counts accurate (exact or estimated)

✅ **Reconnection**
- [ ] Client detects disconnection
- [ ] Automatic reconnect with backoff
- [ ] Server resumes from last chunk
- [ ] No duplicate chunks sent
- [ ] Max 5 reconnect attempts

✅ **Retry Strategy**
- [ ] Transient errors retry automatically
- [ ] Exponential backoff [500ms, 1500ms]
- [ ] Max 3 total attempts
- [ ] Non-retryable errors fail immediately
- [ ] Error message captured in job record

✅ **Cancellation**
- [ ] Client can cancel in-flight generation
- [ ] Worker receives cancel signal
- [ ] Provider stream terminates
- [ ] Partial message preserved
- [ ] No further chunks sent

✅ **Token Accounting**
- [ ] Input tokens counted correctly
- [ ] Output tokens incremented per chunk
- [ ] Final counts reported in 'done' event
- [ ] Usage recorded in ConversationUsage
- [ ] Cost calculated per model/provider

✅ **Error Recovery**
- [ ] Transient errors (network, timeout) retried
- [ ] Permanent errors (auth, model) fail immediately
- [ ] Partial message preserved on failure
- [ ] User can retry from partial message
- [ ] Error cause logged for debugging

### 22.2 Performance Requirements

✅ **Latency**
- [ ] Time to first token: <1s (p95)
- [ ] Chunk processing: <10ms per chunk
- [ ] Stream completion: within 30 minutes max

✅ **Throughput**
- [ ] Support 100 concurrent streams per workspace
- [ ] Queue processing: <500ms queue time (p95)
- [ ] Token throughput: 50+ tokens/sec per stream

✅ **Resource Usage**
- [ ] Memory per stream: <10MB (in-memory buffer)
- [ ] Redis memory: <100MB per 10K active streams
- [ ] CPU: <2% per stream (worker)

### 22.3 Reliability

✅ **Durability**
- [ ] No lost messages (partial or complete)
- [ ] Retries don't create duplicates
- [ ] Reconnections don't lose state
- [ ] Database writes atomic

✅ **Availability**
- [ ] 99.9% uptime (3.6s down per month)
- [ ] Graceful degradation on provider outage
- [ ] Fallback providers available

✅ **Security**
- [ ] Workspace isolation enforced
- [ ] Role-based permission checked
- [ ] No API keys logged
- [ ] Rate limits enforced
- [ ] Input validation on all fields

### 22.4 Observability

✅ **Metrics**
- [ ] Streams started/completed/failed counters
- [ ] Active streams gauge
- [ ] Stream duration histogram
- [ ] Tokens per second histogram
- [ ] Error rate tracking

✅ **Logging**
- [ ] Generation start/completion logged
- [ ] Errors with full context logged
- [ ] Retry attempts logged
- [ ] Performance metrics logged
- [ ] No sensitive data logged

✅ **Tracing**
- [ ] Distributed trace context propagated
- [ ] Span per streaming operation
- [ ] Traces queryable by jobId/conversationId

### 22.5 Testing

✅ **Unit Tests**
- [ ] Accumulator logic
- [ ] Token counting
- [ ] Error classification
- [ ] State transitions
- [ ] Coverage >80%

✅ **Integration Tests**
- [ ] E2E streaming flow
- [ ] Reconnection scenarios
- [ ] Retry scenarios
- [ ] Cancellation scenarios
- [ ] Error scenarios
- [ ] Authorization checks

✅ **Load Tests**
- [ ] 100 concurrent streams
- [ ] 5-minute sustained load
- [ ] p95 latency <500ms
- [ ] <10% error rate

---

## 23. Implementation Sequence

### Phase 1: Provider Abstraction (1 week)
1. Define `TextGenerationStreamProvider` interface
2. Implement `AnthropicStreamProvider`
3. Implement `OpenAIStreamProvider`
4. Implement mock provider
5. Create provider resolver
6. Write unit tests for all providers

### Phase 2: Core Streaming (1 week)
1. Implement SSE route handler
2. Create streaming accumulator
3. Create token accountant
4. Implement Redis pub/sub integration
5. Write integration tests
6. Add error handling

### Phase 3: Worker Integration (1 week)
1. Create Bull queue processor
2. Implement retry logic
3. Integrate with provider abstraction
4. Add partial message persistence
5. Implement state machine
6. Write worker tests

### Phase 4: Advanced Features (1 week)
1. Implement reconnection strategy
2. Implement cancellation
3. Implement rate limiting
4. Add token accounting hooks
5. Write load tests

### Phase 5: Observability & Polish (1 week)
1. Add metrics instrumentation
2. Add distributed tracing
3. Create documentation
4. Performance tuning
5. Security review
6. Final integration tests

**Total: 5 weeks**

---

## 24. Risk Analysis

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Provider API changes | Medium | Adapter pattern; version pinning |
| Memory leaks from stuck connections | High | Connection timeout; explicit cleanup on disconnect |
| Token counting inaccuracy | Medium | Fallback to estimation; reconcile on completion |
| Provider rate limit exceeded | Medium | Pre-check token budget; queue-based backpressure |
| Database write failures during streaming | High | Async persistence; retry logic; message cache |
| EventSource browser idle timeout | Medium | Heartbeat every 30s; client-side timeout detection |
| Concurrent edit conflicts | Low | Soft-delete pattern; message immutability |

---

## Conclusion

M3: AI Streaming Engine provides production-grade, provider-agnostic message streaming with robust error handling, token accounting, and observability. The design prioritizes reliability (partial message recovery), user experience (low latency, smooth stream), and operational safety (rate limiting, resource management).

**Readiness**: Design complete. Ready for implementation phase.

---

**Document Version**: 1.0  
**Last Updated**: 2026-07-30  
**Status**: Design Phase ✓ → Ready for Implementation
