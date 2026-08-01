import { describe, it, expect } from 'vitest';
import { claudeEmbeddingDescriptor } from './claude.provider';
import { EmbeddingProviderUnsupportedError } from '../types';

describe('claudeEmbeddingDescriptor', () => {
  it('reports an unsupportedReason rather than being merely unconfigured', () => {
    expect(claudeEmbeddingDescriptor.unsupportedReason).toBeDefined();
    expect(claudeEmbeddingDescriptor.unsupportedReason).toMatch(/voyage/i);
  });

  it('is never configured, so auto-detection always skips it', async () => {
    expect(await claudeEmbeddingDescriptor.isConfigured()).toBe(false);
  });

  it('throws EmbeddingProviderUnsupportedError if create() is ever called', async () => {
    await expect(claudeEmbeddingDescriptor.create()).rejects.toThrow(EmbeddingProviderUnsupportedError);
  });
});
