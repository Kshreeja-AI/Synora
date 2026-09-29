import { engineeringEventBus } from './event-bus.js';
import { DetectorWindow, type WindowSlices } from './detector-window.js';

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

interface LatencySubject {
  providerId: string;
  modelId: string;
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

/** Windows and episode gating are shared; the comparison below is not. */
let window = new DetectorWindow<number>({ windowSize: 20, minBaselineSamples: 50 });
const subjects = new Map<string, LatencySubject>();
let unsubscribe: (() => void) | null = null;
let windowSize = 20;
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

/**
 * THE COMPARISON, stated here rather than shared. It is a ratio like the
 * cost monitor's, but of 95th percentiles rather than means — the tail is
 * what customers experience, and a mean would hide a doubling of it.
 */
function compare(slices: WindowSlices<number>): Comparison {
  if (!slices.sufficientData) {
    return {
      baseline: null,
      recent: null,
      ratio: null,
      baselineSamples: slices.baselineSamples,
      sufficientData: false,
      drifting: false,
    };
  }

  const baseline = percentile(slices.baseline, 95);
  const recent = percentile(slices.recent, 95);

  // A zero baseline gives no meaningful multiple. Instantaneous responses
  // becoming slow is still worth raising, but it is not a multiple of
  // anything, and a number there would invent precision.
  const ratio = baseline > 0 ? recent / baseline : null;
  const drifting = baseline > 0 ? recent >= baseline * slowdownMultiplier : recent > 0;

  return {
    baseline,
    recent,
    ratio,
    baselineSamples: slices.baselineSamples,
    sufficientData: true,
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
  subjects.set(key, { providerId: obs.providerId, modelId: obs.modelId });

  const result = compare(window.push(key, obs.latencyMs));

  if (window.shouldAlert(key, result.drifting)) {
    engineeringEventBus.emit({
      type: 'alert.latency_drift',
      timestamp: Date.now(),
      source: 'latency-drift',
      payload: {
        providerId: obs.providerId,
        modelId: obs.modelId,
        baselineP95Ms: result.baseline ?? 0,
        recentP95Ms: result.recent ?? 0,
        ratio: result.ratio,
        baselineSamples: result.baselineSamples,
        windowSize,
      },
    });
  }
}

export function getLatencyDriftReport(): LatencyDriftEntry[] {
  const report: LatencyDriftEntry[] = [];
  for (const [key, subject] of subjects) {
    const result = compare(window.slices(key));
    report.push({
      providerId: subject.providerId,
      modelId: subject.modelId,
      requests: window.requestCount(key),
      baselineP95Ms: result.baseline,
      recentP95Ms: result.recent,
      ratio: result.ratio,
      baselineSamples: result.baselineSamples,
      sufficientData: result.sufficientData,
      drifting: result.drifting,
      lastObservedAt: window.lastObservedAt(key),
    });
  }
  return report.sort((a, b) => b.requests - a.requests);
}

export function startLatencyDrift(
  opts: { windowSize?: number; minBaselineSamples?: number; slowdownMultiplier?: number } = {},
): void {
  if (unsubscribe) return;
  windowSize = opts.windowSize ?? 20;
  slowdownMultiplier = opts.slowdownMultiplier ?? 1.5;
  window = new DetectorWindow<number>({
    windowSize,
    minBaselineSamples: opts.minBaselineSamples ?? 50,
  });

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
  window.clear();
  subjects.clear();
}
