import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryDeduplicationService } from '../memoryDeduplication.service'
import { NotFoundException } from '@synora/shared'
import type { Memory } from '@synora/database'

vi.mock('@synora/database', () => ({
  prisma: {
    memory: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

vi.mock('../memoryEmbedding.service', () => ({
  memoryEmbeddingService: {
    deleteEmbedding: vi.fn(),
  },
}))

vi.mock('../memoryRetrieval.service', () => ({
  memoryRetrievalService: {
    findSimilarMemories: vi.fn(),
  },
}))

vi.mock('../memoryCache.service', () => ({
  memoryCacheService: {
    invalidateMemory: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'm1',
    workspaceId: 'ws-1',
    conversationId: null,
    userId: 'u1',
    content: 'The meeting is scheduled for Tuesday at 3pm',
    summary: null,
    type: 'SEMANTIC',
    category: null,
    tags: [],
    importance: 0.5,
    decayRate: 0.01,
    lastAccessedAt: null,
    accessCount: 0,
    isArchived: false,
    isPinned: false,
    isManual: true,
    status: 'ACTIVE',
    permission: 'PRIVATE',
    sharedWith: [],
    version: 1,
    parentId: null,
    embeddingId: null,
    embeddingModel: null,
    embeddingVersion: 0,
    embeddingRefreshNeeded: false,
    isEncrypted: false,
    encryptionKey: null,
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Memory
}

describe('MemoryDeduplicationService', () => {
  let service: MemoryDeduplicationService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new MemoryDeduplicationService()
  })

  describe('findDuplicateClusters', () => {
    it('returns no clusters when fewer than 2 memories exist', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.findMany).mockResolvedValue([makeMemory()] as never)

      const clusters = await service.findDuplicateClusters('ws-1')
      expect(clusters).toEqual([])
    })

    it('detects near-identical text as a duplicate cluster via real Levenshtein similarity', async () => {
      const { prisma } = await import('@synora/database')
      const a = makeMemory({ id: 'a', content: 'The meeting is scheduled for Tuesday at 3pm' })
      const b = makeMemory({ id: 'b', content: 'The meeting is scheduled for Tuesday at 3pm.' })
      vi.mocked(prisma.memory.findMany).mockResolvedValue([a, b] as never)

      const clusters = await service.findDuplicateClusters('ws-1')

      expect(clusters).toHaveLength(1)
      expect(clusters[0].duplicates[0].memory.id).toBe('b')
    })

    it('does not cluster genuinely different content', async () => {
      const { prisma } = await import('@synora/database')
      const a = makeMemory({ id: 'a', content: 'The meeting is scheduled for Tuesday at 3pm' })
      const b = makeMemory({ id: 'b', content: 'Remember to buy groceries for the weekend trip' })
      vi.mocked(prisma.memory.findMany).mockResolvedValue([a, b] as never)

      const clusters = await service.findDuplicateClusters('ws-1')
      expect(clusters).toEqual([])
    })

    it('only trusts semantic similarity when both memories actually have embeddings', async () => {
      const { prisma } = await import('@synora/database')
      const { memoryRetrievalService } = await import('../memoryRetrieval.service')
      const a = makeMemory({ id: 'a', content: 'text one', embeddingId: 'emb-a' })
      const b = makeMemory({ id: 'b', content: 'text two, totally different', embeddingId: null })
      vi.mocked(prisma.memory.findMany).mockResolvedValue([a, b] as never)
      // Even if the retrieval service reports a's neighbors, b has no
      // embedding, so semantic similarity must not be trusted for the pair.
      vi.mocked(memoryRetrievalService.findSimilarMemories).mockResolvedValue([
        { memory: b, similarity: 0.99 },
      ] as never)

      const clusters = await service.findDuplicateClusters('ws-1', { semanticThreshold: 0.5 })
      expect(clusters).toEqual([])
    })
  })

  describe('mergeDuplicates', () => {
    it('throws NotFoundException when the primary memory does not exist', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.findUnique).mockResolvedValue(null)

      await expect(service.mergeDuplicates('missing', ['d1'])).rejects.toThrow(NotFoundException)
    })

    it('keeps the primary by default, combines tags from all merged memories', async () => {
      const { prisma } = await import('@synora/database')
      const primary = makeMemory({ id: 'p', tags: ['a'], importance: 0.5 })
      const dup = makeMemory({ id: 'd', tags: ['b'], importance: 0.9 })
      vi.mocked(prisma.memory.findUnique).mockResolvedValue(primary as never)
      vi.mocked(prisma.memory.findMany).mockResolvedValue([dup] as never)
      vi.mocked(prisma.memory.update).mockResolvedValue({ ...primary, tags: ['a', 'b'] } as never)
      vi.mocked(prisma.memory.updateMany).mockResolvedValue({ count: 1 } as never)

      await service.mergeDuplicates('p', ['d'])

      expect(prisma.memory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p' },
          data: expect.objectContaining({ tags: expect.arrayContaining(['a', 'b']) }),
        }),
      )
    })

    it('switches the kept memory to the newest under the "newest" strategy', async () => {
      const { prisma } = await import('@synora/database')
      const older = makeMemory({ id: 'p', createdAt: new Date('2026-01-01') })
      const newer = makeMemory({ id: 'd', createdAt: new Date('2026-06-01') })
      vi.mocked(prisma.memory.findUnique).mockResolvedValue(older as never)
      vi.mocked(prisma.memory.findMany).mockResolvedValue([newer] as never)
      vi.mocked(prisma.memory.update).mockResolvedValue(newer as never)
      vi.mocked(prisma.memory.updateMany).mockResolvedValue({ count: 1 } as never)

      await service.mergeDuplicates('p', ['d'], { mergeStrategy: 'newest' })

      expect(prisma.memory.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'd' } }),
      )
    })

    it('marks duplicates as CONSOLIDATING and invalidates cache for every merged memory', async () => {
      const { prisma } = await import('@synora/database')
      const { memoryCacheService } = await import('../memoryCache.service')
      const primary = makeMemory({ id: 'p' })
      const dup = makeMemory({ id: 'd' })
      vi.mocked(prisma.memory.findUnique).mockResolvedValue(primary as never)
      vi.mocked(prisma.memory.findMany).mockResolvedValue([dup] as never)
      vi.mocked(prisma.memory.update).mockResolvedValue(primary as never)
      vi.mocked(prisma.memory.updateMany).mockResolvedValue({ count: 1 } as never)

      await service.mergeDuplicates('p', ['d'])

      expect(prisma.memory.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['d'] } },
          data: expect.objectContaining({ status: 'CONSOLIDATING' }),
        }),
      )
      expect(memoryCacheService.invalidateMemory).toHaveBeenCalledWith('p')
      expect(memoryCacheService.invalidateMemory).toHaveBeenCalledWith('d')
    })

    it('deletes embeddings only for duplicates that actually had one', async () => {
      const { prisma } = await import('@synora/database')
      const { memoryEmbeddingService } = await import('../memoryEmbedding.service')
      const primary = makeMemory({ id: 'p' })
      const dupWithEmbedding = makeMemory({ id: 'd1', embeddingId: 'emb-1' })
      const dupWithoutEmbedding = makeMemory({ id: 'd2', embeddingId: null })
      vi.mocked(prisma.memory.findUnique).mockResolvedValue(primary as never)
      vi.mocked(prisma.memory.findMany).mockResolvedValue([dupWithEmbedding, dupWithoutEmbedding] as never)
      vi.mocked(prisma.memory.update).mockResolvedValue(primary as never)
      vi.mocked(prisma.memory.updateMany).mockResolvedValue({ count: 2 } as never)

      await service.mergeDuplicates('p', ['d1', 'd2'])

      expect(memoryEmbeddingService.deleteEmbedding).toHaveBeenCalledTimes(1)
      expect(memoryEmbeddingService.deleteEmbedding).toHaveBeenCalledWith('d1')
    })
  })

  describe('deduplicateWorkspace', () => {
    it('isolates a failed cluster merge, continuing with the rest', async () => {
      const findClustersSpy = vi.spyOn(service, 'findDuplicateClusters').mockResolvedValue([
        { primary: makeMemory({ id: 'p1' }), duplicates: [{ memory: makeMemory({ id: 'd1' }), similarity: 0.9 }] },
        { primary: makeMemory({ id: 'p2' }), duplicates: [{ memory: makeMemory({ id: 'd2' }), similarity: 0.9 }] },
      ])
      const mergeSpy = vi
        .spyOn(service, 'mergeDuplicates')
        .mockRejectedValueOnce(new Error('merge failed'))
        .mockResolvedValueOnce(makeMemory({ id: 'p2' }))

      const result = await service.deduplicateWorkspace('ws-1')

      expect(result.clustersFound).toBe(2)
      expect(result.memoriesMerged).toBe(1)
      expect(result.duplicatesRemoved).toBe(1)

      findClustersSpy.mockRestore()
      mergeSpy.mockRestore()
    })
  })

  describe('findPotentialDuplicates', () => {
    it('throws NotFoundException for a missing memory', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.findUnique).mockResolvedValue(null)

      await expect(service.findPotentialDuplicates('missing')).rejects.toThrow(NotFoundException)
    })

    it('delegates to the real retrieval service for similarity search', async () => {
      const { prisma } = await import('@synora/database')
      const { memoryRetrievalService } = await import('../memoryRetrieval.service')
      vi.mocked(prisma.memory.findUnique).mockResolvedValue(makeMemory() as never)
      vi.mocked(memoryRetrievalService.findSimilarMemories).mockResolvedValue([
        { memory: makeMemory({ id: 'x' }), similarity: 0.85 },
      ] as never)

      const result = await service.findPotentialDuplicates('m1', 0.8)

      expect(memoryRetrievalService.findSimilarMemories).toHaveBeenCalledWith('m1', 0.8)
      expect(result).toHaveLength(1)
    })
  })

  describe('getDeduplicationStats', () => {
    it('reports real total/consolidated counts and never fabricates duplicate estimates', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.count).mockResolvedValueOnce(50).mockResolvedValueOnce(3)

      const stats = await service.getDeduplicationStats('ws-1')

      expect(stats.totalMemories).toBe(50)
      expect(stats.consolidatedMemories).toBe(3)
      // No embedding/text-similarity scan has run here, so these must be 0,
      // not a guessed percentage of totalMemories.
      expect(stats.potentialDuplicates).toBe(0)
      expect(stats.estimatedReduction).toBe(0)
    })
  })
})
