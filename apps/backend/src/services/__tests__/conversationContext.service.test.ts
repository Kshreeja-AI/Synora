import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ConversationContextService } from '../conversationContext.service'

vi.mock('@synora/database', () => ({
  prisma: {
    conversation: { findUnique: vi.fn(), count: vi.fn() },
    memory: { aggregate: vi.fn() },
  },
}))

vi.mock('../memoryRetrieval.service', () => ({
  memoryRetrievalService: {
    retrieveMemories: vi.fn(),
  },
}))

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

describe('ConversationContextService', () => {
  let service: ConversationContextService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ConversationContextService()
  })

  describe('buildContext', () => {
    it('returns an empty fallback context for a non-existent conversation', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.conversation.findUnique).mockResolvedValue(null)

      const context = await service.buildContext({
        conversationId: 'missing',
        userId: 'u1',
        workspaceId: 'ws-1',
      })

      expect(context.relevantMemories).toEqual([])
      expect(context.metadata.context).toBe('No previous context')
    })

    it('builds real conversation history from actual messages, in order', async () => {
      const { prisma } = await import('@synora/database')
      const { memoryRetrievalService } = await import('../memoryRetrieval.service')
      vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
        id: 'c1',
        title: 'Planning',
        messages: [
          { role: 'USER', content: 'Hello' },
          { role: 'ASSISTANT', content: 'Hi there' },
        ],
      } as never)
      vi.mocked(memoryRetrievalService.retrieveMemories).mockResolvedValue([])

      const context = await service.buildContext({
        conversationId: 'c1',
        userId: 'u1',
        workspaceId: 'ws-1',
      })

      expect(context.conversationHistory).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ])
    })

    it('includes real retrieved memories in the system prompt, respecting the token budget', async () => {
      const { prisma } = await import('@synora/database')
      const { memoryRetrievalService } = await import('../memoryRetrieval.service')
      vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
        id: 'c1',
        title: 'Planning',
        messages: [{ role: 'USER', content: 'What did we decide?' }],
      } as never)
      vi.mocked(memoryRetrievalService.retrieveMemories).mockResolvedValue([
        {
          memory: { id: 'm1', content: 'We decided to launch in March', category: 'decision', importance: 0.8 },
          relevanceScore: 0.9,
        },
      ] as never)

      const context = await service.buildContext({
        conversationId: 'c1',
        userId: 'u1',
        workspaceId: 'ws-1',
      })

      expect(context.relevantMemories).toHaveLength(1)
      expect(context.relevantMemories[0].content).toBe('We decided to launch in March')
      expect(context.systemPrompt).toContain('We decided to launch in March')
      expect(context.metadata.memoriesInContext).toBe(1)
      expect(context.metadata.tokensUsed).toBeGreaterThan(0)
    })

    it('stops including memories once the token budget is exhausted', async () => {
      const { prisma } = await import('@synora/database')
      const { memoryRetrievalService } = await import('../memoryRetrieval.service')
      vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
        id: 'c1',
        title: 'Planning',
        messages: [{ role: 'USER', content: 'context' }],
      } as never)

      const longContent = 'word '.repeat(200) // ~50 tokens at the 4-words-per-token estimate
      vi.mocked(memoryRetrievalService.retrieveMemories).mockResolvedValue([
        { memory: { id: 'm1', content: longContent, category: null, importance: 0.5 }, relevanceScore: 0.9 },
        { memory: { id: 'm2', content: longContent, category: null, importance: 0.5 }, relevanceScore: 0.9 },
        { memory: { id: 'm3', content: longContent, category: null, importance: 0.5 }, relevanceScore: 0.9 },
      ] as never)

      const context = await service.buildContext(
        { conversationId: 'c1', userId: 'u1', workspaceId: 'ws-1' },
        { tokenBudget: 60 },
      )

      // Each memory costs ~50 tokens, so only one fits in a 60-token budget.
      expect(context.relevantMemories.length).toBeLessThan(3)
    })

    it('degrades to an empty context (not a thrown error) when memory retrieval fails', async () => {
      const { prisma } = await import('@synora/database')
      const { memoryRetrievalService } = await import('../memoryRetrieval.service')
      vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
        id: 'c1',
        title: 'Planning',
        messages: [],
      } as never)
      vi.mocked(memoryRetrievalService.retrieveMemories).mockRejectedValue(new Error('retrieval down'))

      const context = await service.buildContext({
        conversationId: 'c1',
        userId: 'u1',
        workspaceId: 'ws-1',
      })

      expect(context.relevantMemories).toEqual([])
    })
  })

  describe('formatForAI', () => {
    it('renders the system prompt and conversation history as a single string', () => {
      const formatted = service.formatForAI({
        conversationId: 'c1',
        relevantMemories: [],
        conversationHistory: [{ role: 'user', content: 'hi' }],
        systemPrompt: 'You are helpful.',
        metadata: { memoriesInContext: 0, tokensUsed: 0, context: '' },
      })

      expect(formatted).toContain('You are helpful.')
      expect(formatted).toContain('USER: hi')
    })
  })

  describe('validateContext', () => {
    it('flags a context with no conversation history', () => {
      const result = service.validateContext({
        conversationId: 'c1',
        relevantMemories: [],
        conversationHistory: [],
        systemPrompt: 'ok',
        metadata: { memoriesInContext: 0, tokensUsed: 0, context: '' },
      })

      expect(result.valid).toBe(false)
      expect(result.issues).toContain('No conversation history')
    })

    it('flags a context that exceeds the token limit', () => {
      const result = service.validateContext({
        conversationId: 'c1',
        relevantMemories: [],
        conversationHistory: [{ role: 'user', content: 'hi' }],
        systemPrompt: 'ok',
        metadata: { memoriesInContext: 0, tokensUsed: 5000, context: '' },
      })

      expect(result.issues).toContain('Context exceeds recommended token limit')
    })

    it('passes a well-formed context', () => {
      const result = service.validateContext({
        conversationId: 'c1',
        relevantMemories: [],
        conversationHistory: [{ role: 'user', content: 'hi' }],
        systemPrompt: 'ok',
        metadata: { memoriesInContext: 0, tokensUsed: 10, context: '' },
      })

      expect(result.valid).toBe(true)
      expect(result.issues).toEqual([])
    })
  })

  describe('getContextStats', () => {
    it('computes a real average from actual memory and conversation counts', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.aggregate).mockResolvedValue({
        _count: { id: 20 },
        _avg: { importance: 0.5 },
      } as never)
      vi.mocked(prisma.conversation.count).mockResolvedValue(4)

      const stats = await service.getContextStats('ws-1')

      expect(stats.avgMemoriesPerContext).toBe(5) // 20 memories / 4 conversations
    })

    it('returns 0 (not a fixed placeholder like 3.5) when there are no conversations yet', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.aggregate).mockResolvedValue({
        _count: { id: 0 },
        _avg: { importance: null },
      } as never)
      vi.mocked(prisma.conversation.count).mockResolvedValue(0)

      const stats = await service.getContextStats('ws-1')

      expect(stats.avgMemoriesPerContext).toBe(0)
    })

    it('degrades to all zeros (not a thrown error) when the database query fails', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.aggregate).mockRejectedValue(new Error('db down'))

      const stats = await service.getContextStats('ws-1')

      expect(stats).toEqual({ avgMemoriesPerContext: 0, avgTokensPerContext: 0, cacheHitRate: 0 })
    })
  })
})
