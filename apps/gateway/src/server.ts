import cors from '@fastify/cors';
import { SynoraError } from '@synora/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import type { PlatformContainer } from './container.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerMemoryRoutes } from './routes/memory.js';
import { registerWorkflowRoutes } from './routes/workflows.js';

const ERROR_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  GUARDRAIL_VIOLATION: 422,
  TOOL_EXECUTION_ERROR: 422,
  PROVIDER_ERROR: 502,
};

/**
 * Builds the platform's HTTP surface from an already-assembled
 * PlatformContainer. Deliberately takes the container as a parameter
 * rather than building one itself, so any product can construct its
 * own container (with its own agents/tools registered) and reuse this
 * exact server — the gateway app has no product-specific code in it.
 */
export function createServer(container: PlatformContainer): FastifyInstance {
  const app = Fastify({
    logger: false,
    genReqId: (request) => (request.headers['x-request-id'] as string | undefined) ?? uuidv4(),
  });

  app.register(cors, { origin: true });

  app.addHook('onResponse', async (request, reply) => {
    container.logger.info('request completed', {
      requestId: request.id,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
    });
    container.metrics.recordHistogram('gateway.request.duration_ms', reply.elapsedTime, {
      route: request.routeOptions.url ?? request.url,
    });
  });

  app.setErrorHandler<Error>((error, request, reply) => {
    if (error instanceof SynoraError) {
      const status = ERROR_STATUS[error.code] ?? 500;
      container.logger.warn('handled platform error', { code: error.code, message: error.message });
      reply.code(status).send({ error: error.code.toLowerCase(), message: error.message });
      return;
    }
    container.logger.error('unhandled error', {
      message: error.message,
      stack: error.stack,
      url: request.url,
    });
    reply.code(500).send({ error: 'internal_error', message: 'An unexpected error occurred' });
  });

  registerHealthRoutes(app, container);
  registerAgentRoutes(app, container);
  registerMemoryRoutes(app, container);
  registerWorkflowRoutes(app, container);

  return app;
}
