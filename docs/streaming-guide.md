# Streaming Implementation Guide — Milestone 3

This guide provides instructions for developers to understand, test, and extend the Synora streaming engine.

---

## Quick Start

### Running Locally

1. **Start PostgreSQL + Redis**:
```bash
docker-compose -f docker-compose.dev.yml up -d postgres redis
```

2. **Run migrations**:
```bash
pnpm run db:migrate
```

3. **Start backend in dev mode**:
```bash
cd apps/backend
pnpm dev
```

4. **Verify streaming works** (manual test):
```bash
curl -i -N \
  -H "Authorization: Bearer <your_jwt_token>" \
  'http://localhost:3001/api/conversations/conv-123/stream?messageId=msg-456&workspaceId=ws-789'
```

---

## Architecture Overview

### File Structure

```
apps/backend/src/ai/streaming/
├─ types.ts                    # Core type definitions & interfaces
├─ accumulator.ts              # Chunk buffering & token accounting
├─ statemachine.ts             # Job state machine & retry engine
├─ resolver.ts                 # Provider registry & resolution
└─ providers/
   ├─ anthropic.ts             # Anthropic native SDK
   ├─ openai.ts                # OpenAI SDK (+ compatible APIs)
   ├─ gemini.ts                # Google Gemini SDK
   ├─ openrouter.ts            # OpenRouter (OpenAI-compatible)
   ├─ groq.ts                  # Groq (OpenAI-compatible)
   ├─ deepseek.ts              # DeepSeek (OpenAI-compatible)
   └─ mock.ts                  # Mock provider (testing)

apps/backend/src/routes/
└─ streaming.ts                # SSE endpoint & cancellation route

apps/backend/src/workers/
└─ generateResponse.worker.ts  # Bull queue worker

packages/database/prisma/
└─ schema.prisma               # StreamingJob model
```

### Component Interactions

```
Client
  ↓
GET /api/conversations/:id/stream (routes/streaming.ts)
  ├─ Auth & authorization check
  ├─ Setup SSE headers
  ├─ Find StreamingJob
  ├─ Subscribe to Redis channel job:{jobId}:stream
  ├─ Forward events to client via SSE
  └─ Cleanup on disconnect
  
Bull Queue (generateResponse)
  ├─ Fetch conversation & message history
  ├─ Resolve provider (via StreamingProviderResolver)
  ├─ Call provider.generateStream()
  ├─ Accumulate tokens (StreamingAccumulator)
  ├─ Track usage (TokenAccountant)
  ├─ Broadcast events to Redis
  ├─ Persist message & usage
  └─ Update job status

Provider (Anthropic, OpenAI, etc.)
  ├─ Validate API key (isConfigured())
  ├─ Build request
  ├─ Call provider API with AbortController
  ├─ Yield StreamChunk events
  └─ Handle errors & cleanup
```

---

## Adding a New Provider

### Step 1: Create Provider Class

Create `apps/backend/src/ai/streaming/providers/{provider}.ts`:

```typescript
import { TextGenerationStreamProvider, StreamChunk, GenerateStreamInput } from '../types';
import { logger } from '../../utils/logger';

export class YourProviderStreamProvider implements TextGenerationStreamProvider {
  async *generateStream(input: GenerateStreamInput): AsyncIterable<StreamChunk> {
    // 1. Validate configuration
    if (!process.env.YOUR_API_KEY) {
      throw new Error('YOUR_API_KEY not configured');
    }

    try {
      // 2. Build request
      const model = input.model; // e.g., "your-model-123"
      const messages = input.messages;
      const systemPrompt = input.systemPrompt;
      const maxTokens = input.maxTokens;
      const temperature = input.temperature ?? 1;

      // 3. Call provider API
      const client = new YourProviderClient({ apiKey: process.env.YOUR_API_KEY });
      const response = await client.generateStream({
        model,
        messages,
        system: systemPrompt,
        max_tokens: maxTokens,
        temperature,
        signal: input.abortSignal // For cancellation
      });

      let inputTokens = 0;
      let outputTokens = 0;

      // 4. Iterate stream & yield chunks
      for await (const chunk of response) {
        // Check if aborted
        if (input.abortSignal?.aborted) {
          logger.info('[YourProvider] Generation aborted');
          break;
        }

        // Parse provider-specific chunk format
        if (chunk.type === 'content_block_delta') {
          const token = chunk.delta.text;
          yield { type: 'token', token };
          outputTokens++;
        }

        if (chunk.type === 'message_start') {
          inputTokens = chunk.message.usage?.input_tokens ?? 0;
        }

        if (chunk.type === 'message_delta') {
          outputTokens = chunk.delta.usage?.output_tokens ?? 0;
        }
      }

      // 5. Emit final usage
      yield {
        type: 'usage',
        inputTokens,
        outputTokens
      };
    } catch (error: any) {
      // 6. Error handling
      if (error.status === 429) {
        throw new RateLimitError('Rate limit exceeded');
      }
      if (error.status === 401) {
        throw new Error('INVALID_API_KEY');
      }
      throw error;
    }
  }

  getName(): string {
    return 'yourprovider';
  }

  isConfigured(): boolean {
    return !!process.env.YOUR_API_KEY;
  }
}
```

### Step 2: Register Provider

Update `apps/backend/src/ai/streaming/resolver.ts`:

```typescript
import { YourProviderStreamProvider } from './providers/yourprovider';

private registerDefaultProviders() {
  // ... existing providers ...
  
  const yourprovider = new YourProviderStreamProvider();
  this.register('yourprovider', yourprovider);
}
```

### Step 3: Add Environment Variable

Update `.env.example`:
```bash
YOUR_PROVIDER_API_KEY=your_key_here
```

### Step 4: Test

```bash
# Unit test
pnpm test providers/yourprovider.test.ts

# Manual test (verify tokens stream)
# Set up conversation & message, then call endpoint
curl 'http://localhost:3001/api/conversations/.../stream?...'
```

### Step 5: Document

Update `docs/streaming-architecture.md` to add your provider to the provider table.

---

## Testing

### Unit Tests

Test individual components:

```bash
# Accumulator & TokenAccountant
pnpm test ai/streaming/accumulator.test.ts

# State machine & retry engine
pnpm test ai/streaming/statemachine.test.ts

# Provider resolver
pnpm test ai/streaming/resolver.test.ts

# All streaming tests
pnpm test ai/streaming
```

### Integration Tests

Test full E2E flows:

```bash
# Streaming endpoint & worker integration
pnpm test routes/streaming.integration.test.ts

# All integration tests
pnpm test routes/streaming
```

### Manual Testing

**Scenario 1: Happy path (token streaming)**

1. Create conversation + user message
2. Call `GET /api/conversations/:id/stream?messageId=:id&workspaceId=:id`
3. Verify tokens arrive as SSE events
4. Verify completion event with usage data

**Scenario 2: Cancellation**

1. Start message generation (long-running model)
2. Call `POST /api/conversations/:id/stream/:jobId/cancel`
3. Verify cancellation succeeds
4. Verify tokens stop being emitted
5. Verify job status is CANCELLED in database

**Scenario 3: Retry on timeout**

1. Monkey-patch provider to timeout on first attempt
2. Generate message
3. Verify worker retries (logs show "Attempt 2/3")
4. Verify generation succeeds on 2nd attempt

**Scenario 4: Non-retryable error (invalid API key)**

1. Set invalid provider API key
2. Generate message
3. Verify worker fails immediately (no retries)
4. Verify error event sent to client

**Scenario 5: Concurrent streams**

1. Start 10+ concurrent message generations
2. Verify all receive tokens without interference
3. Verify usage tracking accurate for each

### Load Testing

Use k6 or Apache JMeter:

```bash
# Example k6 script (streaming-load.js)
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 }, // Ramp up to 100 VUs
    { duration: '5m', target: 100 }, // Maintain
    { duration: '2m', target: 0 },   // Ramp down
  ],
};

export default function () {
  const conversationId = 'conv-123';
  const messageId = 'msg-456';
  const workspaceId = 'ws-789';
  const token = 'eyJhbG...'; // Valid JWT

  const url = `http://localhost:3001/api/conversations/${conversationId}/stream`;
  const params = {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'text/event-stream',
    },
  };

  const res = http.get(`${url}?messageId=${messageId}&workspaceId=${workspaceId}`, params);
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'content-type is sse': (r) => r.headers['Content-Type'] === 'text/event-stream',
  });

  sleep(1);
}
```

Run with:
```bash
k6 run streaming-load.js
```

---

## Debugging

### Logs

All streaming operations log with context:

```bash
# View streaming logs
tail -f logs/backend.log | grep -i streaming

# Filter by job ID
tail -f logs/backend.log | grep 'job-123'

# View retries
tail -f logs/backend.log | grep '\[Retry\]'
```

### Database Inspection

```bash
# Check job status
SELECT id, status, attempt, lastError, createdAt, startedAt, completedAt 
FROM "StreamingJob" 
WHERE id = 'job-123';

# Check message state
SELECT id, status, content, inputTokens, outputTokens, errorMessage, completedAt 
FROM "Message" 
WHERE id = 'msg-456';

# Check usage tracking
SELECT * FROM "ConversationUsage" WHERE conversationId = 'conv-123';
```

### Redis Inspection

```bash
# Monitor Redis Pub/Sub events
redis-cli PSUBSCRIBE 'job:*:stream'

# Check active subscriptions
redis-cli PUBSUB CHANNELS

# Inspect queue jobs
redis-cli LRANGE 'bull:generate_response:' 0 -1
```

### Common Issues

**Issue**: Tokens not appearing in client

**Debug**:
1. Check Redis Pub/Sub: `PSUBSCRIBE 'job:*:stream'`
2. Check worker logs: `grep 'Publishing' logs/backend.log`
3. Verify SSE connection: `curl -N http://...`
4. Check database: Verify StreamingJob.status is RUNNING

**Issue**: Job stuck in RUNNING state

**Debug**:
1. Check worker process: `ps aux | grep node`
2. Check Redis queue: `redis-cli LLEN bull:generate_response:`
3. Check database: Is timestamp old? (likely worker crashed)
4. Solution: Manually transition job to FAILED (or restart worker)

**Issue**: Retries not happening

**Debug**:
1. Check error classification: `grep 'isRetryable' logs/backend.log`
2. Verify error matches criteria in `statemachine.ts:isRetryable()`
3. Check backoff timing: `grep 'Backoff' logs/backend.log`

---

## Configuration

### Environment Variables

```bash
# AI Providers (required for each provider you use)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
OPENROUTER_API_KEY=...
GROQ_API_KEY=...
DEEPSEEK_API_KEY=...

# Redis (for queue & Pub/Sub)
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379

# Database (for message & job persistence)
DATABASE_URL=postgresql://user:pass@localhost:5432/synora

# Streaming configuration (optional, use defaults if omitted)
STREAMING_HEARTBEAT_INTERVAL_MS=30000
STREAMING_PROMPT_HISTORY_WINDOW=50
STREAMING_DEFAULT_MAX_TOKENS=2048
STREAMING_DEFAULT_TEMPERATURE=1
```

### Tuning

**Adjust token emission rate**:
```typescript
// In generateResponse.worker.ts:
const shouldReport = accumulator.shouldReportProgress(
  50,    // Emit progress every 50 tokens (increase for less overhead)
  5000   // OR every 5 seconds
);
```

**Adjust retry behavior**:
```typescript
// In statemachine.ts:
private readonly MAX_ATTEMPTS = 3;           // Increase for aggressive retry
private readonly RETRY_BACKOFF_MS = [500, 1500]; // Adjust wait times
```

**Adjust message history window**:
```typescript
// In generateResponse.worker.ts:
const PROMPT_HISTORY_WINDOW = 50; // Increase for longer context (uses more tokens)
```

---

## Performance Tuning

### Optimize Database Queries

```typescript
// ✓ Good: Select only needed fields
const conversation = await prisma.conversation.findUnique({
  where: { id: conversationId },
  select: { id: true, systemPrompt: true, workspaceId: true }
});

// ✗ Bad: Fetch entire conversation + related data
const conversation = await prisma.conversation.findUnique({
  where: { id: conversationId },
  include: { workspace: true, project: true, folder: true }
});
```

### Optimize Token Accounting

```typescript
// ✓ Good: Update usage in batch after stream completes
const accounting = accountant.getSummary();
await prisma.conversationUsage.upsert({
  where: { conversationId },
  create: { conversationId, ...accounting },
  update: { ...accounting }
});

// ✗ Bad: Update after each token
for (const token of tokens) {
  accountant.incrementOutputTokens();
  await db.conversationUsage.update(...); // Expensive!
}
```

### Optimize Redis Pub/Sub

```typescript
// ✓ Good: Batch publish
const events = [];
for (const chunk of stream) {
  events.push(chunk);
  if (events.length === 10) {
    await redis.publish(channel, JSON.stringify(events));
    events = [];
  }
}

// ✗ Bad: Publish every chunk
await redis.publish(channel, JSON.stringify(chunk)); // 1KB+ network per token
```

---

## Monitoring & Alerts

### Prometheus Metrics to Track

```
# Streaming jobs
synora_streaming_jobs_total{status="completed|failed|cancelled"}
synora_streaming_jobs_duration_ms{quantile="0.5|0.95|0.99"}

# Tokens processed
synora_streaming_tokens_total{direction="input|output"}
synora_streaming_tokens_per_second

# Errors
synora_streaming_errors_total{error_type="timeout|rate_limit|..."}
synora_streaming_retries_total

# Provider metrics
synora_provider_calls_total{provider="anthropic|openai|..."}
synora_provider_latency_ms{provider="...", quantile="0.5|0.95"}
```

### Alert Conditions

```
# Alert if error rate > 5%
rate(synora_streaming_errors_total[5m]) / rate(synora_streaming_jobs_total[5m]) > 0.05

# Alert if p99 latency > 5s
synora_streaming_jobs_duration_ms{quantile="0.99"} > 5000

# Alert if retry rate > 30%
rate(synora_streaming_retries_total[5m]) / rate(synora_streaming_jobs_total[5m]) > 0.30

# Alert if queue backlog > 1000
synora_bull_queue_length{name="generate_response"} > 1000
```

---

## Troubleshooting Guide

| Symptom | Root Cause | Solution |
|---------|-----------|----------|
| Tokens not streaming | Connection dropped | Client reconnect, check network |
| Slow tokens | Provider overloaded | Wait, try different provider, enable caching |
| "Provider not configured" | Missing API key | Set env var, restart worker |
| "Rate limit exceeded" | Provider limit hit | Wait, reduce concurrency, upgrade plan |
| Job stuck in RUNNING | Worker crashed | Restart worker, manually transition job |
| Partial message in DB | Cancelled during generation | Expected; message can be resumed |
| High latency p99 | Database slow | Optimize queries, add indices, scale DB |

---

## Related Documentation

- [Streaming Architecture](./streaming-architecture.md) — System design & protocols
- [API Reference](./api/streaming.md) — Endpoint documentation
- [RELEASE_1_FINAL.md](../RELEASE_1_FINAL.md) — Previous release context
- [M3_IMPLEMENTATION_PLAN.md](../M3_IMPLEMENTATION_PLAN.md) — Design document

---

**Last Updated**: 2026-07-30
**Status**: Milestone 3 (AI Streaming Engine) — Developer Guide Complete
