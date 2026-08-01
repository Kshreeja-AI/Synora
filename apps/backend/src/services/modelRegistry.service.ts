import { prisma } from '@synora/database'
import { NotFoundException, ValidationException } from '@synora/shared'
import { logger } from '../utils/logger'
import { requireMembership } from './checks'
import { ModelStatus, ModelVersionStatus } from '@prisma/client'

export interface CreateModelInput {
  name: string
  description?: string
  provider: string
  baseModel?: string
  tags?: string[]
}

export interface CreateModelVersionInput {
  modelId: string
  versionNumber: string
  status: ModelVersionStatus
  performanceMetrics?: Record<string, number>
}

export interface ModelPerformance {
  modelId: string
  version: string
  accuracy?: number
  speed?: number
  costPerRequest?: number
}

export class ModelRegistryService {
  async createModel(
    userId: string,
    workspaceId: string,
    input: CreateModelInput
  ): Promise<any> {
    const membership = await requireMembership(userId, workspaceId)
    if (membership.role !== 'OWNER' && membership.role !== 'EDITOR') {
      throw new ValidationException('Insufficient permissions to create models')
    }

    const existing = await prisma.modelRegistry.findFirst({
      where: {
        workspaceId,
        name: input.name,
      },
    })

    if (existing) {
      throw new ValidationException('Model with this name already exists')
    }

    const model = await prisma.modelRegistry.create({
      data: {
        workspaceId,
        name: input.name,
        description: input.description,
        provider: input.provider,
        baseModel: input.baseModel,
        createdBy: userId,
        status: ModelStatus.ACTIVE,
        tags: input.tags || [],
      },
    })

    const version = await prisma.modelVersion.create({
      data: {
        modelId: model.id,
        versionNumber: '1.0.0',
        status: ModelVersionStatus.DRAFT,
      },
    })

    logger.info(`[modelRegistry] Model created: ${model.id}`, {
      workspaceId,
      userId,
      provider: input.provider,
    })

    return { model, version }
  }

  async createVersion(
    userId: string,
    workspaceId: string,
    input: CreateModelVersionInput
  ): Promise<any> {
    const membership = await requireMembership(userId, workspaceId)
    if (membership.role !== 'OWNER' && membership.role !== 'EDITOR') {
      throw new ValidationException('Insufficient permissions to create model versions')
    }

    const model = await prisma.modelRegistry.findUnique({
      where: { id: input.modelId },
    })

    if (!model || model.workspaceId !== workspaceId) {
      throw new NotFoundException('Model not found')
    }

    const existingVersion = await prisma.modelVersion.findFirst({
      where: {
        modelId: input.modelId,
        versionNumber: input.versionNumber,
      },
    })

    if (existingVersion) {
      throw new ValidationException('Version already exists')
    }

    const version = await prisma.modelVersion.create({
      data: {
        modelId: input.modelId,
        versionNumber: input.versionNumber,
        status: input.status,
        benchmarkScores: input.performanceMetrics || {},
      },
    })

    logger.info(`[modelRegistry] Version created: ${version.id}`, {
      modelId: input.modelId,
      version: input.versionNumber,
      workspaceId,
    })

    return version
  }

  async promoteVersion(
    userId: string,
    workspaceId: string,
    versionId: string,
    newStatus: ModelVersionStatus
  ): Promise<any> {
    const membership = await requireMembership(userId, workspaceId)
    if (membership.role !== 'OWNER') {
      throw new ValidationException('Only owners can promote model versions')
    }

    const version = await prisma.modelVersion.findUnique({
      where: { id: versionId },
      include: { model: true },
    })

    if (!version || version.model.workspaceId !== workspaceId) {
      throw new NotFoundException('Version not found')
    }

    const validTransitions: Record<string, ModelVersionStatus[]> = {
      [ModelVersionStatus.DRAFT]: [ModelVersionStatus.TRAINING],
      [ModelVersionStatus.TRAINING]: [ModelVersionStatus.EVALUATING, ModelVersionStatus.DRAFT],
      [ModelVersionStatus.EVALUATING]: [ModelVersionStatus.RELEASED, ModelVersionStatus.TRAINING],
      [ModelVersionStatus.RELEASED]: [ModelVersionStatus.DEPRECATED],
      [ModelVersionStatus.DEPRECATED]: [],
    }

    if (!validTransitions[version.status]?.includes(newStatus)) {
      throw new ValidationException(
        `Cannot transition from ${version.status} to ${newStatus}`
      )
    }

    if (newStatus === ModelVersionStatus.RELEASED) {
      const currentReleased = await prisma.modelVersion.findFirst({
        where: {
          modelId: version.modelId,
          status: ModelVersionStatus.RELEASED,
        },
      })

      if (currentReleased) {
        await prisma.modelVersion.update({
          where: { id: currentReleased.id },
          data: { status: ModelVersionStatus.EVALUATING },
        })
      }
    }

    const updated = await prisma.modelVersion.update({
      where: { id: versionId },
      data: { status: newStatus },
    })

    logger.info(`[modelRegistry] Version promoted to ${newStatus}`, {
      versionId,
      modelId: version.modelId,
      workspaceId,
      userId,
    })

    return updated
  }

  async listModels(
    userId: string,
    workspaceId: string,
    options: { skip?: number; take?: number } = {}
  ): Promise<{ models: any[]; total: number }> {
    await requireMembership(userId, workspaceId)

    const [models, total] = await Promise.all([
      prisma.modelRegistry.findMany({
        where: { workspaceId, status: ModelStatus.ACTIVE },
        include: {
          versions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        skip: options.skip || 0,
        take: options.take || 20,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.modelRegistry.count({
        where: { workspaceId, status: ModelStatus.ACTIVE },
      }),
    ])

    return { models, total }
  }

  async getModel(
    userId: string,
    workspaceId: string,
    modelId: string
  ): Promise<any> {
    await requireMembership(userId, workspaceId)

    const model = await prisma.modelRegistry.findUnique({
      where: { id: modelId },
      include: {
        versions: {
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!model || model.workspaceId !== workspaceId) {
      throw new NotFoundException('Model not found')
    }

    return model
  }

  async getProductionVersion(
    workspaceId: string,
    modelId: string
  ): Promise<any | null> {
    return prisma.modelVersion.findFirst({
      where: {
        modelId,
        status: ModelVersionStatus.RELEASED,
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async compareVersions(
    userId: string,
    workspaceId: string,
    versionIds: string[]
  ): Promise<any> {
    await requireMembership(userId, workspaceId)

    const versions = await prisma.modelVersion.findMany({
      where: {
        id: { in: versionIds },
      },
      include: {
        model: true,
      },
    })

    if (versions.length !== versionIds.length) {
      throw new ValidationException('One or more versions not found')
    }

    const allInWorkspace = versions.every((v) => v.model.workspaceId === workspaceId)
    if (!allInWorkspace) {
      throw new NotFoundException('One or more versions not found')
    }

    const comparison: Record<string, any> = {}
    for (const version of versions) {
      const metrics = version.benchmarkScores || {}
      comparison[`${version.model.name} v${version.versionNumber}`] = {
        versionId: version.id,
        status: version.status,
        metrics,
        createdAt: version.createdAt,
      }
    }

    return {
      comparisonTime: new Date(),
      versions: comparison,
    }
  }

  async getVersionHistory(
    userId: string,
    workspaceId: string,
    modelId: string
  ): Promise<any[]> {
    await requireMembership(userId, workspaceId)

    const model = await prisma.modelRegistry.findUnique({
      where: { id: modelId },
    })

    if (!model || model.workspaceId !== workspaceId) {
      throw new NotFoundException('Model not found')
    }

    return prisma.modelVersion.findMany({
      where: { modelId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async deprecateModel(
    userId: string,
    workspaceId: string,
    modelId: string
  ): Promise<void> {
    const membership = await requireMembership(userId, workspaceId)
    if (membership.role !== 'OWNER') {
      throw new ValidationException('Only owners can deprecate models')
    }

    const model = await prisma.modelRegistry.findUnique({
      where: { id: modelId },
    })

    if (!model || model.workspaceId !== workspaceId) {
      throw new NotFoundException('Model not found')
    }

    await prisma.modelRegistry.update({
      where: { id: modelId },
      data: { status: ModelStatus.ARCHIVED },
    })

    logger.info(`[modelRegistry] Model deprecated: ${modelId}`, {
      workspaceId,
      userId,
    })
  }

  async getMetrics(
    userId: string,
    workspaceId: string,
    versionId: string
  ): Promise<ModelPerformance> {
    await requireMembership(userId, workspaceId)

    const version = await prisma.modelVersion.findUnique({
      where: { id: versionId },
      include: { model: true },
    })

    if (!version || version.model.workspaceId !== workspaceId) {
      throw new NotFoundException('Version not found')
    }

    const storedBenchmarks = (version.benchmarkScores as Record<string, number>) || {}

    return {
      modelId: version.modelId,
      version: version.versionNumber,
      accuracy: storedBenchmarks.accuracy,
      speed: storedBenchmarks.speed,
      costPerRequest: storedBenchmarks.costPerRequest,
    }
  }
}

export const modelRegistryService = new ModelRegistryService()
