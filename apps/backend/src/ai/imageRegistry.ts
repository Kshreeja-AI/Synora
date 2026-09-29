import type { AICapability, ImageGenerationProvider } from './types';
import { NoProviderConfiguredError } from './types';
import type { AIProviderDescriptor } from './types/descriptor';
import { openaiImageDescriptor } from './providers/openaiImage.provider';

/**
 * Image-generation providers, kept in their own registry because they build
 * a different provider interface (`ImageGenerationProvider`) than the
 * text-generation `PROVIDER_REGISTRY` — exactly the split the `src/ai`
 * module header anticipated. Adding another image provider (Gemini/Imagen,
 * xAI) is one descriptor here and one file under `./providers/`, no
 * call-site change.
 */
export const IMAGE_PROVIDER_REGISTRY: readonly AIProviderDescriptor<ImageGenerationProvider>[] = [
  openaiImageDescriptor,
];

const IMAGE_CAPABILITY: AICapability = 'image-generation';

/**
 * The first configured image provider. Throws `NoProviderConfiguredError`
 * (never returns a fake provider) when none is configured, so the caller
 * surfaces an honest "not available" rather than fabricating an image.
 */
export async function resolveImageProvider(): Promise<ImageGenerationProvider> {
  for (const descriptor of IMAGE_PROVIDER_REGISTRY) {
    if (await descriptor.isConfigured()) {
      return descriptor.create();
    }
  }
  throw new NoProviderConfiguredError(
    IMAGE_CAPABILITY,
    IMAGE_PROVIDER_REGISTRY.map((p) => p.id)
  );
}

export async function isImageGenerationConfigured(): Promise<boolean> {
  for (const descriptor of IMAGE_PROVIDER_REGISTRY) {
    if (await descriptor.isConfigured()) return true;
  }
  return false;
}
