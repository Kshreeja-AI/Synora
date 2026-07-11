import { DomainEvent, Identifier } from '@synora/domain';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from './in-memory-event-bus.js';

class TaskCreated extends DomainEvent {
  readonly eventName = 'task.created';
}

describe('InMemoryEventBus', () => {
  it('delivers a published event to subscribed handlers', async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    bus.subscribe('task.created', handler);

    const event = new TaskCreated(Identifier.generate());
    await bus.publish(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it('does not deliver events to handlers of a different event name', async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    bus.subscribe('task.completed', handler);

    await bus.publish(new TaskCreated(Identifier.generate()));

    expect(handler).not.toHaveBeenCalled();
  });

  it('isolates a throwing handler from other handlers', async () => {
    const bus = new InMemoryEventBus({ onHandlerError: vi.fn() });
    const goodHandler = vi.fn();
    bus.subscribe('task.created', () => {
      throw new Error('boom');
    });
    bus.subscribe('task.created', goodHandler);

    await bus.publish(new TaskCreated(Identifier.generate()));

    expect(goodHandler).toHaveBeenCalled();
  });

  it('unsubscribe stops further delivery', async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe('task.created', handler);
    unsubscribe();

    await bus.publish(new TaskCreated(Identifier.generate()));

    expect(handler).not.toHaveBeenCalled();
  });

  it('publishAll delivers events in order', async () => {
    const bus = new InMemoryEventBus();
    const order: string[] = [];
    bus.subscribe('task.created', () => {
      order.push('handled');
    });

    await bus.publishAll([
      new TaskCreated(Identifier.generate()),
      new TaskCreated(Identifier.generate()),
    ]);

    expect(order).toEqual(['handled', 'handled']);
  });
});
