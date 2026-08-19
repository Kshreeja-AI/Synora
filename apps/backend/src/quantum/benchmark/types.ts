/**
 * The comparison record — what it takes to answer "did quantum actually
 * help?" without anybody's opinion entering the answer.
 *
 * ── THE STRUCTURAL DECISION ──────────────────────────────────────────────
 *
 * `outcome` and `advantageClaim` are separate fields, and that separation is
 * the whole design. `outcome` says which side did better on this instance,
 * which is an ordinary measurement. `advantageClaim` is the CLAIM, and it
 * has a far higher bar: a better number on one instance is not an advantage,
 * and the history of this field is largely the history of that conflation.
 *
 * ── THE PROPERTY THAT MATTERS MOST ───────────────────────────────────────
 *
 * A result produced on a SIMULATOR can never yield
 * `QUANTUM_ADVANTAGE_DEMONSTRATED`, and not as a policy — as a matter of
 * fact. The simulator is a classical program running on a classical CPU. If
 * QAOA-on-a-simulator beat brute-force-on-the-same-CPU, what would have been
 * demonstrated is that one classical algorithm beat another classical
 * algorithm, which is interesting and is not quantum advantage.
 *
 * `judgeAdvantage()` enforces this, so the only way to produce a positive
 * claim in this codebase is a hardware run that wins on objective, wall-clock
 * AND cost, and is reproducible. Nothing in this build can currently reach
 * that, which is the correct state of the world and is stated rather than
 * worked around.
 */

export type BenchmarkOutcome =
  /** The classical method produced a better objective, or matched it more cheaply. */
  | 'CLASSICAL_BETTER'
  /** Neither side is meaningfully ahead on the measured axes. */
  | 'PARITY'
  /** The quantum method won on THIS instance. A measurement, not a claim. */
  | 'QUANTUM_BETTER_ON_THIS_INSTANCE'
  /** Something prevented a fair comparison; nothing follows from it. */
  | 'INCONCLUSIVE';

export type AdvantageClaim =
  | 'QUANTUM_ADVANTAGE_NOT_DEMONSTRATED'
  /** Unreachable from a simulator, by construction. See `judgeAdvantage`. */
  | 'QUANTUM_ADVANTAGE_DEMONSTRATED';

export interface MethodMeasurement {
  readonly method: string;
  /** Lower is better, in every problem class this harness handles. */
  readonly objectiveValue: number | null;
  /** Accuracy where the task has one; null where the concept does not apply. */
  readonly accuracy: number | null;
  readonly runtimeMs: number;
  /** Peak working-set ESTIMATE in bytes, not a measurement of the process. */
  readonly estimatedMemoryBytes: number | null;
  readonly costCents: number | null;
  /** True when re-running with the same inputs reproduces this exactly. */
  readonly reproducible: boolean;
}

export interface QuantumMethodMeasurement extends MethodMeasurement {
  readonly qubits: number;
  readonly circuitDepth: number;
  readonly circuitEvaluations: number;
  readonly shots: number;
  readonly executedOn: 'local-simulator' | 'quantum-hardware';
  /** Whether device noise was present or modelled. */
  readonly noise: 'none-simulated' | 'device-native' | 'modelled';
}

export interface BenchmarkComparison {
  readonly problemId: string;
  readonly problemType: string;
  readonly dimensionality: number;
  readonly classical: MethodMeasurement;
  readonly quantum: QuantumMethodMeasurement;
  readonly outcome: BenchmarkOutcome;
  readonly advantageClaim: AdvantageClaim;
  /** Every reason behind both judgements, in the order they were applied. */
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
  /** Set by the caller after the run — the harness cannot read a clock. */
  readonly recordedAt?: string;
}
