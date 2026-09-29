import { getConfig } from '../config';
import { getQuantumAlgorithm } from './algorithms/registry';
import { statevectorBytes } from './simulator/statevector';
import type {
  ExpectedQuantumBenefit,
  QuantumCost,
  QuantumProblem,
  QuantumSuitabilityAnalysis,
  QuantumSuitabilityVerdict,
  AlgorithmState,
} from './types';

/**
 * The Quantum Suitability Analyzer — the component that says NO.
 *
 * ── ITS PURPOSE, PRECISELY ───────────────────────────────────────────────
 *
 * Not to find opportunities for quantum computing. To find the small number
 * of cases where a quantum formulation is even coherent, and to refuse
 * everything else in a way that a non-specialist can act on.
 *
 * The failure it exists to prevent is the one every quantum-adjacent product
 * makes: a plausible-sounding path from "this is an optimisation problem" to
 * "therefore quantum", when the actual chain requires a formulation, a
 * circuit that fits real hardware, a noise budget the circuit survives, and
 * a classical baseline it beats — and the last link has never been closed
 * for any commercially relevant problem.
 *
 * ── HOW IT STAYS CONSERVATIVE ────────────────────────────────────────────
 *
 * 1. `UNKNOWN` is the default, and anything missing produces it. An analyzer
 *    that guesses is worse than none, because its guesses get quoted.
 * 2. The strongest available benefit claim is `demonstrated-in-literature`,
 *    which is a citation, not a result Synora reproduced. There is no
 *    member of `ExpectedQuantumBenefit` meaning "quantum wins", and adding
 *    one would be the single change that turns this file into marketing.
 * 3. `classicalBaselineRequired` is the literal type `true`. It cannot be
 *    switched off, at compile time, by anybody.
 * 4. `QPU_CANDIDATE` additionally requires the operator to have RAISED the
 *    execution ceiling. An analyzer that recommends hardware nobody enabled
 *    is recommending a bill.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────
 *
 * It does not run anything, cost anything, or call any provider. It is pure
 * and synchronous, so it is cheap enough to run on every request and
 * testable without a backend.
 */

/**
 * Above this, a statevector simulation stops being something a request can
 * do and becomes something a cluster does. 2^24 amplitudes is 268 MB before
 * the probability and cumulative arrays sampling needs.
 */
const SIMULATION_MEMORY_CEILING_BYTES = 512 * 1024 * 1024;

/**
 * The largest gate-model devices publicly available are in the low hundreds
 * of physical qubits, with no error correction. A circuit needing more than
 * this is not "hard on today's hardware"; it does not have hardware.
 */
const REALISTIC_HARDWARE_QUBIT_CEILING = 156;

/**
 * Two-qubit gate error is ~10⁻³ on good devices, so a circuit of depth ~1000
 * has accumulated more error than signal. This is the line past which a
 * result is noise regardless of how many shots are taken.
 */
const REALISTIC_HARDWARE_DEPTH_CEILING = 1_000;

interface Judgement {
  verdict: QuantumSuitabilityVerdict;
  algorithm: string | null;
  classical: string;
  qubits: number | null;
  depth: number | null;
  noise: QuantumSuitabilityAnalysis['noiseSensitivity'];
  benefit: ExpectedQuantumBenefit;
  confidence: number;
  reasons: string[];
}

export function analyseQuantumSuitability(problem: QuantumProblem): QuantumSuitabilityAnalysis {
  const config = getConfig().quantum;
  const judgement = judge(problem, config.localMaxQubits, config.maxExecutionLevel);

  const memory = judgement.qubits === null ? null : statevectorBytes(judgement.qubits);
  const simulationFeasible =
    judgement.qubits !== null &&
    judgement.qubits <= config.localMaxQubits &&
    memory !== null &&
    memory <= SIMULATION_MEMORY_CEILING_BYTES;

  const hardwareCompatible =
    judgement.qubits !== null &&
    judgement.qubits <= REALISTIC_HARDWARE_QUBIT_CEILING &&
    (judgement.depth === null || judgement.depth <= REALISTIC_HARDWARE_DEPTH_CEILING);

  const algorithm = judgement.algorithm ? getQuantumAlgorithm(judgement.algorithm) : undefined;
  const state: AlgorithmState = algorithm?.state ?? 'DESCRIBED';

  return {
    problemId: problem.id,
    verdict: judgement.verdict,
    problemType: problem.type,
    formulation: problem.formulation,
    dimensionality: problem.dimensionality,
    candidateClassicalAlgorithm: judgement.classical,
    candidateQuantumAlgorithm: judgement.algorithm,
    estimatedQubits: judgement.qubits,
    estimatedCircuitDepth: judgement.depth,
    simulationFeasible,
    simulationMemoryBytes: memory,
    hardwareCompatible,
    noiseSensitivity: judgement.noise,
    expectedBenefit: judgement.benefit,
    classicalBaselineRequired: true,
    estimatedCost: costFor(judgement.verdict),
    confidence: judgement.confidence,
    state,
    reasons: judgement.reasons,
  };
}

/**
 * Cost of the recommended path — free for anything the analyzer is willing
 * to recommend, unknown for hardware.
 *
 * A `QPU_CANDIDATE` gets `unknown` rather than a number because pricing a
 * QPU task requires a device, a plan and a queue estimate the analyzer does
 * not have. `../budget.ts` will refuse an unknown metered cost at execution
 * time, which is the right place for that refusal — the analyzer's job is
 * to be honest, not to pre-approve.
 */
function costFor(verdict: QuantumSuitabilityVerdict): QuantumCost {
  if (verdict === 'SIMULATOR_CANDIDATE') {
    return {
      known: true,
      estimatedCents: 0,
      basis: 'free-local-execution',
      detail: 'the recommended path is the in-process simulator, which nothing bills for',
    };
  }
  if (verdict === 'QPU_CANDIDATE') {
    return {
      known: false,
      estimatedCents: null,
      basis: 'unknown',
      detail: 'hardware pricing depends on the device, plan and queue; it is resolved at execution time',
    };
  }
  return {
    known: true,
    estimatedCents: 0,
    basis: 'free-local-execution',
    detail: 'no quantum execution is recommended, so nothing would be spent',
  };
}

/* ── The rules, one problem class at a time ──────────────────────────── */

function judge(problem: QuantumProblem, maxSimQubits: number, ceiling: number): Judgement {
  const n = problem.dimensionality;

  if (problem.type === 'unknown') {
    return unknownJudgement(
      'the problem type was not identified, and an unidentified problem cannot be judged'
    );
  }
  if (!Number.isFinite(n) || n <= 0) {
    return unknownJudgement(
      `dimensionality is ${n}; every qubit estimate follows from problem size, so nothing can be estimated without it`
    );
  }

  switch (problem.type) {
    case 'natural-language':
      return {
        verdict: 'NOT_SUITABLE',
        algorithm: null,
        classical: 'a transformer language model — which is what Synora already routes to',
        qubits: null,
        depth: null,
        noise: 'unknown',
        benefit: 'none',
        confidence: 0.97,
        reasons: [
          'language understanding and generation have no quantum formulation with a credible advantage at any scale',
          'proposals in this space encode a toy sub-task, not the reasoning, and are outperformed by small classical models',
          'this is the classical path, and routing it to quantum would be strictly worse in latency, cost and quality',
        ],
      };

    case 'combinatorial-optimisation':
      return judgeOptimisation(problem, n, maxSimQubits, ceiling);

    case 'ground-state-energy':
    case 'simulation-dynamics':
      return judgeSimulation(problem, n, maxSimQubits, ceiling);

    case 'classification':
    case 'regression':
      return judgeLearning(n, maxSimQubits);

    case 'sampling-distribution':
      return {
        verdict: 'RESEARCH_CANDIDATE',
        algorithm: 'quantum-generative',
        classical: 'a classical generative model (VAE, normalising flow, or a small GAN)',
        qubits: n,
        depth: 4 * n,
        noise: 'high',
        benefit: 'theoretical-only',
        confidence: 0.6,
        reasons: [
          'sampling from a Born-rule distribution is one of the few genuinely hard-to-simulate quantum tasks',
          'that hardness has been demonstrated for RANDOM circuits, whose output nobody wants — usefulness and hardness have not been shown together',
          'no executable implementation exists in this build',
        ],
      };

    case 'linear-algebra':
      return {
        verdict: 'RESEARCH_CANDIDATE',
        algorithm: 'hhl',
        classical: 'conjugate gradient, or a randomised sketching method',
        qubits: Math.ceil(Math.log2(Math.max(2, n))) + 8,
        depth: null,
        noise: 'extreme',
        benefit: 'theoretical-only',
        confidence: 0.85,
        reasons: [
          "HHL's exponential speedup requires a sparse well-conditioned matrix, efficient state preparation, and that only an EXPECTATION of the solution is ever read",
          'reading the solution vector out destroys the speedup entirely',
          'several HHL applications were later matched by classical randomised algorithms ("dequantised")',
          'it needs fault-tolerant hardware that does not exist',
        ],
      };

    case 'unstructured-search':
      return {
        verdict: 'RESEARCH_CANDIDATE',
        algorithm: 'grover',
        classical: 'a linear scan, or any structure-exploiting search the problem actually admits',
        qubits: Math.ceil(Math.log2(Math.max(2, n))),
        // ~(π/4)√N iterations, each containing an oracle and a diffusion operator.
        depth: Math.ceil((Math.PI / 4) * Math.sqrt(n)) * 4,
        noise: 'extreme',
        benefit: 'theoretical-only',
        confidence: 0.9,
        reasons: [
          "Grover's speedup is QUADRATIC, and quadratic does not survive the constant-factor overhead of error correction at any near-term scale",
          'the predicate must be a reversible circuit acting on a superposition, not a lookup — building it usually costs more than the search saves',
          'the algorithm is provably optimal for UNSTRUCTURED search, which also means any structure a classical method exploits beats it',
        ],
      };

    case 'factoring':
      return {
        verdict: 'RESEARCH_CANDIDATE',
        algorithm: 'shor',
        classical: 'the general number field sieve',
        // ~2n+3 LOGICAL qubits; physical is orders of magnitude larger.
        qubits: 2 * n + 3,
        depth: null,
        noise: 'extreme',
        benefit: 'theoretical-only',
        confidence: 0.95,
        reasons: [
          `an ${n}-bit integer needs about ${2 * n + 3} LOGICAL qubits, which under any known error-correcting code is millions of physical qubits`,
          'no such device exists, and none is close',
          'every "factored on a quantum computer" demonstration to date used a circuit simplified with prior knowledge of the answer',
        ],
      };

    default:
      return unknownJudgement('no rule covers this problem type');
  }
}

function unknownJudgement(reason: string): Judgement {
  return {
    verdict: 'UNKNOWN',
    algorithm: null,
    classical: 'not determined',
    qubits: null,
    depth: null,
    noise: 'unknown',
    benefit: 'unknown',
    confidence: 0.2,
    reasons: [reason, 'UNKNOWN is the default; an analyzer that guesses produces guesses that get quoted'],
  };
}

function judgeOptimisation(
  problem: QuantumProblem,
  n: number,
  maxSimQubits: number,
  ceiling: number
): Judgement {
  const reasons: string[] = [];

  if (problem.formulation !== 'QUBO' && problem.formulation !== 'Ising') {
    return {
      verdict: 'UNKNOWN',
      algorithm: null,
      classical: 'a mixed-integer programming solver, or a problem-specific heuristic',
      qubits: null,
      depth: null,
      noise: 'unknown',
      benefit: 'unknown',
      confidence: 0.4,
      reasons: [
        `the objective is declared as "${problem.formulation}"; QAOA needs an exact QUBO or Ising formulation`,
        'reformulating is often possible and often introduces penalty terms that make the problem harder, not easier',
      ],
    };
  }

  // Depth: p layers, each with one RZZ (3 gates) per coupling plus one
  // rotation per variable. Dense coupling is the pessimistic assumption.
  const couplings = countCouplings(problem) ?? (n * (n - 1)) / 2;
  const depth = Math.ceil(3 * couplings + n + 1);

  reasons.push(
    `one qubit per variable: ${n} qubits`,
    `estimated depth ${depth} for ${couplings} coupling terms at p=1 — depth grows linearly in couplings, which is O(n²) for a dense problem`
  );

  if (n <= 24) {
    reasons.push(
      `at n=${n}, exhaustive enumeration evaluates all ${2 ** Math.min(n, 30)} assignments and returns the PROVABLY optimal answer in milliseconds — QAOA returns an approximation after hundreds of circuit evaluations`
    );
  }

  if (n <= maxSimQubits) {
    return {
      verdict: 'SIMULATOR_CANDIDATE',
      algorithm: 'qaoa',
      classical:
        n <= 24
          ? 'exhaustive enumeration (exact) and multi-restart local search'
          : 'simulated annealing or a specialised MIP solver',
      qubits: n,
      depth,
      noise: 'high',
      // `none`, not `unknown`: at simulable sizes the classical method is
      // exact, so there is no benefit available to be uncertain about.
      benefit: 'none',
      confidence: 0.8,
      reasons: [
        ...reasons,
        'runnable on the free local simulator, for comparison against the classical baseline — which is the only reason to run it',
      ],
    };
  }

  if (n <= REALISTIC_HARDWARE_QUBIT_CEILING && ceiling >= 2) {
    return {
      verdict: 'QPU_CANDIDATE',
      algorithm: 'qaoa',
      classical: 'simulated annealing, tabu search, or a specialised MIP solver',
      qubits: n,
      depth,
      noise: depth > REALISTIC_HARDWARE_DEPTH_CEILING ? 'extreme' : 'high',
      benefit: 'unknown',
      confidence: 0.55,
      reasons: [
        ...reasons,
        `${n} qubits is beyond this simulator (${maxSimQubits}) but within reach of current hardware`,
        ...(depth > REALISTIC_HARDWARE_DEPTH_CEILING
          ? [
              `estimated depth ${depth} exceeds ~${REALISTIC_HARDWARE_DEPTH_CEILING}, past which accumulated two-qubit gate error typically exceeds the signal — expect noise, not an answer`,
            ]
          : []),
        'a hardware run is a comparison experiment, not a solution method: the classical baseline is still required and still expected to win',
      ],
    };
  }

  if (n > REALISTIC_HARDWARE_QUBIT_CEILING) {
    return {
      verdict: 'NOT_SUITABLE',
      algorithm: null,
      classical: 'simulated annealing, tabu search, or a specialised MIP solver',
      qubits: n,
      depth,
      noise: 'extreme',
      benefit: 'none',
      confidence: 0.9,
      reasons: [
        ...reasons,
        `${n} qubits exceeds the largest publicly available gate-model devices (~${REALISTIC_HARDWARE_QUBIT_CEILING} physical, no error correction)`,
        'there is no device to run this on, so the question of advantage does not arise',
      ],
    };
  }

  return {
    verdict: 'RESEARCH_CANDIDATE',
    algorithm: 'qaoa',
    classical: 'simulated annealing or a specialised MIP solver',
    qubits: n,
    depth,
    noise: 'high',
    benefit: 'unknown',
    confidence: 0.6,
    reasons: [
      ...reasons,
      `${n} qubits is beyond this simulator and this deployment's execution ceiling is ${ceiling}, so no hardware path is enabled`,
    ],
  };
}

function judgeSimulation(
  problem: QuantumProblem,
  n: number,
  maxSimQubits: number,
  ceiling: number
): Judgement {
  const algorithm = problem.type === 'ground-state-energy' ? 'vqe' : 'trotter-simulation';
  const depth = problem.type === 'ground-state-energy' ? 4 * n : 8 * n;

  const shared = [
    'simulating quantum systems is the ONE application whose quantum argument is structural rather than algorithmic: the state space is exponentially large for reasons no cleverer classical algorithm removes',
    'that is still not a demonstrated advantage — every verifiable result to date was verifiable because a classical method could also produce it',
    'tensor-network methods keep advancing the classical frontier for exactly the systems most often proposed as quantum targets',
  ];

  if (n <= maxSimQubits && problem.type === 'ground-state-energy') {
    return {
      verdict: 'SIMULATOR_CANDIDATE',
      algorithm,
      classical: 'exact lowest eigenvalue by shifted power iteration on the same Hamiltonian',
      qubits: n,
      depth,
      noise: 'moderate',
      benefit: 'none',
      confidence: 0.8,
      reasons: [
        ...shared,
        `${n} qubits fits the local simulator, where the exact ground state is also computable — so the comparison is exact`,
      ],
    };
  }

  if (n <= REALISTIC_HARDWARE_QUBIT_CEILING && ceiling >= 2) {
    return {
      verdict: 'QPU_CANDIDATE',
      algorithm,
      classical: 'tensor-network methods (DMRG for 1-D, PEPS otherwise) or coupled-cluster',
      qubits: n,
      depth,
      noise: 'high',
      benefit: 'theoretical-only',
      confidence: 0.55,
      reasons: [
        ...shared,
        `${n} qubits exceeds the local simulator (${maxSimQubits}) and is within hardware reach`,
        'error mitigation is mandatory at this size, and its overhead grows exponentially with circuit volume',
      ],
    };
  }

  return {
    verdict: 'RESEARCH_CANDIDATE',
    algorithm,
    classical: 'tensor-network methods or coupled-cluster',
    qubits: n,
    depth,
    noise: 'high',
    benefit: 'theoretical-only',
    confidence: 0.6,
    reasons: [
      ...shared,
      `${n} qubits is beyond the local simulator (${maxSimQubits}) and no hardware rung is enabled (ceiling ${ceiling})`,
      ...(problem.type === 'simulation-dynamics'
        ? ['Trotterised evolution has no executable implementation in this build']
        : []),
    ],
  };
}

function judgeLearning(n: number, maxSimQubits: number): Judgement {
  const reasons = [
    `the ZZ feature map uses one qubit per feature: ${n} qubits`,
    'the kernel matrix costs O(m²) overlap evaluations for m samples — 500 rows is 125,000 circuit executions on hardware',
    'quantum kernel advantage has been demonstrated only on data ENGINEERED from a hardness assumption, never on data that existed for another reason',
  ];

  if (n > maxSimQubits) {
    return {
      verdict: 'NOT_SUITABLE',
      algorithm: null,
      classical: 'gradient boosting, or an RBF-kernel method',
      qubits: n,
      depth: n + n * (n - 1),
      noise: 'high',
      benefit: 'none',
      confidence: 0.85,
      reasons: [
        ...reasons,
        `${n} features exceeds the ${maxSimQubits}-qubit simulator, and the O(m²) hardware cost makes a real run unaffordable before it is interesting`,
      ],
    };
  }

  return {
    verdict: 'SIMULATOR_CANDIDATE',
    algorithm: 'quantum-kernel',
    classical: 'RBF-kernel ridge regression with the same solver, regulariser and train/test split',
    qubits: n,
    depth: n + n * (n - 1),
    noise: 'high',
    benefit: 'none',
    confidence: 0.8,
    reasons: [
      ...reasons,
      'runnable on the free simulator, where the classical kernel uses the identical model so only the kernel differs — the comparison is exact and, on ordinary data, classical wins',
    ],
  };
}

/** Coupling count from an explicit Ising payload, when one is present. */
function countCouplings(problem: QuantumProblem): number | null {
  const ising = problem.data?.ising as { quadratic?: unknown[] } | undefined;
  if (ising && Array.isArray(ising.quadratic)) return ising.quadratic.length;

  const qubo = problem.data?.qubo as number[][] | undefined;
  if (Array.isArray(qubo)) {
    let count = 0;
    for (let i = 0; i < qubo.length; i++) {
      for (let j = i + 1; j < qubo.length; j++) {
        if ((qubo[i]?.[j] ?? 0) !== 0 || (qubo[j]?.[i] ?? 0) !== 0) count++;
      }
    }
    return count;
  }
  return null;
}
