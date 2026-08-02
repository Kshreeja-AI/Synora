import { prisma as db } from '@synora/database'
import { memoryWorker } from '../workers/memory.worker'
import { memoryDeduplicationService } from './memoryDeduplication.service'
import { logger } from '../utils/logger'

export interface WorkspaceMaintenanceResult {
  workspaceId: string
  consolidated: number
  decayed: number
  embeddingsIndexed: number
  embeddingsRefreshed: number
  cleanedUp: number
  importanceUpdated: number
  archived: number
  deduplicated: number
  errors: string[]
}

export interface MaintenanceRunResult {
  workspacesProcessed: number
  workspacesFailed: number
  quotasReset: number
  results: WorkspaceMaintenanceResult[]
}

/**
 * Orchestrates the memory subsystem's background maintenance. This is the
 * scheduling layer that was missing: `MemoryWorker` (../workers/memory.worker.ts)
 * has always implemented consolidation, decay, embedding refresh, cleanup,
 * quota reset, importance scoring, and archival — but nothing ever called
 * those methods, so a memory's importance never actually decayed, expired
 * memories were never purged, and quotas never reset. This service is what
 * a scheduled job (see workers/memoryMaintenance.worker.ts) calls once per
 * workspace per run.
 *
 * Each step is isolated: one workspace's failure, or one step's failure
 * within a workspace, is logged and skipped rather than aborting the whole
 * run — a stuck embedding provider must never block decay/cleanup from
 * running for every other workspace.
 */
export class MemoryLifecycleService {
  async runWorkspaceMaintenance(workspaceId: string): Promise<WorkspaceMaintenanceResult> {
    const result: WorkspaceMaintenanceResult = {
      workspaceId,
      consolidated: 0,
      decayed: 0,
      embeddingsIndexed: 0,
      embeddingsRefreshed: 0,
      cleanedUp: 0,
      importanceUpdated: 0,
      archived: 0,
      deduplicated: 0,
      errors: [],
    }

    await this.runStep(result, 'consolidation', async () => {
      const { consolidated } = await memoryWorker.consolidateMemories(workspaceId)
      result.consolidated = consolidated
    })

    // Runs before decay/archival/cleanup so a memory doesn't get decayed or
    // archived under its own identity right before being folded into a
    // duplicate — the merge already carries its importance/tags forward.
    await this.runStep(result, 'deduplication', async () => {
      const { duplicatesRemoved } = await memoryDeduplicationService.deduplicateWorkspace(workspaceId)
      result.deduplicated = duplicatesRemoved
    })

    await this.runStep(result, 'decay', async () => {
      const { decayed } = await memoryWorker.applyMemoryDecay(workspaceId)
      result.decayed = decayed
    })

    await this.runStep(result, 'embedding_generation', async () => {
      const { indexed } = await memoryWorker.generateEmbeddingsBatch(workspaceId)
      result.embeddingsIndexed = indexed
    })

    await this.runStep(result, 'embedding_refresh', async () => {
      result.embeddingsRefreshed = await memoryWorker.refreshStaleEmbeddings(workspaceId)
    })

    await this.runStep(result, 'importance_recalculation', async () => {
      const { updated } = await memoryWorker.recalculateImportanceScores(workspaceId)
      result.importanceUpdated = updated
    })

    await this.runStep(result, 'archival', async () => {
      result.archived = await memoryWorker.archiveUnusedMemories(workspaceId)
    })

    await this.runStep(result, 'cleanup', async () => {
      result.cleanedUp = await memoryWorker.cleanupExpiredMemories(workspaceId)
    })

    return result
  }

  /**
   * Runs maintenance for every workspace that has opted into the memory
   * subsystem (has a MemoryQuota row), plus a single global quota reset.
   */
  async runAllWorkspaces(): Promise<MaintenanceRunResult> {
    const quotas = await db.memoryQuota.findMany({ select: { workspaceId: true } })

    const results: WorkspaceMaintenanceResult[] = []
    let workspacesFailed = 0

    for (const { workspaceId } of quotas) {
      try {
        results.push(await this.runWorkspaceMaintenance(workspaceId))
      } catch (error) {
        workspacesFailed++
        logger.error('[MemoryLifecycle] Workspace maintenance failed entirely', {
          workspaceId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    let quotasReset = 0
    try {
      quotasReset = await memoryWorker.updateMemoryQuotas()
    } catch (error) {
      logger.error('[MemoryLifecycle] Quota reset failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    logger.info('[MemoryLifecycle] Maintenance run complete', {
      workspacesProcessed: results.length,
      workspacesFailed,
      quotasReset,
    })

    return {
      workspacesProcessed: results.length,
      workspacesFailed,
      quotasReset,
      results,
    }
  }

  private async runStep(
    result: WorkspaceMaintenanceResult,
    stepName: string,
    step: () => Promise<void>,
  ): Promise<void> {
    try {
      await step()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.errors.push(`${stepName}: ${message}`)
      logger.error(`[MemoryLifecycle] Step "${stepName}" failed`, {
        workspaceId: result.workspaceId,
        error: message,
      })
    }
  }
}

export const memoryLifecycleService = new MemoryLifecycleService()
