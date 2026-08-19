import { getConfig } from '../config';
import { assertAiBudget, recordAiSpend } from '../ai/spend-guard';
import { logger } from '../utils/logger';
import { circuitDepth } from './circuit';
import {
  PaidQpuNotEnabledError,
  QuantumBudgetExceededError,
  QuantumCostUnknownError,
  QuantumResourceLimitError,
} from './errors';
import type { QuantumBackend, QuantumCost, QuantumExecutionRequest, QuantumExecutionResult } from './types';

/**
 * The gate between Synora and a quantum bill.
 *
 * ── WHY THIS REUSES `ai/spend-guard.ts` RATHER THAN COPYING IT ───────────
 *
 * A second spend ledger is a second thing to get wrong, a second thing to
 * reset, and — worst — a second cap that does not know about the first. A
 * deployment with a $5/day AI cap and a separate $5/day quantum cap can
 * spend $10, which is not what anybody who set either number intended.
 *
 * The existing guard already anticipated this exact case: `AiSpendRecord`
 * carries `knownCostCents` for "workloads whose economics this module cannot
 * derive from text-token tables", and documents media and embeddings as the
 * motivating examples. A quantum task is a third such workload — priced per
 * task and per shot, not per token — so it flows through the same atomic
 * counters, the same UTC windows, the same per-user Redis ceiling and the
 * same per-workspace row. One budget, one place to raise it, one number that
 * means what an operator thinks it means.
 *
 * ── THE FOUR REFUSALS, IN ORDER ──────────────────────────────────────────
 *
 *  1. Level 3 without explicit enablement. No default enables paid hardware,
 *     and no code path sets one.
 *  2. Metered execution with an UNKNOWN cost. An unknown price is not a zero
 *     price — the identical rule the text guard enforces, and the reason
 *     `QuantumCost.estimatedCents` is `number | null` rather than a number.
 *  3. Cost above the caller's own authorisation, which must be explicit for
 *     any non-zero spend. Authorising money is the caller's act.
 *  4. Cost above the deployment's per-execution ceiling.
 *
 * Only after all four does the shared daily/workspace/user budget apply.
 * Every refusal happens BEFORE submission, so a refused execution has cost
 * nothing — which is the entire difference between a spend control and a
 * spend report.
 */

/** The provider id quantum spend is recorded under in the shared ledger. */
function ledgerProviderId(providerId: string): string {
  return `quantum:${providerId}`;
}

export interface QuantumAuthorisation {
  readonly cost: QuantumCost;
  readonly chargeCents: number;
}

/**
 * Authorise — or refuse — before anything is submitted.
 *
 * Returns what will be charged, so the caller records exactly the number it
 * was authorised for rather than recomputing one that could drift.
 */
/**
 * Resource ceilings, checked before anything else and on EVERY rung.
 *
 * Deliberately applied to the free local simulator too. Money is not the only
 * thing an execution spends: 2^26 amplitudes is a gigabyte of RAM, a million
 * shots is a long CPU burn inside a request, and a 100,000-gate circuit is a
 * QPU queue slot spent producing noise. An operator who sets a shot ceiling is
 * bounding a resource, and a guard that only fired when money was involved
 * would leave the free path — the one everyone actually uses — unbounded.
 */
export function assertQuantumResourceLimits(request: QuantumExecutionRequest): void {
  const config = getConfig().quantum;

  if (request.shots > config.maxShots) {
    throw new QuantumResourceLimitError('shots', request.shots, config.maxShots, 'QUANTUM_MAX_SHOTS');
  }
  if (request.circuit.qubits > config.maxQubits) {
    throw new QuantumResourceLimitError(
      'qubits',
      request.circuit.qubits,
      config.maxQubits,
      'QUANTUM_MAX_QUBITS'
    );
  }
  const depth = circuitDepth(request.circuit);
  if (depth > config.maxCircuitDepth) {
    throw new QuantumResourceLimitError(
      'circuit-depth',
      depth,
      config.maxCircuitDepth,
      'QUANTUM_MAX_CIRCUIT_DEPTH'
    );
  }
  if (request.timeoutMs > config.maxRuntimeMs) {
    throw new QuantumResourceLimitError(
      'runtime',
      request.timeoutMs,
      config.maxRuntimeMs,
      'QUANTUM_MAX_RUNTIME_MS'
    );
  }
}

export async function authoriseQuantumExecution(
  backend: QuantumBackend,
  cost: QuantumCost,
  request: QuantumExecutionRequest
): Promise<QuantumAuthorisation> {
  const config = getConfig().quantum;

  // Resources first. A request that is too large is refused whether or not
  // anybody would have billed for it.
  assertQuantumResourceLimits(request);

  // 1 ── Paid hardware needs a human decision, once, explicitly.
  if (backend.executionLevel === 3 && !config.paidQpuEnabled) {
    throw new PaidQpuNotEnabledError(backend.id);
  }

  // An unmetered backend (the local simulator) short-circuits everything
  // below EXCEPT the shared daily budget: free compute is still compute, and
  // an unbounded loop of free simulations is a resource problem even when it
  // is not a money problem. The token/cost ledger records it at zero.
  if (backend.metering === 'unmetered') {
    await assertAiBudget({ workspaceId: request.workspaceId, userId: request.userId });
    return { cost, chargeCents: 0 };
  }

  // 2 ── Unknown is not free.
  if (!cost.known || cost.estimatedCents === null) {
    throw new QuantumCostUnknownError(backend.id, cost.detail);
  }

  const cents = Math.max(0, Math.ceil(cost.estimatedCents));

  // 3 ── Any non-zero spend requires the caller to have said a number.
  if (cents > 0) {
    if (request.budgetCents === undefined) {
      throw new QuantumBudgetExceededError(cents, 0, 'request');
    }
    if (cents > request.budgetCents) {
      throw new QuantumBudgetExceededError(cents, request.budgetCents, 'request');
    }
    // 4 ── And the deployment's own ceiling, which defaults to zero.
    if (cents > config.maxCostPerExecutionCents) {
      throw new QuantumBudgetExceededError(cents, config.maxCostPerExecutionCents, 'deployment');
    }
  }

  await assertAiBudget({ workspaceId: request.workspaceId, userId: request.userId });
  return { cost, chargeCents: cents };
}

/**
 * Charge what was authorised, after the execution happened.
 *
 * Never throws — `recordAiSpend` is best-effort by contract, for the same
 * reason it is on the text path: the money is spent either way, and an
 * exception here would invite a retry that spends it again.
 *
 * `knownCostCents` is passed even when zero. Zero is a legitimate, DECLARED
 * price (the local simulator's), and it is distinct from absent — absent
 * would make the shared guard fall back to text-token pricing and charge a
 * frontier-model rate for a statevector simulation.
 */
export async function recordQuantumSpend(
  // Deliberately NARROWER than `QuantumExecutionResult`: a failed execution
  // must still be charged (a timeout may bill anyway), and there is no result
  // to pass. Widening this to the full type and casting an incomplete object
  // into it at the call site would be a type lie for the convenience of one
  // signature.
  result: Pick<QuantumExecutionResult, 'executionId' | 'providerId' | 'backendId'>,
  authorisation: QuantumAuthorisation,
  scope: { workspaceId?: string; userId?: string }
): Promise<void> {
  try {
    await recordAiSpend({
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      provider: ledgerProviderId(result.providerId),
      model: result.backendId,
      knownCostCents: authorisation.chargeCents,
    });
  } catch (error) {
    logger.error('[Quantum] spend not recorded — the ledger is behind by one execution', {
      executionId: result.executionId,
      providerId: result.providerId,
      backendId: result.backendId,
      chargeCents: authorisation.chargeCents,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * A pre-flight answer for callers that want to show a cost before running,
 * without the side effect of authorising it.
 *
 * Separate from `authoriseQuantumExecution` on purpose: a UI asking "what
 * would this cost?" must not consume budget, and a function that both
 * answers and authorises would eventually be called for the former reason.
 */
export function describeQuantumCost(backend: QuantumBackend, cost: QuantumCost): string {
  if (backend.metering === 'unmetered') return 'free — runs on infrastructure this deployment owns';
  if (!cost.known || cost.estimatedCents === null) return `unknown — ${cost.detail}`;
  if (cost.estimatedCents === 0) return `free at the point of use — ${cost.detail}`;
  return `approximately ${cost.estimatedCents} cent(s) — ${cost.detail}`;
}
