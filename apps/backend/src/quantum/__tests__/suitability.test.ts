import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetConfigForTests, initConfig } from '../../config';
import { getQuantumAlgorithm } from '../algorithms/registry';
import { analyseQuantumSuitability } from '../suitability';
import type { QuantumProblem, QuantumProblemType } from '../types';

/**
 * The analyzer's job is to say no, and these tests are written to catch the
 * one way it could fail that nobody would notice: getting gradually more
 * optimistic.
 *
 * Several assertions here look redundant — checking that a verdict is NOT
 * `QPU_CANDIDATE`, that a benefit is NOT anything stronger than
 * `theoretical-only`. They are the point. A change that made the analyzer
 * recommend quantum more often would pass every "does it return a verdict"
 * test ever written.
 */

async function configure(env: Record<string, string> = {}): Promise<void> {
  delete process.env.QUANTUM_LOCAL_MAX_QUBITS;
  delete process.env.QUANTUM_MAX_EXECUTION_LEVEL;
  Object.assign(process.env, env);
  __resetConfigForTests();
  await initConfig();
}

function problem(overrides: Partial<QuantumProblem> & { type: QuantumProblemType }): QuantumProblem {
  return {
    id: 'p1',
    description: 'test problem',
    formulation: 'none',
    dimensionality: 8,
    ...overrides,
  };
}

beforeEach(async () => {
  await configure();
});

afterEach(() => {
  delete process.env.QUANTUM_LOCAL_MAX_QUBITS;
  delete process.env.QUANTUM_MAX_EXECUTION_LEVEL;
  __resetConfigForTests();
});

describe('it refuses what has no quantum formulation', () => {
  it('language is NOT_SUITABLE, and says the classical path is the right one', () => {
    const analysis = analyseQuantumSuitability(
      problem({ type: 'natural-language', description: 'summarise this document' })
    );

    expect(analysis.verdict).toBe('NOT_SUITABLE');
    expect(analysis.expectedBenefit).toBe('none');
    expect(analysis.candidateQuantumAlgorithm).toBeNull();
    expect(analysis.candidateClassicalAlgorithm).toMatch(/transformer/i);
    expect(analysis.confidence).toBeGreaterThan(0.9);
  });

  it('an unidentified problem type is UNKNOWN, never a guess', () => {
    const analysis = analyseQuantumSuitability(problem({ type: 'unknown' }));
    expect(analysis.verdict).toBe('UNKNOWN');
    expect(analysis.expectedBenefit).toBe('unknown');
    expect(analysis.reasons.join(' ')).toMatch(/guesses that get quoted/);
  });

  it('a missing dimensionality is UNKNOWN, because every estimate follows from it', () => {
    const analysis = analyseQuantumSuitability(
      problem({ type: 'combinatorial-optimisation', formulation: 'QUBO', dimensionality: 0 })
    );
    expect(analysis.verdict).toBe('UNKNOWN');
    expect(analysis.estimatedQubits).toBeNull();
  });

  it('an optimisation problem with no QUBO/Ising formulation is UNKNOWN, not a QAOA candidate', () => {
    const analysis = analyseQuantumSuitability(
      problem({ type: 'combinatorial-optimisation', formulation: 'none' })
    );
    expect(analysis.verdict).toBe('UNKNOWN');
    expect(analysis.candidateQuantumAlgorithm).toBeNull();
  });
});

describe('it sizes problems honestly', () => {
  it('a small QUBO is a SIMULATOR candidate with NO expected benefit', () => {
    const analysis = analyseQuantumSuitability(
      problem({ type: 'combinatorial-optimisation', formulation: 'QUBO', dimensionality: 8 })
    );

    expect(analysis.verdict).toBe('SIMULATOR_CANDIDATE');
    expect(analysis.candidateQuantumAlgorithm).toBe('qaoa');
    expect(analysis.estimatedQubits).toBe(8);
    expect(analysis.simulationFeasible).toBe(true);
    // The essential point: at a size the simulator can hold, the classical
    // method is EXACT, so there is no benefit to be uncertain about.
    expect(analysis.expectedBenefit).toBe('none');
    expect(analysis.reasons.join(' ')).toMatch(/PROVABLY optimal/);
  });

  it('a problem larger than any device is NOT_SUITABLE', () => {
    const analysis = analyseQuantumSuitability(
      problem({ type: 'combinatorial-optimisation', formulation: 'Ising', dimensionality: 5000 })
    );

    expect(analysis.verdict).toBe('NOT_SUITABLE');
    expect(analysis.hardwareCompatible).toBe(false);
    expect(analysis.reasons.join(' ')).toMatch(/no device to run this on/);
  });

  it('a mid-size problem is only a QPU candidate when the operator RAISED the ceiling', async () => {
    const mid = problem({
      type: 'combinatorial-optimisation',
      formulation: 'Ising',
      dimensionality: 40,
      data: { ising: { linear: new Array(40).fill(0), quadratic: [[0, 1, 1]] } },
    });

    // Default ceiling 0 — no hardware path is enabled, so it cannot be
    // recommended no matter how well it would fit.
    expect(analyseQuantumSuitability(mid).verdict).toBe('RESEARCH_CANDIDATE');

    await configure({ QUANTUM_MAX_EXECUTION_LEVEL: '2' });
    const raised = analyseQuantumSuitability(mid);
    expect(raised.verdict).toBe('QPU_CANDIDATE');
    // Even then: unknown benefit, and the baseline is still required.
    expect(raised.expectedBenefit).toBe('unknown');
    expect(raised.classicalBaselineRequired).toBe(true);
    expect(raised.estimatedCost.known).toBe(false);
  });

  it('reports simulation memory so a 30-qubit request is refused for a stated reason', () => {
    const analysis = analyseQuantumSuitability(
      problem({ type: 'combinatorial-optimisation', formulation: 'QUBO', dimensionality: 30 })
    );
    expect(analysis.simulationFeasible).toBe(false);
    expect(analysis.simulationMemoryBytes).toBe(2 ** 30 * 16);
  });

  it('estimates depth from the ACTUAL coupling count when the payload has one', () => {
    const sparse = analyseQuantumSuitability(
      problem({
        type: 'combinatorial-optimisation',
        formulation: 'Ising',
        dimensionality: 10,
        data: { ising: { linear: new Array(10).fill(0), quadratic: [[0, 1, 1]] } },
      })
    );
    const dense = analyseQuantumSuitability(
      problem({ type: 'combinatorial-optimisation', formulation: 'QUBO', dimensionality: 10 })
    );

    // A sparse problem is genuinely shallower; assuming dense for both would
    // make the analyzer pessimistic in a way that hides the real difference.
    expect(sparse.estimatedCircuitDepth!).toBeLessThan(dense.estimatedCircuitDepth!);
  });
});

describe('the textbook algorithms are named and then explained away', () => {
  it('factoring names Shor and immediately says why it does not apply', () => {
    const analysis = analyseQuantumSuitability(
      problem({ type: 'factoring', dimensionality: 2048, description: 'factor an RSA modulus' })
    );

    expect(analysis.verdict).toBe('RESEARCH_CANDIDATE');
    expect(analysis.candidateQuantumAlgorithm).toBe('shor');
    expect(analysis.estimatedQubits).toBe(2 * 2048 + 3);
    expect(analysis.hardwareCompatible).toBe(false);
    expect(analysis.expectedBenefit).toBe('theoretical-only');
    expect(analysis.reasons.join(' ')).toMatch(/millions of physical qubits/);
  });

  it('search names Grover and states that quadratic is not enough', () => {
    const analysis = analyseQuantumSuitability(
      problem({ type: 'unstructured-search', dimensionality: 1_000_000 })
    );
    expect(analysis.candidateQuantumAlgorithm).toBe('grover');
    expect(analysis.reasons.join(' ')).toMatch(/QUADRATIC/);
    expect(analysis.expectedBenefit).toBe('theoretical-only');
  });

  it('linear algebra names HHL and states the caveats that eliminate most uses', () => {
    const analysis = analyseQuantumSuitability(problem({ type: 'linear-algebra', dimensionality: 4096 }));
    expect(analysis.candidateQuantumAlgorithm).toBe('hhl');
    expect(analysis.reasons.join(' ')).toMatch(/dequantised/);
  });

  it('every named algorithm exists in the registry with its research status', () => {
    // An analyzer that could name an algorithm nobody documented would be
    // recommending something with no recorded limitations.
    for (const type of [
      'combinatorial-optimisation',
      'ground-state-energy',
      'classification',
      'factoring',
      'unstructured-search',
      'linear-algebra',
      'sampling-distribution',
      'simulation-dynamics',
    ] as QuantumProblemType[]) {
      const analysis = analyseQuantumSuitability(
        problem({ type, formulation: type === 'combinatorial-optimisation' ? 'QUBO' : 'Hamiltonian' })
      );
      if (analysis.candidateQuantumAlgorithm) {
        const algorithm = getQuantumAlgorithm(analysis.candidateQuantumAlgorithm);
        expect(algorithm, `${type} named an unknown algorithm`).toBeDefined();
        expect(analysis.state).toBe(algorithm!.state);
      }
    }
  });
});

describe('the conservatism itself', () => {
  it('never returns a benefit stronger than "demonstrated in the literature"', () => {
    const permitted = ['none', 'unknown', 'theoretical-only', 'demonstrated-in-literature'];
    for (const type of [
      'natural-language',
      'combinatorial-optimisation',
      'ground-state-energy',
      'classification',
      'regression',
      'sampling-distribution',
      'linear-algebra',
      'unstructured-search',
      'factoring',
      'simulation-dynamics',
      'unknown',
    ] as QuantumProblemType[]) {
      const analysis = analyseQuantumSuitability(problem({ type, formulation: 'Hamiltonian' }));
      expect(permitted, `${type}`).toContain(analysis.expectedBenefit);
    }
  });

  it('requires a classical baseline for every verdict without exception', () => {
    for (const type of [
      'combinatorial-optimisation',
      'classification',
      'natural-language',
      'unknown',
    ] as QuantumProblemType[]) {
      expect(analyseQuantumSuitability(problem({ type, formulation: 'QUBO' })).classicalBaselineRequired).toBe(
        true
      );
    }
  });

  it('costs a simulator recommendation at zero and a hardware one at UNKNOWN', async () => {
    const simulator = analyseQuantumSuitability(
      problem({ type: 'combinatorial-optimisation', formulation: 'QUBO', dimensionality: 6 })
    );
    expect(simulator.estimatedCost).toMatchObject({ known: true, estimatedCents: 0 });

    await configure({ QUANTUM_MAX_EXECUTION_LEVEL: '2' });
    const hardware = analyseQuantumSuitability(
      problem({ type: 'combinatorial-optimisation', formulation: 'Ising', dimensionality: 40 })
    );
    // Never a plausible-looking number — the budget gate refuses unknown
    // metered costs, which is the right place for that refusal.
    expect(hardware.estimatedCost).toMatchObject({ known: false, estimatedCents: null });
  });

  it('is pure — analysing does not execute, spend, or contact anything', () => {
    // Synchronous by signature. An analyzer that had to reach a provider to
    // answer would be too expensive to run on every request, and would leak
    // the fact that a question was asked.
    const analysis = analyseQuantumSuitability(
      problem({ type: 'combinatorial-optimisation', formulation: 'QUBO' })
    );
    expect(analysis).not.toBeInstanceOf(Promise);
    expect(analysis.problemId).toBe('p1');
  });
});
