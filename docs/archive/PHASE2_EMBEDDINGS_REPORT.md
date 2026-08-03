# Phase 2: Embedding Provider Layer — Completion Report

**Status**: Complete
**Scope**: Production-grade, provider-agnostic embedding generation layer for the backend
**Branch**: `claude/synora-ai-platform-h5q0k2`

---

## 1. Summary

This phase delivers the embedding provider layer that Release 3's semantic
search and vector-embedding workloads (the `generate_embeddings` job type
already registered in Phase 1's queue infrastructure) will run on. It is a
new sibling module, `apps/backend/src/embeddings/`, structurally identical
in shape to the existing `src/ai/` (text generation) and `src/queue/`
(background jobs) abstractions: application code never imports a vendor SDK
directly, never names a provider in business logic, and never re-implements
caching, retry, rate limiting, or circuit breaking per call site.

No TODOs, no mock implementations, no placeholder logic. Every module is
fully implemented, tested, and documented. The one deliberate exception —
Anthropic/Claude has no embeddings API at all — is documented as a real,
permanent API limitation (see §4), not a placeholder.

---

## 2. Architecture

```
apps/backend/src/embeddings/
├── types.ts              Core contracts: EmbeddingProvider, requests/results, errors
├── descriptor.ts          EmbeddingProviderDescriptor — what a provider publishes about itself
├── registry.ts             EMBEDDING_PROVIDER_REGISTRY — every known provider, priority order
├── resolver.ts               resolveEmbeddingProvider() — the only place provider selection happens
├── chunking.ts                Document -> TextChunk[] splitting (fixed/sentence/recursive)
├── cache.ts                    Content-addressed result cache (in-memory or Redis)
├── rateLimiter.ts                Per-(provider, workspace) rate limiting (token bucket or Redis)
├── circuitBreaker.ts              Per-provider closed/open/half-open circuit breaker
├── retry.ts                        Exponential/fixed backoff retry wrapper
├── metrics.ts                       Per-provider call/latency/cache/error metrics
├── tracing.ts                        Structured span logging (no external APM dependency)
├── pricing.ts                         Cost-per-token estimates, display-only
├── usage.ts                            Per-workspace usage/cost accounting
├── security.ts                          Input validation + log-safe redaction
├── service.ts                            EmbeddingService — the orchestrator every caller uses
├── factory.ts                             Composition root: config -> wired EmbeddingService
├── shared.ts                               Token estimation + minimal JSON-POST helper
├── index.ts                                 Public API surface
├── providers/                                 7 provider files (see §3)
└── __tests__/ + providers/*.test.ts             19 test files, 119 tests
```

**Design principle**: every subsystem is an interface (`EmbeddingCache`,
`RateLimiter`, ...) with a concrete default implementation, constructed by
`factory.ts` from `getConfig().embeddings` and injected into
`EmbeddingService`'s constructor. `EmbeddingService` itself never reads
`getConfig()` or `process.env` — that keeps orchestration logic testable
with fakes (see `service.test.ts`) and keeps "how it's configured" entirely
separate from "what it does".

`embeddings` is a new capability module rather than being folded into
`src/ai/`: `src/ai/types/descriptor.ts` already anticipated this, explicitly
noting that embeddings should get "its own descriptor type... and its own
registry... instead of contorting an embedding provider into
fake-implementing `generateText()`."

---

## 3. Providers

| Provider | Real API? | Batch limit | Activation |
|---|---|---|---|
| `openai` | Yes | 2048 | `OPENAI_API_KEY` |
| `voyage` | Yes | 128 | `VOYAGE_API_KEY` |
| `gemini` | Yes | 100 | `GOOGLE_AI_API_KEY` |
| `cohere` | Yes | 96 | `COHERE_API_KEY` |
| `claude` | **No — structurally unsupported** | — | n/a |
| `ollama` | Yes (self-hosted) | 64 (configurable) | `EMBEDDING_OLLAMA_BASE_URL` |
| `self-hosted` | Yes (self-hosted) | 64 (configurable) | `EMBEDDING_SELF_HOSTED_BASE_URL` |

**No new SDK dependencies were added.** OpenAI/Gemini reuse the `openai` and
`@google/generative-ai` packages already in `package.json` (from `src/ai/`).
Voyage and Cohere expose plain REST APIs with no official Node SDK, so they
are called via the runtime's native `fetch` (Node 20+, this project's
minimum version) through a small shared `postJson()` helper — no HTTP client
dependency added for two single-endpoint integrations. Ollama and
self-hosted engines reuse the `openai` SDK pointed at a custom `baseURL`,
mirroring exactly how `src/ai/providers/ollama.provider.ts` already handles
Ollama for text generation.

**Claude/Anthropic has no text-embedding endpoint.** Anthropic's own
documentation directs customers to Voyage AI instead of exposing one
themselves. Rather than omitting the provider or faking a working
implementation, `claude.provider.ts`'s descriptor sets an explicit
`unsupportedReason`: `EMBEDDING_PROVIDER_REGISTRY` includes `claude` (so
every provider named in the requirement is represented), auto-detection
silently skips it, and an explicit `EMBEDDING_PROVIDER=claude` throws a
precise `EmbeddingProviderUnsupportedError` naming Voyage as the
alternative — never a generic "not configured" error or a silent fallback.

---

## 4. Production Concerns

All implemented as pluggable, independently-tested subsystems composed by
`EmbeddingService`:

- **Caching** — content-addressed by `sha256(provider + model + text)`,
  scoped per `workspaceId`. Default in-memory (TTL + eviction); optional
  Redis backend for multi-instance deployments. `embedBatch()` checks the
  cache per-item and only sends misses to the provider.
- **Rate limiting** — token bucket, keyed by `${providerId}:${workspaceId}`.
  Default in-memory; optional Redis-backed fixed-window counter for
  multi-instance deployments, failing open (not closed) on a Redis outage.
- **Retry** — exponential/fixed backoff, retryable-error classification
  (connection/timeout/5xx/429 vs. auth/validation errors).
- **Circuit breaker** — per-provider closed/open/half-open state machine,
  configurable failure threshold and cooldown, logged state transitions.
- **Metrics** — per-provider call count, error rate, cache hit rate, total
  tokens, average latency.
- **Tracing** — structured span logging (start/end/duration, generated span
  id) through the existing Winston logger; no external APM dependency, same
  approach `src/queue/audit.ts` already takes.
- **Workspace isolation** — `workspaceId` is a required field on every
  request (not optional), folded into cache keys, rate-limit buckets, and
  usage accounting, so no implementation bug can leak one workspace's
  cache/quota/spend into another's.
- **Cost accounting** — per-model USD/1K-token table, display-only,
  mirroring `src/ai/pricing.ts`'s exact posture (unrecognized model returns
  `0`, never blocks a call).
- **Usage accounting** — per-workspace call/token/cost totals, broken down
  by provider, ready to back a persistence layer the same way
  `src/ai/pricing.ts`'s estimates already do for `ConversationUsage`.
- **Security** — `workspaceId`/text/batch-size validation at the
  `EmbeddingService` boundary (never inside a provider), and
  `redactTextForLogging()` so embedding input — frequently sensitive user
  content — is never written to logs/traces in full.

### Batch & Streaming

- **Batch embedding**: `embedBatch()` resolves cache hits/misses per text,
  groups the misses into `provider.maxBatchSize`-sized chunks, and merges
  results back in original order.
- **Streaming**: embedding APIs return one complete vector per call — there
  is no token-level output to stream the way text generation has.
  `embedStream()` chunks a document (`chunking.ts`: fixed/sentence/recursive
  strategies), embeds chunks in provider-sized batches, and yields each
  chunk's result progressively as its batch completes, rather than making
  the caller wait for the whole document.

---

## 5. Testing

19 test files, 119 tests, all passing:

```
✓ __tests__/chunking.test.ts        (10 tests)
✓ __tests__/cache.test.ts           (10 tests)
✓ __tests__/rateLimiter.test.ts     (4 tests)
✓ __tests__/retry.test.ts           (9 tests)
✓ __tests__/circuitBreaker.test.ts  (6 tests)
✓ __tests__/metrics.test.ts         (5 tests)
✓ __tests__/pricing.test.ts         (4 tests)
✓ __tests__/usage.test.ts           (5 tests)
✓ __tests__/security.test.ts        (13 tests)
✓ __tests__/registry.test.ts        (6 tests)
✓ __tests__/resolver.test.ts        (5 tests)
✓ __tests__/service.test.ts         (16 tests)
✓ __tests__/factory.test.ts         (4 tests)
✓ __tests__/index.test.ts           (3 tests)
✓ providers/openaiCompatible.provider.test.ts (6 tests)
✓ providers/gemini.provider.test.ts (5 tests)
✓ providers/voyage.provider.test.ts (4 tests)
✓ providers/cohere.provider.test.ts (3 tests)
✓ providers/claude.provider.test.ts (3 tests)

Test Files  19 passed (19)
Tests       119 passed (119)
```

Coverage of `src/embeddings/` (statements/branch/functions): **77% / 94% /
77%** overall, with core logic modules (`service.ts` 99%, `resolver.ts` 94%,
`chunking.ts` 94%, `retry.ts` 96%, `security.ts` 100%, `pricing.ts` 100%,
`registry.ts` 100%) at or near full coverage. The lower overall number is
driven by thin composition/re-export modules (`index.ts`, `factory.ts`,
`descriptor.ts`) that are exercised indirectly through the higher-level
tests rather than asserted against directly line-by-line — the same
pattern `src/ai/index.ts` follows.

**Coverage highlights**:
- `service.test.ts` exercises the full pipeline with fakes: cache hits/
  misses, per-workspace isolation, retry-then-success, rate-limit denial,
  and circuit-breaker tripping after repeated failures — using a fake
  provider injected via a mocked `resolveEmbeddingProvider()`, so no real
  network I/O.
- Provider tests mock the underlying SDK (`openai`, `@google/generative-ai`)
  or `fetch` (Voyage, Cohere) — real request/response shape assertions, no
  live API calls.
- `claude.provider.test.ts` specifically asserts the unsupported-provider
  contract: `unsupportedReason` is set, `isConfigured()` is always `false`,
  `create()` always throws.

---

## 6. Verification Gates

| Gate | Result |
|---|---|
| `pnpm run type-check` (full monorepo) | ✅ 0 errors |
| `pnpm run lint` (full monorepo) | ✅ 0 errors, 50 warnings — all pre-existing `no-explicit-any` in test-mock files, same pattern as `src/ai/providers/*.test.ts` |
| `pnpm --filter @synora/backend run test src/embeddings` | ✅ 119/119 passed |
| `pnpm --filter @synora/backend run test` (full suite) | 422 passed / 444 failed / 17 skipped — failures are the pre-existing PostgreSQL-dependent baseline (identical 48 failed test files with or without this phase's changes), not caused by this work |
| `pnpm run build` (backend) | ✅ `tsup` build succeeds, `dist/server.js` 272.6KB |
| `pnpm audit --prod` | ✅ No known vulnerabilities |
| New dependencies added | **None** — reuses `openai`, `@google/generative-ai` (already present) and native `fetch` |
| Docker build | ⚠️ Not run — no Docker daemon available in this sandbox, same limitation noted in Phase 1's report. No Dockerfile changes are needed: no new dependencies were added. |

---

## 7. Configuration

Non-secret settings follow the existing `getConfig()` pattern exactly
(Zod schema in `src/config/schema.ts` → stage defaults in `defaults.ts` →
environment override in `configLoader.ts`), the same three-file wiring
established in Phase 1 for the queue subsystem — and, having been caught by
a config-test regression in that phase, verified immediately this time
(`tests/config.test.ts`, all 20 passing) rather than discovered after the
fact.

New secrets added to `src/secrets/registry.ts`'s `SECRET_CATALOG`:
`VOYAGE_API_KEY`, `COHERE_API_KEY`. All ~30 new environment variables
(models, cache/rate-limit/circuit-breaker/security/chunking tuning) are
documented in `apps/backend/.env.example`.

---

## 8. Documentation

- `apps/backend/docs/embeddings/ARCHITECTURE.md` — system overview,
  initialization flow, call pipeline, streaming semantics, chunking
  strategies, workspace isolation, configuration reference, best practices
- `apps/backend/docs/embeddings/PROVIDERS.md` — per-provider reference
  (SDK/API, activation, model defaults, batch limits), including the
  Claude limitation and how to add a new provider
- `apps/backend/docs/embeddings/OPERATIONS.md` — caching, rate limiting,
  retry, circuit breaking, cost/usage accounting, security, health/metrics,
  troubleshooting table

---

## 9. Files Changed

**New:**
- `apps/backend/src/embeddings/` — 19 source files + 19 test files (~4,400 LOC total)
- `apps/backend/docs/embeddings/` — 3 docs

**Modified:**
- `apps/backend/src/config/schema.ts` — added `embeddings` Zod schema branch
- `apps/backend/src/config/defaults.ts` — added `embeddings` stage defaults
- `apps/backend/src/config/configLoader.ts` — wired all `embeddings`/`EMBEDDING_*` env vars
- `apps/backend/src/secrets/registry.ts` — added `VOYAGE_API_KEY`, `COHERE_API_KEY`
- `apps/backend/.env.example` — documented embeddings/Redis env vars

No changes to `package.json` or `pnpm-lock.yaml` — this phase adds zero new
runtime dependencies.

---

## 10. What This Phase Does Not Include (by design — out of scope)

Per the explicit instruction to implement **only** the embedding provider
layer:

- No route/controller exposes `embed()`/`embedBatch()`/`embedStream()` over
  HTTP yet — that is Release 3's chat/search feature work, which this layer
  is built to support.
- No wiring into the queue infrastructure's `generate_embeddings` job type
  (Phase 1) — connecting a job handler that calls this module is natural
  next-step work once search/RAG features are ready to consume it.
- No vector database integration (Pinecone/Weaviate/pgvector) — this phase
  produces embeddings; storing and querying them is a separate, later
  concern per the Release 3 architecture plan.
- No `/health` or `/metrics` HTTP endpoint surfaces
  `getEmbeddingMetricsCollector()`/`getEmbeddingCircuitBreakerRegistry()`
  data yet — the collectors exist and are tested; exposing them is left to
  whichever route/dashboard consumes them, the same boundary the queue
  module's own metrics/health modules draw.
