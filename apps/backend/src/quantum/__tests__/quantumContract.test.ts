import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The spend ledger is mocked at the module boundary so these tests exercise
// the QUANTUM gate's own logic without a database. What is being tested here
// is that the gate refuses/permits correctly and that it delegates to the
// SHARED ledger — not that Postgres works, which spend-guard's own tests
// already cover.
vi.mock('../../ai/spend-guard', () => ({
  assertAiBudget: vi.fn(async () => undefined),
  recordAiSpend: vi.fn(async () => ({ tokens: 0, costCents: 0, estimated: false, unpricedModel: false })),
}));

import { assertAiBudget, recordAiSpend } from '../../ai/spend-guard';
import { __resetConfigForTests, initConfig } from '../../config';
import { logger } from '../../utils/logger';
import { CircuitBuilder } from '../circuit';
import type { QuantumProviderDescriptor } from '../descriptor';
import {
  NoQuantumBackendAvailableError,
  PaidQpuNotEnabledError,
  QuantumBudgetExceededError,
  QuantumCostUnknownError,
  QuantumProviderNotConfiguredError,
  QuantumResourceLimitError,
  QuantumProviderUnsupportedError,
  UnknownQuantumAlgorithmError,
  UnknownQuantumBackendError,
} from '../errors';
import { executeQuantumCircuit } from '../execution';
import { QUANTUM_PROVIDER_REGISTRY } from '../registry';
import { describeQuantumProviders, resolveQuantumBackend } from '../resolver';
import { requireExecutableAlgorithm } from '../algorithms/registry';
import { ibmQuantumDescriptor } from '../providers/ibmQuantum.provider';
import type {
  QuantumBackend,
  QuantumCost,
  QuantumExecutionRequest,
  QuantumExecutionResult,
  QuantumProvider,
} from '../types';

/**
 * ARCHITECTURAL TEST — the quantum twin of `../../ai/__tests__/providerContract.test.ts`.
 *
 * The claim under test is not "the local simulator works" (its own test file
 * proves that against known quantum states). It is that a quantum backend
 * Synora has never seen — specifically a FUTURE SYNORA-OWNED quantum
 * backend — can satisfy the same contract and be routed to, budgeted, and
 * have its results consumed, with NO change to resolution, cost control,
 * provenance, validation or any caller.
 *
 * So this file implements a quantum provider from scratch using only the
 * exported contract, and drives it through the same surfaces the real ones
 * use. If it ever needs a change in application code to pass, the
 * abstraction boundary has leaked and the architecture — not the test — is
 * what broke.
 *
 * No network. Nothing here calls an external API or a real QPU.
 */

/* ── The hypothetical future provider ─────────────────────────────────── */

const SYNORA_QPU: QuantumBackend = {
  id: 'synora-q1',
  providerId: 'synora-quantum',
  displayName: 'Synora Q1 (hypothetical)',
  kind: 'qpu',
  executionLevel: 3,
  maxQubits: 64,
  maxShots: 20_000,
  capabilities: ['circuit-execution', 'parameterised-circuits'],
  nativeGates: ['h', 'rz', 'cx'],
  metering: 'metered',
  pricing: { perTaskCents: 50, perShotMicroCents: 100, source: 'hypothetical price list' },
  simulated: false,
};

const SYNORA_SIM: QuantumBackend = {
  ...SYNORA_QPU,
  id: 'synora-q1-sim',
  displayName: 'Synora Q1 cloud simulator (hypothetical)',
  kind: 'cloud-simulator',
  executionLevel: 1,
  metering: 'unmetered',
  pricing: { perTaskCents: 0, perShotMicroCents: 0, source: 'included' },
  simulated: true,
};

/** Priced backend whose price this deployment cannot determine. */
const UNPRICED_QPU: QuantumBackend = { ...SYNORA_QPU, id: 'synora-q2', pricing: undefined };

class SynoraQuantumProvider implements QuantumProvider {
  readonly id = 'synora-quantum';

  constructor(private readonly backends: readonly QuantumBackend[] = [SYNORA_SIM, SYNORA_QPU]) {}

  async listBackends(): Promise<readonly QuantumBackend[]> {
    return this.backends;
  }

  estimateCost(backend: QuantumBackend, request: QuantumExecutionRequest): QuantumCost {
    if (!backend.pricing) {
      return { known: false, estimatedCents: null, basis: 'unknown', detail: 'no declared price' };
    }
    const cents =
      backend.pricing.perTaskCents + (backend.pricing.perShotMicroCents * request.shots) / 10_000;
    return {
      known: true,
      estimatedCents: Math.ceil(cents),
      basis: 'declared-price-table',
      detail: `${request.shots} shots on ${backend.id}`,
    };
  }

  async execute(
    backend: QuantumBackend,
    request: QuantumExecutionRequest
  ): Promise<QuantumExecutionResult> {
    return {
      executionId: request.executionId,
      providerId: this.id,
      backendId: backend.id,
      backendKind: backend.kind,
      executionLevel: backend.executionLevel,
      shots: request.shots,
      counts: { '00': request.shots },
      durationMs: 1,
      cost: this.estimateCost(backend, request),
      provenance: {
        producedBy: backend.simulated ? 'simulator' : 'quantum-hardware',
        simulated: backend.simulated,
        noiseModelApplied: !backend.simulated,
        submittedAt: '2026-08-11T00:00:00.000Z',
        providerJobId: 'job-1',
        circuitHash: 'deadbeef',
        evidenceClass: 'computational-evidence',
      },
      warnings: [],
    };
  }
}

function descriptorFor(
  overrides: Partial<QuantumProviderDescriptor> = {},
  backends?: readonly QuantumBackend[]
): QuantumProviderDescriptor {
  return {
    id: 'synora-quantum',
    displayName: 'Synora Quantum (hypothetical)',
    metering: 'metered',
    minExecutionLevel: 1,
    maxExecutionLevel: 3,
    async isConfigured() {
      return true;
    },
    async create() {
      return new SynoraQuantumProvider(backends);
    },
    ...overrides,
  };
}

function bellCircuit() {
  return new CircuitBuilder('bell', 2).h(0).cx(0, 1).measureAll().build();
}

function requestFor(overrides: Partial<QuantumExecutionRequest> = {}): QuantumExecutionRequest {
  return {
    circuit: bellCircuit(),
    shots: 100,
    timeoutMs: 5_000,
    executionId: 'exec-test-1',
    ...overrides,
  };
}

/* ── Config harness ───────────────────────────────────────────────────── */

const ENV_KEYS = [
  'QUANTUM_MAX_EXECUTION_LEVEL',
  'QUANTUM_PAID_QPU_ENABLED',
  'QUANTUM_MAX_COST_PER_EXECUTION_CENTS',
  'QUANTUM_MAX_SHOTS',
  'QUANTUM_MAX_CIRCUIT_DEPTH',
  'QUANTUM_MAX_QUBITS',
  'QUANTUM_MAX_RUNTIME_MS',
  'QUANTUM_LOCAL_MAX_QUBITS',
  'IBM_QUANTUM_API_TOKEN',
  'IBM_QUANTUM_BASE_URL',
] as const;

let saved: Record<string, string | undefined> = {};

async function configure(env: Partial<Record<(typeof ENV_KEYS)[number], string>>): Promise<void> {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  __resetConfigForTests();
  await initConfig();
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  vi.clearAllMocks();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  __resetConfigForTests();
  vi.restoreAllMocks();
});

/* ═══════════════════════════════════════════════════════════════════════ *
 * 1, 14 — registration, and a provider Synora has never seen
 * ═══════════════════════════════════════════════════════════════════════ */

describe('a quantum provider Synora has never seen can satisfy the contract', () => {
  it('registers and resolves through the ordinary path with no application change', async () => {
    await configure({ QUANTUM_MAX_EXECUTION_LEVEL: '1' });

    const target = await resolveQuantumBackend(requestFor(), [descriptorFor()]);

    expect(target.descriptor.id).toBe('synora-quantum');
    expect(target.backend.id).toBe('synora-q1-sim');
    // Cheapest rung under the ceiling, not the first one listed.
    expect(target.backend.executionLevel).toBe(1);
  });

  it('produces a result whose shape every consumer already understands', async () => {
    await configure({ QUANTUM_MAX_EXECUTION_LEVEL: '1' });

    const result = await executeQuantumCircuit(requestFor(), [descriptorFor()]);

    expect(result).toMatchObject({
      providerId: 'synora-quantum',
      backendId: 'synora-q1-sim',
      shots: 100,
    });
    expect(Object.values(result.counts).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('the whole layer imports no quantum vendor package anywhere', () => {
    // The strongest form of "business logic has no vendor dependency": there
    // is no quantum vendor dependency at all, in any layer. Qiskit is Python
    // and Braket is unshipped; the contract is what makes that survivable.
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    const all = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

    expect(all.filter((d) => /qiskit|braket|pennylane|cirq|quantum/i.test(d))).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════ *
 * 2, 3 — disabling, and clear failure on a missing credential
 * ═══════════════════════════════════════════════════════════════════════ */

describe('a provider can be disabled, and says so precisely', () => {
  it('an unconfigured provider is skipped during auto-selection', async () => {
    await configure({ QUANTUM_MAX_EXECUTION_LEVEL: '1' });

    const disabled = descriptorFor({ isConfigured: async () => false });
    await expect(resolveQuantumBackend(requestFor(), [disabled])).rejects.toBeInstanceOf(
      NoQuantumBackendAvailableError
    );
  });

  it('naming an unconfigured provider explicitly is a specific error, never a silent fallback', async () => {
    await configure({ QUANTUM_MAX_EXECUTION_LEVEL: '1' });

    const error = await resolveQuantumBackend(requestFor({ providerId: 'synora-quantum' }), [
      descriptorFor({ isConfigured: async () => false }),
    ]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(QuantumProviderNotConfiguredError);
    expect((error as Error).message).toContain('synora-quantum');
    expect((error as Error).message).toMatch(/credential|configuration/i);
  });

  it('an unsupported provider answers UNSUPPORTED, not "not configured"', async () => {
    // The distinction matters: no credential would have helped, and sending
    // an operator to find one is worse than telling them the truth.
    await configure({ QUANTUM_MAX_EXECUTION_LEVEL: '3' });

    const error = await resolveQuantumBackend(requestFor({ providerId: 'aws-braket' })).catch(
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(QuantumProviderUnsupportedError);
    expect((error as Error).message).toMatch(/not a dependency of this build/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════ *
 * 4 — no credential is logged
 * ═══════════════════════════════════════════════════════════════════════ */

describe('credentials never appear in output', () => {
  const TOKEN = 'ibm-secret-token-value-that-must-never-be-printed';

  it('a failed IBM verification reports status without the token, and logs none of it', async () => {
    // `.invalid` never resolves, so the SSRF guard refuses before any socket
    // is opened. No network access, and the error path is the real one.
    await configure({
      IBM_QUANTUM_API_TOKEN: TOKEN,
      IBM_QUANTUM_BASE_URL: 'https://quantum-does-not-exist.invalid/api/v1',
    });

    const calls: string[] = [];
    for (const level of ['info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(logger, level).mockImplementation(((message: unknown, meta?: unknown) => {
        calls.push(`${String(message)} ${JSON.stringify(meta ?? {})}`);
        return logger;
      }) as never);
    }

    const verification = await ibmQuantumDescriptor.verifyCredential!();

    // Unreachable, NOT rejected: a DNS failure says nothing about the key.
    expect(verification.status).toBe('unreachable');
    expect(verification.detail).not.toContain(TOKEN);
    expect(calls.join('\n')).not.toContain(TOKEN);
  });

  it('the operator-facing status view carries no secret material at all', async () => {
    await configure({ IBM_QUANTUM_API_TOKEN: TOKEN, QUANTUM_MAX_EXECUTION_LEVEL: '0' });

    const statuses = await describeQuantumProviders();
    const serialised = JSON.stringify(statuses);

    expect(serialised).not.toContain(TOKEN);
    // Status only — exactly the shape the AI provider matrix uses.
    expect(statuses.map((s) => s.id)).toContain('local-simulator');
    for (const status of statuses) {
      expect(Object.keys(status).sort()).not.toContain('token');
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════ *
 * 5 — the local simulator needs nothing
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the local simulator works with no cloud credentials', () => {
  it('executes through the full public path at the default ceiling of 0', async () => {
    // Deliberately configured with NOTHING. This is the out-of-the-box state.
    await configure({});

    const result = await executeQuantumCircuit(requestFor({ shots: 512, seed: 7 }));

    expect(result.providerId).toBe('local-simulator');
    expect(result.executionLevel).toBe(0);
    expect(result.cost.estimatedCents).toBe(0);
    // A Bell state collapses to 00 or 11 only — never 01 or 10.
    expect(Object.keys(result.counts).sort()).toEqual(['00', '11']);
  });

  it('never reaches for a cloud provider when the ceiling is 0', async () => {
    await configure({ IBM_QUANTUM_API_TOKEN: 'would-be-used-if-the-ceiling-allowed-it' });

    const target = await resolveQuantumBackend(requestFor());
    expect(target.descriptor.id).toBe('local-simulator');
    // IBM's cheapest rung is 1, so it is excluded before any network call.
    expect(QUANTUM_PROVIDER_REGISTRY.find((p) => p.id === 'ibm-quantum')?.minExecutionLevel).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════ *
 * 6, 7 — unknown backend and unknown algorithm fail safely
 * ═══════════════════════════════════════════════════════════════════════ */

describe('unknown things fail safely', () => {
  it('an unknown backend id lists what exists instead of guessing', async () => {
    await configure({ QUANTUM_MAX_EXECUTION_LEVEL: '1' });

    const error = await resolveQuantumBackend(
      requestFor({ providerId: 'synora-quantum', backendId: 'no-such-backend' }),
      [descriptorFor()]
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnknownQuantumBackendError);
    expect((error as Error).message).toContain('synora-q1');
  });

  it('an unknown algorithm id lists the registry instead of returning a number', () => {
    expect(() => requireExecutableAlgorithm('no-such-algorithm')).toThrow(
      UnknownQuantumAlgorithmError
    );
  });

  it('a registered-but-unimplemented algorithm refuses rather than fabricating a result', () => {
    // The single most important refusal in the algorithm registry.
    expect(() => requireExecutableAlgorithm('qnn')).toThrow(/no executable implementation/i);
    expect(() => requireExecutableAlgorithm('qnn')).toThrow(/no result was fabricated/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════ *
 * 8, 9 — paid hardware and budget
 * ═══════════════════════════════════════════════════════════════════════ */

describe('money gates', () => {
  it('paid QPU execution is refused without explicit enablement, even at ceiling 3', async () => {
    await configure({ QUANTUM_MAX_EXECUTION_LEVEL: '3' });

    await expect(
      executeQuantumCircuit(
        requestFor({ providerId: 'synora-quantum', backendId: 'synora-q1', budgetCents: 100_000 }),
        [descriptorFor()]
      )
    ).rejects.toBeInstanceOf(PaidQpuNotEnabledError);

    // Nothing was submitted, so nothing was charged.
    expect(recordAiSpend).not.toHaveBeenCalled();
  });

  it('an enabled paid QPU still refuses a cost above the caller\'s authorisation', async () => {
    await configure({
      QUANTUM_MAX_EXECUTION_LEVEL: '3',
      QUANTUM_PAID_QPU_ENABLED: 'true',
      QUANTUM_MAX_COST_PER_EXECUTION_CENTS: '100000',
    });

    // 50c per task + 100 microcents × 1000 shots = 50 + 10 = 60 cents.
    const error = await executeQuantumCircuit(
      requestFor({
        providerId: 'synora-quantum',
        backendId: 'synora-q1',
        shots: 1000,
        budgetCents: 10,
      }),
      [descriptorFor()]
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(QuantumBudgetExceededError);
    expect((error as QuantumBudgetExceededError).scope).toBe('request');
    expect(recordAiSpend).not.toHaveBeenCalled();
  });

  it('refuses when the caller authorised no budget at all', async () => {
    await configure({
      QUANTUM_MAX_EXECUTION_LEVEL: '3',
      QUANTUM_PAID_QPU_ENABLED: 'true',
      QUANTUM_MAX_COST_PER_EXECUTION_CENTS: '100000',
    });

    await expect(
      executeQuantumCircuit(
        requestFor({ providerId: 'synora-quantum', backendId: 'synora-q1', shots: 1000 }),
        [descriptorFor()]
      )
    ).rejects.toBeInstanceOf(QuantumBudgetExceededError);
  });

  it('refuses the deployment ceiling independently of the caller\'s', async () => {
    await configure({
      QUANTUM_MAX_EXECUTION_LEVEL: '3',
      QUANTUM_PAID_QPU_ENABLED: 'true',
      QUANTUM_MAX_COST_PER_EXECUTION_CENTS: '5',
    });

    const error = await executeQuantumCircuit(
      requestFor({
        providerId: 'synora-quantum',
        backendId: 'synora-q1',
        shots: 1000,
        budgetCents: 100_000,
      }),
      [descriptorFor()]
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(QuantumBudgetExceededError);
    expect((error as QuantumBudgetExceededError).scope).toBe('deployment');
  });

  it('UNKNOWN cost is refused, never charged as zero', async () => {
    await configure({
      QUANTUM_MAX_EXECUTION_LEVEL: '3',
      QUANTUM_PAID_QPU_ENABLED: 'true',
      QUANTUM_MAX_COST_PER_EXECUTION_CENTS: '100000',
    });

    const error = await executeQuantumCircuit(
      requestFor({
        providerId: 'synora-quantum',
        backendId: 'synora-q2',
        budgetCents: 100_000,
      }),
      [descriptorFor({}, [UNPRICED_QPU])]
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(QuantumCostUnknownError);
    expect((error as Error).message).toContain('not a zero price');
  });

  it('an authorised execution charges the SHARED ledger, not a second one', async () => {
    await configure({
      QUANTUM_MAX_EXECUTION_LEVEL: '3',
      QUANTUM_PAID_QPU_ENABLED: 'true',
      QUANTUM_MAX_COST_PER_EXECUTION_CENTS: '100000',
    });

    await executeQuantumCircuit(
      requestFor({
        providerId: 'synora-quantum',
        backendId: 'synora-q1',
        shots: 1000,
        budgetCents: 100_000,
        workspaceId: 'ws-1',
      }),
      [descriptorFor()]
    );

    expect(assertAiBudget).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1' })
    );
    // knownCostCents, so the text price table is never consulted for a
    // workload it cannot price.
    expect(recordAiSpend).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'quantum:synora-quantum',
        model: 'synora-q1',
        knownCostCents: 60,
      })
    );
  });

  it('free local execution still passes through the shared daily budget', async () => {
    await configure({});
    await executeQuantumCircuit(requestFor({ workspaceId: 'ws-2' }));

    expect(assertAiBudget).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-2' }));
    expect(recordAiSpend).toHaveBeenCalledWith(
      expect.objectContaining({ knownCostCents: 0 })
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════ *
 * RESOURCE GOVERNANCE — bounded whether or not anybody bills for it
 * ═══════════════════════════════════════════════════════════════════════ */

describe('resource ceilings apply on every rung, including the free one', () => {
  it('refuses too many shots on the FREE local simulator', async () => {
    // The important case: no money is involved, and a million shots is still
    // a long CPU burn inside a request. A guard that only fired on metered
    // backends would leave the path everyone actually uses unbounded.
    await configure({ QUANTUM_MAX_SHOTS: '1000' });

    const error = await executeQuantumCircuit(requestFor({ shots: 5000 })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QuantumResourceLimitError);
    expect((error as QuantumResourceLimitError).resource).toBe('shots');
    expect((error as Error).message).toContain('QUANTUM_MAX_SHOTS');
  });

  it('refuses a circuit deeper than the configured ceiling', async () => {
    await configure({ QUANTUM_MAX_CIRCUIT_DEPTH: '3' });

    const deep = new CircuitBuilder('deep', 1).h(0).x(0).h(0).x(0).h(0).measureAll().build();
    await expect(executeQuantumCircuit(requestFor({ circuit: deep }))).rejects.toBeInstanceOf(
      QuantumResourceLimitError
    );
  });

  it('refuses more qubits than the deployment allows, before any allocation', async () => {
    await configure({ QUANTUM_MAX_QUBITS: '1' });
    await expect(executeQuantumCircuit(requestFor())).rejects.toThrow(/QUANTUM_MAX_QUBITS/);
  });

  it('refuses a timeout longer than the deployment allows', async () => {
    await configure({ QUANTUM_MAX_RUNTIME_MS: '1000' });
    await expect(executeQuantumCircuit(requestFor({ timeoutMs: 60_000 }))).rejects.toThrow(
      /QUANTUM_MAX_RUNTIME_MS/
    );
  });

  it('a resource refusal is NOT a budget refusal — they name different remedies', async () => {
    await configure({ QUANTUM_MAX_SHOTS: '10' });
    const error = await executeQuantumCircuit(requestFor({ shots: 100 })).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(QuantumResourceLimitError);
    expect(error).not.toBeInstanceOf(QuantumBudgetExceededError);
    // Nothing ran, so nothing was charged.
    expect(recordAiSpend).not.toHaveBeenCalled();
  });

  it('the defaults let an ordinary request through untouched', async () => {
    await configure({});
    const result = await executeQuantumCircuit(requestFor({ shots: 1024 }));
    expect(result.shots).toBe(1024);
  });
});

/* ═══════════════════════════════════════════════════════════════════════ *
 * 11 — provenance
 * ═══════════════════════════════════════════════════════════════════════ */

describe('every result is provenance-tagged', () => {
  it('the local simulator marks itself a simulator and records a reproducible seed', async () => {
    await configure({});
    const result = await executeQuantumCircuit(requestFor({ seed: 42 }));

    expect(result.provenance).toMatchObject({
      producedBy: 'simulator',
      simulated: true,
      noiseModelApplied: false,
      seed: 42,
      evidenceClass: 'computational-evidence',
    });
    expect(result.provenance.circuitHash).toHaveLength(32);
  });

  it('hardware is marked hardware, and carries the vendor job id', async () => {
    await configure({
      QUANTUM_MAX_EXECUTION_LEVEL: '3',
      QUANTUM_PAID_QPU_ENABLED: 'true',
      QUANTUM_MAX_COST_PER_EXECUTION_CENTS: '100000',
    });

    const result = await executeQuantumCircuit(
      requestFor({
        providerId: 'synora-quantum',
        backendId: 'synora-q1',
        budgetCents: 100_000,
      }),
      [descriptorFor()]
    );

    expect(result.provenance.producedBy).toBe('quantum-hardware');
    expect(result.provenance.simulated).toBe(false);
    expect(result.provenance.providerJobId).toBe('job-1');
  });

  it('the same circuit and seed reproduce the same counts exactly', async () => {
    await configure({});
    const a = await executeQuantumCircuit(requestFor({ seed: 99, shots: 400 }));
    const b = await executeQuantumCircuit(requestFor({ seed: 99, shots: 400 }));
    expect(a.counts).toEqual(b.counts);
  });
});

/* ═══════════════════════════════════════════════════════════════════════ *
 * 13 — no vendor coupling inside the layer
 * ═══════════════════════════════════════════════════════════════════════ */

describe('vendor isolation inside the quantum layer', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
    });
  }

  it('nothing outside ./providers/ names a vendor, an endpoint or a credential', () => {
    const root = resolve(process.cwd(), 'src/quantum');
    const offenders: string[] = [];

    for (const file of walk(root)) {
      const relative = file.slice(root.length + 1).replace(/\\/g, '/');
      if (relative.startsWith('providers/') || relative.startsWith('__tests__/')) continue;
      // registry.ts is the composition root — the one file whose JOB is to
      // name the provider modules, exactly as `ai/registry.ts` names
      // anthropic and openai. It is checked by its own assertion below,
      // which is stricter: it may name MODULES and never PACKAGES.
      if (relative === 'registry.ts') continue;

      const text = readFileSync(file, 'utf8');
      // Comments legitimately DISCUSS vendors — the whole design rationale is
      // about them. Only executable lines are judged.
      const code = text
        .split(/\r?\n/)
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');

      if (/\b(IBM_QUANTUM_API_TOKEN|AWS_ACCESS_KEY|api\.quantum|braket|qiskit)\b/i.test(code)) {
        offenders.push(relative);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the registry names provider MODULES and never a package', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/quantum/registry.ts'), 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

    // Every import is a relative path inside this layer. A bare package
    // specifier here would be a vendor SDK entering through the front door.
    expect(imports.every((i) => i.startsWith('./') || i.startsWith('../'))).toBe(true);
    expect(imports.filter((i) => i.includes('providers/')).length).toBeGreaterThan(0);
  });

  it('the config layer holds vendor ENDPOINTS but no vendor CLIENT', () => {
    // An operator-configurable base URL is configuration; an SDK import is
    // coupling. This test pins which of the two the config layer contains.
    const loader = readFileSync(resolve(process.cwd(), 'src/config/configLoader.ts'), 'utf8');
    expect(loader).toContain('IBM_QUANTUM_BASE_URL');
    expect(loader).not.toMatch(/from ['"](qiskit|@aws-sdk\/client-braket)['"]/);
  });
});
