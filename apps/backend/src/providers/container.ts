import { ProviderRegistry } from './registry/providerRegistry';
import { ProviderFactory } from './factory/providerFactory';
import { IImageProvider } from './interfaces/image';
import { IVideoProvider } from './interfaces/video';
import { IAudioProvider } from './interfaces/audio';

/**
 * Dependency injection root for the provider layer. Services ask the
 * container for a capability registry instead of constructing providers
 * themselves — this is what makes providers swappable without touching
 * service code.
 */
export class ProviderContainer {
  readonly imageProviders = new ProviderRegistry<IImageProvider>();
  readonly videoProviders = new ProviderRegistry<IVideoProvider>();
  readonly audioProviders = new ProviderRegistry<IAudioProvider>();

  constructor(factory: ProviderFactory = new ProviderFactory()) {
    const set = factory.create();
    set.image.forEach((provider) => this.imageProviders.register(provider));
    set.video.forEach((provider) => this.videoProviders.register(provider));
    set.audio.forEach((provider) => this.audioProviders.register(provider));
  }
}

/**
 * Shared default container used by the service singletons. A test or a
 * future caller can still construct its own ProviderContainer (e.g. with a
 * mock-only factory) and pass it into a service explicitly.
 */
export const defaultProviderContainer = new ProviderContainer();
