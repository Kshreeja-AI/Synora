import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { prisma } from '@synora/database'
import { initializeApp } from '../../src/index'

describe('Tool Secrets Routes', () => {
  let app: any
  let workspaceId: string
  let userId: string
  let token: string
  let toolId: string

  beforeEach(async () => {
    const { app: expressApp } = await initializeApp()
    app = expressApp

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

    const tool = await prisma.toolDefinition.create({
      data: {
        workspaceId,
        name: 'Test Tool',
        displayName: 'Test Tool',
        description: 'A test tool',
        category: 'http',
        type: 'HTTP',
        inputSchema: { type: 'object' },
        config: { apiKey: 'test' },
        createdBy: userId,
      },
    })
    toolId = tool.id

    token = jwt.sign({ userId, workspaceId }, process.env.JWT_SECRET || 'test-secret', {
      expiresIn: '24h',
    })
  })

  afterEach(async () => {
    await prisma.toolSecretAuditLog.deleteMany({ where: { workspaceId } })
    await prisma.toolSecret.deleteMany({ where: { workspaceId } })
    await prisma.toolDefinition.deleteMany({ where: { workspaceId } })
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  describe('POST /api/workspaces/:workspaceId/tools/:toolId/secrets', () => {
    it('should create encrypted secret', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'api-key',
          description: 'OpenAI API Key',
          secretType: 'api_key',
          plaintext: 'sk-1234567890abcdef',
        })

      expect(response.status).toBe(201)
      expect(response.body.data.id).toBeDefined()
      expect(response.body.data.name).toBe('api-key')
      expect(response.body.data.secretType).toBe('api_key')
      expect(response.body.data.description).toBe('OpenAI API Key')

      // Plaintext should never be in response
      expect(response.body.data.plaintext).toBeUndefined()
      expect(response.body.data.encryptedValue).toBeUndefined()
    })

    it('should validate required fields', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'api-key',
          // missing secretType and plaintext
        })

      expect(response.status).toBe(400)
    })

    it('should reject if not authenticated', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets`)
        .send({
          name: 'api-key',
          secretType: 'api_key',
          plaintext: 'secret',
        })

      expect(response.status).toBe(401)
    })

    it('should support optional expiration', async () => {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'api-key',
          secretType: 'api_key',
          plaintext: 'secret',
          expiresAt,
        })

      expect(response.status).toBe(201)
      expect(response.body.data.expiresAt).toBeDefined()
    })

    it('should reject duplicate secret names for same tool', async () => {
      await request(app)
        .post(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'api-key',
          secretType: 'api_key',
          plaintext: 'secret1',
        })

      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'api-key',
          secretType: 'api_key',
          plaintext: 'secret2',
        })

      expect(response.status).toBe(400)
    })
  })

  describe('GET /api/workspaces/:workspaceId/tools/:toolId/secrets', () => {
    beforeEach(async () => {
      await request(app)
        .post(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'key-1',
          secretType: 'api_key',
          plaintext: 'secret1',
        })

      await request(app)
        .post(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'key-2',
          secretType: 'api_key',
          plaintext: 'secret2',
        })
    })

    it('should list all secrets for tool', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data).toHaveLength(2)
      expect(response.body.data.map((s: any) => s.name)).toContain('key-1')
      expect(response.body.data.map((s: any) => s.name)).toContain('key-2')
    })

    it('should not expose plaintext in list', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)

      for (const secret of response.body.data) {
        expect(secret.plaintext).toBeUndefined()
        expect(secret.encryptedValue).toBeUndefined()
      }
    })

    it('should reject if not authenticated', async () => {
      const response = await request(app).get(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets`)

      expect(response.status).toBe(401)
    })
  })

  describe('GET /api/workspaces/:workspaceId/tools/:toolId/secrets/:secretId', () => {
    let secretId: string

    beforeEach(async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'api-key',
          description: 'Test key',
          secretType: 'api_key',
          plaintext: 'secret',
        })

      secretId = response.body.data.id
    })

    it('should get secret metadata', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets/${secretId}`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.id).toBe(secretId)
      expect(response.body.data.name).toBe('api-key')
      expect(response.body.data.description).toBe('Test key')

      // Plaintext should never be exposed
      expect(response.body.data.plaintext).toBeUndefined()
      expect(response.body.data.encryptedValue).toBeUndefined()
    })

    it('should reject if not authenticated', async () => {
      const response = await request(app).get(
        `/api/workspaces/${workspaceId}/tools/${toolId}/secrets/${secretId}`
      )

      expect(response.status).toBe(401)
    })
  })

  describe('PATCH /api/workspaces/:workspaceId/tools/:toolId/secrets/:secretId', () => {
    let secretId: string

    beforeEach(async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'api-key',
          description: 'Old description',
          secretType: 'api_key',
          plaintext: 'old-secret',
        })

      secretId = response.body.data.id
    })

    it('should update description', async () => {
      const response = await request(app)
        .patch(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets/${secretId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          description: 'New description',
        })

      expect(response.status).toBe(200)
      expect(response.body.data.description).toBe('New description')
    })

    it('should rotate plaintext', async () => {
      const response = await request(app)
        .patch(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets/${secretId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          plaintext: 'new-secret',
        })

      expect(response.status).toBe(200)
      expect(response.body.data.lastRotatedAt).toBeDefined()
      expect(response.body.data.isRotationPending).toBe(false)
    })

    it('should validate optional fields', async () => {
      const response = await request(app)
        .patch(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets/${secretId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          plaintext: '', // empty string invalid
        })

      expect(response.status).toBe(400)
    })

    it('should reject if not authenticated', async () => {
      const response = await request(app)
        .patch(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets/${secretId}`)
        .send({
          description: 'New',
        })

      expect(response.status).toBe(401)
    })
  })

  describe('DELETE /api/workspaces/:workspaceId/tools/:toolId/secrets/:secretId', () => {
    let secretId: string

    beforeEach(async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'api-key',
          secretType: 'api_key',
          plaintext: 'secret',
        })

      secretId = response.body.data.id
    })

    it('should delete secret', async () => {
      const response = await request(app)
        .delete(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets/${secretId}`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.success).toBe(true)

      // Verify it's deleted
      const getResponse = await request(app)
        .get(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets/${secretId}`)
        .set('Authorization', `Bearer ${token}`)

      expect(getResponse.status).toBe(404)
    })

    it('should reject if not authenticated', async () => {
      const response = await request(app).delete(
        `/api/workspaces/${workspaceId}/tools/${toolId}/secrets/${secretId}`
      )

      expect(response.status).toBe(401)
    })
  })

  describe('POST /api/workspaces/:workspaceId/tools/:toolId/secrets/:secretId/rotate', () => {
    let secretId: string

    beforeEach(async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'api-key',
          secretType: 'api_key',
          plaintext: 'secret',
        })

      secretId = response.body.data.id
    })

    it('should mark secret for rotation', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets/${secretId}/rotate`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.isRotationPending).toBe(true)
    })

    it('should reject if not authenticated', async () => {
      const response = await request(app).post(
        `/api/workspaces/${workspaceId}/tools/${toolId}/secrets/${secretId}/rotate`
      )

      expect(response.status).toBe(401)
    })
  })

  describe('Access Control', () => {
    let secretId: string
    let otherUserId: string

    beforeEach(async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'api-key',
          secretType: 'api_key',
          plaintext: 'secret',
        })

      secretId = response.body.data.id

      // Create another user not in workspace
      const otherUser = await prisma.user.create({
        data: {
          email: `other-${Date.now()}@example.com`,
          name: 'Other User',
        },
      })
      otherUserId = otherUser.id
    })

    afterEach(async () => {
      await prisma.user.deleteMany({ where: { id: { in: [otherUserId] } } })
    })

    it('should reject access from user not in workspace', async () => {
      const otherToken = jwt.sign({ userId: otherUserId, workspaceId }, process.env.JWT_SECRET || 'test-secret', {
        expiresIn: '24h',
      })

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/tools/${toolId}/secrets/${secretId}`)
        .set('Authorization', `Bearer ${otherToken}`)

      expect(response.status).toBe(404)
    })
  })
})
