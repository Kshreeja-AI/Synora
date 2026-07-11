import { asSessionId } from '@synora/core';
import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import type { PlatformContainer } from '../container.js';
import { authenticate, getPrincipal } from '../plugins/auth.js';
import { rateLimit } from '../plugins/rate-limit.js';

interface RunWorkflowBody {
  input?: unknown;
  sessionId?: string;
}

export function registerWorkflowRoutes(app: FastifyInstance, container: PlatformContainer): void {
  app.get(
    '/v1/workflows',
    { preHandler: [authenticate(container, 'workflow:run'), rateLimit(container)] },
    async () => Array.from(container.workflows.values()).map((w) => ({ id: w.id, name: w.name })),
  );

  app.post<{ Params: { workflowId: string }; Body: RunWorkflowBody }>(
    '/v1/workflows/:workflowId/run',
    { preHandler: [authenticate(container, 'workflow:run'), rateLimit(container)] },
    async (request, reply) => {
      const workflow = container.workflows.get(request.params.workflowId);
      if (!workflow) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: `Unknown workflow "${request.params.workflowId}"` });
      }
      const principal = getPrincipal(request);
      const result = await container.orchestrator.run(workflow, request.body?.input, {
        tenantId: principal.tenantId,
        userId: principal.userId,
        sessionId: asSessionId(request.body?.sessionId ?? uuidv4()),
      });
      return result;
    },
  );
}
