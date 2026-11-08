// FIRST IMPORT, deliberately: ESM evaluates imports before any body
// statement, so the environment must be loaded by an import rather than a
// call. See ./bootstrap-env.
import './bootstrap-env';
import { secretsManager } from './secrets';
import { encryptionService } from './crypto/encryption.service';
import { initConfig } from './config';
import {
  assertProductionLaunchGates,
  assertNoLocalhostInProduction,
  assertNoDevelopmentModesInProduction,
  assertQuantumLaunchGates,
} from './config/productionGates';
import { createApp } from './app';
import { initializeWorkers } from './workers/manager';
import { logger } from './utils/logger';

/**
 * Initialize the application: validate secrets, load config, create Express app,
 * and start background workers.
 *
 * Pure function: no side effects, no server startup.
 * Tests can call this directly to get a configured app.
 * Production calls this via server.ts to start the server.
 */
export async function initializeApp() {
  // Fail fast: secrets before config (config's DATABASE_URL/provider flags
  // depend on SecretsManager), config before anything else touches env vars.
  await secretsManager.validateRequired();
  // Hand the tool-secret master key to the (sync, env-reading) encryption
  // service from the full source chain, so a key mounted as a docker/k8s
  // secret file works the same as a plain env var. Real values only —
  // priming a placeholder would encrypt user secrets under a key that
  // vanishes when a real one arrives.
  encryptionService.prime(
    await secretsManager.tryGetReal('TOOL_SECRET_MASTER_KEY', 'boot-prime')
  );
  const config = await initConfig();
  // A metered AI credential with no global spend cap must not boot in
  // staging/production — the cap comes BEFORE the paid key, always.
  await assertProductionLaunchGates(config, secretsManager);
  // A browser-facing address still pointing at localhost must not boot in
  // staging/production either. Production does not override those defaults,
  // so an unset variable here produces a deployment that passes every health
  // check and is broken for every visitor — see the gate for what each one
  // costs.
  assertNoLocalhostInProduction(config);
  // Refuses a production boot whose modes would fabricate model output or
  // suppress outbound calls. Checked alongside the localhost gate because it
  // is the same failure shape: correct in development, invisible in production.
  assertNoDevelopmentModesInProduction(config);
  // Paid quantum hardware switched on with no per-execution ceiling is the
  // quantum-shaped version of an uncapped API key, and it is worse per
  // incident: one QPU task can cost more than a month of text generation.
  assertQuantumLaunchGates(config);
  const app = createApp(config);

  // Initialize background workers for async task processing. With
  // QUEUE_ENABLED=false (a deployment with no Redis) they are not started at
  // all: BullMQ would otherwise retry a refused connection per worker, forever,
  // and bury the real log lines in ECONNREFUSED noise. Features that need the
  // queue (streamed chat generation, file processing) are unavailable then.
  if (!config.queue.enabled) {
    logger.info('[WorkerManager] QUEUE_ENABLED=false: background workers not started');
  } else try {
    await initializeWorkers();
  } catch (error) {
    logger.error('Failed to initialize workers', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't fail the entire app if workers don't start, but log the error
    // (useful for local dev without Redis, or test environments)
  }

  return { app, config };
}
