import { describe, it, expect, vi, beforeEach } from 'vitest';
import { engineeringEventBus } from '../event-bus';
import { sampleMemory, startMemoryCollector, stopMemoryCollector } from '../memory-collector';

describe('memory-collector', () => {
  beforeEach(() => {
    stopMemoryCollector();
  });

  it('emits process.memory event with RSS and heap data', () => {
    const events: unknown[] = [];
    const unsub = engineeringEventBus.on('process.memory', (e) => events.push(e));

    sampleMemory();

    expect(events).toHaveLength(1);
    const event = events[0] as any;
    expect(event.type).toBe('process.memory');
    expect(event.source).toBe('memory-collector');
    expect(event.payload.rssMb).toBeGreaterThan(0);
    expect(event.payload.heapUsedMb).toBeGreaterThan(0);
    expect(event.payload.heapTotalMb).toBeGreaterThanOrEqual(event.payload.heapUsedMb);
    expect(typeof event.payload.externalMb).toBe('number');
    expect(typeof event.payload.arrayBuffersMb).toBe('number');
    unsub();
  });

  it('startMemoryCollector emits an immediate sample', () => {
    const events: unknown[] = [];
    const unsub = engineeringEventBus.on('process.memory', (e) => events.push(e));

    vi.useFakeTimers();
    try {
      startMemoryCollector(60_000);
      expect(events).toHaveLength(1);
      stopMemoryCollector();
    } finally {
      vi.useRealTimers();
    }
    unsub();
  });

  it('startMemoryCollector is idempotent', () => {
    vi.useFakeTimers();
    try {
      startMemoryCollector(1000);
      startMemoryCollector(1000);
      stopMemoryCollector();
    } finally {
      vi.useRealTimers();
    }
  });
});
