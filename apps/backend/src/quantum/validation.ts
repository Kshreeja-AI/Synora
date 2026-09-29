import type { QuantumExecutionResult, QuantumValidationCheck, QuantumValidationResult } from './types';

/**
 * Is this result internally coherent, and how much should anyone trust it?
 *
 * These are two different questions and they are answered separately on
 * purpose. A result can be perfectly well-formed — every shot accounted for,
 * every bitstring the right width — and still be weak evidence, because it
 * came from 100 shots on a noisy device. Collapsing "valid" and "trustworthy"
 * into one boolean is how a structurally-fine measurement gets quoted as a
 * finding.
 *
 * `valid` therefore means only: nothing about this result contradicts
 * itself. `confidence` is the separate, deliberately pessimistic judgement
 * about what it is worth as evidence.
 */

/**
 * Sampling error on a proportion is ~1/√shots. Below 1000 shots that is
 * >3%, which is larger than most of the effects a variational algorithm is
 * trying to resolve — so it is the line between "usable" and "indicative".
 */
const MIN_SHOTS_FOR_CONFIDENCE = 1_000;

/**
 * Hardware needs more, because sampling error is no longer the dominant
 * term: gate and readout infidelity add a bias that more shots reduce the
 * variance of but never remove.
 */
const MIN_HARDWARE_SHOTS_FOR_CONFIDENCE = 4_000;

export function validateQuantumResult(result: QuantumExecutionResult): QuantumValidationResult {
  const checks: QuantumValidationCheck[] = [];

  const totalCounts = Object.values(result.counts).reduce((sum, n) => sum + n, 0);
  checks.push({
    name: 'shots-accounted',
    passed: totalCounts === result.shots,
    detail: `counts sum to ${totalCounts}; ${result.shots} shots were requested`,
  });

  const widths = new Set(Object.keys(result.counts).map((k) => k.length));
  checks.push({
    name: 'uniform-bitstring-width',
    passed: widths.size <= 1,
    detail:
      widths.size <= 1
        ? `all outcomes are ${[...widths][0] ?? 0} bits wide`
        : `outcomes have inconsistent widths: ${[...widths].join(', ')} — a decoding fault, not a physical result`,
  });

  const negative = Object.entries(result.counts).filter(([, n]) => n < 0 || !Number.isInteger(n));
  checks.push({
    name: 'counts-are-non-negative-integers',
    passed: negative.length === 0,
    detail: negative.length === 0 ? 'all counts are non-negative integers' : `${negative.length} malformed`,
  });

  const onlyBits = Object.keys(result.counts).every((k) => /^[01]*$/.test(k));
  checks.push({
    name: 'outcomes-are-bitstrings',
    passed: onlyBits,
    detail: onlyBits ? 'every outcome key is a bitstring' : 'a non-binary outcome key was returned',
  });

  // Provenance is not decoration. A result whose origin is unrecorded cannot
  // be cited, reproduced, or correctly discounted later.
  const provenanceOk =
    result.provenance.evidenceClass === 'computational-evidence' &&
    typeof result.provenance.circuitHash === 'string' &&
    result.provenance.circuitHash.length > 0 &&
    typeof result.provenance.submittedAt === 'string';
  checks.push({
    name: 'provenance-complete',
    passed: provenanceOk,
    detail: provenanceOk
      ? `${result.provenance.producedBy}, circuit ${result.provenance.circuitHash.slice(0, 12)}…`
      : 'provenance is incomplete — this result cannot be traced to a circuit',
  });

  // Reproducibility is a property of simulators only. Hardware cannot be
  // seeded, and pretending otherwise would make a "reproducible" flag lie.
  const reproducible = result.provenance.simulated && result.provenance.seed !== undefined;
  checks.push({
    name: 'reproducible',
    passed: reproducible,
    detail: reproducible
      ? `re-runnable with seed ${result.provenance.seed}`
      : result.provenance.simulated
        ? 'simulated but unseeded — this exact sample cannot be reproduced'
        : 'hardware execution — not reproducible by construction, and no seed can make it so',
  });

  const valid = checks
    .filter((c) => c.name !== 'reproducible')
    .every((c) => c.passed);

  return { valid, checks, confidence: judgeConfidence(result, valid) };
}

/**
 * Deliberately pessimistic, and never a function of how much anybody wants
 * the answer to be right.
 *
 *  - `unknown` — the result contradicts itself, so nothing follows from it.
 *  - `low`     — too few shots for the sampling error to be smaller than
 *                the effects being measured.
 *  - `medium`  — the ceiling for HARDWARE. Real devices carry gate and
 *                readout error that Synora does not model, so no count of
 *                shots earns `high` here.
 *  - `high`    — the ceiling for a NOISELESS SIMULATION with enough shots.
 *                This is confidence that the number is what the mathematics
 *                says, which is emphatically not confidence that a real
 *                quantum computer would produce it.
 */
function judgeConfidence(
  result: QuantumExecutionResult,
  valid: boolean
): QuantumValidationResult['confidence'] {
  if (!valid) return 'unknown';

  if (result.provenance.producedBy === 'quantum-hardware') {
    return result.shots >= MIN_HARDWARE_SHOTS_FOR_CONFIDENCE ? 'medium' : 'low';
  }
  return result.shots >= MIN_SHOTS_FOR_CONFIDENCE ? 'high' : 'low';
}

/**
 * Outcome probabilities, and the most likely bitstring.
 *
 * Ties are reported rather than broken. A near-degenerate optimum is a real
 * and common outcome of QAOA, and silently returning whichever key the
 * object happened to enumerate first would turn a "two equally good answers"
 * result into a confident wrong one.
 */
export function mostLikelyOutcomes(result: QuantumExecutionResult): {
  readonly outcomes: readonly string[];
  readonly probability: number;
} {
  const entries = Object.entries(result.counts);
  if (entries.length === 0) return { outcomes: [], probability: 0 };

  const total = entries.reduce((sum, [, n]) => sum + n, 0) || 1;
  const best = Math.max(...entries.map(([, n]) => n));
  return {
    outcomes: entries.filter(([, n]) => n === best).map(([k]) => k),
    probability: best / total,
  };
}
