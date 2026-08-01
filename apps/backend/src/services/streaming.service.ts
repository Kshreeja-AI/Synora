import { prisma } from '@synora/database'
import { StreamingJob, StreamingJobStatus } from '@prisma/client'

export interface CreateStreamingJobInput {
  conversationId: string
}

export class StreamingService {
  async createJob(input: CreateStreamingJobInput): Promise<StreamingJob> {
    return prisma.streamingJob.create({
      data: {
        conversationId: input.conversationId,
        status: StreamingJobStatus.PENDING,
      },
    })
  }

  async getJob(id: string): Promise<StreamingJob | null> {
    return prisma.streamingJob.findUnique({
      where: { id },
    })
  }

  async getActiveJob(conversationId: string): Promise<StreamingJob | null> {
    return prisma.streamingJob.findFirst({
      where: {
        conversationId,
        status: { in: [StreamingJobStatus.PENDING, StreamingJobStatus.RUNNING] },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async startJob(jobId: string): Promise<StreamingJob> {
    return prisma.streamingJob.update({
      where: { id: jobId },
      data: {
        status: StreamingJobStatus.RUNNING,
      },
    })
  }

  async completeJob(jobId: string): Promise<StreamingJob> {
    return prisma.streamingJob.update({
      where: { id: jobId },
      data: {
        status: StreamingJobStatus.COMPLETED,
        completedAt: new Date(),
      },
    })
  }

  async failJob(jobId: string): Promise<StreamingJob> {
    return prisma.streamingJob.update({
      where: { id: jobId },
      data: {
        status: StreamingJobStatus.FAILED,
        completedAt: new Date(),
      },
    })
  }

  async cancelJob(jobId: string): Promise<StreamingJob> {
    return prisma.streamingJob.update({
      where: { id: jobId },
      data: {
        status: StreamingJobStatus.CANCELED,
        completedAt: new Date(),
      },
    })
  }

  async cleanupStaleJobs(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs)

    const result = await prisma.streamingJob.updateMany({
      where: {
        status: { in: [StreamingJobStatus.RUNNING, StreamingJobStatus.PENDING] },
        createdAt: { lt: cutoff },
      },
      data: {
        status: StreamingJobStatus.FAILED,
        completedAt: new Date(),
      },
    })

    return result.count
  }

  async getJobHistory(conversationId: string, limit: number = 20): Promise<StreamingJob[]> {
    return prisma.streamingJob.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }
}

export const streamingService = new StreamingService()
