import { describe, it, expect, beforeEach } from 'vitest';
import { initMetricsCollector, resetMetricsCollectorForTests } from '../metrics';

describe('QueueMetricsCollector', () => {
  beforeEach(() => {
    resetMetricsCollectorForTests();
  });

  it('should record worker health', () => {
    const collector = initMetricsCollector();

    collector.recordWorkerHealth('worker-1', {
      status: 'healthy',
      processedCount: 10,
      failedCount: 0,
      activeJobs: 1,
    });

    const health = collector.getWorkerHealth('worker-1');
    expect(health).not.toBeNull();
    expect(health?.processedCount).toBe(10);
    expect(health?.failedCount).toBe(0);
  });

  it('should increment worker processed count', () => {
    const collector = initMetricsCollector();

    collector.recordWorkerHealth('worker-1', {
      status: 'healthy',
      processedCount: 0,
      failedCount: 0,
      activeJobs: 0,
    });

    collector.incrementWorkerProcessed('worker-1');
    collector.incrementWorkerProcessed('worker-1');

    const health = collector.getWorkerHealth('worker-1');
    expect(health?.processedCount).toBe(2);
  });

  it('should increment worker failed count', () => {
    const collector = initMetricsCollector();

    collector.recordWorkerHealth('worker-1', {
      status: 'healthy',
      processedCount: 0,
      failedCount: 0,
      activeJobs: 0,
    });

    collector.incrementWorkerFailed('worker-1');
    collector.incrementWorkerFailed('worker-1');

    const health = collector.getWorkerHealth('worker-1');
    expect(health?.failedCount).toBe(2);
  });

  it('should get all worker health records', () => {
    const collector = initMetricsCollector();

    collector.recordWorkerHealth('worker-1', {
      status: 'healthy',
      processedCount: 0,
      failedCount: 0,
      activeJobs: 0,
    });

    collector.recordWorkerHealth('worker-2', {
      status: 'healthy',
      processedCount: 0,
      failedCount: 0,
      activeJobs: 0,
    });

    const allHealth = collector.getAllWorkerHealth();
    expect(allHealth.size).toBe(2);
  });

  it('should return null for unregistered worker', () => {
    const collector = initMetricsCollector();
    const health = collector.getWorkerHealth('unknown-worker');
    expect(health).toBeNull();
  });
});
