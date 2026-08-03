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
  describe('EOS instrumentation', () => {
    it('reports a successful synthesis with no fabricated token or cost figures', async () => {
      const { prisma } = await import('@synora/database');
      const { getProviderMatrix, startProviderObservatory, stopProviderObservatory } = await import(
        '../../eos/provider-observatory'
      );
      await fakeCreate({});

      vi.mocked(resolveTextToSpeechProvider).mockResolvedValue({
        id: 'openai',
        capabilities: ['text-to-speech'],
        synthesize: vi.fn().mockResolvedValue(validSpeech),
      } as never);
      vi.mocked(resolveStorageProvider).mockResolvedValue({
        id: 'local',
        upload: vi.fn().mockResolvedValue({ key: 'k', url: 'https://cdn.example/a.mp3' }),
        delete: vi.fn(),
      } as never);
      vi.mocked(prisma.generatedAudio.update).mockResolvedValue({ id: 'aud-1' } as never);

      stopProviderObservatory();
      startProviderObservatory();
      try {
        await service.generate({ userId: 'u-1', text: 'hello' });

        const matrix = getProviderMatrix();
        expect(matrix).toHaveLength(1);
        expect(matrix[0]).toMatchObject({ providerId: 'openai', modelId: 'tts-1', successRate: 1 });
        // Speech is priced per character, so tokens and cost stay absent
        // rather than becoming zeroes that would read as "free".
        expect(matrix[0].totalInputTokens).toBe(0);
        expect(matrix[0].totalCostCents).toBe(0);
      } finally {
        stopProviderObservatory();
      }
    });

    it('reports a failure with its error code and an unknown model', async () => {
      const { prisma } = await import('@synora/database');
      const { getProviderMatrix, startProviderObservatory, stopProviderObservatory } = await import(
        '../../eos/provider-observatory'
      );
      await fakeCreate({});

      vi.mocked(resolveTextToSpeechProvider).mockResolvedValue({
        id: 'openai',
        capabilities: ['text-to-speech'],
        synthesize: vi.fn().mockRejectedValue(new Error('quota exceeded')),
      } as never);
      vi.mocked(resolveStorageProvider).mockResolvedValue({
        id: 'local',
        upload: vi.fn(),
        delete: vi.fn(),
      } as never);
      vi.mocked(prisma.generatedAudio.update).mockResolvedValue({ id: 'aud-1' } as never);

      stopProviderObservatory();
      startProviderObservatory();
      try {
        await expect(service.generate({ userId: 'u-1', text: 'hello' })).rejects.toThrow();

        const matrix = getProviderMatrix();
        expect(matrix[0].failures).toBe(1);
        // The provider never said which model it would have used, and
        // guessing would put fabricated data in the matrix.
        expect(matrix[0].modelId).toBe('unknown');
        expect(matrix[0].errorCodes.Error).toBe(1);
      } finally {
        stopProviderObservatory();
      }
    });

    it('instrumentation failure never breaks audio generation', async () => {
      const { prisma } = await import('@synora/database');
      const { engineeringEventBus } = await import('../../eos/event-bus');
      await fakeCreate({});

      vi.mocked(resolveTextToSpeechProvider).mockResolvedValue({
        id: 'openai',
        capabilities: ['text-to-speech'],
        synthesize: vi.fn().mockResolvedValue(validSpeech),
      } as never);
      vi.mocked(resolveStorageProvider).mockResolvedValue({
        id: 'local',
        upload: vi.fn().mockResolvedValue({ key: 'k', url: 'https://cdn.example/a.mp3' }),
        delete: vi.fn(),
      } as never);
      vi.mocked(prisma.generatedAudio.update).mockResolvedValue({
        id: 'aud-1',
        status: 'COMPLETED',
      } as never);

      const unsub = engineeringEventBus.on('ai.provider.observation', () => {
        throw new Error('observability exploded');
      });
      try {
        const result = await service.generate({ userId: 'u-1', text: 'hello' });
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
 * Speech synthesis is billed per character and the response carries no cost
 * figure, so the only honest options are a published rate or nothing at
 * all. These assert the platform takes exactly those two options and never
 * the third — a zero, which would read as "free".
 */
describe('AudioGenerationService cost reporting', () => {
  let service: AudioGenerationService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { resetMediaPrices } = await import('../../eos/media-pricing');
    const { stopProviderObservatory } = await import('../../eos/provider-observatory');
    resetMediaPrices();
    stopProviderObservatory();
    service = new AudioGenerationService();
  });

  async function runSynthesis(text: string) {
    const { prisma } = await import('@synora/database');
    await fakeCreate({});
    vi.mocked(resolveTextToSpeechProvider).mockResolvedValue({
      id: 'openai',
      capabilities: ['text-to-speech'],
      synthesize: vi.fn().mockResolvedValue(validSpeech),
    } as never);
    vi.mocked(resolveStorageProvider).mockResolvedValue({
      id: 'local',
      upload: vi.fn().mockResolvedValue({ key: 'k', url: 'https://cdn.example.com/a.mp3' }),
      delete: vi.fn(),
    } as never);
    vi.mocked(prisma.generatedAudio.update).mockResolvedValue({ id: 'aud-1' } as never);
    await service.generate({ userId: 'u-1', text });
  }

  it('reports no cost at all when no published rate is on record', async () => {
    const { startProviderObservatory, getProviderMatrix } = await import('../../eos/provider-observatory');
    startProviderObservatory();

    await runSynthesis('Hello world');

    const entry = getProviderMatrix()[0];
    expect(entry.tokenPriced).toBe(false);
    // Absent, not zero: nobody has told us what a character costs.
    expect(entry.pricingBasis).toBeUndefined();
    expect(entry.costProvenance).toBeUndefined();
  });

  it('prices per character of input once a rate exists, marked as stated', async () => {
    const { startProviderObservatory, getProviderMatrix } = await import('../../eos/provider-observatory');
    const { registerMediaPrice } = await import('../../eos/media-pricing');
    startProviderObservatory();
    registerMediaPrice({
      providerId: 'openai',
      modelId: 'tts-1',
      basis: 'per-character',
      centsPerUnit: 0.01,
      statedOn: '2026-08-01',
      source: 'test rate card',
    });

    await runSynthesis('Hello world'); // 11 characters

    const entry = getProviderMatrix()[0];
    expect(entry.totalCostCents).toBeCloseTo(0.11, 5);
    expect(entry.pricingBasis).toBe('per-character');
    // The figure is real but came from a rate card, not the provider.
    expect(entry.costProvenance).toBe('stated');
    expect(entry.tokenPriced).toBe(false);
  });
});
