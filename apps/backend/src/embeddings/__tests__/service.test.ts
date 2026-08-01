import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddingService } from '../service';
import { InMemoryEmbeddingCache } from '../cache';
import { InMemoryRateLimiter } from '../rateLimiter';
import { CircuitBreakerRegistry } from '../circuitBreaker';
import { EmbeddingMetricsCollector } from '../metrics';
import { UsageAccountant } from '../usage';
import {
  EmbeddingBatchRequest,
  EmbeddingBatchResult,
  EmbeddingCircuitOpenError,
  EmbeddingProvider,
  EmbeddingRateLimitExceededError,
  EmbeddingRequest,
  EmbeddingResult,
  EmbeddingValidationError,
} from '../types';

const { mockResolveEmbeddingProvider } = vi.hoisted(() => ({
  mockResolveEmbeddingProvider: vi.fn(),
}));

vi.mock('../resolver', () => ({
  resolveEmbeddingProvider: mockResolveEmbeddingProvider,
}));

class FakeProvider implements EmbeddingProvider {
  readonly id = 'fake';
  readonly defaultModel = 'fake-model';
  readonly maxBatchSize: number;
  embedBatchImpl: (request: EmbeddingBatchRequest) => Promise<EmbeddingBatchResult>;
  calls: EmbeddingBatchRequest[] = [];

  constructor(maxBatchSize = 100) {
    this.maxBatchSize = maxBatchSize;
    this.embedBatchImpl = async (request) => ({
      results: request.texts.map((text) => ({
        embedding: { values: [text.length], dimensions: 1 },
        provider: 'fake',
        model: request.model ?? this.defaultModel,
        usage: { tokens: text.length },
        cached: false,
      })),
      provider: 'fake',
      model: request.model ?? this.defaultModel,
    });
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const batch = await this.embedBatch({ texts: [request.text], workspaceId: request.workspaceId, model: request.model });
    return batch.results[0];
  }

  async embedBatch(request: EmbeddingBatchRequest): Promise<EmbeddingBatchResult> {
    this.calls.push(request);
    return this.embedBatchImpl(request);
  }
}

function buildService(overrides?: { rateLimiter?: InMemoryRateLimiter }) {
  const cache = new InMemoryEmbeddingCache(1000);
  const rateLimiter = overrides?.rateLimiter ?? new InMemoryRateLimiter(1000, 1000);
  const circuitBreakers = new CircuitBreakerRegistry({
    failureThreshold: 2,
    cooldownMs: 10_000,
    halfOpenSuccessThreshold: 1,
  });
  const metrics = new EmbeddingMetricsCollector();
  const usage = new UsageAccountant();

  const service = new EmbeddingService(
    cache,
    rateLimiter,
    circuitBreakers,
    metrics,
    usage,
    { attempts: 2, backoffMs: 0, backoffStrategy: 'fixed' },
    { maxInputChars: 1000, maxBatchRequestSize: 100 },
    60_000
  );

  return { service, cache, rateLimiter, circuitBreakers, metrics, usage };
}

describe('EmbeddingService', () => {
  let fakeProvider: FakeProvider;

  beforeEach(() => {
    fakeProvider = new FakeProvider();
    mockResolveEmbeddingProvider.mockResolvedValue(fakeProvider);
  });

  describe('embed', () => {
    it('validates workspaceId and text before calling the provider', async () => {
      const { service } = buildService();
      await expect(service.embed('hi', { workspaceId: '' })).rejects.toThrow(EmbeddingValidationError);
      await expect(service.embed('', { workspaceId: 'ws-1' })).rejects.toThrow(EmbeddingValidationError);
    });

    it('calls the provider and returns its result on a cache miss', async () => {
      const { service } = buildService();
      const result = await service.embed('hello world', { workspaceId: 'ws-1' });

      expect(result.embedding.values).toEqual([11]);
      expect(result.cached).toBe(false);
      expect(fakeProvider.calls).toHaveLength(1);
    });

    it('serves a cache hit without calling the provider again', async () => {
      const { service } = buildService();
      await service.embed('hello world', { workspaceId: 'ws-1' });
      const second = await service.embed('hello world', { workspaceId: 'ws-1' });

      expect(second.cached).toBe(true);
      expect(fakeProvider.calls).toHaveLength(1);
    });

    it('keeps cache entries isolated per workspace', async () => {
      const { service } = buildService();
      await service.embed('hello world', { workspaceId: 'ws-1' });
      const otherWorkspace = await service.embed('hello world', { workspaceId: 'ws-2' });

      expect(otherWorkspace.cached).toBe(false);
      expect(fakeProvider.calls).toHaveLength(2);
    });

    it('records usage and cost accounting on a successful call', async () => {
      const { service, usage } = buildService();
      await service.embed('hello world', { workspaceId: 'ws-1' });

      const workspaceUsage = usage.getWorkspaceUsage('ws-1');
      expect(workspaceUsage.totalCalls).toBe(1);
      expect(workspaceUsage.totalTokens).toBe(11);
    });

    it('retries a transient provider failure and eventually succeeds', async () => {
      const { service } = buildService();
      let attempt = 0;
      fakeProvider.embedBatchImpl = async (request) => {
        attempt += 1;
        if (attempt === 1) throw new Error('ETIMEDOUT');
        return {
          results: request.texts.map((t) => ({
            embedding: { values: [t.length], dimensions: 1 },
            provider: 'fake',
            model: 'fake-model',
            usage: { tokens: t.length },
            cached: false,
          })),
          provider: 'fake',
          model: 'fake-model',
        };
      };

      const result = await service.embed('retry me', { workspaceId: 'ws-1' });
      expect(result.embedding.values).toEqual([8]);
      expect(attempt).toBe(2);
    });

    it('rejects when the rate limiter denies the call', async () => {
      const denyingLimiter = new InMemoryRateLimiter(0, 0);
      const { service } = buildService({ rateLimiter: denyingLimiter });

      await expect(service.embed('hello', { workspaceId: 'ws-1' })).rejects.toThrow(
        EmbeddingRateLimitExceededError
      );
    });

    it('opens the circuit breaker after repeated failures and then fails fast', async () => {
      const { service } = buildService();
      fakeProvider.embedBatchImpl = async () => {
        throw new Error('ECONNREFUSED');
      };

      // failureThreshold is 2; each embed() call itself retries twice internally
      // via the retry policy, but retries share one circuit-breaker failure per
      // *call* boundary — two full embed() calls should be enough to trip it.
      await expect(service.embed('a', { workspaceId: 'ws-1' })).rejects.toThrow();
      await expect(service.embed('b', { workspaceId: 'ws-1' })).rejects.toThrow();
      await expect(service.embed('c', { workspaceId: 'ws-1' })).rejects.toThrow(EmbeddingCircuitOpenError);
    });
  });

  describe('embedBatch', () => {
    it('validates batch size limits', async () => {
      const { service } = buildService();
      await expect(service.embedBatch([], { workspaceId: 'ws-1' })).rejects.toThrow(EmbeddingValidationError);
    });

    it('embeds all texts and preserves order', async () => {
      const { service } = buildService();
      const result = await service.embedBatch(['a', 'bb', 'ccc'], { workspaceId: 'ws-1' });

      expect(result.results.map((r) => r.embedding.values[0])).toEqual([1, 2, 3]);
    });

    it('only sends cache misses to the provider', async () => {
      const { service } = buildService();
      await service.embed('a', { workspaceId: 'ws-1' });
      fakeProvider.calls = [];

      const result = await service.embedBatch(['a', 'new-text'], { workspaceId: 'ws-1' });

      expect(result.results[0].cached).toBe(true);
      expect(result.results[1].cached).toBe(false);
      expect(fakeProvider.calls).toHaveLength(1);
      expect(fakeProvider.calls[0].texts).toEqual(['new-text']);
    });

    it('splits a batch larger than the provider max batch size into groups', async () => {
      fakeProvider = new FakeProvider(2);
      mockResolveEmbeddingProvider.mockResolvedValue(fakeProvider);
      const { service } = buildService();

      const result = await service.embedBatch(['a', 'b', 'c', 'd', 'e'], { workspaceId: 'ws-1' });

      expect(result.results).toHaveLength(5);
      expect(fakeProvider.calls).toHaveLength(3); // groups of 2, 2, 1
    });
  });

  describe('embedStream', () => {
    it('yields one EmbeddingStreamChunk per chunk of the document', async () => {
      const { service } = buildService();
      const text = 'Paragraph one is here.\n\nParagraph two is here.';

      const chunks = [];
      for await (const chunk of service.embedStream(text, {
        workspaceId: 'ws-1',
        chunking: { chunkSize: 100, overlap: 10 },
      })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(chunk.result.embedding.values[0]).toBe(chunk.chunk.text.length);
        expect(chunk.totalChunks).toBe(chunks.length);
      }
    });

    it('yields nothing for empty text', async () => {
      const { service } = buildService();
      const chunks = [];
      for await (const chunk of service.embedStream('', { workspaceId: 'ws-1' })) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(0);
    });
  });
});
