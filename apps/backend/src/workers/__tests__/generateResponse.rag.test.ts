import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../services/conversationContext.service', () => ({
  conversationContextService: { buildContext: vi.fn() },
}))

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// The worker module opens a Redis connection and resolves streaming providers
// at import time; neither is needed to exercise the retrieval step.
vi.mock('ioredis', () => ({
  Redis: vi.fn(() => ({ duplicate: vi.fn(), subscribe: vi.fn(), on: vi.fn(), publish: vi.fn() })),
}))

const PARAMS = {
  jobId: 'job-1',
  conversationId: 'conv-1',
  userId: 'user-1',
  workspaceId: 'ws-1',
}

function contextWith(memories: Array<{ id: string; content: string; importance: number }>) {
  return {
    conversationId: 'conv-1',
    relevantMemories: memories,
    conversationHistory: [],
    systemPrompt: 'SYSTEM PROMPT WITH MEMORIES',
    metadata: { memoriesInContext: memories.length, tokensUsed: 42, context: '' },
  }
}

describe('buildAugmentedSystemPrompt (RAG wiring)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the retrieved context as the system prompt when memories are relevant', async () => {
    const { conversationContextService } = await import('../../services/conversationContext.service')
    vi.mocked(conversationContextService.buildContext).mockResolvedValue(
      contextWith([{ id: 'm1', content: 'Founder prefers concise answers.', importance: 0.8 }]) as never
    )

    const { buildAugmentedSystemPrompt } = await import('../generateResponse.worker')
    await expect(buildAugmentedSystemPrompt(PARAMS)).resolves.toBe('SYSTEM PROMPT WITH MEMORIES')

    expect(conversationContextService.buildContext).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      userId: 'user-1',
      workspaceId: 'ws-1',
    })
  })

  it('sends no system prompt when retrieval finds nothing relevant', async () => {
    const { conversationContextService } = await import('../../services/conversationContext.service')
    vi.mocked(conversationContextService.buildContext).mockResolvedValue(contextWith([]) as never)

    const { buildAugmentedSystemPrompt } = await import('../generateResponse.worker')
    // Spending tokens to restate the conversation title buys nothing.
    await expect(buildAugmentedSystemPrompt(PARAMS)).resolves.toBeUndefined()
  })

  it('degrades to an unaugmented reply when retrieval fails, and never throws', async () => {
    const { conversationContextService } = await import('../../services/conversationContext.service')
    vi.mocked(conversationContextService.buildContext).mockRejectedValue(
      new Error('vector store unreachable')
    )

    const { buildAugmentedSystemPrompt } = await import('../generateResponse.worker')
    // Fail-open: a memory outage must not cost the user their message.
    await expect(buildAugmentedSystemPrompt(PARAMS)).resolves.toBeUndefined()

    const { logger } = await import('../../utils/logger')
    expect(logger.warn).toHaveBeenCalledWith(
      '[Worker] Memory retrieval failed; generating without it',
      expect.objectContaining({ conversationId: 'conv-1', error: 'vector store unreachable' })
    )
  })
})
