import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import type { AppConfig } from '../../src/config/types'
import { prisma } from '@synora/database'

const mockConfig: AppConfig = {
  stage: 'test',
  modes: [],
  server: {
    port: 3001,
    corsOrigins: ['http://localhost:3000'],
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    maxRequests: 100,
  },
  jwt: {
    secret: 'test-secret',
    expiresIn: '15m',
  },
  storage: {
    provider: 'local',
    publicBasePath: '/uploads',
    localDirectory: './uploads',
  },
}

describe('Privacy Consent Routes', () => {
  let app: any
  let testUserId: string
  let testWorkspaceId: string
  let testToken: string

  beforeEach(async () => {
    app = createApp(mockConfig)

    // Mock auth token verification
    vi.mock('../../src/middleware/auth', () => ({
      authMiddleware: (req: any, res: any, next: any) => {
        req.userId = testUserId
        req.workspaceId = testWorkspaceId
        next()
      },
    }))

    // Setup test data
    testUserId = 'test-user-123'
    testWorkspaceId = 'test-workspace-123'
    testToken = 'Bearer test-token'
  })

  describe('POST /api/workspaces/:workspaceId/privacy/consent', () => {
    it('should set user consent for workspace', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/privacy/consent`)
        .set('Authorization', testToken)
        .send({
          collectFeedback: true,
          useForTraining: true,
          shareWithPartners: false,
          allowEvaluation: true,
        })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data).toBeDefined()
    })

    it('should update existing consent', async () => {
      // First consent
      await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/privacy/consent`)
        .set('Authorization', testToken)
        .send({
          collectFeedback: true,
          useForTraining: false,
        })

      // Update consent
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/privacy/consent`)
        .set('Authorization', testToken)
        .send({
          collectFeedback: false,
          useForTraining: true,
        })

      expect(response.status).toBe(200)
      expect(response.body.data.useForTraining).toBe(true)
    })

    it('should validate zod schema', async () => {
      const response = await request(app)
        .post(`/api/workspaceId/${testWorkspaceId}/privacy/consent`)
        .set('Authorization', testToken)
        .send({
          collectFeedback: 'not-a-boolean',
        })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe('GET /api/workspaces/:workspaceId/privacy/consent', () => {
    it('should get user consent for workspace', async () => {
      // Set consent first
      await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/privacy/consent`)
        .set('Authorization', testToken)
        .send({
          collectFeedback: true,
          useForTraining: true,
        })

      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/privacy/consent`)
        .set('Authorization', testToken)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.collectFeedback).toBe(true)
    })

    it('should return 404 if consent not found', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/privacy/consent`)
        .set('Authorization', testToken)

      expect(response.status).toBe(404)
    })
  })

  describe('POST /api/workspaces/:workspaceId/privacy/consent/revoke', () => {
    it('should revoke user consent', async () => {
      // Set consent first
      await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/privacy/consent`)
        .set('Authorization', testToken)
        .send({
          collectFeedback: true,
          useForTraining: true,
        })

      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/privacy/consent/revoke`)
        .set('Authorization', testToken)

      expect(response.status).toBe(200)
      expect(response.body.data.success).toBe(true)
    })
  })

  describe('POST /api/workspaces/:workspaceId/conversations/:conversationId/training-consent', () => {
    it('should set conversation training consent', async () => {
      const conversationId = 'test-conv-123'

      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/conversations/${conversationId}/training-consent`)
        .set('Authorization', testToken)
        .send({
          allowUseInTraining: true,
          allowUseInEvaluation: false,
        })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
    })
  })

  describe('GET /api/workspaces/:workspaceId/conversations/:conversationId/training-consent', () => {
    it('should get conversation training consent', async () => {
      const conversationId = 'test-conv-123'

      // Set consent first
      await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/conversations/${conversationId}/training-consent`)
        .set('Authorization', testToken)
        .send({
          allowUseInTraining: true,
          allowUseInEvaluation: true,
        })

      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/conversations/${conversationId}/training-consent`)
        .set('Authorization', testToken)

      expect(response.status).toBe(200)
      expect(response.body.data.allowUseInTraining).toBe(true)
    })
  })

  describe('POST /api/workspaces/:workspaceId/privacy/delete-data', () => {
    it('should delete user data for GDPR compliance', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/privacy/delete-data`)
        .set('Authorization', testToken)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.deletedCount).toBeGreaterThanOrEqual(0)
    })
  })
})
