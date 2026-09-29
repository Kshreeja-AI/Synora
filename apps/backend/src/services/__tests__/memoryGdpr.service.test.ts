import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryGdprService } from '../memoryGdpr.service'
import { ForbiddenException } from '@synora/shared'

vi.mock('@synora/database', () => ({
  prisma: {
    workspace: { findFirst: vi.fn() },
    memory: { findMany: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
    memoryAuditLog: { findMany: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn() },
    memoryExport: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  },
}))

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

describe('MemoryGdprService', () => {
  let service: MemoryGdprService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new MemoryGdprService()
  })

  describe('exportUserMemories', () => {
    it('rejects export for a non-member of the workspace', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue(null)

      await expect(
        service.exportUserMemories('user-1', 'ws-1', { format: 'json' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('exports real memory content as JSON, not placeholder data', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({ id: 'ws-1' } as never)
      vi.mocked(prisma.memory.findMany).mockResolvedValue([
        {
          id: 'm1',
          content: 'Real remembered content',
          summary: null,
          type: 'SEMANTIC',
          category: null,
          tags: ['tag1'],
          importance: 0.7,
          status: 'ACTIVE',
          permission: 'PRIVATE',
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ] as never)
      vi.mocked(prisma.memoryExport.create).mockResolvedValue({} as never)

      const result = await service.exportUserMemories('user-1', 'ws-1', { format: 'json' })

      expect(result.format).toBe('json')
      const parsed = JSON.parse(result.data)
      expect(parsed[0].content).toBe('Real remembered content')
      expect(prisma.memoryExport.create).toHaveBeenCalled()
    })

    it('filters memories by type', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({ id: 'ws-1' } as never)
      vi.mocked(prisma.memory.findMany).mockResolvedValue([
        { id: 'm1', type: 'SEMANTIC', content: 'a', tags: [], importance: 0.5, status: 'ACTIVE', permission: 'PRIVATE', createdAt: new Date(), updatedAt: new Date(), summary: null, category: null },
        { id: 'm2', type: 'EPISODIC', content: 'b', tags: [], importance: 0.5, status: 'ACTIVE', permission: 'PRIVATE', createdAt: new Date(), updatedAt: new Date(), summary: null, category: null },
      ] as never)
      vi.mocked(prisma.memoryExport.create).mockResolvedValue({} as never)

      const result = await service.exportUserMemories('user-1', 'ws-1', {
        format: 'json',
        filterByType: 'SEMANTIC',
      })

      const parsed = JSON.parse(result.data)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].id).toBe('m1')
    })

    it('exports as markdown with real content embedded', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({ id: 'ws-1' } as never)
      vi.mocked(prisma.memory.findMany).mockResolvedValue([
        { id: 'm1', type: 'SEMANTIC', content: 'markdown body', tags: [], importance: 0.5, status: 'ACTIVE', permission: 'PRIVATE', createdAt: new Date(), updatedAt: new Date(), summary: null, category: null },
      ] as never)
      vi.mocked(prisma.memoryExport.create).mockResolvedValue({} as never)

      const result = await service.exportUserMemories('user-1', 'ws-1', { format: 'markdown' })

      expect(result.data).toContain('markdown body')
      expect(result.data).toContain('# My Memories Export')
    })

    it('exports as CSV with real content embedded', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({ id: 'ws-1' } as never)
      vi.mocked(prisma.memory.findMany).mockResolvedValue([
        { id: 'm1', type: 'SEMANTIC', content: 'csv content', tags: [], importance: 0.5, status: 'ACTIVE', permission: 'PRIVATE', createdAt: new Date(), updatedAt: new Date(), summary: null, category: null },
      ] as never)
      vi.mocked(prisma.memoryExport.create).mockResolvedValue({} as never)

      const result = await service.exportUserMemories('user-1', 'ws-1', { format: 'csv' })

      expect(result.data).toContain('csv content')
    })
  })

  describe('eraseUserData', () => {
    it('deletes memories, audit logs, and exports, returning the real total count', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.deleteMany).mockResolvedValue({ count: 5 } as never)
      vi.mocked(prisma.memoryAuditLog.deleteMany).mockResolvedValue({ count: 12 } as never)
      vi.mocked(prisma.memoryExport.deleteMany).mockResolvedValue({ count: 2 } as never)

      const result = await service.eraseUserData('user-1', 'ws-1')

      expect(result.erasedRecords).toBe(19)
      expect(prisma.memory.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1', workspaceId: 'ws-1' } })
    })

    it('scopes to all workspaces when workspaceId is omitted', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.deleteMany).mockResolvedValue({ count: 3 } as never)
      vi.mocked(prisma.memoryAuditLog.deleteMany).mockResolvedValue({ count: 0 } as never)
      vi.mocked(prisma.memoryExport.deleteMany).mockResolvedValue({ count: 0 } as never)

      await service.eraseUserData('user-1')

      expect(prisma.memory.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    })
  })

  describe('getMemoryAuditTrail', () => {
    it('rejects access to another user\'s memory audit trail', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.findUnique).mockResolvedValue({ id: 'm1', userId: 'other-user' } as never)

      await expect(service.getMemoryAuditTrail('m1', 'user-1')).rejects.toThrow(ForbiddenException)
    })

    it('returns the real audit log entries for the owning user', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.findUnique).mockResolvedValue({ id: 'm1', userId: 'user-1' } as never)
      vi.mocked(prisma.memoryAuditLog.findMany).mockResolvedValue([
        { id: 'a1', action: 'created' },
      ] as never)

      const result = await service.getMemoryAuditTrail('m1', 'user-1')

      expect(result).toHaveLength(1)
      expect(result[0].action).toBe('created')
    })
  })

  describe('checkRetentionCompliance', () => {
    it('reports real counts from separate expired/archived/deleted queries', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.count)
        .mockResolvedValueOnce(3) // expired
        .mockResolvedValueOnce(7) // archived
        .mockResolvedValueOnce(2) // deleted

      const result = await service.checkRetentionCompliance('ws-1')

      expect(result).toEqual({ expiredMemories: 3, archivedMemories: 7, deletedMemories: 2 })
    })
  })

  describe('cleanupExpiredMemories', () => {
    it('deletes only memories past their expiry and returns the real count', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.deleteMany).mockResolvedValue({ count: 4 } as never)

      const count = await service.cleanupExpiredMemories('ws-1')

      expect(count).toBe(4)
      expect(prisma.memory.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'ws-1' }) }),
      )
    })
  })

  describe('generateComplianceReport', () => {
    it('computes real encryption counts from actual memory rows', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.findMany).mockResolvedValue([
        { isEncrypted: true },
        { isEncrypted: false },
        { isEncrypted: true },
      ] as never)
      vi.mocked(prisma.memoryAuditLog.findFirst).mockResolvedValue({ createdAt: new Date('2026-01-01') } as never)

      const report = await service.generateComplianceReport('ws-1')

      expect(report.totalMemories).toBe(3)
      expect(report.memoryEncryption).toEqual({ encrypted: 2, unencrypted: 1 })
      expect(report.lastAuditDate).toEqual(new Date('2026-01-01'))
    })
  })
})
