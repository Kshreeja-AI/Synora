import type { AICapability, TextToSpeechProvider } from './types';
import { NoProviderConfiguredError } from './types';
import type { AIProviderDescriptor } from './types/descriptor';
import { openaiTextToSpeechDescriptor } from './providers/openaiTextToSpeech.provider';

/**
 * Text-to-speech providers, kept in their own registry because they build a
 * different provider interface (`TextToSpeechProvider`) than text/image/video
 * generation. Adding another TTS provider (ElevenLabs, PlayHT, Azure Speech)
 * is one descriptor here and one file under `./providers/`, no call-site
 * change.
 */
export const TTS_PROVIDER_REGISTRY: readonly AIProviderDescriptor<TextToSpeechProvider>[] = [
  openaiTextToSpeechDescriptor,
];

const TTS_CAPABILITY: AICapability = 'text-to-speech';

/**
 * The first configured text-to-speech provider. Throws
 * `NoProviderConfiguredError` (never returns a fake provider) when none is
 * configured, so the caller surfaces an honest "not available" rather than
 * fabricating audio.
 */
export async function resolveTextToSpeechProvider(): Promise<TextToSpeechProvider> {
  for (const descriptor of TTS_PROVIDER_REGISTRY) {
    if (await descriptor.isConfigured()) {
      return descriptor.create();
    }
  }
  throw new NoProviderConfiguredError(
    TTS_CAPABILITY,
    TTS_PROVIDER_REGISTRY.map((p) => p.id)
  );
}

export async function isTextToSpeechConfigured(): Promise<boolean> {
  for (const descriptor of TTS_PROVIDER_REGISTRY) {
    if (await descriptor.isConfigured()) return true;
  }
  return false;
}
