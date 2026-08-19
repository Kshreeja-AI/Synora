/**
 * Provider-agnostic quantum computation contracts.
 *
 * The rest of the application depends only on the types in this module and
 * on `./index.ts` — never on a concrete quantum vendor. Adding, removing or
 * swapping a quantum backend is entirely contained within `./providers/*`;
 * nothing outside this directory should ever import a Qiskit binding, the
 * AWS Braket client, or any QPU vendor's API.
 *
 * THIS IS THE SAME BOUNDARY `../ai/types.ts` DRAWS, ON PURPOSE. Synora's
 * long-term claim is that its product logic outlives its vendors. A quantum
 * backend is a vendor like any other: it has a credential, an availability
 * state, a price, and a result shape, and business logic is entitled to know
 * none of those things.
 *
 * ── WHY QISKIT IS NOT A DEPENDENCY HERE ──────────────────────────────────
 *
 * Qiskit is a Python library. Synora's backend is Node.js/TypeScript ESM.
 * There is no import that makes `qiskit.circuit` reachable from this file,
 * and manufacturing one would mean putting a Python runtime inside the
 * production image — a large, permanent infrastructure change in service of
 * a capability nobody has yet asked to run in production.
 *
 * So the coupling is inverted, which is the correct direction anyway:
 * Synora emits **OpenQASM 3** (`./qasm.ts`), the vendor-neutral circuit
 * interchange format that `qiskit.qasm3`, IBM Quantum Runtime and Braket
 * all consume. A Qiskit-based executor — a sidecar, a notebook, a research
 * harness — reads Synora's circuits without Synora importing Qiskit, and
 * Synora reads its results back through `QuantumExecutionResult` without
 * learning that Qiskit was involved. That is what "Qiskit is an
 * implementation dependency behind the Quantum Provider interface" has to
 * mean in a Node codebase, stated plainly rather than implied.
 *
 * ── WHAT A QUANTUM RESULT IS ─────────────────────────────────────────────
 *
 * Computational evidence. Not truth. A sampled distribution from a noisy or
 * simulated device is a measurement with error bars, and `QuantumProvenance`
 * is mandatory on every result so no downstream consumer can forget that.
 */

/* ═══════════════════════════════════════════════════════════════════════ *
 * CAPABILITIES
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * What a backend can actually do. Declared per backend, never inferred from
 * its marketing or its class — the same rule `AIProviderDescriptor.metering`
 * enforces for money. A caller that needs exact amplitudes checks for
 * `statevector` rather than assuming "it's a simulator, so it must".
 */
export type QuantumCapability =
  /** Run a circuit for N shots and return measured bitstring counts. */
  | 'circuit-execution'
  /** Return exact complex amplitudes. Structurally impossible on hardware. */
  | 'statevector'
  /** Compute <psi|H|psi> for an observable without sampling it. */
  | 'expectation-value'
  /** Bind named circuit parameters at execution time. */
  | 'parameterised-circuits'
  /** Apply a device noise model to a simulation. */
  | 'noise-model'
  /** Compile to the backend's native gate set on the provider's side. */
  | 'transpilation';

/* ═══════════════════════════════════════════════════════════════════════ *
 * EXECUTION HIERARCHY
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The four rungs, in ascending order of what they can cost.
 *
 *  0 — LOCAL SIMULATOR. In-process. Free, deterministic, bounded by RAM.
 *  1 — FREE / LOW-COST CLOUD SIMULATOR, where a provider offers one.
 *  2 — OPEN-ACCESS QPU (IBM Quantum's free tier and equivalents). Free at
 *      the point of use, but rate-limited and queued.
 *  3 — PAID QPU. Real money, per task and per shot.
 *
 * Auto-selection is capped by configuration and defaults to 0. Level 3
 * additionally requires an explicit enablement flag that no default sets —
 * see `./budget.ts`. Nothing in Synora silently ascends this ladder.
 */
export type QuantumExecutionLevel = 0 | 1 | 2 | 3;

export type QuantumBackendKind = 'local-simulator' | 'cloud-simulator' | 'qpu';

/**
 * Per-shot / per-task pricing, DECLARED by the backend.
 *
 * Absent means "this deployment does not know what this backend charges",
 * which produces an UNKNOWN cost — never a zero one. The identical rule to
 * `ai/pricing.ts`: an unpriced model is not a free model, and an unpriced
 * QPU task is not a free QPU task.
 */
export interface QuantumPricing {
  readonly perTaskCents: number;
  readonly perShotMicroCents: number;
  /** Where these numbers came from, so a stale table is auditable. */
  readonly source: string;
}

/** Coherence/error characteristics, where the provider publishes them. */
export interface QuantumNoiseProfile {
  readonly oneQubitErrorRate?: number;
  readonly twoQubitErrorRate?: number;
  readonly readoutErrorRate?: number;
  readonly t1Microseconds?: number;
  readonly t2Microseconds?: number;
}

/**
 * A concrete execution target. One provider publishes one or more of these.
 *
 * `metering` follows `AIProviderDescriptor`'s contract exactly, including
 * its reasoning: it is DECLARED, never derived from the absence of a price,
 * because "free" and "unpriced" are indistinguishable to arithmetic and
 * opposite to a bill.
 */
export interface QuantumBackend {
  readonly id: string;
  readonly providerId: string;
  readonly displayName: string;
  readonly kind: QuantumBackendKind;
  readonly executionLevel: QuantumExecutionLevel;
  readonly maxQubits: number;
  readonly maxShots: number;
  readonly capabilities: readonly QuantumCapability[];
  /** Gate names this backend executes natively, lower-case. */
  readonly nativeGates: readonly string[];
  readonly metering: 'metered' | 'unmetered';
  /** Absent ⇒ cost is UNKNOWN, which is not the same as free. */
  readonly pricing?: QuantumPricing;
  readonly noise?: QuantumNoiseProfile;
  /** Jobs ahead of this one, where the provider reports it. */
  readonly queueDepth?: number;
  /** True when the backend is simulating rather than measuring reality. */
  readonly simulated: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════ *
 * CIRCUITS
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Synora's gate vocabulary — a deliberately small, universal set.
 *
 * Small because every gate here must be implementable by every adapter and
 * emittable as OpenQASM 3. Universal because {u, cx} alone spans SU(2^n);
 * the rest exist so circuits read like the algorithms that produced them
 * and so a backend that has a native `rz` is not handed a synthesised one.
 */
export type QuantumGateName =
  | 'id'
  | 'h'
  | 'x'
  | 'y'
  | 'z'
  | 's'
  | 'sdg'
  | 't'
  | 'tdg'
  | 'rx'
  | 'ry'
  | 'rz'
  | 'p'
  | 'u'
  | 'cx'
  | 'cy'
  | 'cz'
  | 'swap'
  | 'crz'
  | 'cp'
  | 'ccx';

export interface QuantumGate {
  readonly name: QuantumGateName;
  /** Target qubit indices, control(s) first for controlled gates. */
  readonly qubits: readonly number[];
  /**
   * Literal angle values, in radians. Mutually exclusive per-slot with
   * `paramRefs`: a slot is either a number now or a name bound later.
   */
  readonly params?: readonly number[];
  /**
   * Named parameters resolved at execution time from
   * `QuantumExecutionRequest.parameters`. This is what makes a variational
   * algorithm one circuit optimised many times rather than N circuits.
   */
  readonly paramRefs?: readonly (string | null)[];
}

export interface QuantumMeasurement {
  readonly qubit: number;
  readonly clbit: number;
}

/**
 * A circuit, as Synora describes it to any backend.
 *
 * Immutable by contract — `./circuit.ts` builds these, nothing mutates one
 * after construction, and `circuitHash()` over this shape is what appears
 * in a result's provenance.
 */
export interface QuantumCircuit {
  readonly name: string;
  readonly qubits: number;
  readonly clbits: number;
  readonly gates: readonly QuantumGate[];
  readonly measurements: readonly QuantumMeasurement[];
  /** Names that must be supplied at execution time. */
  readonly parameters: readonly string[];
}

/* ═══════════════════════════════════════════════════════════════════════ *
 * OBSERVABLES
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * A weighted sum of Pauli strings — the standard way to write a
 * Hamiltonian or any measurable quantity.
 *
 * `paulis` is one character per qubit from {I,X,Y,Z}, index 0 = qubit 0.
 * Left-to-right qubit ordering is Synora's convention everywhere and is
 * converted at each adapter boundary rather than leaking a vendor's choice
 * inward (IBM writes bitstrings little-endian; that is IBM's problem, and
 * `./providers/ibmQuantum.provider.ts` is where it stays).
 */
export interface PauliTerm {
  readonly coefficient: number;
  readonly paulis: string;
}

export interface QuantumObservable {
  readonly terms: readonly PauliTerm[];
  readonly qubits: number;
}

/* ═══════════════════════════════════════════════════════════════════════ *
 * COST
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * What an execution is expected to cost, or an honest admission that this
 * deployment cannot say.
 *
 * `estimatedCents: null` IS the unknown state and is never collapsed to 0.
 * `./budget.ts` refuses to authorise a metered execution whose cost is
 * unknown, which is the whole reason the null exists rather than a
 * convenient zero.
 */
export interface QuantumCost {
  readonly known: boolean;
  readonly estimatedCents: number | null;
  readonly basis:
    | 'free-local-execution'
    | 'declared-price-table'
    | 'provider-quote'
    | 'open-access-free-tier'
    | 'unknown';
  readonly detail: string;
}

/* ═══════════════════════════════════════════════════════════════════════ *
 * EXECUTION
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Everything an execution needs, with nothing optional that governs money.
 *
 * `shots`, `timeoutMs` and `executionId` are REQUIRED. A default shot count
 * is a default bill; a default timeout is a job that hangs a worker; an
 * absent execution id is a result nobody can trace back to a request. Each
 * of those is a caller decision, so each is a caller field.
 */
export interface QuantumExecutionRequest {
  readonly circuit: QuantumCircuit;
  readonly shots: number;
  readonly timeoutMs: number;
  /** Caller-owned correlation id. Appears in provenance and in every log. */
  readonly executionId: string;
  /** Pin a provider. Must exist and be configured, or this throws. */
  readonly providerId?: string;
  /** Pin a backend within that provider. */
  readonly backendId?: string;
  /** Ceiling on auto-selection. Never exceeds the configured cap. */
  readonly maxLevel?: QuantumExecutionLevel;
  /** Values for `circuit.parameters`. All must be present. */
  readonly parameters?: Readonly<Record<string, number>>;
  /** Reproducibility for simulators. Ignored by hardware, which cannot obey it. */
  readonly seed?: number;
  /**
   * Explicit per-execution spend authorisation, in cents. A metered
   * execution without one is refused: authorising spend is the caller's
   * act, not a default.
   */
  readonly budgetCents?: number;
  readonly workspaceId?: string;
  readonly userId?: string;
}

/**
 * Where a result came from and what it is worth.
 *
 * MANDATORY on every result, including simulated ones — especially
 * simulated ones. A number produced by a noiseless statevector simulator
 * and a number measured on a QPU are different kinds of claim, and a
 * consumer that cannot tell them apart will eventually publish the first
 * as if it were the second.
 */
export interface QuantumProvenance {
  readonly producedBy: 'simulator' | 'quantum-hardware';
  readonly simulated: boolean;
  readonly noiseModelApplied: boolean;
  readonly seed?: number;
  /** ISO-8601, set by the adapter at submission. */
  readonly submittedAt: string;
  /** The vendor's own job identifier, where one exists. */
  readonly providerJobId?: string;
  /** Stable hash of the exact circuit executed. */
  readonly circuitHash: string;
  /**
   * Deliberately a single-valued type. There is no `'truth'` member and
   * there is not meant to be one: this field exists so the classification
   * survives serialisation into any downstream store.
   */
  readonly evidenceClass: 'computational-evidence';
}

export interface QuantumExecutionResult {
  readonly executionId: string;
  readonly providerId: string;
  readonly backendId: string;
  readonly backendKind: QuantumBackendKind;
  readonly executionLevel: QuantumExecutionLevel;
  readonly shots: number;
  /** Measured bitstrings → occurrence count. Key order is not significant. */
  readonly counts: Readonly<Record<string, number>>;
  /** Only from backends declaring `statevector`. Absent everywhere else. */
  readonly statevector?: readonly { readonly re: number; readonly im: number }[];
  readonly durationMs: number;
  readonly cost: QuantumCost;
  readonly provenance: QuantumProvenance;
  /** Non-fatal observations: truncation, transpilation notes, queue delays. */
  readonly warnings: readonly string[];
}

/* ═══════════════════════════════════════════════════════════════════════ *
 * PROBLEMS, ALGORITHMS, SUITABILITY
 * ═══════════════════════════════════════════════════════════════════════ */

export type QuantumProblemType =
  | 'combinatorial-optimisation'
  | 'ground-state-energy'
  | 'classification'
  | 'regression'
  | 'sampling-distribution'
  | 'linear-algebra'
  | 'simulation-dynamics'
  | 'unstructured-search'
  | 'factoring'
  | 'natural-language'
  | 'unknown';

export type QuantumFormulation =
  | 'QUBO'
  | 'Ising'
  | 'Hamiltonian'
  | 'kernel-matrix'
  | 'oracle'
  | 'none';

/**
 * A computational problem, described in a way that is independent of both
 * the classical and the quantum method that might solve it.
 *
 * `dimensionality` is the honest driver of every qubit estimate downstream,
 * so it is required for anything other than `unknown`: an analyzer that
 * guesses the size of the problem cannot produce a trustworthy verdict.
 */
export interface QuantumProblem {
  readonly id: string;
  readonly type: QuantumProblemType;
  readonly description: string;
  readonly formulation: QuantumFormulation;
  /** Number of decision variables / features / spins. */
  readonly dimensionality: number;
  /** Free-form, algorithm-specific payload. Never vendor-specific. */
  readonly data?: Readonly<Record<string, unknown>>;
}

/**
 * The analyzer's verdict. Five states, and the ordering matters: nothing
 * here promises an advantage, and the two most common honest answers
 * (`NOT_SUITABLE`, `UNKNOWN`) are first.
 */
export type QuantumSuitabilityVerdict =
  /** There is no credible quantum formulation, or it is provably worse. */
  | 'NOT_SUITABLE'
  /** Not enough information to judge. The default when anything is missing. */
  | 'UNKNOWN'
  /** A formulation exists in the literature; no usable implementation here. */
  | 'RESEARCH_CANDIDATE'
  /** Small enough to run honestly on a simulator, for comparison only. */
  | 'SIMULATOR_CANDIDATE'
  /** Fits real hardware AND the operator has enabled that rung. */
  | 'QPU_CANDIDATE';

/**
 * How much benefit is expected. There is deliberately no member meaning
 * "quantum wins": the strongest available claim is that somebody has
 * demonstrated something in the literature, which is a citation, not a
 * result Synora has reproduced.
 */
export type ExpectedQuantumBenefit =
  | 'none'
  | 'unknown'
  | 'theoretical-only'
  | 'demonstrated-in-literature';

/**
 * The lifecycle ladder for a quantum algorithm. Five rungs, and the point of
 * having five is that they are NOT interchangeable — the whole failure this
 * ladder prevents is a registry where "we described it" reads the same as
 * "it works".
 *
 *  DESCRIBED    — metadata only: assumptions, qubit cost, limitations,
 *                 references. No executable body. Asking to run it throws.
 *  EXPERIMENTAL — an implementation exists but has not been checked against
 *                 anything independent. Its numbers are not evidence.
 *  IMPLEMENTED  — runs and passes its own unit tests. Correct by its own
 *                 lights, which is not the same as correct.
 *  VERIFIED     — validated against an INDEPENDENT classical ground truth
 *                 (exhaustive enumeration, exact diagonalisation). This is
 *                 the rung that costs real work and means something.
 *  ENABLED      — VERIFIED and available for execution in this build.
 *
 * Only `ENABLED` may execute. `requireExecutableAlgorithm()` enforces that,
 * so a rung cannot be skipped by adding a `run` method and hoping.
 */
export type AlgorithmState =
  | 'DESCRIBED'
  | 'EXPERIMENTAL'
  | 'IMPLEMENTED'
  | 'VERIFIED'
  | 'ENABLED';

export interface QuantumSuitabilityAnalysis {
  readonly problemId: string;
  readonly verdict: QuantumSuitabilityVerdict;
  readonly problemType: QuantumProblemType;
  readonly formulation: QuantumFormulation;
  readonly dimensionality: number;
  readonly candidateClassicalAlgorithm: string;
  readonly candidateQuantumAlgorithm: string | null;
  readonly estimatedQubits: number | null;
  readonly estimatedCircuitDepth: number | null;
  /** Whether a statevector simulation of this size is feasible here. */
  readonly simulationFeasible: boolean;
  readonly simulationMemoryBytes: number | null;
  readonly hardwareCompatible: boolean;
  readonly noiseSensitivity: 'low' | 'moderate' | 'high' | 'extreme' | 'unknown';
  readonly expectedBenefit: ExpectedQuantumBenefit;
  /** Always true in this design. A quantum number without one is not evidence. */
  readonly classicalBaselineRequired: true;
  readonly estimatedCost: QuantumCost;
  /** 0..1. Confidence in the VERDICT, not in any advantage. */
  readonly confidence: number;
  readonly state: AlgorithmState;
  /** Plain-language reasons, in the order they were applied. */
  readonly reasons: readonly string[];
}

/* ═══════════════════════════════════════════════════════════════════════ *
 * VALIDATION
 * ═══════════════════════════════════════════════════════════════════════ */

export interface QuantumValidationCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface QuantumValidationResult {
  readonly valid: boolean;
  readonly checks: readonly QuantumValidationCheck[];
  readonly confidence: 'high' | 'medium' | 'low' | 'unknown';
}

/* ═══════════════════════════════════════════════════════════════════════ *
 * THE PROVIDER INTERFACE
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * What every quantum backend implements. Three methods, none of them
 * vendor-shaped.
 *
 * `estimateCost` is separate from `execute` so a cost can be known BEFORE
 * anything is authorised — the ordering that makes "never silently spend
 * money" enforceable rather than aspirational.
 */
export interface QuantumProvider {
  readonly id: string;
  /** Backends this provider can currently reach. May involve a network call. */
  listBackends(): Promise<readonly QuantumBackend[]>;
  /** Cost of running `request` on `backend`, or an honest unknown. */
  estimateCost(backend: QuantumBackend, request: QuantumExecutionRequest): QuantumCost;
  /** Run it. Must throw a `QuantumError` subclass, never a raw SDK error. */
  execute(
    backend: QuantumBackend,
    request: QuantumExecutionRequest
  ): Promise<QuantumExecutionResult>;
}
