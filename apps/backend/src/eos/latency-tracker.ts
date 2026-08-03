import { engineeringEventBus } from './event-bus.js';

const durations: number[] = [];
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let maxSamples = 10_000;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function recordLatency(durationMs: number): void {
  durations.push(durationMs);
  if (durations.length > maxSamples) {
    durations.splice(0, durations.length - maxSamples);
  }
}

export function getLatencySnapshot(): {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
} {
  if (durations.length === 0) {
    return { count: 0, p50: 0, p95: 0, p99: 0, mean: 0 };
  }
  const sorted = [...durations].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    mean: Math.round(sum / sorted.length),
  };
}

export function startLatencyTracker(opts: { intervalMs?: number; maxSamples?: number } = {}): void {
  if (intervalHandle) return;
  maxSamples = opts.maxSamples ?? 10_000;
  intervalHandle = setInterval(() => {
    const snap = getLatencySnapshot();
    if (snap.count === 0) return;
    engineeringEventBus.emit({
      type: 'api.latency.summary',
      timestamp: Date.now(),
      source: 'latency-tracker',
      payload: snap,
    });
  }, opts.intervalMs ?? 60_000);
  intervalHandle.unref?.();
}

export function stopLatencyTracker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  durations.length = 0;
}
