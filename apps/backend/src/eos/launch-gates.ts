/**
 * The launch gates: what must be true, measured rather than estimated.
 *
 * WHY THIS EXISTS, AND WHY IT COMES FIRST. Every readiness figure reported
 * to the founder so far has been a considered estimate — "operational
 * readiness ~32%". Estimates are useful for direction and worthless as a
 * launch decision, because the person producing them is the person whose
 * work they assess. This module replaces the estimate with a measurement,
 * or with an explicit refusal to claim one.
 *
 * THE CENTRAL RULE: A GATE WITH NO EVIDENCE IS `unmeasured`, NEVER `failed`
 * AND NEVER `passed`. Those are three different states and collapsing any
 * two of them produces a launch decision made on fiction:
 *
 *   passed     — measured, and the measurement meets the threshold
 *   failed     — measured, and it does not
 *   unmeasured — nothing has produced evidence for this yet
 *
 * Reporting an unmeasured gate as failed would make readiness look like an
 * engineering problem when it is an absence of testing. Reporting it as
 * passed is the failure mode that ends companies.
 *
 * THERE IS NO OVERALL PERCENTAGE. A single readiness score would average
 * measured and unmeasured gates into one number that sounds like knowledge.
 * The result reports how many gates are passed, failed, and unmeasured, and
 * `readyToLaunch` is true only when every gate is measured and passed.
 */

export type GateStatus = 'passed' | 'failed' | 'unmeasured';

export type GateCategory =
  | 'ai-quality'
  | 'benchmarks'
  | 'safety'
  | 'privacy'
  | 'reliability'
  | 'engineering';

export interface GateDefinition {
  id: string;
  category: GateCategory;
  /** What this gate means, in language a founder can act on. */
  question: string;
  /** The bar, e.g. 95 for "≥95%". */
  threshold: number;
  unit: '%' | 'count';
  /** Whether the measurement must meet-or-exceed, or stay at-or-below. */
  direction: 'at-least' | 'at-most';
  /** What would have to run for this to become measurable. */
  evidenceRequired: string;
}

/**
 * The gates the founder set, plus the evidence each needs. Thresholds are a
 * business decision and are recorded here as given; what this module adds
 * is the refusal to guess at whether they are met.
 */
export const LAUNCH_GATES: readonly GateDefinition[] = [
  {
    id: 'ai-quality',
    category: 'ai-quality',
    question: 'Are the AI answers good, judged against stated criteria?',
    threshold: 95,
    unit: '%',
    direction: 'at-least',
    evidenceRequired:
      'An evaluation run over a quality dataset with a configured AI judge. No judge is configured yet.',
  },
  {
    id: 'benchmark-pass-rate',
    category: 'benchmarks',
    question: 'Does Synora pass the public benchmark suites it claims to?',
    threshold: 98,
    unit: '%',
    direction: 'at-least',
    evidenceRequired: 'Imported public benchmark datasets executed end to end. None are imported yet.',
  },
  {
    id: 'hallucination-rate',
    category: 'ai-quality',
    question: 'How often does it state things that are not true?',
    threshold: 2,
    unit: '%',
    direction: 'at-most',
    evidenceRequired:
      'A factual-accuracy dataset with grading that can distinguish a wrong answer from a fabricated one.',
  },
  {
    id: 'memory-accuracy',
    category: 'ai-quality',
    question: 'Does it correctly recall what it was told earlier?',
    threshold: 95,
    unit: '%',
    direction: 'at-least',
    evidenceRequired: 'Multi-turn memory evaluation cases executed against the memory subsystem.',
  },
  {
    id: 'security-tests',
    category: 'safety',
    question: 'Does it withstand injection, jailbreak, and malformed input?',
    threshold: 100,
    unit: '%',
    direction: 'at-least',
    evidenceRequired: 'An adversarial suite covering prompt injection, jailbreaks, and malformed payloads.',
  },
  {
    id: 'privacy-tests',
    category: 'privacy',
    question: 'Is personal data redacted everywhere it leaves the system?',
    threshold: 100,
    unit: '%',
    direction: 'at-least',
    evidenceRequired:
      'Redaction coverage executed across every export and capture path, not only the redaction module.',
  },
  {
    id: 'regression-failures',
    category: 'engineering',
    question: 'Has anything that used to work stopped working?',
    threshold: 0,
    unit: 'count',
    direction: 'at-most',
    evidenceRequired: 'Two evaluation runs of the same dataset to compare. Requires a case executor.',
  },
  {
    id: 'integration-tests',
    category: 'engineering',
    question: 'Do the parts work together, not only in isolation?',
    threshold: 99,
    unit: '%',
    direction: 'at-least',
    evidenceRequired:
      'The integration suite executed against a live database and Redis. Neither is available in this environment.',
  },
  {
    id: 'recovery-success',
    category: 'reliability',
    question: 'Does it recover from provider failures, timeouts, and crashes?',
    threshold: 99,
    unit: '%',
    direction: 'at-least',
    evidenceRequired: 'Fault-injection runs covering provider outage, timeout, and partial failure.',
  },
  {
    id: 'critical-bugs',
    category: 'engineering',
    question: 'Are there known defects that would harm a customer?',
    threshold: 0,
    unit: 'count',
    direction: 'at-most',
    evidenceRequired: 'A triaged defect list. No triage process is wired to this gate yet.',
  },
] as const;

export interface GateMeasurement {
  gateId: string;
  value: number;
  /** Where the number came from, so it can be rechecked rather than trusted. */
  source: string;
  measuredAt: number;
  /** How many observations the figure rests on. Small samples are stated. */
  sampleSize: number;
}

export interface GateResult extends GateDefinition {
  status: GateStatus;
  /** Null when unmeasured. Never zero-as-a-stand-in. */
  value: number | null;
  source?: string;
  measuredAt?: number;
  sampleSize?: number;
  /** Present only when unmeasured — restates what is missing. */
  blockedBy?: string;
}

export interface LaunchReadiness {
  gates: GateResult[];
  passed: number;
  failed: number;
  unmeasured: number;
  /** True only when every gate is measured and passing. */
  readyToLaunch: boolean;
  /**
   * Deliberately not a percentage. A single score would average measured
   * and unmeasured gates into a number that sounds like knowledge.
   */
  summary: string;
}

const measurements = new Map<string, GateMeasurement>();

/**
 * Records evidence for a gate. Only something that actually ran should call
 * this — there is no way to assert a gate passed without supplying a value,
 * a source, and a sample size.
 */
export function recordGateMeasurement(measurement: GateMeasurement): boolean {
  if (!LAUNCH_GATES.some((g) => g.id === measurement.gateId)) return false;
  if (!Number.isFinite(measurement.value) || measurement.sampleSize < 1) return false;
  measurements.set(measurement.gateId, measurement);
  return true;
}

export function clearGateMeasurements(): void {
  measurements.clear();
}

function evaluate(gate: GateDefinition): GateResult {
  const measurement = measurements.get(gate.id);

  if (!measurement) {
    return {
      ...gate,
      status: 'unmeasured',
      value: null,
      blockedBy: gate.evidenceRequired,
    };
  }

  const meets =
    gate.direction === 'at-least'
      ? measurement.value >= gate.threshold
      : measurement.value <= gate.threshold;

  return {
    ...gate,
    status: meets ? 'passed' : 'failed',
    value: measurement.value,
    source: measurement.source,
    measuredAt: measurement.measuredAt,
    sampleSize: measurement.sampleSize,
  };
}

export function getLaunchReadiness(): LaunchReadiness {
  const gates = LAUNCH_GATES.map(evaluate);
  const passed = gates.filter((g) => g.status === 'passed').length;
  const failed = gates.filter((g) => g.status === 'failed').length;
  const unmeasured = gates.filter((g) => g.status === 'unmeasured').length;

  const summary =
    unmeasured === gates.length
      ? `No launch gate has been measured yet. ${gates.length} gates are defined and all of them are waiting on evidence — this is the honest starting point, not a failure.`
      : failed > 0
        ? `${passed} of ${gates.length} gates pass, ${failed} fail, and ${unmeasured} have no evidence yet. A failing gate is a known problem; an unmeasured one is an unknown, and unknowns are not passes.`
        : unmeasured > 0
          ? `${passed} of ${gates.length} gates pass and ${unmeasured} have no evidence yet. Launch is not cleared until every gate is measured — an unmeasured gate is not a passing one.`
          : `All ${gates.length} gates are measured and passing.`;

  return {
    gates,
    passed,
    failed,
    unmeasured,
    // Every gate measured AND passing. Anything less is not a launch.
    readyToLaunch: unmeasured === 0 && failed === 0,
    summary,
  };
}
