/**
 * Streaming provider resolver
 * Manages provider registration and resolution
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

export class StreamingProviderResolver {
  private providers: Map<string, TextGenerationStreamProvider> = new Map();

  constructor() {
    this.registerDefaultProviders();
  }

  private registerDefaultProviders() {
    // Register all built-in providers
    const anthropic = new AnthropicStreamProvider();
    const openai = new OpenAIStreamProvider();
    const gemini = new GeminiStreamProvider();
    const openrouter = new OpenRouterStreamProvider();
    const groq = new GroqStreamProvider();
    const deepseek = new DeepSeekStreamProvider();
    const mock = new MockStreamProvider();

    this.register('anthropic', anthropic);
    this.register('openai', openai);
    this.register('gemini', gemini);
    this.register('openrouter', openrouter);
    this.register('groq', groq);
    this.register('deepseek', deepseek);
    this.register('mock', mock);

    logger.debug('[ProviderResolver] Registered default providers', {
      available: Array.from(this.providers.keys()),
      configured: Array.from(this.providers.entries())
        .filter(([_, p]) => p.isConfigured())
        .map(([name]) => name)
    });
  }

  /**
   * Register a streaming provider
   */
  register(name: string, provider: TextGenerationStreamProvider) {
    this.providers.set(name.toLowerCase(), provider);
  }

  /**
   * Resolve a provider by name
   */
  async resolve(providerId: string): Promise<TextGenerationStreamProvider> {
    const provider = this.providers.get(providerId.toLowerCase());

    if (!provider) {
      throw new ProviderNotFoundError(providerId);
    }

    if (!provider.isConfigured()) {
      throw new Error(`Provider ${providerId} is not configured`);
    }

    return provider;
  }

  /**
   * Get all available providers
   */
  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get configured providers
   */
  getConfiguredProviders(): string[] {
    return Array.from(this.providers.entries())
      .filter(([_, p]) => p.isConfigured())
      .map(([name]) => name);
  }

  /**
   * Check if provider is available
   */
  isAvailable(providerId: string): boolean {
    const provider = this.providers.get(providerId.toLowerCase());
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
