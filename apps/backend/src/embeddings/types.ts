/**
 * Provider-agnostic embedding capability contracts.
 *
 * This mirrors the pattern in `../ai/types.ts` and `../ai/types/descriptor.ts`
 * — the rest of the application depends only on the types and functions in
 * this module and `./index.ts`, never on a concrete provider or its SDK.
 * `embeddings` is deliberately its own capability module rather than being
 * contorted into `../ai`'s `TextGenerationProvider` shape: an embedding call
 * takes text and returns a fixed-size vector, not a token stream, and every
 * production concern here (caching by content hash, batch-shaped rate
 * limits, workspace-scoped cost accounting) has no equivalent in text
 * generation.
 */

export interface EmbeddingVector {
  readonly values: readonly number[];
  readonly dimensions: number;
}

/**
 * Every request is workspace-scoped by construction — `workspaceId` is a
 * required field, not an optional one threaded through as an afterthought.
 * Cache keys, rate-limit buckets, and usage/cost accounting are all keyed by
 * it, so a caller cannot accidentally leak cache hits, quota, or spend
 * across workspace boundaries by omitting it.
 */
export interface EmbeddingRequest {
  text: string;
  workspaceId: string;
  /** Override the provider's configured default model for this one call. */
  model?: string;
}

export interface EmbeddingBatchRequest {
  texts: readonly string[];
  workspaceId: string;
  model?: string;
}

export interface EmbeddingUsage {
  /** Input tokens billed by the provider for this text (estimated for providers that don't report it). */
  tokens: number;
}

export interface EmbeddingResult {
  embedding: EmbeddingVector;
  /** The provider id that actually served this request, e.g. "openai". */
  provider: string;
  /** The concrete model name used, e.g. "text-embedding-3-small". */
  model: string;
  usage: EmbeddingUsage;
  /** True if this result was served from cache rather than a live provider call. */
  cached: boolean;
}

export interface EmbeddingBatchResult {
  results: readonly EmbeddingResult[];
  provider: string;
  model: string;
}

/**
 * One chunk of a larger document, produced by `../chunking.ts`. `startOffset`/
 * `endOffset` are character offsets into the original text, so callers can
 * map an embedding back to its source span (e.g. for highlighting search
 * results).
 */
export interface TextChunk {
  text: string;
  index: number;
  startOffset: number;
  endOffset: number;
}

export type ChunkingStrategyName = 'fixed' | 'sentence' | 'recursive';

export interface ChunkingOptions {
  strategy?: ChunkingStrategyName;
  /** Target chunk size in characters. */
  chunkSize?: number;
  /** Character overlap between consecutive chunks, to preserve context across a boundary. */
  overlap?: number;
}

/**
 * Emitted by `EmbeddingService.embedStream()` as each chunk of a
 * chunked/streamed document finishes embedding. Embedding APIs do not
 * support token-level output streaming the way text generation does — a
 * single embedding call returns one complete vector — so "streaming" here
 * means progressive, per-chunk delivery of a large document's embeddings as
 * each batch completes, rather than making the caller wait for the entire
 * document to be chunked and embedded before seeing any result.
 */
export interface EmbeddingStreamChunk {
  chunk: TextChunk;
  totalChunks: number;
  result: EmbeddingResult;
}

/** Implemented by any provider that can serve embeddings. */
export interface EmbeddingProvider {
  readonly id: string;
  readonly defaultModel: string;
  /** Maximum number of texts this provider accepts in a single batch call. */
  readonly maxBatchSize: number;
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
  embedBatch(request: EmbeddingBatchRequest): Promise<EmbeddingBatchResult>;
}

/**
 * Thrown when a provider call fails for a reason the caller can act on
 * (missing configuration, upstream error, invalid response) — never a raw
 * SDK/HTTP error, so callers never need to know which provider failed or how
 * that provider's SDK/API shapes its errors.
 */
export class EmbeddingProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'EmbeddingProviderError';
  }
}

/** Thrown by the resolver when no provider is configured for embeddings. */
export class NoEmbeddingProviderConfiguredError extends Error {
  constructor(checkedProviders: readonly string[]) {
    super(
      `No embedding provider is configured. Checked: ${checkedProviders.join(', ')}. ` +
        `Set one of their API key secrets, or set EMBEDDING_PROVIDER explicitly. ` +
        `See apps/backend/docs/embeddings/ARCHITECTURE.md.`
    );
    this.name = 'NoEmbeddingProviderConfiguredError';
  }
}

/**
 * Thrown when a provider is explicitly selected (or auto-detected) but does
 * not — and structurally cannot — support embeddings at all, as opposed to
 * being merely unconfigured. Anthropic/Claude is the concrete example: it
 * has no text-embedding endpoint at all (Anthropic's own docs point
 * customers to Voyage AI instead), so `create()` on that descriptor always
 * throws this rather than silently returning a provider that would fail on
 * first use.
 */
export class EmbeddingProviderUnsupportedError extends Error {
  constructor(providerId: string, reason: string) {
    super(`Provider "${providerId}" does not support embeddings: ${reason}`);
    this.name = 'EmbeddingProviderUnsupportedError';
  }
}

export class EmbeddingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingValidationError';
  }
}

export class EmbeddingRateLimitExceededError extends Error {
  constructor(providerId: string, workspaceId: string) {
    super(`Rate limit exceeded for embedding provider "${providerId}" in workspace "${workspaceId}".`);
    this.name = 'EmbeddingRateLimitExceededError';
  }
}

export class EmbeddingCircuitOpenError extends Error {
  constructor(providerId: string) {
    super(`Circuit breaker is open for embedding provider "${providerId}" — refusing calls until cooldown elapses.`);
    this.name = 'EmbeddingCircuitOpenError';
  }
}
