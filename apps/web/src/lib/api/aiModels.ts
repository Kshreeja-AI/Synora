import { api } from './client';

/**
 * Model picker client — mirrors backend routes/ai.ts (GET /api/ai/models).
 *
 * The shape here is a deliberate copy of the backend types rather than a
 * shared import, because the frontend package has no dependency on the
 * backend (would create a bidirectional link). The two must stay in sync
 * manually; the schema is small enough that this is a fair tradeoff.
 */

export interface ModelCard {
  id: string;
  label: string;
  description: string;
  contextWindow: number;
  capabilities: {
    vision?: boolean;
    toolUse?: boolean;
    reasoning?: boolean;
    streaming?: boolean;
    thinking?: boolean;
  };
  pricePerMillion?: { input: number; output: number };
  speedTokensPerSecond?: number;
}

export interface ProviderCatalog {
  providerId: string;
  providerName: string;
  configured: boolean;
  models: ModelCard[];
}

export interface AIModelsResponse {
  providers: ProviderCatalog[];
}

export function listAIModels(): Promise<AIModelsResponse> {
  return api.get<AIModelsResponse>('/api/ai/models');
}
