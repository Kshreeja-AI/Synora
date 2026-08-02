import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioGenerationService } from '../audioGeneration.service';
import { resolveTextToSpeechProvider, NoProviderConfiguredError } from '../../ai';
import { resolveStorageProvider } from '../../storage';

/**
 * Same property as imageGeneration.service.test.ts: text-to-speech is
 * either real end-to-end or it fails honestly. It must never write a
 * fabricated URL with a COMPLETED status. No provider configured -> 503
 * upstream; generation/storage failure -> FAILED, never COMPLETED junk.
 */

vi.mock('../../ai', () => ({
  resolveTextToSpeechProvider: vi.fn(),
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
    generatedAudio: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const validSpeech = {
  audio: Buffer.from('fake-mp3-bytes'),
  mimeType: 'audio/mpeg',
  provider: 'openai',
  model: 'tts-1',
  voice: 'alloy',
};

async function fakeCreate(data: Record<string, unknown>) {
  const { prisma } = await import('@synora/database');
  vi.mocked(prisma.generatedAudio.create).mockResolvedValue({ id: 'aud-1', ...data } as never);
}

describe('AudioGenerationService', () => {
  let service: AudioGenerationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AudioGenerationService();
  });

  it('synthesizes real bytes, stores them, and records COMPLETED with the durable URL', async () => {
    const { prisma } = await import('@synora/database');
    await fakeCreate({});

    const synthesize = vi.fn().mockResolvedValue(validSpeech);
    vi.mocked(resolveTextToSpeechProvider).mockResolvedValue({
      id: 'openai',
      capabilities: ['text-to-speech'],
      synthesize,
    } as never);

    const upload = vi.fn().mockResolvedValue({ key: 'k', url: 'https://cdn.example.com/aud-1.mp3' });
    vi.mocked(resolveStorageProvider).mockResolvedValue({ id: 'local', upload, delete: vi.fn() } as never);

    vi.mocked(prisma.generatedAudio.update).mockResolvedValue({
      id: 'aud-1',
      audioUrl: 'https://cdn.example.com/aud-1.mp3',
      status: 'COMPLETED',
    } as never);

    const result = await service.generate({ userId: 'u-1', text: 'Hello world' });

    expect(synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello world' })
    );
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'generated-audio/u-1/aud-1.mp3',
        contentType: 'audio/mpeg',
      })
    );
    const finalUpdate = vi.mocked(prisma.generatedAudio.update).mock.calls[0][0].data;
    expect(finalUpdate).toMatchObject({
      audioUrl: 'https://cdn.example.com/aud-1.mp3',
      model: 'openai:tts-1',
      status: 'COMPLETED',
    });
    expect(finalUpdate.audioUrl).not.toMatch(/placeholder/);
    expect(result.status).toBe('COMPLETED');
  });

  it('uses the requested format for the storage key extension and content type', async () => {
    const { prisma } = await import('@synora/database');
    await fakeCreate({});

    vi.mocked(resolveTextToSpeechProvider).mockResolvedValue({
      id: 'openai',
      capabilities: ['text-to-speech'],
      synthesize: vi.fn().mockResolvedValue({ ...validSpeech, mimeType: 'audio/wav' }),
    } as never);

    const upload = vi.fn().mockResolvedValue({ key: 'k', url: 'https://cdn.example.com/aud-1.wav' });
    vi.mocked(resolveStorageProvider).mockResolvedValue({ id: 'local', upload, delete: vi.fn() } as never);
    vi.mocked(prisma.generatedAudio.update).mockResolvedValue({ id: 'aud-1', status: 'COMPLETED' } as never);

    await service.generate({ userId: 'u-1', text: 'Hello', format: 'wav' });

    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'generated-audio/u-1/aud-1.wav', contentType: 'audio/wav' })
    );
  });

  it('propagates NoProviderConfiguredError so the route can return 503, and never writes to the DB', async () => {
    const { prisma } = await import('@synora/database');
    vi.mocked(resolveTextToSpeechProvider).mockRejectedValue(
      new NoProviderConfiguredError('text-to-speech', ['openai'])
    );

    await expect(service.generate({ userId: 'u-1', text: 'anything' })).rejects.toBeInstanceOf(
      NoProviderConfiguredError
    );
    expect(vi.mocked(prisma.generatedAudio.create)).not.toHaveBeenCalled();
  });

  it('records FAILED (never COMPLETED with junk) when the provider errors', async () => {
    const { prisma } = await import('@synora/database');
    await fakeCreate({});

    vi.mocked(resolveTextToSpeechProvider).mockResolvedValue({
      id: 'openai',
      capabilities: ['text-to-speech'],
      synthesize: vi.fn().mockRejectedValue(new Error('rate limited')),
    } as never);
    vi.mocked(resolveStorageProvider).mockResolvedValue({ id: 'local', upload: vi.fn(), delete: vi.fn() } as never);

    await expect(service.generate({ userId: 'u-1', text: 'x' })).rejects.toThrow(/rate limited/);

    const update = vi.mocked(prisma.generatedAudio.update).mock.calls[0][0];
    expect(update.data).toMatchObject({ status: 'FAILED' });
  });

  it('records FAILED when storage fails after a successful synthesis (never claims success)', async () => {
    const { prisma } = await import('@synora/database');
    await fakeCreate({});

    vi.mocked(resolveTextToSpeechProvider).mockResolvedValue({
      id: 'openai',
      capabilities: ['text-to-speech'],
      synthesize: vi.fn().mockResolvedValue(validSpeech),
    } as never);
    vi.mocked(resolveStorageProvider).mockResolvedValue({
      id: 'local',
      upload: vi.fn().mockRejectedValue(new Error('disk full')),
      delete: vi.fn(),
    } as never);

    await expect(service.generate({ userId: 'u-1', text: 'x' })).rejects.toThrow(/disk full/);
    expect(vi.mocked(prisma.generatedAudio.update).mock.calls[0][0].data).toMatchObject({
      status: 'FAILED',
    });
  });
});
