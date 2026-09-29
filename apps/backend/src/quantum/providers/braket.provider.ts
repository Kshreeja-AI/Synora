import type { QuantumProviderDescriptor } from '../descriptor';
import { QuantumProviderUnsupportedError } from '../errors';
import type { QuantumProvider } from '../types';

/**
 * Amazon Braket — LEVELS 1 and 3.
 *
 * ── STATUS, STATED FIRST ─────────────────────────────────────────────────
 *
 * SCAFFOLDED. Not implemented, not enabled, and it does not pretend to be.
 * The descriptor exists, it satisfies the same `QuantumProviderDescriptor`
 * contract as every other provider, and `create()` throws a specific error
 * naming exactly what is missing. Nothing here fabricates a device list, a
 * price, or a result.
 *
 * ── WHY IT STOPS HERE ────────────────────────────────────────────────────
 *
 * Braket's API is AWS-signed (SigV4). Talking to it correctly means either
 * adding `@aws-sdk/client-braket` — a dependency this build has no verified
 * use for, in an image about to be deployed — or hand-rolling request
 * signing, which is the kind of security-relevant code that must never be
 * written speculatively for a capability nobody has asked to run.
 *
 * So the honest state is: the seam is cut, the contract is proven by the
 * architecture tests to accept a provider it has never seen, and the vendor
 * work waits for a decision that costs money. `unsupportedReason` is set,
 * which means the resolver SKIPS this provider during auto-selection and
 * says this — rather than "not configured" — if a caller names it. Sending
 * an operator to hunt for AWS credentials that would not have helped is a
 * worse outcome than telling them the truth.
 *
 * ── WHAT ENABLING IT REQUIRES, PRECISELY ─────────────────────────────────
 *
 *  1. `pnpm --filter @synora/backend add @aws-sdk/client-braket`
 *  2. A `BraketProvider implements QuantumProvider` in this file whose
 *     `listBackends()` calls `SearchDevices`, mapping each device ARN to a
 *     `QuantumBackend` — simulators at level 1, QPUs at level 3.
 *  3. `execute()` submits `CreateQuantumTask` with the OpenQASM 3 that
 *     `../qasm.ts` already emits (Braket accepts it as an action source),
 *     polls `GetQuantumTask`, and reverses bit order on the way out, exactly
 *     as `./ibmQuantum.provider.ts` documents for IBM.
 *  4. Prices: Braket publishes per-task and per-shot rates that vary by
 *     device and change over time. They must be entered as declared
 *     `QuantumPricing`, from the live pricing page, at the time of
 *     enablement. Until then every Braket backend's cost is UNKNOWN, and
 *     `../budget.ts` refuses to authorise an unknown metered cost — which is
 *     the correct behaviour, not a gap to be worked around by guessing.
 *  5. Removing `unsupportedReason` below is the last step, not the first.
 *
 * None of that is difficult. All of it spends money the moment it works,
 * which is why it is a founder decision and not an implementation detail.
 */

export const braketDescriptor: QuantumProviderDescriptor = {
  id: 'aws-braket',
  displayName: 'Amazon Braket',
  unsupportedReason:
    'the Braket client (@aws-sdk/client-braket) is not a dependency of this build, and ' +
    'Braket requires AWS SigV4 request signing. The adapter is scaffolded behind the ' +
    'standard provider contract; enabling it is a deliberate, cost-bearing decision — ' +
    'see the header of quantum/providers/braket.provider.ts for the exact steps.',
  // Metered: Braket bills per task and per shot on every rung except the
  // free tier's monthly simulator allowance, which is an account property
  // this code cannot see and therefore must not assume.
  metering: 'metered',
  minExecutionLevel: 1,
  maxExecutionLevel: 3,
  async isConfigured() {
    // False unconditionally, and NOT because credentials are absent. A
    // provider that cannot run must never report itself configured — the
    // resolver would select it and the failure would surface as a runtime
    // exception on a path a user was waiting on.
    return false;
  },
  async verifyCredential() {
    return {
      status: 'not-verifiable' as const,
      detail: 'no Braket client is present in this build, so no credential can be exercised',
    };
  },
  async create(): Promise<QuantumProvider> {
    throw new QuantumProviderUnsupportedError(
      'aws-braket',
      'no Braket client is present in this build. Nothing was submitted and no result was fabricated.'
    );
  },
};
