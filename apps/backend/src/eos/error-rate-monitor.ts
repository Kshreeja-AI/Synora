import { engineeringEventBus } from './event-bus.js';

interface ErrorWindow {
  timestamps: number[];
  windowMs: number;
  threshold: number;
}

let unsubscribe: (() => void) | null = null;

const window: ErrorWindow = {
  timestamps: [],
  windowMs: 60_000,
  threshold: 10,
};

function pruneWindow(now: number): void {
  const cutoff = now - window.windowMs;
  while (window.timestamps.length > 0 && window.timestamps[0] < cutoff) {
    window.timestamps.shift();
  }
}

export function startErrorRateMonitor(
  opts: { windowMs?: number; threshold?: number } = {},
): void {
  if (unsubscribe) return;

  window.windowMs = opts.windowMs ?? 60_000;
  window.threshold = opts.threshold ?? 10;
  window.timestamps.length = 0;

  unsubscribe = engineeringEventBus.on('api.request.error', (event) => {
    const now = event.timestamp;
    window.timestamps.push(now);
    pruneWindow(now);

    if (window.timestamps.length >= window.threshold) {
      engineeringEventBus.emit({
        type: 'alert.error_rate',
        timestamp: now,
        source: 'error-rate-monitor',
        payload: {
          errorsInWindow: window.timestamps.length,
          windowMs: window.windowMs,
          threshold: window.threshold,
        },
      });
      window.timestamps.length = 0;
    }
  });
}

export function stopErrorRateMonitor(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  window.timestamps.length = 0;
}

export function getErrorRateSnapshot(): {
  errorsInWindow: number;
  windowMs: number;
  threshold: number;
} {
  pruneWindow(Date.now());
  return {
    errorsInWindow: window.timestamps.length,
    windowMs: window.windowMs,
    threshold: window.threshold,
  };
}
