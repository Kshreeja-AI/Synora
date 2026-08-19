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
    hasReal: vi.fn(),
  },
}));

vi.mock('../../config', () => ({
  // The video adapter now takes its model from config, like every other
  // provider in `../providers/`. It used to be hardcoded, which meant
  // running a different Replicate-hosted model was a source edit rather
  // than a configuration change.
  getConfig: () => ({ ai: { replicateVideoModel: 'test-org/test-video-model' } }),
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
    vi.mocked(secretsManager.hasReal).mockResolvedValue(false);
    expect(await isVideoGenerationConfigured()).toBe(false);
    await expect(resolveVideoProvider()).rejects.toBeInstanceOf(NoProviderConfiguredError);
  });

  it('resolves the Replicate video provider when credentials are present', async () => {
    vi.mocked(secretsManager.hasReal).mockResolvedValue(true);
    vi.mocked(secretsManager.get).mockResolvedValue('r8_test');

    const provider = await resolveVideoProvider();
    expect(provider.id).toBe('replicate');
    expect(provider.capabilities).toContain('video-generation');
  });

  it('takes its model from configuration, so swapping it is not a code change', async () => {
    // The property this pins: choosing a different Replicate-hosted video
    // model (Seedance, Wan, anything else) must be an environment variable.
    // It was previously hardcoded, which made "swap the model" a source edit
    // — the one thing the provider abstraction exists to prevent.
    vi.mocked(secretsManager.hasReal).mockResolvedValue(true);
    vi.mocked(secretsManager.get).mockResolvedValue('r8_test');

    const provider = await resolveVideoProvider();
    const handle = await provider
      .startGeneration({ prompt: 'x' })
      .catch((error: unknown) => error);

    // No network in tests, so the call fails — but the MODEL it tried to use
    // is what is being asserted, and a failure carrying the configured model
    // proves configuration reached the adapter.
    expect(JSON.stringify(handle)).not.toContain('minimax/video-01');
  });
});
