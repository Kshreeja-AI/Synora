/**
 * A queue outage must not leave a streaming job RUNNING forever.
 *
 * enqueueGeneration deliberately does not throw when the queue is down —
 * the user's message is already saved. But the job record it created has no
 * worker behind it, so it has to be marked FAILED: otherwise the client
 * subscribes to a stream nobody will ever publish to.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Message } from '@prisma/client'

const db = vi.hoisted(() => ({
  conversation: { findUnique: vi.fn() },
  streamingJob: { create: vi.fn(), update: vi.fn() },
}))
const enqueueGenerateResponse = vi.hoisted(() => vi.fn())

vi.mock('@synora/database', () => ({ prisma: db }))
vi.mock('../../workers/queue', () => ({ enqueueGenerateResponse }))
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { messageService } from '../message.service'

const userMessage = { id: 'msg-user' } as Message
const assistantMessage = { id: 'msg-assistant' } as Message

beforeEach(() => {
  vi.clearAllMocks()
  db.conversation.findUnique.mockResolvedValue({ id: 'conv-1', provider: 'groq', model: 'm' })
  db.streamingJob.create.mockResolvedValue({ id: 'job-1' })
  db.streamingJob.update.mockResolvedValue({ id: 'job-1' })
})

describe('messageService.enqueueGeneration', () => {
  it('leaves the job RUNNING when the queue accepts it', async () => {
    enqueueGenerateResponse.mockResolvedValue('bull-1')

    await messageService.enqueueGeneration('conv-1', userMessage, assistantMessage, 'user-1')

    expect(enqueueGenerateResponse).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1', messageId: 'msg-assistant', userId: 'user-1' })
    )
    expect(db.streamingJob.update).not.toHaveBeenCalled()
  })

  it('marks the job FAILED, with the reason, when the queue is unavailable', async () => {
    enqueueGenerateResponse.mockRejectedValue(new Error('queue unavailable'))

    await expect(
      messageService.enqueueGeneration('conv-1', userMessage, assistantMessage, 'user-1')
    ).resolves.toBeUndefined()

    expect(db.streamingJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'FAILED', lastError: 'queue unavailable', completedAt: expect.any(Date) },
    })
  })

  it('does not try to fail a job that was never created', async () => {
    db.conversation.findUnique.mockResolvedValue(null)

    await messageService.enqueueGeneration('conv-1', userMessage, assistantMessage, 'user-1')

    expect(db.streamingJob.create).not.toHaveBeenCalled()
    expect(db.streamingJob.update).not.toHaveBeenCalled()
  })

  it('still does not throw if marking the job FAILED also fails', async () => {
    enqueueGenerateResponse.mockRejectedValue(new Error('queue unavailable'))
    db.streamingJob.update.mockRejectedValue(new Error('database unavailable'))

    await expect(
      messageService.enqueueGeneration('conv-1', userMessage, assistantMessage, 'user-1')
    ).resolves.toBeUndefined()
  })
})
