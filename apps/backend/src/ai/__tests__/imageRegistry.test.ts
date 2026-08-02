import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  IMAGE_PROVIDER_REGISTRY,
  resolveImageProvider,
  isImageGenerationConfigured,
  NoProviderConfiguredError,
} from '../index';
import { secretsManager } from '../../secrets';

/**
 * Registry contract: only real providers here, none of which auto-activate
 * on placeholder credentials, and `resolve` throws `NoProviderConfiguredError`
 * (never returns a fake) when nothing is configured. This mirrors what the
 * text-generation registry pins for its capability.
 */

vi.mock('../../secrets', () => ({
  secretsManager: {
    tryGet: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock('../../config', () => ({
  getConfig: () => ({ ai: { openaiImageModel: 'gpt-image-1' } }),
}));

describe('image generation provider registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes OpenAI as an image provider (adding another is one descriptor)', () => {
    expect(IMAGE_PROVIDER_REGISTRY.map((p) => p.id)).toEqual(['openai']);
    expect(IMAGE_PROVIDER_REGISTRY[0].capabilities).toContain('image-generation');
  });

  it('reports unconfigured when no OPENAI_API_KEY is present', async () => {
    vi.mocked(secretsManager.tryGet).mockResolvedValue(undefined);
    expect(await isImageGenerationConfigured()).toBe(false);
    await expect(resolveImageProvider()).rejects.toBeInstanceOf(NoProviderConfiguredError);
  });

  it('resolves the OpenAI image provider when credentials are present', async () => {
    vi.mocked(secretsManager.tryGet).mockResolvedValue('sk-test');
    vi.mocked(secretsManager.get).mockResolvedValue('sk-test');

    const provider = await resolveImageProvider();
    expect(provider.id).toBe('openai');
    expect(provider.capabilities).toContain('image-generation');
  });
});
