import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { initializeApp } from '../../src/index'
import { prisma } from '@synora/database'
import { MessageRole } from '@prisma/client'

describe('Branches Routes', () => {
  let app: any
  let workspaceId: string
  let userId: string
  let conversationId: string
  let parentMessageId: string
  let token: string

  beforeEach(async () => {
    const { app: expressApp } = await initializeApp()
    app = expressApp

    const user = await prisma.user.create({
      data: {
        email: `test-branch-${Date.now()}@example.com`,
        name: 'Test User',
      },
    })
    userId = user.id

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-ws-branch-${Date.now()}`,
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

    const parentMsg = await prisma.message.create({
      data: {
        conversationId,
        content: 'Hello, Claude!',
        role: MessageRole.USER,
      },
    })
    parentMessageId = parentMsg.id

    const jwt = require('jsonwebtoken')
    token = jwt.sign({ userId, workspaceId }, process.env.JWT_SECRET || 'test-secret', {
      expiresIn: '24h',
    })
  })

  afterEach(async () => {
    await prisma.messageBranch.deleteMany({
      where: { message: { conversationId } },
    })
    await prisma.message.deleteMany({ where: { conversationId } })
    await prisma.conversation.deleteMany({ where: { id: conversationId } })
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  describe('POST /api/workspaces/:workspaceId/conversations/:conversationId/branches', () => {
    it('should create an alternative branch message', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/branches`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          parentId: parentMessageId,
          content: 'Alternative response content',
        })

      expect(response.status).toBe(201)
      expect(response.body.data.parentId).toBe(parentMessageId)
      expect(response.body.data.role).toBe(MessageRole.ASSISTANT)
      expect(response.body.data.branch).toBeTruthy()
      expect(response.body.data.branch.isMainBranch).toBe(false)
    })

    it('should create branch with empty content for AI generation', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/branches`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          parentId: parentMessageId,
        })

      expect(response.status).toBe(201)
      expect(response.body.data.content).toBe('')
    })

    it('should return 404 if parent message not found', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/branches`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          parentId: 'nonexistent-id',
        })

      expect(response.status).toBe(404)
    })
  })

  describe('GET /api/workspaces/:workspaceId/conversations/:conversationId/branches', () => {
    beforeEach(async () => {
      const child1 = await prisma.message.create({
        data: {
          conversationId,
          content: 'First response',
          role: MessageRole.ASSISTANT,
          parentId: parentMessageId,
        },
      })
      await prisma.messageBranch.create({
        data: {
          messageId: child1.id,
          branchIndex: 0,
          isMainBranch: true,
        },
      })

      const child2 = await prisma.message.create({
        data: {
          conversationId,
          content: 'Alternative response',
          role: MessageRole.ASSISTANT,
          parentId: parentMessageId,
        },
      })
      await prisma.messageBranch.create({
        data: {
          messageId: child2.id,
          branchIndex: 1,
          isMainBranch: false,
        },
      })
    })

    it('should list sibling branches at a parent', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/branches`)
        .query({ parentId: parentMessageId })
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.branches).toHaveLength(2)
      expect(response.body.data.total).toBe(2)
    })

    it('should return 400 without parentId', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/branches`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(400)
    })
  })

  describe('GET /api/workspaces/:workspaceId/conversations/:conversationId/tree', () => {
    it('should return message tree', async () => {
      await prisma.message.create({
        data: {
          conversationId,
          content: 'Response',
          role: MessageRole.ASSISTANT,
          parentId: parentMessageId,
        },
      })

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/tree`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.messages).toHaveLength(2)
    })
  })

  describe('POST /api/workspaces/:workspaceId/conversations/:conversationId/branches/set-main', () => {
    let childId: string

    beforeEach(async () => {
      const child = await prisma.message.create({
        data: {
          conversationId,
          content: 'Alternative response',
          role: MessageRole.ASSISTANT,
          parentId: parentMessageId,
        },
      })
      childId = child.id
      await prisma.messageBranch.create({
        data: {
          messageId: childId,
          branchIndex: 0,
          isMainBranch: false,
        },
      })
    })

    it('should set message as main branch', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/branches/set-main`)
        .set('Authorization', `Bearer ${token}`)
        .send({ messageId: childId })

      expect(response.status).toBe(200)
      expect(response.body.data.isMainBranch).toBe(true)
    })
  })

  describe('DELETE /api/workspaces/:workspaceId/conversations/:conversationId/branches/:messageId', () => {
    let childId: string

    beforeEach(async () => {
      const child = await prisma.message.create({
        data: {
          conversationId,
          content: 'Alternative response',
          role: MessageRole.ASSISTANT,
          parentId: parentMessageId,
        },
      })
      childId = child.id
      await prisma.messageBranch.create({
        data: {
          messageId: childId,
          branchIndex: 1,
          isMainBranch: false,
        },
      })
    })

    it('should delete a non-main branch', async () => {
      const response = await request(app)
        .delete(`/api/workspaces/${workspaceId}/conversations/${conversationId}/branches/${childId}`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.success).toBe(true)

      const found = await prisma.message.findUnique({ where: { id: childId } })
      expect(found).toBeNull()
    })

    it('should not delete main branch', async () => {
      await prisma.messageBranch.update({
        where: { messageId: childId },
        data: { isMainBranch: true },
      })

      const response = await request(app)
        .delete(`/api/workspaces/${workspaceId}/conversations/${conversationId}/branches/${childId}`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(403)
    })
  })

  describe('Permission enforcement', () => {
    let viewerId: string
    let viewerToken: string

    beforeEach(async () => {
      const viewer = await prisma.user.create({
        data: {
          email: `viewer-branch-${Date.now()}@example.com`,
          name: 'Viewer User',
        },
      })
      viewerId = viewer.id

      await prisma.workspaceMember.create({
        data: {
          userId: viewerId,
          workspaceId,
          role: 'VIEWER',
        },
      })

      const jwt = require('jsonwebtoken')
      viewerToken = jwt.sign({ userId: viewerId, workspaceId }, process.env.JWT_SECRET || 'test-secret', {
        expiresIn: '24h',
      })
    })

    afterEach(async () => {
      await prisma.workspaceMember.deleteMany({ where: { userId: viewerId } })
      await prisma.user.delete({ where: { id: viewerId } })
    })

    it('should not allow viewer to create branches', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/branches`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ parentId: parentMessageId })

      expect(response.status).toBe(403)
    })

    it('should allow viewer to list branches', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/branches`)
        .query({ parentId: parentMessageId })
        .set('Authorization', `Bearer ${viewerToken}`)

      expect(response.status).toBe(200)
    })
  })
})
