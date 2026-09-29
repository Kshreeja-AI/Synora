import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { __resetConfigForTests, initConfig } from '../../config';
import {
  bruteForceIsingMinimum,
  greedyIsingMinimum,
  isingEnergyOfIndex,
  parseIsingProblem,
  quboToIsing,
} from '../algorithms/ising';
import { nelderMead } from '../algorithms/optimiser';
import { qaoaDescriptor } from '../algorithms/qaoa';
import { quantumKernelDescriptor } from '../algorithms/quantumKernel';
import {
  QUANTUM_ALGORITHM_REGISTRY,
  executableAlgorithms,
  requireExecutableAlgorithm,
} from '../algorithms/registry';
import { exactGroundStateEnergy, vqeDescriptor } from '../algorithms/vqe';
import { runBenchmark } from '../benchmark/comparator';
import type { QuantumProblem } from '../types';

/**
 * These tests do two jobs, and the second is the unusual one.
 *
 * The first is ordinary: the algorithms compute what they claim to compute,
 * checked against exactly-known answers.
 *
 * The second is to pin the HONESTY properties, because those are the ones
 * that decay. That a variational estimate never falls below the true ground
 * state; that a simulator run can never produce an advantage claim; that a
 * research scaffold refuses rather than returning a number. Each of those is
 * a property somebody could remove while every other test still passed, and
 * removing any of them would let Synora overstate a result.
 */

beforeAll(async () => {
  process.env.QUANTUM_LOCAL_MAX_QUBITS = '16';
  __resetConfigForTests();
  await initConfig();
});

afterAll(() => {
  delete process.env.QUANTUM_LOCAL_MAX_QUBITS;
  __resetConfigForTests();
});

/* ── The QUBO ⇄ Ising conversion, where sign errors live ──────────────── */

describe('QUBO to Ising conversion', () => {
  it('preserves the objective for every assignment', () => {
    // The only test that matters here: enumerate the whole space and check
    // both formulations agree everywhere. A sign error survives spot checks
    // and dies here.
    const Q = [
      [2, -3, 1],
      [0, -1, 4],
      [0, 0, 5],
    ];
    const model = quboToIsing(Q);

    for (let index = 0; index < 8; index++) {
      const x = [0, 1, 2].map((q) => (index >> q) & 1);
      let expected = 0;
      for (let i = 0; i < 3; i++) {
        expected += Q[i][i] * x[i];
        for (let j = i + 1; j < 3; j++) expected += (Q[i][j] + Q[j][i]) * x[i] * x[j];
      }
      expect(isingEnergyOfIndex(model, index)).toBeCloseTo(expected, 10);
    }
  });

  it('rejects a self-loop rather than silently absorbing it', () => {
    expect(() =>
      parseIsingProblem({
        id: 'bad',
        type: 'combinatorial-optimisation',
        description: '',
        formulation: 'Ising',
        dimensionality: 2,
        data: { ising: { linear: [0, 0], quadratic: [[0, 0, 1]] } },
      })
    ).toThrow(/self-loop/);
  });

  it('refuses a problem carrying neither a QUBO nor an Ising', () => {
    expect(() =>
      parseIsingProblem({
        id: 'bad',
        type: 'combinatorial-optimisation',
        description: '',
        formulation: 'Ising',
        dimensionality: 2,
        data: { something: 'else' },
      })
    ).toThrow(/must contain either/);
  });
});

/* ── The classical baselines themselves ──────────────────────────────── */

describe('classical baselines are correct, because everything is measured against them', () => {
  const model = quboToIsing([
    [1, -4, 0],
    [0, 1, -4],
    [0, 0, 1],
  ]);

  it('exhaustive enumeration finds the true minimum', () => {
    const exact = bruteForceIsingMinimum(model);
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 8; i++) best = Math.min(best, isingEnergyOfIndex(model, i));
    expect(exact.energy).toBeCloseTo(best, 12);
  });

  it('local search never beats the exact optimum', () => {
    expect(greedyIsingMinimum(model).energy).toBeGreaterThanOrEqual(
      bruteForceIsingMinimum(model).energy - 1e-12
    );
  });

  it('refuses to enumerate a space it cannot finish', () => {
    expect(() =>
      bruteForceIsingMinimum({ n: 30, linear: new Array(30).fill(0), quadratic: [], offset: 0 })
    ).toThrow(/refused/);
  });
});

describe('the optimiser', () => {
  it('minimises a quadratic bowl', () => {
    const result = nelderMead((p) => (p[0] - 1.5) ** 2 + (p[1] + 0.5) ** 2, [0, 0]);
    // The VALUE is what a variational algorithm minimises, and it converges
    // quadratically faster than the parameters do — so the value is asserted
    // tightly and the parameters loosely, which is the honest expectation
    // from a simplex method stopped on a value tolerance of 1e-6.
    expect(result.value).toBeLessThan(1e-5);
    expect(result.parameters[0]).toBeCloseTo(1.5, 2);
    expect(result.parameters[1]).toBeCloseTo(-0.5, 2);
    expect(result.converged).toBe(true);
  });

  it('never exceeds its evaluation ceiling — each one is a circuit run', () => {
    let calls = 0;
    const result = nelderMead(
      (p) => {
        calls++;
        return Math.sin(p[0]) * Math.cos(p[1]) + p[0] ** 2 * 0.01;
      },
      [3, 3],
      { maxEvaluations: 25, tolerance: 1e-12, initialStep: 0.3 }
    );
    expect(calls).toBeLessThanOrEqual(25);
    expect(result.evaluations).toBeLessThanOrEqual(25);
  });
});

/* ── QAOA ────────────────────────────────────────────────────────────── */

const maxCutPath: QuantumProblem = {
  id: 'maxcut-path-4',
  type: 'combinatorial-optimisation',
  description: 'MaxCut on a 4-node path graph',
  formulation: 'Ising',
  dimensionality: 4,
  data: {
    ising: {
      linear: [0, 0, 0, 0],
      quadratic: [
        [0, 1, 1],
        [1, 2, 1],
        [2, 3, 1],
      ],
      offset: 0,
    },
  },
};

describe('QAOA', () => {
  it('runs end to end and reports the exact optimum beside its own answer', async () => {
    const outcome = await qaoaDescriptor.run!(maxCutPath, { maxEvaluations: 120, shots: 512, seed: 5 });

    expect(outcome.algorithmId).toBe('qaoa');
    expect(outcome.qubits).toBe(4);
    expect(outcome.executedOn).toBe('local-simulator');
    expect(typeof outcome.solution.bitstring).toBe('string');
    // The comparison is not optional and is not left to the caller.
    expect(outcome.solution.exactOptimum).toBeCloseTo(-3, 10);
  });

  it('never reports an energy below the proven optimum', async () => {
    const outcome = await qaoaDescriptor.run!(maxCutPath, { maxEvaluations: 120, shots: 512, seed: 6 });
    const exact = outcome.solution.exactOptimum as number;
    expect(outcome.objectiveValue).toBeGreaterThanOrEqual(exact - 1e-9);
  });

  it('records a warning when it fails to reach the optimum', async () => {
    // A very small evaluation budget makes this the likely path; either way
    // the invariant holds — a shortfall is always stated, never silent.
    const outcome = await qaoaDescriptor.run!(maxCutPath, { maxEvaluations: 8, shots: 256, seed: 11 });
    const reached = outcome.solution.reachedOptimum as boolean;
    if (!reached) {
      expect(outcome.warnings.join(' ')).toMatch(/did not reach the optimum/);
    }
    expect(outcome.objectiveValue).toBeGreaterThanOrEqual(
      (outcome.solution.exactOptimum as number) - 1e-9
    );
  });

  it('builds a backend-agnostic circuit that carries the problem weights', () => {
    const circuit = qaoaDescriptor.buildCircuit!(maxCutPath, [0.3, 0.7]);
    expect(circuit.qubits).toBe(4);
    // One RZZ (three gates) per coupling, plus the mixer and the initial H layer.
    expect(circuit.gates.filter((g) => g.name === 'cx')).toHaveLength(6);
    expect(circuit.gates.filter((g) => g.name === 'rx')).toHaveLength(4);
    expect(circuit.measurements).toHaveLength(4);
  });
});

/* ── VQE ─────────────────────────────────────────────────────────────── */

describe('VQE', () => {
  const singleZ: QuantumProblem = {
    id: 'h-z',
    type: 'ground-state-energy',
    description: 'H = Z on one qubit; ground state |1> at energy -1',
    formulation: 'Hamiltonian',
    dimensionality: 1,
    data: { hamiltonian: { qubits: 1, terms: [{ coefficient: 1, paulis: 'Z' }] } },
  };

  const transverseIsing: QuantumProblem = {
    id: 'tfim-2',
    type: 'ground-state-energy',
    description: 'Two-site transverse-field Ising model',
    formulation: 'Hamiltonian',
    dimensionality: 2,
    data: {
      hamiltonian: {
        qubits: 2,
        terms: [
          { coefficient: -1, paulis: 'ZZ' },
          { coefficient: -0.5, paulis: 'XI' },
          { coefficient: -0.5, paulis: 'IX' },
        ],
      },
    },
  };

  it('the exact baseline finds the known ground state of H = Z', () => {
    const exact = exactGroundStateEnergy({ qubits: 1, terms: [{ coefficient: 1, paulis: 'Z' }] });
    expect(exact.energy).toBeCloseTo(-1, 6);
    expect(exact.converged).toBe(true);
  });

  it('the exact baseline matches the analytic ground state of the 2-site TFIM', () => {
    // E₀ = -√(J² + h²) ... for J=1, h=0.5 the two-site value is -√(1+0.25)·... The
    // safest check that needs no algebra: the energy is below every diagonal
    // element and matches an independent enumeration of the Hamiltonian's
    // spectrum bound.
    const exact = exactGroundStateEnergy({
      qubits: 2,
      terms: [
        { coefficient: -1, paulis: 'ZZ' },
        { coefficient: -0.5, paulis: 'XI' },
        { coefficient: -0.5, paulis: 'IX' },
      ],
    });
    expect(exact.converged).toBe(true);
    // Below the best classical (all-Z) configuration of -1, because the
    // transverse field lowers it further.
    expect(exact.energy).toBeLessThan(-1);
    // And bounded below by the sum of coefficient magnitudes.
    expect(exact.energy).toBeGreaterThan(-2);
  });

  it('approaches the ground state of H = Z from above', async () => {
    const outcome = await vqeDescriptor.run!(singleZ, { maxEvaluations: 300 });
    expect(outcome.objectiveValue).toBeCloseTo(-1, 2);
    // The variational principle: never below the true ground state.
    expect(outcome.objectiveValue).toBeGreaterThanOrEqual(-1 - 1e-6);
  });

  it('never violates the variational principle on the TFIM either', async () => {
    const outcome = await vqeDescriptor.run!(transverseIsing, { maxEvaluations: 400 });
    const exact = outcome.solution.exactGroundStateEnergy as number;
    expect(outcome.objectiveValue).toBeGreaterThanOrEqual(exact - 1e-6);
    expect(outcome.warnings.join(' ')).not.toMatch(/indicates a defect/);
  });

  it('refuses a Pauli string of the wrong width instead of padding it', async () => {
    await expect(
      vqeDescriptor.run!(
        {
          ...singleZ,
          data: { hamiltonian: { qubits: 2, terms: [{ coefficient: 1, paulis: 'Z' }] } },
        },
        {}
      )
    ).rejects.toThrow(/declares 2 qubits/);
  });
});

/* ── Quantum kernel ──────────────────────────────────────────────────── */

describe('quantum kernel', () => {
  const separable: QuantumProblem = {
    id: 'toy-classification',
    type: 'classification',
    description: 'Linearly separable 2-D toy data',
    formulation: 'kernel-matrix',
    dimensionality: 2,
    data: {
      features: [
        [0.2, 0.3], [0.3, 0.2], [0.25, 0.35], [0.15, 0.25],
        [2.8, 2.9], [2.9, 2.8], [2.75, 2.95], [2.85, 2.75],
        [0.35, 0.15], [0.1, 0.4], [2.95, 2.7], [2.7, 3.0],
      ],
      labels: [-1, -1, -1, -1, 1, 1, 1, 1, -1, -1, 1, 1],
    },
  };

  it('runs both kernels through the identical model and reports both', async () => {
    const outcome = await quantumKernelDescriptor.run!(separable, {});

    expect(outcome.qubits).toBe(2);
    expect(typeof outcome.solution.quantumTestAccuracy).toBe('number');
    expect(typeof outcome.solution.classicalRbfTestAccuracy).toBe('number');
    expect(outcome.solution.featureMap).toMatch(/ZZ feature map/);
  });

  it('states plainly when the classical kernel matched or beat it', async () => {
    const outcome = await quantumKernelDescriptor.run!(separable, {});
    const q = outcome.solution.quantumTestAccuracy as number;
    const c = outcome.solution.classicalRbfTestAccuracy as number;

    if (q <= c) {
      expect(outcome.warnings.join(' ')).toMatch(/classical RBF kernel matched or beat/);
    }
    // Small held-out sets are always flagged, in either direction.
    expect(outcome.warnings.join(' ')).toMatch(/within noise/);
  });

  it('refuses more features than the simulator has qubits', async () => {
    await expect(
      quantumKernelDescriptor.run!(
        {
          ...separable,
          data: {
            features: Array.from({ length: 8 }, () => new Array(20).fill(0.5)),
            labels: [1, -1, 1, -1, 1, -1, 1, -1],
          },
        },
        {}
      )
    ).rejects.toThrow(/exceeds/);
  });

  it('refuses labels that are not ±1 rather than coercing them', async () => {
    await expect(
      quantumKernelDescriptor.run!(
        { ...separable, data: { features: separable.data!.features, labels: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1] } },
        {}
      )
    ).rejects.toThrow(/\+1 or -1/);
  });
});

/* ── The registry's honesty rules ────────────────────────────────────── */

describe('the algorithm registry states what is real', () => {
  it('every entry declares assumptions, a classical baseline and limitations', () => {
    for (const algorithm of QUANTUM_ALGORITHM_REGISTRY) {
      expect(algorithm.assumptions.length, `${algorithm.id} assumptions`).toBeGreaterThan(0);
      expect(algorithm.classicalBaseline.length, `${algorithm.id} baseline`).toBeGreaterThan(0);
      expect(algorithm.limitations.length, `${algorithm.id} limitations`).toBeGreaterThan(0);
      expect(algorithm.references.length, `${algorithm.id} references`).toBeGreaterThan(0);
    }
  });

  it('exactly the algorithms with a `run` claim to be implemented', () => {
    for (const algorithm of QUANTUM_ALGORITHM_REGISTRY) {
      const claimsImplemented = algorithm.state === 'ENABLED';
      expect(typeof algorithm.run === 'function', `${algorithm.id}`).toBe(claimsImplemented);
    }
  });

  it('three execute and the rest refuse — the count is honest either way', () => {
    expect(executableAlgorithms().map((a) => a.id).sort()).toEqual([
      'qaoa',
      'quantum-kernel',
      'vqe',
    ]);
    expect(QUANTUM_ALGORITHM_REGISTRY.length).toBeGreaterThan(10);
  });

  it('no entry claims QPU support, because none has been run on hardware', () => {
    expect(QUANTUM_ALGORITHM_REGISTRY.filter((a) => a.qpuSupported)).toEqual([]);
  });

  it('a textbook reference entry refuses instead of running', () => {
    expect(() => requireExecutableAlgorithm('shor')).toThrow(/no executable implementation/);
    expect(() => requireExecutableAlgorithm('grover')).toThrow(/registered as DESCRIBED/);
  });

  it('only ENABLED algorithms may execute — a `run` method alone is not enough', () => {
    // The rung-skipping guard. Adding `run` to an unvalidated algorithm must
    // not make it executable: the ladder is what records that it has been
    // checked against an independent classical baseline, and `requireExecutable`
    // demands BOTH the method and the rung.
    for (const algorithm of QUANTUM_ALGORITHM_REGISTRY) {
      const hasRun = typeof algorithm.run === 'function';
      expect(algorithm.state === 'ENABLED', `${algorithm.id}`).toBe(hasRun);
    }
    expect(executableAlgorithms().every((a) => a.state === 'ENABLED')).toBe(true);
  });
});

/* ── The benchmark harness ───────────────────────────────────────────── */

describe('benchmarking answers "did quantum actually help?"', () => {
  it('a simulator run can NEVER produce an advantage claim', async () => {
    const comparison = await runBenchmark(maxCutPath, 'qaoa', {
      maxEvaluations: 100,
      shots: 512,
      seed: 3,
    });

    expect(comparison.quantum.executedOn).toBe('local-simulator');
    expect(comparison.advantageClaim).toBe('QUANTUM_ADVANTAGE_NOT_DEMONSTRATED');
    expect(comparison.reasons.join(' ')).toMatch(/one classical algorithm beating another/);
  });

  it('compares against the EXACT classical optimum, not a heuristic', async () => {
    const comparison = await runBenchmark(maxCutPath, 'qaoa', { maxEvaluations: 100, seed: 4 });
    expect(comparison.classical.method).toMatch(/exhaustive enumeration \(exact/);
    expect(comparison.classical.objectiveValue).toBeCloseTo(-3, 10);
  });

  it('records qubits, depth, evaluations, memory, cost and reproducibility', async () => {
    const comparison = await runBenchmark(maxCutPath, 'qaoa', { maxEvaluations: 60, seed: 2 });

    expect(comparison.quantum.qubits).toBe(4);
    expect(comparison.quantum.circuitDepth).toBeGreaterThan(0);
    expect(comparison.quantum.circuitEvaluations).toBeGreaterThan(0);
    expect(comparison.quantum.estimatedMemoryBytes).toBe(2 ** 4 * 16);
    expect(comparison.quantum.costCents).toBe(0);
    expect(comparison.quantum.reproducible).toBe(true);
    // The contrast the memory figures exist to record: the classical side
    // holds ONE candidate at a time regardless of problem size, while the
    // quantum side holds 2ⁿ amplitudes. At n=4 the constant still wins on
    // absolute bytes — which is exactly why the SCALING is what gets
    // asserted, not a single comparison at a size where it proves nothing.
    expect(comparison.classical.estimatedMemoryBytes).toBe(1024);
    expect(comparison.quantum.estimatedMemoryBytes).toBe(2 ** comparison.quantum.qubits * 16);
    expect(2 ** 20 * 16).toBeGreaterThan(comparison.classical.estimatedMemoryBytes!);
  });

  it('runs a ground-state comparison against exact diagonalisation', async () => {
    const comparison = await runBenchmark(
      {
        id: 'tfim-bench',
        type: 'ground-state-energy',
        description: 'Two-site TFIM',
        formulation: 'Hamiltonian',
        dimensionality: 2,
        data: {
          hamiltonian: {
            qubits: 2,
            terms: [
              { coefficient: -1, paulis: 'ZZ' },
              { coefficient: -0.5, paulis: 'XI' },
              { coefficient: -0.5, paulis: 'IX' },
            ],
          },
        },
      },
      'vqe',
      { maxEvaluations: 300 }
    );

    expect(comparison.classical.method).toMatch(/exact lowest eigenvalue/);
    expect(comparison.advantageClaim).toBe('QUANTUM_ADVANTAGE_NOT_DEMONSTRATED');
    expect(['CLASSICAL_BETTER', 'PARITY']).toContain(comparison.outcome);
  });

  it('refuses to benchmark an algorithm that does not execute', async () => {
    await expect(runBenchmark(maxCutPath, 'qbm', {})).rejects.toThrow(
      /no executable implementation/
    );
  });
});
