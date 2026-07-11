import type { FastifyInstance } from 'fastify';
import type { HttpMethod, HttpRequest, RouteRegistrar } from '@synora/plugin-system';

/** Adapts @synora/plugin-system's framework-agnostic RouteRegistrar to a Fastify instance. */
export function createFastifyRouteRegistrar(app: FastifyInstance): RouteRegistrar {
  return {
    route(method: HttpMethod, path: string, handler) {
      app.route({
        method,
        url: toFastifyPath(path),
        handler: async (request, reply) => {
          const httpRequest: HttpRequest = {
            params: request.params as Record<string, string>,
            query: request.query as Record<string, unknown>,
            body: request.body,
            headers: request.headers as Record<string, string | string[] | undefined>,
          };
          const response = await handler(httpRequest);
          reply.status(response.status).send(response.body);
        },
      });
    },
  };
}

/** RouteRegistrar paths use `:param`, which is also Fastify's syntax — kept as a named
 * conversion point in case a future framework swap needs a different placeholder style. */
function toFastifyPath(path: string): string {
  return path;
}
