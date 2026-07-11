import { asAgentId } from '@synora/core';
import type { FastifyInstance } from 'fastify';
import type { PlatformContainer } from '../container.js';
import { authenticate, getPrincipal } from '../plugins/auth.js';
import { rateLimit } from '../plugins/rate-limit.js';

interface SearchBody {
  agentId?: string;
  text?: string;
  topK?: number;
}

interface WriteBody {
  agentId?: string;
  kind?: 'working' | 'episodic' | 'semantic' | 'procedural';
  content?: string;
}

export function registerMemoryRoutes(app: FastifyInstance, container: PlatformContainer): void {
  app.post<{ Body: SearchBody }>(
    '/v1/memory/search',
    { preHandler: [authenticate(container, 'memory:read'), rateLimit(container)] },
    async (request, reply) => {
      if (!container.memoryStore) {
        return reply
          .code(503)
          .send({ error: 'unavailable', message: 'Long-term memory is not configured' });
      }
      const { agentId, text, topK } = request.body ?? {};
      if (!agentId) {
        return reply.code(400).send({ error: 'bad_request', message: '"agentId" is required' });
      }
      const results = await container.memoryStore.search({
        tenantId: getPrincipal(request).tenantId,
        agentId: asAgentId(agentId),
        text,
        topK: topK ?? 10,
      });
      return { results };
    },
  );

  app.post<{ Body: WriteBody }>(
    '/v1/memory',
    { preHandler: [authenticate(container, 'memory:write'), rateLimit(container)] },
    async (request, reply) => {
      if (!container.memoryStore) {
        return reply
          .code(503)
          .send({ error: 'unavailable', message: 'Long-term memory is not configured' });
      }
      const { agentId, kind, content } = request.body ?? {};
      if (!agentId || !content) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: '"agentId" and "content" are required' });
      }
      const record = await container.memoryStore.write({
        tenantId: getPrincipal(request).tenantId,
        agentId: asAgentId(agentId),
        kind: kind ?? 'episodic',
        content,
      });
      return { record };
    },
  );
}
