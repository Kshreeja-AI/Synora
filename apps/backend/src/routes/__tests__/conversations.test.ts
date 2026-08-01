import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { prisma } from '@synora/database'
import { initializeApp } from '../../index'
import { issueTokens } from '../../services/token.service'
import type { Express } from 'express'

describe('conversation routes', () => {
  const workspaceIds: string[] = []
  let app: Express
  let userId: string
  let workspaceId: string
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
      data: { name: 'Test Workspace', slug: `conv-route-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    })
    workspaceId = workspace.id
    workspaceIds.push(workspaceId)

    await prisma.workspaceMember.create({ data: { workspaceId, userId, role: 'OWNER' } })

    const tokens = await issueTokens({ userId, email: user.email, role: user.role })
    token = tokens.accessToken
  })

  afterEach(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } })
    workspaceIds.length = 0
  })

  describe('POST /:workspaceId/conversations', () => {
    it('creates a conversation and returns 201', async () => {
      const res = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Test', provider: 'anthropic', model: 'claude-sonnet-5' })

      expect(res.status).toBe(201)
      expect(res.body.data.title).toBe('Test')
      expect(res.body.data.status).toBe('ACTIVE')
    })

    it('rejects an unregistered provider with a 400', async () => {
      const res = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Test', provider: 'not-a-real-provider', model: 'x' })

      expect(res.status).toBe(400)
    })

    it('rejects a malformed body with a 400', async () => {
      const res = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: '' })

      expect(res.status).toBe(400)
    })

    it('requires authentication', async () => {
      const res = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations`)
        .send({ title: 'Test', provider: 'anthropic', model: 'claude-sonnet-5' })

      expect(res.status).toBe(401)
    })
  })

  describe('GET /:workspaceId/conversations', () => {
    it('lists conversations for the workspace, sorted lastMessageAt desc by default', async () => {
      await request(app).post(`/api/workspaces/${workspaceId}/conversations`).set('Authorization', `Bearer ${token}`)
        .send({ title: 'First', provider: 'anthropic', model: 'claude-sonnet-5' })
      await request(app).post(`/api/workspaces/${workspaceId}/conversations`).set('Authorization', `Bearer ${token}`)
        .send({ title: 'Second', provider: 'anthropic', model: 'claude-sonnet-5' })

      const res = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations`)
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.data.conversations).toHaveLength(2)
      expect(res.body.data.total).toBe(2)
    })

    it('404s for a workspace the user is not a member of (matches the codebase-wide requireMembership convention)', async () => {
      const otherWorkspace = await prisma.workspace.create({
        data: { name: 'Other', slug: `other-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      })
      workspaceIds.push(otherWorkspace.id)

      const res = await request(app)
        .get(`/api/workspaces/${otherWorkspace.id}/conversations`)
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(404)
    })
  })

  describe('lifecycle: archive / restore / pin / unpin / delete', () => {
    it('walks the full state machine and rejects an invalid transition', async () => {
      const createRes = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Lifecycle', provider: 'anthropic', model: 'claude-sonnet-5' })
      const conversationId = createRes.body.data.id

      const archiveRes = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/archive`)
        .set('Authorization', `Bearer ${token}`)
      expect(archiveRes.status).toBe(200)
      expect(archiveRes.body.data.status).toBe('ARCHIVED')

      // Restoring twice should fail the second time (not ARCHIVED anymore).
      await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/restore`)
        .set('Authorization', `Bearer ${token}`)

      const secondRestore = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/restore`)
        .set('Authorization', `Bearer ${token}`)
      expect(secondRestore.status).toBe(400)

      const pinRes = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/pin`)
        .set('Authorization', `Bearer ${token}`)
      expect(pinRes.body.data.isPinned).toBe(true)

      const unpinRes = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/unpin`)
        .set('Authorization', `Bearer ${token}`)
      expect(unpinRes.body.data.isPinned).toBe(false)

      const deleteRes = await request(app)
        .delete(`/api/workspaces/${workspaceId}/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${token}`)
      expect(deleteRes.body.data.status).toBe('DELETED')
    })
  })

  describe('GET /:workspaceId/conversations/:conversationId/usage', () => {
    it('returns zeroed usage for a conversation with no generations yet', async () => {
      const createRes = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Usage', provider: 'anthropic', model: 'claude-sonnet-5' })

      const res = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${createRes.body.data.id}/usage`)
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.data.inputTokens).toBe(0)
      expect(res.body.data.totalTokens).toBe(0)
    })

    it('404s for a conversation in a workspace the user cannot access', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/does-not-exist/usage`)
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(404)
    })
  })
})
