import type {
  QuantumCircuit,
  QuantumFormulation,
  QuantumProblem,
  QuantumProblemType,
  AlgorithmState,
} from '../types';

/**
 * What a quantum algorithm publishes about itself.
 *
 * EVERY FIELD BELOW IS MANDATORY, and that is the point. The failure this
 * shape prevents is a registry of impressive names — QAOA, VQE, QNN, QCNN —
 * that implies each one works, on this hardware, for the reader's problem.
 * None of those is true by default, and an entry that cannot state its
 * assumptions, its classical baseline, its qubit requirement and its
 * limitations has not earned a place in a system that makes claims.
 *
 * `state` is the honesty rung and it is checked at runtime:
 * `run` is optional, and `requireExecutable()` refuses anything without one
 * rather than returning a plausible number. A fabricated benchmark is
 * indistinguishable from a real one once it has been written down.
 */
export interface QuantumAlgorithmDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  /** Problem classes this algorithm is even a candidate for. */
  readonly problemClasses: readonly QuantumProblemType[];
  readonly formulation: QuantumFormulation;
  /** The conditions under which any claim about this algorithm holds. */
  readonly assumptions: readonly string[];
  /** The classical method any result MUST be compared against. */
  readonly classicalBaseline: string;
  readonly simulatorSupported: boolean;
  readonly qpuSupported: boolean;
  /** How qubit count follows from problem size, in words. */
  readonly qubitRequirement: string;
  /** Known reasons this may not work. Never empty for a real algorithm. */
  readonly limitations: readonly string[];
  readonly state: AlgorithmState;
  /** What is actually tested in this repository. */
  readonly testCoverage: 'none' | 'unit' | 'unit-and-baseline-comparison';
  /** Where the method comes from. Citations, not endorsements. */
  readonly references: readonly string[];
  /**
   * Build the circuit for this problem, given parameter values or names.
   * Present whenever a circuit is well-defined, even if `run` is not —
   * a circuit can be exported as OpenQASM for an external researcher to
   * execute, which is useful precisely when Synora cannot execute it.
   */
  buildCircuit?(problem: QuantumProblem, parameters: readonly (number | string)[]): QuantumCircuit;
  /** Execute end-to-end. Absent for anything not implemented in this build. */
  run?(problem: QuantumProblem, options: QuantumAlgorithmRunOptions): Promise<QuantumAlgorithmOutcome>;
}

export interface QuantumAlgorithmRunOptions {
  /** Ceiling on circuit evaluations. Each one is a circuit execution. */
  readonly maxEvaluations?: number;
  /** Shots used for the final sampled circuit. */
  readonly shots?: number;
  /** Reproducibility. Simulators honour it; hardware cannot. */
  readonly seed?: number;
  /** Algorithm-specific knobs (QAOA layers, ansatz depth, …). */
  readonly hyperparameters?: Readonly<Record<string, number>>;
}

/**
 * What an algorithm produced. Deliberately shaped so a result cannot be
 * reported without the context that qualifies it.
 */
export interface QuantumAlgorithmOutcome {
  readonly algorithmId: string;
  /** The optimised objective. Lower is better by convention, as in physics. */
  readonly objectiveValue: number;
  /** Algorithm-specific answer — a bitstring, an energy, a set of labels. */
  readonly solution: Readonly<Record<string, unknown>>;
  readonly qubits: number;
  readonly circuitDepth: number;
  readonly circuitEvaluations: number;
  readonly optimiserConverged: boolean;
  /**
   * Where the numbers came from. `'local-simulator'` here means a noiseless
   * exact simulation, which is an OPTIMISTIC bound on hardware, never a
   * prediction of it.
   */
  readonly executedOn: 'local-simulator' | 'quantum-hardware';
  readonly durationMs: number;
  readonly warnings: readonly string[];
}
