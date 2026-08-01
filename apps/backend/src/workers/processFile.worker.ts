import { prisma } from '@synora/database';
import { FileService } from '../files/file.service';
import { LocalStorageProvider } from '../files/storageProviders';
import { logger } from '../utils/logger';

export interface ProcessFileJobData {
  fileId: string;
  conversationId: string;
  workspaceId: string;
  attempt?: number;
}

export interface QueueJob {
  id: string | number;
  data: ProcessFileJobData;
  progress(percent: number): void;
}

export type QueueProcessor = (job: QueueJob) => Promise<unknown>;

const fileService = new FileService(new LocalStorageProvider());

export function createFileProcessingWorker(): QueueProcessor {
  return async (job: QueueJob) => {
    const { fileId } = job.data;
    const attempt = job.data.attempt || 1;

    try {
      logger.info('[FileWorker] Processing file', {
        jobId: job.id,
        fileId,
        attempt,
      });

      // Process the file
      await fileService.processFile(fileId);

      logger.info('[FileWorker] File processing completed', {
        jobId: job.id,
        fileId,
      });

      return { success: true, fileId };
    } catch (error: any) {
      logger.error('[FileWorker] File processing failed', {
        jobId: job.id,
        fileId,
        attempt,
        error: error.message,
      });

      // Mark job for retry
      if (attempt < 3) {
        throw error; // Queue will retry with backoff
      }

      // After 3 attempts, mark as failed in database
      await prisma.conversationFile.update({
        where: { id: fileId },
        data: {
          processingStatus: 'FAILED',
          processingError: `Failed after ${attempt} attempts: ${error.message}`,
        },
      });

      return { success: false, fileId, error: error.message };
    }
  };
}

export async function enqueueFileProcessing(
  fileId: string,
  _conversationId: string,
  _workspaceId: string
): Promise<void> {
  // Mark file as pending processing
  // In production, this would enqueue to a job queue (Bull, etc)
  // For now, process synchronously in background
  setImmediate(async () => {
    try {
      await fileService.processFile(fileId);
    } catch (error: any) {
      logger.error('[FileWorker] Background processing failed', { fileId, error: error.message });
    }
  });

  logger.info('[FileWorker] Processing job enqueued', { fileId });
}
