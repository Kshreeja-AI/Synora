import type { Queue } from '@synora/application';
import type { RedisLike } from './redis-like.js';

/**
 * Polling-based queue over a Redis list. Simple and dependency-free; a production
 * deployment under sustained load may prefer a dedicated library (e.g. BullMQ) built on
 * the same `RedisLike` client — swapping is a new adapter, not a Queue port change.
 */
export class RedisQueue implements Queue {
  private readonly pollers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly client: RedisLike,
    private readonly pollIntervalMs: number = 250,
  ) {}

  async enqueue<T>(queueName: string, payload: T): Promise<void> {
    await this.client.lpush(queueName, JSON.stringify(payload));
  }

  process<T>(queueName: string, handler: (payload: T) => Promise<void>): void {
    if (this.pollers.has(queueName)) return;
    const timer = setInterval(() => {
      void this.pollOnce(queueName, handler);
    }, this.pollIntervalMs);
    this.pollers.set(queueName, timer);
  }

  /** Pops and handles a single item, if any. Exposed for tests and manual draining. */
  async pollOnce<T>(queueName: string, handler: (payload: T) => Promise<void>): Promise<boolean> {
    const raw = await this.client.rpop(queueName);
    if (raw === null) return false;
    await handler(JSON.parse(raw) as T);
    return true;
  }

  stop(queueName: string): void {
    const timer = this.pollers.get(queueName);
    if (timer) {
      clearInterval(timer);
      this.pollers.delete(queueName);
    }
  }
}
