import type { QuantumProviderDescriptor } from './descriptor';

/**
 * Every quantum backend provider this application knows how to talk to, in
 * auto-selection priority order.
 *
 * ORDER IS THE POLICY. The local simulator is first, deliberately and
 * permanently: it is free, needs no credential, and cannot queue. A
 * deployment that has configured IBM still gets the local simulator by
 * default, because "you configured a credential" is not the same as "you
 * authorised spending on every request" — and the two are conflated by
 * exactly the auto-detection rule that puts a hosted provider first.
 *
 * The text-generation registry orders itself the opposite way (Anthropic
 * first, self-hosted last) and that is correct THERE: a founder who
 * configures a frontier model wants it used. Quantum inverts it because the
 * quantum rungs differ by orders of magnitude in cost and by hours in
 * latency, while text providers differ by cents and milliseconds.
 *
 * Adding a provider is one entry here and one file under `./providers/` —
 * nothing else in the application changes. That claim is enforced by
 * `./__tests__/quantumContract.test.ts`, which registers a provider this
 * codebase has never seen and drives it through the whole path.
 */
import { braketDescriptor } from './providers/braket.provider';
import { ibmQuantumDescriptor } from './providers/ibmQuantum.provider';
import { localSimulatorDescriptor } from './providers/localSimulator.provider';

export const QUANTUM_PROVIDER_REGISTRY: readonly QuantumProviderDescriptor[] = [
  localSimulatorDescriptor,
  ibmQuantumDescriptor,
  braketDescriptor,
];

export function getQuantumProviderDescriptor(
  id: string,
  registry: readonly QuantumProviderDescriptor[] = QUANTUM_PROVIDER_REGISTRY
): QuantumProviderDescriptor | undefined {
  return registry.find((p) => p.id === id);
}

/**
 * Providers that could plausibly serve a request at or below `ceiling`,
 * WITHOUT calling any of them.
 *
 * A provider whose cheapest rung is above the ceiling is excluded here
 * rather than after a network round-trip — so a deployment capped at level 0
 * never opens a connection to a QPU vendor at all. That is a privacy and a
 * latency property as much as a cost one.
 */
export function quantumProvidersUpTo(
  ceiling: number,
  registry: readonly QuantumProviderDescriptor[] = QUANTUM_PROVIDER_REGISTRY
): readonly QuantumProviderDescriptor[] {
  return registry.filter((p) => p.minExecutionLevel <= ceiling);
}
