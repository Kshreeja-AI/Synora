import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SearchService } from '../search.service';

vi.mock('@synora/database', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    searchIndex: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    workspaceMember: { findUnique: vi.fn() },
    conversation: { findUnique: vi.fn(), findFirst: vi.fn() },
    message: { findUnique: vi.fn(), findMany: vi.fn() },
    memory: { findUnique: vi.fn() },
    searchQuery: { create: vi.fn(), findMany: vi.fn() },
    searchSuggestion: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    searchAnalytics: { findFirst: vi.fn() },
    savedSearch: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  },
  Prisma: { QueryMode: { insensitive: 'insensitive' } },
}));

vi.mock('../../embeddings', () => ({
  embed: vi.fn(),
  embedBatch: vi.fn(),
}));

vi.mock('../../vectordb', () => ({
  queryVectors: vi.fn(),
  upsertVectors: vi.fn(),
  deleteVectors: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('SearchService', () => {
  let service: SearchService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SearchService();
  });

  describe('fullTextSearch (via hybridSearch)', () => {
    it('uses PostgreSQL ts_rank, not in-memory String.includes()', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
        {
          id: 'idx-1',
          resourceType: 'CONVERSATION',
          resourceId: 'conv-1',
          title: 'Test Conversation',
          content: 'hello world content',
          summary: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          rank: 0.6,
        },
      ]);

      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({ id: 'wm-1' } as never);
      vi.mocked(prisma.conversation.findUnique).mockResolvedValue({ workspaceId: 'ws-1' } as never);
      vi.mocked(prisma.searchQuery.create).mockResolvedValue({} as never);
      vi.mocked(prisma.searchSuggestion.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.searchSuggestion.create).mockResolvedValue({} as never);
      vi.mocked(prisma.searchAnalytics.findFirst).mockResolvedValue(null);

      const result = await service.hybridSearch({
        workspaceId: 'ws-1',
        userId: 'user-1',
        query: 'hello',
      });

      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('ts_rank'),
        'hello',
        'ws-1',
        expect.any(Number),
      );
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('plainto_tsquery'),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
      expect(result.results.length).toBe(1);
      expect(result.results[0].score).toBe(0.6);
    });

    it('falls back to ILIKE when $queryRawUnsafe fails', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.$queryRawUnsafe).mockRejectedValue(new Error('syntax error'));
      vi.mocked(prisma.searchIndex.findMany).mockResolvedValue([
        {
          id: 'idx-2',
          resourceType: 'MESSAGE',
          resourceId: 'msg-1',
          title: null,
          content: 'matching content here',
          summary: null,
          keywords: [],
          chunkIndex: 0,
          totalChunks: 1,
          embeddingId: null,
          embeddingModel: null,
          embeddingDimension: null,
          tsvector: null,
          workspaceId: 'ws-1',
          language: 'en',
          isIndexed: true,
          indexedAt: new Date(),
          lastUpdatedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as never);

      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({ id: 'wm-1' } as never);
      vi.mocked(prisma.message.findUnique).mockResolvedValue({
        conversation: { workspaceId: 'ws-1' },
      } as never);
      vi.mocked(prisma.searchQuery.create).mockResolvedValue({} as never);
      vi.mocked(prisma.searchSuggestion.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.searchSuggestion.create).mockResolvedValue({} as never);
      vi.mocked(prisma.searchAnalytics.findFirst).mockResolvedValue(null);

      const result = await service.hybridSearch({
        workspaceId: 'ws-1',
        userId: 'user-1',
        query: 'matching',
      });

      expect(prisma.searchIndex.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            content: { contains: 'matching', mode: 'insensitive' },
          }),
        }),
      );
      expect(result.results.length).toBe(1);
      expect(result.results[0].score).toBe(0.5);
    });

    it('never returns a hardcoded score like 0.85 or 0.75', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
        {
          id: 'idx-1',
          resourceType: 'CONVERSATION',
          resourceId: 'conv-1',
          title: 'Test',
          content: 'content',
          summary: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          rank: 0.3,
        },
      ]);

      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({ id: 'wm-1' } as never);
      vi.mocked(prisma.conversation.findUnique).mockResolvedValue({ workspaceId: 'ws-1' } as never);
      vi.mocked(prisma.searchQuery.create).mockResolvedValue({} as never);
      vi.mocked(prisma.searchSuggestion.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.searchSuggestion.create).mockResolvedValue({} as never);
      vi.mocked(prisma.searchAnalytics.findFirst).mockResolvedValue(null);

      const result = await service.hybridSearch({
        workspaceId: 'ws-1',
        userId: 'user-1',
        query: 'test query',
      });

      for (const r of result.results) {
        expect(r.score).not.toBe(0.85);
        expect(r.score).not.toBe(0.75);
      }
    });
  });

  describe('vectorSearch graceful degradation', () => {
    it('returns empty results when no embedding provider is configured', async () => {
      const { prisma } = await import('@synora/database');
      const { embed } = await import('../../embeddings');

      vi.mocked(embed).mockRejectedValue(
        new Error('NoEmbeddingProviderConfiguredError')
      );

      vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({ id: 'wm-1' } as never);
      vi.mocked(prisma.searchQuery.create).mockResolvedValue({} as never);
      vi.mocked(prisma.searchSuggestion.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.searchSuggestion.create).mockResolvedValue({} as never);
      vi.mocked(prisma.searchAnalytics.findFirst).mockResolvedValue(null);

      const result = await service.hybridSearch({
        workspaceId: 'ws-1',
        userId: 'user-1',
        query: 'test',
      });

      expect(result.results).toHaveLength(0);
    });

    it('augments FTS results with real vector scores when embedding provider is configured', async () => {
      const { prisma } = await import('@synora/database');
      const { embed } = await import('../../embeddings');
      const { queryVectors } = await import('../../vectordb');

      vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);

      vi.mocked(embed).mockResolvedValue({
        embedding: { values: [0.1, 0.2, 0.3], dimensions: 3 },
        provider: 'openai',
        model: 'text-embedding-3-small',
        usage: { totalTokens: 5 },
        cached: false,
      } as never);

      vi.mocked(queryVectors).mockResolvedValue({
        matches: [
          { id: 'conv-1-chunk-0', score: 0.92, metadata: { resourceType: 'CONVERSATION', resourceId: 'conv-1' } },
        ],
      } as never);

      vi.mocked(prisma.searchIndex.findMany).mockResolvedValue([
        {
          id: 'idx-v1',
          resourceType: 'CONVERSATION',
          resourceId: 'conv-1',
          title: 'Vector Hit',
          content: 'found via embedding similarity',
          summary: null,
          workspaceId: 'ws-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as never);

      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({ id: 'wm-1' } as never);
      vi.mocked(prisma.conversation.findUnique).mockResolvedValue({ workspaceId: 'ws-1' } as never);
      vi.mocked(prisma.searchQuery.create).mockResolvedValue({} as never);
      vi.mocked(prisma.searchSuggestion.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.searchSuggestion.create).mockResolvedValue({} as never);
      vi.mocked(prisma.searchAnalytics.findFirst).mockResolvedValue(null);

      const result = await service.hybridSearch({
        workspaceId: 'ws-1',
        userId: 'user-1',
        query: 'test',
      });

      expect(queryVectors).toHaveBeenCalledWith(
        expect.objectContaining({
          vector: [0.1, 0.2, 0.3],
          namespace: 'search',
        }),
      );
      expect(result.results.length).toBe(1);
      expect(result.results[0].score).toBe(0.46);
    });
  });

  describe('indexConversation', () => {
    it('writes to SearchIndex with isIndexed=true, not just logging', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
        id: 'conv-1',
        title: 'My Chat',
        workspaceId: 'ws-1',
        description: 'A discussion about testing',
      } as never);

      vi.mocked(prisma.searchIndex.upsert).mockResolvedValue({} as never);

      await service.indexConversation('conv-1');

      expect(prisma.searchIndex.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            workspaceId: 'ws-1',
            resourceType: 'CONVERSATION',
            resourceId: 'conv-1',
            isIndexed: true,
          }),
        }),
      );
    });

    it('throws NotFoundException for missing conversation', async () => {
      const { prisma } = await import('@synora/database');
      vi.mocked(prisma.conversation.findUnique).mockResolvedValue(null);

      await expect(service.indexConversation('missing')).rejects.toThrow(/not found/i);
    });
  });

  describe('indexMessage', () => {
    it('writes message content to SearchIndex', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.message.findUnique).mockResolvedValue({
        id: 'msg-1',
        content: 'This is a user message about testing',
        conversationId: 'conv-1',
        conversation: { workspaceId: 'ws-1' },
      } as never);

      vi.mocked(prisma.searchIndex.upsert).mockResolvedValue({} as never);

      await service.indexMessage('msg-1');

      expect(prisma.searchIndex.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            resourceType: 'MESSAGE',
            resourceId: 'msg-1',
            isIndexed: true,
            content: 'This is a user message about testing',
          }),
        }),
      );
    });
  });

  describe('deleteConversationIndex', () => {
    it('actually deletes SearchIndex rows (not a no-op)', async () => {
      const { prisma } = await import('@synora/database');
      vi.mocked(prisma.searchIndex.deleteMany).mockResolvedValue({ count: 3 } as never);
      vi.mocked(prisma.conversation.findUnique).mockResolvedValue({ workspaceId: 'ws-1' } as never);

      await service.deleteConversationIndex('conv-1');

      expect(prisma.searchIndex.deleteMany).toHaveBeenCalledWith({
        where: { resourceId: 'conv-1' },
      });
    });
  });

  describe('validation', () => {
    it('rejects queries shorter than 2 characters', async () => {
      await expect(
        service.hybridSearch({
          workspaceId: 'ws-1',
          userId: 'user-1',
          query: 'a',
        }),
      ).rejects.toThrow(/at least 2/);
    });
  });
});
