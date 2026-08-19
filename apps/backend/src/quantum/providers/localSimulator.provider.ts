import { getConfig } from '../../config';
import { bindParameters, checkCircuitAgainstBackend, circuitHash, SUPPORTED_GATES } from '../circuit';
import type { QuantumProviderDescriptor } from '../descriptor';
import {
  sampleCounts,
  simulateStatevector,
  statevectorBytes,
} from '../simulator/statevector';
import type {
  QuantumBackend,
  QuantumCost,
  QuantumExecutionRequest,
  QuantumExecutionResult,
  QuantumProvider,
} from '../types';

/**
 * LEVEL 0 — the local, in-process, exact statevector simulator.
 *
 * This is the only quantum backend Synora can execute today without a
 * credential, an account, a queue or a bill, and it is therefore the default
 * for everything. Auto-selection never leaves this rung unless an operator
 * raises `QUANTUM_MAX_AUTO_LEVEL`, which no default sets.
 *
 * It is `unmetered` in the same sense Ollama is: the operator already owns
 * the hardware it runs on. That is a statement about money, not about
 * resources — a 20-qubit simulation still costs 16 MB and real CPU time, so
 * the qubit ceiling is enforced before allocation rather than discovered by
 * an out-of-memory kill inside a worker.
 *
 * HONESTY OF ITS RESULTS. Noiseless and exact. `noise-model` is absent from
 * its capability list, `simulated` is true on the backend, and every result
 * it produces carries `producedBy: 'simulator'`. A number from here is an
 * upper bound on what hardware could achieve, never a measurement of what
 * hardware did.
 */

/**
 * Amplitude storage only. Gate application is in-place, so this is the
 * dominant term, but the process still needs headroom for the probability
 * and cumulative arrays during sampling (another 2 × 8 bytes per amplitude).
 */
function describeMemory(qubits: number): string {
  const mb = statevectorBytes(qubits) / 1024 ** 2;
  return mb < 1 ? `${Math.round(mb * 1024)} KB` : `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

function backendFor(maxQubits: number): QuantumBackend {
  return {
    id: 'local-statevector',
    providerId: 'local-simulator',
    displayName: `Local statevector simulator (≤ ${maxQubits} qubits, ${describeMemory(maxQubits)})`,
    kind: 'local-simulator',
    executionLevel: 0,
    maxQubits,
    // Sampling is O(shots · log 2^n) after one O(2^n) pass, so a large shot
    // count is cheap here in a way it never is on hardware. The cap exists
    // to bound wall-clock inside a request, not to bound spend.
    maxShots: 1_000_000,
    capabilities: [
      'circuit-execution',
      'statevector',
      'expectation-value',
      'parameterised-circuits',
    ],
    nativeGates: SUPPORTED_GATES,
    metering: 'unmetered',
    // A price of exactly zero, DECLARED — not an absent price, which would
    // mean "unknown" and be refused by the budget gate.
    pricing: { perTaskCents: 0, perShotMicroCents: 0, source: 'runs in-process; no vendor bills for it' },
    simulated: true,
  };
}

/**
 * A deterministic seed when the caller supplies none.
 *
 * Derived from the execution id and the circuit's own hash, so the same
 * request reproduces the same samples, and two different requests do not
 * accidentally share a draw. `Math.random()` would make every sampled result
 * irreproducible, which would quietly invalidate the benchmarking layer —
 * a comparison you cannot re-run is not evidence.
 */
function deriveSeed(executionId: string, hash: string): number {
  let h = 0x811c9dc5;
  for (const ch of `${executionId}:${hash}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

class LocalSimulatorProvider implements QuantumProvider {
  readonly id = 'local-simulator';

  constructor(private readonly maxQubits: number) {}

  async listBackends(): Promise<readonly QuantumBackend[]> {
    return [backendFor(this.maxQubits)];
  }

  estimateCost(): QuantumCost {
    return {
      known: true,
      estimatedCents: 0,
      basis: 'free-local-execution',
      detail: 'executed in this process; no external party bills for it',
    };
  }

  async execute(
    backend: QuantumBackend,
    request: QuantumExecutionRequest
  ): Promise<QuantumExecutionResult> {
    const startedAt = Date.now();
    const submittedAt = new Date().toISOString();

    const bound = bindParameters(request.circuit, request.parameters);
    const warnings = [...checkCircuitAgainstBackend(bound, backend, request.shots)];

    const hash = circuitHash(bound);
    const seed = request.seed ?? deriveSeed(request.executionId, hash);

    const state = simulateStatevector(bound, this.maxQubits);
    const counts = sampleCounts(state, bound, request.shots, seed);

    if (bound.measurements.length === 0) {
      warnings.push(
        'circuit declared no measurements; all qubits were sampled in index order'
      );
    }

    return {
      executionId: request.executionId,
      providerId: this.id,
      backendId: backend.id,
      backendKind: backend.kind,
      executionLevel: backend.executionLevel,
      shots: request.shots,
      counts,
      // Amplitudes are returned only for circuits small enough that the
      // array is not itself a memory problem for the caller. A 20-qubit
      // statevector is a million objects; handing that to a JSON serialiser
      // is a different kind of outage.
      ...(bound.qubits <= 12
        ? {
            statevector: Array.from({ length: state.size }, (_, i) => ({
              re: state.re[i],
              im: state.im[i],
            })),
          }
        : {}),
      durationMs: Date.now() - startedAt,
      cost: this.estimateCost(),
      provenance: {
        producedBy: 'simulator',
        simulated: true,
        noiseModelApplied: false,
        seed,
        submittedAt,
        circuitHash: hash,
        evidenceClass: 'computational-evidence',
      },
      warnings,
    };
  }
}

export const localSimulatorDescriptor: QuantumProviderDescriptor = {
  id: 'local-simulator',
  displayName: 'Local statevector simulator',
  metering: 'unmetered',
  minExecutionLevel: 0,
  maxExecutionLevel: 0,
  async isConfigured() {
    // Always. It needs no credential, no network and no account — which is
    // precisely what makes it a safe default and a viable CI target.
    return true;
  },
  async verifyCredential() {
    return {
      status: 'not-verifiable' as const,
      detail: 'runs in-process and has no credential to verify',
    };
  },
  async create() {
    return new LocalSimulatorProvider(getConfig().quantum.localMaxQubits);
  },
};
