import { describe, expect, it, vi } from 'vitest';
import { FakeRedis } from './fake-redis.test-helper.js';
import { RedisQueue } from './redis-queue.js';

describe('RedisQueue', () => {
  it('delivers enqueued payloads to the handler on pollOnce', async () => {
    const queue = new RedisQueue(new FakeRedis());
    await queue.enqueue('emails', { to: 'a@example.com' });

    const handler = vi.fn(async () => {});
    const delivered = await queue.pollOnce('emails', handler);

    expect(delivered).toBe(true);
    expect(handler).toHaveBeenCalledWith({ to: 'a@example.com' });
  });

  it('pollOnce returns false when the queue is empty', async () => {
    const queue = new RedisQueue(new FakeRedis());
    const handler = vi.fn(async () => {});
    expect(await queue.pollOnce('emails', handler)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('processes items in FIFO order', async () => {
    const queue = new RedisQueue(new FakeRedis());
    await queue.enqueue('jobs', 1);
    await queue.enqueue('jobs', 2);

    const seen: number[] = [];
    const handler = async (payload: number) => {
      seen.push(payload);
    };

    await queue.pollOnce('jobs', handler);
    await queue.pollOnce('jobs', handler);

    expect(seen).toEqual([1, 2]);
  });
});
