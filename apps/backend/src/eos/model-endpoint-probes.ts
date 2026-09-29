import OpenAI from 'openai';
import { getConfig } from '../config';
import { registerHealthProbe } from './health-collector.js';
import { logger } from '../utils/logger';

/**
 * Health probes for the remote model endpoints — the GPU box(es).
 *
 * The EOS provider observatory is PASSIVE: it only knows about endpoints
 * that were actually called, so a dead GPU box with no traffic is
 * invisible until a user's message fails. These probes are the active
 * counterpart: `GET /v1/models` on every configured endpoint, on the same
 * collector cadence as the postgres/redis probes.
 *
 * WHAT A HEALTHY PROBE DOES AND DOES NOT PROVE. Listing models proves the
 * endpoint is reachable and the token is accepted. It does NOT prove a
 * model is loaded into memory — Ollama pages models in on first use, so
 * the first real generation after an idle period can still take tens of
 * seconds. "Endpoint healthy" and "model hot" are different claims, and
 * this probe only ever makes the first.
 *
 * One probe per UNIQUE base URL: a single GPU box commonly serves text
 * AND embeddings from one Ollama, and probing it twice under two names
 * would double-report every outage.
 *
 * A 401/403 maps to 'down' — an endpoint that refuses its token is
 * unavailable in every way that matters — but the cause is logged
 * distinctly, because "box offline" and "token rotated without updating
 * Synora" send an operator to different places.
 */

let registered = false;

/** Test seam. */
export function resetModelEndpointProbesForTests(): void {
  registered = false;
}

interface Endpoint {
  baseUrl: string;
  apiKey?: string;
  roles: string[];
}

function configuredEndpoints(): Endpoint[] {
  let ai;
  let embeddings;
  try {
    ({ ai, embeddings } = getConfig());
  } catch {
    return [];
  }

  const candidates: { baseUrl?: string; apiKey?: string; role: string }[] = [
    { baseUrl: ai.ollamaBaseUrl, apiKey: ai.ollamaApiKey, role: 'text:ollama' },
    {
      baseUrl: ai.selfHostedTextBaseUrl,
      apiKey: ai.selfHostedTextApiKey,
      role: 'text:self-hosted',
    },
    {
      baseUrl: embeddings.ollamaBaseUrl,
      apiKey: embeddings.ollamaApiKey,
      role: 'embeddings:ollama',
    },
    {
      baseUrl: embeddings.selfHostedBaseUrl,
      apiKey: embeddings.selfHostedApiKey,
      role: 'embeddings:self-hosted',
    },
  ];

  const byUrl = new Map<string, Endpoint>();
  for (const candidate of candidates) {
    if (!candidate.baseUrl) continue;
    const key = candidate.baseUrl.replace(/\/+$/, '');
    const existing = byUrl.get(key);
    if (existing) {
      existing.roles.push(candidate.role);
      // First configured key wins; a box with two different tokens for two
      // roles is not a topology this probe can verify with one call.
      existing.apiKey = existing.apiKey ?? candidate.apiKey;
    } else {
      byUrl.set(key, { baseUrl: candidate.baseUrl, apiKey: candidate.apiKey, roles: [candidate.role] });
    }
  }
  return [...byUrl.values()];
}

export function registerModelEndpointProbes(): void {
  if (registered) return;
  registered = true;

  for (const endpoint of configuredEndpoints()) {
    const name = `model-endpoint:${endpoint.roles.join('+')}`;
    registerHealthProbe({
      name,
      check: async () => {
        try {
          const client = new OpenAI({
            apiKey: endpoint.apiKey || 'endpoint-probe-does-not-require-an-api-key',
            baseURL: endpoint.baseUrl,
            // Inside the collector's hard 5s cap, with no retries: a probe
            // that retries is a probe that lies about latency.
            timeout: 4000,
            maxRetries: 0,
          });
          await client.models.list();
          return 'healthy';
        } catch (error) {
          const status = (error as { status?: number }).status;
          if (status === 401 || status === 403) {
            // Unavailable either way — but send the operator to the token,
            // not to the machine room.
            logger.warn('[ModelEndpointProbe] Endpoint refused its token', {
              probe: name,
              status,
            });
          }
          return 'down';
        }
      },
    });
  }
}
