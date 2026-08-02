import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryRetrievalService } from '../memoryRetrieval.service'
import { memoryEmbeddingService, isSemanticSearchAvailable } from '../memoryEmbedding.service'

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

vi.mock('../memoryEmbedding.service', () => ({
  isSemanticSearchAvailable: vi.fn(),
  memoryEmbeddingService: {
    semanticSearch: vi.fn(),
  },
}))

const availabilityMock = vi.mocked(isSemanticSearchAvailable)
const semanticSearchMock = vi.mocked(memoryEmbeddingService.semanticSearch)

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
    availabilityMock.mockResolvedValue(false)
    service = new MemoryRetrievalService()
  })

  it('does not call semantic search at all', async () => {
    const { prisma } = await import('@synora/database')
    vi.mocked(prisma.memory.findMany).mockResolvedValue([memory()] as never)

    await service.retrieveMemories({ query: 'deploy runbook', workspaceId: 'ws-1', userId: 'u-1' })

    expect(semanticSearchMock).not.toHaveBeenCalled()
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
    availabilityMock.mockResolvedValue(true)
    service = new MemoryRetrievalService()
  })

  it('uses the semantic signal and reports it', async () => {
    const { prisma } = await import('@synora/database')
    vi.mocked(prisma.memory.findMany).mockResolvedValue([memory()] as never)
    semanticSearchMock.mockResolvedValue([
      { memoryId: 'mem-1', memory: memory() as never, score: 0.9 },
    ])

    const results = await service.retrieveMemories({
      query: 'deploy runbook',
      workspaceId: 'ws-1',
      userId: 'u-1',
    })

    expect(semanticSearchMock).toHaveBeenCalled()
    expect(results[0].rankingDetails.semanticSearchUsed).toBe(true)
    expect(results[0].rankingDetails.semanticScore).toBe(0.9)
  })

  it('still ranks on lexical overlap alongside the semantic signal', async () => {
    const { prisma } = await import('@synora/database')
    vi.mocked(prisma.memory.findMany).mockResolvedValue([
      memory({ id: 'mem-1', content: 'deploy runbook' }),
    ] as never)
    semanticSearchMock.mockResolvedValue([
      { memoryId: 'mem-1', memory: memory() as never, score: 0.5 },
    ])

    const results = await service.retrieveMemories({
      query: 'deploy runbook',
      workspaceId: 'ws-1',
      userId: 'u-1',
    })

    expect(results[0].rankingDetails.lexicalScore).toBe(1)
    expect(results[0].rankingDetails.semanticScore).toBe(0.5)
  })
})
