import 'dotenv/config';
import { secretsManager } from './secrets';
import { initConfig } from './config';
import { createApp } from './app';

/**
 * Initialize the application: validate secrets, load config, create Express app.
 * Pure function: no side effects, no server startup.
 * Tests can call this directly to get a configured app.
 * Production calls this via server.ts to start the server.
 */
export async function initializeApp() {
  // Fail fast: secrets before config (config's DATABASE_URL/provider flags
  // depend on SecretsManager), config before anything else touches env vars.
  await secretsManager.validateRequired();
  const config = await initConfig();
  const app = createApp(config);
  return { app, config };
}
