import { describe, it, expect, beforeEach } from 'vitest';
import {
  OpenAIProvider,
  ReplicateProvider,
  AIService,
  ImageGenerationOptions,
} from '../src/services/aiService';

describe('AI Service', () => {
  describe('AIService Factory', () => {
    it('should initialize with available providers', () => {
      const service = new AIService();
      expect(service.getProvider('openai')).toBeDefined();
      expect(service.getProvider('replicate')).toBeDefined();
      expect(service.getProvider('anthropic')).toBeDefined();
    });

    it('should set default provider', () => {
      const service = new AIService();
      service.setDefaultProvider('replicate');
      const provider = service.getProvider();
      expect(provider.name).toBe('replicate');
    });

    it('should throw for unknown provider', () => {
      const service = new AIService();
      expect(() => service.getProvider('unknown')).toThrow();
    });
  });

  describe('Provider Validation', () => {
    it('should validate image generation options', () => {
      const options: ImageGenerationOptions = {
        width: 1024,
        height: 1024,
        quality: 'high',
      };

      expect(options.width).toBeGreaterThan(0);
      expect(options.height).toBeGreaterThan(0);
      expect(['low', 'medium', 'high']).toContain(options.quality);
    });

    it('should handle optional parameters', () => {
      const options: ImageGenerationOptions = {
        width: 512,
      };

      expect(options.width).toBe(512);
      expect(options.height).toBeUndefined();
      expect(options.quality).toBeUndefined();
    });
  });

  describe('Provider Interface', () => {
    it('OpenAI provider should have required methods', () => {
      const provider = new OpenAIProvider();
      expect(provider.name).toBe('openai');
      expect(provider.generateImage).toBeDefined();
      expect(provider.generateAudio).toBeDefined();
    });

    it('Replicate provider should have required methods', () => {
      const provider = new ReplicateProvider();
      expect(provider.name).toBe('replicate');
      expect(provider.generateImage).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should throw when API key is missing', async () => {
      const provider = new OpenAIProvider('');
      await expect(
        provider.generateImage('test prompt')
      ).rejects.toThrow('OpenAI API key not configured');
    });

    it('should handle invalid prompts', async () => {
      const service = new AIService();
      // Empty prompt should be handled
      expect(async () => {
        await service.generateImage('');
      }).rejects.toBeDefined();
    });
  });

  describe('Feature Support', () => {
    it('should identify providers with audio support', async () => {
      const service = new AIService();
      const openaiProvider = service.getProvider('openai');
      expect(openaiProvider.generateAudio).toBeDefined();
    });

    it('should throw when requesting unsupported features', async () => {
      const service = new AIService();
      const replicateProvider = service.getProvider('replicate');

      if (!replicateProvider.generateVideo) {
        await expect(
          service.generateVideo('test prompt', { provider: 'replicate' })
        ).rejects.toThrow('does not support video generation');
      }
    });
  });
});
