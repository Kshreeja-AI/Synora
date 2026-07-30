import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VectorDBService } from '../service';
import { VectorDBMetricsCollector } from '../metrics';
import { HealthChecker } from '../health';
import {
  DeleteRequest,
  DeleteResult,
  QueryRequest,
  QueryResult,
  UpsertRequest,
  UpsertResult,
  VectorDBProvider,
  VectorDBValidationError,
} from '../types';

const { mockResolveVectorDBProvider } = vi.hoisted(() => ({
  mockResolveVectorDBProvider: vi.fn(),
}));

vi.mock('../resolver', () => ({
  resolveVectorDBProvider: mockResolveVectorDBProvider,
}));

class FakeProvider implements VectorDBProvider {
  readonly id = 'fake';
  readonly supportsHybridSearch = false;
  upsertCalls: UpsertRequest[] = [];
  queryCalls: QueryRequest[] = [];
  deleteCalls: DeleteRequest[] = [];
  upsertImpl: (request: UpsertRequest) => Promise<UpsertResult>;
  queryImpl: (request: QueryRequest) => Promise<QueryResult>;

  constructor(readonly maxUpsertBatchSize = 100) {
    this.upsertImpl = async (request) => ({ upsertedCount: request.vectors.length });
    this.queryImpl = async () => ({
      matches: [
        { id: 'match-1', score: 0.9, metadata: { conversationId: 'conv-allowed' } },
        { id: 'match-2', score: 0.8, metadata: { conversationId: 'conv-forbidden' } },
      ],
    });
  }

  async upsert(request: UpsertRequest): Promise<UpsertResult> {
    this.upsertCalls.push(request);
    return this.upsertImpl(request);
  }

  async query(request: QueryRequest): Promise<QueryResult> {
    this.queryCalls.push(request);
    return this.queryImpl(request);
  }

  async delete(request: DeleteRequest): Promise<DeleteResult> {
    this.deleteCalls.push(request);
    return {};
  }
}

function buildService() {
  const metrics = new VectorDBMetricsCollector();
  const health = new HealthChecker(metrics);
  const service = new VectorDBService(metrics, health, {
    maxUpsertRequestSize: 100,
    maxTopK: 100,
    maxDimensions: 10,
  });
  return { service, metrics, health };
}

describe('VectorDBService', () => {
  let fakeProvider: FakeProvider;

  beforeEach(() => {
    fakeProvider = new FakeProvider();
    mockResolveVectorDBProvider.mockResolvedValue(fakeProvider);
  });

  describe('upsert', () => {
    it('validates workspaceId and batch before calling the provider', async () => {
      const { service } = buildService();
      await expect(service.upsert([{ id: 'a', values: [1] }], { workspaceId: '' })).rejects.toThrow(
        VectorDBValidationError
      );
      await expect(service.upsert([], { workspaceId: 'ws-1' })).rejects.toThrow(VectorDBValidationError);
    });

    it('calls the provider once for a batch within the provider limit', async () => {
      const { service } = buildService();
      const result = await service.upsert(
        [
          { id: 'a', values: [1] },
          { id: 'b', values: [1] },
        ],
        { workspaceId: 'ws-1' }
      );

      expect(result.upsertedCount).toBe(2);
      expect(fakeProvider.upsertCalls).toHaveLength(1);
    });

    it('chunks a batch larger than provider.maxUpsertBatchSize into multiple calls', async () => {
      fakeProvider = new FakeProvider(2);
      mockResolveVectorDBProvider.mockResolvedValue(fakeProvider);
      const { service } = buildService();

      const vectors = Array.from({ length: 5 }, (_, i) => ({ id: `v${i}`, values: [1] }));
      const result = await service.upsert(vectors, { workspaceId: 'ws-1' });

      expect(result.upsertedCount).toBe(5);
      expect(fakeProvider.upsertCalls).toHaveLength(3); // groups of 2, 2, 1
    });

    it('upsertOne wraps a single record as a batch of one', async () => {
      const { service } = buildService();
      const result = await service.upsertOne({ id: 'a', values: [1] }, { workspaceId: 'ws-1' });
      expect(result.upsertedCount).toBe(1);
      expect(fakeProvider.upsertCalls[0].vectors).toHaveLength(1);
    });

    it('records upsert metrics on success', async () => {
      const { service, metrics } = buildService();
      await service.upsert([{ id: 'a', values: [1] }], { workspaceId: 'ws-1' });
      expect(metrics.getMetrics('fake').upsert.calls).toBe(1);
    });

    it('records upsert metrics on provider failure and rethrows', async () => {
      fakeProvider.upsertImpl = async () => {
        throw new Error('boom');
      };
      const { service, metrics } = buildService();

      await expect(service.upsert([{ id: 'a', values: [1] }], { workspaceId: 'ws-1' })).rejects.toThrow('boom');
      expect(metrics.getMetrics('fake').upsert.errors).toBe(1);
    });
  });

  describe('query', () => {
    it('validates workspaceId and query vector', async () => {
      const { service } = buildService();
      await expect(service.query({ workspaceId: '', vector: [1], topK: 5 })).rejects.toThrow(
        VectorDBValidationError
      );
      await expect(service.query({ workspaceId: 'ws-1', vector: [], topK: 5 })).rejects.toThrow(
        VectorDBValidationError
      );
    });

    it('returns matches from the provider unfiltered when no permissionFilter is given', async () => {
      const { service } = buildService();
      const result = await service.query({ workspaceId: 'ws-1', vector: [1], topK: 5 });
      expect(result.matches).toHaveLength(2);
    });

    it('enforces permissionFilter as a defense-in-depth check, regardless of provider filter push-down', async () => {
      const { service } = buildService();
      const result = await service.query({
        workspaceId: 'ws-1',
        vector: [1],
        topK: 5,
        permissionFilter: (match) => match.metadata?.conversationId === 'conv-allowed',
      });

      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].id).toBe('match-1');
    });

    it('does not forward sparseVector/hybridAlpha to a provider that does not support hybrid search', async () => {
      const { service } = buildService();
      await service.query({
        workspaceId: 'ws-1',
        vector: [1],
        topK: 5,
        sparseVector: { indices: [0], values: [1] },
        hybridAlpha: 0.5,
      });

      expect(fakeProvider.queryCalls[0].sparseVector).toBeUndefined();
      expect(fakeProvider.queryCalls[0].hybridAlpha).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('validates exactly one delete mode is specified', async () => {
      const { service } = buildService();
      await expect(service.delete({ workspaceId: 'ws-1' })).rejects.toThrow(VectorDBValidationError);
      await expect(
        service.delete({ workspaceId: 'ws-1', ids: ['a'], deleteAll: true })
      ).rejects.toThrow(VectorDBValidationError);
    });

    it('deleteByWorkspace issues a deleteAll for the whole workspace', async () => {
      const { service } = buildService();
      await service.deleteByWorkspace('ws-1');
      expect(fakeProvider.deleteCalls[0]).toMatchObject({ workspaceId: 'ws-1', deleteAll: true });
    });

    it('deleteByConversation filters by conversationId metadata', async () => {
      const { service } = buildService();
      await service.deleteByConversation('ws-1', 'conv-1');
      expect(fakeProvider.deleteCalls[0]).toMatchObject({
        workspaceId: 'ws-1',
        filter: { conversationId: { eq: 'conv-1' } },
      });
    });
  });

  describe('getHealth', () => {
    it('delegates to the injected HealthChecker', () => {
      const { service } = buildService();
      const health = service.getHealth('fake');
      expect(health.status).toBe('healthy');
      expect(health.providerId).toBe('fake');
    });
  });
});
