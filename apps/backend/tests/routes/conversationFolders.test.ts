import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { initializeApp } from '../../src/index'
import { prisma } from '@synora/database'

describe('Conversation Folders Routes', () => {
  let app: any
  let workspaceId: string
  let userId: string
  let token: string

  beforeEach(async () => {
    const { app: expressApp } = await initializeApp()
    app = expressApp

    const user = await prisma.user.create({
      data: {
        email: `test-convfolder-${Date.now()}@example.com`,
        name: 'Test User',
      },
    })
    userId = user.id

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-ws-convfolder-${Date.now()}`,
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

    const jwt = require('jsonwebtoken')
    token = jwt.sign({ userId, workspaceId }, process.env.JWT_SECRET || 'test-secret', {
      expiresIn: '24h',
    })
  })

  afterEach(async () => {
    await prisma.conversation.deleteMany({ where: { workspaceId } })
    await prisma.conversationFolder.deleteMany({ where: { workspaceId } })
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  describe('POST /api/workspaces/:workspaceId/conversation-folders', () => {
    it('should create a conversation folder', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversation-folders`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Project Alpha' })

      expect(response.status).toBe(201)
      expect(response.body.data.name).toBe('Project Alpha')
      expect(response.body.data.workspaceId).toBe(workspaceId)
    })

    it('should create a nested folder', async () => {
      const parent = await prisma.conversationFolder.create({
        data: { workspaceId, name: 'Parent', createdById: userId },
      })

      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversation-folders`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Child', parentId: parent.id })

      expect(response.status).toBe(201)
      expect(response.body.data.name).toBe('Child')
      expect(response.body.data.parentId).toBe(parent.id)
    })

    it('should reject empty name', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversation-folders`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '' })

      expect(response.status).toBe(400)
    })

    it('should reject viewer role', async () => {
      const viewer = await prisma.user.create({
        data: { email: `viewer-${Date.now()}@example.com`, name: 'Viewer' },
      })
      await prisma.workspaceMember.create({
        data: { userId: viewer.id, workspaceId, role: 'VIEWER' },
      })

      const jwt = require('jsonwebtoken')
      const viewerToken = jwt.sign(
        { userId: viewer.id, workspaceId },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '24h' }
      )

      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversation-folders`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ name: 'Not Allowed' })

      expect(response.status).toBe(403)

      await prisma.workspaceMember.deleteMany({ where: { userId: viewer.id } })
      await prisma.user.delete({ where: { id: viewer.id } })
    })
  })

  describe('GET /api/workspaces/:workspaceId/conversation-folders', () => {
    beforeEach(async () => {
      const parent = await prisma.conversationFolder.create({
        data: { workspaceId, name: 'Folder A', createdById: userId },
      })
      await prisma.conversationFolder.create({
        data: { workspaceId, name: 'Folder B', createdById: userId },
      })
      await prisma.conversationFolder.create({
        data: { workspaceId, name: 'Child of A', parentId: parent.id, createdById: userId },
      })
    })

    it('should list root folders', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversation-folders`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data).toHaveLength(2)
    })

    it('should list children of a parent', async () => {
      const parent = await prisma.conversationFolder.findFirst({
        where: { workspaceId, name: 'Folder A' },
      })

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversation-folders`)
        .query({ parentId: parent!.id })
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data).toHaveLength(1)
      expect(response.body.data[0].name).toBe('Child of A')
    })
  })

  describe('GET /api/workspaces/:workspaceId/conversation-folders/:folderId', () => {
    it('should get folder by id with conversations', async () => {
      const folder = await prisma.conversationFolder.create({
        data: { workspaceId, name: 'My Folder', createdById: userId },
      })

      await prisma.conversation.create({
        data: {
          workspaceId,
          title: 'Chat in folder',
          folderId: folder.id,
          provider: 'synora',
          model: 'synora-chat',
        },
      })

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversation-folders/${folder.id}`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.name).toBe('My Folder')
      expect(response.body.data.conversations).toHaveLength(1)
      expect(response.body.data.conversations[0].title).toBe('Chat in folder')
    })

    it('should return 404 for nonexistent folder', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversation-folders/nonexistent`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(404)
    })
  })

  describe('PATCH /api/workspaces/:workspaceId/conversation-folders/:folderId', () => {
    let folderId: string

    beforeEach(async () => {
      const folder = await prisma.conversationFolder.create({
        data: { workspaceId, name: 'Original', createdById: userId },
      })
      folderId = folder.id
    })

    it('should rename folder', async () => {
      const response = await request(app)
        .patch(`/api/workspaces/${workspaceId}/conversation-folders/${folderId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Renamed' })

      expect(response.status).toBe(200)
      expect(response.body.data.name).toBe('Renamed')
    })

    it('should prevent setting folder as its own parent', async () => {
      const response = await request(app)
        .patch(`/api/workspaces/${workspaceId}/conversation-folders/${folderId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ parentId: folderId })

      expect(response.status).toBe(403)
    })
  })

  describe('DELETE /api/workspaces/:workspaceId/conversation-folders/:folderId', () => {
    it('should delete folder', async () => {
      const folder = await prisma.conversationFolder.create({
        data: { workspaceId, name: 'To Delete', createdById: userId },
      })

      const response = await request(app)
        .delete(`/api/workspaces/${workspaceId}/conversation-folders/${folder.id}`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.success).toBe(true)

      const found = await prisma.conversationFolder.findUnique({ where: { id: folder.id } })
      expect(found).toBeNull()
    })
  })

  describe('POST /api/workspaces/:workspaceId/conversation-folders/move', () => {
    it('should move conversation into folder', async () => {
      const folder = await prisma.conversationFolder.create({
        data: { workspaceId, name: 'Target', createdById: userId },
      })
      const conversation = await prisma.conversation.create({
        data: { workspaceId, title: 'Moving Chat', provider: 'synora', model: 'synora-chat' },
      })

      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversation-folders/move`)
        .set('Authorization', `Bearer ${token}`)
        .send({ conversationId: conversation.id, folderId: folder.id })

      expect(response.status).toBe(200)

      const updated = await prisma.conversation.findUnique({ where: { id: conversation.id } })
      expect(updated!.folderId).toBe(folder.id)
    })

    it('should move conversation out of folder', async () => {
      const folder = await prisma.conversationFolder.create({
        data: { workspaceId, name: 'Source', createdById: userId },
      })
      const conversation = await prisma.conversation.create({
        data: { workspaceId, title: 'Unfoldering', folderId: folder.id, provider: 'synora', model: 'synora-chat' },
      })

      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversation-folders/move`)
        .set('Authorization', `Bearer ${token}`)
        .send({ conversationId: conversation.id, folderId: null })

      expect(response.status).toBe(200)

      const updated = await prisma.conversation.findUnique({ where: { id: conversation.id } })
      expect(updated!.folderId).toBeNull()
    })

    it('should require conversationId', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversation-folders/move`)
        .set('Authorization', `Bearer ${token}`)
        .send({ folderId: 'some-id' })

      expect(response.status).toBe(400)
    })
  })
})
