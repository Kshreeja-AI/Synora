import { describe, it, expect } from 'vitest';
import { EmbeddingMetricsCollector } from '../metrics';

describe('EmbeddingMetricsCollector', () => {
  it('returns zeroed metrics for a provider with no recorded calls', () => {
    const collector = new EmbeddingMetricsCollector();
    const metrics = collector.getMetrics('openai');

    expect(metrics.calls).toBe(0);
    expect(metrics.errorRate).toBe(0);
    expect(metrics.cacheHitRate).toBe(0);
    expect(metrics.avgLatencyMs).toBe(0);
  });

  it('aggregates successful calls', () => {
    const collector = new EmbeddingMetricsCollector();
    collector.recordCall({ providerId: 'openai', latencyMs: 100, tokens: 10, cacheHit: false, success: true });
    collector.recordCall({ providerId: 'openai', latencyMs: 200, tokens: 20, cacheHit: false, success: true });

    const metrics = collector.getMetrics('openai');
    expect(metrics.calls).toBe(2);
    expect(metrics.totalTokens).toBe(30);
    expect(metrics.avgLatencyMs).toBe(150);
    expect(metrics.errorRate).toBe(0);
  });

  it('computes error rate from failed calls', () => {
    const collector = new EmbeddingMetricsCollector();
    collector.recordCall({ providerId: 'openai', latencyMs: 100, tokens: 10, cacheHit: false, success: true });
    collector.recordCall({ providerId: 'openai', latencyMs: 100, tokens: 0, cacheHit: false, success: false });

    const metrics = collector.getMetrics('openai');
    expect(metrics.calls).toBe(2);
    expect(metrics.errors).toBe(1);
    expect(metrics.errorRate).toBe(0.5);
  });

  it('computes cache hit rate', () => {
    const collector = new EmbeddingMetricsCollector();
    collector.recordCall({ providerId: 'openai', latencyMs: 0, tokens: 10, cacheHit: true, success: true });
    collector.recordCall({ providerId: 'openai', latencyMs: 0, tokens: 10, cacheHit: true, success: true });
    collector.recordCall({ providerId: 'openai', latencyMs: 100, tokens: 10, cacheHit: false, success: true });

    const metrics = collector.getMetrics('openai');
    expect(metrics.cacheHits).toBe(2);
    expect(metrics.cacheMisses).toBe(1);
    expect(metrics.cacheHitRate).toBeCloseTo(2 / 3);
  });

  it('keeps separate metrics per provider', () => {
    const collector = new EmbeddingMetricsCollector();
    collector.recordCall({ providerId: 'openai', latencyMs: 100, tokens: 10, cacheHit: false, success: true });
    collector.recordCall({ providerId: 'voyage', latencyMs: 50, tokens: 5, cacheHit: false, success: true });

    expect(collector.getMetrics('openai').calls).toBe(1);
    expect(collector.getMetrics('voyage').calls).toBe(1);
    expect(collector.getAllMetrics().size).toBe(2);
  });
});
