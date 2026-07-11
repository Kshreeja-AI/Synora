import type { FastifyInstance } from 'fastify';
import type { PlatformContainer } from '../container.js';

export function registerHealthRoutes(app: FastifyInstance, container: PlatformContainer): void {
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_request, reply) => {
    // At least one model provider must be configured to serve traffic;
    // memory is an optional capability and its absence doesn't block readiness.
    const checks = {
      providers: container.providerRegistry.list().length > 0,
      memory: Boolean(container.memoryStore),
    };
    const ready = checks.providers;
    reply.code(ready ? 200 : 503);
    return { status: ready ? 'ready' : 'not_ready', checks };
  });

  app.get('/metrics', async () => container.metrics.snapshot());
}
