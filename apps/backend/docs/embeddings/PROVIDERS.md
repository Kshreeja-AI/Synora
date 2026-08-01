# Embedding Providers Reference

Every provider is a file under `apps/backend/src/embeddings/providers/`,
publishing an `EmbeddingProviderDescriptor` (`id`, `displayName`,
`isConfigured()`, `create()`) registered in `registry.ts`. This document is
the per-provider reference; see `ARCHITECTURE.md` for how selection and
the call pipeline work.

## OpenAI (`openai`)

- **SDK**: `openai` npm package, `client.embeddings.create()`.
- **Activation**: `OPENAI_API_KEY` secret.
- **Default model**: `text-embedding-3-small` (override: `EMBEDDING_OPENAI_MODEL`).
- **Batch limit**: 2048 texts per call — OpenAI's own documented limit.
- **Token usage**: reported directly by the API (`usage.total_tokens`),
  divided evenly across the batch for per-item accounting.
- First in `EMBEDDING_PROVIDER_REGISTRY`'s priority order — the
  auto-detected default when only its key is configured.

## Voyage AI (`voyage`)

- **API**: plain REST (`POST https://api.voyageai.com/v1/embeddings`), no
  Node SDK — called via `fetch`.
- **Activation**: `VOYAGE_API_KEY` secret.
- **Default model**: `voyage-3` (override: `EMBEDDING_VOYAGE_MODEL`).
- **Batch limit**: 128 texts per call.
- **Why it's here**: Anthropic's own documentation recommends Voyage for
  embeddings in place of a native Claude endpoint — see `claude` below.

## Google Gemini (`gemini`)

- **SDK**: `@google/generative-ai`, `model.batchEmbedContents()`.
- **Activation**: `GOOGLE_AI_API_KEY` secret.
- **Default model**: `text-embedding-004` (override: `EMBEDDING_GEMINI_MODEL`).
- **Batch limit**: 100 texts per call — Google's documented limit for
  `batchEmbedContents`.
- **Token usage**: **estimated**, not reported by the API — Gemini's
  embeddings response has no `usageMetadata` the way `generateContent` does.
  Estimated via `~4 characters per token` (`estimateTokensFromChars`), the
  same heuristic OpenAI's own docs use when exact tokenization isn't
  available. This is for cost/usage display only, never billing enforcement.

## Cohere (`cohere`)

- **API**: plain REST (`POST https://api.cohere.com/v1/embed`), no Node SDK
  — called via `fetch`.
- **Activation**: `COHERE_API_KEY` secret.
- **Default model**: `embed-english-v3.0` (override: `EMBEDDING_COHERE_MODEL`).
- **Batch limit**: 96 texts per call.
- **Note**: Cohere v3 models require an `input_type` hint and produce
  different vectors for `search_query` vs `search_document`. This provider
  always sends `search_document`, matching how this application uses
  embeddings (indexing content for later semantic search) — it does not
  (yet) expose a query-time embedding mode with a different `input_type`.

## Anthropic Claude (`claude`) — structurally unsupported

- **No embeddings API exists.** Anthropic's documentation directs customers
  to Voyage AI instead of exposing one themselves.
- `claudeEmbeddingDescriptor.unsupportedReason` is set, `isConfigured()`
  always returns `false` (auto-detection silently skips it), and `create()`
  always throws `EmbeddingProviderUnsupportedError`.
- This is a documented, permanent API limitation — not a placeholder, not a
  TODO. There is nothing to "finish implementing" here short of Anthropic
  shipping an embeddings endpoint. Use `voyage` instead.

## Ollama (`ollama`)

- **SDK**: `openai` npm package pointed at a custom `baseURL` — recent
  Ollama releases expose an OpenAI-compatible `/v1/embeddings` endpoint, so
  this reuses `OpenAICompatibleEmbeddingProvider` rather than a bespoke
  client, exactly the way `src/ai/providers/ollama.provider.ts` reuses
  `OpenAICompatibleTextProvider` for chat completions.
- **Activation**: `EMBEDDING_OLLAMA_BASE_URL` (e.g.
  `http://localhost:11434/v1`) — deliberately requires an explicit value
  rather than defaulting to localhost, so auto-detection never silently
  selects a local dev server nobody intended to use.
- **Default model**: `nomic-embed-text` (override: `EMBEDDING_OLLAMA_MODEL`).
- **Batch limit**: 64 (configurable via `EMBEDDING_OLLAMA_MAX_BATCH_SIZE`) —
  no official limit is documented; 64 is a conservative default sized for a
  single local/on-prem instance.
- No API key required — Ollama does not check the placeholder value sent.

## Self-Hosted (`self-hosted`)

- **SDK**: `openai` npm package pointed at a custom `baseURL`, same
  `OpenAICompatibleEmbeddingProvider` as `ollama`.
- **Activation**: `EMBEDDING_SELF_HOSTED_BASE_URL`.
- **Default model**: `nomic-embed-text` (override: `EMBEDDING_SELF_HOSTED_MODEL`).
- **Batch limit**: 64 (configurable via `EMBEDDING_SELF_HOSTED_MAX_BATCH_SIZE`).
- **API key**: optional (`EMBEDDING_SELF_HOSTED_API_KEY`) — self-hosted
  deployments behind a private network commonly have none.
- **Scope**: "self-hosted" means "any OpenAI-compatible embeddings server" —
  vLLM, Text Embeddings Inference (TEI), and LocalAI all implement this
  convention. An engine that doesn't speak it can sit behind a thin
  translation proxy, the same accommodation every other OpenAI-compatible
  provider in this codebase relies on.

## Adding a new provider

1. Add one file under `providers/your-provider.provider.ts` exporting an
   `EmbeddingProviderDescriptor`.
2. Register it in `registry.ts`'s `EMBEDDING_PROVIDER_REGISTRY` array.
3. If it has a real embeddings API, implement `embed()`/`embedBatch()` (or
   reuse `OpenAICompatibleEmbeddingProvider` if it speaks that wire format).
4. If it's a secret-backed provider, add the secret to
   `src/secrets/registry.ts`'s `SECRET_CATALOG`.
5. Add any non-secret config (model name, batch size, base URL) to
   `src/config/schema.ts` + `defaults.ts` + `configLoader.ts`, and document
   the env vars in `.env.example`.

Nothing in `resolver.ts`, `service.ts`, or any application code that calls
`embed()`/`embedBatch()`/`embedStream()` needs to change.
