import { getConfig } from '../../config';
import { CircuitBuilder, circuitDepth } from '../circuit';
import { simulateStatevector, sampleCounts } from '../simulator/statevector';
import type { QuantumCircuit, QuantumProblem } from '../types';
import { bruteForceIsingMinimum, isingEnergyOfIndex, parseIsingProblem, type IsingModel } from './ising';
import { DEFAULT_OPTIMISER_OPTIONS, nelderMead } from './optimiser';
import type {
  QuantumAlgorithmDescriptor,
  QuantumAlgorithmOutcome,
  QuantumAlgorithmRunOptions,
} from './types';

/**
 * QAOA — the Quantum Approximate Optimization Algorithm.
 *
 * ── WHAT IT DOES ─────────────────────────────────────────────────────────
 *
 * Prepares |+⟩^⊗n, then alternates a cost unitary exp(−iγH_C) with a mixer
 * exp(−iβH_M), p times, and classically optimises the 2p angles to minimise
 * ⟨H_C⟩. The measured bitstrings are candidate solutions to the underlying
 * combinatorial problem.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────
 *
 * It does not beat classical optimisation, and this implementation is wired
 * so that claim cannot be made accidentally. Every run reports the exact
 * optimum from exhaustive enumeration alongside its own answer, because at
 * every problem size this repository's simulator can handle, exhaustive
 * enumeration finds the PROVABLY best solution in milliseconds while QAOA
 * finds an approximation after hundreds of circuit evaluations.
 *
 * There is at present no problem class with an accepted, reproduced
 * demonstration of QAOA outperforming good classical heuristics at a scale
 * anyone can run. This implementation exists so Synora can MEASURE that
 * situation — and notice if it ever changes — not so it can claim otherwise.
 *
 * ── STATUS ───────────────────────────────────────────────────────────────
 *
 * SIMULATOR-IMPLEMENTED, and honestly so. The circuit it builds is
 * backend-agnostic and can be submitted to any provider via
 * `executeQuantumCircuit`; only the classical optimisation loop is local.
 * Running that loop against metered hardware would be hundreds of billed
 * jobs, which is a spending decision and not a default.
 */

const DEFAULT_LAYERS = 1;

/**
 * Build the p-layer QAOA circuit.
 *
 * Parameter order is [γ₁…γ_p, β₁…β_p]. The RZZ identity (CX–RZ–CX) is used
 * for the two-body terms rather than a native gate, so no backend has to
 * synthesise it and no transpiler has to be trusted to get the sign right.
 */
export function buildQaoaCircuit(
  model: IsingModel,
  layers: number,
  parameters: readonly (number | string)[]
): QuantumCircuit {
  const builder = new CircuitBuilder(`qaoa-p${layers}-n${model.n}`, model.n);

  // Uniform superposition — the ground state of the mixer, which is what
  // makes the p → ∞ limit an adiabatic path.
  for (let q = 0; q < model.n; q++) builder.h(q);

  for (let layer = 0; layer < layers; layer++) {
    const gamma = parameters[layer];
    const beta = parameters[layers + layer];

    // Cost layer. The factor of 2 is the standard exp(−iγwZZ) ↦ RZZ(2γw)
    // convention; a missing factor here optimises a rescaled problem and
    // still looks like it is working.
    for (const { i, j, w } of model.quadratic) {
      builder.rzz(i, j, scale(gamma, 2 * w));
    }
    for (let q = 0; q < model.n; q++) {
      if (model.linear[q] !== 0) builder.rz(q, scale(gamma, 2 * model.linear[q]));
    }

    // Mixer layer.
    for (let q = 0; q < model.n; q++) builder.gate('rx', [q], [scale(beta, 2)]);
  }

  builder.measureAll();
  return builder.build();
}

/**
 * Fold a problem coefficient into an angle.
 *
 * A NUMERIC angle is multiplied, which is what `run()` always uses and what
 * makes the executed circuit encode the problem's actual weights.
 *
 * A SYMBOLIC angle cannot be, because the IR holds parameter NAMES and not
 * expressions — so the coefficient is dropped and the result is a
 * STRUCTURAL circuit: correct qubit count, correct gate sequence, correct
 * depth, and NOT a circuit that optimises this problem. That is the right
 * trade for its two uses (exporting a shape as OpenQASM, and accounting for
 * depth and qubits in the suitability analyzer), and it is stated here
 * rather than left to be discovered, because a circuit that silently ignores
 * its weights runs perfectly and optimises nothing.
 *
 * If symbolic QAOA ever needs to EXECUTE, the IR needs expression-valued
 * parameters; substituting a coefficient-free angle would be worse than the
 * missing feature.
 */
function scale(value: number | string, coefficient: number): number | string {
  if (typeof value === 'number') return value * coefficient;
  return value;
}

/** ⟨H_C⟩ computed exactly from the simulated state — no sampling error. */
function expectedEnergy(model: IsingModel, circuit: QuantumCircuit, maxQubits: number): number {
  const state = simulateStatevector(circuit, maxQubits);
  const probs = state.probabilities();
  let total = 0;
  for (let index = 0; index < probs.length; index++) {
    if (probs[index] === 0) continue;
    total += probs[index] * isingEnergyOfIndex(model, index);
  }
  return total;
}

async function runQaoa(
  problem: QuantumProblem,
  options: QuantumAlgorithmRunOptions
): Promise<QuantumAlgorithmOutcome> {
  const startedAt = Date.now();
  const model = parseIsingProblem(problem);
  const maxQubits = getConfig().quantum.localMaxQubits;
  const layers = Math.max(1, Math.round(options.hyperparameters?.layers ?? DEFAULT_LAYERS));
  const shots = options.shots ?? 1024;
  const warnings: string[] = [];

  // A fixed, documented start rather than a random one: QAOA landscapes are
  // non-convex, so the starting point materially changes the answer, and a
  // random start would make two runs of the same problem disagree with no
  // recorded reason.
  const start = [
    ...Array.from({ length: layers }, (_, i) => 0.1 + (0.4 * i) / layers),
    ...Array.from({ length: layers }, (_, i) => 0.8 - (0.4 * i) / layers),
  ];

  const optimum = nelderMead(
    (params) => expectedEnergy(model, buildQaoaCircuit(model, layers, params), maxQubits),
    start,
    {
      ...DEFAULT_OPTIMISER_OPTIONS,
      maxEvaluations: options.maxEvaluations ?? DEFAULT_OPTIMISER_OPTIONS.maxEvaluations,
    }
  );

  if (!optimum.converged) {
    warnings.push(
      `the classical optimiser hit its evaluation ceiling (${optimum.evaluations}) without converging; ` +
        'the angles reported are the best seen, not a local optimum'
    );
  }

  // Sample the optimised circuit, then report the BEST energy actually
  // sampled — not ⟨H_C⟩. QAOA's usable output is a bitstring you can check,
  // and reporting the expectation value as if it were the solution quality
  // flatters the algorithm by exactly the amount the distribution is spread.
  const finalCircuit = buildQaoaCircuit(model, layers, optimum.parameters);
  const state = simulateStatevector(finalCircuit, maxQubits);
  const counts = sampleCounts(state, finalCircuit, shots, options.seed ?? 0x5eed);

  let bestBits = '';
  let bestEnergy = Number.POSITIVE_INFINITY;
  for (const bits of Object.keys(counts)) {
    let index = 0;
    for (let q = 0; q < bits.length; q++) if (bits[q] === '1') index |= 1 << q;
    const energy = isingEnergyOfIndex(model, index);
    if (energy < bestEnergy) {
      bestEnergy = energy;
      bestBits = bits;
    }
  }

  // The comparison is not optional and is not left to the caller.
  const exact = model.n <= 22 ? bruteForceIsingMinimum(model) : null;
  if (exact && bestEnergy > exact.energy + 1e-9) {
    warnings.push(
      `QAOA did not reach the optimum: found ${bestEnergy.toFixed(6)}, exhaustive enumeration ` +
        `proves ${exact.energy.toFixed(6)} in ${2 ** model.n} evaluations`
    );
  }

  return {
    algorithmId: 'qaoa',
    objectiveValue: bestEnergy,
    solution: {
      bitstring: bestBits,
      energy: bestEnergy,
      expectationValue: optimum.value,
      angles: optimum.parameters,
      layers,
      ...(exact
        ? {
            exactOptimum: exact.energy,
            exactBitstring: exact.bitstring,
            optimumDegeneracy: exact.degeneracy,
            reachedOptimum: bestEnergy <= exact.energy + 1e-9,
          }
        : { exactOptimum: null, note: 'problem too large for exhaustive verification' }),
    },
    qubits: model.n,
    circuitDepth: circuitDepth(finalCircuit),
    circuitEvaluations: optimum.evaluations + 1,
    optimiserConverged: optimum.converged,
    executedOn: 'local-simulator',
    durationMs: Date.now() - startedAt,
    warnings,
  };
}

export const qaoaDescriptor: QuantumAlgorithmDescriptor = {
  id: 'qaoa',
  displayName: 'Quantum Approximate Optimization Algorithm',
  description:
    'Alternates a problem-dependent cost unitary with a transverse-field mixer for p layers, ' +
    'classically optimising the 2p angles to minimise the expected cost. Produces approximate ' +
    'solutions to Ising/QUBO problems.',
  problemClasses: ['combinatorial-optimisation'],
  formulation: 'Ising',
  assumptions: [
    'the objective can be written exactly as an Ising/QUBO cost function',
    'the classical optimiser finds a useful local optimum of a non-convex landscape',
    'sampling the optimised state often enough surfaces a good bitstring',
    'on hardware: that the circuit survives its own depth, which this simulator does not model',
  ],
  classicalBaseline:
    'exhaustive enumeration (exact, feasible to n≈24) and multi-restart steepest-descent local search',
  simulatorSupported: true,
  qpuSupported: false,
  qubitRequirement: 'one qubit per binary decision variable — n qubits for n variables',
  limitations: [
    'no accepted, reproduced demonstration of advantage over good classical heuristics at any runnable scale',
    'circuit depth grows with the number of coupling terms, which is O(n²) for a dense problem',
    'barren plateaus and local minima make the classical optimisation itself the hard part',
    'p=1 QAOA has known analytic performance bounds that are worse than simple classical algorithms on many graph families',
    'the variational loop here is simulator-only; running it on metered hardware would be hundreds of billed jobs',
  ],
  state: 'ENABLED',
  testCoverage: 'unit-and-baseline-comparison',
  references: [
    'Farhi, Goldstone, Gutmann (2014), "A Quantum Approximate Optimization Algorithm", arXiv:1411.4028',
  ],
  buildCircuit(problem, parameters) {
    const model = parseIsingProblem(problem);
    const layers = Math.max(1, Math.floor(parameters.length / 2));
    return buildQaoaCircuit(model, layers, parameters);
  },
  run: runQaoa,
};
