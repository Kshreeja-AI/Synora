import { describe, expect, it } from 'vitest';
import { InMemoryMetricsRecorder } from './metrics.js';

describe('InMemoryMetricsRecorder', () => {
  it('aggregates counters by tag set', () => {
    const metrics = new InMemoryMetricsRecorder();
    metrics.incrementCounter('requests', 1, { route: '/chat' });
    metrics.incrementCounter('requests', 2, { route: '/chat' });
    metrics.incrementCounter('requests', 1, { route: '/health' });

    const snapshot = metrics.snapshot();
    expect(snapshot.counters['requests{route=/chat}']).toBe(3);
    expect(snapshot.counters['requests{route=/health}']).toBe(1);
  });

  it('computes histogram percentiles', () => {
    const metrics = new InMemoryMetricsRecorder();
    for (let i = 1; i <= 100; i++) {
      metrics.recordHistogram('latency_ms', i);
    }
    const snapshot = metrics.snapshot();
    expect(snapshot.histograms.latency_ms.count).toBe(100);
    expect(snapshot.histograms.latency_ms.p50).toBeGreaterThan(40);
    expect(snapshot.histograms.latency_ms.p50).toBeLessThan(60);
  });
});
