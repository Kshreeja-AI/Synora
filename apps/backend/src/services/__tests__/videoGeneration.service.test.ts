import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VideoGenerationService } from '../videoGeneration.service';
import { resolveVideoProvider, NoProviderConfiguredError } from '../../ai';
import { resolveStorageProvider } from '../../storage';

vi.mock('../../ai', () => ({
  resolveVideoProvider: vi.fn(),
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

vi.mock('../../workers/queue', () => ({
  enqueueVideoGeneration: vi.fn().mockResolvedValue('job-1'),
}));

vi.mock('@synora/database', () => ({
  prisma: {
    generatedVideo: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  },
}));

const validHandle = {
  providerJobId: 'job-123',
  provider: 'replicate',
  model: 'minimax/video-01',
};

async function fakeCreate(data: Record<string, unknown>) {
  const { prisma } = await import('@synora/database');
  vi.mocked(prisma.generatedVideo.create).mockResolvedValue({ id: 'vid-1', ...data } as never);
  vi.mocked(prisma.generatedVideo.findUniqueOrThrow).mockResolvedValue({ id: 'vid-1', ...data } as never);
}

describe('VideoGenerationService', () => {
  let service: VideoGenerationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new VideoGenerationService();
  });

  it('starts generation, records PROCESSING, and returns the pending record', async () => {
    const { prisma } = await import('@synora/database');
    await fakeCreate({ status: 'PROCESSING' });

    vi.mocked(resolveVideoProvider).mockResolvedValue({
      id: 'replicate',
      capabilities: ['video-generation'],
      startGeneration: vi.fn().mockResolvedValue(validHandle),
      pollJob: vi.fn(),
      downloadVideo: vi.fn(),
    } as never);

    vi.mocked(prisma.generatedVideo.update).mockResolvedValue({ id: 'vid-1', model: 'replicate:minimax/video-01' } as never);

    const result = await service.startGeneration({ userId: 'u-1', prompt: 'a sunset' });

    expect(prisma.generatedVideo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PROCESSING', prompt: 'a sunset' }),
      })
    );
    expect(prisma.generatedVideo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          model: 'replicate:minimax/video-01',
          providerJobId: 'job-123',
        }),
      })
    );
    expect(result.id).toBe('vid-1');
  });

  it('schedules the first poll after successfully starting generation', async () => {
    await fakeCreate({ status: 'PROCESSING' });

    vi.mocked(resolveVideoProvider).mockResolvedValue({
      id: 'replicate',
      capabilities: ['video-generation'],
      startGeneration: vi.fn().mockResolvedValue(validHandle),
      pollJob: vi.fn(),
      downloadVideo: vi.fn(),
    } as never);

    const { prisma } = await import('@synora/database');
    vi.mocked(prisma.generatedVideo.update).mockResolvedValue({ id: 'vid-1' } as never);

    await service.startGeneration({ userId: 'u-1', prompt: 'a sunset' });

    const { enqueueVideoGeneration } = await import('../../workers/queue');
    expect(enqueueVideoGeneration).toHaveBeenCalledWith(
      { videoId: 'vid-1' },
      expect.objectContaining({ delayMs: expect.any(Number) })
    );
  });

  it('propagates NoProviderConfiguredError so the route can return 503', async () => {
    const { prisma } = await import('@synora/database');
    vi.mocked(resolveVideoProvider).mockRejectedValue(
      new NoProviderConfiguredError('video-generation', ['replicate'])
    );

    await expect(service.startGeneration({ userId: 'u-1', prompt: 'anything' })).rejects.toBeInstanceOf(
      NoProviderConfiguredError
    );
    expect(vi.mocked(prisma.generatedVideo.create)).not.toHaveBeenCalled();
  });

  it('records FAILED when the provider fails to start', async () => {
    const { prisma } = await import('@synora/database');
    await fakeCreate({ status: 'PROCESSING' });

    vi.mocked(resolveVideoProvider).mockResolvedValue({
      id: 'replicate',
      capabilities: ['video-generation'],
      startGeneration: vi.fn().mockRejectedValue(new Error('rate limited')),
      pollJob: vi.fn(),
      downloadVideo: vi.fn(),
    } as never);

    await expect(service.startGeneration({ userId: 'u-1', prompt: 'x' })).rejects.toThrow(/rate limited/);

    const update = vi.mocked(prisma.generatedVideo.update).mock.calls[0][0];
    expect(update.data).toMatchObject({ status: 'FAILED' });
  });

  describe('pollAndFinalize', () => {
    it('polls using the real provider job id, not the internal video id', async () => {
      const { prisma } = await import('@synora/database');
      vi.mocked(prisma.generatedVideo.findUnique).mockResolvedValue({
        id: 'vid-1',
        userId: 'u-1',
        model: 'replicate:minimax/video-01',
        providerJobId: 'real-provider-job-id',
        status: 'PROCESSING',
        pollAttempts: 0,
      } as never);

      const pollJob = vi.fn().mockResolvedValue({ status: 'processing' });
      vi.mocked(resolveVideoProvider).mockResolvedValue({
        id: 'replicate',
        capabilities: ['video-generation'],
        startGeneration: vi.fn(),
        pollJob,
        downloadVideo: vi.fn(),
      } as never);

      vi.mocked(prisma.generatedVideo.update).mockResolvedValue({
        id: 'vid-1',
        status: 'PROCESSING',
        pollAttempts: 1,
      } as never);

      await service.pollAndFinalize('vid-1');

      expect(pollJob).toHaveBeenCalledWith(
        expect.objectContaining({ providerJobId: 'real-provider-job-id' })
      );
    });

    it('marks FAILED instead of polling when providerJobId was never recorded', async () => {
      const { prisma } = await import('@synora/database');
      vi.mocked(prisma.generatedVideo.findUnique).mockResolvedValue({
        id: 'vid-1',
        userId: 'u-1',
        model: 'replicate:minimax/video-01',
        providerJobId: null,
        status: 'PROCESSING',
        pollAttempts: 0,
      } as never);
      vi.mocked(prisma.generatedVideo.update).mockResolvedValue({ id: 'vid-1', status: 'FAILED' } as never);

      const result = await service.pollAndFinalize('vid-1');

      expect(result.status).toBe('FAILED');
      expect(resolveVideoProvider).not.toHaveBeenCalled();
    });

    it('increments pollAttempts while still processing, without changing status', async () => {
      const { prisma } = await import('@synora/database');
      vi.mocked(prisma.generatedVideo.findUnique).mockResolvedValue({
        id: 'vid-1',
        userId: 'u-1',
        model: 'replicate:minimax/video-01',
        providerJobId: 'job-abc',
        status: 'PROCESSING',
        pollAttempts: 3,
      } as never);
      vi.mocked(resolveVideoProvider).mockResolvedValue({
        id: 'replicate',
        capabilities: ['video-generation'],
        startGeneration: vi.fn(),
        pollJob: vi.fn().mockResolvedValue({ status: 'processing' }),
        downloadVideo: vi.fn(),
      } as never);
      vi.mocked(prisma.generatedVideo.update).mockResolvedValue({
        id: 'vid-1',
        status: 'PROCESSING',
        pollAttempts: 4,
      } as never);

      await service.pollAndFinalize('vid-1');

      expect(prisma.generatedVideo.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { pollAttempts: 4 } })
      );
    });

    it('gives up and marks FAILED after exceeding the max poll attempts', async () => {
      const { prisma } = await import('@synora/database');
      vi.mocked(prisma.generatedVideo.findUnique).mockResolvedValue({
        id: 'vid-1',
        userId: 'u-1',
        model: 'replicate:minimax/video-01',
        providerJobId: 'job-abc',
        status: 'PROCESSING',
        pollAttempts: 89,
      } as never);
      vi.mocked(resolveVideoProvider).mockResolvedValue({
        id: 'replicate',
        capabilities: ['video-generation'],
        startGeneration: vi.fn(),
        pollJob: vi.fn().mockResolvedValue({ status: 'processing' }),
        downloadVideo: vi.fn(),
      } as never);
      vi.mocked(prisma.generatedVideo.update).mockResolvedValue({ id: 'vid-1', status: 'FAILED' } as never);

      const result = await service.pollAndFinalize('vid-1');

      expect(result.status).toBe('FAILED');
      expect(prisma.generatedVideo.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'FAILED' } })
      );
    });

    it('downloads video bytes and stores them durably on completion', async () => {
      const { prisma } = await import('@synora/database');
      vi.mocked(prisma.generatedVideo.findUnique).mockResolvedValue({
        id: 'vid-1',
        userId: 'u-1',
        model: 'replicate:minimax/video-01',
        providerJobId: 'job-abc',
        status: 'PROCESSING',
        pollAttempts: 0,
      } as never);

      const download = vi.fn().mockResolvedValue(Buffer.from('fake-mp4'));
      vi.mocked(resolveVideoProvider).mockResolvedValue({
        id: 'replicate',
        capabilities: ['video-generation'],
        startGeneration: vi.fn(),
        pollJob: vi.fn().mockResolvedValue({
          status: 'completed',
          videoUrl: 'https://replicate.delivery/video.mp4',
          width: 1280,
          height: 720,
          durationSeconds: 5,
        }),
        downloadVideo: download,
      } as never);

      const upload = vi.fn().mockResolvedValue({ key: 'k', url: 'https://cdn.example.com/vid-1.mp4' });
      vi.mocked(resolveStorageProvider).mockResolvedValue({ id: 'local', upload, delete: vi.fn() } as never);

      vi.mocked(prisma.generatedVideo.update).mockResolvedValue({
        id: 'vid-1',
        videoUrl: 'https://cdn.example.com/vid-1.mp4',
        status: 'COMPLETED',
      } as never);

      const result = await service.pollAndFinalize('vid-1');

      expect(download).toHaveBeenCalledWith('https://replicate.delivery/video.mp4');
      expect(upload).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'generated-videos/u-1/vid-1.mp4',
          contentType: 'video/mp4',
        })
      );
      expect(result.status).toBe('COMPLETED');
      expect(result.videoUrl).not.toMatch(/replicate\.delivery/);
    });

    it('records FAILED when storage fails after successful generation', async () => {
      const { prisma } = await import('@synora/database');
      vi.mocked(prisma.generatedVideo.findUnique).mockResolvedValue({
        id: 'vid-1',
        userId: 'u-1',
        model: 'replicate:minimax/video-01',
        providerJobId: 'job-abc',
        status: 'PROCESSING',
        pollAttempts: 0,
      } as never);

      vi.mocked(resolveVideoProvider).mockResolvedValue({
        id: 'replicate',
        capabilities: ['video-generation'],
        startGeneration: vi.fn(),
        pollJob: vi.fn().mockResolvedValue({
          status: 'completed',
          videoUrl: 'https://replicate.delivery/video.mp4',
        }),
        downloadVideo: vi.fn().mockResolvedValue(Buffer.from('bytes')),
      } as never);

      vi.mocked(resolveStorageProvider).mockResolvedValue({
        id: 'local',
        upload: vi.fn().mockRejectedValue(new Error('disk full')),
        delete: vi.fn(),
      } as never);

      await expect(service.pollAndFinalize('vid-1')).rejects.toThrow(/disk full/);
      expect(vi.mocked(prisma.generatedVideo.update).mock.calls[0][0].data).toMatchObject({
        status: 'FAILED',
      });
    });
  });
});
