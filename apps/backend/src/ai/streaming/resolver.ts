/**
 * Streaming provider resolver
 * Manages provider registration and resolution with lazy initialization
 */

import { logger } from '../../utils/logger';
import { TextGenerationStreamProvider, ProviderNotFoundError } from './types';
import { AnthropicStreamProvider } from './providers/anthropic';
import { OpenAIStreamProvider } from './providers/openai';
import { GeminiStreamProvider } from './providers/gemini';
import { OpenRouterStreamProvider } from './providers/openrouter';
import { GroqStreamProvider } from './providers/groq';
import { DeepSeekStreamProvider } from './providers/deepseek';
import { MockStreamProvider } from './providers/mock';

type ProviderFactory = () => TextGenerationStreamProvider;

export class StreamingProviderResolver {
  private providers: Map<string, TextGenerationStreamProvider | null> = new Map();
  private factories: Map<string, ProviderFactory> = new Map();
  private errors: Map<string, Error> = new Map();

  constructor() {
    this.registerDefaultProviders();
  }

  private registerDefaultProviders() {
    // Register provider factories (lazy initialization)
    // Each factory only runs when the provider is actually needed
    this.registerFactory('anthropic', () => new AnthropicStreamProvider());
    this.registerFactory('openai', () => new OpenAIStreamProvider());
    this.registerFactory('gemini', () => new GeminiStreamProvider());
    this.registerFactory('openrouter', () => new OpenRouterStreamProvider());
    this.registerFactory('groq', () => new GroqStreamProvider());
    this.registerFactory('deepseek', () => new DeepSeekStreamProvider());
    this.registerFactory('mock', () => new MockStreamProvider());

    logger.debug('[ProviderResolver] Registered default provider factories', {
      available: Array.from(this.factories.keys())
    });
  }

  /**
   * Register a provider factory (lazy initialization)
   */
  private registerFactory(name: string, factory: ProviderFactory) {
    const lowerName = name.toLowerCase();
    this.factories.set(lowerName, factory);
  }

  /**
   * Register a streaming provider instance
   */
  register(name: string, provider: TextGenerationStreamProvider) {
    const lowerName = name.toLowerCase();
    this.providers.set(lowerName, provider);
    this.factories.delete(lowerName);
  }

  /**
   * Get or initialize provider (lazy instantiation)
   */
  private getOrInitializeProvider(providerId: string): TextGenerationStreamProvider | null {
    const lowerName = providerId.toLowerCase();

    // If already has a provider instance (not null), return it
    const existing = this.providers.get(lowerName);
    if (existing !== null && existing !== undefined) {
      return existing;
    }

    // If factory exists, try to initialize
    const factory = this.factories.get(lowerName);
    if (factory) {
      try {
        const provider = factory();
        this.providers.set(lowerName, provider);
        this.factories.delete(lowerName);
        logger.debug('[ProviderResolver] Lazily initialized provider', {
          provider: lowerName,
          configured: provider.isConfigured()
        });
        return provider;
      } catch (error: any) {
        logger.warn('[ProviderResolver] Failed to initialize provider', {
          provider: lowerName,
          error: error.message
        });
        this.errors.set(lowerName, error);
        this.providers.set(lowerName, null);
        return null;
      }
    }

    return null;
  }

  /**
   * Resolve a provider by name
   */
  async resolve(providerId: string): Promise<TextGenerationStreamProvider> {
    const provider = this.getOrInitializeProvider(providerId);

    if (!provider) {
      const error = this.errors.get(providerId.toLowerCase());
      if (error) {
        throw new Error(
          `Failed to initialize provider ${providerId}: ${error.message}`
        );
      }
      throw new ProviderNotFoundError(providerId);
    }

    if (!provider.isConfigured()) {
      throw new Error(`Provider ${providerId} is not configured`);
    }

    return provider;
  }

  /**
   * Get all available providers (names only, doesn't initialize)
   */
  getAvailableProviders(): string[] {
    return Array.from(
      new Set([
        ...Array.from(this.providers.keys()),
        ...Array.from(this.factories.keys())
      ])
    );
  }

  /**
   * Get configured providers (initializes each one)
   */
  getConfiguredProviders(): string[] {
    return Array.from(this.factories.keys())
      .map(name => this.getOrInitializeProvider(name))
      .filter((p): p is TextGenerationStreamProvider => p !== null && p.isConfigured())
      .map(p => p.getName());
  }

  /**
   * Check if provider is available and configured
   */
  isAvailable(providerId: string): boolean {
    const provider = this.getOrInitializeProvider(providerId);
    return provider?.isConfigured() ?? false;
  }
}

// Global resolver instance
let resolverInstance: StreamingProviderResolver;

export function getStreamingResolver(): StreamingProviderResolver {
  if (!resolverInstance) {
    resolverInstance = new StreamingProviderResolver();
  }
  return resolverInstance;
}
