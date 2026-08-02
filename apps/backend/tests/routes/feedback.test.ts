import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { prisma } from '@synora/database'
import { initializeApp } from '../../src/index'

describe('Feedback Routes', () => {
  let app: any
  let workspaceId: string
  let userId: string
  let token: string
  let conversationId: string
  let messageId: string
  let otherMessageId: string

  beforeEach(async () => {
    const { app: expressApp } = await initializeApp()
    app = expressApp

    const user = await prisma.user.create({
      data: {
        email: `test-feedback-${Date.now()}@example.com`,
        name: 'Test User',
      },
    })
    userId = user.id

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-ws-feedback-${Date.now()}`,
      },
    })
    workspaceId = workspace.id

    await prisma.workspaceMember.create({
      data: { userId, workspaceId, role: 'OWNER' },
    })

    const conversation = await prisma.conversation.create({
      data: {
        workspaceId,
        title: 'Test Conversation',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
      },
    })
    conversationId = conversation.id

    const message = await prisma.message.create({
      data: {
        conversationId,
        content: 'Hello there',
        role: 'ASSISTANT',
      },
    })
    messageId = message.id

    const otherMessage = await prisma.message.create({
      data: {
        conversationId,
        content: 'A different reply',
        role: 'ASSISTANT',
      },
    })
    otherMessageId = otherMessage.id

    token = jwt.sign({ userId, workspaceId }, process.env.JWT_SECRET || 'test-secret', {
      expiresIn: '24h',
    })
  })

  afterEach(async () => {
    await prisma.preferredResponse.deleteMany({ where: { workspaceId } })
    await prisma.hallucinationReport.deleteMany({ where: { workspaceId } })
    await prisma.correction.deleteMany({ where: { workspaceId } })
    await prisma.conversationFeedback.deleteMany({ where: { workspaceId } })
    await prisma.messageFeedback.deleteMany({ where: { workspaceId } })
    await prisma.message.deleteMany({ where: { conversationId } })
    await prisma.conversation.deleteMany({ where: { workspaceId } })
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  describe('POST /api/workspaces/:workspaceId/feedback/messages', () => {
    it('should create message feedback', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/feedback/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          messageId,
          conversationId,
          rating: 5,
          feedbackType: 'RATING',
          comment: 'Great response',
        })
        .expect(201)

      expect(response.body.data).toBeDefined()
      expect(response.body.data.rating).toBe(5)
    })

    it('should validate rating range', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/feedback/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          messageId,
          conversationId,
          rating: 6,
          feedbackType: 'RATING',
        })
        .expect(400)

      expect(response.body.error).toBeDefined()
    })

    it('should allow helpful feedback without rating', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/feedback/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          messageId,
          conversationId,
          isHelpful: true,
          feedbackType: 'HELPFUL',
        })
        .expect(201)

      expect(response.body.data).toBeDefined()
      expect(response.body.data.isHelpful).toBe(true)
    })
  })

  describe('GET /api/workspaces/:workspaceId/conversations/:conversationId/feedback/messages', () => {
    it('should list message feedback', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/feedback/messages`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(response.body.data).toBeDefined()
      expect(Array.isArray(response.body.data.items)).toBe(true)
    })

    it('should support pagination', async () => {
      const response = await request(app)
        .get(
          `/api/workspaces/${workspaceId}/conversations/${conversationId}/feedback/messages?skip=0&take=10`
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(response.body.data.skip).toBe(0)
      expect(response.body.data.take).toBe(10)
    })
  })

  describe('GET /api/workspaces/:workspaceId/conversations/:conversationId/feedback/stats', () => {
    it('should return feedback statistics', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/feedback/stats`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(response.body.data).toBeDefined()
      expect(response.body.data.totalFeedback).toBeDefined()
      expect(response.body.data.helpfulCount).toBeDefined()
      expect(response.body.data.unhelpfulCount).toBeDefined()
      expect(response.body.data.averageRating).toBeDefined()
    })
  })

  describe('POST /api/workspaces/:workspaceId/feedback/conversations', () => {
    it('should create conversation feedback', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/feedback/conversations`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          overallRating: 4,
          isUseful: true,
          comment: 'Very helpful conversation',
        })
        .expect(201)

      expect(response.body.data).toBeDefined()
      expect(response.body.data.overallRating).toBe(4)
    })

    it('should validate quality score range', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/feedback/conversations`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          qualityScore: 101,
        })
        .expect(400)

      expect(response.body.error).toBeDefined()
    })
  })

  describe('POST /api/workspaces/:workspaceId/feedback/corrections', () => {
    it('should create correction', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/feedback/corrections`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          messageId,
          conversationId,
          originalContent: 'The capital of France is London',
          correctedContent: 'The capital of France is Paris',
          correctionType: 'FACTUAL_ERROR',
          reason: 'Factually incorrect',
        })
        .expect(201)

      expect(response.body.data).toBeDefined()
      expect(response.body.data.correctionType).toBe('FACTUAL_ERROR')
    })

    it('should validate correction type', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/feedback/corrections`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          messageId,
          conversationId,
          originalContent: 'Original',
          correctedContent: 'Corrected',
          correctionType: 'INVALID_TYPE',
        })
        .expect(400)

      expect(response.body.error).toBeDefined()
    })
  })

  describe('POST /api/workspaces/:workspaceId/feedback/hallucinations', () => {
    it('should report hallucination', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/feedback/hallucinations`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          messageId,
          conversationId,
          hallucinatedText: 'This product was invented in 2050',
          factualCorrection: 'This product was invented in 2020',
          severity: 'HIGH',
          category: 'INVENTED_INFORMATION',
        })
        .expect(201)

      expect(response.body.data).toBeDefined()
      expect(response.body.data.severity).toBe('HIGH')
    })

    it('should validate severity enum', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/feedback/hallucinations`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          messageId,
          conversationId,
          hallucinatedText: 'Text',
          factualCorrection: 'Correct',
          severity: 'UNKNOWN',
          category: 'FACTUAL_ERROR',
        })
        .expect(400)

      expect(response.body.error).toBeDefined()
    })
  })

  describe('POST /api/workspaces/:workspaceId/feedback/preferences', () => {
    it('should create preference', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/feedback/preferences`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          preferredMessageId: messageId,
          rejectedMessageId: otherMessageId,
          preferenceType: 'CLARITY',
        })
        .expect(201)

      expect(response.body.data).toBeDefined()
      expect(response.body.data.preferenceType).toBe('CLARITY')
    })

    it('should validate preference type', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/feedback/preferences`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          preferredMessageId: messageId,
          rejectedMessageId: otherMessageId,
          preferenceType: 'INVALID',
        })
        .expect(400)

      expect(response.body.error).toBeDefined()
    })
  })
})
