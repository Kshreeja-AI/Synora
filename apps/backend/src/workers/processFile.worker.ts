/**
 * File-processing worker: virus scan + content extraction for
 * uploaded conversation files.
 *
 * Enqueued via `enqueueFileProcessing` in workers/queue.ts (BullMQ,
 * 3 attempts with exponential backoff) and executed by the worker
 * registered in `setupWorkers`. `fileService.processFile` records
 * PROCESSING → COMPLETED/FAILED transitions on the file row itself,
 * and rethrows on failure so the queue's retry policy engages; a
 * successful retry overwrites the FAILED status.
 */

import { FileService } from '../files/file.service';
import { LocalStorageProvider } from '../files/storageProviders';
import { logger } from '../utils/logger';

export interface ProcessFileJobData {
  fileId: string;
  conversationId: string;
  workspaceId: string;
}

const fileService = new FileService(new LocalStorageProvider());

export async function processFileJob(data: ProcessFileJobData): Promise<void> {
  const { fileId } = data;

  logger.info('[FileWorker] Processing file', { fileId });
  await fileService.processFile(fileId);
  logger.info('[FileWorker] File processing completed', { fileId });
}
