import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryEmbeddingService, getSemanticSearchAvailability } from '../memoryEmbedding.service'
import { embed, EMBEDDING_PROVIDER_REGISTRY } from '../../embeddings'
import { upsertVectors, queryVectors, VECTORDB_PROVIDER_REGISTRY } from '../../vectordb'

/**
 * The memory subsystem must never invent a similarity score or claim a
 * memory is indexed. An earlier implementation hashed text through
 * Math.sin and served the cosine distances as semantic relevance; these
 * tests make that class of fake impossible to reintroduce, and pin that
 * embedding/vector work is delegated to the shared provider-agnostic
 * subsystems rather than reimplemented here.
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

vi.mock('../../embeddings', () => ({
  embed: vi.fn(),
  EMBEDDING_PROVIDER_REGISTRY: [{ id: 'openai', isConfigured: vi.fn() }],
}))

vi.mock('../../vectordb', () => ({
  upsertVectors: vi.fn(),
  queryVectors: vi.fn(),
  deleteVectors: vi.fn(),
  VECTORDB_PROVIDER_REGISTRY: [{ id: 'pgvector', isConfigured: vi.fn() }],
}))

const embeddingDescriptor = EMBEDDING_PROVIDER_REGISTRY[0] as unknown as {
  isConfigured: ReturnType<typeof vi.fn>
}
const vectorDescriptor = VECTORDB_PROVIDER_REGISTRY[0] as unknown as {
  isConfigured: ReturnType<typeof vi.fn>
}

function setAvailability(embedding: boolean, vector: boolean): void {
  embeddingDescriptor.isConfigured.mockResolvedValue(embedding)
  vectorDescriptor.isConfigured.mockResolvedValue(vector)
}

const memoryFixture = {
  id: 'mem-1',
  workspaceId: 'ws-1',
  conversationId: null,
  userId: 'u-1',
  content: 'The deploy runbook lives in docs/deployment.md',
  summary: null,
  type: 'FACT',
  category: 'process',
  permission: 'WORKSPACE',
  importance: 0.6,
  tags: ['deploy'],
  createdAt: new Date('2026-07-01T00:00:00Z'),
  embeddingId: null,
  embeddingModel: null,
  embeddingVersion: 0,
  embeddingRefreshNeeded: false,
}

describe('MemoryEmbeddingService without configured providers', () => {
  let service: MemoryEmbeddingService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new MemoryEmbeddingService()
    setAvailability(false, false)
  })

  it('reports semantic search unavailable, naming what is missing', async () => {
    const availability = await getSemanticSearchAvailability()

    expect(availability.available).toBe(false)
    expect(availability.embeddingProvider).toBeNull()
    expect(availability.vectorDatabase).toBeNull()
    expect(availability.reason).toContain('embedding provider')
    expect(availability.reason).toContain('vector database')
  })

  it('throws a 503 from semanticSearch rather than returning empty results', async () => {
    await expect(service.semanticSearch('deploy', 'ws-1')).rejects.toMatchObject({
      statusCode: 503,
    })
    expect(vi.mocked(embed)).not.toHaveBeenCalled()
  })

  it('refuses to generate an embedding instead of synthesizing a vector', async () => {
    await expect(service.generateEmbedding('anything', 'ws-1')).rejects.toMatchObject({
      statusCode: 503,
    })
  })

  it('skips indexing without writing embedding columns', async () => {
    const { prisma } = await import('@synora/database')

    const result = await service.indexMemory(memoryFixture as never)

    expect(result.status).toBe('skipped')
    expect(vi.mocked(upsertVectors)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.memory.update)).not.toHaveBeenCalled()
  })

  it('reports batch indexing as skipped, not as zero successful work', async () => {
    const result = await service.batchIndexMemories(['mem-1'])
    expect(result).toEqual({ indexed: 0, failed: 0, skipped: true })
  })

  it('stays unavailable when only the embedding half is configured', async () => {
    setAvailability(true, false)

    const availability = await getSemanticSearchAvailability()

    expect(availability.available).toBe(false)
    expect(availability.embeddingProvider).toBe('openai')
    expect(availability.reason).toContain('vector database')
  })

  it('stays unavailable when only the vector database is configured', async () => {
    setAvailability(false, true)

    const availability = await getSemanticSearchAvailability()

    expect(availability.available).toBe(false)
    expect(availability.vectorDatabase).toBe('pgvector')
    expect(availability.reason).toContain('embedding provider')
  })
})

describe('MemoryEmbeddingService with configured providers', () => {
  let service: MemoryEmbeddingService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new MemoryEmbeddingService()
    setAvailability(true, true)
    vi.mocked(embed).mockResolvedValue({
      embedding: { values: [0.1, 0.2, 0.3], dimensions: 3 },
      provider: 'openai',
      model: 'text-embedding-3-small',
      usage: { inputTokens: 8, totalTokens: 8 },
      cached: false,
    } as never)
  })

  it('activates automatically once both halves are configured', async () => {
    const availability = await getSemanticSearchAvailability()

    expect(availability.available).toBe(true)
    expect(availability.embeddingProvider).toBe('openai')
    expect(availability.vectorDatabase).toBe('pgvector')
    expect(availability.reason).toBeUndefined()
  })

  it('indexes through the shared subsystems and records the real model name', async () => {
    const { prisma } = await import('@synora/database')
    vi.mocked(prisma.memory.update).mockResolvedValue({} as never)

    const result = await service.indexMemory(memoryFixture as never)

    expect(result.status).toBe('indexed')
    expect(vi.mocked(embed)).toHaveBeenCalledWith(memoryFixture.content, { workspaceId: 'ws-1' })
    expect(vi.mocked(upsertVectors)).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 'memory_mem-1',
          values: [0.1, 0.2, 0.3],
          metadata: expect.objectContaining({ memoryId: 'mem-1', workspaceId: 'ws-1' }),
        }),
      ],
      { workspaceId: 'ws-1', namespace: 'memories' }
    )
    expect(vi.mocked(prisma.memory.update).mock.calls[0][0].data).toMatchObject({
      embeddingId: 'memory_mem-1',
      embeddingModel: 'text-embedding-3-small',
    })
  })

  it('returns provider scores from semanticSearch, re-reading rows from Postgres', async () => {
    const { prisma } = await import('@synora/database')
    vi.mocked(queryVectors).mockResolvedValue({
      matches: [{ id: 'memory_mem-1', score: 0.87 }],
    } as never)
    vi.mocked(prisma.memory.findMany).mockResolvedValueOnce([memoryFixture] as never)

    const results = await service.semanticSearch('deploy runbook', 'ws-1')

    expect(vi.mocked(queryVectors)).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        namespace: 'memories',
        vector: [0.1, 0.2, 0.3],
        topK: 10,
      })
    )
    expect(results).toHaveLength(1)
    expect(results[0].score).toBe(0.87)
  })

  it('re-scopes vector hits to the workspace so a stale vector cannot leak content', async () => {
    const { prisma } = await import('@synora/database')
    vi.mocked(queryVectors).mockResolvedValue({
      matches: [{ id: 'memory_foreign', score: 0.99 }],
    } as never)
    // Postgres returns nothing for that id within this workspace.
    vi.mocked(prisma.memory.findMany).mockResolvedValueOnce([] as never)

    const results = await service.semanticSearch('deploy', 'ws-1')

    expect(results).toEqual([])
    expect(vi.mocked(prisma.memory.findMany).mock.calls[0][0]!.where).toMatchObject({
      workspaceId: 'ws-1',
    })
  })

  it('reports enabled stats with the active provider names', async () => {
    const { prisma } = await import('@synora/database')
    vi.mocked(prisma.memory.findMany).mockResolvedValueOnce([] as never)

    const stats = await service.getEmbeddingStats('ws-1')

    expect(stats.semanticSearchEnabled).toBe(true)
    expect(stats.embeddingProvider).toBe('openai')
    expect(stats.vectorDatabase).toBe('pgvector')
  })
})
