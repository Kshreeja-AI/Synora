import OpenAI from 'openai';
import { SDK_CLIENT_OPTIONS } from './sdk-options';
import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import type { AIProviderDescriptor } from '../types/descriptor';
import type { ModelCapability } from '../core/types';
import {
  OpenAICompatibleTextProvider,
  verifyOpenAICompatibleKey,
} from './openaiCompatible.provider';

/** OpenRouter documents its API as OpenAI-compatible. */
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DISCOVERY_TTL_MS = 5 * 60 * 1000;

export type OpenRouterModelAvailability = 'available' | 'unavailable' | 'unknown';

interface DiscoverableModel {
  readonly id: string;
  readonly roles?: readonly ModelCapability[];
}

let discoveryCache: {
  fingerprint: string;
  expiresAt: number;
  availability: Map<string, OpenRouterModelAvailability>;
} | undefined;

/**
 * Query OpenRouter's modality-specific catalogs for current model availability.
 * Cards remain curated in models.ts; a network/API failure yields `unknown`
 * and never removes a hand-maintained card from the catalog.
 */
export async function discoverOpenRouterModelAvailability(
  models: readonly DiscoverableModel[],
  fetcher: typeof fetch = fetch
): Promise<Map<string, OpenRouterModelAvailability>> {
  const fingerprint = models.map((model) => model.id).sort().join('|');
  if (fetcher === globalThis.fetch && discoveryCache &&
      discoveryCache.fingerprint === fingerprint && discoveryCache.expiresAt > Date.now()) {
    return new Map(discoveryCache.availability);
  }

  const availability = new Map<string, OpenRouterModelAvailability>(
    models.map((model) => [model.id, 'unknown'])
  );
  const hasRole = (model: DiscoverableModel, role: ModelCapability): boolean =>
    model.roles?.includes(role) ?? role === 'text-generation';
  const hasAny = (model: DiscoverableModel, roles: readonly ModelCapability[]): boolean =>
    roles.some((role) => hasRole(model, role));
  const groups = [
    {
      path: '/models',
      matches: (model: DiscoverableModel) => hasAny(model, [
        'text-generation', 'code-generation', 'reasoning', 'vision', 'tool-calling', 'rag',
      ]),
    },
    {
      path: '/embeddings/models',
      matches: (model: DiscoverableModel) => hasRole(model, 'embeddings'),
    },
    {
      path: '/images/models',
      matches: (model: DiscoverableModel) => hasRole(model, 'image-generation'),
    },
    {
      path: '/models?output_modalities=speech',
      matches: (model: DiscoverableModel) => hasRole(model, 'text-to-speech'),
    },
  ];

  await Promise.all(groups.map(async ({ path, matches }) => {
    const requested = models.filter(matches);
    if (requested.length === 0) return;
    try {
      const response = await fetcher(`${OPENROUTER_BASE_URL}${path}`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) return;
      const body = await response.json() as { data?: readonly { id?: unknown }[] };
      const discovered = new Set(
        Array.isArray(body.data)
          ? body.data.flatMap((entry) => typeof entry.id === 'string' ? [entry.id] : [])
          : []
      );
      for (const model of requested) {
        availability.set(model.id, discovered.has(model.id) ? 'available' : 'unavailable');
      }
    } catch {
      // Network failure means unknown, not unavailable.
    }
  }));

  const specialModels = models.filter((model) => hasAny(model, ['decision', 'evaluation']));
  await Promise.all(specialModels.map(async (model) => {
    try {
      const response = await fetcher(`${OPENROUTER_BASE_URL}/model/${model.id}`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (response.status === 404) {
        availability.set(model.id, 'unavailable');
      } else if (response.ok) {
        availability.set(model.id, 'available');
      }
    } catch {
      // Network failure means unknown, not unavailable.
    }
  }));

  if (fetcher === globalThis.fetch) {
    discoveryCache = {
      fingerprint,
      expiresAt: Date.now() + DISCOVERY_TTL_MS,
      availability: new Map(availability),
    };
  }
  return availability;
}

export function resetOpenRouterDiscoveryCacheForTests(): void {
  discoveryCache = undefined;
}

export const openrouterDescriptor: AIProviderDescriptor = {
  id: 'openrouter',
  displayName: 'OpenRouter',
  capabilities: ['text-generation', 'code-generation', 'tool-calling'],
  metering: 'metered' as const,
  async isConfigured() {
    // hasReal, not tryGet: a generated placeholder is not a credential.
    return secretsManager.hasReal('OPENROUTER_API_KEY', 'ai:openrouter');
  },
  async create() {
    const apiKey = await secretsManager.get('OPENROUTER_API_KEY', 'ai:openrouter');
    return new OpenAICompatibleTextProvider(
      'openrouter',
      new OpenAI({ ...SDK_CLIENT_OPTIONS, apiKey, baseURL: OPENROUTER_BASE_URL }),
      getConfig().ai.openrouterModel
    );
  },
  async verifyCredential() {
    const apiKey = await secretsManager.get('OPENROUTER_API_KEY', 'ai:openrouter');
    return verifyOpenAICompatibleKey(new OpenAI({ ...SDK_CLIENT_OPTIONS, apiKey, baseURL: OPENROUTER_BASE_URL }), 'OpenRouter');
  },
};
