import type { CredentialVerification } from '../ai/types/descriptor';
import type { QuantumExecutionLevel, QuantumProvider } from './types';

/**
 * What a quantum provider module publishes about itself.
 *
 * Deliberately the same shape as `../ai/types/descriptor.ts` and
 * `../embeddings/descriptor.ts`, down to reusing their `CredentialVerification`
 * type rather than declaring a fourth one. Synora already decided that
 * "is this credential good?" has four answers and not two — `verified`,
 * `rejected`, `unreachable`, `not-verifiable` — and a quantum credential is
 * not a special case. One contract, used everywhere, is also what lets a
 * single operator-facing readiness view describe text providers, embedding
 * providers and quantum backends without three code paths.
 *
 * `unsupportedReason` follows the embeddings precedent exactly: a provider
 * that structurally cannot run in this build (an unshipped vendor client) is
 * skipped during auto-selection but answers honestly — with THIS reason —
 * when a caller names it. Reporting "not configured" for a provider no
 * credential could have fixed sends someone hunting for the wrong thing.
 */
export interface QuantumProviderDescriptor {
  readonly id: string;
  readonly displayName: string;
  /**
   * Set only when this build cannot run the provider at all, regardless of
   * credentials. Distinct from merely being unconfigured.
   */
  readonly unsupportedReason?: string;
  /**
   * Whether execution on this provider costs money. DECLARED, never inferred
   * from the absence of a price entry — the identical rule, and the identical
   * reasoning, as `AIProviderDescriptor.metering`: "free" and "unpriced" look
   * the same to arithmetic and are opposites to a bill.
   *
   * A provider offering both a free tier and paid hardware declares
   * `metered`; the free rung is expressed by its backends' individual
   * `executionLevel` and `pricing`, which is where the distinction actually
   * lives.
   */
  readonly metering: 'metered' | 'unmetered';
  /**
   * The rungs this provider's backends span.
   *
   * Both are declared rather than discovered because discovery costs a
   * network round-trip, and the whole point is to NOT make one. A deployment
   * capped at level 0 must never call a QPU vendor merely to find out that
   * everything it offers is too expensive — `minExecutionLevel` is what lets
   * the resolver skip it without asking.
   */
  readonly minExecutionLevel: QuantumExecutionLevel;
  readonly maxExecutionLevel: QuantumExecutionLevel;
  /**
   * Cheap, no-network check: are this provider's required secrets/config
   * present? Runs on every resolution, so it must stay network-free.
   */
  isConfigured(): Promise<boolean>;
  /**
   * Optional cheapest possible AUTHENTICATED call. Optional so a provider
   * without one reports `not-verifiable` honestly instead of faking a pass.
   */
  verifyCredential?(): Promise<CredentialVerification>;
  /** Construct a working provider. Only called after `isConfigured()` is true. */
  create(): Promise<QuantumProvider>;
}

export type { CredentialVerification };
