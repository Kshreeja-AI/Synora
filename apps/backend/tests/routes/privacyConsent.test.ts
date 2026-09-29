import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { prisma } from '@synora/database'
import { initializeApp } from '../../src/index'

describe('Privacy Consent Routes', () => {
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
        email: `test-privacy-${Date.now()}@example.com`,
        name: 'Test User',
      },
    })
    userId = user.id

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-ws-privacy-${Date.now()}`,
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

    token = jwt.sign({ userId, workspaceId }, process.env.JWT_SECRET || 'test-secret', {
      expiresIn: '24h',
    })
  })

  afterEach(async () => {
    await prisma.trainingConsent.deleteMany({ where: { workspaceId } })
    await prisma.privacyConsent.deleteMany({ where: { workspaceId } })
    await prisma.conversation.deleteMany({ where: { workspaceId } })
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  describe('POST /api/workspaces/:workspaceId/privacy/consent', () => {
    it('should set user consent for workspace', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/privacy/consent`)
        .set('Authorization', `Bearer ${token}`)
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
      await request(app)
        .post(`/api/workspaces/${workspaceId}/privacy/consent`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          collectFeedback: true,
          useForTraining: false,
        })

      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/privacy/consent`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          collectFeedback: false,
          useForTraining: true,
        })

      expect(response.status).toBe(200)
      expect(response.body.data.useForTraining).toBe(true)
    })

    it('should validate zod schema', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/privacy/consent`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          collectFeedback: 'not-a-boolean',
        })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe('GET /api/workspaces/:workspaceId/privacy/consent', () => {
    it('should get user consent for workspace', async () => {
      await request(app)
        .post(`/api/workspaces/${workspaceId}/privacy/consent`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          collectFeedback: true,
          useForTraining: true,
        })

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/privacy/consent`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.collectFeedback).toBe(true)
    })

    it('should return 404 if consent not found', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/privacy/consent`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(404)
    })
  })

  describe('POST /api/workspaces/:workspaceId/privacy/consent/revoke', () => {
    it('should revoke user consent', async () => {
      await request(app)
        .post(`/api/workspaces/${workspaceId}/privacy/consent`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          collectFeedback: true,
          useForTraining: true,
        })

      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/privacy/consent/revoke`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.success).toBe(true)
    })
  })

  describe('POST /api/workspaces/:workspaceId/conversations/:conversationId/training-consent', () => {
    it('should set conversation training consent', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/training-consent`)
        .set('Authorization', `Bearer ${token}`)
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
      await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/training-consent`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          allowUseInTraining: true,
          allowUseInEvaluation: true,
        })

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/training-consent`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.allowUseInTraining).toBe(true)
    })
  })

  describe('POST /api/workspaces/:workspaceId/privacy/delete-data', () => {
    it('should delete user data for GDPR compliance', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/privacy/delete-data`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.deletedCount).toBeGreaterThanOrEqual(0)
    })
  })
})
