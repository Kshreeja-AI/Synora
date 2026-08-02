import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryLifecycleService } from '../memoryLifecycle.service'

vi.mock('@synora/database', () => ({
  prisma: {
    memoryQuota: { findMany: vi.fn() },
  },
}))

vi.mock('../../workers/memory.worker', () => ({
  memoryWorker: {
    consolidateMemories: vi.fn(),
    applyMemoryDecay: vi.fn(),
    generateEmbeddingsBatch: vi.fn(),
    refreshStaleEmbeddings: vi.fn(),
    recalculateImportanceScores: vi.fn(),
    archiveUnusedMemories: vi.fn(),
    cleanupExpiredMemories: vi.fn(),
    updateMemoryQuotas: vi.fn(),
  },
}))

describe('MemoryLifecycleService', () => {
  let service: MemoryLifecycleService

  beforeEach(async () => {
    vi.clearAllMocks()
    service = new MemoryLifecycleService()

    const { memoryWorker } = await import('../../workers/memory.worker')
    vi.mocked(memoryWorker.consolidateMemories).mockResolvedValue({ consolidated: 3, failed: 0 })
    vi.mocked(memoryWorker.applyMemoryDecay).mockResolvedValue({ processed: 10, decayed: 4 })
    vi.mocked(memoryWorker.generateEmbeddingsBatch).mockResolvedValue({ indexed: 5, failed: 0 })
    vi.mocked(memoryWorker.refreshStaleEmbeddings).mockResolvedValue(2)
    vi.mocked(memoryWorker.recalculateImportanceScores).mockResolvedValue({ updated: 7, failed: 0 })
    vi.mocked(memoryWorker.archiveUnusedMemories).mockResolvedValue(1)
    vi.mocked(memoryWorker.cleanupExpiredMemories).mockResolvedValue(6)
    vi.mocked(memoryWorker.updateMemoryQuotas).mockResolvedValue(9)
  })

  describe('runWorkspaceMaintenance', () => {
    it('runs every lifecycle step and reports real counts from each', async () => {
      const result = await service.runWorkspaceMaintenance('ws-1')

      expect(result).toEqual({
        workspaceId: 'ws-1',
        consolidated: 3,
        decayed: 4,
        embeddingsIndexed: 5,
        embeddingsRefreshed: 2,
        importanceUpdated: 7,
        archived: 1,
        cleanedUp: 6,
        errors: [],
      })
    })

    it('calls every step with the workspace id', async () => {
      const { memoryWorker } = await import('../../workers/memory.worker')
      await service.runWorkspaceMaintenance('ws-42')

      expect(memoryWorker.consolidateMemories).toHaveBeenCalledWith('ws-42')
      expect(memoryWorker.applyMemoryDecay).toHaveBeenCalledWith('ws-42')
      expect(memoryWorker.generateEmbeddingsBatch).toHaveBeenCalledWith('ws-42')
      expect(memoryWorker.refreshStaleEmbeddings).toHaveBeenCalledWith('ws-42')
      expect(memoryWorker.recalculateImportanceScores).toHaveBeenCalledWith('ws-42')
      expect(memoryWorker.archiveUnusedMemories).toHaveBeenCalledWith('ws-42')
      expect(memoryWorker.cleanupExpiredMemories).toHaveBeenCalledWith('ws-42')
    })

    it('isolates a failing step: other steps still run and the failure is recorded, not thrown', async () => {
      const { memoryWorker } = await import('../../workers/memory.worker')
      vi.mocked(memoryWorker.applyMemoryDecay).mockRejectedValue(new Error('decay boom'))

      const result = await service.runWorkspaceMaintenance('ws-1')

      expect(result.decayed).toBe(0)
      expect(result.errors).toEqual(['decay: decay boom'])
      // Steps after the failing one still ran
      expect(result.consolidated).toBe(3)
      expect(result.cleanedUp).toBe(6)
    })

    it('records multiple independent step failures without aborting the run', async () => {
      const { memoryWorker } = await import('../../workers/memory.worker')
      vi.mocked(memoryWorker.applyMemoryDecay).mockRejectedValue(new Error('decay boom'))
      vi.mocked(memoryWorker.cleanupExpiredMemories).mockRejectedValue(new Error('cleanup boom'))

      const result = await service.runWorkspaceMaintenance('ws-1')

      expect(result.errors).toHaveLength(2)
      expect(result.errors).toContain('decay: decay boom')
      expect(result.errors).toContain('cleanup: cleanup boom')
    })
  })

  describe('runAllWorkspaces', () => {
    it('runs maintenance for every workspace with a memory quota', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memoryQuota.findMany).mockResolvedValue([
        { workspaceId: 'ws-1' },
        { workspaceId: 'ws-2' },
      ] as never)

      const result = await service.runAllWorkspaces()

      expect(result.workspacesProcessed).toBe(2)
      expect(result.workspacesFailed).toBe(0)
      expect(result.results.map((r) => r.workspaceId)).toEqual(['ws-1', 'ws-2'])
    })

    it('resets quotas exactly once per run, globally, not per workspace', async () => {
      const { prisma } = await import('@synora/database')
      const { memoryWorker } = await import('../../workers/memory.worker')
      vi.mocked(prisma.memoryQuota.findMany).mockResolvedValue([
        { workspaceId: 'ws-1' },
        { workspaceId: 'ws-2' },
      ] as never)

      const result = await service.runAllWorkspaces()

      expect(memoryWorker.updateMemoryQuotas).toHaveBeenCalledTimes(1)
      expect(result.quotasReset).toBe(9)
    })

    it('isolates a workspace whose maintenance run rejects outright: other workspaces are still processed', async () => {
      // runWorkspaceMaintenance normally never rejects (every step catches
      // its own error) — this exercises runAllWorkspaces' own defensive
      // isolation for the case of an unexpected synchronous/thrown failure
      // in the orchestration itself, not a step.
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memoryQuota.findMany).mockResolvedValue([
        { workspaceId: 'ws-broken' },
        { workspaceId: 'ws-ok' },
      ] as never)

      const spy = vi
        .spyOn(service, 'runWorkspaceMaintenance')
        .mockImplementationOnce(() => Promise.reject(new Error('total failure')))
        .mockImplementationOnce(async (workspaceId: string) => ({
          workspaceId,
          consolidated: 0,
          decayed: 0,
          embeddingsIndexed: 0,
          embeddingsRefreshed: 0,
          importanceUpdated: 0,
          archived: 0,
          cleanedUp: 0,
          errors: [],
        }))

      const result = await service.runAllWorkspaces()

      expect(result.workspacesFailed).toBe(1)
      expect(result.workspacesProcessed).toBe(1)
      expect(result.results[0].workspaceId).toBe('ws-ok')
      spy.mockRestore()
    })

    it('returns an empty run when no workspace has opted into memory', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memoryQuota.findMany).mockResolvedValue([])

      const result = await service.runAllWorkspaces()

      expect(result.workspacesProcessed).toBe(0)
      expect(result.results).toEqual([])
    })
  })
})
