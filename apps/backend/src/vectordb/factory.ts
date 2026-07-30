import { getConfig } from '../config';
import { VectorDBService } from './service';
import { initMetricsCollector, resetMetricsCollectorForTests } from './metrics';
import { initHealthChecker, resetHealthCheckerForTests } from './health';

/**
 * The composition root for the vector DB subsystem: reads `getConfig()`
 * and wires a fully-configured `VectorDBService` from it. `VectorDBService`
 * itself takes its dependencies as constructor parameters and knows
 * nothing about `getConfig()` — this is the only place environment/config
 * values are translated into concrete collaborators, so tests can
 * construct a service directly with fakes without ever touching this
 * module. Mirrors `../embeddings/factory.ts`.
 */
export function createVectorDBService(): VectorDBService {
  const config = getConfig().vectordb;

  const metrics = initMetricsCollector();
  const health = initHealthChecker(metrics);

  return new VectorDBService(metrics, health, {
    maxUpsertRequestSize: config.security.maxUpsertRequestSize,
    maxTopK: config.security.maxTopK,
    maxDimensions: config.security.maxDimensions,
  });
}

let vectorDBService: VectorDBService | null = null;

export function initVectorDBService(): VectorDBService {
  vectorDBService = createVectorDBService();
  return vectorDBService;
}

export function getVectorDBService(): VectorDBService {
  if (!vectorDBService) {
    vectorDBService = createVectorDBService();
  }
  return vectorDBService;
}

export function resetVectorDBServiceForTests(): void {
  vectorDBService = null;
  resetMetricsCollectorForTests();
  resetHealthCheckerForTests();
}
