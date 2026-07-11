import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from '@synora/config';
import type { Logger } from '@synora/logger';
import { runWithCorrelationId } from '@synora/logger';
import { exampleTaskPlugin } from '@synora/plugin-example-task';
import { PluginRegistry } from '@synora/plugin-system';
import { buildCompositionRoot } from './composition-root.js';
import { createErrorHandler } from './error-handler.js';
import { createFastifyRouteRegistrar } from './fastify-route-registrar.js';
import { registerHealthRoute } from './health.route.js';

export interface BuildServerOptions {
  config: AppConfig;
  logger: Logger;
}

/**
 * Builds (but does not start listening on) the Fastify app: composition root, request
 * correlation ids, the global error handler, the health route, and every registered
 * plugin. See docs/architecture/11-presentation-layer.md.
 */
export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const { config, logger } = options;
  const app = Fastify({ logger: false });

  app.addHook('onRequest', (request, _reply, done) => {
    const correlationId =
      (request.headers['x-correlation-id'] as string | undefined) ?? randomUUID();
    runWithCorrelationId(correlationId, done);
  });

  app.setErrorHandler(createErrorHandler(logger));

  registerHealthRoute(app, config.app.version);

  const { container, eventBus } = buildCompositionRoot({ config, logger });
  const routes = createFastifyRouteRegistrar(app);

  const registry = new PluginRegistry();
  registry.register(exampleTaskPlugin);
  await registry.loadAll({ container, eventBus, logger, config, routes });

  return app;
}
