import { engineeringEventBus } from './event-bus.js';

/**
 * Watches response times per provider and model, and raises an alert when
 * the recent window is materially slower than that model's own history.
 *
 * Same three constraints as the cost monitor — each model compared only
 * against itself, no claim below the sample minimums, one alert per episode
 * — plus one specific to timing:
 *
 * IT COMPARES p95, NOT THE MEAN. Latency distributions are skewed: most
 * calls are fast and a few are very slow. A mean is dominated by the fast
 * majority, so a tail that doubles can leave it barely moved — and the tail
 * is what customers actually experience as "it hung". Comparing the 95th
 * percentile watches the part that hurts.
 *
 * Getting faster is never an alert. A drop in latency is not a problem to
 * escalate, and treating any change as noteworthy would train the reader to
 * ignore all of them.
 */

const MAX_SAMPLES = 500;

interface LatencyStats {
  providerId: string;
  modelId: string;
  /** Latencies in arrival order. Order matters: recency defines the window. */
  samples: number[];
  requests: number;
  alerted: boolean;
  lastObservedAt: number;
}

export interface LatencyDriftEntry {
  providerId: string;
  modelId: string;
  requests: number;
  /** p95 before the recent window. Null until enough history exists. */
  baselineP95Ms: number | null;
  /** p95 over the recent window. Null until the window is full. */
  recentP95Ms: number | null;
  /** recent ÷ baseline, or null when a zero baseline makes it undefined. */
  ratio: number | null;
  baselineSamples: number;
  /** False when there is not yet enough history to say anything at all. */
  sufficientData: boolean;
  drifting: boolean;
  lastObservedAt: number;
}

const stats = new Map<string, LatencyStats>();
let unsubscribe: (() => void) | null = null;
let windowSize = 20;
let minBaselineSamples = 50;
let slowdownMultiplier = 1.5;

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

interface Comparison {
  baseline: number | null;
  recent: number | null;
  ratio: number | null;
  baselineSamples: number;
  sufficientData: boolean;
  drifting: boolean;
}

function compare(entry: LatencyStats): Comparison {
  const baselineValues = entry.samples.slice(0, Math.max(0, entry.samples.length - windowSize));
  const recentValues = entry.samples.slice(-windowSize);

  const sufficientData =
    baselineValues.length >= minBaselineSamples && recentValues.length >= windowSize;

  if (!sufficientData) {
    return {
      baseline: null,
      recent: null,
      ratio: null,
      baselineSamples: baselineValues.length,
      sufficientData: false,
      drifting: false,
    };
  }

  const baseline = percentile(baselineValues, 95);
  const recent = percentile(recentValues, 95);

  // A zero baseline gives no meaningful multiple. Instantaneous responses
  // becoming slow is still worth raising, but it is not a multiple of
  // anything, and a number there would invent precision.
  const ratio = baseline > 0 ? recent / baseline : null;
  const drifting = baseline > 0 ? recent >= baseline * slowdownMultiplier : recent > 0;

  return {
    baseline,
    recent,
    ratio,
    baselineSamples: baselineValues.length,
    sufficientData,
    drifting,
  };
}

export function recordLatencyObservation(obs: {
  providerId: string;
  modelId: string;
  latencyMs: number;
}): void {
  if (!Number.isFinite(obs.latencyMs) || obs.latencyMs < 0) return;

  const key = `${obs.providerId}:${obs.modelId}`;
  let entry = stats.get(key);
  if (!entry) {
    entry = {
      providerId: obs.providerId,
      modelId: obs.modelId,
      samples: [],
      requests: 0,
      alerted: false,
      lastObservedAt: 0,
    };
    stats.set(key, entry);
  }

  entry.requests += 1;
  entry.samples.push(obs.latencyMs);
  if (entry.samples.length > MAX_SAMPLES) {
    entry.samples.splice(0, entry.samples.length - MAX_SAMPLES);
  }
  entry.lastObservedAt = Date.now();

  const result = compare(entry);
  if (result.drifting) {
    if (!entry.alerted) {
      entry.alerted = true;
      engineeringEventBus.emit({
        type: 'alert.latency_drift',
        timestamp: Date.now(),
        source: 'latency-drift',
        payload: {
          providerId: entry.providerId,
          modelId: entry.modelId,
          baselineP95Ms: result.baseline ?? 0,
          recentP95Ms: result.recent ?? 0,
          ratio: result.ratio,
          baselineSamples: result.baselineSamples,
          windowSize,
        },
      });
    }
  } else {
    entry.alerted = false;
  }
}

export function getLatencyDriftReport(): LatencyDriftEntry[] {
  const report: LatencyDriftEntry[] = [];
  for (const entry of stats.values()) {
    const result = compare(entry);
    report.push({
      providerId: entry.providerId,
      modelId: entry.modelId,
      requests: entry.requests,
      baselineP95Ms: result.baseline,
      recentP95Ms: result.recent,
      ratio: result.ratio,
      baselineSamples: result.baselineSamples,
      sufficientData: result.sufficientData,
      drifting: result.drifting,
      lastObservedAt: entry.lastObservedAt,
    });
  }
  return report.sort((a, b) => b.requests - a.requests);
}

export function startLatencyDrift(
  opts: { windowSize?: number; minBaselineSamples?: number; slowdownMultiplier?: number } = {},
): void {
  if (unsubscribe) return;
  windowSize = opts.windowSize ?? 20;
  minBaselineSamples = opts.minBaselineSamples ?? 50;
  slowdownMultiplier = opts.slowdownMultiplier ?? 1.5;

  unsubscribe = engineeringEventBus.on('ai.provider.observation', (event) => {
    const p = event.payload as { providerId: string; modelId: string; latencyMs: number };
    recordLatencyObservation(p);
  });
}

export function stopLatencyDrift(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  stats.clear();
}
