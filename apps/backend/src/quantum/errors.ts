/**
 * The quantum layer's error vocabulary.
 *
 * Every one of these is thrown by Synora, never by a vendor SDK — the same
 * contract `AIProviderError` establishes for text generation. A caller
 * handling a quantum failure never needs to know which vendor failed or how
 * that vendor shapes its errors, and a vendor error that escapes an adapter
 * unwrapped is an adapter defect.
 *
 * The distinctions here are the ones that change what an operator does:
 * a missing credential is a configuration task, an unenabled paid rung is a
 * founder decision, a budget refusal is a limit working correctly, and an
 * unreachable provider is an incident. Collapsing any two of them would
 * send someone to fix the wrong thing.
 */

export class QuantumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuantumError';
  }
}

/** A backend answered, or refused, or timed out. Carries who. */
export class QuantumProviderError extends QuantumError {
  constructor(
    message: string,
    readonly providerId: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'QuantumProviderError';
  }
}

/**
 * The provider's credential is absent. Distinct from `QuantumProviderError`
 * because nothing was attempted and nothing is wrong upstream.
 */
export class QuantumProviderNotConfiguredError extends QuantumError {
  constructor(
    readonly providerId: string,
    detail: string
  ) {
    super(`Quantum provider "${providerId}" is not configured: ${detail}`);
    this.name = 'QuantumProviderNotConfiguredError';
  }
}

/**
 * The provider exists in the registry but cannot run in this build — an
 * unshipped vendor client, a platform the runtime cannot reach.
 *
 * Mirrors `EmbeddingProviderDescriptor.unsupportedReason`: the resolver
 * skips such a provider during auto-selection, and says THIS rather than
 * "not configured" when a caller names it explicitly. Being told to go
 * hunting for a credential that would not have helped is worse than being
 * told the truth.
 */
export class QuantumProviderUnsupportedError extends QuantumError {
  constructor(
    readonly providerId: string,
    readonly reason: string
  ) {
    super(`Quantum provider "${providerId}" cannot run in this build: ${reason}`);
    this.name = 'QuantumProviderUnsupportedError';
  }
}

/** No provider/backend satisfied the request. Lists what was considered. */
export class NoQuantumBackendAvailableError extends QuantumError {
  constructor(
    readonly checked: readonly string[],
    detail: string
  ) {
    super(
      `No quantum backend is available for this request. ${detail} ` +
        `Considered: ${checked.length > 0 ? checked.join(', ') : 'none'}.`
    );
    this.name = 'NoQuantumBackendAvailableError';
  }
}

/** A named backend does not exist on the provider that was asked. */
export class UnknownQuantumBackendError extends QuantumError {
  constructor(
    readonly backendId: string,
    readonly known: readonly string[]
  ) {
    super(
      `Unknown quantum backend "${backendId}". ` +
        `Known backends: ${known.length > 0 ? known.join(', ') : 'none reachable'}.`
    );
    this.name = 'UnknownQuantumBackendError';
  }
}

/** A named algorithm is not in the algorithm registry. */
export class UnknownQuantumAlgorithmError extends QuantumError {
  constructor(
    readonly algorithmId: string,
    readonly known: readonly string[]
  ) {
    super(
      `Unknown quantum algorithm "${algorithmId}". Known algorithms: ${known.join(', ')}.`
    );
    this.name = 'UnknownQuantumAlgorithmError';
  }
}

/**
 * The algorithm is registered and described, but has no executable body in
 * this build. Thrown rather than returning a plausible-looking number,
 * because a fabricated result from a research scaffold is indistinguishable
 * from a real one once it is written down.
 */
export class QuantumAlgorithmNotImplementedError extends QuantumError {
  constructor(
    readonly algorithmId: string,
    readonly state: string
  ) {
    super(
      `Quantum algorithm "${algorithmId}" is registered as ${state} and has no ` +
        'executable implementation in this build. It is described so its assumptions, ' +
        'qubit requirements and limitations are on the record — not so it can be run. ' +
        'Nothing was executed and no result was fabricated.'
    );
    this.name = 'QuantumAlgorithmNotImplementedError';
  }
}

/**
 * Level 3 was requested without explicit enablement.
 *
 * This is the money gate. It is a separate error type from a budget refusal
 * because the remedy is different: a budget refusal means "raise the limit
 * or wait", this means "a human has never authorised paid quantum hardware
 * on this deployment at all".
 */
export class PaidQpuNotEnabledError extends QuantumError {
  constructor(readonly backendId: string) {
    super(
      `Refusing to execute on paid quantum hardware ("${backendId}"): ` +
        'QUANTUM_PAID_QPU_ENABLED is not set. Paid QPU execution costs real money per ' +
        'task and per shot, so it requires an explicit, deliberate enablement — there is ' +
        'no default, and no code path sets one. Nothing was submitted.'
    );
    this.name = 'PaidQpuNotEnabledError';
  }
}

/** The estimated cost exceeded an authorised ceiling. Nothing was submitted. */
export class QuantumBudgetExceededError extends QuantumError {
  constructor(
    readonly estimatedCents: number,
    readonly limitCents: number,
    readonly scope: 'request' | 'deployment'
  ) {
    super(
      `Refusing to execute: the estimated quantum cost (${estimatedCents} cents) exceeds ` +
        `the authorised ${scope} ceiling (${limitCents} cents). Nothing was submitted.`
    );
    this.name = 'QuantumBudgetExceededError';
  }
}

/**
 * A metered execution whose price this deployment cannot determine.
 *
 * Refused rather than attempted. The alternative — running it and finding
 * out from an invoice — is the exact failure `ai/spend-guard.ts` was built
 * to end, and it is not reintroduced here just because the workload is
 * quantum.
 */
export class QuantumCostUnknownError extends QuantumError {
  constructor(
    readonly backendId: string,
    detail: string
  ) {
    super(
      `Refusing to execute on metered backend "${backendId}": its cost is unknown ` +
        `(${detail}). An unknown price is not a zero price. Add a declared price entry ` +
        'for this backend, or run on a level-0 simulator. Nothing was submitted.'
    );
    this.name = 'QuantumCostUnknownError';
  }
}

/**
 * A RESOURCE ceiling was exceeded — shots, depth, qubits or runtime.
 *
 * Distinct from a budget refusal because it is not about money. A free local
 * simulation costs nothing and can still exhaust a machine's memory or burn a
 * worker for an hour, and an operator who sets a shot ceiling is bounding a
 * resource rather than a bill. Reporting one as the other would send them to
 * raise the wrong limit.
 */
export class QuantumResourceLimitError extends QuantumError {
  constructor(
    readonly resource: 'shots' | 'circuit-depth' | 'qubits' | 'runtime',
    readonly requested: number,
    readonly limit: number,
    readonly envVar: string
  ) {
    super(
      `Refusing to execute: ${requested} ${resource} exceeds this deployment's ceiling of ` +
        `${limit}. Raise ${envVar} deliberately if the host can genuinely afford it. ` +
        'Nothing was submitted.'
    );
    this.name = 'QuantumResourceLimitError';
  }
}

/** The circuit is structurally invalid, or too big for the chosen backend. */
export class InvalidQuantumCircuitError extends QuantumError {
  constructor(
    message: string,
    readonly circuitName: string
  ) {
    super(`Invalid circuit "${circuitName}": ${message}`);
    this.name = 'InvalidQuantumCircuitError';
  }
}

/** A job did not finish inside `timeoutMs`. Says nothing about correctness. */
export class QuantumExecutionTimeoutError extends QuantumError {
  constructor(
    readonly providerId: string,
    readonly timeoutMs: number
  ) {
    super(
      `Quantum execution on "${providerId}" exceeded ${timeoutMs}ms. Synora stopped ` +
        'waiting; the provider may still be running the job, and a metered provider may ' +
        'still bill for it.'
    );
    this.name = 'QuantumExecutionTimeoutError';
  }
}
