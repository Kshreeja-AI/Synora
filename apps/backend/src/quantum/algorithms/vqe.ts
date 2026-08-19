import { getConfig } from '../../config';
import { CircuitBuilder, circuitDepth } from '../circuit';
import { InvalidQuantumCircuitError } from '../errors';
import { Statevector, observableExpectation, simulateStatevector } from '../simulator/statevector';
import type { QuantumCircuit, QuantumObservable, QuantumProblem } from '../types';
import { DEFAULT_OPTIMISER_OPTIONS, nelderMead } from './optimiser';
import type {
  QuantumAlgorithmDescriptor,
  QuantumAlgorithmOutcome,
  QuantumAlgorithmRunOptions,
} from './types';

/**
 * VQE — the Variational Quantum Eigensolver.
 *
 * ── WHAT IT DOES ─────────────────────────────────────────────────────────
 *
 * Prepares a parameterised trial state, measures ⟨ψ(θ)|H|ψ(θ)⟩ for a
 * Hamiltonian written as a sum of Pauli strings, and classically minimises
 * that expectation. The variational principle guarantees the result is an
 * UPPER BOUND on the true ground-state energy — never below it.
 *
 * ── WHY THIS IS THE MOST CREDIBLE ENTRY IN THE REGISTRY ──────────────────
 *
 * Simulating quantum systems is the one application where the quantum
 * argument is structural rather than algorithmic: the state space a chemist
 * cares about IS the state space a quantum computer natively holds, and the
 * classical cost of representing it grows exponentially for reasons no
 * cleverer classical algorithm removes. That is a far stronger position than
 * QAOA's.
 *
 * It is still not a demonstrated advantage. Every VQE result published to
 * date at a size that could be verified was verifiable precisely because a
 * classical method could also do it, and the sizes where classical methods
 * fail are the sizes where hardware noise swamps the answer. This
 * implementation reports the exact ground state alongside its own estimate
 * for every problem small enough to diagonalise, so the gap is always
 * visible rather than assumed away.
 *
 * ── STATUS ───────────────────────────────────────────────────────────────
 *
 * SIMULATOR-IMPLEMENTED. Exact, noiseless, and therefore optimistic about
 * what hardware would produce.
 */

const DEFAULT_ANSATZ_DEPTH = 2;

function parseHamiltonian(problem: QuantumProblem): QuantumObservable {
  const raw = problem.data?.hamiltonian as
    | { terms?: { coefficient: number; paulis: string }[]; qubits?: number }
    | undefined;

  if (!raw || !Array.isArray(raw.terms) || raw.terms.length === 0) {
    throw new InvalidQuantumCircuitError(
      'problem.data.hamiltonian must be { terms: [{ coefficient, paulis }], qubits }',
      problem.id
    );
  }

  const qubits = raw.qubits ?? raw.terms[0].paulis.length;
  for (const term of raw.terms) {
    if (term.paulis.length !== qubits) {
      throw new InvalidQuantumCircuitError(
        `Pauli string "${term.paulis}" is ${term.paulis.length} characters but the ` +
          `Hamiltonian declares ${qubits} qubits`,
        problem.id
      );
    }
    if (!/^[IXYZixyz]+$/.test(term.paulis)) {
      throw new InvalidQuantumCircuitError(
        `Pauli string "${term.paulis}" contains a character that is not I, X, Y or Z`,
        problem.id
      );
    }
  }

  return { terms: raw.terms.map((t) => ({ ...t, paulis: t.paulis.toUpperCase() })), qubits };
}

/**
 * A hardware-efficient ansatz: alternating RY rotation layers and a CX ring.
 *
 * "Hardware-efficient" means shallow and built from gates devices actually
 * have — NOT that it is a good ansatz. It has no physical motivation, it
 * does not respect any symmetry of the Hamiltonian, and it is the ansatz
 * family in which barren plateaus were first characterised. A
 * chemistry-motivated ansatz (UCCSD) would express the problem better and be
 * far deeper. That trade-off is real and is recorded in `limitations` rather
 * than hidden behind the word "efficient".
 */
export function buildHardwareEfficientAnsatz(
  qubits: number,
  depth: number,
  parameters: readonly (number | string)[]
): QuantumCircuit {
  const builder = new CircuitBuilder(`vqe-hea-d${depth}-n${qubits}`, qubits, 0);
  let p = 0;

  for (let q = 0; q < qubits; q++) builder.ry(q, parameters[p++]);

  for (let layer = 0; layer < depth; layer++) {
    for (let q = 0; q + 1 < qubits; q++) builder.cx(q, q + 1);
    // Close the ring only when it is not the same pair twice — on 2 qubits
    // a "ring" would be CX(0,1) followed by CX(1,0), which is not a ring and
    // adds depth for nothing.
    if (qubits > 2) builder.cx(qubits - 1, 0);
    for (let q = 0; q < qubits; q++) builder.ry(q, parameters[p++]);
  }

  return builder.build();
}

export function ansatzParameterCount(qubits: number, depth: number): number {
  return qubits * (depth + 1);
}

/* ── The classical baseline: exact ground state ───────────────────────── */

/** H|ψ⟩ for a Pauli-sum Hamiltonian, accumulated over terms. */
function applyHamiltonian(observable: QuantumObservable, state: Statevector): Statevector {
  const out = new Statevector(state.qubits);
  out.re.fill(0);
  out.im.fill(0);

  for (const term of observable.terms) {
    const scratch = state.clone();
    for (let q = 0; q < term.paulis.length; q++) {
      const p = term.paulis[q];
      if (p === 'I') continue;
      scratch.applyGate({ name: p.toLowerCase() as 'x' | 'y' | 'z', qubits: [q] });
    }
    for (let i = 0; i < out.re.length; i++) {
      out.re[i] += term.coefficient * scratch.re[i];
      out.im[i] += term.coefficient * scratch.im[i];
    }
  }
  return out;
}

/**
 * Lowest eigenvalue by shifted power iteration on B = cI − H.
 *
 * c = Σ|coefficients| bounds ‖H‖ (each Pauli string has unit operator norm),
 * so B is positive semi-definite and its DOMINANT eigenvector is H's LOWEST.
 * Power iteration then needs only matrix–vector products, which is exactly
 * what `applyHamiltonian` provides — no dense 2ⁿ×2ⁿ matrix is ever formed,
 * which is what makes this feasible at all.
 *
 * Converges slowly when the lowest two eigenvalues are nearly degenerate. It
 * reports whether it converged rather than asserting an answer.
 */
export function exactGroundStateEnergy(
  observable: QuantumObservable,
  maxIterations = 2_000,
  tolerance = 1e-10
): { energy: number; converged: boolean; iterations: number } {
  const shift = observable.terms.reduce((sum, t) => sum + Math.abs(t.coefficient), 0);

  // A deterministic non-uniform start: a uniform vector is orthogonal to
  // many ground states by symmetry, and starting orthogonal to the answer is
  // how power iteration silently converges to the wrong eigenvector.
  const v = new Statevector(observable.qubits);
  for (let i = 0; i < v.re.length; i++) {
    v.re[i] = Math.sin(i * 1.7 + 0.3) + 0.5;
    v.im[i] = 0;
  }
  normalise(v);

  let previous = Number.POSITIVE_INFINITY;
  let energy = 0;
  let iterations = 0;

  for (; iterations < maxIterations; iterations++) {
    const hv = applyHamiltonian(observable, v);
    // B·v = shift·v − H·v
    for (let i = 0; i < v.re.length; i++) {
      hv.re[i] = shift * v.re[i] - hv.re[i];
      hv.im[i] = shift * v.im[i] - hv.im[i];
    }
    normalise(hv);
    v.re.set(hv.re);
    v.im.set(hv.im);

    energy = observableExpectation(v, observable);
    if (Math.abs(energy - previous) < tolerance) {
      return { energy, converged: true, iterations: iterations + 1 };
    }
    previous = energy;
  }

  return { energy, converged: false, iterations };
}

function normalise(state: Statevector): void {
  let norm = 0;
  for (let i = 0; i < state.re.length; i++) {
    norm += state.re[i] * state.re[i] + state.im[i] * state.im[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < state.re.length; i++) {
    state.re[i] /= norm;
    state.im[i] /= norm;
  }
}

/* ── The algorithm ───────────────────────────────────────────────────── */

async function runVqe(
  problem: QuantumProblem,
  options: QuantumAlgorithmRunOptions
): Promise<QuantumAlgorithmOutcome> {
  const startedAt = Date.now();
  const observable = parseHamiltonian(problem);
  const maxQubits = getConfig().quantum.localMaxQubits;
  const depth = Math.max(1, Math.round(options.hyperparameters?.depth ?? DEFAULT_ANSATZ_DEPTH));
  const warnings: string[] = [];

  const count = ansatzParameterCount(observable.qubits, depth);
  // A deterministic, non-zero start. All-zeros puts every qubit in |0⟩ with
  // zero gradient in several directions — a stationary point that looks like
  // convergence on the first evaluation.
  const start = Array.from({ length: count }, (_, i) => 0.25 + 0.5 * Math.sin(i * 2.399));

  const evaluate = (params: readonly number[]): number =>
    observableExpectation(
      simulateStatevector(buildHardwareEfficientAnsatz(observable.qubits, depth, params), maxQubits),
      observable
    );

  const optimum = nelderMead(evaluate, start, {
    ...DEFAULT_OPTIMISER_OPTIONS,
    maxEvaluations: options.maxEvaluations ?? 600,
  });

  if (!optimum.converged) {
    warnings.push(
      `the classical optimiser hit its evaluation ceiling (${optimum.evaluations}) without converging`
    );
  }

  const exact = exactGroundStateEnergy(observable);
  const error = optimum.value - exact.energy;

  if (!exact.converged) {
    warnings.push(
      'the exact baseline did not converge — likely a near-degenerate ground state; treat the ' +
        'comparison below as indicative rather than definitive'
    );
  }
  // The variational principle makes a value BELOW the true ground state
  // impossible. Seeing one means the baseline or the expectation is wrong,
  // and it is worth more as a bug detector than as a result.
  if (error < -1e-6 && exact.converged) {
    warnings.push(
      `the variational estimate is BELOW the computed ground state by ${Math.abs(error).toExponential(2)}, ` +
        'which the variational principle forbids — this indicates a defect, not a discovery'
    );
  }

  return {
    algorithmId: 'vqe',
    objectiveValue: optimum.value,
    solution: {
      variationalEnergy: optimum.value,
      exactGroundStateEnergy: exact.energy,
      absoluteError: error,
      exactBaselineConverged: exact.converged,
      parameters: optimum.parameters,
      ansatz: 'hardware-efficient (RY layers + CX ring)',
      ansatzDepth: depth,
    },
    qubits: observable.qubits,
    circuitDepth: circuitDepth(
      buildHardwareEfficientAnsatz(observable.qubits, depth, optimum.parameters)
    ),
    circuitEvaluations: optimum.evaluations,
    optimiserConverged: optimum.converged,
    executedOn: 'local-simulator',
    durationMs: Date.now() - startedAt,
    warnings,
  };
}

export const vqeDescriptor: QuantumAlgorithmDescriptor = {
  id: 'vqe',
  displayName: 'Variational Quantum Eigensolver',
  description:
    'Minimises ⟨ψ(θ)|H|ψ(θ)⟩ over a parameterised trial state to estimate the ground-state ' +
    'energy of a Hamiltonian expressed as a weighted sum of Pauli strings.',
  problemClasses: ['ground-state-energy', 'simulation-dynamics'],
  formulation: 'Hamiltonian',
  assumptions: [
    'the Hamiltonian is exactly expressible as a sum of Pauli strings',
    'the chosen ansatz can represent a state close to the true ground state',
    'the classical optimiser escapes the barren plateaus this ansatz family is known for',
    'on hardware: that measurement error mitigation recovers an energy whose error is smaller than the chemical accuracy being claimed',
  ],
  classicalBaseline:
    'exact lowest eigenvalue by shifted power iteration on the same Hamiltonian (no dense matrix formed)',
  simulatorSupported: true,
  qpuSupported: false,
  qubitRequirement:
    'one qubit per Pauli-string position — for chemistry, one per spin-orbital after mapping',
  limitations: [
    'the variational estimate is only ever an UPPER bound on the true ground state',
    'the hardware-efficient ansatz has no physical motivation and is the family in which barren plateaus were characterised',
    'a chemistry-motivated ansatz (UCCSD) would be more expressive and far deeper than current hardware supports',
    'measurement cost grows with the number of Pauli terms, which is O(n⁴) for electronic structure',
    'no demonstrated advantage: every VQE result verifiable to date was verifiable because a classical method could also do it',
  ],
  state: 'ENABLED',
  testCoverage: 'unit-and-baseline-comparison',
  references: [
    'Peruzzo et al. (2014), "A variational eigenvalue solver on a photonic quantum processor", Nature Communications 5:4213',
    'McClean et al. (2018), "Barren plateaus in quantum neural network training landscapes", Nature Communications 9:4812',
  ],
  buildCircuit(problem, parameters) {
    const observable = parseHamiltonian(problem);
    const depth = Math.max(
      1,
      Math.round(parameters.length / Math.max(1, observable.qubits)) - 1
    );
    return buildHardwareEfficientAnsatz(observable.qubits, depth, parameters);
  },
  run: runVqe,
};
