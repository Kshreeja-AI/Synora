import { logger } from '../utils/logger';
import { authoriseQuantumExecution, recordQuantumSpend } from './budget';
import { circuitDepth, twoQubitGateCount } from './circuit';
import type { QuantumProviderDescriptor } from './descriptor';
import { QuantumError, QuantumProviderError } from './errors';
import { resolveQuantumBackend } from './resolver';
import type { QuantumExecutionRequest, QuantumExecutionResult } from './types';

/**
 * The one function the rest of the application calls to run a quantum
 * circuit. The twin of `ai/index.ts`'s `generateText()`, and it makes the
 * same promise: no caller ever names a backend, imports a vendor client, or
 * changes when a provider is added, removed or swapped.
 *
 * ORDER OF OPERATIONS IS THE SAFETY PROPERTY:
 *
 *   resolve → estimate → AUTHORISE → execute → record
 *
 * The cost is known and authorised before submission, so a refusal costs
 * nothing. Doing it the other way round — submit, then discover the price —
 * is a spend report wearing a spend control's name.
 *
 * Every vendor error is normalised to a `QuantumError` at the adapter
 * boundary; anything that still escapes as a raw error is wrapped here, so a
 * caller's `catch` never has to know which vendor threw.
 */
export async function executeQuantumCircuit(
  request: QuantumExecutionRequest,
  registry?: readonly QuantumProviderDescriptor[]
): Promise<QuantumExecutionResult> {
  const { descriptor, provider, backend } = await resolveQuantumBackend(request, registry);

  const cost = provider.estimateCost(backend, request);
  const authorisation = await authoriseQuantumExecution(backend, cost, request);

  logger.info('[Quantum] executing', {
    executionId: request.executionId,
    provider: descriptor.id,
    backend: backend.id,
    level: backend.executionLevel,
    qubits: request.circuit.qubits,
    depth: circuitDepth(request.circuit),
    twoQubitGates: twoQubitGateCount(request.circuit),
    shots: request.shots,
    chargeCents: authorisation.chargeCents,
  });

  let result: QuantumExecutionResult;
  try {
    result = await provider.execute(backend, request);
  } catch (error) {
    // A FAILED EXECUTION IS NOT NECESSARILY A FREE EXECUTION — the same
    // property `instrumentedGenerate` documents for text. A timeout means
    // Synora stopped waiting, not that the provider stopped running, and a
    // metered provider may bill for the job anyway. The authorised amount is
    // charged so a timeout storm cannot be free forever as far as the cap is
    // concerned.
    if (authorisation.chargeCents > 0) {
      await recordQuantumSpend(
        { executionId: request.executionId, providerId: descriptor.id, backendId: backend.id },
        authorisation,
        { workspaceId: request.workspaceId, userId: request.userId }
      );
    }

    logger.warn('[Quantum] execution failed', {
      executionId: request.executionId,
      provider: descriptor.id,
      backend: backend.id,
      chargedAnyway: authorisation.chargeCents > 0,
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof QuantumError) throw error;
    throw new QuantumProviderError(
      `Quantum execution failed: ${error instanceof Error ? error.message : String(error)}`,
      descriptor.id,
      error
    );
  }

  await recordQuantumSpend(result, authorisation, {
    workspaceId: request.workspaceId,
    userId: request.userId,
  });

  return result;
}
