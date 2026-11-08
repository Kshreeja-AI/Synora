import { describe, it, expect, afterEach, vi } from 'vitest'
import { Queue } from 'bullmq'

type QueueModule = typeof import('../queue')

// importing ../queue constructs every producer queue below, and each one opens
// its own ioredis connection. Against a port with nothing listening those
// connections keep retrying (queue.ts deliberately gives producers no bounded
// retryStrategy, so a Redis restart is picked up), and ioredis prints an
// "Unhandled error event" for every refused attempt. Left open past the test,
// that flood starves the vitest worker's RPC ("Timeout calling onTaskUpdate")
// and fails the run with every assertion green. The refused connections are
// the expected condition here, so they are swallowed, and every queue is
// closed when its test ends.
const PRODUCER_QUEUE_NAMES = [
  'exportDatasetQueue',
  'runEvaluationQueue',
  'messageFeedbackQueue',
  'fileProcessingQueue',
  'videoGenerationQueue',
  'generateResponseQueue',
  'memoryMaintenanceQueue',
] as const satisfies readonly (keyof QueueModule)[]

function swallowExpectedConnectionErrors(queueModule: QueueModule): void {
  for (const name of PRODUCER_QUEUE_NAMES) {
    queueModule[name].on('error', () => {
      // ECONNREFUSED against the dead port is the condition under test.
    })
  }
}

async function closeAllProducerQueues(queueModule: QueueModule): Promise<void> {
  await Promise.all(
    PRODUCER_QUEUE_NAMES.map((name) =>
      queueModule[name].close().catch(() => {
        // Closing a queue whose connection never came up can itself throw.
      })
    )
  )
}

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
    deadQueue.on('error', () => {
      // Expected: nothing listens on this port.
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
    let queueModule: QueueModule | undefined

    afterEach(async () => {
      // Runs even when an assertion above threw, unlike the inline close()
      // calls at the end of each test.
      if (queueModule) {
        await closeAllProducerQueues(queueModule)
        queueModule = undefined
      }
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
      queueModule = await import('../queue')
      swallowExpectedConnectionErrors(queueModule)

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
      queueModule = await import('../queue')
      swallowExpectedConnectionErrors(queueModule)

      const start = Date.now()
      await expect(queueModule.scheduleMemoryMaintenance()).rejects.toThrow()
      expect(Date.now() - start).toBeLessThan(10000)

      await queueModule.memoryMaintenanceQueue.close().catch(() => {})
    }, 15000)
  })
})
