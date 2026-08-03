import { engineeringEventBus } from './event-bus.js';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function sampleMemory(): void {
  const mem = process.memoryUsage();
  engineeringEventBus.emit({
    type: 'process.memory',
    timestamp: Date.now(),
    source: 'memory-collector',
    payload: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      externalMb: Math.round(mem.external / 1024 / 1024),
      arrayBuffersMb: Math.round(mem.arrayBuffers / 1024 / 1024),
    },
  });
}

export function startMemoryCollector(intervalMs = 60_000): void {
  if (intervalHandle) return;
  sampleMemory();
  intervalHandle = setInterval(sampleMemory, intervalMs);
  intervalHandle.unref?.();
}

export function stopMemoryCollector(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
