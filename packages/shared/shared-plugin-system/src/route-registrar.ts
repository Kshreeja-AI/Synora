export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HttpRequest {
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, unknown>>;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export type HttpRouteHandler = (request: HttpRequest) => Promise<HttpResponse>;

/**
 * Framework-agnostic hook plugins use to register HTTP routes without depending on any
 * particular web framework. The concrete Fastify binding lives in apps/api-gateway.
 */
export interface RouteRegistrar {
  route(method: HttpMethod, path: string, handler: HttpRouteHandler): void;
}
