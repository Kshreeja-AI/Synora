import { logger } from '../utils/logger';
import { videoGenerationService } from '../services/videoGeneration.service';

export interface VideoGenerationJobData {
  videoId: string;
}

// Steady-state polling interval once a job is confirmed in flight — see
// videoGeneration.service.ts's INITIAL_POLL_DELAY_MS for the first poll.
const POLL_INTERVAL_MS = 10000;

export async function processVideoGeneration(data: VideoGenerationJobData): Promise<void> {
  const { videoId } = data;
  logger.info('[VideoGenerationWorker] Processing video', { videoId });

  try {
    const result = await videoGenerationService.pollAndFinalize(videoId);
    logger.info('[VideoGenerationWorker] Video processed', {
      videoId,
      status: result.status,
    });

    if (result.status === 'PROCESSING') {
      // Still in flight at the provider — schedule the next poll rather
      // than treating "not ready yet" as a job failure (which would burn
      // through BullMQ's retry budget instead of just waiting).
      const { enqueueVideoGeneration } = await import('./queue');
      await enqueueVideoGeneration({ videoId }, { delayMs: POLL_INTERVAL_MS });
    }
  } catch (error) {
    logger.error('[VideoGenerationWorker] Failed to process video', {
      videoId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
