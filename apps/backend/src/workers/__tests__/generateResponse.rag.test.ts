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

/**
 * The last thing standing between a silent empty reply and the database.
 *
 * A stream can finish cleanly, report real token usage, and never emit a
 * character. That used to be persisted as the assistant's message with the
 * job marked COMPLETED — an empty bubble, tokens already paid for, and no
 * explanation anywhere. The OpenAI-compatible adapter now refuses that case
 * with a precise reason; this guard covers every other streaming adapter,
 * in the one place the message is written.
 */
describe('assertStreamProducedAnAnswer (the empty-reply backstop)', () => {
  async function guard() {
    const { assertStreamProducedAnAnswer } = await import('../generateResponse.worker')
    return assertStreamProducedAnAnswer
  }

  it('refuses to let an empty reply be saved', async () => {
    const assertStreamProducedAnAnswer = await guard()
    expect(() =>
      assertStreamProducedAnAnswer({ provider: 'self-hosted', text: '', cancelled: false })
    ).toThrow(/no answer/i)
  })

  it('treats whitespace as empty — a reply of spaces is still no reply', async () => {
    const assertStreamProducedAnAnswer = await guard()
    expect(() =>
      assertStreamProducedAnAnswer({ provider: 'self-hosted', text: '  \n\t ', cancelled: false })
    ).toThrow()
  })

  it('says nothing was saved, so the reader is not left wondering', async () => {
    const assertStreamProducedAnAnswer = await guard()
    expect(() =>
      assertStreamProducedAnAnswer({ provider: 'self-hosted', text: '', cancelled: false })
    ).toThrow(/nothing was saved/i)
  })

  it('does NOT guess at a cause it cannot see', async () => {
    // Stream chunks carry no finish reason, so the worker genuinely does
    // not know why the reply was empty. Asserting the likeliest cause would
    // send someone to change a setting that may be irrelevant. Only the
    // adapter, which can read `finish_reason`, is entitled to say that.
    const assertStreamProducedAnAnswer = await guard()
    expect(() =>
      assertStreamProducedAnAnswer({ provider: 'self-hosted', text: '', cancelled: false })
    ).toThrow(/^(?!.*output budget)/s)
  })

  it('lets a cancelled generation keep whatever arrived', async () => {
    // Stopping a generation is a decision, not a malfunction.
    const assertStreamProducedAnAnswer = await guard()
    expect(() =>
      assertStreamProducedAnAnswer({ provider: 'self-hosted', text: '', cancelled: true })
    ).not.toThrow()
  })

  it('stays out of the way of a real answer', async () => {
    const assertStreamProducedAnAnswer = await guard()
    expect(() =>
      assertStreamProducedAnAnswer({ provider: 'self-hosted', text: 'Hello.', cancelled: false })
    ).not.toThrow()
  })
})
