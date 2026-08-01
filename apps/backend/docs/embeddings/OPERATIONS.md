# Embeddings — Operations Guide

Covers caching, rate limiting, retry, circuit breaking, cost/usage
accounting, and security for the embeddings subsystem. See `ARCHITECTURE.md`
for the call pipeline these all sit in, and `PROVIDERS.md` for per-provider
specifics.

## Caching

Embeddings are pure functions of `(provider, model, text)` — the same input
always produces the same vector — so caching by a hash of those three
fields, plus `workspaceId` for isolation, is always safe (`cache.ts`).

- **Key**: `` embed:{workspaceId}:{provider}:{model}:{sha256(text)} ``
- **Default backend**: `InMemoryEmbeddingCache` — a single process's `Map`
  with TTL expiration (default 24h — `EMBEDDING_CACHE_TTL_MS`) and
  insertion-order eviction once `EMBEDDING_CACHE_MAX_ENTRIES` (default
  10,000) is exceeded.
- **Multi-instance backend**: `RedisEmbeddingCache`
  (`EMBEDDING_CACHE_BACKEND=redis`, `EMBEDDING_CACHE_REDIS_URL`) — necessary
  once you run more than one backend instance, otherwise each instance has
  its own cold cache and its own independent spend on repeat embeddings.
  Uses its own dedicated `ioredis` connection, independent of
  `src/queue/redis.ts`'s connection — the embeddings and queue modules are
  independent siblings, and coupling one's Redis lifecycle to the other's
  would make either impossible to reconfigure independently.
- **`embedBatch()` is cache-aware per item**: it checks the cache for every
  text individually, and only sends the cache misses to the provider —
  requesting `['a', 'a', 'b']` calls the provider once (for the two distinct
  texts, or fewer if already cached), not three times.

## Rate Limiting

Keyed by `` `${providerId}:${workspaceId}` `` (`rateLimiter.ts`) — a noisy
workspace can never exhaust another workspace's quota against a shared
provider, and vice versa.

- **Default backend**: `InMemoryRateLimiter` — classic token bucket,
  `EMBEDDING_RATE_LIMIT_REQUESTS_PER_SECOND` (default 50) tokens refilling
  continuously, capacity equal to the same number.
- **Multi-instance backend**: `RedisRateLimiter`
  (`EMBEDDING_RATE_LIMIT_BACKEND=redis`, `EMBEDDING_RATE_LIMIT_REDIS_URL`) —
  a fixed-window counter (`INCR` + `PEXPIRE`). Necessary for the same reason
  as the Redis cache: N in-memory instances would jointly allow N× the
  intended rate.
- **Fails open on Redis errors**: if the Redis rate limiter can't reach
  Redis, it allows the call rather than blocking all embeddings — a Redis
  outage should degrade rate-limit precision, not take embeddings down
  entirely. The retry and circuit-breaker layers already protect a
  genuinely unhealthy provider from being hammered.
- Rate limiting is checked once per **provider call** (i.e. once per
  `embedBatch()` group), not once per text — a single call embedding 50
  texts in one batch consumes one unit of rate limit, not 50.

## Retry

Exponential (default) or fixed backoff, applied per provider call
(`retry.ts`):

- **Config**: `EMBEDDING_RETRY_ATTEMPTS` (default 3),
  `EMBEDDING_RETRY_BACKOFF_MS` (default 500),
  `EMBEDDING_RETRY_BACKOFF_STRATEGY` (`exponential` | `fixed`).
- **Retryable**: connection errors (`ECONNREFUSED`, `ETIMEDOUT`, ...),
  network/timeout/unavailable messages, and transient HTTP status codes
  (`429`, `500`, `502`, `503`, `504`).
- **Non-retryable**: everything else — an auth failure, a validation error,
  or an unsupported-provider error is rethrown on the first failure, since
  retrying it would only add latency without any chance of success.
- Retry sits *below* the circuit breaker in the call path: retry absorbs a
  transient blip within one `embed()`/`embedBatch()` call; the circuit
  breaker responds to a provider that's down for an extended period, where
  retrying every single call would just add load without a chance of
  success.

## Circuit Breaker

Per-provider closed → open → half-open state machine (`circuitBreaker.ts`):

- **Closed** (normal): failures accumulate; `EMBEDDING_CIRCUIT_BREAKER_FAILURE_THRESHOLD`
  (default 5) consecutive failures trips it open.
- **Open**: calls fail immediately with `EmbeddingCircuitOpenError`, without
  reaching the provider at all, for `EMBEDDING_CIRCUIT_BREAKER_COOLDOWN_MS`
  (default 30s).
- **Half-open**: after the cooldown, the next call(s) are allowed through as
  a trial. `EMBEDDING_CIRCUIT_BREAKER_HALF_OPEN_SUCCESS_THRESHOLD` (default
  2) consecutive successes closes the circuit again; a single half-open
  failure reopens it immediately.
- State transitions are logged (`[CircuitBreaker] State transition`) —
  monitor for repeated `closed -> open` transitions on a provider as a
  signal that provider is degraded, independent of any individual request's
  error.
- One breaker instance per provider id, created lazily — a provider that's
  never called never allocates state.

## Cost & Usage Accounting

- **Cost estimation** (`pricing.ts`): per-model USD-per-1K-tokens table.
  Display-only, mirroring `src/ai/pricing.ts`'s posture exactly — an
  unrecognized model returns `0` rather than throwing, since embedding a
  document must keep working even for a model this table doesn't yet know
  the price of. Never used for billing enforcement (Release 2's billing
  system prices by credits per capability-use, entirely separate).
- **Usage accounting** (`usage.ts`): `UsageAccountant` aggregates, per
  workspace: total calls, total tokens, total estimated cost, and the same
  three broken down per provider. In-memory today; the shape recorded after
  every successful call is exactly what a persistence layer would consume
  to write into a `ConversationUsage`-style table.
- Access via `getEmbeddingUsageAccountant().getWorkspaceUsage(workspaceId)`
  or `.getAllUsage()` for every workspace.

## Security

All enforced at the `EmbeddingService` boundary (`security.ts`) — a provider
never receives input this application hasn't already judged safe to send to
a third-party API:

- **`workspaceId` required and non-empty** on every request — the isolation
  boundary for cache, rate limits, and cost.
- **`maxInputChars`** (default 50,000, `EMBEDDING_SECURITY_MAX_INPUT_CHARS`)
  — rejects an oversized single text before it reaches a provider.
- **`maxBatchRequestSize`** (default 1,000,
  `EMBEDDING_SECURITY_MAX_BATCH_REQUEST_SIZE`) — caps how many texts a
  single `embedBatch()` call accepts, independent of any individual
  provider's own (smaller) per-call batch limit, which `EmbeddingService`
  handles by internally grouping into `provider.maxBatchSize`-sized chunks.
- **Never log raw embedding input.** `redactTextForLogging()` produces a
  length + short truncated prefix for logs/traces — never the full text.
  Embedding input frequently contains user documents or messages, unlike an
  API key (which `SecretsManager`'s audit log already handles by never
  logging values, only which key was read).
- **No new attack surface from HTTP-based providers** (Voyage, Cohere):
  `postJson()` (`shared.ts`) is a thin, fixed-shape wrapper — it does not
  accept caller-controlled URLs or headers beyond the provider's own fixed
  endpoint and Bearer token.

## Health & Metrics

- `getEmbeddingMetricsCollector().getMetrics(providerId)` — calls, errors,
  error rate, cache hits/misses, cache hit rate, total tokens, average
  latency, all per provider.
- `getEmbeddingCircuitBreakerRegistry().getAllStates()` — current circuit
  state (`closed` | `open` | `half-open`) per provider, for a health-check
  endpoint to surface.
- Structured tracing (`tracing.ts`): every `embed()`/`embedBatch()` call is
  wrapped in a span logged at `debug` level with a generated span id and
  duration — no external APM dependency; ship the resulting log lines to
  Jaeger/Honeycomb/Datadog if you want them correlated there, without any
  code change here.

## Troubleshooting

| Symptom | Likely cause | Where to look |
|---|---|---|
| `NoEmbeddingProviderConfiguredError` | No provider's secret/config is set | Set at least one of `OPENAI_API_KEY`, `VOYAGE_API_KEY`, `GOOGLE_AI_API_KEY`, `COHERE_API_KEY`, `EMBEDDING_OLLAMA_BASE_URL`, `EMBEDDING_SELF_HOSTED_BASE_URL` |
| `EmbeddingProviderUnsupportedError` | Explicit `EMBEDDING_PROVIDER=claude` | Use `voyage` or another configured provider — see `PROVIDERS.md` |
| `EmbeddingRateLimitExceededError` | Too many calls for one (provider, workspace) pair | Raise `EMBEDDING_RATE_LIMIT_REQUESTS_PER_SECOND`, or check for an unintended retry loop upstream |
| `EmbeddingCircuitOpenError` | Provider had 5 (default) consecutive failures | Check the provider's own status page; wait for the cooldown, or lower `EMBEDDING_CIRCUIT_BREAKER_FAILURE_THRESHOLD` temporarily to fail faster during an incident |
| High cost / low cache hit rate | Cache TTL too short, or highly varied input text | Check `getMetrics(providerId).cacheHitRate`; raise `EMBEDDING_CACHE_TTL_MS` if inputs are frequently re-embedded |
| Cache/rate-limit state resets on each deploy | Using the default in-memory backend across multiple instances | Switch to `EMBEDDING_CACHE_BACKEND=redis` / `EMBEDDING_RATE_LIMIT_BACKEND=redis` |
