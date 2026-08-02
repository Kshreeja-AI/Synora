import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processMemoryMaintenance } from '../memoryMaintenance.worker'

vi.mock('../../services/memoryLifecycle.service', () => ({
  memoryLifecycleService: {
    runAllWorkspaces: vi.fn(),
  },
}))

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

describe('processMemoryMaintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates to memoryLifecycleService.runAllWorkspaces', async () => {
    const { memoryLifecycleService } = await import('../../services/memoryLifecycle.service')
    vi.mocked(memoryLifecycleService.runAllWorkspaces).mockResolvedValue({
      workspacesProcessed: 3,
      workspacesFailed: 0,
      quotasReset: 3,
      results: [],
    })

    await processMemoryMaintenance({ triggeredBy: 'schedule' })

    expect(memoryLifecycleService.runAllWorkspaces).toHaveBeenCalledTimes(1)
  })

  it('propagates a failure so BullMQ retry/backoff applies, rather than swallowing it', async () => {
    const { memoryLifecycleService } = await import('../../services/memoryLifecycle.service')
    vi.mocked(memoryLifecycleService.runAllWorkspaces).mockRejectedValue(new Error('db unreachable'))

    await expect(processMemoryMaintenance({ triggeredBy: 'manual' })).rejects.toThrow('db unreachable')
  })
})
