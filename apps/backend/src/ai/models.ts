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
 * Catalog entries are retained even when Synora cannot invoke the model's
 * modality yet. `roles` describes the vendor's model contract;
 * `capabilitySupport` and `availability` describe what this deployment can
 * route and what OpenRouter currently lists.
 */

import { PROVIDER_REGISTRY } from './registry';
import { getConfig } from '../config';
import type { AICapability } from './types';
import type { ModelCapability } from './core/types';
import { EMBEDDING_PROVIDER_REGISTRY } from '../embeddings/registry';
import { IMAGE_PROVIDER_REGISTRY } from './imageRegistry';
import { TTS_PROVIDER_REGISTRY } from './ttsRegistry';
import { discoverOpenRouterModelAvailability } from './providers/openrouter.provider';

export type ModelCapabilityReadiness = 'supported' | 'metadata-only';

export interface ModelCard {
  /** Wire model id sent to the provider — do not localize or rewrite. */
  readonly id: string;
  /** Human label shown in the picker. */
  readonly label: string;
  /** Prose blurb — one line, positioning-neutral. */
  readonly description: string;
  /** Max input tokens (approximate; a provider's real limit is authoritative). */
  readonly contextWindow: number;
  /**
   * What the VENDOR says this model can do. These are claims about the
   * model, NOT claims about Synora — a model can support tool calling
   * while Synora has no adapter able to ask it for one. Never badge these
   * directly in a UI; badge `synoraSupports` below, which is the honest
   * answer to "will this work here".
   */
  readonly capabilities: {
    readonly vision?: boolean;
    readonly toolUse?: boolean;
    readonly reasoning?: boolean;
    readonly streaming?: boolean;
    readonly thinking?: boolean;
  };
  /** Vendor model roles, expressed with the core router's capability vocabulary. */
  readonly roles?: readonly ModelCapability[];
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

/** A model card plus what Synora can actually do with it here. */
export interface ResolvedModelCard extends ModelCard {
  readonly synoraSupports: SynoraModelSupport;
  /** A role is supported only when Synora has a matching adapter path. */
  readonly capabilitySupport: Partial<Record<ModelCapability, ModelCapabilityReadiness>>;
  /** Live OpenRouter discovery result; omitted for providers without discovery. */
  readonly availability?: 'available' | 'unavailable' | 'unknown';
}

export interface ProviderCatalog {
  readonly providerId: string;
  readonly providerName: string;
  readonly configured: boolean;
  readonly models: readonly ResolvedModelCard[];
}

export function negotiateCapabilitySupport(
  model: ModelCard,
  providerId: string,
  providerCapabilities: readonly AICapability[]
): Partial<Record<ModelCapability, ModelCapabilityReadiness>> {
  const support: Partial<Record<ModelCapability, ModelCapabilityReadiness>> = {};
  for (const role of model.roles ?? []) {
    switch (role) {
      case 'text-generation':
      case 'code-generation':
      case 'reasoning':
        support[role] = providerCapabilities.includes('text-generation')
          ? 'supported'
          : 'metadata-only';
        break;
      case 'tool-calling':
        support[role] = model.capabilities.toolUse === true &&
          providerCapabilities.includes('tool-calling')
          ? 'supported'
          : 'metadata-only';
        break;
      case 'embeddings':
        support[role] = providerId === 'openrouter' &&
          EMBEDDING_PROVIDER_REGISTRY.some((descriptor) => descriptor.id === providerId) &&
          !model.roles?.includes('vision')
          ? 'supported'
          : 'metadata-only';
        break;
      case 'image-generation':
        support[role] = providerId === 'openrouter' &&
          IMAGE_PROVIDER_REGISTRY.some((descriptor) => descriptor.id === providerId)
          ? 'supported'
          : 'metadata-only';
        break;
      case 'text-to-speech':
        support[role] = providerId === 'openrouter' &&
          TTS_PROVIDER_REGISTRY.some((descriptor) => descriptor.id === providerId)
          ? 'supported'
          : 'metadata-only';
        break;
      // Text requests cannot carry image references. There is no OpenRouter
      // decision/evaluation contract in Synora yet; RAG is a pipeline role,
      // not an endpoint exposed by an individual text model.
      case 'vision':
      case 'decision':
      case 'evaluation':
      case 'rag':
      default:
        support[role] = 'metadata-only';
    }
  }
  return support;
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
  {
    id: 'thinkingmachines/inkling-small:free',
    label: 'Inkling Small (free)',
    description: 'Multimodal reasoning model for coding, agents and retrieval.',
    contextWindow: 1_048_576,
    capabilities: { vision: true, toolUse: true, reasoning: true, streaming: true, thinking: true },
    roles: ['text-generation', 'code-generation', 'reasoning', 'vision', 'tool-calling', 'rag'],
    pricePerMillion: { input: 0, output: 0 },
  },
  {
    id: 'nvidia/nemotron-3.5-lightning:free',
    label: 'Nemotron 3.5 Lightning (free)',
    description: 'High-throughput text model for agentic workloads.',
    contextWindow: 1_000_000,
    capabilities: { reasoning: true, streaming: true, thinking: true },
    roles: ['text-generation', 'code-generation', 'reasoning'],
    pricePerMillion: { input: 0, output: 0 },
  },
  {
    id: 'inclusionai/ming-image-0.1-design-layer',
    label: 'Ming Image 0.1 Design Layer',
    description: 'Separates a design reference into editable image layers.',
    contextWindow: 0,
    capabilities: { vision: true },
    roles: ['image-generation', 'vision'],
  },
  {
    id: 'fish-audio/s2.1-pro-free:free',
    label: 'Fish Audio S2.1 Pro (free)',
    description: 'Multilingual text-to-speech for testing and low-volume use.',
    contextWindow: 0,
    capabilities: {},
    roles: ['text-to-speech'],
  },
  {
    id: 'inception/mercury-decide:free',
    label: 'Mercury Decide (free)',
    description: 'Returns calibrated choices, scores or yes/no decisions.',
    contextWindow: 32_768,
    capabilities: {},
    roles: ['decision'],
  },
  {
    id: 'respan/span-01-lite:free',
    label: 'Span-01 Lite (free)',
    description: 'Scores conversation spans for behaviors and evaluation signals.',
    contextWindow: 0,
    capabilities: {},
    roles: ['decision', 'evaluation'],
  },
  {
    id: 'liquid/lfm-2.5-embedding-350m:free',
    label: 'LFM 2.5 Embedding 350M (free)',
    description: 'Text embeddings for semantic retrieval and RAG.',
    contextWindow: 8_192,
    capabilities: {},
    roles: ['embeddings', 'rag'],
    pricePerMillion: { input: 0, output: 0 },
  },
  {
    id: 'google/gemma-4-31b-it:free',
    label: 'Gemma 4 31B IT (free)',
    description: 'Multimodal instruction model with configurable reasoning and tools.',
    contextWindow: 262_144,
    capabilities: { vision: true, toolUse: true, reasoning: true, streaming: true, thinking: true },
    roles: ['text-generation', 'code-generation', 'reasoning', 'vision', 'tool-calling', 'rag'],
    pricePerMillion: { input: 0, output: 0 },
  },
  {
    id: 'nvidia/nemotron-3-ultra:free',
    label: 'Nemotron 3 Ultra (free)',
    description: 'Long-context reasoning model for orchestration and research.',
    contextWindow: 1_000_000,
    capabilities: { toolUse: true, reasoning: true, streaming: true, thinking: true },
    roles: ['text-generation', 'code-generation', 'reasoning', 'tool-calling', 'rag'],
    pricePerMillion: { input: 0, output: 0 },
  },
  {
    id: 'nvidia/nemotron-3-super:free',
    label: 'Nemotron 3 Super (free)',
    description: 'Reasoning model for multi-agent and long-running workflows.',
    contextWindow: 262_144,
    capabilities: { toolUse: true, reasoning: true, streaming: true, thinking: true },
    roles: ['text-generation', 'code-generation', 'reasoning', 'tool-calling', 'rag'],
    pricePerMillion: { input: 0, output: 0 },
  },
  {
    id: 'qwen/qwen3.8-27b:free',
    label: 'Qwen3.8 27B (free)',
    description: 'Vision-language model for coding, research and agent tasks.',
    contextWindow: 262_144,
    capabilities: { vision: true, toolUse: true, reasoning: true, streaming: true, thinking: true },
    roles: ['text-generation', 'code-generation', 'reasoning', 'vision', 'tool-calling', 'rag'],
    pricePerMillion: { input: 0, output: 0 },
  },
  {
    id: 'dots-studio/dots3-note-preview:free',
    label: 'Dots3-Note Preview (free)',
    description: 'Long-context multimodal reasoning model for coding and agents.',
    contextWindow: 512_000,
    capabilities: { vision: true, toolUse: true, reasoning: true, streaming: true, thinking: true },
    roles: ['text-generation', 'code-generation', 'reasoning', 'vision', 'tool-calling'],
    pricePerMillion: { input: 0, output: 0 },
  },
  {
    id: 'liquid/lfm2.5-2.6b:free',
    label: 'LFM2.5 2.6B (free)',
    description: 'Compact text model with built-in reasoning.',
    contextWindow: 65_536,
    capabilities: { reasoning: true, streaming: true, thinking: true },
    roles: ['text-generation', 'reasoning'],
    pricePerMillion: { input: 0, output: 0 },
  },
  {
    id: 'nvidia/nemotron-3-embed-1b:free',
    label: 'Nemotron 3 Embed 1B (free)',
    description: 'Text embeddings optimized for retrieval and RAG.',
    contextWindow: 32_768,
    capabilities: {},
    roles: ['embeddings', 'rag'],
    pricePerMillion: { input: 0, output: 0 },
  },
  {
    id: 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
    label: 'Llama Nemotron Embed VL 1B V2 (free)',
    description: 'Text and image embeddings for multimodal retrieval.',
    contextWindow: 131_072,
    capabilities: { vision: true },
    roles: ['embeddings', 'vision', 'rag'],
    pricePerMillion: { input: 0, output: 0 },
  },
  {
    id: 'google/gemma-4-26b-a4b-it:free',
    label: 'Gemma 4 26B A4B IT (free)',
    description: 'Efficient multimodal instruction model with reasoning and tools.',
    contextWindow: 262_144,
    capabilities: { vision: true, toolUse: true, reasoning: true, streaming: true, thinking: true },
    roles: ['text-generation', 'code-generation', 'reasoning', 'vision', 'tool-calling', 'rag'],
    pricePerMillion: { input: 0, output: 0 },
  },
  {
    id: 'poolside/laguna-s-2.1:free',
    label: 'Laguna S 2.1 (free)',
    description: 'Coding-focused model for software engineering agents.',
    contextWindow: 262_144,
    capabilities: { reasoning: true, streaming: true, thinking: true },
    roles: ['text-generation', 'code-generation', 'reasoning'],
    pricePerMillion: { input: 0, output: 0 },
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

const GROQ_MODELS: readonly ModelCard[] = [
  {
    id: 'llama-3.3-70b-versatile',
    label: 'Llama 3.3 70B (Groq)',
    description: 'Open-source model on Groq hardware — very fast, with a free tier.',
    contextWindow: 128_000,
    capabilities: { toolUse: true, streaming: true },
  },
];

/**
 * Ollama and self-hosted cards are built FROM CONFIGURATION at call time,
 * not hand-maintained: which models a GPU box serves is a deployment fact
 * only the deployment knows. The previous hardcoded single card ('llama3.3')
 * did not even match the config default ('llama3.1') — a curated list for
 * an endpoint someone else operates is stale by construction.
 *
 * Read lazily (never at module import) because tests mock config after
 * importing this module, and a deployment's env is not final at import
 * time either.
 */
function configuredEndpointModels(
  defaultModel: string | undefined,
  extraModels: readonly string[],
  origin: string
): readonly ModelCard[] {
  const ids = [...new Set([defaultModel, ...extraModels].filter((id): id is string => Boolean(id)))];
  return ids.map((id) => ({
    id,
    label: id,
    description: `Open-source model served from ${origin} — no per-token cost.`,
    // Conservative: the true limit belongs to the serving endpoint and is
    // not knowable from here. Understating a context window degrades
    // gracefully; overstating one truncates someone's document.
    contextWindow: 8_000,
    capabilities: { streaming: true },
  }));
}

function ollamaCatalog(): readonly ModelCard[] {
  try {
    const { ollamaModel, ollamaModels } = getConfig().ai;
    return configuredEndpointModels(ollamaModel, ollamaModels, 'your Ollama endpoint');
  } catch {
    // Config not initialized (unit tests, early boot): fall back to the
    // default-model card so the catalog is never empty for a registered id.
    return configuredEndpointModels('llama3.1', [], 'your Ollama endpoint');
  }
}

function selfHostedCatalog(): readonly ModelCard[] {
  try {
    const { selfHostedTextModel, selfHostedTextModels } = getConfig().ai;
    const cards = configuredEndpointModels(
      selfHostedTextModel,
      selfHostedTextModels,
      'your self-hosted endpoint'
    );
    // Unconfigured self-hosted has no default model by design; a
    // placeholder card keeps the catalog non-empty (the picker greys the
    // provider out via configured=false anyway).
    return cards.length > 0
      ? cards
      : configuredEndpointModels('(set SELF_HOSTED_TEXT_MODEL)', [], 'your self-hosted endpoint');
  } catch {
    return configuredEndpointModels('(set SELF_HOSTED_TEXT_MODEL)', [], 'your self-hosted endpoint');
  }
}

/**
 * Maps a provider id to its curated model list. Extend when adding providers.
 *
 * Keys MUST be the descriptor's own `id` (see `./registry.ts`) — a key that
 * matches no descriptor silently yields an empty model list, which renders
 * as a configured provider with nothing to pick. `azure-openai` was spelled
 * `azure` here and did exactly that; `modelCatalogGaps()` below now makes
 * such a mismatch impossible to reintroduce unnoticed.
 */
const CATALOG_BY_PROVIDER: Readonly<Record<string, readonly ModelCard[]>> = {
  anthropic: ANTHROPIC_MODELS,
  openai: OPENAI_MODELS,
  gemini: GEMINI_MODELS,
  xai: XAI_MODELS,
  deepseek: DEEPSEEK_MODELS,
  together: TOGETHER_MODELS,
  openrouter: OPENROUTER_MODELS,
  'azure-openai': AZURE_MODELS,
  bedrock: BEDROCK_MODELS,
  groq: GROQ_MODELS,
};

/** The two config-driven catalogs, resolved at call time — see above. */
function dynamicCatalog(providerId: string): readonly ModelCard[] | undefined {
  if (providerId === 'ollama') return ollamaCatalog();
  if (providerId === 'self-hosted') return selfHostedCatalog();
  return undefined;
}

function catalogFor(providerId: string): readonly ModelCard[] {
  return dynamicCatalog(providerId) ?? CATALOG_BY_PROVIDER[providerId] ?? [];
}

/**
 * Provider ids with a real adapter in `ai/streaming/providers/`. Streaming
 * is served by a SEPARATE stack from the descriptor registry, so a provider
 * can be fully configured for generation and still have no streaming path —
 * `groq` is the mirror image, streaming-only with no descriptor at all.
 */
const STREAMING_PROVIDER_IDS: ReadonlySet<string> = new Set([
  'anthropic',
  'openai',
  'gemini',
  'openrouter',
  'deepseek',
  // Added atomically with their streaming adapters (the shared
  // OpenAI-compatible stream provider); an invariant test now pins this
  // set against the streaming resolver so the duplication can never
  // silently drift again.
  'ollama',
  'self-hosted',
  // Streaming adapter predates the descriptor (added in the multi-model
  // slice); with both present it finally belongs here.
  'groq',
]);

/**
 * What SYNORA can actually do with a given model through a given provider.
 *
 * This is the answer a picker badge must show. A vendor claim on the model
 * card is necessary but not sufficient: Gemini's models genuinely support
 * tool calling, and Synora's Gemini adapter genuinely cannot ask for one,
 * so badging the vendor's claim would promise something no request can
 * deliver. Every flag here is a conjunction — the model must claim it AND
 * Synora must implement it.
 */
export interface SynoraModelSupport {
  /** Model claims tool use AND this provider's adapter implements the mapping. */
  readonly toolCalling: boolean;
  /** Model claims streaming AND a streaming adapter exists for this provider. */
  readonly streaming: boolean;
  /**
   * Always false today. Several models accept image input; Synora's text
   * contract has no field carrying one, so no request can use it. Stated as
   * a computed capability rather than omitted, so the day vision is
   * implemented this becomes a real conjunction rather than a new concept.
   */
  readonly vision: boolean;
}

export function negotiateModelSupport(
  model: ModelCard,
  providerId: string,
  providerCapabilities: readonly AICapability[]
): SynoraModelSupport {
  return {
    toolCalling:
      model.capabilities.toolUse === true && providerCapabilities.includes('tool-calling'),
    streaming: model.capabilities.streaming === true && STREAMING_PROVIDER_IDS.has(providerId),
    vision: false,
  };
}

/**
 * Providers registered in `PROVIDER_REGISTRY` with no catalog entry, and
 * catalog keys matching no registered provider. Both are silent failures in
 * a picker — the first shows a provider with nothing selectable, the second
 * is a list nobody can ever see — so a test asserts this stays empty.
 */
export function modelCatalogGaps(): { providersWithoutModels: string[]; orphanedCatalogKeys: string[] } {
  const registeredIds = new Set(PROVIDER_REGISTRY.map((p) => p.id));
  return {
    providersWithoutModels: PROVIDER_REGISTRY.filter((p) => catalogFor(p.id).length === 0).map(
      (p) => p.id
    ),
    orphanedCatalogKeys: Object.keys(CATALOG_BY_PROVIDER).filter((key) => !registeredIds.has(key)),
  };
}

/**
 * The full catalog with live availability per provider — the payload the
 * model picker consumes. `configured=false` providers stay in the list so
 * the UI can render them greyed-out with a "not configured" hint, which is
 * much clearer than silently omitting them.
 */
export async function listAvailableModels(): Promise<ProviderCatalog[]> {
  return Promise.all(
    PROVIDER_REGISTRY.map(async (descriptor) => {
      const configured = await descriptor.isConfigured();
      const cards = catalogFor(descriptor.id);
      const availability = descriptor.id === 'openrouter' && configured
        ? await discoverOpenRouterModelAvailability(cards).catch(() => undefined)
        : undefined;

      return {
        providerId: descriptor.id,
        providerName: descriptor.displayName,
        configured,
        models: cards.map((model) => ({
          ...model,
          // Negotiated per model AND per provider: the same model reached
          // through two providers can be usable differently, because the
          // limit is Synora's adapter, not the model.
          synoraSupports: negotiateModelSupport(model, descriptor.id, descriptor.capabilities),
          capabilitySupport: negotiateCapabilitySupport(model, descriptor.id, descriptor.capabilities),
          ...(descriptor.id === 'openrouter'
            ? { availability: availability?.get(model.id) ?? 'unknown' }
            : {}),
        })),
      };
    })
  );
}

/**
 * Test seam: the streaming-capable id set, exported ONLY so the lockstep
 * invariant test can pin it against the streaming resolver's real factory
 * keys. Production code must keep using negotiateModelSupport.
 */
export const STREAMING_PROVIDER_IDS_FOR_TESTS: ReadonlySet<string> = STREAMING_PROVIDER_IDS;

/** Test seam: sync accessor for use by unit tests that mock provider registry. */
export function getModelsForProvider(providerId: string): readonly ModelCard[] {
  return catalogFor(providerId);
}
