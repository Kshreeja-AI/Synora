/**
 * Shared, provider-agnostic helpers used by every adapter under
 * ./providers/. Mirrors `../ai/shared.ts`.
 */

/**
 * Rough token estimate for providers whose embedding endpoint does not
 * report actual token usage (Gemini, Voyage, Cohere, Ollama, self-hosted).
 * Uses the widely-cited ~4 characters-per-token approximation for English
 * text — the same heuristic OpenAI's own documentation uses when exact
 * tokenization isn't available. This is explicitly an estimate for cost/
 * usage accounting display purposes, never used for billing enforcement.
 */
export function estimateTokensFromChars(charCount: number): number {
  return Math.ceil(charCount / 4);
}

/**
 * Minimal JSON POST helper for providers that expose a plain REST API
 * rather than shipping a Node SDK (Voyage AI, Cohere). Uses the runtime's
 * native `fetch` (available unconditionally on Node 20+, this project's
 * minimum supported version) rather than adding an HTTP client dependency
 * for what is, in both cases, a single authenticated JSON endpoint.
 */
export async function postJson<TResponse>(
  url: string,
  body: unknown,
  headers: Record<string, string>
): Promise<TResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${response.statusText}${text ? `: ${text}` : ''}`);
  }

  return (await response.json()) as TResponse;
}
