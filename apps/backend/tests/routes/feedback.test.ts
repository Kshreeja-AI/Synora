import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import type { AppConfig } from '../../src/config/types'

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

describe('Feedback Routes', () => {
  let app: any
  let testUserId: string
  let testWorkspaceId: string

  beforeEach(() => {
    app = createApp(mockConfig)

    testUserId = 'test-user-123'
    testWorkspaceId = 'test-workspace-123'

    vi.mock('../../src/middleware/auth', () => ({
      authMiddleware: (req: any, res: any, next: any) => {
        req.userId = testUserId
        req.workspaceId = testWorkspaceId
        next()
      },
    }))
  })

  describe('POST /api/:workspaceId/feedback/messages', () => {
    it('should create message feedback', async () => {
      const response = await request(app)
        .post(`/api/${testWorkspaceId}/feedback/messages`)
        .set('Authorization', `Bearer test-token`)
        .send({
          messageId: 'msg-123',
          conversationId: 'conv-123',
          rating: 5,
          feedbackType: 'RATING',
          comment: 'Great response'
        })
        .expect(201)

      expect(response.body.data).toBeDefined()
      expect(response.body.data.rating).toBe(5)
    })

    it('should validate rating range', async () => {
      const response = await request(app)
        .post(`/api/${testWorkspaceId}/feedback/messages`)
        .set('Authorization', `Bearer test-token`)
        .send({
          messageId: 'msg-123',
          conversationId: 'conv-123',
          rating: 6,
          feedbackType: 'RATING'
        })
        .expect(400)

      expect(response.body.error).toBeDefined()
    })

    it('should allow helpful feedback without rating', async () => {
      const response = await request(app)
        .post(`/api/${testWorkspaceId}/feedback/messages`)
        .set('Authorization', `Bearer test-token`)
        .send({
          messageId: 'msg-123',
          conversationId: 'conv-123',
          isHelpful: true,
          feedbackType: 'HELPFUL'
        })
        .expect(201)

      expect(response.body.data).toBeDefined()
      expect(response.body.data.isHelpful).toBe(true)
    })
  })

  describe('GET /api/:workspaceId/conversations/:conversationId/feedback/messages', () => {
    it('should list message feedback', async () => {
      const response = await request(app)
        .get(`/api/${testWorkspaceId}/conversations/conv-123/feedback/messages`)
        .set('Authorization', `Bearer test-token`)
        .expect(200)

      expect(response.body.data).toBeDefined()
      expect(Array.isArray(response.body.data.items)).toBe(true)
    })

    it('should support pagination', async () => {
      const response = await request(app)
        .get(`/api/${testWorkspaceId}/conversations/conv-123/feedback/messages?skip=0&take=10`)
        .set('Authorization', `Bearer test-token`)
        .expect(200)

      expect(response.body.data.skip).toBe(0)
      expect(response.body.data.take).toBe(10)
    })
  })

  describe('GET /api/:workspaceId/conversations/:conversationId/feedback/stats', () => {
    it('should return feedback statistics', async () => {
      const response = await request(app)
        .get(`/api/${testWorkspaceId}/conversations/conv-123/feedback/stats`)
        .set('Authorization', `Bearer test-token`)
        .expect(200)

      expect(response.body.data).toBeDefined()
      expect(response.body.data.totalFeedback).toBeDefined()
      expect(response.body.data.helpfulCount).toBeDefined()
      expect(response.body.data.unhelpfulCount).toBeDefined()
      expect(response.body.data.averageRating).toBeDefined()
    })
  })

  describe('POST /api/:workspaceId/feedback/conversations', () => {
    it('should create conversation feedback', async () => {
      const response = await request(app)
        .post(`/api/${testWorkspaceId}/feedback/conversations`)
        .set('Authorization', `Bearer test-token`)
        .send({
          conversationId: 'conv-123',
          overallRating: 4,
          isUseful: true,
          comment: 'Very helpful conversation'
        })
        .expect(201)

      expect(response.body.data).toBeDefined()
      expect(response.body.data.overallRating).toBe(4)
    })

    it('should validate quality score range', async () => {
      const response = await request(app)
        .post(`/api/${testWorkspaceId}/feedback/conversations`)
        .set('Authorization', `Bearer test-token`)
        .send({
          conversationId: 'conv-123',
          qualityScore: 101
        })
        .expect(400)

      expect(response.body.error).toBeDefined()
    })
  })

  describe('POST /api/:workspaceId/feedback/corrections', () => {
    it('should create correction', async () => {
      const response = await request(app)
        .post(`/api/${testWorkspaceId}/feedback/corrections`)
        .set('Authorization', `Bearer test-token`)
        .send({
          messageId: 'msg-123',
          conversationId: 'conv-123',
          originalContent: 'The capital of France is London',
          correctedContent: 'The capital of France is Paris',
          correctionType: 'FACTUAL_ERROR',
          reason: 'Factually incorrect'
        })
        .expect(201)

      expect(response.body.data).toBeDefined()
      expect(response.body.data.correctionType).toBe('FACTUAL_ERROR')
    })

    it('should validate correction type', async () => {
      const response = await request(app)
        .post(`/api/${testWorkspaceId}/feedback/corrections`)
        .set('Authorization', `Bearer test-token`)
        .send({
          messageId: 'msg-123',
          conversationId: 'conv-123',
          originalContent: 'Original',
          correctedContent: 'Corrected',
          correctionType: 'INVALID_TYPE'
        })
        .expect(400)

      expect(response.body.error).toBeDefined()
    })
  })

  describe('POST /api/:workspaceId/feedback/hallucinations', () => {
    it('should report hallucination', async () => {
      const response = await request(app)
        .post(`/api/${testWorkspaceId}/feedback/hallucinations`)
        .set('Authorization', `Bearer test-token`)
        .send({
          messageId: 'msg-123',
          conversationId: 'conv-123',
          hallucinatedText: 'This product was invented in 2050',
          factualCorrection: 'This product was invented in 2020',
          severity: 'HIGH',
          category: 'INVENTED_INFORMATION'
        })
        .expect(201)

      expect(response.body.data).toBeDefined()
      expect(response.body.data.severity).toBe('HIGH')
    })

    it('should validate severity enum', async () => {
      const response = await request(app)
        .post(`/api/${testWorkspaceId}/feedback/hallucinations`)
        .set('Authorization', `Bearer test-token`)
        .send({
          messageId: 'msg-123',
          conversationId: 'conv-123',
          hallucinatedText: 'Text',
          factualCorrection: 'Correct',
          severity: 'UNKNOWN',
          category: 'FACTUAL_ERROR'
        })
        .expect(400)

      expect(response.body.error).toBeDefined()
    })
  })

  describe('POST /api/:workspaceId/feedback/preferences', () => {
    it('should create preference', async () => {
      const response = await request(app)
        .post(`/api/${testWorkspaceId}/feedback/preferences`)
        .set('Authorization', `Bearer test-token`)
        .send({
          conversationId: 'conv-123',
          preferredMessageId: 'msg-456',
          rejectedMessageId: 'msg-789',
          preferenceType: 'CLARITY'
        })
        .expect(201)

      expect(response.body.data).toBeDefined()
      expect(response.body.data.preferenceType).toBe('CLARITY')
    })

    it('should validate preference type', async () => {
      const response = await request(app)
        .post(`/api/${testWorkspaceId}/feedback/preferences`)
        .set('Authorization', `Bearer test-token`)
        .send({
          conversationId: 'conv-123',
          preferredMessageId: 'msg-456',
          rejectedMessageId: 'msg-789',
          preferenceType: 'INVALID'
        })
        .expect(400)

      expect(response.body.error).toBeDefined()
    })
  })
})
