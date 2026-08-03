import { EmbeddingCache, buildCacheKey } from './cache';
import { RateLimiter } from './rateLimiter';
import { CircuitBreakerRegistry } from './circuitBreaker';
import { EmbeddingMetricsCollector } from './metrics';
import { UsageAccountant } from './usage';
import { RetryPolicyConfig, withRetry } from './retry';
import { EmbeddingSecurityLimits, validateBatch, validateText, validateWorkspaceId, redactTextForLogging } from './security';
import { estimateEmbeddingCost } from './pricing';
import { withSpan } from './tracing';
import { chunkText } from './chunking';
import { resolveEmbeddingProvider } from './resolver';
import {
  ChunkingOptions,
  EmbeddingBatchResult,
  EmbeddingCircuitOpenError,
  EmbeddingProvider,
  EmbeddingProviderError,
  EmbeddingRateLimitExceededError,
  EmbeddingResult,
  EmbeddingStreamChunk,
} from './types';
import { recordAiInteraction, declareAiPath } from '../eos/instrumentation';

declareAiPath('embeddings.embed');

export interface EmbedOptions {
  workspaceId: string;
  model?: string;
  providerId?: string;
}

export interface EmbedStreamOptions extends EmbedOptions {
  chunking?: ChunkingOptions;
}

function groupInto<T>(items: readonly T[], groupSize: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += groupSize) {
    groups.push(items.slice(i, i + groupSize));
  }
  return groups;
}

/**
 * The single orchestrator every caller (routes, other services) talks to.
 * Everything about *how* an embedding is produced — which provider serves
 * it, whether it's cached, whether it's rate-limited or circuit-broken,
 * how failures are retried, and how the resulting cost/usage is recorded —
 * is handled here. Nothing outside this module ever calls a provider's
 * `embed()`/`embedBatch()` directly. Mirrors `../queue/manager.ts`'s role
 * as the queue subsystem's single orchestrator.
 *
 * Depends only on interfaces (`EmbeddingCache`, `RateLimiter`, ...), not
 * concrete implementations, so tests can construct one with in-memory/fake
 * dependencies without touching Redis, real providers, or the config
 * system. `./factory.ts` is what wires this up from `getConfig()` for
 * application use.
 */
export class EmbeddingService {
  constructor(
    private readonly cache: EmbeddingCache,
    private readonly rateLimiter: RateLimiter,
    private readonly circuitBreakers: CircuitBreakerRegistry,
    private readonly metrics: EmbeddingMetricsCollector,
    private readonly usage: UsageAccountant,
    private readonly retryConfig: RetryPolicyConfig,
    private readonly securityLimits: EmbeddingSecurityLimits,
    private readonly cacheTtlMs: number
  ) {}

  async embed(text: string, options: EmbedOptions): Promise<EmbeddingResult> {
    validateWorkspaceId(options.workspaceId);
    validateText(text, this.securityLimits);

    const provider = await resolveEmbeddingProvider({ explicitProviderId: options.providerId });
    const model = options.model ?? provider.defaultModel;
    const cacheKey = buildCacheKey(options.workspaceId, provider.id, model, text);

    return withSpan(
      'embeddings.embed',
      { providerId: provider.id, workspaceId: options.workspaceId, model, text: redactTextForLogging(text) },
      async () => {
        const cached = await this.cache.get(cacheKey);
        if (cached) {
          this.metrics.recordCall({
            providerId: provider.id,
            latencyMs: 0,
            tokens: cached.result.usage.tokens,
            cacheHit: true,
            success: true,
          });
          return { ...cached.result, cached: true };
        }

        const result = await this.callProviderSingle(provider, text, options.workspaceId, model);
        await this.cache.set(cacheKey, { result, createdAt: Date.now() }, this.cacheTtlMs);
        return result;
      }
    );
  }

  async embedBatch(texts: readonly string[], options: EmbedOptions): Promise<EmbeddingBatchResult> {
    validateWorkspaceId(options.workspaceId);
    validateBatch(texts, this.securityLimits);

    const provider = await resolveEmbeddingProvider({ explicitProviderId: options.providerId });
    const model = options.model ?? provider.defaultModel;

    return withSpan(
      'embeddings.embedBatch',
      { providerId: provider.id, workspaceId: options.workspaceId, model, batchSize: texts.length },
      async () => {
        const results: (EmbeddingResult | undefined)[] = new Array(texts.length);
        const missingIndices: number[] = [];

        for (let i = 0; i < texts.length; i++) {
          const cacheKey = buildCacheKey(options.workspaceId, provider.id, model, texts[i]);
          const cached = await this.cache.get(cacheKey);
          if (cached) {
            this.metrics.recordCall({
              providerId: provider.id,
              latencyMs: 0,
              tokens: cached.result.usage.tokens,
              cacheHit: true,
              success: true,
            });
            results[i] = { ...cached.result, cached: true };
          } else {
            missingIndices.push(i);
          }
        }

        if (missingIndices.length > 0) {
          const indexGroups = groupInto(missingIndices, provider.maxBatchSize);

          for (const indexGroup of indexGroups) {
            const groupTexts = indexGroup.map((i) => texts[i]);
            const batchResults = await this.callProviderBatch(provider, groupTexts, options.workspaceId, model);

            for (let j = 0; j < indexGroup.length; j++) {
              const originalIndex = indexGroup[j];
              const result = batchResults[j];
              results[originalIndex] = result;
              const cacheKey = buildCacheKey(options.workspaceId, provider.id, model, texts[originalIndex]);
              await this.cache.set(cacheKey, { result, createdAt: Date.now() }, this.cacheTtlMs);
            }
          }
        }

        return { results: results as EmbeddingResult[], provider: provider.id, model };
      }
    );
  }

  /**
   * Chunks `text` (see `./chunking.ts`) and yields each chunk's embedding
   * progressively as its containing batch completes, rather than making
   * the caller wait for the whole document to finish. See `EmbeddingStreamChunk`
   * in `./types.ts` for why this — not token-level output — is what
   * "streaming" means for an embeddings API.
   */
  async *embedStream(text: string, options: EmbedStreamOptions): AsyncGenerator<EmbeddingStreamChunk> {
    validateWorkspaceId(options.workspaceId);

    const chunks = chunkText(text, options.chunking);
    if (chunks.length === 0) return;

    const provider = await resolveEmbeddingProvider({ explicitProviderId: options.providerId });
    const groups = groupInto(chunks, provider.maxBatchSize);

    for (const group of groups) {
      const batchResult = await this.embedBatch(
        group.map((c) => c.text),
        options
      );
      for (let i = 0; i < group.length; i++) {
        yield { chunk: group[i], totalChunks: chunks.length, result: batchResult.results[i] };
      }
    }
  }

  private async callProviderSingle(
    provider: EmbeddingProvider,
    text: string,
    workspaceId: string,
    model: string
  ): Promise<EmbeddingResult> {
    const [result] = await this.callProviderBatch(provider, [text], workspaceId, model);
    return result;
  }

  private async callProviderBatch(
    provider: EmbeddingProvider,
    texts: readonly string[],
    workspaceId: string,
    model: string
  ): Promise<EmbeddingResult[]> {
    const breaker = this.circuitBreakers.get(provider.id);
    if (!breaker.canAttempt()) {
      throw new EmbeddingCircuitOpenError(provider.id);
    }

    const rateLimitKey = `${provider.id}:${workspaceId}`;
    if (!(await this.rateLimiter.tryAcquire(rateLimitKey))) {
      throw new EmbeddingRateLimitExceededError(provider.id, workspaceId);
    }

    const start = Date.now();
    try {
      const batch = await withRetry(
        () => provider.embedBatch({ texts, workspaceId, model }),
        this.retryConfig,
        { providerId: provider.id, operation: 'embedBatch' }
      );
      const latencyMs = Date.now() - start;

      breaker.recordSuccess();

      for (const result of batch.results) {
        this.metrics.recordCall({
          providerId: provider.id,
          latencyMs: latencyMs / batch.results.length,
          tokens: result.usage.tokens,
          cacheHit: false,
          success: true,
        });
        const cost = estimateEmbeddingCost(result.model, result.usage.tokens);
        this.usage.recordUsage(workspaceId, provider.id, result.usage.tokens, cost);
      }

      // Instrumented here, at the single real provider-call chokepoint, so
      // cache hits are excluded structurally rather than by a conditional —
      // counting a cache hit as a provider call would make providers look
      // faster and cheaper than they are.
      recordAiInteraction({
        promptId: 'embeddings.embed',
        providerId: provider.id,
        modelId: model,
        success: true,
        latencyMs,
        inputTokens: batch.results.reduce((sum, r) => sum + r.usage.tokens, 0),
      });

      return [...batch.results];
    } catch (error) {
      const latencyMs = Date.now() - start;
      breaker.recordFailure();
      this.metrics.recordCall({
        providerId: provider.id,
        latencyMs,
        tokens: 0,
        cacheHit: false,
        success: false,
      });
      recordAiInteraction({
        promptId: 'embeddings.embed',
        providerId: provider.id,
        modelId: model,
        success: false,
        latencyMs,
        errorCode: error instanceof Error ? error.name : 'unknown',
      });
      throw error instanceof EmbeddingProviderError
        ? error
        : new EmbeddingProviderError(
            `${provider.id} embedding call failed: ${error instanceof Error ? error.message : String(error)}`,
            provider.id,
            error
          );
    }
  }
}
