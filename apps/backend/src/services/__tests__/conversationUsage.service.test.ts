import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@synora/database'
import { conversationUsageService } from '../conversationUsage.service'

describe('conversationUsage.service', () => {
  const workspaceIds: string[] = []
  let conversationId: string

  beforeEach(async () => {
    const workspace = await prisma.workspace.create({
      data: { name: 'Usage Test Workspace', slug: `usage-svc-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    })
    workspaceIds.push(workspace.id)

    const conversation = await prisma.conversation.create({
      data: { workspaceId: workspace.id, title: 'Usage test', provider: 'anthropic', model: 'claude-sonnet-5' },
    })
    conversationId = conversation.id
  })

  afterEach(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } })
    workspaceIds.length = 0
  })

  it('creates a usage row on the first recorded generation', async () => {
    const usage = await conversationUsageService.recordGeneration({
      conversationId,
      model: 'claude-sonnet-5',
      inputTokens: 100,
      outputTokens: 50,
    })

    expect(usage.inputTokens).toBe(100)
    expect(usage.outputTokens).toBe(50)
    expect(usage.totalTokens).toBe(150)
    expect(usage.estimatedCost).toBeGreaterThan(0)
  })

  it('increments cumulatively across multiple generations, never overwrites', async () => {
    await conversationUsageService.recordGeneration({
      conversationId, model: 'claude-sonnet-5', inputTokens: 100, outputTokens: 50,
    })
    const second = await conversationUsageService.recordGeneration({
      conversationId, model: 'claude-sonnet-5', inputTokens: 200, outputTokens: 75,
    })

    expect(second.inputTokens).toBe(300)
    expect(second.outputTokens).toBe(125)
    expect(second.totalTokens).toBe(425)
  })

  it('does not throw for an unrecognized model, and contributes zero cost', async () => {
    const usage = await conversationUsageService.recordGeneration({
      conversationId,
      model: 'some-model-not-in-the-pricing-table',
      inputTokens: 100,
      outputTokens: 50,
    })

    expect(usage.inputTokens).toBe(100)
    expect(usage.estimatedCost).toBe(0)
  })

  it('getByConversationId returns null when nothing has been recorded yet', async () => {
    const usage = await conversationUsageService.getByConversationId(conversationId)
    expect(usage).toBeNull()
  })
})
