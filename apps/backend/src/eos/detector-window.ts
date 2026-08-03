/**
 * The bookkeeping every detector shares — and deliberately nothing more.
 *
 * Four detectors independently grew the same skeleton: keep recent samples
 * per subject, split them into a baseline and a recent window, refuse to
 * claim anything until both are large enough, and alert once per episode
 * rather than once per sample. That is four copies of logic where a bug
 * fixed in one would be missed in three.
 *
 * WHAT THIS DELIBERATELY DOES NOT ABSORB: the comparison itself.
 *
 * Each detector compares differently, and each difference was a decision:
 *
 *   cost         — a ratio, because spend is unbounded
 *   latency      — a ratio of 95th percentiles, because the tail is what
 *                  customers experience and a mean hides it
 *   reliability  — percentage points, because a success rate is bounded and
 *                  100% to 98% is a 0.98 ratio yet a real incident
 *
 * A shared abstraction that made the comparison a parameter would turn each
 * of those decisions into a default, and the default would be whatever the
 * first detector happened to use. Three separate times this session, using
 * the neighbouring detector's comparison would have produced something that
 * ran cleanly and measured the wrong thing. So this module handles windows
 * and episodes; every detector still states its own comparison in full.
 */

export interface WindowConfig {
  /** How many recent samples form the window under examination. */
  windowSize: number;
  /** How many samples must precede that window before anything is claimed. */
  minBaselineSamples: number;
  /** Hard ceiling on retained samples per subject. */
  maxSamples?: number;
}

export interface WindowSlices<T> {
  baseline: T[];
  recent: T[];
  /**
   * False when there is not yet enough history to say anything. Reported
   * rather than hidden: "not enough data" and "nothing is wrong" are
   * different statements and must not look alike.
   */
  sufficientData: boolean;
  baselineSamples: number;
  totalSamples: number;
}

interface Subject<T> {
  samples: T[];
  count: number;
  alerted: boolean;
  lastObservedAt: number;
}

const DEFAULT_MAX_SAMPLES = 500;

export class DetectorWindow<T> {
  private readonly subjects = new Map<string, Subject<T>>();
  private readonly windowSize: number;
  private readonly minBaselineSamples: number;
  private readonly maxSamples: number;

  constructor(config: WindowConfig) {
    this.windowSize = config.windowSize;
    this.minBaselineSamples = config.minBaselineSamples;
    this.maxSamples = config.maxSamples ?? DEFAULT_MAX_SAMPLES;
  }

  /** Records a sample and returns the resulting slices for that subject. */
  push(key: string, sample: T): WindowSlices<T> {
    let subject = this.subjects.get(key);
    if (!subject) {
      subject = { samples: [], count: 0, alerted: false, lastObservedAt: 0 };
      this.subjects.set(key, subject);
    }

    subject.count += 1;
    subject.samples.push(sample);
    if (subject.samples.length > this.maxSamples) {
      subject.samples.splice(0, subject.samples.length - this.maxSamples);
    }
    subject.lastObservedAt = Date.now();

    return this.slices(key);
  }

  slices(key: string): WindowSlices<T> {
    const subject = this.subjects.get(key);
    if (!subject) {
      return { baseline: [], recent: [], sufficientData: false, baselineSamples: 0, totalSamples: 0 };
    }

    const baseline = subject.samples.slice(0, Math.max(0, subject.samples.length - this.windowSize));
    const recent = subject.samples.slice(-this.windowSize);

    return {
      baseline,
      recent,
      sufficientData: baseline.length >= this.minBaselineSamples && recent.length >= this.windowSize,
      baselineSamples: baseline.length,
      totalSamples: subject.count,
    };
  }

  /**
   * Episode gating. Returns true only on the transition into a triggered
   * state, so a sustained problem produces one alert rather than one per
   * request — and re-arms once the condition clears.
   */
  shouldAlert(key: string, triggered: boolean): boolean {
    const subject = this.subjects.get(key);
    if (!subject) return false;

    if (!triggered) {
      subject.alerted = false;
      return false;
    }
    if (subject.alerted) return false;

    subject.alerted = true;
    return true;
  }

  requestCount(key: string): number {
    return this.subjects.get(key)?.count ?? 0;
  }

  lastObservedAt(key: string): number {
    return this.subjects.get(key)?.lastObservedAt ?? 0;
  }

  keys(): string[] {
    return [...this.subjects.keys()];
  }

  clear(): void {
    this.subjects.clear();
  }
}
