import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MemoryRetrievalService } from '../memoryRetrieval.service'
import {
  configureMemoryEmbeddings,
  resetMemoryEmbeddings,
  memoryEmbeddingService,
} from '../memoryEmbedding.service'

/**
 * Retrieval must stay useful — and honest — when semantic search is
 * unavailable: candidates come from real lexical matching over stored
 * content, the semantic signal is dropped from the weighting rather
 * than contributing a fabricated or uniformly-zero score, and results
 * declare which signals actually ran.
 */

vi.mock('@synora/database', () => ({
  prisma: {
    memory: {
      findMany: vi.fn(),
    },
    conversation: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('../memoryCache.service', () => ({
  memoryCacheService: {
    recordMemoryAccess: vi.fn(),
  },
}))

function memory(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-1',
    workspaceId: 'ws-1',
    userId: 'u-1',
    content: 'The deploy runbook lives in docs/deployment.md',
    summary: null,
    tags: ['deploy'],
    type: 'FACT',
    category: 'process',
    permission: 'WORKSPACE',
    importance: 0.5,
    accessCount: 0,
    isPinned: false,
    sharedWith: [],
    createdAt: new Date(),
    ...overrides,
  }
}

describe('MemoryRetrievalService without a semantic provider', () => {
  let service: MemoryRetrievalService

  beforeEach(() => {
    vi.clearAllMocks()
    resetMemoryEmbeddings()
    service = new MemoryRetrievalService()
  })

  it('does not call semantic search at all', async () => {
    const { prisma } = await import('@synora/database')
    vi.mocked(prisma.memory.findMany).mockResolvedValue([memory()] as never)
    const spy = vi.spyOn(memoryEmbeddingService, 'semanticSearch')

    await service.retrieveMemories({ query: 'deploy runbook', workspaceId: 'ws-1', userId: 'u-1' })

    expect(spy).not.toHaveBeenCalled()
  })

  it('marks results as not having used semantic search', async () => {
    const { prisma } = await import('@synora/database')
    vi.mocked(prisma.memory.findMany).mockResolvedValue([memory()] as never)

    const results = await service.retrieveMemories({
      query: 'deploy runbook',
      workspaceId: 'ws-1',
      userId: 'u-1',
    })

    expect(results[0].rankingDetails.semanticSearchUsed).toBe(false)
    expect(results[0].rankingDetails.semanticScore).toBe(0)
  })

  it('scores lexical overlap from the memory text, not a guess', async () => {
    const { prisma } = await import('@synora/database')
    vi.mocked(prisma.memory.findMany).mockResolvedValue([
      memory({ id: 'both', content: 'deploy runbook for production' }),
      memory({ id: 'one', content: 'deploy notes', tags: [] }),
    ] as never)

    const results = await service.retrieveMemories({
      query: 'deploy runbook',
      workspaceId: 'ws-1',
      userId: 'u-1',
    })

    const both = results.find((r) => r.memory.id === 'both')!
    const one = results.find((r) => r.memory.id === 'one')!
    expect(both.rankingDetails.lexicalScore).toBe(1)
    expect(one.rankingDetails.lexicalScore).toBe(0.5)
    expect(both.relevanceScore).toBeGreaterThan(one.relevanceScore)
  })

  it('keeps overall scores on a 0-1 scale by renormalizing the dropped weight', async () => {
    const { prisma } = await import('@synora/database')
    vi.mocked(prisma.memory.findMany).mockResolvedValue([
      memory({ importance: 1, accessCount: 1000, content: 'deploy runbook' }),
    ] as never)

    const results = await service.retrieveMemories({
      query: 'deploy runbook',
      workspaceId: 'ws-1',
      userId: 'u-1',
    })

    expect(results[0].relevanceScore).toBeGreaterThan(0.8)
    expect(results[0].relevanceScore).toBeLessThanOrEqual(1)
  })

  it('queries every term, not just the first', async () => {
    const { prisma } = await import('@synora/database')
    vi.mocked(prisma.memory.findMany).mockResolvedValue([] as never)

    await service.retrieveMemories({
      query: 'docker compose config',
      workspaceId: 'ws-1',
      userId: 'u-1',
    })

    const where = vi.mocked(prisma.memory.findMany).mock.calls[0][0]!.where as {
      OR: Array<Record<string, unknown>>
    }
    const serialized = JSON.stringify(where.OR)
    expect(serialized).toContain('docker')
    expect(serialized).toContain('compose')
    expect(serialized).toContain('config')
  })
})

describe('MemoryRetrievalService with a semantic provider', () => {
  let service: MemoryRetrievalService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new MemoryRetrievalService()
    configureMemoryEmbeddings({
      embeddings: { model: 'text-embedding-3-small', embed: vi.fn().mockResolvedValue([0.1]) },
      vectorDB: {
        upsert: vi.fn(),
        delete: vi.fn(),
        query: vi.fn().mockResolvedValue([]),
      },
    })
  })

  afterEach(() => {
    resetMemoryEmbeddings()
  })

  it('uses the semantic signal and reports it', async () => {
    const { prisma } = await import('@synora/database')
    vi.mocked(prisma.memory.findMany).mockResolvedValue([memory()] as never)
    vi.spyOn(memoryEmbeddingService, 'semanticSearch').mockResolvedValue([
      { memoryId: 'mem-1', memory: memory() as never, score: 0.9 },
    ])

    const results = await service.retrieveMemories({
      query: 'deploy runbook',
      workspaceId: 'ws-1',
      userId: 'u-1',
    })

    expect(results[0].rankingDetails.semanticSearchUsed).toBe(true)
    expect(results[0].rankingDetails.semanticScore).toBe(0.9)
  })
})
