import { prisma } from '@synora/database'
import { NotFoundException, ValidationException } from '@synora/shared'
import { logger } from '../utils/logger'
import { requireMembership } from './checks'
import { EvaluationStatus, BenchmarkStatus } from '@prisma/client'

export interface CreateEvaluationRunInput {
  datasetId: string
  modelId: string
  metrics: string[]
}

export interface EvaluationMetrics {
  accuracy?: number
  precision?: number
  recall?: number
  f1?: number
  customMetrics?: Record<string, number>
}

export interface BenchmarkResult {
  modelId: string
  benchmark: string
  metrics: EvaluationMetrics
  timestamp: Date
  status: BenchmarkStatus
}

export class EvaluationService {
  async createEvaluationRun(
    userId: string,
    workspaceId: string,
    input: CreateEvaluationRunInput
  ): Promise<{ runId: string; status: EvaluationStatus }> {
    const membership = await requireMembership(userId, workspaceId)
    if (membership.role !== 'OWNER' && membership.role !== 'EDITOR') {
      throw new ValidationException('Insufficient permissions to create evaluation')
    }

    const dataset = await prisma.dataset.findUnique({
      where: { id: input.datasetId },
    })

    if (!dataset || dataset.workspaceId !== workspaceId) {
      throw new NotFoundException('Dataset not found')
    }

    const model = await prisma.modelRegistry.findUnique({
      where: { id: input.modelId },
    })

    if (!model || model.workspaceId !== workspaceId) {
      throw new NotFoundException('Model not found')
    }

    const evaluationRun = await prisma.evaluationRun.create({
      data: {
        datasetId: input.datasetId,
        modelId: input.modelId,
        status: EvaluationStatus.PENDING,
        createdBy: userId,
        workspaceId,
        metrics: input.metrics,
      },
    })

    logger.info(`[evaluation] Created evaluation run ${evaluationRun.id}`, {
      workspaceId,
      datasetId: input.datasetId,
      modelId: input.modelId,
    })

    return {
      runId: evaluationRun.id,
      status: EvaluationStatus.PENDING,
    }
  }

  async runEvaluation(
    evaluationRunId: string,
    workspaceId: string
  ): Promise<{ results: BenchmarkResult[]; totalScore: number }> {
    const run = await prisma.evaluationRun.findUnique({
      where: { id: evaluationRunId },
      include: { dataset: { include: { samples: true } } },
    })

    if (!run || run.workspaceId !== workspaceId) {
      throw new NotFoundException('Evaluation run not found')
    }

    await prisma.evaluationRun.update({
      where: { id: evaluationRunId },
      data: { status: EvaluationStatus.RUNNING, startedAt: new Date() },
    })

    try {
      const results: BenchmarkResult[] = []
      const allMetrics: EvaluationMetrics = {}

      const accuracy = await this.evaluateAccuracy(run)
      allMetrics.accuracy = accuracy

      results.push({
        modelId: run.modelId,
        benchmark: 'Accuracy',
        metrics: allMetrics,
        timestamp: new Date(),
        status: BenchmarkStatus.COMPLETED,
      })

      const totalScore = accuracy

      for (const metric of run.metrics) {
        await prisma.evaluationResult.create({
          data: {
            evaluationRunId,
            metric,
            value: (allMetrics[metric as keyof EvaluationMetrics] as number) || 0,
            workspaceId,
          },
        })
      }

      await prisma.evaluationRun.update({
        where: { id: evaluationRunId },
        data: {
          status: EvaluationStatus.COMPLETED,
          completedAt: new Date(),
        },
      })

      logger.info(`[evaluation] Evaluation run ${evaluationRunId} completed`, {
        workspaceId,
        totalScore,
        resultCount: results.length,
      })

      return { results, totalScore }
    } catch (error) {
      await prisma.evaluationRun.update({
        where: { id: evaluationRunId },
        data: {
          status: EvaluationStatus.FAILED,
          error: error instanceof Error ? error.message : String(error),
          completedAt: new Date(),
        },
      })

      throw error
    }
  }

  private async evaluateAccuracy(run: any): Promise<number> {
    const samples = run.dataset.samples
    if (!samples || samples.length === 0) return 0

    let correctCount = 0
    for (const sample of samples) {
      if (sample.qualityScore && sample.qualityScore > 0.7) {
        correctCount++
      }
    }

    return correctCount / samples.length
  }

  async getEvaluationResults(
    userId: string,
    workspaceId: string,
    runId: string
  ): Promise<{ run: any; results: any[]; summary: any }> {
    await requireMembership(userId, workspaceId)

    const run = await prisma.evaluationRun.findUnique({
      where: { id: runId },
      include: { results: true },
    })

    if (!run || run.workspaceId !== workspaceId) {
      throw new NotFoundException('Evaluation run not found')
    }

    const summary = {
      totalResults: run.results.length,
      averageMetricValue:
        run.results.reduce((sum: number, r: any) => sum + r.value, 0) / run.results.length || 0,
      completionTime: run.completedAt
        ? Math.round((run.completedAt.getTime() - run.createdAt.getTime()) / 1000)
        : null,
    }

    return { run, results: run.results, summary }
  }

  async listEvaluationRuns(
    userId: string,
    workspaceId: string,
    options: { skip?: number; take?: number } = {}
  ): Promise<{ runs: any[]; total: number }> {
    await requireMembership(userId, workspaceId)

    const [runs, total] = await Promise.all([
      prisma.evaluationRun.findMany({
        where: { workspaceId },
        skip: options.skip || 0,
        take: options.take || 20,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.evaluationRun.count({
        where: { workspaceId },
      }),
    ])

    return { runs, total }
  }

  async compareModels(
    userId: string,
    workspaceId: string,
    datasetId: string,
    modelIds: string[]
  ): Promise<any> {
    await requireMembership(userId, workspaceId)

    const models = await prisma.modelRegistry.findMany({
      where: { id: { in: modelIds }, workspaceId },
    })

    if (models.length !== modelIds.length) {
      throw new ValidationException('One or more models not found')
    }

    const evaluations = await prisma.evaluationRun.findMany({
      where: {
        datasetId,
        modelId: { in: modelIds },
      },
      include: { results: true },
    })

    const comparison: Record<string, any> = {}
    for (const evalRun of evaluations) {
      const model = models.find((m) => m.id === evalRun.modelId)
      const metrics = evalRun.results.reduce(
        (acc, r) => ({ ...acc, [r.metric]: r.value }),
        {}
      )

      comparison[model?.name || evalRun.modelId] = {
        modelId: evalRun.modelId,
        metrics,
        completedAt: evalRun.completedAt,
      }
    }

    return {
      datasetId,
      comparisonTime: new Date(),
      models: comparison,
    }
  }
}

export const evaluationService = new EvaluationService()
