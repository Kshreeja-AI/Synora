import type { AICapability, TextGenerationProvider } from './types';

/**
 * What a provider module publishes about itself. The registry and resolver
 * only ever interact with this shape — never with a provider's underlying
 * SDK, its auth mechanism, or its request/response wire format. That detail
 * is entirely inside each provider's own file under `./providers/`.
 */
export interface AIProviderDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: readonly AICapability[];
  /**
   * Cheap, no-network-call check: are this provider's required secrets/
   * config present? Used both for auto-detection and to give a clear error
   * when a provider is explicitly selected but not configured.
   */
  isConfigured(): Promise<boolean>;
  /**
   * Construct a working provider instance. Only called after isConfigured()
   * has returned true.
   */
  create(): Promise<TextGenerationProvider>;
}

/**
 * The complete list of providers this application knows how to talk to,
 * in auto-detection priority order (first configured wins when
 * `AI_PROVIDER` is not set explicitly). Anthropic is first, matching the
 * founder's chosen Release 1 default — changing the default is a one-line
 * reorder here, or an `AI_PROVIDER` env var, never a change to the resolver
 * or any route.
 *
 * Adding a new provider means adding one entry here and one new file under
 * `./providers/` — nothing else in the application changes.
 */
import { anthropicDescriptor } from './providers/anthropic.provider';
import { openaiDescriptor } from './providers/openaiCompatible.provider';
import { geminiDescriptor } from './providers/gemini.provider';
import { xaiDescriptor } from './providers/xai.provider';
import { openrouterDescriptor } from './providers/openrouter.provider';
import { deepseekDescriptor } from './providers/deepseek.provider';
import { togetherDescriptor } from './providers/together.provider';
import { azureOpenAIDescriptor } from './providers/azureOpenai.provider';
import { bedrockDescriptor } from './providers/bedrock.provider';
import { ollamaDescriptor } from './providers/ollama.provider';

export const PROVIDER_REGISTRY: readonly AIProviderDescriptor[] = [
  anthropicDescriptor,
  openaiDescriptor,
  geminiDescriptor,
  xaiDescriptor,
  openrouterDescriptor,
  deepseekDescriptor,
  togetherDescriptor,
  azureOpenAIDescriptor,
  bedrockDescriptor,
  ollamaDescriptor,
];

export function getProviderDescriptor(id: string): AIProviderDescriptor | undefined {
  return PROVIDER_REGISTRY.find((p) => p.id === id);
}

export function providersForCapability(
  capability: AICapability
): readonly AIProviderDescriptor[] {
  return PROVIDER_REGISTRY.filter((p) => p.capabilities.includes(capability));
}
