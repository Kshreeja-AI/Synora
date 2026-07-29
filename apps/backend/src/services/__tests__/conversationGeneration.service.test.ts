import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import type { Message } from '@prisma/client'
import { prisma } from '@synora/database'
import { initConfig } from '../../config'
import { conversationGenerationService } from '../conversationGeneration.service'
import { conversationUsageService } from '../conversationUsage.service'
import * as aiModule from '../../ai/index.js'
import { ServiceUnavailableException } from '@synora/shared'

interface MockGenerateResult {
  text: string
  provider: string
  model: string
  usage?: { inputTokens?: number; outputTokens?: number }
}

describe('conversationGeneration.service', () => {
  const workspaceIds: string[] = []
  let conversationId: string

  beforeAll(async () => {
    await initConfig()
  })

  beforeEach(async () => {
    const workspace = await prisma.workspace.create({
      data: { name: 'Gen Test Workspace', slug: `gen-svc-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    })
    workspaceIds.push(workspace.id)

    const conversation = await prisma.conversation.create({
      data: { workspaceId: workspace.id, title: 'Gen test', provider: 'anthropic', model: 'claude-sonnet-5' },
    })
    conversationId = conversation.id
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } })
    workspaceIds.length = 0
  })

  function createUserMessage(content = 'Hello'): Promise<Message> {
    return prisma.message.create({ data: { conversationId, content, role: 'USER' } })
  }

  function mockProvider(
    generateText: ReturnType<
      typeof vi.fn<(request: aiModule.TextGenerationRequest) => Promise<MockGenerateResult>>
    >
  ) {
    return vi.spyOn(aiModule, 'resolveProvider').mockResolvedValue({
      id: 'anthropic',
      capabilities: ['text-generation'],
      generateText,
    } as unknown as aiModule.TextGenerationProvider)
  }

  it('succeeds on the first attempt: creates the assistant message, completes the job, records usage and lastMessageAt', async () => {
    const userMessage = await createUserMessage()
    const generateText = vi.fn<(request: aiModule.TextGenerationRequest) => Promise<MockGenerateResult>>().mockResolvedValue({
      text: 'Hi there',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      usage: { inputTokens: 10, outputTokens: 5 },
    })
    mockProvider(generateText)

    const result = await conversationGenerationService.generateReply(conversationId, userMessage)

    expect(result.assistantMessage.content).toBe('Hi there')
    expect(result.assistantMessage.role).toBe('ASSISTANT')
    expect(result.assistantMessage.parentId).toBe(userMessage.id)
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    expect(generateText).toHaveBeenCalledTimes(1)

    const job = await prisma.streamingJob.findFirst({ where: { conversationId } })
    expect(job?.status).toBe('COMPLETED')
    expect(job?.attempt).toBe(1)
    expect(job?.messageId).toBe(result.assistantMessage.id)

    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })
    expect(conversation.lastMessageAt?.getTime()).toBe(result.assistantMessage.createdAt.getTime())

    const usage = await conversationUsageService.getByConversationId(conversationId)
    expect(usage?.inputTokens).toBe(10)
    expect(usage?.outputTokens).toBe(5)
  })

  it('retries once on failure and succeeds on the second attempt', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const userMessage = await createUserMessage()
    const generateText = vi
      .fn<(request: aiModule.TextGenerationRequest) => Promise<MockGenerateResult>>()
      .mockRejectedValueOnce(new aiModule.AIProviderError('temporary failure', 'anthropic'))
      .mockResolvedValueOnce({
        text: 'Recovered',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        usage: { inputTokens: 8, outputTokens: 4 },
      })
    mockProvider(generateText)

    const resultPromise = conversationGenerationService.generateReply(conversationId, userMessage)
    await vi.advanceTimersByTimeAsync(600) // past the 500ms first backoff
    const result = await resultPromise

    expect(result.assistantMessage.content).toBe('Recovered')
    expect(generateText).toHaveBeenCalledTimes(2)

    const job = await prisma.streamingJob.findFirst({ where: { conversationId } })
    expect(job?.status).toBe('COMPLETED')
    expect(job?.attempt).toBe(2)
  })

  it('fails after exhausting all retries: no assistant message is created, job is FAILED with lastError set, usage untouched', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const userMessage = await createUserMessage()
    const generateText = vi
      .fn<(request: aiModule.TextGenerationRequest) => Promise<MockGenerateResult>>()
      .mockRejectedValue(new aiModule.AIProviderError('permanent failure', 'anthropic'))
    mockProvider(generateText)

    const resultPromise = conversationGenerationService.generateReply(conversationId, userMessage)
    // Swallow the eventual rejection here so it isn't reported as unhandled
    // while timers are being advanced below; the real assertion is the
    // `rejects.toThrow` on this same promise further down.
    resultPromise.catch(() => undefined)

    await vi.advanceTimersByTimeAsync(2100) // past both the 500ms and 1500ms backoffs

    await expect(resultPromise).rejects.toThrow(ServiceUnavailableException)
    await expect(resultPromise).rejects.toThrow(/permanent failure/)

    expect(generateText).toHaveBeenCalledTimes(3)

    const job = await prisma.streamingJob.findFirst({ where: { conversationId } })
    expect(job?.status).toBe('FAILED')
    expect(job?.attempt).toBe(3)
    expect(job?.lastError).toContain('permanent failure')

    const assistantMessages = await prisma.message.findMany({ where: { conversationId, role: 'ASSISTANT' } })
    expect(assistantMessages).toHaveLength(0)

    const usage = await conversationUsageService.getByConversationId(conversationId)
    expect(usage).toBeNull()
  })

  it("passes the conversation's own provider as an explicit override, not relying on global auto-detection", async () => {
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })
    const userMessage = await createUserMessage()

    const resolveSpy = mockProvider(
      vi.fn<(request: aiModule.TextGenerationRequest) => Promise<MockGenerateResult>>().mockResolvedValue({
        text: 'ok',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
    )

    await conversationGenerationService.generateReply(conversationId, userMessage)

    expect(resolveSpy).toHaveBeenCalledWith('text-generation', { explicitProviderId: conversation.provider })
  })

  it('sends prior messages as history (oldest-first), excluding the new user message itself', async () => {
    const first = await createUserMessage('First')
    await prisma.message.create({
      data: { conversationId, content: 'First reply', role: 'ASSISTANT', parentId: first.id },
    })
    const secondUserMessage = await createUserMessage('Second')

    const generateText = vi.fn<(request: aiModule.TextGenerationRequest) => Promise<MockGenerateResult>>().mockResolvedValue({
      text: 'Second reply',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      usage: { inputTokens: 1, outputTokens: 1 },
    })
    mockProvider(generateText)

    await conversationGenerationService.generateReply(conversationId, secondUserMessage)

    const call = generateText.mock.calls[0][0]
    expect(call.prompt).toBe('Second')
    expect(call.messages).toEqual([
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'First reply' },
    ])
  })

  it('excludes soft-deleted messages from prompt history', async () => {
    const first = await createUserMessage('Visible')
    const deleted = await createUserMessage('Should not appear')
    await prisma.message.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } })
    const newMessage = await createUserMessage('New')

    const generateText = vi.fn<(request: aiModule.TextGenerationRequest) => Promise<MockGenerateResult>>().mockResolvedValue({
      text: 'reply',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      usage: { inputTokens: 1, outputTokens: 1 },
    })
    mockProvider(generateText)

    await conversationGenerationService.generateReply(conversationId, newMessage)

    const call = generateText.mock.calls[0][0]
    expect(call.messages?.map((m) => m.content)).toEqual(['Visible'])
    expect(first).toBeDefined()
  })
})
