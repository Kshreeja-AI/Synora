import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  VIDEO_PROVIDER_REGISTRY,
  resolveVideoProvider,
  isVideoGenerationConfigured,
} from '../videoRegistry';
import { NoProviderConfiguredError } from '../types';
import { secretsManager } from '../../secrets';

vi.mock('../../secrets', () => ({
  secretsManager: {
    tryGet: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock('../../config', () => ({
  getConfig: () => ({}),
}));

describe('video generation provider registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes Replicate as a video provider', () => {
    expect(VIDEO_PROVIDER_REGISTRY.map((p) => p.id)).toEqual(['replicate']);
    expect(VIDEO_PROVIDER_REGISTRY[0].capabilities).toContain('video-generation');
  });

  it('reports unconfigured when no REPLICATE_API_KEY is present', async () => {
    vi.mocked(secretsManager.tryGet).mockResolvedValue(undefined);
    expect(await isVideoGenerationConfigured()).toBe(false);
    await expect(resolveVideoProvider()).rejects.toBeInstanceOf(NoProviderConfiguredError);
  });

  it('resolves the Replicate video provider when credentials are present', async () => {
    vi.mocked(secretsManager.tryGet).mockResolvedValue('r8_test');
    vi.mocked(secretsManager.get).mockResolvedValue('r8_test');

    const provider = await resolveVideoProvider();
    expect(provider.id).toBe('replicate');
    expect(provider.capabilities).toContain('video-generation');
  });
});
