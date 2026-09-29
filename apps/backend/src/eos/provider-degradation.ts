import { engineeringEventBus } from './event-bus.js';
import { DetectorWindow, type WindowSlices } from './detector-window.js';

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

interface ReliabilitySubject {
  providerId: string;
  modelId: string;
  /** Error codes seen recently, for the proposal's evidence. */
  recentErrorCodes: string[];
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

/** Windows and episode gating are shared; the comparison below is not. */
let window = new DetectorWindow<boolean>({ windowSize: 20, minBaselineSamples: 50 });
const subjects = new Map<string, ReliabilitySubject>();
let unsubscribe: (() => void) | null = null;
let windowSize = 20;
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

/**
 * THE COMPARISON, stated here rather than shared, and deliberately unlike
 * its siblings'. A success rate is bounded, so points are meaningful where
 * a ratio is not: 100% to 98% is a 0.98 ratio and a real incident.
 */
function compare(slices: WindowSlices<boolean>): Comparison {
  if (!slices.sufficientData) {
    return {
      baseline: null,
      recent: null,
      dropPoints: null,
      baselineSamples: slices.baselineSamples,
      sufficientData: false,
      degraded: false,
    };
  }

  const baseline = rate(slices.baseline);
  const recent = rate(slices.recent);
  const dropPoints = (baseline - recent) * 100;

  return {
    baseline,
    recent,
    dropPoints,
    baselineSamples: slices.baselineSamples,
    sufficientData: true,
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
  let subject = subjects.get(key);
  if (!subject) {
    subject = { providerId: obs.providerId, modelId: obs.modelId, recentErrorCodes: [] };
    subjects.set(key, subject);
  }

  if (!obs.success && obs.errorCode) {
    subject.recentErrorCodes.push(obs.errorCode);
    if (subject.recentErrorCodes.length > windowSize) {
      subject.recentErrorCodes.splice(0, subject.recentErrorCodes.length - windowSize);
    }
  }

  const result = compare(window.push(key, obs.success));

  if (window.shouldAlert(key, result.degraded)) {
    engineeringEventBus.emit({
      type: 'alert.provider_degradation',
      timestamp: Date.now(),
      source: 'provider-degradation',
      payload: {
        providerId: obs.providerId,
        modelId: obs.modelId,
        baselineSuccessRate: result.baseline ?? 0,
        recentSuccessRate: result.recent ?? 0,
        dropPercentagePoints: Math.round(result.dropPoints ?? 0),
        baselineSamples: result.baselineSamples,
        windowSize,
        // The codes themselves, so a reader can tell a rate limit from a
        // timeout from a malformed request without leaving the proposal.
        errorCodes: [...new Set(subject.recentErrorCodes)],
      },
    });
  }
}

export function getDegradationReport(): DegradationEntry[] {
  const report: DegradationEntry[] = [];
  for (const [key, subject] of subjects) {
    const result = compare(window.slices(key));
    report.push({
      providerId: subject.providerId,
      modelId: subject.modelId,
      requests: window.requestCount(key),
      baselineSuccessRate: result.baseline,
      recentSuccessRate: result.recent,
      dropPercentagePoints: result.dropPoints === null ? null : Math.round(result.dropPoints),
      baselineSamples: result.baselineSamples,
      sufficientData: result.sufficientData,
      degraded: result.degraded,
      lastObservedAt: window.lastObservedAt(key),
    });
  }
  return report.sort((a, b) => b.requests - a.requests);
}

export function startProviderDegradation(
  opts: { windowSize?: number; minBaselineSamples?: number; dropPointsThreshold?: number } = {},
): void {
  if (unsubscribe) return;
  windowSize = opts.windowSize ?? 20;
  dropPointsThreshold = opts.dropPointsThreshold ?? 10;
  window = new DetectorWindow<boolean>({
    windowSize,
    minBaselineSamples: opts.minBaselineSamples ?? 50,
  });

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
  window.clear();
  subjects.clear();
}
