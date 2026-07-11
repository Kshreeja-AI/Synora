import { asTenantId } from '@synora/core';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from './in-memory-event-bus.js';
import { makeEvent } from './make-event.js';

describe('InMemoryEventBus', () => {
  it('delivers events to exact-match subscribers', async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    bus.subscribe('agent.started', handler);

    await bus.publish(
      makeEvent({
        type: 'agent.started',
        tenantId: asTenantId('t1'),
        payload: { foo: 1 },
        source: 'test',
      }),
    );

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('supports wildcard prefix subscriptions', async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    bus.subscribe('agent.*', handler);

    await bus.publish(
      makeEvent({
        type: 'agent.completed',
        tenantId: asTenantId('t1'),
        payload: {},
        source: 'test',
      }),
    );
    await bus.publish(
      makeEvent({
        type: 'memory.written',
        tenantId: asTenantId('t1'),
        payload: {},
        source: 'test',
      }),
    );

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing handler from other subscribers', async () => {
    const bus = new InMemoryEventBus();
    const good = vi.fn();
    bus.subscribe('x', () => {
      throw new Error('boom');
    });
    bus.subscribe('x', good);

    await bus.publish(
      makeEvent({ type: 'x', tenantId: asTenantId('t1'), payload: {}, source: 'test' }),
    );

    expect(good).toHaveBeenCalledTimes(1);
  });

  it('stops delivering after unsubscribe', async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    const sub = bus.subscribe('x', handler);
    sub.unsubscribe();

    await bus.publish(
      makeEvent({ type: 'x', tenantId: asTenantId('t1'), payload: {}, source: 'test' }),
    );

    expect(handler).not.toHaveBeenCalled();
  });
});
