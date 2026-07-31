/**
 * Resolver — intelligent provider and model selection with failover.
 * Implements load balancing, capability matching, and health-aware routing.
 */

import { AIRequest, AIModel, ModelCapability, ProviderUnavailableError } from './types';
import { IProvider } from './provider';
import { ProviderRegistry, ModelRegistry } from './registry';

export interface ResolverConfig {
  preferredProviders?: string[];
  loadBalancingStrategy?: 'round-robin' | 'least-loaded' | 'cost-optimized' | 'latency-optimized';
  healthCheckIntervalMs?: number;
  fallbackChainDepth?: number;
}

export class ProviderResolver {
  private lastUsedIndex: number = 0;

  constructor(
    private providerRegistry: ProviderRegistry,
    private modelRegistry: ModelRegistry,
    private config: ResolverConfig = {}
  ) {}

  async resolveProvider(modelId: string, fallback: boolean = true): Promise<IProvider> {
    const model = await this.modelRegistry.getModel(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    const provider = this.providerRegistry.getProvider(model.providerId);
    if (!provider) {
      throw new ProviderUnavailableError(model.providerId, `Provider not found`);
    }

    const health = await provider.getHealth();

    if (health.status === 'healthy') {
      return provider;
    }

    if (health.status === 'degraded' && !fallback) {
      return provider;  // Use degraded provider if not falling back
    }

    if (fallback) {
      return this.resolveFallbackProvider(model.providerId);
    }

    throw new ProviderUnavailableError(model.providerId, `Provider status: ${health.status}`);
  }

  async resolveModel(
    request: AIRequest,
    requiredCapabilities?: ModelCapability[]
  ): Promise<AIModel> {
    // If model specified, validate and return
    if (request.model) {
      const model = await this.modelRegistry.getModel(request.model);
      if (!model) {
        throw new Error(`Model ${request.model} not found`);
      }

      if (requiredCapabilities) {
        const missing = requiredCapabilities.filter(
          cap => !model.capabilities.includes(cap)
        );
        if (missing.length > 0) {
          throw new Error(
            `Model ${request.model} missing capabilities: ${missing.join(', ')}`
          );
        }
      }

      return model;
    }

    // Auto-select best model based on capabilities and cost
    return this.selectBestModel(requiredCapabilities, request.fallbackModels);
  }

  async selectBestModel(
    requiredCapabilities?: ModelCapability[],
    _fallbacks?: string[]
  ): Promise<AIModel> {
    const allModels = await this.providerRegistry.listModels();

    let candidates = allModels;

    // Filter by required capabilities
    if (requiredCapabilities && requiredCapabilities.length > 0) {
      candidates = candidates.filter(m =>
        requiredCapabilities.every(cap => m.capabilities.includes(cap))
      );
    }

    // Filter by preferred providers
    if (this.config.preferredProviders) {
      const preferred = candidates.filter(m =>
        this.config.preferredProviders!.includes(m.providerId)
      );
      if (preferred.length > 0) {
        candidates = preferred;
      }
    }

    // Sort by strategy
    switch (this.config.loadBalancingStrategy ?? 'cost-optimized') {
      case 'cost-optimized':
        candidates.sort((a, b) => {
          const costA = a.costPer1kInputTokens + a.costPer1kOutputTokens;
          const costB = b.costPer1kInputTokens + b.costPer1kOutputTokens;
          return costA - costB;
        });
        break;
      case 'latency-optimized':
        // Would need historical latency data
        break;
      case 'round-robin':
        this.lastUsedIndex = (this.lastUsedIndex + 1) % candidates.length;
        return candidates[this.lastUsedIndex];
      case 'least-loaded':
        // Would need queue depth data
        break;
    }

    if (candidates.length === 0) {
      throw new Error('No models found matching criteria');
    }

    return candidates[0];
  }

  private async resolveFallbackProvider(failedProviderId: string): Promise<IProvider> {
    const providers = this.providerRegistry.listProviders()
      .filter(p => p.id !== failedProviderId);

    for (const provider of providers) {
      const health = await provider.getHealth();
      if (health.status !== 'unavailable') {
        return provider;
      }
    }

    throw new ProviderUnavailableError(
      failedProviderId,
      `No fallback providers available`
    );
  }

  async buildFallbackChain(
    request: AIRequest,
    depth: number = this.config.fallbackChainDepth ?? 3
  ): Promise<AIModel[]> {
    const chain: AIModel[] = [];
    const used = new Set<string>();

    // Start with primary model
    if (request.model) {
      const model = await this.modelRegistry.getModel(request.model);
      if (model) {
        chain.push(model);
        used.add(model.id);
      }
    }

    // Add fallbacks
    if (request.fallbackModels) {
      for (const fallbackId of request.fallbackModels) {
        const model = await this.modelRegistry.getModel(fallbackId);
        if (model && !used.has(model.id)) {
          chain.push(model);
          used.add(model.id);
          if (chain.length >= depth) break;
        }
      }
    }

    // Auto-fill with best available models
    const allModels = await this.providerRegistry.listModels();
    for (const model of allModels) {
      if (!used.has(model.id)) {
        chain.push(model);
        used.add(model.id);
        if (chain.length >= depth) break;
      }
    }

    return chain.slice(0, depth);
  }
}
