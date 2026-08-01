import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@synora/database'
import { streamingService } from '../../src/services/streaming.service'
import { conversationService } from '../../src/services/conversation.service'
import { StreamingJobStatus } from '@prisma/client'

describe('StreamingService', () => {
  let workspaceId: string
  let userId: string
  let conversationId: string
  let jobId: string

  beforeEach(async () => {
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

    const conversation = await conversationService.create(userId, workspaceId, {
      title: 'Test Conversation',
      provider: 'anthropic',
      model: 'claude-3-sonnet',
    })
    conversationId = conversation.id
  })

  afterEach(async () => {
    await prisma.streamingJob.deleteMany({ where: { conversationId } })
    await prisma.conversation.deleteMany({ where: { id: conversationId } })
    await prisma.workspaceMember.deleteMany({ where: { userId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  describe('createJob', () => {
    it('should create a streaming job', async () => {
      const result = await streamingService.createJob({ conversationId })

      expect(result.id).toBeDefined()
      expect(result.conversationId).toBe(conversationId)
      expect(result.status).toBe(StreamingJobStatus.PENDING)
      jobId = result.id
    })
  })

  describe('getJob', () => {
    beforeEach(async () => {
      const job = await streamingService.createJob({ conversationId })
      jobId = job.id
    })

    it('should get job by id', async () => {
      const result = await streamingService.getJob(jobId)

      expect(result).toBeDefined()
      expect(result?.id).toBe(jobId)
    })

    it('should return null for non-existent job', async () => {
      const result = await streamingService.getJob('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('job state transitions', () => {
    beforeEach(async () => {
      const job = await streamingService.createJob({ conversationId })
      jobId = job.id
    })

    it('should transition to RUNNING', async () => {
      const result = await streamingService.startJob(jobId)
      expect(result.status).toBe(StreamingJobStatus.RUNNING)
    })

    it('should transition to COMPLETED', async () => {
      await streamingService.startJob(jobId)
      const result = await streamingService.completeJob(jobId)

      expect(result.status).toBe(StreamingJobStatus.COMPLETED)
      expect(result.completedAt).toBeDefined()
    })

    it('should transition to FAILED', async () => {
      const result = await streamingService.failJob(jobId)

      expect(result.status).toBe(StreamingJobStatus.FAILED)
      expect(result.completedAt).toBeDefined()
    })

    it('should transition to CANCELED', async () => {
      const result = await streamingService.cancelJob(jobId)

      expect(result.status).toBe(StreamingJobStatus.CANCELED)
      expect(result.completedAt).toBeDefined()
    })
  })

  describe('getActiveJob', () => {
    it('should get active job for conversation', async () => {
      const job = await streamingService.createJob({ conversationId })
      await streamingService.startJob(job.id)

      const result = await streamingService.getActiveJob(conversationId)

      expect(result?.id).toBe(job.id)
      expect(result?.status).toBe(StreamingJobStatus.RUNNING)
    })

    it('should return null if no active job', async () => {
      const result = await streamingService.getActiveJob(conversationId)
      expect(result).toBeNull()
    })
  })

  describe('getJobHistory', () => {
    beforeEach(async () => {
      for (let i = 0; i < 3; i++) {
        await streamingService.createJob({ conversationId })
      }
    })

    it('should get job history', async () => {
      const result = await streamingService.getJobHistory(conversationId)

      expect(result.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('cleanupStaleJobs', () => {
    it('should cleanup stale jobs', async () => {
      const job = await streamingService.createJob({ conversationId })
      await streamingService.startJob(job.id)

      await prisma.streamingJob.update({
        where: { id: job.id },
        data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
      })

      const cleaned = await streamingService.cleanupStaleJobs(24 * 60 * 60 * 1000)

      expect(cleaned).toBeGreaterThan(0)

      const cleanedJob = await streamingService.getJob(job.id)
      expect(cleanedJob?.status).toBe(StreamingJobStatus.FAILED)
    })
  })
})
