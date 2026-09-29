import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ImageGenerationService } from '../imageGeneration.service';
import { resolveImageProvider, NoProviderConfiguredError } from '../../ai';
import { resolveStorageProvider } from '../../storage';

/**
 * The property under test: image generation is either real end-to-end or it
 * fails honestly. It must NEVER write a fabricated URL and a COMPLETED
 * status — the previous route did exactly that (via.placeholder.com,
 * model:'placeholder'), which is the class of "fake integration" the
 * constitution forbids. If a provider isn't configured, callers see 503;
 * if generation fails, the DB row is FAILED, never COMPLETED with junk.
 */

vi.mock('../../ai', () => ({
  resolveImageProvider: vi.fn(),
  NoProviderConfiguredError: class extends Error {
    constructor(
      readonly capability?: string,
      readonly checkedProviders?: readonly string[]
    ) {
      super('no provider');
      this.name = 'NoProviderConfiguredError';
    }
  },
}));

vi.mock('../../storage', () => ({
  resolveStorageProvider: vi.fn(),
}));

vi.mock('@synora/database', () => ({
  prisma: {
    generatedImage: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const validImage = {
  images: [
    {
      base64: Buffer.from('fake-png-bytes').toString('base64'),
      mimeType: 'image/png',
      width: 1024,
      height: 1024,
    },
  ],
  provider: 'openai',
  model: 'gpt-image-1',
};

async function fakeCreate(data: Record<string, unknown>) {
  const { prisma } = await import('@synora/database');
  vi.mocked(prisma.generatedImage.create).mockResolvedValue({ id: 'img-1', ...data } as never);
}

describe('ImageGenerationService', () => {
  let service: ImageGenerationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ImageGenerationService();
  });

  it('generates real bytes, stores them, and records COMPLETED with the durable URL', async () => {
    const { prisma } = await import('@synora/database');
    await fakeCreate({});

    const generate = vi.fn().mockResolvedValue(validImage);
    vi.mocked(resolveImageProvider).mockResolvedValue({
      id: 'openai',
      capabilities: ['image-generation'],
      generateImages: generate,
    } as never);

    const upload = vi.fn().mockResolvedValue({ key: 'k', url: 'https://cdn.example.com/img-1.png' });
    vi.mocked(resolveStorageProvider).mockResolvedValue({ id: 'local', upload, delete: vi.fn() } as never);

    vi.mocked(prisma.generatedImage.update).mockResolvedValue({
      id: 'img-1',
      imageUrl: 'https://cdn.example.com/img-1.png',
      status: 'COMPLETED',
    } as never);

    const result = await service.generate({ userId: 'u-1', prompt: 'a corgi' });

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'a corgi', count: 1 }));
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'generated-images/u-1/img-1.png',
        contentType: 'image/png',
      })
    );
    const finalUpdate = vi.mocked(prisma.generatedImage.update).mock.calls[0][0].data;
    expect(finalUpdate).toMatchObject({
      imageUrl: 'https://cdn.example.com/img-1.png',
      width: 1024,
      height: 1024,
      model: 'openai:gpt-image-1',
      status: 'COMPLETED',
    });
    expect(finalUpdate.imageUrl).not.toMatch(/placeholder|via\.placeholder/);
    expect(result.status).toBe('COMPLETED');
  });

  it('propagates NoProviderConfiguredError so the route can return 503, and never writes to the DB', async () => {
    const { prisma } = await import('@synora/database');
    vi.mocked(resolveImageProvider).mockRejectedValue(
      new NoProviderConfiguredError('image-generation', ['openai'])
    );

    await expect(service.generate({ userId: 'u-1', prompt: 'anything' })).rejects.toBeInstanceOf(
      NoProviderConfiguredError
    );
    expect(vi.mocked(prisma.generatedImage.create)).not.toHaveBeenCalled();
  });

  it('records FAILED (never COMPLETED with junk) when the provider errors', async () => {
    const { prisma } = await import('@synora/database');
    await fakeCreate({});

    vi.mocked(resolveImageProvider).mockResolvedValue({
      id: 'openai',
      capabilities: ['image-generation'],
      generateImages: vi.fn().mockRejectedValue(new Error('rate limited')),
    } as never);
    vi.mocked(resolveStorageProvider).mockResolvedValue({ id: 'local', upload: vi.fn(), delete: vi.fn() } as never);

    await expect(service.generate({ userId: 'u-1', prompt: 'x' })).rejects.toThrow(/rate limited/);

    const update = vi.mocked(prisma.generatedImage.update).mock.calls[0][0];
    expect(update.data).toMatchObject({ status: 'FAILED' });
  });

  it('records FAILED when storage fails after a successful generation (never claims success)', async () => {
    const { prisma } = await import('@synora/database');
    await fakeCreate({});

    vi.mocked(resolveImageProvider).mockResolvedValue({
      id: 'openai',
      capabilities: ['image-generation'],
      generateImages: vi.fn().mockResolvedValue(validImage),
    } as never);
    vi.mocked(resolveStorageProvider).mockResolvedValue({
      id: 'local',
      upload: vi.fn().mockRejectedValue(new Error('disk full')),
      delete: vi.fn(),
    } as never);

    await expect(service.generate({ userId: 'u-1', prompt: 'x' })).rejects.toThrow(/disk full/);
    expect(vi.mocked(prisma.generatedImage.update).mock.calls[0][0].data).toMatchObject({
      status: 'FAILED',
    });
  });

  describe('EOS instrumentation', () => {
    it('reports a successful generation to the provider observatory', async () => {
      const { prisma } = await import('@synora/database');
      const { getProviderMatrix, startProviderObservatory, stopProviderObservatory } = await import(
        '../../eos/provider-observatory'
      );
      await fakeCreate({});

      vi.mocked(resolveImageProvider).mockResolvedValue({
        id: 'openai',
        capabilities: ['image-generation'],
        generateImages: vi.fn().mockResolvedValue(validImage),
      } as never);
      vi.mocked(resolveStorageProvider).mockResolvedValue({
        id: 'local',
        upload: vi.fn().mockResolvedValue({ key: 'k', url: 'https://cdn.example.com/img-1.png' }),
        delete: vi.fn(),
      } as never);
      vi.mocked(prisma.generatedImage.update).mockResolvedValue({ id: 'img-1' } as never);

      stopProviderObservatory();
      startProviderObservatory();
      try {
        await service.generate({ userId: 'u-1', prompt: 'a corgi' });

        const matrix = getProviderMatrix();
        expect(matrix).toHaveLength(1);
        expect(matrix[0]).toMatchObject({
          providerId: 'openai',
          modelId: 'gpt-image-1',
          requests: 1,
          successRate: 1,
        });
        // Image generation is not token-priced, so no fabricated cost is
        // recorded — absence must not become a misleading zero.
        expect(matrix[0].totalCostCents).toBe(0);
        expect(matrix[0].totalInputTokens).toBe(0);
      } finally {
        stopProviderObservatory();
      }
    });

    it('reports a provider failure with its error code', async () => {
      const { prisma } = await import('@synora/database');
      const { getProviderMatrix, startProviderObservatory, stopProviderObservatory } = await import(
        '../../eos/provider-observatory'
      );
      await fakeCreate({});

      vi.mocked(resolveImageProvider).mockResolvedValue({
        id: 'openai',
        capabilities: ['image-generation'],
        generateImages: vi.fn().mockRejectedValue(new Error('rate limited')),
      } as never);
      vi.mocked(resolveStorageProvider).mockResolvedValue({
        id: 'local',
        upload: vi.fn(),
        delete: vi.fn(),
      } as never);
      vi.mocked(prisma.generatedImage.update).mockResolvedValue({ id: 'img-1' } as never);

      stopProviderObservatory();
      startProviderObservatory();
      try {
        await expect(service.generate({ userId: 'u-1', prompt: 'x' })).rejects.toThrow();

        const matrix = getProviderMatrix();
        expect(matrix).toHaveLength(1);
        expect(matrix[0].failures).toBe(1);
        expect(matrix[0].successRate).toBe(0);
        // The model is unknown on this path — the provider never reported
        // which one it would have used, and guessing would fabricate data.
        expect(matrix[0].modelId).toBe('unknown');
        expect(matrix[0].errorCodes.Error).toBe(1);
      } finally {
        stopProviderObservatory();
      }
    });

    it('instrumentation failure never breaks image generation', async () => {
      const { prisma } = await import('@synora/database');
      const { engineeringEventBus } = await import('../../eos/event-bus');
      await fakeCreate({});

      vi.mocked(resolveImageProvider).mockResolvedValue({
        id: 'openai',
        capabilities: ['image-generation'],
        generateImages: vi.fn().mockResolvedValue(validImage),
      } as never);
      vi.mocked(resolveStorageProvider).mockResolvedValue({
        id: 'local',
        upload: vi.fn().mockResolvedValue({ key: 'k', url: 'https://cdn.example.com/img-1.png' }),
        delete: vi.fn(),
      } as never);
      vi.mocked(prisma.generatedImage.update).mockResolvedValue({
        id: 'img-1',
        status: 'COMPLETED',
      } as never);

      const unsub = engineeringEventBus.on('ai.provider.observation', () => {
        throw new Error('observability exploded');
      });
      try {
        // Observability must never be able to fail a customer request.
        const result = await service.generate({ userId: 'u-1', prompt: 'a corgi' });
        expect(result.status).toBe('COMPLETED');
      } finally {
        unsub();
      }
    });
  });
});

/**
 * Cost reporting for a capability the provider never prices.
 *
 * An image comes back as an image — no cost figure attached. So the only
 * honest options are a published per-image rate or nothing at all. These
 * assert both, and that the resulting figure is never mistaken for token
 * pricing, which is what the old inference would have done the moment a
 * cost appeared here.
 */
describe('ImageGenerationService cost reporting', () => {
  let service: ImageGenerationService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { resetMediaPrices } = await import('../../eos/media-pricing');
    const { stopProviderObservatory } = await import('../../eos/provider-observatory');
    resetMediaPrices();
    stopProviderObservatory();
    service = new ImageGenerationService();
  });

  async function runGeneration() {
    const { prisma } = await import('@synora/database');
    await fakeCreate({});
    vi.mocked(resolveImageProvider).mockResolvedValue({
      id: 'openai',
      capabilities: ['image-generation'],
      generateImages: vi.fn().mockResolvedValue(validImage),
    } as never);
    vi.mocked(resolveStorageProvider).mockResolvedValue({
      id: 'local',
      upload: vi.fn().mockResolvedValue({ key: 'k', url: 'https://cdn.example.com/i.png' }),
      delete: vi.fn(),
    } as never);
    vi.mocked(prisma.generatedImage.update).mockResolvedValue({ id: 'img-1' } as never);
    await service.generate({ userId: 'u-1', prompt: 'a cat' });
  }

  it('reports no cost at all when no published rate is on record', async () => {
    const { startProviderObservatory, getProviderMatrix } = await import('../../eos/provider-observatory');
    startProviderObservatory();

    await runGeneration();

    const entry = getProviderMatrix()[0];
    expect(entry.totalCostCents).toBe(0);
    // Absent basis, not a cost of zero — the distinction the whole cost
    // layer is built around.
    expect(entry.pricingBasis).toBeUndefined();
    expect(entry.tokenPriced).toBe(false);
  });

  it('prices per image once a rate exists, and never as token pricing', async () => {
    const { startProviderObservatory, getProviderMatrix } = await import('../../eos/provider-observatory');
    const { registerMediaPrice } = await import('../../eos/media-pricing');
    startProviderObservatory();
    registerMediaPrice({
      providerId: 'openai',
      modelId: 'gpt-image-1',
      basis: 'per-image',
      centsPerUnit: 4,
      statedOn: '2026-08-01',
      source: 'test rate card',
    });

    await runGeneration();

    const entry = getProviderMatrix()[0];
    expect(entry.totalCostCents).toBe(4);
    expect(entry.pricingBasis).toBe('per-image');
    expect(entry.costProvenance).toBe('stated');
    expect(entry.tokenPriced).toBe(false);
  });

  it('reports no cost on a failed generation', async () => {
    const { prisma } = await import('@synora/database');
    const { startProviderObservatory, getProviderMatrix } = await import('../../eos/provider-observatory');
    const { registerMediaPrice } = await import('../../eos/media-pricing');
    startProviderObservatory();
    registerMediaPrice({
      providerId: 'openai',
      modelId: 'gpt-image-1',
      basis: 'per-image',
      centsPerUnit: 4,
      statedOn: '2026-08-01',
      source: 'test rate card',
    });

    await fakeCreate({});
    vi.mocked(resolveImageProvider).mockResolvedValue({
      id: 'openai',
      capabilities: ['image-generation'],
      generateImages: vi.fn().mockRejectedValue(new Error('quota exceeded')),
    } as never);
    vi.mocked(resolveStorageProvider).mockResolvedValue({
      id: 'local',
      upload: vi.fn(),
      delete: vi.fn(),
    } as never);
    vi.mocked(prisma.generatedImage.update).mockResolvedValue({ id: 'img-1' } as never);

    await expect(service.generate({ userId: 'u-1', prompt: 'a cat' })).rejects.toThrow();

    // No image was produced, so no per-image charge is claimed — even
    // though a rate exists and the model is known.
    const entry = getProviderMatrix()[0];
    expect(entry.totalCostCents).toBe(0);
  });
});
