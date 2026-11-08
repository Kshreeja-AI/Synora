/**
 * Self-hosted TTS descriptor. Proves configuration gating and wiring only;
 * it says nothing about whether any language or voice sounds right on a real
 * server — that needs a live synthesis.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getConfigMock } = vi.hoisted(() => ({ getConfigMock: vi.fn() }));

vi.mock('../../config', () => ({ getConfig: getConfigMock }));
vi.mock('openai', () => ({
  default: class {
    constructor(public opts: { apiKey: string; baseURL: string }) {}
  },
}));
vi.mock('../../secrets', () => ({ secretsManager: { hasReal: vi.fn(), get: vi.fn() } }));

import { selfHostedTextToSpeechDescriptor } from './selfHostedTextToSpeech.provider';
import { OpenAITextToSpeechProvider } from './openaiTextToSpeech.provider';

const ai = (over: Record<string, unknown> = {}) => ({
  ai: { ttsSelfHostedModel: 'kokoro', ttsSelfHostedVoice: 'af_heart', ...over },
});

describe('selfHostedTextToSpeechDescriptor', () => {
  beforeEach(() => getConfigMock.mockReset());

  it('is configured only when TTS_SELF_HOSTED_BASE_URL is set', async () => {
    getConfigMock.mockReturnValue(ai());
    expect(await selfHostedTextToSpeechDescriptor.isConfigured()).toBe(false);
    getConfigMock.mockReturnValue(ai({ ttsSelfHostedBaseUrl: 'http://tts.local/v1' }));
    expect(await selfHostedTextToSpeechDescriptor.isConfigured()).toBe(true);
  });

  it('refuses to create a provider without a base URL', async () => {
    getConfigMock.mockReturnValue(ai());
    await expect(selfHostedTextToSpeechDescriptor.create()).rejects.toThrow(/TTS_SELF_HOSTED_BASE_URL/);
  });

  it('creates the shared SDK-backed provider under its own id', async () => {
    getConfigMock.mockReturnValue(ai({ ttsSelfHostedBaseUrl: 'http://tts.local/v1' }));
    const provider = await selfHostedTextToSpeechDescriptor.create();
    expect(provider).toBeInstanceOf(OpenAITextToSpeechProvider);
    expect(provider.id).toBe('self-hosted-tts');
  });
});
