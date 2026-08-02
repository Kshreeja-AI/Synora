import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { prisma } from '@synora/database'
import { initializeApp } from '../../index'
import { issueTokens } from '../../services/token.service'
import * as aiModule from '../../ai/index.js'
import * as generateResponseWorker from '../../workers/generateResponse.worker'
import type { Express } from 'express'

describe('message routes', () => {
  const workspaceIds: string[] = []
  let app: Express
  let userId: string
  let workspaceId: string
  let conversationId: string
  let token: string

  beforeAll(async () => {
    const initialized = await initializeApp()
    app = initialized.app
  })

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { email: `user-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`, password: 'hashed' },
    })
    userId = user.id

    const workspace = await prisma.workspace.create({
      data: { name: 'Test Workspace', slug: `msg-route-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    })
    workspaceId = workspace.id
    workspaceIds.push(workspaceId)

    await prisma.workspaceMember.create({ data: { workspaceId, userId, role: 'OWNER' } })

    const conversation = await prisma.conversation.create({
      data: { workspaceId, title: 'Route test', provider: 'anthropic', model: 'claude-sonnet-5' },
    })
    conversationId = conversation.id

    const tokens = await issueTokens({ userId, email: user.email, role: user.role })
    token = tokens.accessToken
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } })
    workspaceIds.length = 0
  })

  describe('POST /:workspaceId/conversations/:conversationId/messages', () => {
    it('creates a USER message, a placeholder ASSISTANT message, and enqueues a generation job', async () => {
      // Generation itself happens asynchronously in a separate BullMQ worker
      // (see generateResponse.worker.ts) that streams tokens over SSE — the
      // route returns immediately with an empty placeholder, not a finished
      // reply. This only asserts the synchronous, request/response contract.
      const res = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'Hello', role: 'USER' })

      expect(res.status).toBe(201)
      expect(res.body.data.userMessage.content).toBe('Hello')
      expect(res.body.data.assistantMessage.role).toBe('ASSISTANT')
      expect(res.body.data.assistantMessage.content).toBe('')
      expect(res.body.data.jobId).toBe(res.body.data.assistantMessage.id)

      const job = await prisma.streamingJob.findUnique({
        where: { messageId: res.body.data.assistantMessage.id },
      })
      expect(job).not.toBeNull()
      expect(job?.status).toBe('RUNNING')
    })

    it('still returns 201 with the placeholder if enqueueing the generation job fails', async () => {
      // enqueueGeneration() deliberately swallows queue errors (see comment
      // in message.service.ts) so a Redis/queue outage doesn't block the
      // user from sending a message — it just never gets a reply.
      vi.spyOn(generateResponseWorker, 'createGenerateResponseQueue').mockReturnValue({
        add: vi.fn().mockRejectedValue(new Error('queue unavailable')),
      } as unknown as ReturnType<typeof generateResponseWorker.createGenerateResponseQueue>)

      const res = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'Hello', role: 'USER' })

      expect(res.status).toBe(201)
      expect(res.body.data.userMessage.content).toBe('Hello')
      expect(res.body.data.assistantMessage.role).toBe('ASSISTANT')

      const messages = await prisma.message.findMany({ where: { conversationId, role: 'USER' } })
      expect(messages).toHaveLength(1)
    })

    it('creating a SYSTEM message does not trigger generation', async () => {
      const resolveSpy = vi.spyOn(aiModule, 'resolveProvider')

      const res = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'You are a helpful assistant', role: 'SYSTEM' })

      expect(res.status).toBe(201)
      expect(res.body.data.role).toBe('SYSTEM')
      expect(resolveSpy).not.toHaveBeenCalled()
    })

    it('rejects role: ASSISTANT from a client with a 400', async () => {
      const res = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'fabricated reply', role: 'ASSISTANT' })

      expect(res.status).toBe(400)
    })

    it('404s for a conversation in a workspace the user cannot access', async () => {
      const otherWorkspace = await prisma.workspace.create({
        data: { name: 'Other', slug: `other-msg-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      })
      workspaceIds.push(otherWorkspace.id)
      const otherConversation = await prisma.conversation.create({
        data: { workspaceId: otherWorkspace.id, title: 'Not yours', provider: 'anthropic', model: 'claude-sonnet-5' },
      })

      const res = await request(app)
        .post(`/api/workspaces/${otherWorkspace.id}/conversations/${otherConversation.id}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'Hello', role: 'USER' })

      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /:workspaceId/conversations/:conversationId/messages/:messageId', () => {
    it('soft-deletes a message and it no longer appears in the history list', async () => {
      const createRes = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'To delete', role: 'SYSTEM' })
      const messageId = createRes.body.data.id

      const deleteRes = await request(app)
        .delete(`/api/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}`)
        .set('Authorization', `Bearer ${token}`)
      expect(deleteRes.status).toBe(200)
      expect(deleteRes.body.data.deletedAt).not.toBeNull()

      const listRes = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${token}`)
      expect(listRes.body.data.find((m: { id: string }) => m.id === messageId)).toBeUndefined()
    })
  })
})
