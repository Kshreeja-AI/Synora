import { getConfig } from '../config';
import type { QuantumProviderDescriptor } from './descriptor';
import {
  NoQuantumBackendAvailableError,
  QuantumProviderNotConfiguredError,
  QuantumProviderUnsupportedError,
  UnknownQuantumBackendError,
} from './errors';
import { QUANTUM_PROVIDER_REGISTRY, getQuantumProviderDescriptor, quantumProvidersUpTo } from './registry';
import type { QuantumBackend, QuantumExecutionLevel, QuantumExecutionRequest, QuantumProvider } from './types';

/**
 * Selects the quantum backend a request runs on. The whole of Synora's
 * quantum provider-agnosticism is this one function.
 *
 * SELECTION RULE:
 *  1. The configured execution ceiling (`QUANTUM_MAX_EXECUTION_LEVEL`,
 *     default 0) bounds EVERY path — explicit or automatic. A request may
 *     lower it with `maxLevel` and may never raise it. A ceiling that an
 *     explicit request could step over would be decorative.
 *  2. `providerId` pins a provider. It must exist, be supported in this
 *     build, and be configured — otherwise this throws a specific,
 *     actionable error rather than silently falling back, because an
 *     explicit choice that cannot be honoured must never be quietly ignored.
 *     (Identical to `ai/resolver.ts`'s rule for `AI_PROVIDER`.)
 *  3. `backendId` pins a backend within it.
 *  4. Otherwise: the first provider in registry order that is supported,
 *     configured, and can reach a backend at or below the ceiling — and
 *     within that provider, the CHEAPEST rung available. Registry order puts
 *     the local simulator first, so the default answer is always free.
 *  5. Nothing configured, or nothing under the ceiling, throws
 *     `NoQuantumBackendAvailableError` naming everything that was checked.
 *
 * Providers whose cheapest rung is above the ceiling are excluded before any
 * network call — a deployment capped at level 0 never contacts a QPU vendor.
 */

export interface ResolvedQuantumTarget {
  readonly descriptor: QuantumProviderDescriptor;
  readonly provider: QuantumProvider;
  readonly backend: QuantumBackend;
}

function effectiveCeiling(request: QuantumExecutionRequest): QuantumExecutionLevel {
  const configured = getConfig().quantum.maxExecutionLevel;
  const requested = request.maxLevel;
  return (requested === undefined ? configured : Math.min(requested, configured)) as QuantumExecutionLevel;
}

/** Cheapest rung at or below the ceiling; ties broken by fewest queued jobs. */
function cheapestUnder(
  backends: readonly QuantumBackend[],
  ceiling: number
): QuantumBackend | undefined {
  return [...backends]
    .filter((b) => b.executionLevel <= ceiling)
    .sort(
      (a, b) =>
        a.executionLevel - b.executionLevel || (a.queueDepth ?? 0) - (b.queueDepth ?? 0)
    )[0];
}

export async function resolveQuantumBackend(
  request: QuantumExecutionRequest,
  registry: readonly QuantumProviderDescriptor[] = QUANTUM_PROVIDER_REGISTRY
): Promise<ResolvedQuantumTarget> {
  const ceiling = effectiveCeiling(request);

  if (request.providerId) {
    const descriptor = getQuantumProviderDescriptor(request.providerId, registry);
    if (!descriptor) {
      throw new NoQuantumBackendAvailableError(
        registry.map((p) => p.id),
        `"${request.providerId}" is not a known quantum provider.`
      );
    }
    // Unsupported is answered as unsupported, never as "not configured" —
    // no credential would have helped, and saying otherwise sends an
    // operator hunting for one.
    if (descriptor.unsupportedReason) {
      throw new QuantumProviderUnsupportedError(descriptor.id, descriptor.unsupportedReason);
    }
    if (!(await descriptor.isConfigured())) {
      throw new QuantumProviderNotConfiguredError(
        descriptor.id,
        'its required credential or configuration is missing'
      );
    }

    const provider = await descriptor.create();
    const backends = await provider.listBackends();

    if (request.backendId) {
      const backend = backends.find((b) => b.id === request.backendId);
      if (!backend) {
        throw new UnknownQuantumBackendError(
          request.backendId,
          backends.map((b) => b.id)
        );
      }
      if (backend.executionLevel > ceiling) {
        throw new NoQuantumBackendAvailableError(
          [backend.id],
          `"${backend.id}" is execution level ${backend.executionLevel}, above this ` +
            `deployment's ceiling of ${ceiling}. Raise QUANTUM_MAX_EXECUTION_LEVEL only ` +
            'deliberately — the higher rungs cost real money.'
        );
      }
      return { descriptor, provider, backend };
    }

    const backend = cheapestUnder(backends, ceiling);
    if (!backend) {
      throw new NoQuantumBackendAvailableError(
        backends.map((b) => b.id),
        `provider "${descriptor.id}" has no backend at or below execution level ${ceiling}.`
      );
    }
    return { descriptor, provider, backend };
  }

  const candidates = quantumProvidersUpTo(ceiling, registry);
  const checked: string[] = [];

  for (const descriptor of candidates) {
    checked.push(descriptor.id);
    if (descriptor.unsupportedReason) continue;
    if (!(await descriptor.isConfigured())) continue;

    const provider = await descriptor.create();
    const backend = cheapestUnder(await provider.listBackends(), ceiling);
    if (backend) return { descriptor, provider, backend };
  }

  throw new NoQuantumBackendAvailableError(
    checked,
    `No configured provider offers a backend at or below execution level ${ceiling} ` +
      `(QUANTUM_MAX_EXECUTION_LEVEL${
        request.maxLevel !== undefined ? `, further lowered to ${ceiling} by this request` : ''
      }).`
  );
}

/**
 * Everything the operator-facing readiness view needs, with no execution and
 * no credential exposure — status only, exactly like the AI provider matrix.
 */
export interface QuantumProviderStatus {
  readonly id: string;
  readonly displayName: string;
  readonly configured: boolean;
  readonly supported: boolean;
  readonly unsupportedReason?: string;
  readonly metering: 'metered' | 'unmetered';
  readonly minExecutionLevel: QuantumExecutionLevel;
  readonly maxExecutionLevel: QuantumExecutionLevel;
  readonly withinConfiguredCeiling: boolean;
}

export async function describeQuantumProviders(
  registry: readonly QuantumProviderDescriptor[] = QUANTUM_PROVIDER_REGISTRY
): Promise<readonly QuantumProviderStatus[]> {
  const ceiling = getConfig().quantum.maxExecutionLevel;
  const out: QuantumProviderStatus[] = [];
  for (const d of registry) {
    out.push({
      id: d.id,
      displayName: d.displayName,
      supported: d.unsupportedReason === undefined,
      ...(d.unsupportedReason ? { unsupportedReason: d.unsupportedReason } : {}),
      configured: d.unsupportedReason ? false : await d.isConfigured(),
      metering: d.metering,
      minExecutionLevel: d.minExecutionLevel,
      maxExecutionLevel: d.maxExecutionLevel,
      withinConfiguredCeiling: d.minExecutionLevel <= ceiling,
    });
  }
  return out;
}
