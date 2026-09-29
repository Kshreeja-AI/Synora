import { describe, it, expect, afterEach, vi } from 'vitest'
import { Queue } from 'bullmq'

/**
 * Producer fail-fast contract.
 *
 * Request handlers await queue.add(); with ioredis's default
 * offline-queueing, a Redis outage makes those awaits hang
 * indefinitely (message send never returns). Producers therefore run
 * with enableOfflineQueue: false so add() REJECTS when Redis is
 * unreachable and each call site's error handling takes over. This
 * test points a producer-configured queue at a port with nothing
 * listening and asserts the rejection actually happens — if someone
 * removes the flag, this hangs into its timeout and fails.
 *
 * That contract, on its own, only holds once a connection has already
 * been established and then drops. It does NOT bound the *initial*
 * connection attempt — BullMQ's `add()` waits for the connection to
 * reach `ready` before enableOfflineQueue/maxRetriesPerRequest are
 * even consulted, so a Redis that has never been reachable makes
 * add() hang forever regardless of those options (this exact bug
 * hung the docker CI smoke test to its 30s timeout when
 * scheduleMemoryMaintenance() started running at app boot). The
 * second test below exercises the real exported queue.ts producers —
 * including their addWithTimeout wrapper — against an unreachable
 * Redis, not a hand-rolled config, so it would have caught that.
 */
describe('queue producer configuration', () => {
  it('rejects add() promptly when Redis is unreachable', async () => {
    const deadQueue = new Queue('producer-failfast-probe', {
      connection: {
        // Nothing listens here; connection can never be established.
        host: 'localhost',
        port: 6399,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        // Never reconnect — one failed attempt is the point.
        retryStrategy: () => null,
      },
    })

    try {
      await expect(deadQueue.add('probe', { data: true })).rejects.toThrow()
    } finally {
      await deadQueue.close().catch(() => {
        // Closing a queue whose connection never came up can itself
        // throw; the test only cares that add() rejected.
      })
    }
  }, 15000)

  describe('real producers against a never-reachable Redis', () => {
    const originalRedisUrl = process.env.REDIS_URL

    afterEach(async () => {
      if (originalRedisUrl === undefined) {
        delete process.env.REDIS_URL
      } else {
        process.env.REDIS_URL = originalRedisUrl
      }
      vi.resetModules()
    })

    it('enqueueExportDataset rejects on a bounded timeout instead of hanging forever', async () => {
      vi.resetModules()
      process.env.REDIS_URL = 'redis://127.0.0.1:6399'
      const queueModule = await import('../queue')

      const start = Date.now()
      await expect(
        queueModule.enqueueExportDataset({
          exportId: 'exp-1',
          datasetId: 'ds-1',
          workspaceId: 'ws-1',
          format: 'JSONL',
        } as never)
      ).rejects.toThrow()
      // Must resolve well under BullMQ's default reconnect backoff
      // ceiling, not just "eventually".
      expect(Date.now() - start).toBeLessThan(10000)

      await queueModule.exportDatasetQueue.close().catch(() => {})
    }, 15000)

    it('scheduleMemoryMaintenance rejects on a bounded timeout instead of hanging app startup', async () => {
      vi.resetModules()
      process.env.REDIS_URL = 'redis://127.0.0.1:6399'
      const queueModule = await import('../queue')

      const start = Date.now()
      await expect(queueModule.scheduleMemoryMaintenance()).rejects.toThrow()
      expect(Date.now() - start).toBeLessThan(10000)

      await queueModule.memoryMaintenanceQueue.close().catch(() => {})
    }, 15000)
  })
})
