/**
 * The model catalog — one entry per model the platform knows how to talk to,
 * grouped by provider.
 *
 * This is a *hand-maintained catalog*, not a live lookup: provider APIs
 * generally don't publish a stable machine-readable model list with the
 * metadata a picker needs (context window, capability flags, human label,
 * price), so the small maintenance cost of updating this file when a new
 * model ships is worth the payoff — the picker gets accurate metadata and
 * the platform never surprises a user with "model X was silently deprecated".
 *
 * Every entry that appears here MUST work at inference time. If a provider
 * removes a model, remove it from here in the same change so a user cannot
 * pick something we can no longer serve.
 */

import { PROVIDER_REGISTRY } from './registry';

export interface ModelCard {
  /** Wire model id sent to the provider — do not localize or rewrite. */
  readonly id: string;
  /** Human label shown in the picker. */
  readonly label: string;
  /** Prose blurb — one line, positioning-neutral. */
  readonly description: string;
  /** Max input tokens (approximate; a provider's real limit is authoritative). */
  readonly contextWindow: number;
  /** Well-known capability flags — drive picker badges and filtering. */
  readonly capabilities: {
    readonly vision?: boolean;
    readonly toolUse?: boolean;
    readonly reasoning?: boolean;
    readonly streaming?: boolean;
    readonly thinking?: boolean;
  };
  /**
   * Cost estimate for display in the picker. USD per 1M tokens (millions
   * scales nicer on-screen than per-1k for frontier models). Kept separate
   * from ai/pricing.ts, which is per-1k because that's the accounting
   * granularity used by the token accountant.
   */
  readonly pricePerMillion?: {
    readonly input: number;
    readonly output: number;
  };
  /**
   * Rough throughput hint, tokens/sec. Displayed as a Speed badge — do not
   * pretend this is precise; a real answer would need per-region benchmarks.
   */
  readonly speedTokensPerSecond?: number;
}

export interface ProviderCatalog {
  readonly providerId: string;
  readonly providerName: string;
  readonly configured: boolean;
  readonly models: readonly ModelCard[];
}

const ANTHROPIC_MODELS: readonly ModelCard[] = [
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    description: 'Balanced flagship — strong reasoning at reasonable cost.',
    contextWindow: 200_000,
    capabilities: { vision: true, toolUse: true, reasoning: true, streaming: true },
    pricePerMillion: { input: 3, output: 15 },
    speedTokensPerSecond: 80,
  },
  {
    id: 'claude-opus-4-7',
    label: 'Claude Opus 4.7',
    description: 'Top-tier depth for hard reasoning and long-form drafting.',
    contextWindow: 200_000,
    capabilities: { vision: true, toolUse: true, reasoning: true, streaming: true, thinking: true },
    pricePerMillion: { input: 15, output: 75 },
    speedTokensPerSecond: 40,
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    description: 'Fast, cheap and capable enough for most interactive uses.',
    contextWindow: 200_000,
    capabilities: { vision: true, toolUse: true, streaming: true },
    pricePerMillion: { input: 0.8, output: 4 },
    speedTokensPerSecond: 200,
  },
];

const OPENAI_MODELS: readonly ModelCard[] = [
  {
    id: 'gpt-5',
    label: 'GPT-5',
    description: 'Frontier general-purpose model with vision and tool use.',
    contextWindow: 128_000,
    capabilities: { vision: true, toolUse: true, reasoning: true, streaming: true },
    pricePerMillion: { input: 5, output: 20 },
    speedTokensPerSecond: 90,
  },
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    description: 'Multimodal workhorse — reliable at everyday tasks.',
    contextWindow: 128_000,
    capabilities: { vision: true, toolUse: true, streaming: true },
    pricePerMillion: { input: 2.5, output: 10 },
    speedTokensPerSecond: 100,
  },
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    description: 'Cheap and quick — good for scripts and low-value calls.',
    contextWindow: 128_000,
    capabilities: { vision: true, toolUse: true, streaming: true },
    pricePerMillion: { input: 0.15, output: 0.6 },
    speedTokensPerSecond: 180,
  },
];

const GEMINI_MODELS: readonly ModelCard[] = [
  {
    id: 'gemini-1.5-pro',
    label: 'Gemini 1.5 Pro',
    description: 'Huge context, strong multimodal.',
    contextWindow: 2_000_000,
    capabilities: { vision: true, toolUse: true, streaming: true },
    pricePerMillion: { input: 1.25, output: 5 },
    speedTokensPerSecond: 60,
  },
  {
    id: 'gemini-1.5-flash',
    label: 'Gemini 1.5 Flash',
    description: 'Massive-context low-cost option; excellent for RAG.',
    contextWindow: 1_000_000,
    capabilities: { vision: true, toolUse: true, streaming: true },
    pricePerMillion: { input: 0.075, output: 0.3 },
    speedTokensPerSecond: 250,
  },
];

const XAI_MODELS: readonly ModelCard[] = [
  {
    id: 'grok-2',
    label: 'Grok 2',
    description: 'xAI conversational model.',
    contextWindow: 128_000,
    capabilities: { toolUse: true, streaming: true },
  },
];

const DEEPSEEK_MODELS: readonly ModelCard[] = [
  {
    id: 'deepseek-chat',
    label: 'DeepSeek Chat',
    description: 'Very low-cost general-purpose model.',
    contextWindow: 64_000,
    capabilities: { streaming: true },
    pricePerMillion: { input: 0.14, output: 0.28 },
  },
  {
    id: 'deepseek-reasoner',
    label: 'DeepSeek Reasoner',
    description: 'Reasoning-oriented DeepSeek variant.',
    contextWindow: 64_000,
    capabilities: { streaming: true, reasoning: true, thinking: true },
    pricePerMillion: { input: 0.55, output: 2.19 },
  },
];

const TOGETHER_MODELS: readonly ModelCard[] = [
  {
    id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    label: 'Llama 3.3 70B (Together)',
    description: 'Open-weights flagship via Together AI.',
    contextWindow: 128_000,
    capabilities: { streaming: true, toolUse: true },
    pricePerMillion: { input: 0.88, output: 0.88 },
  },
];

const OPENROUTER_MODELS: readonly ModelCard[] = [
  {
    id: 'anthropic/claude-sonnet-5',
    label: 'Claude Sonnet 5 (via OpenRouter)',
    description: 'Route Anthropic traffic through OpenRouter.',
    contextWindow: 200_000,
    capabilities: { vision: true, toolUse: true, streaming: true },
  },
  {
    id: 'openai/gpt-5',
    label: 'GPT-5 (via OpenRouter)',
    description: 'Route OpenAI traffic through OpenRouter.',
    contextWindow: 128_000,
    capabilities: { vision: true, toolUse: true, streaming: true },
  },
];

const AZURE_MODELS: readonly ModelCard[] = [
  {
    id: 'gpt-4o',
    label: 'GPT-4o (Azure deployment)',
    description: 'Azure-hosted OpenAI deployment.',
    contextWindow: 128_000,
    capabilities: { vision: true, toolUse: true, streaming: true },
  },
];

const BEDROCK_MODELS: readonly ModelCard[] = [
  {
    id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    label: 'Claude 3.5 Sonnet (Bedrock)',
    description: 'AWS Bedrock-hosted Anthropic model.',
    contextWindow: 200_000,
    capabilities: { vision: true, toolUse: true, streaming: true },
  },
];

const OLLAMA_MODELS: readonly ModelCard[] = [
  {
    id: 'llama3.3',
    label: 'Llama 3.3 (local Ollama)',
    description: 'Local inference via Ollama — no external cost.',
    contextWindow: 32_000,
    capabilities: { streaming: true },
  },
];

/** Maps a provider id to its curated model list. Extend when adding providers. */
const CATALOG_BY_PROVIDER: Readonly<Record<string, readonly ModelCard[]>> = {
  anthropic: ANTHROPIC_MODELS,
  openai: OPENAI_MODELS,
  gemini: GEMINI_MODELS,
  xai: XAI_MODELS,
  deepseek: DEEPSEEK_MODELS,
  together: TOGETHER_MODELS,
  openrouter: OPENROUTER_MODELS,
  azure: AZURE_MODELS,
  bedrock: BEDROCK_MODELS,
  ollama: OLLAMA_MODELS,
};

/**
 * The full catalog with live availability per provider — the payload the
 * model picker consumes. `configured=false` providers stay in the list so
 * the UI can render them greyed-out with a "not configured" hint, which is
 * much clearer than silently omitting them.
 */
export async function listAvailableModels(): Promise<ProviderCatalog[]> {
  return Promise.all(
    PROVIDER_REGISTRY.map(async (descriptor) => ({
      providerId: descriptor.id,
      providerName: descriptor.displayName,
      configured: await descriptor.isConfigured(),
      models: CATALOG_BY_PROVIDER[descriptor.id] ?? [],
    }))
  );
}

/** Test seam: sync accessor for use by unit tests that mock provider registry. */
export function getModelsForProvider(providerId: string): readonly ModelCard[] {
  return CATALOG_BY_PROVIDER[providerId] ?? [];
}
