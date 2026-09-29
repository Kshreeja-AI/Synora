/**
 * The quantum capability layer's public surface.
 *
 * Everything outside `src/quantum/**` imports from HERE and from nowhere
 * deeper — the same discipline `src/ai/index.ts` establishes. A route, a
 * service or a worker that reaches into `./providers/` has coupled itself to
 * a vendor, and the guardrail that checks for vendor SDK imports outside the
 * provider layer will not catch that: only this convention will.
 *
 * Nothing here executes anything on import. Analysis is pure and
 * synchronous; execution is explicit, budgeted, and provenance-tagged.
 */

export type {
  QuantumCapability,
  QuantumExecutionLevel,
  QuantumBackendKind,
  QuantumPricing,
  QuantumNoiseProfile,
  QuantumBackend,
  QuantumGateName,
  QuantumGate,
  QuantumMeasurement,
  QuantumCircuit,
  PauliTerm,
  QuantumObservable,
  QuantumCost,
  QuantumExecutionRequest,
  QuantumProvenance,
  QuantumExecutionResult,
  QuantumProblemType,
  QuantumFormulation,
  QuantumProblem,
  QuantumSuitabilityVerdict,
  ExpectedQuantumBenefit,
  AlgorithmState,
  QuantumSuitabilityAnalysis,
  QuantumValidationCheck,
  QuantumValidationResult,
  QuantumProvider,
} from './types';

export {
  QuantumError,
  QuantumProviderError,
  QuantumProviderNotConfiguredError,
  QuantumProviderUnsupportedError,
  NoQuantumBackendAvailableError,
  UnknownQuantumBackendError,
  UnknownQuantumAlgorithmError,
  QuantumAlgorithmNotImplementedError,
  PaidQpuNotEnabledError,
  QuantumBudgetExceededError,
  QuantumCostUnknownError,
  QuantumResourceLimitError,
  InvalidQuantumCircuitError,
  QuantumExecutionTimeoutError,
} from './errors';

export {
  CircuitBuilder,
  bindParameters,
  circuitDepth,
  circuitHash,
  twoQubitGateCount,
  checkCircuitAgainstBackend,
  gateShape,
  SUPPORTED_GATES,
} from './circuit';

export { toQasm2, toQasm3 } from './qasm';

export type { QuantumProviderDescriptor, CredentialVerification } from './descriptor';
export {
  QUANTUM_PROVIDER_REGISTRY,
  getQuantumProviderDescriptor,
  quantumProvidersUpTo,
} from './registry';
export type { ResolvedQuantumTarget, QuantumProviderStatus } from './resolver';
export { resolveQuantumBackend, describeQuantumProviders } from './resolver';

export { executeQuantumCircuit } from './execution';
export type { QuantumAuthorisation } from './budget';
export {
  assertQuantumResourceLimits,
  authoriseQuantumExecution,
  describeQuantumCost,
  recordQuantumSpend,
} from './budget';
export { validateQuantumResult, mostLikelyOutcomes } from './validation';

export { analyseQuantumSuitability } from './suitability';

export type {
  QuantumAlgorithmDescriptor,
  QuantumAlgorithmRunOptions,
  QuantumAlgorithmOutcome,
} from './algorithms/types';
export {
  QUANTUM_ALGORITHM_REGISTRY,
  getQuantumAlgorithm,
  algorithmsForProblemType,
  executableAlgorithms,
  requireExecutableAlgorithm,
} from './algorithms/registry';

export type {
  BenchmarkComparison,
  BenchmarkOutcome,
  AdvantageClaim,
  MethodMeasurement,
  QuantumMethodMeasurement,
} from './benchmark/types';
export type { BenchmarkOptions } from './benchmark/comparator';
export { runBenchmark } from './benchmark/comparator';
