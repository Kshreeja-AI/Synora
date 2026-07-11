import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PlatformContainer } from '../container.js';

/** Rate-limits by authenticated key when present, falling back to remote IP for unauthenticated routes. */
export function rateLimit(container: PlatformContainer) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const key = request.principal?.keyId ?? request.ip;
    const decision = container.rateLimiter.consume(key);
    reply.header('x-ratelimit-remaining', decision.remaining);
    reply.header('x-ratelimit-reset', Math.ceil(decision.resetAt / 1000));
    if (!decision.allowed) {
      return reply.code(429).send({ error: 'rate_limited', message: 'Too many requests' });
    }
  };
}
