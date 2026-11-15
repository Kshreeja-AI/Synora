import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TTS_PROVIDER_REGISTRY,
  resolveTextToSpeechProvider,
  isTextToSpeechConfigured,
  NoProviderConfiguredError,
} from '../index';
import { secretsManager } from '../../secrets';

/**
 * Registry contract: only real providers here, none of which auto-activate
 * on placeholder credentials, and `resolve` throws `NoProviderConfiguredError`
 * (never returns a fake) when nothing is configured. Mirrors the
 * image-generation registry's own test.
 */

vi.mock('../../secrets', () => ({
  secretsManager: {
    tryGet: vi.fn(),
    get: vi.fn(),
    hasReal: vi.fn(),
  },
}));

vi.mock('../../config', () => ({
  getConfig: () => ({ ai: { openaiTtsModel: 'tts-1', openaiTtsVoice: 'alloy' } }),
}));

describe('text-to-speech provider registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists all providers: self-hosted first, then openai, then openrouter', () => {
    // Order matters: first configured wins, so a free self-hosted endpoint
    // must outrank paid keys when both are present.
    expect(TTS_PROVIDER_REGISTRY.map((p) => p.id)).toEqual(['self-hosted-tts', 'openai', 'openrouter']);
    for (const descriptor of TTS_PROVIDER_REGISTRY) {
      expect(descriptor.capabilities).toContain('text-to-speech');
    }
  });

  it('reports unconfigured when no OPENAI_API_KEY is present', async () => {
    vi.mocked(secretsManager.hasReal).mockResolvedValue(false);
    expect(await isTextToSpeechConfigured()).toBe(false);
    await expect(resolveTextToSpeechProvider()).rejects.toBeInstanceOf(NoProviderConfiguredError);
  });

  it('resolves the OpenAI text-to-speech provider when credentials are present', async () => {
    vi.mocked(secretsManager.hasReal).mockResolvedValue(true);
    vi.mocked(secretsManager.get).mockResolvedValue('sk-test');

    const provider = await resolveTextToSpeechProvider();
    expect(provider.id).toBe('openai');
    expect(provider.capabilities).toContain('text-to-speech');
  });

  it('resolves OpenRouter when explicitly selected', async () => {
    vi.mocked(secretsManager.hasReal).mockResolvedValue(true);
    vi.mocked(secretsManager.get).mockResolvedValue('test-key');

    const provider = await resolveTextToSpeechProvider({ explicitProviderId: 'openrouter' });
    expect(provider.id).toBe('openrouter');
    expect(provider.capabilities).toContain('text-to-speech');
  });
});
