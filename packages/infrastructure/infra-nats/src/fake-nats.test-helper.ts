import type { NatsClientLike, NatsSubscription } from './nats-client-like.js';

/** In-process fake pub/sub used only in this package's tests. */
export class FakeNatsClient implements NatsClientLike {
  private readonly subscribers = new Map<string, Set<(data: Uint8Array) => void>>();

  publish(subject: string, data: Uint8Array): void {
    for (const onMessage of this.subscribers.get(subject) ?? []) {
      onMessage(data);
    }
  }

  subscribe(subject: string, onMessage: (data: Uint8Array) => void): NatsSubscription {
    const set = this.subscribers.get(subject) ?? new Set();
    set.add(onMessage);
    this.subscribers.set(subject, set);
    return { unsubscribe: () => set.delete(onMessage) };
  }
}
