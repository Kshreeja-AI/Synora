import { describe, it, expect } from 'vitest';
import { VectorDBMetricsCollector } from '../metrics';

describe('VectorDBMetricsCollector', () => {
  it('returns zeroed metrics for a provider with no recorded calls', () => {
    const collector = new VectorDBMetricsCollector();
    const metrics = collector.getMetrics('pinecone');

    expect(metrics.upsert.calls).toBe(0);
    expect(metrics.query.errorRate).toBe(0);
    expect(metrics.delete.avgLatencyMs).toBe(0);
  });

  it('tracks upsert/query/delete independently', () => {
    const collector = new VectorDBMetricsCollector();
    collector.recordCall({ providerId: 'pinecone', operation: 'upsert', latencyMs: 100, vectorCount: 10, success: true });
    collector.recordCall({ providerId: 'pinecone', operation: 'query', latencyMs: 50, vectorCount: 0, success: true });

    const metrics = collector.getMetrics('pinecone');
    expect(metrics.upsert.calls).toBe(1);
    expect(metrics.upsert.totalVectors).toBe(10);
    expect(metrics.query.calls).toBe(1);
    expect(metrics.delete.calls).toBe(0);
  });

  it('computes error rate per operation', () => {
    const collector = new VectorDBMetricsCollector();
    collector.recordCall({ providerId: 'pinecone', operation: 'query', latencyMs: 10, vectorCount: 0, success: true });
    collector.recordCall({ providerId: 'pinecone', operation: 'query', latencyMs: 10, vectorCount: 0, success: false });

    expect(collector.getMetrics('pinecone').query.errorRate).toBe(0.5);
  });

  it('computes average latency per operation', () => {
    const collector = new VectorDBMetricsCollector();
    collector.recordCall({ providerId: 'pinecone', operation: 'upsert', latencyMs: 100, vectorCount: 1, success: true });
    collector.recordCall({ providerId: 'pinecone', operation: 'upsert', latencyMs: 200, vectorCount: 1, success: true });

    expect(collector.getMetrics('pinecone').upsert.avgLatencyMs).toBe(150);
  });

  it('keeps metrics isolated per provider', () => {
    const collector = new VectorDBMetricsCollector();
    collector.recordCall({ providerId: 'pinecone', operation: 'upsert', latencyMs: 10, vectorCount: 1, success: true });
    collector.recordCall({ providerId: 'qdrant', operation: 'upsert', latencyMs: 10, vectorCount: 1, success: true });

    expect(collector.getAllMetrics().size).toBe(2);
    expect(collector.getMetrics('pinecone').upsert.calls).toBe(1);
    expect(collector.getMetrics('qdrant').upsert.calls).toBe(1);
  });
});
