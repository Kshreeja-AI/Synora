import { resolveTextGenerationProvider } from './resolver';
import { generateWithResilience } from './textResilience';
import { TextGenerationRequest, TextGenerationResult } from './types';

export type {
  AICapability,
  TextGenerationMode,
  ConversationRole,
  ConversationMessage,
  AIToolDefinition,
  AIToolCall,
  AIToolResult,
  ToolChoice,
  TextGenerationRequest,
  TextGenerationResult,
  TextGenerationUsage,
  TextGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  GeneratedImageData,
  ImageGenerationProvider,
  VideoGenerationRequest,
  VideoGenerationProvider,
  VideoJobHandle,
  VideoJobPollResult,
  VideoJobStatus,
  TextToSpeechRequest,
  TextToSpeechResult,
  TextToSpeechProvider,
} from './types';
export { AIProviderError, AIRateLimitedError, NoProviderConfiguredError } from './types';
export { PROVIDER_REGISTRY, getProviderDescriptor, providersForCapability } from './registry';
export type { AIProviderDescriptor } from './registry';
export { resolveProvider, resolveTextGenerationProvider } from './resolver';
export {
  IMAGE_PROVIDER_REGISTRY,
  resolveImageProvider,
  isImageGenerationConfigured,
} from './imageRegistry';
export {
  VIDEO_PROVIDER_REGISTRY,
  resolveVideoProvider,
  isVideoGenerationConfigured,
} from './videoRegistry';
export {
  TTS_PROVIDER_REGISTRY,
  resolveTextToSpeechProvider,
  isTextToSpeechConfigured,
} from './ttsRegistry';

/**
 * The one function the rest of the application calls to generate text or
 * code. Everything about *which* provider serves the request — Anthropic by
 * default, any other configured provider otherwise, entirely via
 * environment variables — is resolved internally. No caller of this
 * function ever names a provider, imports a provider's SDK, or needs to
 * change when a provider is added, removed, or swapped.
 */
export async function generateText(request: TextGenerationRequest): Promise<TextGenerationResult> {
  const provider = await resolveTextGenerationProvider();
  // Timeout, retry-with-backoff and per-provider circuit breaking — the
  // same resilience rules the embeddings stack has always had, applied
  // from one shared module so the two stacks can never drift apart.
  return generateWithResilience(provider, request);
}
