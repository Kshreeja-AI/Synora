import { bruteForceIsingMinimum, greedyIsingMinimum, parseIsingProblem } from '../algorithms/ising';
import { requireExecutableAlgorithm } from '../algorithms/registry';
import type { QuantumAlgorithmOutcome, QuantumAlgorithmRunOptions } from '../algorithms/types';
import { exactGroundStateEnergy } from '../algorithms/vqe';
import { statevectorBytes } from '../simulator/statevector';
import type { QuantumProblem } from '../types';
import type {
  AdvantageClaim,
  BenchmarkComparison,
  BenchmarkOutcome,
  MethodMeasurement,
  QuantumMethodMeasurement,
} from './types';

/**
 * Runs both sides of the question and refuses to let either flatter itself.
 *
 * ── WHAT MAKES A COMPARISON FAIR HERE ────────────────────────────────────
 *
 *  - Same problem instance, same objective function, same tolerance.
 *  - The classical baseline is timed on the SAME machine in the SAME process,
 *    so wall-clock is comparable rather than quoted from a paper.
 *  - The classical side is given its best available method, not a strawman.
 *    For every problem this repository's simulator can hold, that means an
 *    EXACT method — exhaustive enumeration or exact diagonalisation — which
 *    is the strongest possible opponent and the honest one.
 *  - Nothing is reported without both sides present.
 *
 * A benchmark whose classical baseline is chosen to lose is the most common
 * way quantum results are overstated, and it is usually done by comparing
 * against a generic heuristic when an exact method was available.
 */

const PARITY_TOLERANCE = 1e-6;

export interface BenchmarkOptions extends QuantumAlgorithmRunOptions {
  /** Cost actually charged for the quantum side, where the caller knows it. */
  readonly quantumCostCents?: number;
}

export async function runBenchmark(
  problem: QuantumProblem,
  algorithmId: string,
  options: BenchmarkOptions = {}
): Promise<BenchmarkComparison> {
  const algorithm = requireExecutableAlgorithm(algorithmId);

  const quantumOutcome = await algorithm.run!(problem, options);
  const classical = await measureClassicalBaseline(problem, quantumOutcome);

  const quantum: QuantumMethodMeasurement = {
    method: `${algorithm.displayName} (${algorithm.id})`,
    objectiveValue: quantumOutcome.objectiveValue,
    accuracy: readAccuracy(quantumOutcome),
    runtimeMs: quantumOutcome.durationMs,
    estimatedMemoryBytes: statevectorBytes(quantumOutcome.qubits),
    costCents: options.quantumCostCents ?? 0,
    // Simulator runs are seeded and deterministic; hardware is not, and no
    // amount of care makes it so.
    reproducible: quantumOutcome.executedOn === 'local-simulator',
    qubits: quantumOutcome.qubits,
    circuitDepth: quantumOutcome.circuitDepth,
    circuitEvaluations: quantumOutcome.circuitEvaluations,
    shots: options.shots ?? 1024,
    executedOn: quantumOutcome.executedOn,
    noise: quantumOutcome.executedOn === 'local-simulator' ? 'none-simulated' : 'device-native',
  };

  const { outcome, reasons } = judgeOutcome(classical, quantum);
  const advantage = judgeAdvantage(classical, quantum, outcome);

  return {
    problemId: problem.id,
    problemType: problem.type,
    dimensionality: problem.dimensionality,
    classical,
    quantum,
    outcome,
    advantageClaim: advantage.claim,
    reasons: [...reasons, ...advantage.reasons],
    warnings: quantumOutcome.warnings,
  };
}

/* ── Classical baselines, timed in-process ───────────────────────────── */

async function measureClassicalBaseline(
  problem: QuantumProblem,
  quantumOutcome: QuantumAlgorithmOutcome
): Promise<MethodMeasurement> {
  switch (problem.type) {
    case 'combinatorial-optimisation': {
      const model = parseIsingProblem(problem);
      const startedAt = Date.now();
      // Exact where feasible; the strongest opponent available. Falling back
      // to a heuristic only when enumeration genuinely cannot run keeps the
      // comparison honest in BOTH directions — a heuristic baseline at a size
      // where an exact one existed would be a rigged win for quantum.
      const exact = model.n <= 24 ? bruteForceIsingMinimum(model) : null;
      const greedy = greedyIsingMinimum(model);
      const runtimeMs = Date.now() - startedAt;

      return {
        method: exact
          ? `exhaustive enumeration (exact, ${2 ** model.n} states) + multi-restart local search`
          : 'multi-restart steepest-descent local search',
        objectiveValue: exact ? exact.energy : greedy.energy,
        accuracy: null,
        runtimeMs,
        // Enumeration holds one candidate at a time; the memory story is the
        // point of contrast with a 2ⁿ-amplitude statevector.
        estimatedMemoryBytes: 1024,
        costCents: 0,
        reproducible: true,
      };
    }

    case 'ground-state-energy':
    case 'simulation-dynamics': {
      const raw = problem.data?.hamiltonian as
        | { terms: { coefficient: number; paulis: string }[]; qubits?: number }
        | undefined;
      if (!raw) {
        return unavailableBaseline('the problem carries no Hamiltonian to diagonalise');
      }
      const observable = {
        terms: raw.terms.map((t) => ({ ...t, paulis: t.paulis.toUpperCase() })),
        qubits: raw.qubits ?? raw.terms[0].paulis.length,
      };
      const startedAt = Date.now();
      const exact = exactGroundStateEnergy(observable);
      return {
        method: 'exact lowest eigenvalue by shifted power iteration',
        objectiveValue: exact.energy,
        accuracy: null,
        runtimeMs: Date.now() - startedAt,
        estimatedMemoryBytes: statevectorBytes(observable.qubits) * 2,
        costCents: 0,
        reproducible: exact.converged,
      };
    }

    case 'classification':
    case 'regression': {
      // The kernel algorithm runs BOTH kernels through the identical solver,
      // regulariser and split — a stronger comparison than re-fitting here
      // could produce, because nothing differs except the kernel itself.
      const classicalAccuracy = quantumOutcome.solution.classicalRbfTestAccuracy;
      if (typeof classicalAccuracy !== 'number') {
        return unavailableBaseline('the algorithm did not report a classical accuracy to compare against');
      }
      return {
        method: 'RBF-kernel ridge regression (same solver, regulariser and split)',
        objectiveValue: 1 - classicalAccuracy,
        accuracy: classicalAccuracy,
        // Measured inside the algorithm's own run; not separable from it
        // without re-fitting, which would compare two different fits.
        runtimeMs: 0,
        estimatedMemoryBytes: null,
        costCents: 0,
        reproducible: true,
      };
    }

    default:
      return unavailableBaseline(`no classical baseline is defined for problem type "${problem.type}"`);
  }
}

function unavailableBaseline(reason: string): MethodMeasurement {
  return {
    method: `unavailable — ${reason}`,
    objectiveValue: null,
    accuracy: null,
    runtimeMs: 0,
    estimatedMemoryBytes: null,
    costCents: null,
    reproducible: false,
  };
}

/* ── Judgement ───────────────────────────────────────────────────────── */

function judgeOutcome(
  classical: MethodMeasurement,
  quantum: QuantumMethodMeasurement
): { outcome: BenchmarkOutcome; reasons: string[] } {
  const reasons: string[] = [];

  if (classical.objectiveValue === null || quantum.objectiveValue === null) {
    return {
      outcome: 'INCONCLUSIVE',
      reasons: [
        'one side produced no comparable objective value, so nothing follows from this run',
        `classical: ${classical.method}`,
      ],
    };
  }

  const difference = quantum.objectiveValue - classical.objectiveValue;
  reasons.push(
    `objective — classical ${classical.objectiveValue.toFixed(6)} vs quantum ${quantum.objectiveValue.toFixed(6)}`,
    `wall-clock — classical ${classical.runtimeMs}ms vs quantum ${quantum.runtimeMs}ms over ${quantum.circuitEvaluations} circuit evaluations`
  );

  if (Math.abs(difference) <= PARITY_TOLERANCE) {
    reasons.push(
      'the objectives are equal within tolerance, so the comparison turns entirely on cost and time'
    );
    // Equal answers, and the classical side got there without a circuit: the
    // tie goes to the method that did less work, which is not a stylistic
    // preference but the only sense in which "equal" can be broken.
    return {
      outcome: classical.runtimeMs <= quantum.runtimeMs ? 'CLASSICAL_BETTER' : 'PARITY',
      reasons,
    };
  }

  if (difference > 0) {
    reasons.push(
      `the classical method found a better objective by ${difference.toExponential(3)}`
    );
    return { outcome: 'CLASSICAL_BETTER', reasons };
  }

  reasons.push(
    `the quantum method found a better objective by ${Math.abs(difference).toExponential(3)} ON THIS INSTANCE`
  );
  return { outcome: 'QUANTUM_BETTER_ON_THIS_INSTANCE', reasons };
}

/**
 * The claim, judged separately and far more strictly than the outcome.
 *
 * A SIMULATOR RUN CAN NEVER DEMONSTRATE QUANTUM ADVANTAGE. This is the first
 * check and it is not a policy choice: the simulator is a classical program
 * on a classical CPU, so a win there is one classical algorithm beating
 * another. Every result this build can currently produce lands here, which
 * is the honest state of the system rather than a limitation to route around.
 *
 * Hardware then has to win on ALL THREE of objective, wall-clock and cost,
 * and be reproducible — because an advantage that is slower, or more
 * expensive, or unrepeatable is not one anybody can use.
 */
function judgeAdvantage(
  classical: MethodMeasurement,
  quantum: QuantumMethodMeasurement,
  outcome: BenchmarkOutcome
): { claim: AdvantageClaim; reasons: string[] } {
  const notDemonstrated = (reason: string): { claim: AdvantageClaim; reasons: string[] } => ({
    claim: 'QUANTUM_ADVANTAGE_NOT_DEMONSTRATED',
    reasons: [reason],
  });

  if (quantum.executedOn === 'local-simulator') {
    return notDemonstrated(
      'QUANTUM_ADVANTAGE_NOT_DEMONSTRATED — this ran on a classical simulator. A win here ' +
        'would be one classical algorithm beating another, which is not quantum advantage and ' +
        'cannot be reported as one.'
    );
  }
  if (outcome !== 'QUANTUM_BETTER_ON_THIS_INSTANCE') {
    return notDemonstrated(
      `QUANTUM_ADVANTAGE_NOT_DEMONSTRATED — the outcome was ${outcome}.`
    );
  }
  if (!quantum.reproducible) {
    return notDemonstrated(
      'QUANTUM_ADVANTAGE_NOT_DEMONSTRATED — the quantum result is not reproducible, so a ' +
        'single better number cannot be distinguished from a fortunate sample.'
    );
  }
  if (quantum.runtimeMs > classical.runtimeMs) {
    return notDemonstrated(
      `QUANTUM_ADVANTAGE_NOT_DEMONSTRATED — better objective but slower (${quantum.runtimeMs}ms ` +
        `vs ${classical.runtimeMs}ms). An advantage nobody can wait for is not one.`
    );
  }
  if ((quantum.costCents ?? 0) > (classical.costCents ?? 0)) {
    return notDemonstrated(
      `QUANTUM_ADVANTAGE_NOT_DEMONSTRATED — better objective but more expensive ` +
        `(${quantum.costCents} vs ${classical.costCents} cents).`
    );
  }

  return {
    claim: 'QUANTUM_ADVANTAGE_DEMONSTRATED',
    reasons: [
      'hardware execution beat the classical baseline on objective, wall-clock and cost, and is ' +
        'reproducible. This is a single-instance result and must be replicated across instances ' +
        'and independently verified before it is described as anything more.',
    ],
  };
}

function readAccuracy(outcome: QuantumAlgorithmOutcome): number | null {
  const value = outcome.solution.quantumTestAccuracy;
  return typeof value === 'number' ? value : null;
}
