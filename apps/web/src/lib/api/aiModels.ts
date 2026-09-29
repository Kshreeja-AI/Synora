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
  /**
   * What the VENDOR says the model can do. Do NOT badge these directly —
   * a model can support tool calling through a provider whose Synora
   * adapter cannot ask for one. Badge `synoraSupports` instead.
   */
  capabilities: {
    vision?: boolean;
    toolUse?: boolean;
    reasoning?: boolean;
    streaming?: boolean;
    thinking?: boolean;
  };
  /**
   * What SYNORA can actually do with this model through this provider —
   * the model's claim AND our adapter's implementation, negotiated
   * server-side so no surface can disagree about it.
   */
  synoraSupports: {
    toolCalling: boolean;
    streaming: boolean;
    vision: boolean;
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
