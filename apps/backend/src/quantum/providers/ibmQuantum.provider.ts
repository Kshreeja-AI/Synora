import { getConfig } from '../../config';
import { safeFetch } from '../../net/ssrf';
import { secretsManager } from '../../secrets';
import { logger } from '../../utils/logger';
import { bindParameters, checkCircuitAgainstBackend, circuitHash } from '../circuit';
import type { QuantumProviderDescriptor } from '../descriptor';
import {
  QuantumExecutionTimeoutError,
  QuantumProviderError,
  QuantumProviderNotConfiguredError,
} from '../errors';
import { toQasm3 } from '../qasm';
import type {
  QuantumBackend,
  QuantumCost,
  QuantumExecutionLevel,
  QuantumExecutionRequest,
  QuantumExecutionResult,
  QuantumProvider,
} from '../types';

/**
 * IBM Quantum — LEVELS 2 and 3.
 *
 * ── STATUS, STATED FIRST ─────────────────────────────────────────────────
 *
 * IMPLEMENTED, NOT VERIFIED. Every line here was written against IBM's
 * published Runtime REST interface, and not one of them has been executed
 * against IBM, because no IBM credential exists on this deployment. The
 * structure — discovery, submission, polling, retrieval, normalisation,
 * timeout, error mapping — is complete and independently testable with a
 * stub transport. The WIRE DETAILS (exact response field names, the auth
 * header form IBM's current platform expects, the primitive envelope
 * version) are the part a first credentialed run will confirm or correct,
 * and they are concentrated in the three `decode*` functions below so that
 * correction is a small, local edit rather than a rewrite.
 *
 * Claiming otherwise would be the specific failure `SYNORA_FOUNDER_OS.md`
 * Part IV names: converting "did not run" into "passed".
 *
 * ── WHY REST AND NOT QISKIT ──────────────────────────────────────────────
 *
 * `qiskit-ibm-runtime` is Python. This process is Node. The Runtime service
 * is an ordinary HTTPS API that accepts OpenQASM 3 — which `../qasm.ts`
 * already emits — so the adapter talks to it directly and Synora acquires
 * no Python runtime, no second toolchain, and no subprocess boundary.
 *
 * ── SECURITY ─────────────────────────────────────────────────────────────
 *
 * The token is read from SecretsManager at call time and never held in a
 * field, never logged, never included in an error message, and never placed
 * in a URL. Every request goes through `safeFetch`, so the operator-supplied
 * base URL — and every redirect hop it might follow — is validated against
 * the SSRF address rules before a connection is made. An API base URL is
 * configuration, and configuration is exactly the kind of thing that gets
 * pointed somewhere unfortunate.
 */

const OPEN_ACCESS_QUBIT_CEILING = 156;

interface IbmSettings {
  baseUrl: string;
  instance?: string;
}

function settings(): IbmSettings {
  const { ibmBaseUrl, ibmInstance } = getConfig().quantum;
  return { baseUrl: ibmBaseUrl.replace(/\/+$/, ''), instance: ibmInstance };
}

async function token(): Promise<string> {
  const value = await secretsManager.tryGet('IBM_QUANTUM_API_TOKEN', 'quantum-ibm');
  if (!value) {
    throw new QuantumProviderNotConfiguredError(
      'ibm-quantum',
      'IBM_QUANTUM_API_TOKEN is not present in the secret store'
    );
  }
  return value;
}

/**
 * One HTTP call, with the credential attached and never exposed.
 *
 * `detail` in a thrown error carries the STATUS and the provider's own
 * message, never the request headers — an error report that echoes its own
 * Authorization header is how credentials end up in log aggregators.
 */
async function call(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; timeoutMs: number }
): Promise<unknown> {
  const { baseUrl, instance } = settings();
  const apiKey = await token();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);

  try {
    const response = await safeFetch(`${baseUrl}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(instance ? { 'Service-CRN': instance } : {}),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new QuantumProviderError(
        `IBM Quantum returned HTTP ${response.status}: ${text.slice(0, 300)}`,
        'ibm-quantum'
      );
    }
    return text.length > 0 ? (JSON.parse(text) as unknown) : {};
  } catch (error) {
    if (error instanceof QuantumProviderError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new QuantumExecutionTimeoutError('ibm-quantum', init.timeoutMs);
    }
    throw new QuantumProviderError(
      `IBM Quantum request failed: ${error instanceof Error ? error.message : String(error)}`,
      'ibm-quantum',
      error
    );
  } finally {
    clearTimeout(timer);
  }
}

/* ── Vendor decoding. The three functions a first real run will confirm. ── */

interface RawBackend {
  name?: string;
  n_qubits?: number;
  num_qubits?: number;
  simulator?: boolean;
  basis_gates?: string[];
  status?: { pending_jobs?: number };
  pending_jobs?: number;
}

/**
 * IBM's backend list → Synora's `QuantumBackend`.
 *
 * The execution level is derived from what the device IS, not from what the
 * account is entitled to: a simulator is level 1, a real device is level 2
 * (open access) or 3 (paid), and Synora cannot see an account's plan from
 * here. So a real device is reported as level 3 unless the operator has
 * declared this instance to be open-access — the pessimistic direction,
 * because mistaking paid hardware for free hardware is the expensive error
 * and mistaking free for paid merely asks for one enablement flag.
 */
function decodeBackends(raw: unknown, openAccess: boolean): QuantumBackend[] {
  const devices = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { devices?: unknown[] })?.devices)
      ? ((raw as { devices: unknown[] }).devices ?? [])
      : ((raw as { backends?: unknown[] })?.backends ?? []);

  const out: QuantumBackend[] = [];
  for (const entry of devices as RawBackend[]) {
    const name = typeof entry === 'string' ? entry : entry?.name;
    if (!name) continue;
    const isSimulator = Boolean(entry?.simulator) || /simulator|aer|statevector/i.test(name);
    const qubits = entry?.n_qubits ?? entry?.num_qubits ?? (isSimulator ? 32 : OPEN_ACCESS_QUBIT_CEILING);
    const level: QuantumExecutionLevel = isSimulator ? 1 : openAccess ? 2 : 3;

    out.push({
      id: name,
      providerId: 'ibm-quantum',
      displayName: `IBM Quantum ${name}`,
      kind: isSimulator ? 'cloud-simulator' : 'qpu',
      executionLevel: level,
      maxQubits: qubits,
      maxShots: 100_000,
      capabilities: isSimulator
        ? ['circuit-execution', 'expectation-value', 'parameterised-circuits', 'transpilation']
        : ['circuit-execution', 'parameterised-circuits', 'transpilation', 'noise-model'],
      nativeGates: entry?.basis_gates ?? [],
      metering: level === 3 ? 'metered' : 'unmetered',
      // NO `pricing` ENTRY, on purpose. IBM's paid plans are priced per
      // second of QPU time under a contract this code cannot read, so any
      // number here would be invented. Absent pricing means UNKNOWN cost,
      // and `../budget.ts` refuses to authorise a metered execution whose
      // cost is unknown — which is the correct outcome, not a gap.
      ...(entry?.status?.pending_jobs !== undefined || entry?.pending_jobs !== undefined
        ? { queueDepth: entry.status?.pending_jobs ?? entry.pending_jobs }
        : {}),
      simulated: isSimulator,
    });
  }
  return out;
}

interface RawJob {
  id?: string;
  job_id?: string;
  status?: string;
  state?: { status?: string };
}

function decodeJobId(raw: unknown): string {
  const job = raw as RawJob;
  const id = job?.id ?? job?.job_id;
  if (!id) {
    throw new QuantumProviderError('IBM Quantum accepted the job but returned no job id', 'ibm-quantum');
  }
  return id;
}

function decodeStatus(raw: unknown): string {
  const job = raw as RawJob;
  return (job?.status ?? job?.state?.status ?? 'Unknown').toString();
}

/**
 * IBM's sampler result → Synora's `counts`.
 *
 * BIT ORDER IS CONVERTED HERE, and this is the only place in Synora that
 * knows IBM writes bitstrings with qubit 0 rightmost. Synora's convention is
 * qubit 0 leftmost (see `../simulator/statevector.ts`). Letting a vendor's
 * endianness travel inward would mean every consumer of `counts` had to know
 * which backend produced it, which is precisely the coupling this whole
 * layer exists to prevent.
 */
function decodeCounts(raw: unknown, clbits: number): Record<string, number> {
  const results = (raw as { results?: unknown[] })?.results;
  const first = Array.isArray(results) ? results[0] : raw;
  const data = (first as { data?: { counts?: Record<string, number> } })?.data;
  const rawCounts = data?.counts ?? (first as { counts?: Record<string, number> })?.counts;

  if (!rawCounts || typeof rawCounts !== 'object') {
    throw new QuantumProviderError(
      'IBM Quantum returned a result Synora could not decode into counts',
      'ibm-quantum'
    );
  }

  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawCounts)) {
    // Hex keys ("0x3") appear in some result formats; both are handled.
    const bits = key.startsWith('0x')
      ? Number.parseInt(key, 16).toString(2).padStart(clbits, '0')
      : key.replace(/\s/g, '');
    const synoraOrder = [...bits].reverse().join('');
    out[synoraOrder] = (out[synoraOrder] ?? 0) + Number(value);
  }
  return out;
}

/* ── The provider ────────────────────────────────────────────────────────── */

class IbmQuantumProvider implements QuantumProvider {
  readonly id = 'ibm-quantum';

  async listBackends(): Promise<readonly QuantumBackend[]> {
    const raw = await call('/backends', { method: 'GET', timeoutMs: 15_000 });
    return decodeBackends(raw, getConfig().quantum.ibmOpenAccess);
  }

  /**
   * UNKNOWN for paid hardware, and that is the honest answer.
   *
   * IBM bills paid plans per second of QPU time under a contract this
   * process cannot see. Returning a plausible-looking number would be
   * fabricating a price, and the budget gate would then authorise against
   * fiction. Open-access and cloud-simulator backends are genuinely free at
   * the point of use, which IS knowable, so those are reported as such.
   */
  estimateCost(backend: QuantumBackend, request: QuantumExecutionRequest): QuantumCost {
    if (backend.executionLevel <= 2) {
      return {
        known: true,
        estimatedCents: 0,
        basis: 'open-access-free-tier',
        detail: `${backend.id} is free at the point of use on IBM's open access tier; it is rate-limited and queued, not billed`,
      };
    }
    return {
      known: false,
      estimatedCents: null,
      basis: 'unknown',
      detail:
        `IBM prices paid hardware per second of QPU time under a plan Synora cannot read. ` +
        `${request.shots} shots on ${backend.id} has no derivable price here.`,
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

    const submitted = await call('/jobs', {
      method: 'POST',
      timeoutMs: Math.min(request.timeoutMs, 30_000),
      body: {
        program_id: 'sampler',
        backend: backend.id,
        params: {
          // OpenQASM 3 is the interchange. Synora never sends a vendor
          // object model, so switching adapters never re-serialises a
          // circuit differently.
          qasm: toQasm3(bound),
          shots: request.shots,
        },
        ...(settings().instance ? { instance: settings().instance } : {}),
      },
    });

    const jobId = decodeJobId(submitted);
    logger.info('[Quantum/IBM] job submitted', {
      executionId: request.executionId,
      backend: backend.id,
      jobId,
      shots: request.shots,
    });

    const result = await this.pollUntilDone(jobId, request, startedAt);

    if (request.seed !== undefined) {
      warnings.push(
        'a seed was supplied but hardware cannot be seeded; this result is not reproducible'
      );
    }

    return {
      executionId: request.executionId,
      providerId: this.id,
      backendId: backend.id,
      backendKind: backend.kind,
      executionLevel: backend.executionLevel,
      shots: request.shots,
      counts: decodeCounts(result, bound.clbits),
      durationMs: Date.now() - startedAt,
      cost: this.estimateCost(backend, request),
      provenance: {
        // The one field that separates a measurement from a simulation.
        producedBy: backend.simulated ? 'simulator' : 'quantum-hardware',
        simulated: backend.simulated,
        // True for real devices by definition: the noise is the device's own,
        // not a model Synora applied.
        noiseModelApplied: !backend.simulated,
        submittedAt,
        providerJobId: jobId,
        circuitHash: circuitHash(bound),
        evidenceClass: 'computational-evidence',
      },
      warnings,
    };
  }

  /**
   * Poll to completion, or give up honestly.
   *
   * A timeout here does NOT cancel IBM's job — the same property
   * `instrumentedGenerate` documents for text generation. The job may still
   * run, and on a paid plan it may still bill. That is stated in the error
   * rather than left for someone to discover on an invoice.
   */
  private async pollUntilDone(
    jobId: string,
    request: QuantumExecutionRequest,
    startedAt: number
  ): Promise<unknown> {
    const deadline = startedAt + request.timeoutMs;
    let intervalMs = 1_000;

    for (;;) {
      if (Date.now() >= deadline) {
        throw new QuantumExecutionTimeoutError('ibm-quantum', request.timeoutMs);
      }

      const job = await call(`/jobs/${encodeURIComponent(jobId)}`, {
        method: 'GET',
        timeoutMs: 15_000,
      });
      const status = decodeStatus(job).toLowerCase();

      if (status === 'completed' || status === 'done') {
        return call(`/jobs/${encodeURIComponent(jobId)}/results`, {
          method: 'GET',
          timeoutMs: 30_000,
        });
      }
      if (status === 'failed' || status === 'error') {
        throw new QuantumProviderError(`IBM Quantum job ${jobId} failed`, 'ibm-quantum');
      }
      if (status === 'cancelled' || status === 'canceled') {
        throw new QuantumProviderError(`IBM Quantum job ${jobId} was cancelled`, 'ibm-quantum');
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      // Back off toward 10s: a queued job can sit for hours, and polling it
      // every second is rude to the provider and pointless to us.
      intervalMs = Math.min(intervalMs * 1.5, 10_000);
    }
  }
}

export const ibmQuantumDescriptor: QuantumProviderDescriptor = {
  id: 'ibm-quantum',
  displayName: 'IBM Quantum',
  // Metered at the provider level because paid hardware exists behind the
  // same credential. Which specific backends are free is expressed per
  // backend by `executionLevel`, where the distinction actually lives.
  metering: 'metered',
  // Its cheapest rung is a cloud simulator (1); its most expensive is paid
  // hardware (3). A deployment capped at 0 skips this provider without ever
  // opening a connection to IBM.
  minExecutionLevel: 1,
  maxExecutionLevel: 3,
  async isConfigured() {
    // `hasReal`, not `tryGet`: a generated development placeholder is not a
    // credential IBM would accept, and reporting a provider as available on
    // the strength of one produces a failure at first use instead of a clear
    // "not configured" now.
    return secretsManager.hasReal('IBM_QUANTUM_API_TOKEN', 'quantum-ibm');
  },
  async verifyCredential() {
    try {
      await call('/backends', { method: 'GET', timeoutMs: 10_000 });
      return { status: 'verified' as const, detail: 'IBM Quantum accepted the credential' };
    } catch (error) {
      if (error instanceof QuantumProviderNotConfiguredError) {
        return { status: 'rejected' as const, detail: 'no IBM Quantum token is configured' };
      }
      if (error instanceof QuantumExecutionTimeoutError) {
        // NOT `rejected`. A timeout says nothing about whether the key is
        // valid, and reporting it as a bad key sends an operator to rotate a
        // credential that was never the problem.
        return { status: 'unreachable' as const, detail: 'IBM Quantum did not respond in time' };
      }
      const message = error instanceof Error ? error.message : String(error);
      return /401|403|unauthor|forbidden/i.test(message)
        ? { status: 'rejected' as const, detail: 'IBM Quantum rejected the credential' }
        : { status: 'unreachable' as const, detail: 'IBM Quantum could not be reached' };
    }
  },
  async create() {
    return new IbmQuantumProvider();
  },
};
