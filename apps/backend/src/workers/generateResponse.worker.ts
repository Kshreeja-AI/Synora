/**
 * Bull Queue worker: Generate AI responses with streaming
 */

import { Queue, Worker } from 'bullmq';
import { prisma } from '@synora/database';
import { logger } from '../utils/logger';
import { getStreamingResolver } from '../ai/streaming/resolver';
import { StreamingAccumulator, TokenAccountant } from '../ai/streaming/accumulator';
import { StreamingRetryEngine, StreamingJobStatus } from '../ai/streaming/statemachine';
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const PROMPT_HISTORY_WINDOW = 50;

interface GenerateResponseJob {
  jobId: string;
  conversationId: string;
  messageId: string;
  userId: string;
  provider: string;
  model: string;
}

export function createGenerateResponseQueue(): Queue<GenerateResponseJob> {
  return new Queue('generate_response', {
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379')
    }
  });
}

export function createGenerateResponseWorker() {
  const queue = createGenerateResponseQueue();
  const retryEngine = new StreamingRetryEngine();
  const resolver = getStreamingResolver();

  const worker = new Worker<GenerateResponseJob>('generate_response', async (bullJob) => {
    const jobData: GenerateResponseJob = bullJob.data;
    const { jobId, conversationId, messageId, userId: _userId, provider, model } = jobData;

    logger.info('[Worker] Processing job', { jobId, conversationId, messageId });

    return await retryEngine.executeWithRetry(
      jobId,
      'generateResponse',
      async (attempt) => {
        const accumulator = new StreamingAccumulator();
        const accountant = new TokenAccountant(model, provider);

        try {
          // Fetch conversation with message history
          const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: {
              messages: {
                where: { deletedAt: null },
                orderBy: { createdAt: 'desc' },
                take: PROMPT_HISTORY_WINDOW
              }
            }
          });

          if (!conversation) {
            throw new Error('Conversation not found');
          }

          // Build message context (reverse chronological)
          const messageHistory = conversation.messages
            .reverse()
            .map(m => ({
              role: m.role as 'user' | 'assistant' | 'system',
              content: m.content
            }));

          // Get provider
          const providerInstance = await resolver.resolve(provider);

          // Create abort controller for cancellation support
          const abortController = new AbortController();

          // Listen for cancel signal
          const cancelSubscription = redis.duplicate();
          cancelSubscription.subscribe(`job:${jobId}:control`).catch((err: Error) => {
            logger.error('[Worker] Subscribe error', { error: err.message });
          });

          cancelSubscription.on('message', (channel: string, message: string) => {
            try {
              const { action } = JSON.parse(message);
              if (action === 'cancel') {
                logger.info('[Worker] Cancel signal received', { jobId });
                abortController.abort();
              }
            } catch (err: unknown) {
              logger.error('[Worker] Parse error', { error: err instanceof Error ? err.message : String(err) });
            }
          });

          // Stream generation
          logger.debug('[Worker] Starting generation stream', {
            jobId,
            provider,
            model,
            messageCount: messageHistory.length
          });

          const timeToFirstToken = Date.now();
          let firstTokenReceived = false;

          for await (const chunk of providerInstance.generateStream({
            messages: messageHistory,
            model,
            maxTokens: 2048,
            abortSignal: abortController.signal
          })) {
            // Check abort
            if (abortController.signal.aborted) {
              logger.info('[Worker] Generation aborted', { jobId });
              break;
            }

            // Process chunk based on type
            if (chunk.type === 'token') {
              if (!firstTokenReceived) {
                const ttft = Date.now() - timeToFirstToken;
                logger.debug('[Worker] First token received', { jobId, ttft });
                firstTokenReceived = true;
              }

              accumulator.addChunk(chunk.token || '');

              // Emit to client via Redis
              await redis.publish(
                `job:${jobId}:stream`,
                JSON.stringify({
                  type: 'token',
                  payload: {
                    token: chunk.token,
                    provider,
                    model
                  }
                })
              );
            } else if (chunk.type === 'usage') {
              accountant.setInputTokens(chunk.inputTokens || 0);
              accountant.incrementOutputTokens(chunk.outputTokens || 0);

              logger.debug('[Worker] Usage data received', {
                jobId,
                inputTokens: chunk.inputTokens,
                outputTokens: chunk.outputTokens
              });
            }

            // Report progress to Bull
            if (accumulator.shouldReportProgress()) {
              await bullJob.updateProgress(Math.min(99, accumulator.getTokenCount() / 2));
              accumulator.markProgressReported();
            }
          }

          // Persist complete message
          const finalText = accumulator.getText();
          const accounting = accountant.getSummary();

          logger.info('[Worker] Persisting message', {
            jobId,
            textLength: finalText.length,
            tokens: accounting.outputTokens
          });

          const totalTokens = accounting.inputTokens + accounting.outputTokens;

          // Message content, its accounting, the job status, and the
          // conversation-level rollup must land together — a partial write
          // would leave usage totals permanently out of step with messages.
          await prisma.$transaction([
            prisma.message.update({
              where: { id: messageId },
              data: {
                content: finalText,
                inputTokens: accounting.inputTokens,
                outputTokens: accounting.outputTokens,
                costCents: accounting.estimatedCostCents,
                provider,
                model
              }
            }),
            prisma.streamingJob.update({
              where: { id: jobId },
              data: {
                messageId,
                status: StreamingJobStatus.COMPLETED,
                completedAt: new Date()
              }
            }),
            prisma.conversationUsage.upsert({
              where: { conversationId },
              create: {
                conversationId,
                inputTokens: accounting.inputTokens,
                outputTokens: accounting.outputTokens,
                totalTokens,
                estimatedCost: accounting.estimatedCostCents
              },
              update: {
                inputTokens: { increment: accounting.inputTokens },
                outputTokens: { increment: accounting.outputTokens },
                totalTokens: { increment: totalTokens },
                estimatedCost: { increment: accounting.estimatedCostCents }
              }
            })
          ]);

          // Emit completion event
          await redis.publish(
            `job:${jobId}:stream`,
            JSON.stringify({
              type: 'done',
              payload: {
                messageId,
                inputTokens: accounting.inputTokens,
                outputTokens: accounting.outputTokens,
                model,
                provider,
                completedAt: new Date().toISOString()
              }
            })
          );

          // Cleanup
          cancelSubscription.unsubscribe();
          cancelSubscription.disconnect();

          logger.info('[Worker] Job completed', {
            jobId,
            conversationId,
            messageId,
            tokens: accounting.outputTokens,
            costCents: accounting.estimatedCostCents
          });

          return { success: true, messageId };
        } catch (err: any) {
          logger.error('[Worker] Generation failed', {
            jobId,
            attempt,
            error: err.message
          });

          // Update job with error
          await prisma.streamingJob.update({
            where: { id: jobId },
            data: {
              lastError: err.message,
              status: StreamingJobStatus.FAILED
            }
          });

          throw err;
        }
      }
    );
  }, {
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379')
    },
    concurrency: 5
  });

  worker.on('completed', (job: any) => {
    logger.debug('[Worker] Job completed', { jobId: job.id });
  });

  worker.on('failed', (job: any, err: Error) => {
    logger.error('[Worker] Job failed', { jobId: job?.id, error: err.message });
  });

  return { queue, worker };
}
