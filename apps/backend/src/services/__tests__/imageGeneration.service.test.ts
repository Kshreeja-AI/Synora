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
});
