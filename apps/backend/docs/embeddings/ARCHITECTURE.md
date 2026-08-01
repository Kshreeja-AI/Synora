# Embedding Provider Layer — Architecture

## Overview

`apps/backend/src/embeddings/` is the provider-agnostic abstraction for turning
text into vector embeddings. It mirrors the design of `src/ai/` (text
generation) and `src/queue/` (background jobs): application code never talks
to an embedding vendor's SDK/API directly, never picks a provider by name in
business logic, and never re-implements caching, retry, or rate limiting per
call site.

```
apps/backend/src/embeddings/
├── types.ts               Core contracts: EmbeddingProvider, requests/results, errors
├── descriptor.ts           EmbeddingProviderDescriptor — what a provider publishes about itself
├── registry.ts              EMBEDDING_PROVIDER_REGISTRY — every known provider, in priority order
├── resolver.ts                resolveEmbeddingProvider() — selection logic (the only place it happens)
├── chunking.ts                 Document → TextChunk[] splitting (fixed/sentence/recursive)
├── cache.ts                     Content-addressed result cache (in-memory or Redis)
├── rateLimiter.ts                 Per-(provider, workspace) rate limiting (token bucket or Redis)
├── circuitBreaker.ts               Per-provider closed/open/half-open circuit breaker
├── retry.ts                         Exponential/fixed backoff retry wrapper
├── metrics.ts                        Per-provider call/latency/cache/error metrics
├── tracing.ts                         Structured span logging
├── pricing.ts                          Cost-per-token estimates, for display only
├── usage.ts                             Per-workspace usage/cost accounting
├── security.ts                           Input validation + log-safe redaction
├── service.ts                             EmbeddingService — the orchestrator every caller uses
├── factory.ts                              Composition root: config -> wired EmbeddingService
├── index.ts                                 Public API surface
├── providers/                                 One file per vendor
└── __tests__/                                  Unit tests for every module above
```

**Design principle**: every subsystem (cache, rate limiter, circuit breaker,
retry, metrics) is an interface with a concrete default implementation,
constructed by `factory.ts` from `getConfig().embeddings`, and injected into
`EmbeddingService`. Nothing in `service.ts` reads `getConfig()` or `process.env`
directly — that keeps the orchestration logic testable with fakes and keeps
"how it's configured" entirely separate from "what it does".

## Why embeddings is its own module, not part of `src/ai/`

`src/ai/types/descriptor.ts` reserves `embeddings` as a capability in
`AICapability` but explicitly notes that a future embeddings provider should
get "its own descriptor type... and its own registry... instead of contorting
an embedding provider into fake-implementing `generateText()`". An embedding
call takes text and returns a fixed-size vector — a completely different
request/response shape from text generation — and every production concern
here (content-addressed caching, batch-shaped rate limits, per-workspace cost
accounting) has no equivalent in `src/ai/`. So `src/embeddings/` is a sibling
module with its own `EmbeddingProviderDescriptor`, `EMBEDDING_PROVIDER_REGISTRY`,
and `resolveEmbeddingProvider()` — structurally identical in shape to `src/ai/`'s
equivalents, but independent.

## Initialization & call flow

```
getEmbeddingService()                    (factory.ts, lazy singleton)
  └─ createEmbeddingService()
       reads getConfig().embeddings
       ├─ initEmbeddingCache()           memory | redis
       ├─ initRateLimiter()              memory | redis
       ├─ initCircuitBreakerRegistry()
       ├─ initMetricsCollector()
       ├─ initUsageAccountant()
       └─ new EmbeddingService(...)      injected, not self-wired

embed(text, { workspaceId, model?, providerId? })
  1. validateWorkspaceId() / validateText()      (security.ts)
  2. resolveEmbeddingProvider()                  (resolver.ts — the only provider-selection point)
  3. cache.get(buildCacheKey(...))                → hit: record cache-hit metric, return
  4. circuitBreaker.canAttempt()                  → open: throw EmbeddingCircuitOpenError
  5. rateLimiter.tryAcquire(`${provider}:${ws}`)   → denied: throw EmbeddingRateLimitExceededError
  6. withRetry(() => provider.embed(...))          → exhausted retries: throw EmbeddingProviderError
  7. circuitBreaker.recordSuccess() / recordFailure()
  8. metrics.recordCall(...)
  9. usage.recordUsage(workspaceId, provider, tokens, estimateEmbeddingCost(...))
  10. cache.set(...)
  11. return EmbeddingResult
```

`embedBatch()` follows the same flow but resolves cache hits/misses per text
first, only sends the misses to the provider (grouped into
`provider.maxBatchSize`-sized chunks), and merges results back in original
order. `embedStream()` chunks a document (`chunking.ts`), groups chunks into
provider-sized batches, and yields each chunk's result as its containing
batch completes — see "Streaming" below for why this, not token-level
streaming, is the correct shape for an embeddings API.

## Providers

See `PROVIDERS.md` for the full per-provider reference (batch limits, model
defaults, activation env vars). Summary:

| Provider | Real embeddings API? | Batch limit | Notes |
|---|---|---|---|
| `openai` | Yes | 2048 | Default auto-detection choice |
| `voyage` | Yes | 128 | Anthropic's recommended embedding partner |
| `gemini` | Yes | 100 | Token usage estimated (API doesn't report it) |
| `cohere` | Yes | 96 | Requires `input_type: search_document` |
| `claude` | **No** | — | Structurally unsupported — see below |
| `ollama` | Yes (self-hosted) | 64 (configurable) | OpenAI-compatible `/v1/embeddings` |
| `self-hosted` | Yes (self-hosted) | 64 (configurable) | Any OpenAI-compatible embeddings server |

### Why `claude` has no working embeddings provider

Anthropic does not expose a text-embedding endpoint — their own
documentation directs customers to Voyage AI instead. `claude.provider.ts`'s
descriptor sets `unsupportedReason` rather than omitting the provider
entirely: `EMBEDDING_PROVIDER_REGISTRY` includes every provider named in the
product requirement, auto-detection silently skips `claude` (same as if it
were unconfigured), and an explicit `EMBEDDING_PROVIDER=claude` throws
`EmbeddingProviderUnsupportedError` with a precise, actionable message rather
than a generic "not configured" error or a silent fallback.

## Provider selection (`resolver.ts`)

Identical selection rule to `src/ai/resolver.ts`:

1. `options.explicitProviderId`, if passed, wins outright — this is how a
   caller with its own per-call provider choice overrides the process-wide
   default without affecting anything else.
2. Otherwise `EMBEDDING_PROVIDER`, if set, wins. It must be a known provider,
   not structurally unsupported, and configured — otherwise this throws a
   specific error rather than silently falling back.
3. If neither is set, the first configured provider in
   `EMBEDDING_PROVIDER_REGISTRY`'s order is used (OpenAI first).
4. If nothing is configured, throws `NoEmbeddingProviderConfiguredError`
   listing every provider checked.

## Streaming

Embedding APIs return one complete vector per call — there is no
token-by-token output to stream the way text generation has. "Streaming" for
embeddings, as implemented by `EmbeddingService.embedStream()`, means:
chunk a large document (`chunking.ts`), embed chunks in provider-sized
batches, and yield each chunk's `EmbeddingStreamChunk` as its batch
completes — so a caller indexing a long document sees progressive results
rather than waiting for the entire document to finish.

## Chunking

Three strategies (`ChunkingStrategyName`), dispatched by `chunkText()`:

- **`fixed`** — fixed-size character windows with configurable overlap.
- **`sentence`** — packs whole sentences up to `chunkSize`, so a chunk
  boundary never lands mid-sentence.
- **`recursive`** (default) — paragraph breaks first, falling back to
  sentence packing for any paragraph that alone exceeds `chunkSize`; the
  same coarse-to-fine approach popularized by LangChain's
  `RecursiveCharacterTextSplitter`.

The default overlap scales with `chunkSize` (`min(100, chunkSize / 10)`)
rather than being a fixed 100 characters, so a caller who only overrides
`chunkSize` to something small never hits the `overlap >= chunkSize`
validation error for a value they never specified.

## Workspace isolation

Every `EmbedOptions`/`EmbeddingRequest` requires `workspaceId` — it is not an
optional field threaded through as an afterthought. It is folded into:

- **Cache keys** (`buildCacheKey`) — one workspace's cached vector can never
  satisfy another workspace's lookup, even for identical text.
- **Rate-limit buckets** (`` `${providerId}:${workspaceId}` ``) — a noisy
  workspace can never exhaust another workspace's quota against a shared
  provider.
- **Usage/cost accounting** (`UsageAccountant`) — spend is always
  attributable to the workspace that incurred it.

## Configuration

Non-secret settings live in `getConfig().embeddings` (see
`src/config/schema.ts`), following the same stage-defaults + environment
override pattern as every other subsystem. API keys live in
`SecretsManager`, read directly by each provider's descriptor — never in
`getConfig()`. Every environment variable is documented in
`apps/backend/.env.example`.

## Health & observability

- `getMetricsCollector()` — per-provider call counts, error rate, cache hit
  rate, average latency (see `metrics.ts`).
- `getCircuitBreakerRegistry().getAllStates()` — current circuit state per
  provider.
- `getUsageAccountant().getWorkspaceUsage(workspaceId)` — token/cost totals
  per workspace, broken down by provider.

None of these are wired to an HTTP endpoint by this phase — that is left to
whichever route/dashboard consumes them, the same boundary `src/queue/`
draws around its own metrics/health modules.

## Best practices

1. **Always pass a real `workspaceId`.** It is the isolation boundary for
   cache, rate limits, and cost — never share one across tenants.
2. **Prefer `embedBatch()` over looping `embed()`** when embedding more than
   a handful of texts — it batches provider calls and only sends cache
   misses.
3. **Use `embedStream()` for documents**, not `embed()` on the whole text —
   most providers have per-text length limits, and chunking preserves
   context better than truncation.
4. **Don't log raw embedding input.** Use `redactTextForLogging()` if you
   need to log anything about an embedding request — embedding input is
   frequently sensitive user content.
5. **Treat `EmbeddingProviderUnsupportedError` as a configuration decision,
   not a bug** — it means the requested provider structurally cannot serve
   embeddings (currently only `claude`), not that something is broken.
