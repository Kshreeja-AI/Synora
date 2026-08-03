import { describe, it, expect, vi } from 'vitest';
import { EngineeringEventBus } from '../event-bus';

function makeBus(size?: number) {
  return new EngineeringEventBus(size);
}

function makeEvent(type = 'test.event', source = 'test') {
  return {
    type,
    timestamp: Date.now(),
    source,
    payload: { key: 'value' },
  };
}

describe('EngineeringEventBus', () => {
  it('emits events to typed listeners', () => {
    const bus = makeBus();
    const handler = vi.fn();
    bus.on('worker.job.completed', handler);

    const event = makeEvent('worker.job.completed');
    bus.emit(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it('wildcard listener receives all events', () => {
    const bus = makeBus();
    const handler = vi.fn();
    bus.onAll(handler);

    bus.emit(makeEvent('a'));
    bus.emit(makeEvent('b'));

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe stops delivery', () => {
    const bus = makeBus();
    const handler = vi.fn();
    const unsub = bus.on('x', handler);

    bus.emit(makeEvent('x'));
    unsub();
    bus.emit(makeEvent('x'));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('keeps a ring buffer of recent events', () => {
    const bus = makeBus(5);

    for (let i = 0; i < 8; i++) {
      bus.emit(makeEvent('tick', `source-${i}`));
    }

    const recent = bus.recentEvents(10);
    expect(recent).toHaveLength(5);
    expect(recent[0].source).toBe('source-3');
    expect(recent[4].source).toBe('source-7');
  });

  it('filters recent events by type', () => {
    const bus = makeBus();
    bus.emit(makeEvent('a'));
    bus.emit(makeEvent('b'));
    bus.emit(makeEvent('a'));

    expect(bus.recentByType('a')).toHaveLength(2);
    expect(bus.recentByType('b')).toHaveLength(1);
  });

  it('reports stats', () => {
    const bus = makeBus();
    bus.emit(makeEvent('x'));
    const stats = bus.stats();

    expect(stats.totalEmitted).toBe(1);
    expect(stats.bufferSize).toBe(1000);
    expect(typeof stats.listenerCount).toBe('number');
  });
});
