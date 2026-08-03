import { engineeringEventBus } from './event-bus.js';

/**
 * Watches how often each provider and model actually succeeds, and raises
 * an alert when the recent window falls materially below that model's own
 * history.
 *
 * IT MEASURES IN PERCENTAGE POINTS, NOT MULTIPLES. Its two siblings compare
 * ratios: cost rising 1.5×, latency rising 1.5×. Applied to a success rate
 * that would be nonsense. A model dropping from 100% to 98% is a ratio of
 * 0.98 — trivially small by that measure, and operationally significant:
 * one request in fifty now fails that never used to. Success rates live in
 * a bounded 0–100 range where the meaningful question is how many points
 * moved, not by what factor.
 *
 * Otherwise the shape is the family's: each model compared only against
 * itself, nothing claimed below the sample minimums, one alert per episode,
 * and improvement is never an alert.
 */

const MAX_SAMPLES = 500;

interface ReliabilityStats {
  providerId: string;
  modelId: string;
  /** Outcomes in arrival order — recency defines the window. */
  outcomes: boolean[];
  /** Error codes seen in the recent window, for the proposal's evidence. */
  recentErrorCodes: string[];
  requests: number;
  alerted: boolean;
  lastObservedAt: number;
}

export interface DegradationEntry {
  providerId: string;
  modelId: string;
  requests: number;
  /** Success rate before the recent window. Null until enough history exists. */
  baselineSuccessRate: number | null;
  recentSuccessRate: number | null;
  /** How many percentage points the rate fell. Null when not yet comparable. */
  dropPercentagePoints: number | null;
  baselineSamples: number;
  sufficientData: boolean;
  degraded: boolean;
  lastObservedAt: number;
}

const stats = new Map<string, ReliabilityStats>();
let unsubscribe: (() => void) | null = null;
let windowSize = 20;
let minBaselineSamples = 50;
let dropPointsThreshold = 10;

function rate(outcomes: boolean[]): number {
  if (outcomes.length === 0) return 0;
  return outcomes.filter(Boolean).length / outcomes.length;
}

interface Comparison {
  baseline: number | null;
  recent: number | null;
  dropPoints: number | null;
  baselineSamples: number;
  sufficientData: boolean;
  degraded: boolean;
}

function compare(entry: ReliabilityStats): Comparison {
  const baselineOutcomes = entry.outcomes.slice(0, Math.max(0, entry.outcomes.length - windowSize));
  const recentOutcomes = entry.outcomes.slice(-windowSize);

  const sufficientData =
    baselineOutcomes.length >= minBaselineSamples && recentOutcomes.length >= windowSize;

  if (!sufficientData) {
    return {
      baseline: null,
      recent: null,
      dropPoints: null,
      baselineSamples: baselineOutcomes.length,
      sufficientData: false,
      degraded: false,
    };
  }

  const baseline = rate(baselineOutcomes);
  const recent = rate(recentOutcomes);
  const dropPoints = (baseline - recent) * 100;

  return {
    baseline,
    recent,
    dropPoints,
    baselineSamples: baselineOutcomes.length,
    sufficientData,
    degraded: dropPoints >= dropPointsThreshold,
  };
}

export function recordReliabilityObservation(obs: {
  providerId: string;
  modelId: string;
  success: boolean;
  errorCode?: string;
}): void {
  const key = `${obs.providerId}:${obs.modelId}`;
  let entry = stats.get(key);
  if (!entry) {
    entry = {
      providerId: obs.providerId,
      modelId: obs.modelId,
      outcomes: [],
      recentErrorCodes: [],
      requests: 0,
      alerted: false,
      lastObservedAt: 0,
    };
    stats.set(key, entry);
  }

  entry.requests += 1;
  entry.outcomes.push(obs.success);
  if (entry.outcomes.length > MAX_SAMPLES) {
    entry.outcomes.splice(0, entry.outcomes.length - MAX_SAMPLES);
  }
  if (!obs.success && obs.errorCode) {
    entry.recentErrorCodes.push(obs.errorCode);
    if (entry.recentErrorCodes.length > windowSize) {
      entry.recentErrorCodes.splice(0, entry.recentErrorCodes.length - windowSize);
    }
  }
  entry.lastObservedAt = Date.now();

  const result = compare(entry);
  if (result.degraded) {
    if (!entry.alerted) {
      entry.alerted = true;
      engineeringEventBus.emit({
        type: 'alert.provider_degradation',
        timestamp: Date.now(),
        source: 'provider-degradation',
        payload: {
          providerId: entry.providerId,
          modelId: entry.modelId,
          baselineSuccessRate: result.baseline ?? 0,
          recentSuccessRate: result.recent ?? 0,
          dropPercentagePoints: Math.round(result.dropPoints ?? 0),
          baselineSamples: result.baselineSamples,
          windowSize,
          // The codes themselves, so a reader can tell a rate limit from a
          // timeout from a malformed request without leaving the proposal.
          errorCodes: [...new Set(entry.recentErrorCodes)],
        },
      });
    }
  } else {
    entry.alerted = false;
  }
}

export function getDegradationReport(): DegradationEntry[] {
  const report: DegradationEntry[] = [];
  for (const entry of stats.values()) {
    const result = compare(entry);
    report.push({
      providerId: entry.providerId,
      modelId: entry.modelId,
      requests: entry.requests,
      baselineSuccessRate: result.baseline,
      recentSuccessRate: result.recent,
      dropPercentagePoints: result.dropPoints === null ? null : Math.round(result.dropPoints),
      baselineSamples: result.baselineSamples,
      sufficientData: result.sufficientData,
      degraded: result.degraded,
      lastObservedAt: entry.lastObservedAt,
    });
  }
  return report.sort((a, b) => b.requests - a.requests);
}

export function startProviderDegradation(
  opts: { windowSize?: number; minBaselineSamples?: number; dropPointsThreshold?: number } = {},
): void {
  if (unsubscribe) return;
  windowSize = opts.windowSize ?? 20;
  minBaselineSamples = opts.minBaselineSamples ?? 50;
  dropPointsThreshold = opts.dropPointsThreshold ?? 10;

  unsubscribe = engineeringEventBus.on('ai.provider.observation', (event) => {
    const p = event.payload as {
      providerId: string;
      modelId: string;
      success: boolean;
      errorCode?: string;
    };
    recordReliabilityObservation(p);
  });
}

export function stopProviderDegradation(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  stats.clear();
}
