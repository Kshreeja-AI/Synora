import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { initializeApp } from '../../src/index'
import { prisma } from '@synora/database'
import { MessageRole } from '@prisma/client'
import * as aiModule from '../../src/ai/index.js'

describe('Streaming Routes', () => {
  let app: any
  let workspaceId: string
  let userId: string
  let conversationId: string
  let messageId: string
  let token: string

  beforeEach(async () => {
    const { app: expressApp } = await initializeApp()
    app = expressApp

    // Create test user and workspace
    const user = await prisma.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        name: 'Test User',
      },
    })
    userId = user.id

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-workspace-${Date.now()}`,
      },
    })
    workspaceId = workspace.id

    await prisma.workspaceMember.create({
      data: {
        userId,
        workspaceId,
        role: 'OWNER',
      },
    })

    const conversation = await prisma.conversation.create({
      data: {
        workspaceId,
        title: 'Test Conversation',
        provider: 'anthropic',
        model: 'claude-3-sonnet',
      },
    })
    conversationId = conversation.id

    const message = await prisma.message.create({
      data: {
        id: `msg-${Date.now()}`,
        conversationId,
        content: 'Hello, Claude!',
        role: MessageRole.USER,
      },
    })
    messageId = message.id

    // Generate JWT token
    const jwt = require('jsonwebtoken')
    token = jwt.sign({ userId, workspaceId }, process.env.JWT_SECRET || 'test-secret', {
      expiresIn: '24h',
    })

    // Mock the AI provider
    vi.spyOn(aiModule, 'resolveProvider').mockResolvedValue({
      id: 'anthropic',
      capabilities: ['text-generation'],
      generateText: vi.fn().mockResolvedValue({
        text: 'Hello! How can I help you today?',
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        usage: { inputTokens: 5, outputTokens: 10 },
      }),
    } as unknown as aiModule.TextGenerationProvider)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await prisma.message.deleteMany({ where: { conversationId } })
    await prisma.conversationUsage.deleteMany({ where: { conversationId } })
    await prisma.conversation.deleteMany({ where: { id: conversationId } })
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  describe('GET /api/workspaces/:workspaceId/conversations/:conversationId/stream', () => {
    it('should return 400 if messageId query parameter is missing', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/stream`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'text/event-stream')

      expect(response.status).toBe(400)
      expect(response.body.error).toBeDefined()
    })

    it('should return 401 if not authenticated', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/stream`)
        .query({ messageId })
        .set('Accept', 'text/event-stream')

      expect(response.status).toBe(401)
    })

    it('should return SSE with proper headers', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/stream`)
        .query({ messageId })
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'text/event-stream')

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toContain('text/event-stream')
      expect(response.headers['cache-control']).toBe('no-cache')
      expect(response.headers['connection']).toBe('keep-alive')
    })

    it('should stream tokens from message generation', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/stream`)
        .query({ messageId })
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'text/event-stream')

      expect(response.status).toBe(200)

      // Parse SSE events
      const events = parseSSEResponse(response.text)
      const tokenEvents = events.filter((e) => e.event === 'token')

      expect(tokenEvents.length).toBeGreaterThan(0)
      tokenEvents.forEach((e) => {
        const data = JSON.parse(e.data)
        expect(data.token).toBeDefined()
        expect(typeof data.token).toBe('string')
      })
    })

    it('should emit done event with completion data', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/stream`)
        .query({ messageId })
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'text/event-stream')

      expect(response.status).toBe(200)

      const events = parseSSEResponse(response.text)
      const doneEvent = events.find((e) => e.event === 'done')

      expect(doneEvent).toBeDefined()
      const doneData = JSON.parse(doneEvent!.data)
      expect(doneData.messageId).toBeDefined()
      expect(doneData.inputTokens).toBeDefined()
      expect(doneData.outputTokens).toBeDefined()
      expect(doneData.completedAt).toBeDefined()
    })

    it('should have no error event on successful generation', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/stream`)
        .query({ messageId })
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'text/event-stream')

      expect(response.status).toBe(200)

      const events = parseSSEResponse(response.text)
      const errorEvents = events.filter((e) => e.event === 'error')

      expect(errorEvents.length).toBe(0)
    })

    it('should emit error event on generation failure', async () => {
      // Mock AI provider to throw error
      vi.spyOn(aiModule, 'resolveProvider').mockResolvedValue({
        id: 'anthropic',
        capabilities: ['text-generation'],
        generateText: vi.fn().mockRejectedValue(new Error('AI provider error')),
      } as unknown as aiModule.TextGenerationProvider)

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/stream`)
        .query({ messageId })
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'text/event-stream')

      // Stream can have mixed status as it starts with 200 then processes
      const events = parseSSEResponse(response.text)
      const errorEvents = events.filter((e) => e.event === 'error')

      expect(errorEvents.length).toBeGreaterThan(0)
      const errorData = JSON.parse(errorEvents[0].data)
      expect(errorData.error).toContain('AI provider error')
    })

    it('should update message with generated content', async () => {
      await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/stream`)
        .query({ messageId })
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'text/event-stream')

      // Check that message was updated
      const updatedMessage = await prisma.message.findUnique({
        where: { id: messageId },
      })

      expect(updatedMessage?.content).toContain('Hello')
    })

    it('should track usage for conversation', async () => {
      await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/stream`)
        .query({ messageId })
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'text/event-stream')

      const usage = await prisma.conversationUsage.findUnique({
        where: { conversationId },
      })

      expect(usage).toBeDefined()
      expect(usage?.inputTokens).toBeGreaterThan(0)
      expect(usage?.outputTokens).toBeGreaterThan(0)
      expect(usage?.totalTokens).toBeGreaterThan(0)
    })

    it('should handle non-existent message', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/stream`)
        .query({ messageId: 'non-existent' })
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'text/event-stream')

      expect(response.status).toBe(200) // SSE starts with 200
      const events = parseSSEResponse(response.text)
      const errorEvents = events.filter((e) => e.event === 'error')

      expect(errorEvents.length).toBeGreaterThan(0)
    })

    it('should handle assistant message (should error)', async () => {
      // Create an assistant message
      const assistantMessage = await prisma.message.create({
        data: {
          id: `msg-assistant-${Date.now()}`,
          conversationId,
          content: 'This is an assistant response',
          role: MessageRole.ASSISTANT,
        },
      })

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/stream`)
        .query({ messageId: assistantMessage.id })
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'text/event-stream')

      expect(response.status).toBe(200) // SSE starts with 200
      const events = parseSSEResponse(response.text)
      const errorEvents = events.filter((e) => e.event === 'error')

      expect(errorEvents.length).toBeGreaterThan(0)
      const errorData = JSON.parse(errorEvents[0].data)
      expect(errorData.error).toContain('Can only generate responses for user messages')

      // Cleanup
      await prisma.message.delete({ where: { id: assistantMessage.id } })
    })

    it('should deny access to conversation in different workspace', async () => {
      // Create another workspace and user
      const otherUser = await prisma.user.create({
        data: {
          email: `other-${Date.now()}@example.com`,
          name: 'Other User',
        },
      })

      const otherWorkspace = await prisma.workspace.create({
        data: {
          name: 'Other Workspace',
          slug: `other-workspace-${Date.now()}`,
        },
      })

      await prisma.workspaceMember.create({
        data: {
          userId: otherUser.id,
          workspaceId: otherWorkspace.id,
          role: 'OWNER',
        },
      })

      const otherToken = require('jsonwebtoken').sign(
        { userId: otherUser.id, workspaceId: otherWorkspace.id },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '24h' }
      )

      // Try to access conversation from different workspace
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/stream`)
        .query({ messageId })
        .set('Authorization', `Bearer ${otherToken}`)
        .set('Accept', 'text/event-stream')

      // Should deny access (either 401, 403, or 404)
      expect([401, 403, 404]).toContain(response.status)

      // Cleanup
      await prisma.workspaceMember.deleteMany({ where: { userId: otherUser.id } })
      await prisma.workspace.delete({ where: { id: otherWorkspace.id } })
      await prisma.user.delete({ where: { id: otherUser.id } })
    })
  })
})

// Helper function to parse SSE responses
function parseSSEResponse(text: string): Array<{ event: string; data: string }> {
  const lines = text.split('\n')
  const events: Array<{ event: string; data: string }> = []
  let currentEvent = ''
  let currentData = ''

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      if (currentEvent && currentData) {
        events.push({ event: currentEvent, data: currentData })
      }
      currentEvent = line.slice(7)
      currentData = ''
    } else if (line.startsWith('data: ')) {
      currentData = line.slice(6)
    }
  }

  if (currentEvent && currentData) {
    events.push({ event: currentEvent, data: currentData })
  }

  return events
}
