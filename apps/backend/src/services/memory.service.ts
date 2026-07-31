import { prisma as db } from '@synora/database'
import { Memory, MemoryStatus, MemoryType, MemoryPermission } from '@synora/database'
import { ValidationException, NotFoundException, ForbiddenException } from '@synora/shared'
import { logger } from '../utils/logger'

export interface CreateMemoryInput {
  workspaceId: string
  conversationId?: string
  userId: string
  content: string
  type: MemoryType
  category?: string
  tags?: string[]
  isManual?: boolean
  permission?: MemoryPermission
  sharedWith?: string[]
}

export interface UpdateMemoryInput {
  content?: string
  summary?: string
  category?: string
  tags?: string[]
  importance?: number
  isPinned?: boolean
  status?: MemoryStatus
}

export interface MemorySearchParams {
  workspaceId: string
  conversationId?: string
  userId?: string
  type?: MemoryType
  status?: MemoryStatus
  tags?: string[]
  searchTerm?: string
  limit?: number
  offset?: number
  pinnedOnly?: boolean
  archivedOnly?: boolean
}

export class MemoryService {
  /**
   * Create a new memory
   */
  async createMemory(input: CreateMemoryInput): Promise<Memory> {
    const {
      workspaceId,
      conversationId,
      userId,
      content,
      type,
      category,
      tags = [],
      isManual = true,
      permission = MemoryPermission.PRIVATE,
      sharedWith = [],
    } = input

    // Validate workspace exists and user has access
    const workspace = await db.workspace.findFirst({
      where: {
        id: workspaceId,
        members: { some: { userId } },
      },
    })

    if (!workspace) {
      throw new ForbiddenException('Not a member of this workspace')
    }

    // Validate conversation if provided
    if (conversationId) {
      const conversation = await db.conversation.findFirst({
        where: {
          id: conversationId,
          workspaceId,
        },
      })

      if (!conversation) {
        throw new NotFoundException('Conversation not found')
      }
    }

    // Create memory with summary generation (will be updated by worker)
    const memory = await db.memory.create({
      data: {
        workspaceId,
        conversationId,
        userId,
        content,
        type,
        category,
        tags,
        isManual,
        permission,
        sharedWith,
        importance: this.calculateInitialImportance(type, isManual),
        metadata: {
          create: {
            source: isManual ? 'manual' : 'auto_generated',
            confidence: isManual ? 1.0 : 0.8,
          },
        },
      },
      include: { metadata: true },
    })

    // Log audit
    await this.auditLog(memory.id, userId, 'created', {
      type,
      content: content.substring(0, 100),
    })

    logger.info(`Memory created: ${memory.id}`, { workspaceId, userId })
    return memory
  }

  /**
   * Retrieve a memory by ID
   */
  async getMemory(memoryId: string, userId: string, workspaceId: string): Promise<Memory> {
    const memory = await db.memory.findFirst({
      where: {
        id: memoryId,
        workspaceId,
      },
      include: {
        metadata: true,
        relatedMemories: true,
        relatedBy: true,
      },
    })

    if (!memory) {
      throw new NotFoundException('Memory not found')
    }

    // Check permissions
    this.validateMemoryAccess(memory, userId)

    // Update access tracking
    await db.memory.update({
      where: { id: memoryId },
      data: {
        lastAccessedAt: new Date(),
        accessCount: { increment: 1 },
      },
    })

    // Update metadata
    if (memory.metadata) {
      await db.memoryMetadata.update({
        where: { memoryId },
        data: {
          lastRetrievedAt: new Date(),
          retrievalCount: { increment: 1 },
        },
      })
    }

    // Log audit
    await this.auditLog(memoryId, userId, 'accessed')

    return memory
  }

  /**
   * Retrieve memories by various filters
   */
  async searchMemories(params: MemorySearchParams, userId: string): Promise<{ memories: Memory[]; total: number }> {
    const {
      workspaceId,
      conversationId,
      type,
      status = MemoryStatus.ACTIVE,
      tags = [],
      searchTerm,
      limit = 20,
      offset = 0,
      pinnedOnly = false,
      archivedOnly = false,
    } = params

    // Validate workspace access
    const workspace = await db.workspace.findFirst({
      where: {
        id: workspaceId,
        members: { some: { userId } },
      },
    })

    if (!workspace) {
      throw new ForbiddenException('Not a member of this workspace')
    }

    const where: any = {
      workspaceId,
      status: archivedOnly ? MemoryStatus.ARCHIVED : status,
    }

    if (conversationId) {
      where.conversationId = conversationId
    }

    if (type) {
      where.type = type
    }

    if (pinnedOnly) {
      where.isPinned = true
    }

    if (tags.length > 0) {
      where.tags = { hasSome: tags }
    }

    // Full-text search if term provided
    if (searchTerm) {
      where.OR = [{ content: { search: searchTerm } }, { summary: { search: searchTerm } }]
    }

    // Permission filtering
    where.OR = [
      { permission: MemoryPermission.PRIVATE, userId },
      { permission: MemoryPermission.WORKSPACE },
      { permission: MemoryPermission.SHARED, sharedWith: { hasSome: [userId] } },
      { permission: MemoryPermission.PUBLIC },
    ]

    const [memories, total] = await Promise.all([
      db.memory.findMany({
        where,
        include: { metadata: true },
        orderBy: { importance: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.memory.count({ where }),
    ])

    return { memories, total }
  }

  /**
   * Update memory
   */
  async updateMemory(memoryId: string, input: UpdateMemoryInput, userId: string, workspaceId: string): Promise<Memory> {
    const memory = await this.getMemory(memoryId, userId, workspaceId)

    // Check write permissions
    if (memory.permission === MemoryPermission.PRIVATE && memory.userId !== userId) {
      throw new ForbiddenException('Cannot edit private memory of other user')
    }

    // Create new version if content changes
    if (input.content && input.content !== memory.content) {
      await db.memory.create({
        data: {
          ...memory,
          id: undefined,
          parentId: memory.id,
          version: memory.version + 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    }

    const updated = await db.memory.update({
      where: { id: memoryId },
      data: {
        content: input.content || memory.content,
        summary: input.summary,
        category: input.category,
        tags: input.tags,
        importance: input.importance !== undefined ? input.importance : memory.importance,
        isPinned: input.isPinned !== undefined ? input.isPinned : memory.isPinned,
        status: input.status,
        updatedAt: new Date(),
      },
      include: { metadata: true },
    })

    // Log audit
    await this.auditLog(memoryId, userId, 'updated', { fields: Object.keys(input) })

    return updated
  }

  /**
   * Delete memory (soft delete)
   */
  async deleteMemory(memoryId: string, userId: string, workspaceId: string): Promise<void> {
    const memory = await this.getMemory(memoryId, userId, workspaceId)

    // Check delete permissions
    if (memory.userId !== userId && memory.permission === MemoryPermission.PRIVATE) {
      throw new ForbiddenException('Cannot delete memory of other user')
    }

    await db.memory.update({
      where: { id: memoryId },
      data: {
        status: MemoryStatus.DELETED,
        updatedAt: new Date(),
      },
    })

    // Log audit
    await this.auditLog(memoryId, userId, 'deleted')

    logger.info(`Memory soft-deleted: ${memoryId}`, { workspaceId, userId })
  }

  /**
   * GDPR: Permanently erase all user memories
   */
  async eraseUserMemories(userId: string, workspaceId?: string): Promise<number> {
    const where: any = { userId }
    if (workspaceId) {
      where.workspaceId = workspaceId
    }

    // Hard delete (GDPR compliance)
    const { count } = await db.memory.deleteMany({ where })

    logger.warn(`Erased ${count} memories for user ${userId}`, { workspaceId })
    return count
  }

  /**
   * Calculate memory importance score
   */
  scoreMemoryImportance(memory: Memory): number {
    let score = 0.5 // Base score

    // Access frequency (0-0.3)
    const accessWeight = Math.min(memory.accessCount / 100, 0.3)
    score += accessWeight

    // Recency (0-0.2)
    const age = Date.now() - (memory.lastAccessedAt?.getTime() ?? memory.createdAt.getTime())
    const recencyWeight = Math.max(1 - age / (90 * 24 * 60 * 60 * 1000), 0) * 0.2
    score += recencyWeight

    // Manual creation boost (0.2)
    if (memory.isManual) {
      score += 0.2
    }

    // Pinned boost (0.1)
    if (memory.isPinned) {
      score += 0.1
    }

    return Math.min(score, 1.0)
  }

  /**
   * Apply daily decay to memory importance
   */
  async applyDecay(memoryId: string): Promise<Memory> {
    const memory = await db.memory.findUnique({
      where: { id: memoryId },
    })

    if (!memory) {
      throw new NotFoundException('Memory not found')
    }

    const decayedImportance = Math.max(0, memory.importance - memory.decayRate)

    const updated = await db.memory.update({
      where: { id: memoryId },
      data: {
        importance: decayedImportance,
        status: decayedImportance <= 0.1 ? MemoryStatus.DECAYING : memory.status,
      },
    })

    return updated
  }

  /**
   * Consolidate memories (summarization)
   */
  async consolidateMemories(memoryIds: string[], summaryPrompt?: string): Promise<Memory> {
    if (memoryIds.length === 0) {
      throw new ValidationException('No memories to consolidate')
    }

    const memories = await db.memory.findMany({
      where: {
        id: { in: memoryIds },
      },
    })

    if (memories.length === 0) {
      throw new NotFoundException('Memories not found')
    }

    // Combine content
    const combinedContent = memories
      .map((m) => `[${m.type}] ${m.summary || m.content}`)
      .join('\n\n')

    // Calculate average importance
    const avgImportance = memories.reduce((sum, m) => sum + m.importance, 0) / memories.length

    // Create consolidated memory (will be processed by worker for actual summarization)
    const consolidated = await db.memory.create({
      data: {
        workspaceId: memories[0].workspaceId,
        userId: memories[0].userId,
        content: combinedContent,
        type: MemoryType.SEMANTIC,
        importance: Math.min(avgImportance + 0.1, 1.0),
        isManual: false,
        status: MemoryStatus.CONSOLIDATING,
        metadata: {
          create: {
            source: 'consolidation',
            isConsolidated: false,
            confidence: 0.8,
          },
        },
      },
      include: { metadata: true },
    })

    // Archive source memories
    await db.memory.updateMany({
      where: { id: { in: memoryIds } },
      data: { isArchived: true },
    })

    logger.info(`Consolidated ${memoryIds.length} memories into ${consolidated.id}`)

    return consolidated
  }

  /**
   * Resolve version conflicts
   */
  async resolveConflict(memoryId: string, selectedVersion: 'current' | 'previous'): Promise<Memory> {
    const memory = await db.memory.findUnique({
      where: { id: memoryId },
      include: { parent: true },
    })

    if (!memory || !memory.parent) {
      throw new NotFoundException('Memory or previous version not found')
    }

    if (selectedVersion === 'previous') {
      // Revert to previous version
      await db.memory.update({
        where: { id: memoryId },
        data: {
          content: memory.parent.content,
          summary: memory.parent.summary,
          updatedAt: new Date(),
        },
      })
    }

    // Mark as resolved
    const resolved = await db.memory.update({
      where: { id: memoryId },
      data: { status: MemoryStatus.ACTIVE },
    })

    return resolved
  }

  /**
   * Get memory statistics for workspace
   */
  async getWorkspaceStats(workspaceId: string): Promise<{
    totalMemories: number
    activeMemories: number
    archivedMemories: number
    averageImportance: number
    typeDistribution: Record<MemoryType, number>
  }> {
    const memories = await db.memory.findMany({
      where: { workspaceId },
      select: {
        type: true,
        status: true,
        importance: true,
      },
    })

    const typeDistribution: Record<string, number> = {}
    let totalImportance = 0

    memories.forEach((m) => {
      typeDistribution[m.type] = (typeDistribution[m.type] || 0) + 1
      totalImportance += m.importance
    })

    return {
      totalMemories: memories.length,
      activeMemories: memories.filter((m) => m.status === MemoryStatus.ACTIVE).length,
      archivedMemories: memories.filter((m) => m.status === MemoryStatus.ARCHIVED).length,
      averageImportance: memories.length > 0 ? totalImportance / memories.length : 0,
      typeDistribution,
    }
  }

  /**
   * Private: Audit logging
   */
  private async auditLog(memoryId: string, userId: string, action: string, metadata?: any): Promise<void> {
    try {
      await db.memoryAuditLog.create({
        data: {
          memoryId,
          userId,
          action,
          metadata,
        },
      })
    } catch (error) {
      logger.error('Failed to create audit log', { error, memoryId, action })
    }
  }

  /**
   * Private: Check memory access permissions
   */
  private validateMemoryAccess(memory: Memory, userId: string): void {
    if (memory.permission === MemoryPermission.PRIVATE && memory.userId !== userId) {
      throw new ForbiddenException('Cannot access private memory of other user')
    }

    if (memory.permission === MemoryPermission.SHARED && !memory.sharedWith.includes(userId)) {
      throw new ForbiddenException('Memory not shared with you')
    }
  }

  /**
   * Private: Calculate initial importance
   */
  private calculateInitialImportance(type: MemoryType, isManual: boolean): number {
    let importance = 0.5

    // Type bonuses
    if (['SEMANTIC', 'EPISODIC'].includes(type)) {
      importance += 0.2
    }

    // Manual creation bonus
    if (isManual) {
      importance += 0.3
    }

    return Math.min(importance, 1.0)
  }
}

export const memoryService = new MemoryService()
