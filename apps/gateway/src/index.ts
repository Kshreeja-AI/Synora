import { loadConfig } from '@synora/config';
import { buildPlatformContainer } from './container.js';
import { createServer } from './server.js';

const config = loadConfig();
const container = buildPlatformContainer(config);
const app = createServer(container);

app
  .listen({ port: config.GATEWAY_PORT, host: '0.0.0.0' })
  .then((address) => {
    container.logger.info(`Synora gateway listening at ${address}`, {
      providers: container.providerRegistry.list().map((p) => p.id),
      eventBusDriver: config.EVENT_BUS_DRIVER,
      vectorStoreDriver: config.VECTOR_STORE_DRIVER,
    });
  })
  .catch((error) => {
    container.logger.fatal('gateway failed to start', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    container.logger.info(`received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  });
}
