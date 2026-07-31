import { prisma as db } from '@synora/database'
import { Memory } from '@synora/database'
import { ValidationException, NotFoundException, ForbiddenException } from '@synora/shared'
import { logger } from '../utils/logger'

export interface MemoryExportOptions {
  format: 'json' | 'markdown' | 'csv'
  includeMetadata?: boolean
  includeAuditLog?: boolean
  filterByType?: string
  filterByDateRange?: { from: Date; to: Date }
}

export class MemoryGdprService {
  /**
   * Export user's memories (GDPR data portability)
   */
  async exportUserMemories(
    userId: string,
    workspaceId: string,
    options: MemoryExportOptions,
  ): Promise<{
    data: string
    fileName: string
    format: string
  }> {
    // Validate user access
    const workspace = await db.workspace.findFirst({
      where: {
        id: workspaceId,
        members: { some: { userId } },
      },
    })

    if (!workspace) {
      throw new ForbiddenException('Not a member of this workspace')
    }

    // Fetch user's memories
    const memories = await db.memory.findMany({
      where: {
        userId,
        workspaceId,
      },
      include: {
        metadata: true,
        auditLogs: options.includeAuditLog ? undefined : false,
      },
    })

    // Apply filters
    let filtered = memories

    if (options.filterByType) {
      filtered = filtered.filter((m) => m.type === options.filterByType)
    }

    if (options.filterByDateRange) {
      filtered = filtered.filter(
        (m) =>
          m.createdAt >= options.filterByDateRange!.from &&
          m.createdAt <= options.filterByDateRange!.to,
      )
    }

    // Export in requested format
    let data: string

    switch (options.format) {
      case 'json':
        data = this.exportAsJson(filtered, options.includeMetadata ?? false)
        break
      case 'markdown':
        data = this.exportAsMarkdown(filtered, options.includeMetadata ?? false)
        break
      case 'csv':
        data = this.exportAsCsv(filtered)
        break
      default:
        throw new ValidationException('Unsupported export format')
    }

    const fileName = `synora-memories-${userId}-${Date.now()}.${options.format}`

    // Log export for audit trail
    await db.memoryExport.create({
      data: {
        workspaceId,
        userId,
        format: options.format,
        filteredBy: JSON.stringify(options),
        storageKey: '', // Would be S3 key in production
        size: data.length,
        status: 'completed',
        completedAt: new Date(),
      },
    })

    logger.info(`Memories exported for user ${userId}`, { workspaceId, format: options.format })

    return { data, fileName, format: options.format }
  }

  /**
   * GDPR: Permanently delete all user data
   */
  async eraseUserData(userId: string, workspaceId?: string): Promise<{ erasedRecords: number }> {
    let erasedRecords = 0

    // Delete memories
    const memoryDelete = await db.memory.deleteMany({
      where: workspaceId ? { userId, workspaceId } : { userId },
    })
    erasedRecords += memoryDelete.count

    // Delete audit logs
    const auditDelete = await db.memoryAuditLog.deleteMany({
      where: { userId },
    })
    erasedRecords += auditDelete.count

    // Delete memory exports
    const exportDelete = await db.memoryExport.deleteMany({
      where: { userId },
    })
    erasedRecords += exportDelete.count

    logger.warn(`GDPR erase completed for user ${userId}`, {
      workspaceId,
      erasedRecords,
    })

    return { erasedRecords }
  }

  /**
   * GDPR: Get all user data
   */
  async getUserData(userId: string): Promise<{
    memories: Memory[]
    auditLogs: any[]
    exports: any[]
  }> {
    const [memories, auditLogs, exports] = await Promise.all([
      db.memory.findMany({
        where: { userId },
        include: { metadata: true },
      }),
      db.memoryAuditLog.findMany({
        where: { userId },
      }),
      db.memoryExport.findMany({
        where: { userId },
      }),
    ])

    return { memories, auditLogs, exports }
  }

  /**
   * Get audit trail for memory (compliance)
   */
  async getMemoryAuditTrail(memoryId: string, userId: string): Promise<any[]> {
    // Verify user owns or has access to memory
    const memory = await db.memory.findUnique({
      where: { id: memoryId },
    })

    if (!memory || memory.userId !== userId) {
      throw new ForbiddenException('Cannot access audit trail')
    }

    const auditLogs = await db.memoryAuditLog.findMany({
      where: { memoryId },
      orderBy: { createdAt: 'desc' },
    })

    return auditLogs
  }

  /**
   * Check data retention compliance
   */
  async checkRetentionCompliance(workspaceId: string): Promise<{
    expiredMemories: number
    archivedMemories: number
    deletedMemories: number
  }> {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const [expired, archived, deleted] = await Promise.all([
      db.memory.count({
        where: {
          workspaceId,
          expiresAt: { lte: now },
        },
      }),
      db.memory.count({
        where: {
          workspaceId,
          isArchived: true,
          updatedAt: { lte: thirtyDaysAgo },
        },
      }),
      db.memory.count({
        where: {
          workspaceId,
          status: 'DELETED',
          updatedAt: { lte: thirtyDaysAgo },
        },
      }),
    ])

    return {
      expiredMemories: expired,
      archivedMemories: archived,
      deletedMemories: deleted,
    }
  }

  /**
   * Clean up expired memories
   */
  async cleanupExpiredMemories(workspaceId: string): Promise<number> {
    const now = new Date()

    const result = await db.memory.deleteMany({
      where: {
        workspaceId,
        expiresAt: { lte: now },
      },
    })

    logger.info(`Cleaned up ${result.count} expired memories in workspace ${workspaceId}`)

    return result.count
  }

  /**
   * Generate GDPR compliance report
   */
  async generateComplianceReport(workspaceId: string): Promise<{
    totalMemories: number
    memoryEncryption: { encrypted: number; unencrypted: number }
    auditLoggingEnabled: boolean
    retentionPolicy: any
    lastAuditDate: Date | null
  }> {
    const memories = await db.memory.findMany({
      where: { workspaceId },
      select: { isEncrypted: true },
    })

    const encrypted = memories.filter((m) => m.isEncrypted).length
    const unencrypted = memories.length - encrypted

    const lastAudit = await db.memoryAuditLog.findFirst({
      where: { memory: { workspaceId } },
      orderBy: { createdAt: 'desc' },
    })

    return {
      totalMemories: memories.length,
      memoryEncryption: { encrypted, unencrypted },
      auditLoggingEnabled: true,
      retentionPolicy: {
        maxAge: '90 days',
        softDeleteGracePeriod: '30 days',
      },
      lastAuditDate: lastAudit?.createdAt || null,
    }
  }

  /**
   * Private: Export memories as JSON
   */
  private exportAsJson(memories: Memory[], includeMetadata: boolean): string {
    const data = memories.map((m) => ({
      id: m.id,
      content: m.content,
      summary: m.summary,
      type: m.type,
      category: m.category,
      tags: m.tags,
      importance: m.importance,
      status: m.status,
      permission: m.permission,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      ...(includeMetadata && { metadata: (m as any).metadata }),
    }))

    return JSON.stringify(data, null, 2)
  }

  /**
   * Private: Export memories as Markdown
   */
  private exportAsMarkdown(memories: Memory[], includeMetadata: boolean): string {
    const lines = [
      '# My Memories Export',
      `Generated: ${new Date().toISOString()}`,
      `Total Memories: ${memories.length}`,
      '',
    ]

    memories.forEach((memory) => {
      lines.push(`## ${memory.type} - ${memory.category || 'Uncategorized'}`)
      lines.push(`**Importance:** ${(memory.importance * 100).toFixed(0)}%`)
      lines.push(`**Created:** ${memory.createdAt.toISOString()}`)
      lines.push(`**Status:** ${memory.status}`)
      lines.push('')
      lines.push(memory.content)
      lines.push('')

      if (memory.summary) {
        lines.push(`*Summary:* ${memory.summary}`)
        lines.push('')
      }

      if (memory.tags.length > 0) {
        lines.push(`**Tags:** ${memory.tags.join(', ')}`)
        lines.push('')
      }

      lines.push('---')
      lines.push('')
    })

    return lines.join('\n')
  }

  /**
   * Private: Export memories as CSV
   */
  private exportAsCsv(memories: Memory[]): string {
    const headers = [
      'ID',
      'Type',
      'Category',
      'Importance',
      'Status',
      'Tags',
      'Created',
      'Updated',
      'Content (First 100 chars)',
    ]

    const rows = memories.map((m) => [
      m.id,
      m.type,
      m.category || '',
      m.importance.toFixed(2),
      m.status,
      m.tags.join(';'),
      m.createdAt.toISOString(),
      m.updatedAt.toISOString(),
      m.content.substring(0, 100).replace(/"/g, '""'),
    ])

    const csv = [
      headers.map((h) => `"${h}"`).join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n')

    return csv
  }
}

export const memoryGdprService = new MemoryGdprService()
