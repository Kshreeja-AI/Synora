import 'dotenv/config';
import { secretsManager } from './secrets';
import { encryptionService } from './crypto/encryption.service';
import { initConfig } from './config';
import { assertProductionLaunchGates } from './config/productionGates';
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
  const app = createApp(config);

  // Initialize background workers for async task processing
  try {
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
