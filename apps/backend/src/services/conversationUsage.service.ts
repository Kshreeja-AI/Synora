import { prisma } from '@synora/database'
import { ConversationUsage } from '@prisma/client'
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
}

export const conversationUsageService = new ConversationUsageService()
