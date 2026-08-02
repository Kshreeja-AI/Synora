import { describe, it, expect } from 'vitest'
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
})
