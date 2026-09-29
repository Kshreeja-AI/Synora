import type { AICapability } from './types';
import type { AIProviderDescriptor } from './types/descriptor';

// Re-export for backwards compatibility
export type { AIProviderDescriptor };

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
import { groqDescriptor } from './providers/groq.provider';
import { selfHostedTextDescriptor } from './providers/selfHostedText.provider';

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
  // Groq before the two endpoint-driven entries: a real hosted credential
  // is a stronger auto-detection signal than a URL someone may have left
  // pointing at a dev box.
  groqDescriptor,
  selfHostedTextDescriptor,
];

export function getProviderDescriptor(id: string): AIProviderDescriptor | undefined {
  return PROVIDER_REGISTRY.find((p) => p.id === id);
}

export function providersForCapability(
  capability: AICapability
): readonly AIProviderDescriptor[] {
  return PROVIDER_REGISTRY.filter((p) => p.capabilities.includes(capability));
}
