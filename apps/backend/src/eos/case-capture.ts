import { engineeringEventBus } from './event-bus.js';
import { addCase, createDataset, getDataset } from './evaluation-datasets.js';
import { redact, type RedactionRule, type RedactionResult } from './redaction.js';
import type { GraderSpec } from './evaluation-graders.js';

/**
 * Turns real traffic into evaluation cases.
 *
 * The cases worth keeping are overwhelmingly the ones that went wrong:
 * a failure captured today becomes a permanent regression test, which is
 * how an AI product regains the "fixed stays fixed" ratchet that ordinary
 * software gets for free.
 *
 * Capture is off by default and must be started explicitly, because it
 * derives data from customer interactions and that should never begin as
 * a silent side effect of importing a module.
 */

export interface CaptureConfig {
  datasetId: string;
  datasetName?: string;
  /** Capture interactions the caller marked unsuccessful. */
  captureFailures: boolean;
  /** Capture interactions whose user rating is at or below `lowRatingAtOrBelow`. */
  captureLowRated: boolean;
  lowRatingAtOrBelow: number;
  /** 0..1 chance of keeping a successful interaction, for baseline coverage. */
  successSampleRate: number;
  /** Hard ceiling so capture cannot grow without bound. */
  maxCases: number;
  /** Graders attached to captured cases. */
  defaultGraders: GraderSpec[];
  redactionRules?: RedactionRule[];
  /** Skip capture entirely when the user has not consented. */
  requireConsent: boolean;
}

export interface Interaction {
  promptId: string;
  input: string;
  output: string;
  success: boolean;
  /** Typically 1..5. Omitted when the user gave no rating. */
  rating?: number;
  /** Whether this user consented to their data being retained. */
  consented?: boolean;
  tags?: string[];
  note?: string;
}

const defaultConfig: CaptureConfig = {
  datasetId: 'captured-failures',
  datasetName: 'Captured real interactions',
  captureFailures: true,
  captureLowRated: true,
  lowRatingAtOrBelow: 2,
  successSampleRate: 0,
  maxCases: 500,
  defaultGraders: [{ grader: 'nonEmpty' }],
  requireConsent: true,
};

let config: CaptureConfig = { ...defaultConfig };
let active = false;
let unsubscribe: (() => void) | null = null;
let captured = 0;
let skipped = 0;
let sampler: () => number = Math.random;

export type CaptureDecision =
  | { capture: false; reason: string }
  | { capture: true; reason: string };

/** Pure policy decision, separated so it can be reasoned about and tested alone. */
export function shouldCapture(interaction: Interaction, cfg: CaptureConfig = config): CaptureDecision {
  if (cfg.requireConsent && interaction.consented !== true) {
    return { capture: false, reason: 'no-consent' };
  }
  if (!interaction.success && cfg.captureFailures) {
    return { capture: true, reason: 'failure' };
  }
  if (
    cfg.captureLowRated &&
    interaction.rating !== undefined &&
    interaction.rating <= cfg.lowRatingAtOrBelow
  ) {
    return { capture: true, reason: 'low-rating' };
  }
  if (interaction.success && cfg.successSampleRate > 0 && sampler() < cfg.successSampleRate) {
    return { capture: true, reason: 'success-sample' };
  }
  return { capture: false, reason: 'not-of-interest' };
}

export interface CapturedCase {
  input: string;
  actualOutput: string;
  tags: string[];
  note?: string;
  redactions: {
    input: RedactionResult;
    output: RedactionResult;
    note: RedactionResult | null;
  };
}

/**
 * The exact transformation applied to an interaction before anything is
 * stored — pure, so the privacy audit can probe the real capture path
 * without starting capture or writing into a dataset.
 *
 * EVERY FIELD IS REDACTED, NOT JUST INPUT AND OUTPUT. An earlier version
 * redacted input and output and stored `note` and caller-supplied tags
 * verbatim — "user keshav@synora.ai complained" in a note would have been
 * written down raw. The fields that feel like metadata are still free text
 * from a caller, and free text is where sensitive values live.
 */
export function buildCapturedCase(
  interaction: Interaction,
  reason: string,
  cfg: CaptureConfig = config,
): CapturedCase {
  const redactedInput = redact(interaction.input, cfg.redactionRules);
  const redactedOutput = redact(interaction.output, cfg.redactionRules);
  const redactedNote =
    interaction.note !== undefined ? redact(interaction.note, cfg.redactionRules) : null;

  return {
    input: redactedInput.text,
    // The observed output, not a reference answer. A captured failure has
    // no known-good answer — inventing one would be worse than having
    // none — and storing the bad output as `expected` would invert every
    // grader that compares against it.
    actualOutput: redactedOutput.text,
    // Caller tags first, then the derived ones. `reason` is one of our own
    // enum strings and `promptId` is a system-assigned identifier, so only
    // the caller-supplied portion carries redaction risk.
    tags: [
      ...(interaction.tags ?? []).map((tag) => redact(tag, cfg.redactionRules).text),
      `reason:${reason}`,
      `prompt:${interaction.promptId}`,
    ],
    note: redactedNote?.text,
    redactions: { input: redactedInput, output: redactedOutput, note: redactedNote },
  };
}

/** Rule name → total substitutions across all redacted fields, summed rather than overwritten. */
function mergeRedactionCounts(results: (RedactionResult | null)[]): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const result of results) {
    if (!result) continue;
    for (const [rule, count] of Object.entries(result.counts)) {
      merged[rule] = (merged[rule] ?? 0) + count;
    }
  }
  return merged;
}

/**
 * Applies the policy and, if the interaction qualifies, redacts it and
 * stores it as a `real`-origin case. Never throws: capture failing must
 * not surface as an error in a customer-facing request path.
 */
export function captureInteraction(interaction: Interaction): { captured: boolean; reason: string } {
  try {
    if (!active) return { captured: false, reason: 'inactive' };

    const decision = shouldCapture(interaction);
    if (!decision.capture) {
      skipped += 1;
      return { captured: false, reason: decision.reason };
    }

    const dataset = getDataset(config.datasetId);
    if (dataset && dataset.cases.length >= config.maxCases) {
      skipped += 1;
      return { captured: false, reason: 'dataset-full' };
    }

    const built = buildCapturedCase(interaction, decision.reason);

    const caseId = `cap_${interaction.promptId}_${Date.now()}_${captured}`;
    addCase(config.datasetId, {
      id: caseId,
      input: built.input,
      actualOutput: built.actualOutput,
      graders: config.defaultGraders,
      // Captured from genuine traffic, so this is unambiguously real.
      origin: 'real',
      tags: built.tags,
      note: built.note,
    });

    captured += 1;
    engineeringEventBus.emit({
      type: 'evaluation.case.captured',
      timestamp: Date.now(),
      source: 'case-capture',
      payload: {
        caseId,
        datasetId: config.datasetId,
        promptId: interaction.promptId,
        reason: decision.reason,
        redactedInput: built.redactions.input.redacted,
        redactedOutput: built.redactions.output.redacted,
        redactionCounts: mergeRedactionCounts([
          built.redactions.input,
          built.redactions.output,
          built.redactions.note,
        ]),
      },
    });

    return { captured: true, reason: decision.reason };
  } catch {
    return { captured: false, reason: 'error' };
  }
}

export function startCaseCapture(overrides: Partial<CaptureConfig> = {}): void {
  if (active) return;
  config = { ...defaultConfig, ...overrides };
  createDataset({
    id: config.datasetId,
    name: config.datasetName ?? config.datasetId,
    description: 'Cases captured automatically from real interactions (redacted).',
  });
  active = true;

  unsubscribe = engineeringEventBus.on('ai.interaction.completed', (event) => {
    captureInteraction(event.payload as unknown as Interaction);
  });
}

export function stopCaseCapture(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  active = false;
  captured = 0;
  skipped = 0;
  config = { ...defaultConfig };
  sampler = Math.random;
}

/**
 * Whether capture is running. Lets callers skip the consent lookup — and
 * its database round-trip — entirely when capture is off, which is the
 * default, so instrumentation costs nothing on the hot path.
 */
export function isCaptureActive(): boolean {
  return active;
}

export function getCaptureStats(): {
  active: boolean;
  datasetId: string;
  captured: number;
  skipped: number;
  maxCases: number;
} {
  return {
    active,
    datasetId: config.datasetId,
    captured,
    skipped,
    maxCases: config.maxCases,
  };
}

/** Injects a deterministic sampler so sampling behaviour is testable. */
export function setSampler(fn: () => number): void {
  sampler = fn;
}
