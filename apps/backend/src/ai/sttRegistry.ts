import type { AICapability, SpeechToTextProvider } from './types';
import { NoProviderConfiguredError } from './types';
import type { AIProviderDescriptor } from './types/descriptor';
import { openaiCompatibleTranscriptionDescriptor } from './providers/openaiCompatibleTranscription.provider';

/**
 * Speech-to-text providers, in their own registry for the same reason TTS has
 * one: they build a different provider interface (`SpeechToTextProvider`).
 * Adding another is one descriptor here and one file under `./providers/`.
 */
export const STT_PROVIDER_REGISTRY: readonly AIProviderDescriptor<SpeechToTextProvider>[] = [
  openaiCompatibleTranscriptionDescriptor,
];

const STT_CAPABILITY: AICapability = 'speech-to-text';

/**
 * The first configured speech-to-text provider. Throws
 * `NoProviderConfiguredError` rather than returning a fake provider, so the
 * caller surfaces an honest "not available" instead of a made-up transcript.
 */
export async function resolveSpeechToTextProvider(): Promise<SpeechToTextProvider> {
  for (const descriptor of STT_PROVIDER_REGISTRY) {
    if (await descriptor.isConfigured()) {
      return descriptor.create();
    }
  }
  throw new NoProviderConfiguredError(
    STT_CAPABILITY,
    STT_PROVIDER_REGISTRY.map((p) => p.id)
  );
}

export async function isSpeechToTextConfigured(): Promise<boolean> {
  for (const descriptor of STT_PROVIDER_REGISTRY) {
    if (await descriptor.isConfigured()) return true;
  }
  return false;
}
