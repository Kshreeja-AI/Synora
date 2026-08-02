import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { prisma } from '@synora/database'
import { initializeApp } from '../../src/index'

/**
 * Conversation file routes: the full user loop — upload, list,
 * download, delete — plus the two security gates that must never
 * regress: infected files are refused, and a file can't be pulled
 * through a different conversation's URL.
 */
describe('Conversation Files Routes', () => {
  let app: any
  let workspaceId: string
  let userId: string
  let token: string
  let conversationId: string
  let otherConversationId: string

  beforeEach(async () => {
    const { app: expressApp } = await initializeApp()
    app = expressApp

    const user = await prisma.user.create({
      data: {
        email: `test-files-${Date.now()}@example.com`,
        name: 'Test User',
      },
    })
    userId = user.id

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-ws-files-${Date.now()}`,
      },
    })
    workspaceId = workspace.id

    await prisma.workspaceMember.create({
      data: { userId, workspaceId, role: 'OWNER' },
    })

    const conversation = await prisma.conversation.create({
      data: {
        workspaceId,
        title: 'Files Test Conversation',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
      },
    })
    conversationId = conversation.id

    const other = await prisma.conversation.create({
      data: {
        workspaceId,
        title: 'Other Conversation',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
      },
    })
    otherConversationId = other.id

    token = jwt.sign({ userId, workspaceId }, process.env.JWT_SECRET || 'test-secret', {
      expiresIn: '24h',
    })
  })

  afterEach(async () => {
    await prisma.fileProcessingJob.deleteMany({
      where: { file: { workspaceId } },
    })
    await prisma.conversationFile.deleteMany({ where: { workspaceId } })
    await prisma.conversation.deleteMany({ where: { workspaceId } })
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  const uploadFile = (content: string, name = 'notes.txt') =>
    request(app)
      .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/files`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(content, 'utf-8'), { filename: name, contentType: 'text/plain' })

  describe('POST /files (upload)', () => {
    it('uploads a file and creates a PENDING record', async () => {
      const response = await uploadFile('hello attachments')

      expect(response.status).toBe(201)
      expect(response.body.data.id).toBeDefined()
      expect(response.body.data.fileName).toBe('notes.txt')

      const record = await prisma.conversationFile.findUnique({
        where: { id: response.body.data.id },
      })
      expect(record).not.toBeNull()
      expect(record!.processingStatus).toBe('PENDING')
      expect(record!.virusScanStatus).toBe('PENDING')
      expect(record!.fileSize).toBe(Buffer.byteLength('hello attachments'))
    })

    it('rejects an upload with no file attached', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/files`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(400)
    })

    it('requires authentication', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/files`)
        .attach('file', Buffer.from('x'), { filename: 'x.txt', contentType: 'text/plain' })

      expect(response.status).toBe(401)
    })
  })

  describe('GET /files (list)', () => {
    it('lists uploaded files with pipeline status fields', async () => {
      await uploadFile('list me')

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/files`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.items).toHaveLength(1)
      const item = response.body.data.items[0]
      expect(item.fileName).toBe('notes.txt')
      expect(item.processingStatus).toBeDefined()
      expect(item.virusScanStatus).toBeDefined()
      // Storage layout must never leak to clients.
      expect(item.storageKey).toBeUndefined()
    })
  })

  describe('GET /files/:fileId/download', () => {
    it('round-trips uploaded bytes with attachment headers', async () => {
      const uploaded = await uploadFile('round trip payload')
      const fileId = uploaded.body.data.id

      const response = await request(app)
        .get(
          `/api/workspaces/${workspaceId}/conversations/${conversationId}/files/${fileId}/download`
        )
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toContain('text/plain')
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expect(response.headers['content-disposition']).toContain('attachment')
      expect(response.text).toBe('round trip payload')
    })

    it('refuses to serve a file flagged by the virus scan', async () => {
      const uploaded = await uploadFile('malicious payload')
      const fileId = uploaded.body.data.id

      await prisma.conversationFile.update({
        where: { id: fileId },
        data: { virusScanStatus: 'INFECTED' },
      })

      const response = await request(app)
        .get(
          `/api/workspaces/${workspaceId}/conversations/${conversationId}/files/${fileId}/download`
        )
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(403)
    })

    it('returns 404 when the file is addressed through a different conversation', async () => {
      const uploaded = await uploadFile('scoped payload')
      const fileId = uploaded.body.data.id

      const response = await request(app)
        .get(
          `/api/workspaces/${workspaceId}/conversations/${otherConversationId}/files/${fileId}/download`
        )
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(404)
    })

    it('returns 404 for a nonexistent file', async () => {
      const response = await request(app)
        .get(
          `/api/workspaces/${workspaceId}/conversations/${conversationId}/files/nonexistent/download`
        )
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(404)
    })
  })

  describe('DELETE /files/:fileId', () => {
    it('deletes a file and removes it from the list', async () => {
      const uploaded = await uploadFile('delete me')
      const fileId = uploaded.body.data.id

      const del = await request(app)
        .delete(
          `/api/workspaces/${workspaceId}/conversations/${conversationId}/files/${fileId}`
        )
        .set('Authorization', `Bearer ${token}`)

      expect(del.status).toBe(200)

      const list = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/files`)
        .set('Authorization', `Bearer ${token}`)

      expect(list.body.data.items).toHaveLength(0)
    })
  })
})
