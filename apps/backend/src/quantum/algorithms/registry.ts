import { QuantumAlgorithmNotImplementedError, UnknownQuantumAlgorithmError } from '../errors';
import type { QuantumProblemType } from '../types';
import { qaoaDescriptor } from './qaoa';
import { quantumKernelDescriptor } from './quantumKernel';
import {
  groverDescriptor,
  hhlDescriptor,
  hybridQuantumClassicalNetworkDescriptor,
  quantumBoltzmannMachineDescriptor,
  quantumConvolutionalDescriptor,
  quantumGenerativeDescriptor,
  quantumNeuralNetworkDescriptor,
  quantumReinforcementLearningDescriptor,
  quantumReservoirDescriptor,
  shorDescriptor,
  trotterSimulationDescriptor,
  variationalFamilyDescriptor,
} from './researchScaffolds';
import type { QuantumAlgorithmDescriptor } from './types';
import { vqeDescriptor } from './vqe';

/**
 * Every quantum algorithm Synora can describe, and the three it can run.
 *
 * ORDER: executable first, then research scaffolds, then the textbook
 * reference entries. The suitability analyzer names algorithms from this
 * registry and nowhere else, so an algorithm cannot be recommended without
 * its assumptions and limitations being on the record next to it.
 *
 * THE COUNT IS NOT THE POINT. Fifteen entries, three of which execute. A
 * registry that advertised fifteen working algorithms would be a better
 * marketing asset and a worse engineering artefact, and the whole reason
 * `state` is a required field is that the difference has to survive
 * being read by someone in a hurry.
 */
export const QUANTUM_ALGORITHM_REGISTRY: readonly QuantumAlgorithmDescriptor[] = [
  // Executable on the local simulator, each with a mandatory classical baseline.
  qaoaDescriptor,
  vqeDescriptor,
  quantumKernelDescriptor,
  // Described, contract-compatible, deliberately not executable.
  quantumNeuralNetworkDescriptor,
  quantumConvolutionalDescriptor,
  quantumReinforcementLearningDescriptor,
  quantumBoltzmannMachineDescriptor,
  quantumReservoirDescriptor,
  quantumGenerativeDescriptor,
  hybridQuantumClassicalNetworkDescriptor,
  variationalFamilyDescriptor,
  // Textbook references the analyzer names when explaining why they do not apply.
  groverDescriptor,
  shorDescriptor,
  hhlDescriptor,
  trotterSimulationDescriptor,
];

export function getQuantumAlgorithm(id: string): QuantumAlgorithmDescriptor | undefined {
  return QUANTUM_ALGORITHM_REGISTRY.find((a) => a.id === id);
}

export function algorithmsForProblemType(
  type: QuantumProblemType
): readonly QuantumAlgorithmDescriptor[] {
  return QUANTUM_ALGORITHM_REGISTRY.filter((a) => a.problemClasses.includes(type));
}

/**
 * Only those the ladder says may run.
 *
 * BOTH conditions, and the AND is the point: a `run` method without the
 * `ENABLED` state is an implementation somebody has not validated against an
 * independent classical baseline yet, and `ENABLED` without a `run` is a
 * clerical error. Either alone would let an unverified algorithm execute,
 * which is the exact rung-skipping this vocabulary exists to prevent.
 */
export function executableAlgorithms(): readonly QuantumAlgorithmDescriptor[] {
  return QUANTUM_ALGORITHM_REGISTRY.filter((a) => a.state === 'ENABLED' && typeof a.run === 'function');
}

/**
 * Fetch an algorithm that can actually run, or refuse clearly.
 *
 * The two failure modes are kept distinct because the remedies differ:
 * an unknown id is a typo, an unimplemented one is a scope decision. Both
 * throw; neither returns a number.
 */
export function requireExecutableAlgorithm(id: string): QuantumAlgorithmDescriptor {
  const algorithm = getQuantumAlgorithm(id);
  if (!algorithm) {
    throw new UnknownQuantumAlgorithmError(
      id,
      QUANTUM_ALGORITHM_REGISTRY.map((a) => a.id)
    );
  }
  // Either half missing is a refusal. An algorithm that has a `run` but sits
  // below `ENABLED` has not been validated against an independent classical
  // baseline, and letting it execute because the method exists is how a rung
  // gets skipped without anybody deciding to skip it.
  if (typeof algorithm.run !== 'function' || algorithm.state !== 'ENABLED') {
    throw new QuantumAlgorithmNotImplementedError(id, algorithm.state);
  }
  return algorithm;
}
