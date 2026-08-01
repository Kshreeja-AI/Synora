# Provider Router Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Routes AI generation requests to providers (Anthropic, OpenAI, Gemini, etc.). Supports model selection, fallback, and cost tracking per provider. Exposes unified streaming interface.

---

## Service Layer

```typescript
class ProviderRouter {
  async generateStream(
    systemPrompt: string,
    messages: { role: string; content: string }[],
    options?: {
      providerId?: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<AsyncIterable<StreamEvent>>
}

interface StreamEvent {
  type: 'content_block_delta' | 'message_start' | 'message_delta';
  delta?: { text: string };
  message?: { usage: { input_tokens: number; output_tokens: number } };
  usage?: { output_tokens: number };
}
```

---

## Configuration

```typescript
interface ProviderConfig {
  id: string; // "anthropic", "openai", "gemini", etc.
  apiKey: string; // From environment
  baseUrl?: string; // Custom endpoint
  defaultModel: string; // "claude-opus", "gpt-4", etc.
  maxTokens?: number;
  timeout: number; // ms
}
```

---

## API

```
POST /api/workspaces/:workspaceId/generate
Authorization: Bearer <jwt>
Content-Type: application/json

Request:
{
  "systemPrompt": "You are a helpful assistant",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "providerId": "anthropic",
  "model": "claude-opus",
  "temperature": 0.7,
  "maxTokens": 1000
}

Response 200 (streaming):
(SSE stream via StreamingEngine)
```

---

## Implementation

**Provider Selection:**
1. If providerId specified, use that provider
2. If workspace has default, use that
3. Otherwise: first available provider in priority order
   - Anthropic (highest quality)
   - OpenAI
   - Google Gemini
   - Others

**Model Selection:** Use ModelSelector service

**Error Handling:**
- Provider unavailable → try fallback
- Rate limit → queue and retry
- Token limit → truncate context
- Timeout → return error after 60s

---

## Providers Supported

| Provider | Model | Max Tokens | Streaming | Cost/1K |
|----------|-------|-----------|-----------|---------|
| Anthropic | claude-opus | 200K | ✓ | $0.003 |
| Anthropic | claude-sonnet | 200K | ✓ | $0.0008 |
| OpenAI | gpt-4 | 128K | ✓ | $0.03 |
| OpenAI | gpt-4-turbo | 128K | ✓ | $0.01 |
| Google | gemini-pro | 32K | ✓ | $0.001 |
| Others | various | varies | varies | varies |

---

## Validation

- systemPrompt required, max 10K chars
- messages required, each < 50K chars
- providerId must exist
- model must be valid for provider
- temperature 0-2, default 0.7
- maxTokens 1-200K, default provider max

---

## Permissions

- Any workspace member can generate

---

## Logging

```json
{
  "action": "generation_started",
  "providerId": "anthropic",
  "model": "claude-opus",
  "conversationId": "conv_123",
  "messageId": "msg_002",
  "inputTokens": 150,
  "timestamp": "2026-07-28T12:00:00Z"
}
```

---

## Monitoring

**Metrics:**
- provider_requests_total{provider,model,status}
- provider_latency_ms{provider,model}
- provider_token_count{provider,model,role}
- provider_cost_cents{provider,model}
- provider_errors_total{provider,error_type}

**Alerts:**
- Provider error rate > 5%
- Latency > 30s

---

## Testing

- Generate with each provider
- Model fallback on error
- Token counting accuracy
- Cost calculation
- Timeout handling

---

## Performance

- Provider calls async (non-blocking)
- Streaming starts within 1s
- Timeout: 60s per generation

---

## Security

- API keys stored in env variables (never logged)
- User can't override provider (workspace default only)
- Rate limiting per provider

---

## Future Extensibility

- Custom provider endpoints
- Provider-specific parameters
- A/B testing between providers
- Cost optimization (cheap provider for simple queries)

---

**Status:** Complete, ready for implementation
