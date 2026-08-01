/**
 * Shared, provider-agnostic helpers used by every adapter under
 * ./providers/. Mirrors `../embeddings/shared.ts` — kept as an independent
 * copy rather than a cross-module import, the same way `../ai`, `../queue`,
 * and `../embeddings` are independent siblings that don't import each
 * other's internals.
 */

interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * Minimal JSON HTTP helper for providers that expose a plain REST API
 * rather than shipping a Node SDK (every vector DB provider in this
 * module — see PROVIDERS.md for why). Uses the runtime's native `fetch`
 * (Node 20+, this project's minimum version) rather than adding an HTTP
 * client dependency.
 */
export async function requestJson<TResponse>(
  url: string,
  options: HttpRequestOptions = {}
): Promise<TResponse> {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${response.statusText}${text ? `: ${text}` : ''}`);
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  return (await response.json()) as TResponse;
}

/**
 * Computes the effective provider-level namespace string from a
 * `VectorScope` — `` workspace:{workspaceId} `` or
 * `` workspace:{workspaceId}:{namespace} ``. This is the single place that
 * string is built, so every provider adapter and the deletion helpers in
 * `service.ts` compute it identically.
 */
export function buildNamespace(workspaceId: string, namespace?: string): string {
  return namespace ? `workspace:${workspaceId}:${namespace}` : `workspace:${workspaceId}`;
}
