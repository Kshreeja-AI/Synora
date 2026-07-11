import { type AgentDefinition, asAgentId, asSessionId } from '@synora/core';
import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import type { PlatformContainer } from '../container.js';
import { authenticate, getPrincipal } from '../plugins/auth.js';
import { rateLimit } from '../plugins/rate-limit.js';

interface ChatBody {
  agentId?: string;
  sessionId?: string;
  message?: string;
}

export function registerAgentRoutes(app: FastifyInstance, container: PlatformContainer): void {
  app.get(
    '/v1/agents',
    { preHandler: [authenticate(container, 'agent:invoke'), rateLimit(container)] },
    async () =>
      container.agentRegistry
        .list()
        .map((a) => ({ id: a.id, name: a.name, description: a.description })),
  );

  app.post<{ Body: ChatBody }>(
    '/v1/chat',
    { preHandler: [authenticate(container, 'agent:invoke'), rateLimit(container)] },
    async (request, reply) => {
      const { agentId, sessionId, message } = request.body ?? {};
      if (!agentId || typeof message !== 'string' || message.length === 0) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: '"agentId" and "message" are required' });
      }

      let definition: AgentDefinition;
      try {
        definition = container.agentRegistry.get(asAgentId(agentId));
      } catch {
        return reply.code(404).send({ error: 'not_found', message: `Unknown agent "${agentId}"` });
      }

      const principal = getPrincipal(request);
      const result = await container.tracer.startSpan('gateway.chat', async (span) => {
        span.setAttribute('agent.id', agentId);
        return container.agentRuntime.run(definition, {
          tenantId: principal.tenantId,
          userId: principal.userId,
          sessionId: asSessionId(sessionId ?? uuidv4()),
          message,
        });
      });

      container.metrics.incrementCounter('gateway.chat.requests', 1, {
        agentId,
        status: result.status,
      });

      if (result.status === 'failed') {
        return reply.code(422).send({ status: result.status, error: result.error });
      }
      return { status: result.status, messages: result.messages, handoffTo: result.handoffTo };
    },
  );
}
