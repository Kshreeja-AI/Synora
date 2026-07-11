import { type Principal, type Scope, UnauthorizedError } from '@synora/core';
import { requireScope } from '@synora/security';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PlatformContainer } from '../container.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

/**
 * Returns a Fastify preHandler that authenticates the request's bearer
 * credential and enforces the given scope. Explicit per-route (rather
 * than a global hook) so public routes like /healthz stay untouched.
 */
export function authenticate(container: PlatformContainer, scope: Scope) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Missing Bearer credential' });
    }
    try {
      const principal = container.authenticator.authenticate(header.slice('Bearer '.length));
      requireScope(principal, scope);
      request.principal = principal;
    } catch (error) {
      return reply.code(401).send({ error: 'unauthorized', message: (error as Error).message });
    }
  };
}

/** Reads the principal attached by `authenticate()`. Only call from routes that run it as a preHandler. */
export function getPrincipal(request: FastifyRequest): Principal {
  if (!request.principal) {
    throw new UnauthorizedError('Route requires authenticate() to run as a preHandler first');
  }
  return request.principal;
}
