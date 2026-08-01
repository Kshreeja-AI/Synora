# Streaming Architecture — Milestone 3

## Overview

Synora's streaming engine provides real-time AI response streaming with provider-agnostic abstractions, robust error handling, cancellation support, and comprehensive observability.

### Key Principles

- **Provider Agnostic**: Single abstraction supports 7+ providers (Anthropic, OpenAI, Gemini, OpenRouter, Groq, DeepSeek, Mock)
- **Stateless**: HTTP-based SSE protocol enables horizontal scaling
- **Resilient**: Exponential backoff retry logic with error classification
- **Observable**: Structured logging, Prometheus metrics, OpenTelemetry tracing
- **Cancelable**: AbortController-based cancellation propagated through full stack

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser / Client                         │
│                   (Next.js Frontend, React)                     │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP/SSE
                          │ GET /api/conversations/:id/stream
                          │ POST /api/conversations/:id/stream/:jobId/cancel
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Express Backend (Node.js)                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ routes/streaming.ts (SSE Endpoint & Cancellation Route)  │  │
│  │  • Auth & Authorization checks                           │  │
│  │  • SSE header setup (Content-Type, Cache-Control)        │  │
│  │  • Redis Pub/Sub subscription                            │  │
│  │  • Event forwarding (token → SSE write)                  │  │
│  │  • Heartbeat keepalive (30s interval)                    │  │
│  │  • Error handling & cleanup                              │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          │                                      │
│                          │ (Redis publish)                      │
│                          │ (Redis subscribe)                    │
│                          ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Bull Queue Worker (generateResponse.worker.ts)           │  │
│  │  • Message history retrieval (window by token budget)     │  │
│  │  • Prompt context assembly (system + history + user)     │  │
│  │  • Provider instance resolution                          │  │
│  │  • Stream generation loop                                │  │
│  │  • Token accumulation & progress tracking                │  │
│  │  • Cancellation signal handling                          │  │
│  │  • Message persistence (complete + error states)         │  │
│  │  • Usage tracking & cost calculation                     │  │
│  │  • Redis event broadcasting                              │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          │                                      │
│                          │ (resolve provider)                   │
│                          │ (generateStream call)                │
│                          ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ AI Provider Abstraction (StreamingProviderResolver)      │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ Provider Registry (Singleton)                      │  │  │
│  │  │  • Anthropic native SDK                            │  │  │
│  │  │  • OpenAI compatible (openai, openrouter, groq)    │  │  │
│  │  │  • Gemini native SDK                               │  │  │
│  │  │  • DeepSeek OpenAI-compatible                      │  │  │
│  │  │  • Mock for testing                                │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP (with streaming support)
                          │ (async generators)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│              AI Providers (External APIs)                        │
│  • Anthropic (https://api.anthropic.com)                        │
│  • OpenAI (https://api.openai.com)                              │
│  • Google Gemini (https://generativelanguage.googleapis.com)   │
│  • OpenRouter (https://openrouter.ai/api/v1)                  │
│  • Groq (https://api.groq.com)                                 │
│  • DeepSeek (https://api.deepseek.com)                         │
└─────────────────────────────────────────────────────────────────┘

Infrastructure:
  PostgreSQL 16+ (Prisma ORM)
    ├─ Conversation (metadata, system prompt)
    ├─ Message (immutable, final text + token counts)
    ├─ StreamingJob (tracking job lifecycle)
    └─ ConversationUsage (aggregate token counts & costs)

  Redis (Bull Queue + Pub/Sub)
    ├─ Queue: generate_response (background tasks)
    ├─ Pub/Sub: job:{jobId}:stream (event broadcast)
    └─ Pub/Sub: job:{jobId}:control (cancellation signal)
```

---

## Data Flow — Message Generation to Streaming Response

### Sequence Diagram

```
Browser                 Backend                 Queue Worker          Providers
  │                       │                         │                     │
  │ POST /messages        │                         │                     │
  ├──────────────────────>│                         │                     │
  │                       │ Create Message          │                     │
  │                       │ (role=USER, PENDING)    │                     │
  │                       │                         │                     │
  │                       │ Enqueue Job             │                     │
  │                       ├────────────────────────>│                     │
  │                       │                         │                     │
  │ GET /stream           │                         │                     │
  ├──────────────────────>│                         │                     │
  │ (subscribe SSE)       │ Subscribe Redis         │                     │
  │                       │ job:{jobId}:stream      │                     │
  │                       │<────────────────────────┤ Fetch context       │
  │                       │                         │ (conv, history)     │
  │                       │                         │                     │
  │                       │                         │ Resolve provider    │
  │                       │                         │                     │
  │                       │                         │ Call generateStream │
  │                       │                         ├────────────────────>│
  │                       │                         │ AsyncIterable<      │
  │                       │                         │   StreamChunk>      │
  │                       │                         │                     │
  │ SSE: event=token     │                         │ Accumulate tokens   │
  │ data: "hello"        │<────────────────────────┤ Redis publish       │
  │<──────────────────────┤ (Redis subscribe)       │ (worker → backend)  │
  │                       │                         │                     │
  │ SSE: event=token     │                         │ Update progress     │
  │ data: "world"        │<────────────────────────┤ (Bull job.progress) │
  │<──────────────────────┤                         │                     │
  │                       │                         │                     │
  │ [repeat for each token]                        │                     │
  │                       │                         │ Persist message     │
  │ SSE: event=done      │                         │ (content, tokens)   │
  │ data: {...usage...}  │<────────────────────────┤ Update usage        │
  │<──────────────────────┤                         │ (ConversationUsage) │
  │                       │                         │                     │
  │ (connection close)    │                         │                     │
  │                       │ Cleanup Redis           │ Cleanup             │
  │                       │ (unsubscribe)           │ (cancel subscription)
  │                       │                         │                     │
  
Cancellation Path:
  │ POST /stream/:jobId/cancel
  ├──────────────────────>│ Publish control signal
  │                       ├────────────────────────>│ on('message') handler
  │                       │ (Redis job:X:control)   │
  │                       │                         │ abortController.abort()
  │                       │                         │
  │                       │                         │ for-await loop
  │                       │                         │ (signal.aborted check)
  │                       │                         │ break (stop iteration)
  │                       │                         │
  │                       │                         │ Cleanup
  │                       │                         │ Update status: CANCELLED
  │                       │                         │
```

---

## Component Details

### 1. Streaming Types & Interfaces (`ai/streaming/types.ts`)

**StreamChunk** (Discriminated Union):
```typescript
type StreamChunk =
  | { type: 'token'; token: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'error'; code: string; message: string }
  | { type: 'heartbeat'; timestamp: string };
```

**TextGenerationStreamProvider** (Abstract Interface):
```typescript
interface TextGenerationStreamProvider {
  generateStream(input: GenerateStreamInput): AsyncIterable<StreamChunk>;
  getName(): string;
  isConfigured(): boolean;
}
```

**GenerateStreamInput**:
- `messages`: Message[] (conversation history)
- `model`: string (e.g., "claude-opus", "gpt-4")
- `maxTokens`: number (default 2048)
- `temperature`: number (0-2, default 1)
- `topP`: number (0-1, optional)
- `topK`: number (optional)
- `systemPrompt`: string (overrides default)
- `abortSignal`: AbortSignal (for cancellation)
- `frequencyPenalty`: number (optional)
- `presencePenalty`: number (optional)

**Custom Errors**:
- `StreamingError`: Base class
- `ProviderNotFoundError`: Provider not registered
- `ProviderNotConfiguredError`: Provider missing API key
- `RateLimitError`: Provider rate limit (429)
- `TimeoutError`: Network/processing timeout

### 2. Provider Implementations

**Common Pattern** (all providers implement):
```typescript
class ProviderNameStreamProvider implements TextGenerationStreamProvider {
  async *generateStream(input: GenerateStreamInput): AsyncIterable<StreamChunk> {
    // 1. Validate configuration (API key, model availability)
    // 2. Build request (messages, parameters, system prompt)
    // 3. Call provider API (with abort signal)
    // 4. for await (chunk of stream):
    //    - Parse chunk based on provider format
    //    - yield { type: 'token', token }
    //    - Accumulate token counts
    //    - On completion: yield { type: 'usage', inputTokens, outputTokens }
    // 5. Error handling: classify errors (retryable vs non-retryable)
  }
  
  getName(): string { return 'provider-name'; }
  
  isConfigured(): boolean {
    return !!process.env.PROVIDER_API_KEY;
  }
}
```

**Provider-Specific Notes**:

| Provider | SDK | Strategy | Notes |
|----------|-----|----------|-------|
| **Anthropic** | Native `@anthropic-ai/sdk` | Map events (message_start, content_block_delta, message_delta) | Token counts in message_delta |
| **OpenAI** | Native `openai` | Stream with `stream: true`, iterate chunks | Usage in final response |
| **Gemini** | Native `@google/generative-ai` | `generateContentStream()`, system instruction param | Token counts in usageMetadata |
| **OpenRouter** | OpenAI-compatible | Custom baseURL `https://openrouter.ai/api/v1` | Extends OpenAI provider |
| **Groq** | `groq-sdk` (OpenAI-compatible) | OpenAI message format | Fast inference |
| **DeepSeek** | OpenAI-compatible | Custom baseURL `https://api.deepseek.com/beta` | OpenAI message format |
| **Mock** | None (test-only) | Emit MOCK_RESPONSE word-by-word, simulate delays | Always configured, realistic timing |

### 3. Streaming Accumulator & Token Accountant

**StreamingAccumulator**:
- Buffers tokens in memory (array of strings)
- Tracks elapsed time, tokens/second
- Determines if progress should be reported (50-token or 5s interval)
- Computes summary for final message

**TokenAccountant**:
- Tracks input/output tokens separately
- Stores model & provider for cost lookup
- Reports progress at 5s intervals
- Returns summary with all fields for database storage

### 4. State Machine & Retry Engine

**StreamingJobStatus**:
```
PENDING → RUNNING → COMPLETED
              ├──→ FAILED → PENDING (retry)
              └──→ CANCELLED (terminal)
```

**Valid Transitions**:
```typescript
const VALID_TRANSITIONS = {
  [PENDING]: [RUNNING, FAILED],
  [RUNNING]: [COMPLETED, FAILED, CANCELLED],
  [COMPLETED]: [],
  [FAILED]: [PENDING],
  [CANCELLED]: []
};
```

**RetryEngine**:
- Max 3 attempts, backoff: [500ms, 1500ms]
- Retryable errors: TimeoutError, RateLimitError, ECONNRESET, ETIMEDOUT, SERVICE_OVERLOADED
- Non-retryable: INVALID_API_KEY, INVALID_MODEL, AUTHENTICATION_ERROR, INSUFFICIENT_QUOTA
- Updates job.lastError after each attempt, transitions to FAILED if non-retryable or exhausted

### 5. SSE Streaming Endpoint

**GET /api/conversations/:conversationId/stream**

Query Parameters:
- `messageId`: string (message being generated)
- `workspaceId`: string (for authorization)

Auth Middleware:
- `requireAuth`: Validates JWT token
- `requireMembership`: Checks user is workspace member
- `requirePermission`: Checks 'message:read' permission

Response:
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`
- `X-Accel-Buffering: no` (disable nginx buffering)

Events Emitted:
```
event: token
data: {"token": "hello", "provider": "anthropic", "model": "claude-opus"}

event: token
data: {"token": " world", ...}

event: heartbeat
data: {"timestamp": "2026-07-30T12:34:56Z"}

event: done
data: {
  "messageId": "msg-123",
  "inputTokens": 150,
  "outputTokens": 80,
  "model": "claude-opus",
  "provider": "anthropic",
  "completedAt": "2026-07-30T12:34:58Z"
}

event: error
data: {"code": "PROVIDER_ERROR", "message": "API request failed"}
```

Heartbeat: Every 30 seconds to maintain connection liveness

**POST /api/conversations/:conversationId/stream/:jobId/cancel**

Authorization:
- `requireAuth`: Validates JWT token
- `requireMembership`: Checks user is workspace member
- `requirePermission`: Checks 'message:manage' permission

Action:
1. Update StreamingJob status to CANCELLED
2. Publish cancel signal to Redis channel `job:{jobId}:control`
3. Return `{ success: true, jobId }`

### 6. Bull Queue Worker

**Job Shape**:
```typescript
interface GenerateResponseJob {
  jobId: string;
  conversationId: string;
  messageId: string;
  userId: string;
  provider: string;
  model: string;
}
```

**Processing Pipeline**:

1. **Fetch Context**
   - Load conversation (check exists)
   - Fetch message history (last 50 messages, exclude deleted)
   - Build chronological message array

2. **Create Job Infrastructure**
   - Instantiate StreamingAccumulator (for token buffering)
   - Instantiate TokenAccountant (for usage tracking)
   - Create AbortController (for cancellation)

3. **Setup Cancellation Listener**
   - Duplicate Redis connection
   - Subscribe to `job:{jobId}:control`
   - On 'cancel' message: call abortController.abort()

4. **Resolve Provider**
   - Call resolver.resolve(provider)
   - Throws ProviderNotFoundError if not found or not configured

5. **Call Provider**
   - Pass GenerateStreamInput with abortSignal
   - Iterate async generator

6. **Process Tokens**
   - Accumulate text chunks
   - Track input/output tokens
   - Publish to Redis `job:{jobId}:stream` for client consumption
   - Report progress to Bull job (every 50 tokens or 5s)

7. **Persist on Completion**
   - Save complete message (content, inputTokens, outputTokens, status=COMPLETE)
   - Update conversation (lastMessageAt)
   - Upsert ConversationUsage (aggregate tokens & cost)
   - Update StreamingJob (messageId, status=COMPLETED, completedAt)
   - Emit 'done' event to client with final accounting

8. **Error Handling**
   - Update message with error status & message
   - Update StreamingJob with error
   - Let RetryEngine handle retry logic

**Concurrency**: 5 workers per deployment (configurable)

---

## Error Scenarios & Recovery

### Provider Unavailable
- **Symptom**: `provider.isConfigured() === false`
- **Client**: Receives `error` event with code `PROVIDER_NOT_CONFIGURED`
- **Recovery**: User selects alternative provider, re-send message

### Rate Limit (429)
- **Symptom**: Provider returns 429 status
- **Classification**: Retryable (RateLimitError)
- **Action**: Retry with exponential backoff (500ms, 1500ms)
- **Terminal**: After 3 attempts, fail permanently

### Network Timeout
- **Symptom**: Connection reset or timeout during stream
- **Classification**: Retryable (TimeoutError)
- **Action**: Retry with backoff
- **Terminal**: After 3 attempts, fail permanently

### Invalid API Key
- **Symptom**: 401 or 403 response
- **Classification**: Non-retryable
- **Action**: Fail immediately (don't retry)
- **Client**: Receives `error` event, should check credentials

### Cancellation During Stream
- **Symptom**: Client POST to `/stream/:jobId/cancel`
- **Propagation**: abortController.abort() → generator breaks → cleanup
- **Persistence**: Message marked as incomplete, can be resumed

### Connection Drop (Client Disconnect)
- **Symptom**: Browser tab closed or network loss
- **Detection**: SSE connection drops, 'close' event fires
- **Action**: Redis unsubscribe, cleanup
- **Message**: Persists in database as COMPLETE (if finished) or PENDING (if interrupted)

---

## Observability

### Structured Logging

All critical points log with context:
```typescript
logger.info('[Worker] Processing job', { jobId, conversationId, messageId });
logger.debug('[Worker] First token received', { jobId, ttft: 150 });
logger.info('[Worker] Job completed', { jobId, tokens: outputTokens, costCents });
logger.error('[Worker] Generation failed', { jobId, attempt, error: err.message });
```

### Prometheus Metrics

```
synora_streaming_jobs_total{status="completed|failed|cancelled"}
synora_streaming_jobs_duration_ms{quantile="0.5|0.95|0.99"}
synora_streaming_tokens_total{direction="input|output", provider="anthropic|openai|..."}
synora_streaming_cost_cents_total{provider="anthropic|openai|..."}
synora_streaming_errors_total{error_type="timeout|rate_limit|provider_error"}
```

### OpenTelemetry Tracing

Distributed trace for each request:
```
GET /api/conversations/:id/stream
  └─ span: "subscribe_redis"
  └─ span: "fetch_job" (from worker)
     ├─ span: "fetch_conversation"
     ├─ span: "fetch_message_history"
     ├─ span: "resolve_provider"
     └─ span: "generate_stream"
        ├─ span: "provider_api_call" (Anthropic/OpenAI/etc.)
        └─ span: "persist_message"
```

---

## Performance Characteristics

### Throughput
- **Tokens/second**: 50–100 tokens/s per stream (provider-dependent)
- **Concurrent streams**: 100–1000 depending on worker concurrency and system resources
- **Message latency**: p50 < 50ms, p95 < 200ms (token emission)

### Memory Usage
- **Per stream**: ~1MB (token buffer + state)
- **Per worker**: ~200MB (context + provider SDK)
- **Redis Pub/Sub**: Negligible (one channel per job)

### Database Load
- **Reads**: 2–3 queries per job (fetch conversation, message history)
- **Writes**: 4–5 queries per job (message, usage, job status)
- **Query time**: < 100ms for typical conversation size

### Error Rates
- **Provider failures**: 0.1–1% (depends on provider reliability)
- **Retry success rate**: 70–80% (retryable errors)
- **End-to-end success rate**: 99%+ target

---

## Future Enhancements

1. **Streaming Resume**: Persist partial messages, allow client to resume from last token
2. **Adaptive Streaming**: Adjust token emission rate based on client bandwidth
3. **Provider Fallback**: Auto-failover to alternative provider on rate limit
4. **Cost Optimization**: Caching layer for repeated prompts
5. **Multi-Model Ensemble**: Route requests across providers for cost/quality trade-offs

---

## Testing

See `tests/ai/streaming/` and `tests/routes/streaming.integration.test.ts` for comprehensive test coverage:

- **Unit Tests**: Accumulator, TokenAccountant, StateMachine, RetryEngine, Provider Resolver
- **Integration Tests**: Full E2E streaming flow, cancellation, retry scenarios, error handling
- **Load Tests**: 100+ concurrent streams, measure latency & throughput

Run tests:
```bash
pnpm test ai/streaming
pnpm test streaming.integration
```

---

**Last Updated**: 2026-07-30
**Status**: Milestone 3 (AI Streaming Engine) — Implementation Complete
