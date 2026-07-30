/**
 * Registry — central source of truth for available providers and models.
 * Enables dynamic discovery and selection without hardcoding logic.
 */

import { AIModel, CapabilityMatrix, ModelCapability } from './types';
import { IProvider } from './provider';

export class ProviderRegistry {
  private providers: Map<string, IProvider> = new Map();
  private modelCache: Map<string, AIModel> = new Map();
  private capabilityMatrix: CapabilityMatrix = {};

  register(provider: IProvider): void {
    this.providers.set(provider.id, provider);
    this.capabilityMatrix[provider.id] = {};
  }

  unregister(providerId: string): void {
    this.providers.delete(providerId);
    delete this.capabilityMatrix[providerId];
  }

  getProvider(providerId: string): IProvider | undefined {
    return this.providers.get(providerId);
  }

  listProviders(): IProvider[] {
    return Array.from(this.providers.values());
  }

  listAvailableProviders(): IProvider[] {
    return Array.from(this.providers.values())
      .filter(p => p.getHealth()
        .then(h => h.status !== 'unavailable')
        .catch(() => false)
      );
  }

  async getModel(modelId: string): Promise<AIModel | undefined> {
    if (this.modelCache.has(modelId)) {
      return this.modelCache.get(modelId);
    }

    for (const provider of this.providers.values()) {
      try {
        const model = await provider.getModel(modelId);
        this.modelCache.set(modelId, model);
        return model;
      } catch {
        // Provider doesn't have this model
      }
    }

    return undefined;
  }

  async listModels(providerId?: string): Promise<AIModel[]> {
    if (providerId) {
      const provider = this.providers.get(providerId);
      if (!provider) return [];
      const models = await provider.listModels();
      models.forEach(m => this.modelCache.set(m.id, m));
      return models;
    }

    const allModels: AIModel[] = [];
    for (const provider of this.providers.values()) {
      try {
        const models = await provider.listModels();
        models.forEach(m => this.modelCache.set(m.id, m));
        allModels.push(...models);
      } catch (error) {
        // Provider unavailable
      }
    }
    return allModels;
  }

  async updateCapabilityMatrix(): Promise<void> {
    for (const [providerId, provider] of this.providers.entries()) {
      try {
        const models = await provider.listModels();
        const matrix: { [modelId: string]: Set<ModelCapability> } = {};

        for (const model of models) {
          matrix[model.id] = new Set(model.capabilities);
        }

        this.capabilityMatrix[providerId] = matrix;
      } catch (error) {
        // Provider unavailable
      }
    }
  }

  getCapabilityMatrix(): CapabilityMatrix {
    return JSON.parse(JSON.stringify(this.capabilityMatrix));
  }

  async findModelsWithCapability(capability: ModelCapability): Promise<AIModel[]> {
    const models: AIModel[] = [];

    for (const provider of this.providers.values()) {
      try {
        const providerModels = await provider.listModels();
        models.push(
          ...providerModels.filter(m => m.capabilities.includes(capability))
        );
      } catch {
        // Provider unavailable
      }
    }

    return models;
  }

  invalidateCache(): void {
    this.modelCache.clear();
  }
}

export class ModelRegistry {
  private models: Map<string, AIModel> = new Map();
  private costCache: Map<string, { input: number; output: number }> = new Map();

  register(model: AIModel): void {
    this.models.set(model.id, model);
    this.costCache.set(model.id, {
      input: model.costPer1kInputTokens,
      output: model.costPer1kOutputTokens,
    });
  }

  getModel(modelId: string): AIModel | undefined {
    return this.models.get(modelId);
  }

  listModels(): AIModel[] {
    return Array.from(this.models.values());
  }

  listModelsByProvider(providerId: string): AIModel[] {
    return Array.from(this.models.values())
      .filter(m => m.providerId === providerId);
  }

  calculateCost(modelId: string, inputTokens: number, outputTokens: number): number {
    const costs = this.costCache.get(modelId);
    if (!costs) return 0;

    return (inputTokens / 1000) * costs.input + (outputTokens / 1000) * costs.output;
  }

  updateModel(modelId: string, updates: Partial<AIModel>): void {
    const model = this.models.get(modelId);
    if (model) {
      Object.assign(model, updates);
      if (updates.costPer1kInputTokens || updates.costPer1kOutputTokens) {
        this.costCache.set(modelId, {
          input: updates.costPer1kInputTokens ?? model.costPer1kInputTokens,
          output: updates.costPer1kOutputTokens ?? model.costPer1kOutputTokens,
        });
      }
    }
  }
}
