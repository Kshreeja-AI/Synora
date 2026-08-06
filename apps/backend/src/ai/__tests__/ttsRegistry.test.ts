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

  it('exposes OpenAI as a text-to-speech provider (adding another is one descriptor)', () => {
    expect(TTS_PROVIDER_REGISTRY.map((p) => p.id)).toEqual(['openai']);
    expect(TTS_PROVIDER_REGISTRY[0].capabilities).toContain('text-to-speech');
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
});
