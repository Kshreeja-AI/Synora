import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolveEmbeddingProvider } from '../resolver';
import { initConfig, __resetConfigForTests } from '../../config';
import { EmbeddingProviderUnsupportedError } from '../types';

describe('resolveEmbeddingProvider', () => {
  const previousKey = process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    // No SDK/HTTP call is made by resolution itself — descriptor.create()
    // only constructs the vendor client. A fake key is enough to exercise
    // real auto-detection with no network I/O.
    process.env.OPENAI_API_KEY = 'test-key-not-real';
    await initConfig();
  });

  afterAll(() => {
    process.env.OPENAI_API_KEY = previousKey;
    __resetConfigForTests();
  });

  it('auto-detects the first configured provider (OpenAI, given only its key is set)', async () => {
    const provider = await resolveEmbeddingProvider();
    expect(provider.id).toBe('openai');
  });

  it('honors an explicit provider id, taking priority over auto-detection', async () => {
    // Auto-detection would pick openai (only configured provider); explicit override still wins.
    process.env.GOOGLE_AI_API_KEY = 'test-key-not-real';
    await initConfig();
    try {
      const provider = await resolveEmbeddingProvider({ explicitProviderId: 'gemini' });
      expect(provider.id).toBe('gemini');
    } finally {
      delete process.env.GOOGLE_AI_API_KEY;
      await initConfig();
    }
  });

  it('throws a clear, source-labeled error for an unknown explicit provider id', async () => {
    await expect(
      resolveEmbeddingProvider({ explicitProviderId: 'not-a-real-provider' })
    ).rejects.toThrow(/is set to a value that is not a known embedding provider/i);
  });

  it('throws EmbeddingProviderUnsupportedError when explicitly requesting claude', async () => {
    await expect(resolveEmbeddingProvider({ explicitProviderId: 'claude' })).rejects.toThrow(
      EmbeddingProviderUnsupportedError
    );
  });

  it('throws a clear error when the explicit provider is not configured', async () => {
    // Unlike secret-backed providers (voyage/cohere/openai/gemini), whose
    // "unconfigured" secrets fall back to a generated placeholder value in
    // development/testing (making isConfigured() true), ollama's
    // isConfigured() checks a plain config field with no such fallback —
    // it is genuinely unconfigured whenever EMBEDDING_OLLAMA_BASE_URL isn't set.
    await expect(resolveEmbeddingProvider({ explicitProviderId: 'ollama' })).rejects.toThrow(
      /is not configured/
    );
  });
});
