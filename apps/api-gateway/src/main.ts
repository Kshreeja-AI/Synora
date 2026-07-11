import { config } from './config.js';
import { rootLogger } from './logger.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const app = await buildServer({ config, logger: rootLogger });

  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
  rootLogger.info(`${config.app.name} listening`, { port, env: config.app.env });

  const shutdown = async (signal: string): Promise<void> => {
    rootLogger.info('Shutting down', { signal });
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
