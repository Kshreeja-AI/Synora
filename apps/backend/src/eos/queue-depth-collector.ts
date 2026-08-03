import { engineeringEventBus } from './event-bus.js';
import { getMetricsCollector } from '../queue/metrics.js';
import type { JobType } from '../queue/types.js';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export async function sampleQueueDepths(): Promise<void> {
  const collector = getMetricsCollector();
  const allMetrics = await collector.collectAllMetrics();

  for (const [jobType, metrics] of allMetrics) {
    const depth = metrics.waiting + metrics.active + metrics.delayed;
    if (depth === 0) continue;

    engineeringEventBus.emit({
      type: 'queue.depth',
      timestamp: Date.now(),
      source: 'queue-depth-collector',
      payload: {
        queue: jobType as string,
        waiting: metrics.waiting,
        active: metrics.active,
        delayed: metrics.delayed,
        depth,
      },
    });
  }
}

export function startQueueDepthCollector(intervalMs = 30_000): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    sampleQueueDepths().catch(() => {});
  }, intervalMs);
  intervalHandle.unref?.();
}

export function stopQueueDepthCollector(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
