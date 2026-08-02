import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processVideoGeneration } from '../videoGeneration.worker'

vi.mock('../../services/videoGeneration.service', () => ({
  videoGenerationService: {
    pollAndFinalize: vi.fn(),
  },
}))

vi.mock('../queue', () => ({
  enqueueVideoGeneration: vi.fn().mockResolvedValue('job-2'),
}))

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

describe('processVideoGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('schedules the next poll when the video is still PROCESSING', async () => {
    const { videoGenerationService } = await import('../../services/videoGeneration.service')
    vi.mocked(videoGenerationService.pollAndFinalize).mockResolvedValue({
      id: 'vid-1',
      status: 'PROCESSING',
    } as never)

    await processVideoGeneration({ videoId: 'vid-1' })

    const { enqueueVideoGeneration } = await import('../queue')
    expect(enqueueVideoGeneration).toHaveBeenCalledWith(
      { videoId: 'vid-1' },
      expect.objectContaining({ delayMs: expect.any(Number) })
    )
  })

  it('does not schedule another poll once the video is COMPLETED', async () => {
    const { videoGenerationService } = await import('../../services/videoGeneration.service')
    vi.mocked(videoGenerationService.pollAndFinalize).mockResolvedValue({
      id: 'vid-1',
      status: 'COMPLETED',
    } as never)

    await processVideoGeneration({ videoId: 'vid-1' })

    const { enqueueVideoGeneration } = await import('../queue')
    expect(enqueueVideoGeneration).not.toHaveBeenCalled()
  })

  it('does not schedule another poll once the video has FAILED', async () => {
    const { videoGenerationService } = await import('../../services/videoGeneration.service')
    vi.mocked(videoGenerationService.pollAndFinalize).mockResolvedValue({
      id: 'vid-1',
      status: 'FAILED',
    } as never)

    await processVideoGeneration({ videoId: 'vid-1' })

    const { enqueueVideoGeneration } = await import('../queue')
    expect(enqueueVideoGeneration).not.toHaveBeenCalled()
  })

  it('propagates a failure from pollAndFinalize so BullMQ retry/backoff applies', async () => {
    const { videoGenerationService } = await import('../../services/videoGeneration.service')
    vi.mocked(videoGenerationService.pollAndFinalize).mockRejectedValue(new Error('provider unreachable'))

    await expect(processVideoGeneration({ videoId: 'vid-1' })).rejects.toThrow('provider unreachable')
  })
})
