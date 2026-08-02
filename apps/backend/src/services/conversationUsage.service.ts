import { prisma } from '@synora/database'
import { ConversationUsage } from '@prisma/client'
import { logger } from '../utils/logger'
import { estimateCost } from '../ai/pricing'

export interface RecordGenerationUsageInput {
  conversationId: string
  model: string
  inputTokens: number
  outputTokens: number
}

/**
 * Aggregate-only token/cost accounting: one row per conversation,
 * incremented on every successful generation. This is not a per-event
 * usage ledger (that's a later, analytics-focused milestone reading
 * per-event history this service doesn't create) — it exists to answer
 * "how many tokens and roughly how much has this conversation cost so
 * far," which is what Release 3 M2 asks for.
 */
export class ConversationUsageService {
  async recordGeneration(input: RecordGenerationUsageInput): Promise<ConversationUsage> {
    const cost = estimateCost(input.model, input.inputTokens, input.outputTokens)
    const totalTokens = input.inputTokens + input.outputTokens

    logger.debug(`[conversationUsageService.recordGeneration] Recording usage for ${input.conversationId}`, {
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      estimatedCost: cost,
    })

    return prisma.conversationUsage.upsert({
      where: { conversationId: input.conversationId },
      create: {
        conversationId: input.conversationId,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        totalTokens,
        estimatedCost: cost,
      },
      update: {
        inputTokens: { increment: input.inputTokens },
        outputTokens: { increment: input.outputTokens },
        totalTokens: { increment: totalTokens },
        estimatedCost: { increment: cost },
      },
    })
  }

  async getByConversationId(conversationId: string): Promise<ConversationUsage | null> {
    return prisma.conversationUsage.findUnique({ where: { conversationId } })
  }

  /**
   * Workspace-level usage summary, aggregated from per-message
   * accounting (Message.inputTokens/outputTokens/costCents, written
   * by the generation worker on completion). Only ASSISTANT messages
   * with a recorded provider count toward tokens/cost — user/system
   * turns carry no generation cost. Soft-deleted messages ARE
   * included: usage accounting is billing truth and deleting content
   * doesn't refund tokens.
   *
   * `topUsers` is deliberately absent from the result: Message rows
   * do not record a sender, so per-user attribution cannot be
   * computed honestly from this data.
   */
  async getWorkspaceUsageSummary(
    workspaceId: string,
    range: { from: Date; to: Date }
  ): Promise<WorkspaceUsageSummary> {
    const generationWhere = {
      conversation: { workspaceId },
      role: 'ASSISTANT' as const,
      provider: { not: null },
      createdAt: { gte: range.from, lte: range.to },
    }

    const [totals, byProvider, byModel, conversations, totalMessages] = await Promise.all([
      prisma.message.aggregate({
        where: generationWhere,
        _sum: { inputTokens: true, outputTokens: true, costCents: true },
      }),
      prisma.message.groupBy({
        by: ['provider'],
        where: generationWhere,
        _sum: { inputTokens: true, outputTokens: true, costCents: true },
      }),
      prisma.message.groupBy({
        by: ['model'],
        where: generationWhere,
        _sum: { costCents: true },
      }),
      prisma.message.groupBy({
        by: ['conversationId'],
        where: {
          conversation: { workspaceId },
          createdAt: { gte: range.from, lte: range.to },
        },
      }),
      prisma.message.count({
        where: {
          conversation: { workspaceId },
          createdAt: { gte: range.from, lte: range.to },
        },
      }),
    ])

    const totalCostCents = totals._sum.costCents ?? 0

    const costByProvider: Record<string, number> = {}
    const topProviders = byProvider
      .map((row) => {
        const cost = row._sum.costCents ?? 0
        costByProvider[row.provider!] = cost
        return {
          provider: row.provider!,
          inputTokens: row._sum.inputTokens ?? 0,
          outputTokens: row._sum.outputTokens ?? 0,
          costCents: cost,
          percentOfTotal: totalCostCents > 0 ? Math.round((cost / totalCostCents) * 100) : 0,
        }
      })
      .sort((a, b) => b.costCents - a.costCents)

    const costByModel: Record<string, number> = {}
    for (const row of byModel) {
      if (row.model) costByModel[row.model] = row._sum.costCents ?? 0
    }

    return {
      totalConversations: conversations.length,
      totalMessages,
      totalInputTokens: totals._sum.inputTokens ?? 0,
      totalOutputTokens: totals._sum.outputTokens ?? 0,
      totalCostCents,
      costByProvider,
      costByModel,
      topProviders,
      dateRange: { from: range.from.toISOString(), to: range.to.toISOString() },
    }
  }

  /**
   * Per-generation usage ledger: one entry per completed assistant
   * message, newest first. This is the per-event history the
   * aggregate rows above summarize.
   */
  async getWorkspaceUsageLedger(
    workspaceId: string,
    options: { skip: number; take: number; from: Date; to: Date }
  ): Promise<{ items: WorkspaceUsageLedgerEntry[]; total: number; hasMore: boolean }> {
    const where = {
      conversation: { workspaceId },
      role: 'ASSISTANT' as const,
      provider: { not: null },
      createdAt: { gte: options.from, lte: options.to },
    }

    const [rows, total] = await Promise.all([
      prisma.message.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: options.skip,
        take: options.take,
        select: {
          id: true,
          conversationId: true,
          provider: true,
          model: true,
          inputTokens: true,
          outputTokens: true,
          costCents: true,
          createdAt: true,
        },
      }),
      prisma.message.count({ where }),
    ])

    return {
      items: rows.map((row) => ({
        id: row.id,
        conversationId: row.conversationId,
        providerId: row.provider!,
        model: row.model ?? 'unknown',
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        costCents: row.costCents,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      hasMore: options.skip + options.take < total,
    }
  }
}

export interface WorkspaceUsageSummary {
  totalConversations: number
  totalMessages: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCostCents: number
  costByProvider: Record<string, number>
  costByModel: Record<string, number>
  topProviders: {
    provider: string
    inputTokens: number
    outputTokens: number
    costCents: number
    percentOfTotal: number
  }[]
  dateRange: { from: string; to: string }
}

export interface WorkspaceUsageLedgerEntry {
  id: string
  conversationId: string
  providerId: string
  model: string
  inputTokens: number
  outputTokens: number
  costCents: number
  createdAt: string
}

export const conversationUsageService = new ConversationUsageService()
