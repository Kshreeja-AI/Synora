import { DomainEvent, Identifier } from '@synora/domain';
import { describe, expect, it, vi } from 'vitest';
import { FakeNatsClient } from './fake-nats.test-helper.js';
import { NatsEventBus } from './nats-event-bus.js';

class TaskCreated extends DomainEvent {
  readonly eventName = 'task.created';
  constructor(
    aggregateId: Identifier,
    readonly title: string,
  ) {
    super(aggregateId);
  }
}

describe('NatsEventBus', () => {
  it('round-trips a published event to a subscriber as JSON', async () => {
    const bus = new NatsEventBus(new FakeNatsClient());
    const received: TaskCreated[] = [];
    bus.subscribe<TaskCreated>('task.created', (event) => {
      received.push(event);
    });

    await bus.publish(new TaskCreated(Identifier.generate(), 'Write docs'));

    expect(received).toHaveLength(1);
    expect(received[0]?.title).toBe('Write docs');
  });

  it('reports handler errors via onHandlerError instead of throwing', async () => {
    const onHandlerError = vi.fn();
    const bus = new NatsEventBus(new FakeNatsClient(), { onHandlerError });
    bus.subscribe('task.created', () => {
      throw new Error('boom');
    });

    await bus.publish(new TaskCreated(Identifier.generate(), 'Write docs'));
    await new Promise((resolve) => setImmediate(resolve));

    expect(onHandlerError).toHaveBeenCalled();
  });

  it('unsubscribe stops delivery', async () => {
    const bus = new NatsEventBus(new FakeNatsClient());
    const handler = vi.fn();
    const unsubscribe = bus.subscribe('task.created', handler);
    unsubscribe();

    await bus.publish(new TaskCreated(Identifier.generate(), 'Write docs'));

    expect(handler).not.toHaveBeenCalled();
  });
});
