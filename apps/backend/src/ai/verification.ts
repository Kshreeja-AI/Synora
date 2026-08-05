import { PROVIDER_REGISTRY } from './registry';
import type { AIProviderDescriptor, CredentialVerification } from './types/descriptor';

/**
 * "Is this key actually good?" — as distinct from "is a key present?".
 *
 * WHY THIS EXISTS. Every provider descriptor's `isConfigured()` answers
 * only whether a secret is SET. It has to: it runs on the resolution path
 * of every request, so it must stay free and side-effect-free. The
 * consequence is that an expired, revoked, typo'd or wrong-project key
 * reports "configured", gets selected, and fails in front of an end user
 * mid-request — the first person to learn the key is bad is a customer,
 * not an operator.
 *
 * `verifyCredential()` closes that gap by making the cheapest possible
 * authenticated call at SETUP time. The two checks are deliberately kept
 * separate rather than merged: presence is free and belongs on every
 * request, validity costs a network round trip and belongs where a human
 * is waiting for the answer.
 *
 * FOUR OUTCOMES, NEVER COLLAPSED. `unreachable` is not `rejected`: a
 * network blip reported as a bad credential sends someone hunting a
 * problem that does not exist, and a bad credential reported as a network
 * blip gets ignored until it breaks production. `not-verifiable` is an
 * honest admission for providers with no cheap check — better than
 * implying a passing grade nobody earned.
 */

export interface ProviderReadinessRow {
  id: string;
  displayName: string;
  capabilities: readonly string[];
  /** A secret is present. Says nothing about whether it works. */
  configured: boolean;
  /**
   * Absent when the provider is not configured — there is nothing to
   * verify, and reporting a verification result for a provider with no
   * key would be inventing an answer.
   */
  verification?: CredentialVerification;
}

/** Network/timeout failures must never be reported as a bad credential. */
function classifyFailure(error: unknown): CredentialVerification {
  const message = error instanceof Error ? error.message : String(error);
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? (error as { status?: unknown }).status
      : undefined;

  if (status === 401 || status === 403) {
    return {
      status: 'rejected',
      detail: `The provider answered and refused the credential (HTTP ${status}).`,
    };
  }

  // Anything else — DNS, TLS, timeout, 5xx, rate limit — tells us nothing
  // about whether the key is valid, so it must not be reported as if it did.
  return {
    status: 'unreachable',
    detail: `Could not complete the check: ${message}. This says nothing about whether the credential is valid.`,
  };
}

/**
 * Verify one descriptor. Never throws: a verification routine that can
 * fail is useless precisely when things are broken, which is when it is
 * run.
 */
export async function verifyProvider(
  descriptor: AIProviderDescriptor,
): Promise<CredentialVerification> {
  if (!descriptor.verifyCredential) {
    return {
      status: 'not-verifiable',
      detail:
        'This provider offers no cheap authenticated check. Only a real generation call proves the credential works.',
    };
  }

  try {
    return await descriptor.verifyCredential();
  } catch (error) {
    return classifyFailure(error);
  }
}

/**
 * The whole picture, for the moment credentials are first connected:
 * which providers have a key, and for each of those, whether the key is
 * actually accepted.
 *
 * Unconfigured providers are listed rather than hidden — "you have not set
 * this one up" is exactly the information someone connecting credentials
 * needs, and omitting them would make the list read as if those providers
 * did not exist.
 */
export async function checkProviderReadiness(): Promise<ProviderReadinessRow[]> {
  return Promise.all(
    PROVIDER_REGISTRY.map(async (descriptor) => {
      const configured = await descriptor.isConfigured().catch(() => false);
      const row: ProviderReadinessRow = {
        id: descriptor.id,
        displayName: descriptor.displayName,
        capabilities: descriptor.capabilities,
        configured,
      };
      if (configured) {
        row.verification = await verifyProvider(descriptor);
      }
      return row;
    }),
  );
}
