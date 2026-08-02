import { logger } from '../utils/logger';
import { videoGenerationService } from '../services/videoGeneration.service';

export interface VideoGenerationJobData {
  videoId: string;
}

export async function processVideoGeneration(data: VideoGenerationJobData): Promise<void> {
  const { videoId } = data;
  logger.info('[VideoGenerationWorker] Processing video', { videoId });

  try {
    const result = await videoGenerationService.pollAndFinalize(videoId);
    logger.info('[VideoGenerationWorker] Video processed', {
      videoId,
      status: result.status,
    });
  } catch (error) {
    logger.error('[VideoGenerationWorker] Failed to process video', {
      videoId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
