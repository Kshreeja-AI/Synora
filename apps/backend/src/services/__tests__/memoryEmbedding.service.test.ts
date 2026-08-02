import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  MemoryEmbeddingService,
  configureMemoryEmbeddings,
  resetMemoryEmbeddings,
  isSemanticSearchAvailable,
  type IEmbeddingModel,
  type IVectorDB,
} from '../memoryEmbedding.service'

/**
 * The property these tests exist to protect: with no embedding provider
 * configured (Synora's actual state today), the memory subsystem must
 * never invent a similarity score or claim a memory is indexed. An
 * earlier implementation hashed text through Math.sin and served the
 * cosine distances as semantic relevance; these tests make that class
 * of fake impossible to reintroduce silently.
 */

vi.mock('@synora/database', () => ({
  prisma: {
    memory: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}))

const memoryFixture = {
  id: 'mem-1',
  workspaceId: 'ws-1',
  conversationId: null,
  userId: 'u-1',
  content: 'The deploy runbook lives in docs/deployment.md',
  summary: null,
  type: 'FACT',
  category: 'process',
  importance: 0.6,
  tags: ['deploy'],
  createdAt: new Date('2026-07-01T00:00:00Z'),
  embeddingId: null,
  embeddingModel: null,
  embeddingVersion: 0,
  embeddingRefreshNeeded: false,
}

describe('MemoryEmbeddingService (no provider configured)', () => {
  let service: MemoryEmbeddingService

  beforeEach(() => {
    vi.clearAllMocks()
    resetMemoryEmbeddings()
    service = new MemoryEmbeddingService()
  })

  it('reports semantic search as unavailable', () => {
    expect(isSemanticSearchAvailable()).toBe(false)
  })

  it('throws a 503 from semanticSearch rather than returning empty results', async () => {
    await expect(service.semanticSearch('deploy', 'ws-1')).rejects.toMatchObject({
      statusCode: 503,
    })
  })

  it('refuses to generate an embedding instead of synthesizing a vector', async () => {
    await expect(service.generateEmbedding('anything')).rejects.toMatchObject({
      statusCode: 503,
    })
  })

  it('skips indexing without writing embedding columns', async () => {
    const { prisma } = await import('@synora/database')

    const result = await service.indexMemory(memoryFixture as never)

    expect(result.status).toBe('skipped')
    expect(vi.mocked(prisma.memory.update)).not.toHaveBeenCalled()
  })

  it('reports batch indexing as skipped, not as zero successful work', async () => {
    const result = await service.batchIndexMemories(['mem-1'])
    expect(result).toEqual({ indexed: 0, failed: 0, skipped: true })
  })

  it('refreshes nothing and touches no rows', async () => {
    const { prisma } = await import('@synora/database')

    await expect(service.refreshPendingEmbeddings('ws-1')).resolves.toBe(0)
    expect(vi.mocked(prisma.memory.findMany)).not.toHaveBeenCalled()
  })

  it('flags stats so zero-indexed reads as "disabled", not "nothing stored"', async () => {
    const { prisma } = await import('@synora/database')
    vi.mocked(prisma.memory.findMany).mockResolvedValueOnce([] as never)

    const stats = await service.getEmbeddingStats('ws-1')

    expect(stats.semanticSearchEnabled).toBe(false)
    expect(stats.indexed).toBe(0)
  })
})

describe('MemoryEmbeddingService (provider configured)', () => {
  let service: MemoryEmbeddingService
  let embeddings: IEmbeddingModel
  let vectorDB: IVectorDB

  beforeEach(() => {
    vi.clearAllMocks()
    service = new MemoryEmbeddingService()

    embeddings = {
      model: 'text-embedding-3-small',
      embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    }
    vectorDB = {
      upsert: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([{ id: 'memory_mem-1', score: 0.87 }]),
    }
    configureMemoryEmbeddings({ embeddings, vectorDB })
  })

  afterEach(() => {
    resetMemoryEmbeddings()
  })

  it('reports availability once providers are registered', () => {
    expect(isSemanticSearchAvailable()).toBe(true)
  })

  it('indexes through the real providers and records the real model name', async () => {
    const { prisma } = await import('@synora/database')
    vi.mocked(prisma.memory.update).mockResolvedValue({} as never)

    const result = await service.indexMemory(memoryFixture as never)

    expect(result.status).toBe('indexed')
    expect(embeddings.embed).toHaveBeenCalledWith(memoryFixture.content)
    expect(vectorDB.upsert).toHaveBeenCalledWith(
      'memory_mem-1',
      [0.1, 0.2, 0.3],
      expect.objectContaining({ memoryId: 'mem-1', workspaceId: 'ws-1' }),
    )
    expect(vi.mocked(prisma.memory.update).mock.calls[0][0].data).toMatchObject({
      embeddingId: 'memory_mem-1',
      embeddingModel: 'text-embedding-3-small',
    })
  })

  it('returns provider scores from semanticSearch', async () => {
    const { prisma } = await import('@synora/database')
    vi.mocked(prisma.memory.findMany).mockResolvedValueOnce([memoryFixture] as never)

    const results = await service.semanticSearch('deploy runbook', 'ws-1')

    expect(vectorDB.query).toHaveBeenCalledWith([0.1, 0.2, 0.3], 10, 'ws-1')
    expect(results).toHaveLength(1)
    expect(results[0].score).toBe(0.87)
  })
})
