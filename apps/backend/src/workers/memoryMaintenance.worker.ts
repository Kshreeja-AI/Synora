import { memoryLifecycleService } from '../services/memoryLifecycle.service'
import { logger } from '../utils/logger'

export interface MemoryMaintenanceJobData {
  triggeredBy: 'schedule' | 'manual'
}

/**
 * Runs the memory subsystem's full maintenance sweep: consolidation, decay,
 * embedding generation/refresh, importance recalculation, archival,
 * cleanup, and quota reset — across every workspace that has a memory
 * quota. Invoked on a schedule by the `memory-maintenance` queue (see
 * workers/queue.ts); a job's failure here is logged, not silently absorbed
 * — BullMQ's retry/backoff on this queue re-runs the whole sweep, which is
 * safe because every underlying operation is idempotent per workspace.
 */
export async function processMemoryMaintenance(data: MemoryMaintenanceJobData): Promise<void> {
  logger.info('[worker] Starting memory maintenance sweep', { triggeredBy: data.triggeredBy })

  const result = await memoryLifecycleService.runAllWorkspaces()

  logger.info('[worker] Memory maintenance sweep complete', {
    workspacesProcessed: result.workspacesProcessed,
    workspacesFailed: result.workspacesFailed,
    quotasReset: result.quotasReset,
  })
}
