import { describe, it, expect, vi, beforeEach } from 'vitest';
import { engineeringEventBus } from '../event-bus';
import { recordLatency, getLatencySnapshot, startLatencyTracker, stopLatencyTracker } from '../latency-tracker';

describe('latency-tracker', () => {
  beforeEach(() => {
    stopLatencyTracker();
  });

  it('returns zero snapshot when no data recorded', () => {
    const snap = getLatencySnapshot();
    expect(snap).toEqual({ count: 0, p50: 0, p95: 0, p99: 0, mean: 0 });
  });

  it('computes correct percentiles', () => {
    for (let i = 1; i <= 100; i++) recordLatency(i);

    const snap = getLatencySnapshot();
    expect(snap.count).toBe(100);
    expect(snap.p50).toBe(50);
    expect(snap.p95).toBe(95);
    expect(snap.p99).toBe(99);
    expect(snap.mean).toBe(51);
  });

  it('caps samples at maxSamples', () => {
    startLatencyTracker({ maxSamples: 50 });
    for (let i = 0; i < 100; i++) recordLatency(i);

    const snap = getLatencySnapshot();
    expect(snap.count).toBe(50);
  });

  it('emits api.latency.summary on interval', () => {
    const events: unknown[] = [];
    const unsub = engineeringEventBus.on('api.latency.summary', (e) => events.push(e));

    vi.useFakeTimers();
    try {
      startLatencyTracker({ intervalMs: 1000 });
      recordLatency(100);
      recordLatency(200);
      vi.advanceTimersByTime(1000);

      expect(events).toHaveLength(1);
      const event = events[0] as any;
      expect(event.type).toBe('api.latency.summary');
      expect(event.source).toBe('latency-tracker');
      expect(event.payload.count).toBe(2);
      expect(event.payload.p50).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
    unsub();
  });

  it('does not emit when no data recorded', () => {
    const events: unknown[] = [];
    const unsub = engineeringEventBus.on('api.latency.summary', (e) => events.push(e));

    vi.useFakeTimers();
    try {
      startLatencyTracker({ intervalMs: 1000 });
      vi.advanceTimersByTime(1000);
      expect(events).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
    unsub();
  });

  it('startLatencyTracker is idempotent', () => {
    vi.useFakeTimers();
    try {
      startLatencyTracker({ intervalMs: 1000 });
      startLatencyTracker({ intervalMs: 1000 });
      stopLatencyTracker();
    } finally {
      vi.useRealTimers();
    }
  });
});
