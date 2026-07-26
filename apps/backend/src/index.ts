import 'dotenv/config';
import { prisma } from '@synora/database';
import { logger } from './utils/logger';
import { secretsManager } from './secrets';
import { initConfig } from './config';
import { createApp } from './app';

async function bootstrap() {
  // Fail fast: secrets before config (config's DATABASE_URL/provider flags
  // depend on SecretsManager), config before anything else touches env vars.
  await secretsManager.validateRequired();
  const config = await initConfig();

  const app = createApp(config);

  // Bind explicitly to 0.0.0.0: leaving the host argument out lets Node
  // pick a default that isn't guaranteed reachable through Docker's port
  // forwarding in every environment (observed: the server logged as running
  // inside the CI container, but the host-side health check never reached
  // it — no request ever hit the logging middleware). Binding to all IPv4
  // interfaces explicitly removes that ambiguity.
  app.listen(config.server.port, '0.0.0.0', () => {
    logger.info(`🚀 Server running at http://localhost:${config.server.port}`);
    logger.info(`📚 API available at http://localhost:${config.server.port}/api`);
    logger.info(`🔐 Stage: ${config.stage} | Modes: ${JSON.stringify(config.modes)}`);
  });

  return app;
}

const appPromise: Promise<unknown> = bootstrap().catch((error) => {
  logger.error('Startup aborted', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});

// Graceful Shutdown: drain the shared Prisma connection pool before exit so
// Postgres reclaims connections promptly instead of waiting for TCP timeouts.
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down gracefully...`);
  try {
    await prisma.$disconnect();
  } catch (error) {
    logger.error('Error during Prisma disconnect on shutdown', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

export default appPromise;
