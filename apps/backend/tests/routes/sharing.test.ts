import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { initializeApp } from '../../src/index'
import { prisma } from '@synora/database'

describe('Sharing & Collaboration Routes', () => {
  let app: any
  let workspaceId: string
  let userId: string
  let token: string
  let conversationId: string

  beforeEach(async () => {
    const { app: expressApp } = await initializeApp()
    app = expressApp

    const user = await prisma.user.create({
      data: {
        email: `test-sharing-${Date.now()}@example.com`,
        name: 'Test User',
      },
    })
    userId = user.id

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-ws-sharing-${Date.now()}`,
      },
    })
    workspaceId = workspace.id

    await prisma.workspaceMember.create({
      data: { userId, workspaceId, role: 'OWNER' },
    })

    const conversation = await prisma.conversation.create({
      data: { workspaceId, title: 'Shared Chat', provider: 'synora', model: 'synora-chat' },
    })
    conversationId = conversation.id

    const jwt = require('jsonwebtoken')
    token = jwt.sign({ userId, workspaceId }, process.env.JWT_SECRET || 'test-secret', {
      expiresIn: '24h',
    })
  })

  afterEach(async () => {
    await prisma.conversationActivity.deleteMany({ where: { conversationId } })
    await prisma.conversationCollaborator.deleteMany({ where: { conversationId } })
    await prisma.sharedConversation.deleteMany({ where: { conversationId } })
    await prisma.conversation.deleteMany({ where: { workspaceId } })
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  describe('POST /api/workspaces/:workspaceId/conversations/:conversationId/share', () => {
    it('should create a share link', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/share`)
        .set('Authorization', `Bearer ${token}`)
        .send({ permissions: 'VIEW' })

      expect(response.status).toBe(201)
      expect(response.body.data.shareToken).toBeDefined()
      expect(response.body.data.permissions).toBe('VIEW')
    })

    it('should reject if conversation does not exist', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/nonexistent/share`)
        .set('Authorization', `Bearer ${token}`)
        .send({})

      expect(response.status).toBe(404)
    })
  })

  describe('GET /api/workspaces/:workspaceId/conversations/:conversationId/share', () => {
    it('should list share links', async () => {
      await prisma.sharedConversation.create({
        data: { conversationId, shareToken: 'token-a' },
      })

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/share`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data).toHaveLength(1)
    })
  })

  describe('DELETE /api/workspaces/:workspaceId/conversations/:conversationId/share/:shareId', () => {
    it('should revoke a share link', async () => {
      const share = await prisma.sharedConversation.create({
        data: { conversationId, shareToken: 'token-b' },
      })

      const response = await request(app)
        .delete(`/api/workspaces/${workspaceId}/conversations/${conversationId}/share/${share.id}`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)

      const found = await prisma.sharedConversation.findUnique({ where: { id: share.id } })
      expect(found).toBeNull()
    })
  })

  describe('GET /api/workspaces/shared/:shareToken', () => {
    it('should get shared conversation without auth', async () => {
      await prisma.sharedConversation.create({
        data: { conversationId, shareToken: 'public-token', isPublic: true },
      })

      const response = await request(app).get('/api/shared/public-token')

      expect(response.status).toBe(200)
      expect(response.body.data.permissions).toBe('VIEW')
      expect(response.body.data.conversation.id).toBe(conversationId)
    })

    it('should return 404 for expired share', async () => {
      await prisma.sharedConversation.create({
        data: {
          conversationId,
          shareToken: 'expired-token',
          isPublic: true,
          expiresAt: new Date(Date.now() - 1000 * 60),
        },
      })

      const response = await request(app).get('/api/shared/expired-token')

      expect(response.status).toBe(404)
    })

    it('should return 404 for nonexistent token', async () => {
      const response = await request(app).get('/api/shared/nonexistent-token')

      expect(response.status).toBe(404)
    })

    it('should return 404 for a non-public share, indistinguishable from a missing one', async () => {
      await prisma.sharedConversation.create({
        data: { conversationId, shareToken: 'private-token', isPublic: false },
      })

      const response = await request(app).get('/api/shared/private-token')

      expect(response.status).toBe(404)
      // Same body as the nonexistent case — a token probe must not be
      // able to confirm that a private share exists.
      const missing = await request(app).get('/api/shared/nonexistent-token')
      expect(response.body).toEqual(missing.body)
    })

    it('excludes soft-deleted messages from the public view', async () => {
      await prisma.message.create({
        data: { conversationId, content: 'visible message', role: 'USER' },
      })
      await prisma.message.create({
        data: {
          conversationId,
          content: 'deleted message',
          role: 'ASSISTANT',
          deletedAt: new Date(),
        },
      })
      await prisma.sharedConversation.create({
        data: { conversationId, shareToken: 'deletion-token', isPublic: true },
      })

      const response = await request(app).get('/api/shared/deletion-token')

      expect(response.status).toBe(200)
      const contents = response.body.data.messages.map((m: { content: string }) => m.content)
      expect(contents).toContain('visible message')
      expect(contents).not.toContain('deleted message')

      await prisma.message.deleteMany({ where: { conversationId } })
    })

    it('never exposes billing internals on publicly shared messages', async () => {
      await prisma.message.create({
        data: {
          conversationId,
          content: 'costed message',
          role: 'ASSISTANT',
          inputTokens: 123,
          outputTokens: 456,
          costCents: 7.89,
        },
      })
      await prisma.sharedConversation.create({
        data: { conversationId, shareToken: 'billing-token', isPublic: true },
      })

      const response = await request(app).get('/api/shared/billing-token')

      expect(response.status).toBe(200)
      const message = response.body.data.messages[0]
      expect(message.content).toBe('costed message')
      expect(message.inputTokens).toBeUndefined()
      expect(message.outputTokens).toBeUndefined()
      expect(message.costCents).toBeUndefined()

      await prisma.message.deleteMany({ where: { conversationId } })
    })
  })

  describe('POST /api/workspaces/:workspaceId/conversations/:conversationId/collaborators', () => {
    it('should add a collaborator', async () => {
      const collaboratorUser = await prisma.user.create({
        data: { email: `collab-${Date.now()}@example.com`, name: 'Collaborator' },
      })
      await prisma.workspaceMember.create({
        data: { userId: collaboratorUser.id, workspaceId, role: 'EDITOR' },
      })

      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/collaborators`)
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: collaboratorUser.id, role: 'EDITOR' })

      expect(response.status).toBe(201)
      expect(response.body.data.role).toBe('EDITOR')

      await prisma.conversationCollaborator.deleteMany({ where: { userId: collaboratorUser.id } })
      await prisma.workspaceMember.deleteMany({ where: { userId: collaboratorUser.id } })
      await prisma.user.delete({ where: { id: collaboratorUser.id } })
    })

    it('should reject adding a user not in workspace', async () => {
      const outsider = await prisma.user.create({
        data: { email: `outsider-${Date.now()}@example.com`, name: 'Outsider' },
      })

      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/collaborators`)
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: outsider.id })

      expect(response.status).toBe(404)

      await prisma.user.delete({ where: { id: outsider.id } })
    })
  })

  describe('GET /api/workspaces/:workspaceId/conversations/:conversationId/collaborators', () => {
    it('should list collaborators', async () => {
      const collaboratorUser = await prisma.user.create({
        data: { email: `collab2-${Date.now()}@example.com`, name: 'Collaborator2' },
      })
      await prisma.workspaceMember.create({
        data: { userId: collaboratorUser.id, workspaceId, role: 'EDITOR' },
      })
      await prisma.conversationCollaborator.create({
        data: { conversationId, userId: collaboratorUser.id, role: 'VIEWER' },
      })

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/collaborators`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data).toHaveLength(1)

      await prisma.conversationCollaborator.deleteMany({ where: { userId: collaboratorUser.id } })
      await prisma.workspaceMember.deleteMany({ where: { userId: collaboratorUser.id } })
      await prisma.user.delete({ where: { id: collaboratorUser.id } })
    })
  })

  describe('DELETE /api/workspaces/:workspaceId/conversations/:conversationId/collaborators/:collaboratorUserId', () => {
    it('should remove a collaborator', async () => {
      const collaboratorUser = await prisma.user.create({
        data: { email: `collab3-${Date.now()}@example.com`, name: 'Collaborator3' },
      })
      await prisma.workspaceMember.create({
        data: { userId: collaboratorUser.id, workspaceId, role: 'EDITOR' },
      })
      await prisma.conversationCollaborator.create({
        data: { conversationId, userId: collaboratorUser.id, role: 'VIEWER' },
      })

      const response = await request(app)
        .delete(`/api/workspaces/${workspaceId}/conversations/${conversationId}/collaborators/${collaboratorUser.id}`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)

      const found = await prisma.conversationCollaborator.findUnique({
        where: { conversationId_userId: { conversationId, userId: collaboratorUser.id } },
      })
      expect(found).toBeNull()

      await prisma.workspaceMember.deleteMany({ where: { userId: collaboratorUser.id } })
      await prisma.user.delete({ where: { id: collaboratorUser.id } })
    })
  })

  describe('GET /api/workspaces/:workspaceId/conversations/:conversationId/activity', () => {
    it('should list activity log', async () => {
      await prisma.conversationActivity.create({
        data: { conversationId, action: 'conversation_created' },
      })

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/activity`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data).toHaveLength(1)
      expect(response.body.data[0].action).toBe('conversation_created')
    })
  })
})
