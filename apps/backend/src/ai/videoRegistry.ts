import type { AICapability, VideoGenerationProvider } from './types';
import { NoProviderConfiguredError } from './types';
import type { AIProviderDescriptor } from './types/descriptor';
import { replicateVideoDescriptor } from './providers/replicateVideo.provider';

export const VIDEO_PROVIDER_REGISTRY: readonly AIProviderDescriptor<VideoGenerationProvider>[] = [
  replicateVideoDescriptor,
];

const VIDEO_CAPABILITY: AICapability = 'video-generation';

export async function resolveVideoProvider(): Promise<VideoGenerationProvider> {
  for (const descriptor of VIDEO_PROVIDER_REGISTRY) {
    if (await descriptor.isConfigured()) {
      return descriptor.create();
    }
  }
  throw new NoProviderConfiguredError(
    VIDEO_CAPABILITY,
    VIDEO_PROVIDER_REGISTRY.map((p) => p.id)
  );
}

export async function isVideoGenerationConfigured(): Promise<boolean> {
  for (const descriptor of VIDEO_PROVIDER_REGISTRY) {
    if (await descriptor.isConfigured()) return true;
  }
  return false;
}
