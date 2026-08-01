import { describe, it, expect } from 'vitest';
import { HealthChecker } from '../health';
import { VectorDBMetricsCollector } from '../metrics';

describe('HealthChecker', () => {
  it('reports healthy when there are no calls yet', () => {
    const health = new HealthChecker(new VectorDBMetricsCollector());
    expect(health.check('pinecone').status).toBe('healthy');
  });

  it('reports healthy with a low error rate', () => {
    const metrics = new VectorDBMetricsCollector();
    for (let i = 0; i < 20; i++) {
      metrics.recordCall({ providerId: 'pinecone', operation: 'query', latencyMs: 10, vectorCount: 0, success: true });
    }
    metrics.recordCall({ providerId: 'pinecone', operation: 'query', latencyMs: 10, vectorCount: 0, success: false });

    const health = new HealthChecker(metrics);
    const result = health.check('pinecone');
    expect(result.status).toBe('healthy');
    expect(result.totalCalls).toBe(21);
  });

  it('reports degraded with a moderate error rate', () => {
    const metrics = new VectorDBMetricsCollector();
    for (let i = 0; i < 8; i++) {
      metrics.recordCall({ providerId: 'pinecone', operation: 'query', latencyMs: 10, vectorCount: 0, success: true });
    }
    for (let i = 0; i < 2; i++) {
      metrics.recordCall({ providerId: 'pinecone', operation: 'query', latencyMs: 10, vectorCount: 0, success: false });
    }

    const health = new HealthChecker(metrics);
    expect(health.check('pinecone').status).toBe('degraded');
  });

  it('reports unhealthy with a high error rate', () => {
    const metrics = new VectorDBMetricsCollector();
    for (let i = 0; i < 4; i++) {
      metrics.recordCall({ providerId: 'pinecone', operation: 'query', latencyMs: 10, vectorCount: 0, success: false });
    }
    metrics.recordCall({ providerId: 'pinecone', operation: 'query', latencyMs: 10, vectorCount: 0, success: true });

    const health = new HealthChecker(metrics);
    expect(health.check('pinecone').status).toBe('unhealthy');
  });

  it('combines error rates across upsert/query/delete', () => {
    const metrics = new VectorDBMetricsCollector();
    metrics.recordCall({ providerId: 'pinecone', operation: 'upsert', latencyMs: 10, vectorCount: 1, success: true });
    metrics.recordCall({ providerId: 'pinecone', operation: 'delete', latencyMs: 10, vectorCount: 1, success: false });

    const health = new HealthChecker(metrics);
    const result = health.check('pinecone');
    expect(result.totalCalls).toBe(2);
    expect(result.combinedErrorRate).toBe(0.5);
  });
});
