/**
 * Bull Queue worker: Generate AI responses with streaming
 */

import { Worker } from 'bullmq';
import { prisma } from '@synora/database';
import { logger } from '../utils/logger';
import { getStreamingResolver } from '../ai/streaming/resolver';
import { StreamingAccumulator, TokenAccountant } from '../ai/streaming/accumulator';
import { StreamingRetryEngine, StreamingJobStatus } from '../ai/streaming/statemachine';
import { conversationContextService } from '../services/conversationContext.service';
import {
  aiProviderCallsTotal,
  aiProviderCallDuration,
  aiTokensTotal,
} from '../monitoring/metrics';
import { Redis } from 'ioredis';
import { recordAiInteraction } from '../eos/instrumentation';
import { isCaptureActive } from '../eos/case-capture';
import { privacyConsentService } from '../services/privacyConsent.service';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const PROMPT_HISTORY_WINDOW = 50;

export interface GenerateResponseJob {
  jobId: string;
  conversationId: string;
  messageId: string;
  userId: string;
  provider: string;
  model: string;
}

/**
 * Retrieval-augmented generation: fetch the memories relevant to this
 * conversation and return them as the system instruction for the provider
 * call, or `undefined` when there is nothing relevant to add.
 *
 * The result must be passed as `systemPrompt`, never as a 'system' entry in
 * `messages` — see ai/shared.ts, where system-role turns are dropped because
 * each provider's wire format allows exactly one system instruction. Injecting
 * retrieved context into the message history would silently no-op.
 *
 * Fail-open by design: memory is an enhancement, so a retrieval outage (the
 * embedding provider being unreachable, the vector store being down) degrades
 * to an unaugmented reply rather than costing the user their message.
 */
export async function buildAugmentedSystemPrompt(params: {
  jobId: string;
  conversationId: string;
  userId: string;
  workspaceId: string;
}): Promise<string | undefined> {
  const { jobId, conversationId, userId, workspaceId } = params;
  try {
    const context = await conversationContextService.buildContext({
      conversationId,
      userId,
      workspaceId,
    });

    logger.debug('[Worker] Context built', {
      jobId,
      memoriesInContext: context.metadata.memoriesInContext,
      contextTokens: context.metadata.tokensUsed,
    });

    // With no relevant memories the prompt carries no retrieved knowledge, so
    // sending it would only spend tokens restating the conversation title.
    return context.relevantMemories.length > 0 ? context.systemPrompt : undefined;
  } catch (err: unknown) {
    logger.warn('[Worker] Memory retrieval failed; generating without it', {
      jobId,
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

export function createGenerateResponseWorker() {
  const retryEngine = new StreamingRetryEngine();
  const resolver = getStreamingResolver();

  const worker = new Worker<GenerateResponseJob>('generate_response', async (bullJob) => {
    const jobData: GenerateResponseJob = bullJob.data;
    const { jobId, conversationId, messageId, userId, provider, model } = jobData;

    logger.info('[Worker] Processing job', { jobId, conversationId, messageId });

    return await retryEngine.executeWithRetry(
      jobId,
      'generateResponse',
      async (attempt) => {
        const accumulator = new StreamingAccumulator();
        const accountant = new TokenAccountant(model, provider);
        const startedAt = Date.now();

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

          // Retrieval-augmented context: pull the memories relevant to this
          // conversation and pass them as the system instruction.
          //
          // This must go through `systemPrompt`, not a 'system' entry in
          // `messages` — see ai/shared.ts, where system-role turns are dropped
          // because each provider's wire format allows exactly one system
          // instruction. Injecting it into the history would silently no-op.
          //
          // Fail-open by design: memory is an enhancement, so a retrieval
          // outage (embedding provider down, vector store unreachable) must
          // degrade to an unaugmented reply rather than cost the user their
          // message.
          const systemPrompt = await buildAugmentedSystemPrompt({
            jobId,
            conversationId,
            userId,
            workspaceId: conversation.workspaceId,
          });

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
          const providerCallTimer = aiProviderCallDuration.startTimer({ provider });

          for await (const chunk of providerInstance.generateStream({
            messages: messageHistory,
            model,
            systemPrompt,
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

          // Spend metrics: one observation per completed provider call, plus
          // token counters split by direction so cost dashboards can separate
          // prompt growth from response growth.
          providerCallTimer();
          aiProviderCallsTotal.inc({ provider, outcome: 'completed' });
          aiTokensTotal.inc({ provider, direction: 'input' }, accounting.inputTokens);
          aiTokensTotal.inc({ provider, direction: 'output' }, accounting.outputTokens);

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

          // Feed EOS/CIEP: provider matrix, prompt regression detection, and
          // evaluation case capture. Interaction text is only attached when
          // the user has consented to evaluation use; the consent lookup is
          // skipped entirely when capture is inactive (the default), so this
          // adds no database round-trip to the normal path.
          let consentedContent:
            | { input: string; output: string; consented: boolean }
            | undefined;
          if (isCaptureActive()) {
            try {
              const consented = await privacyConsentService.canUseConversationForEvaluation(
                conversationId,
                userId
              );
              if (consented) {
                const lastUserTurn = [...messageHistory].reverse().find(m => m.role === 'user');
                consentedContent = {
                  input: lastUserTurn?.content ?? '',
                  output: finalText,
                  consented: true,
                };
              }
            } catch {
              // Consent unknown means no capture — the safe outcome.
            }
          }

          recordAiInteraction({
            promptId: 'chat.generate',
            providerId: provider,
            modelId: model,
            success: true,
            latencyMs: Date.now() - startedAt,
            inputTokens: accounting.inputTokens,
            outputTokens: accounting.outputTokens,
            costCents: accounting.estimatedCostCents,
            content: consentedContent,
          });

          return { success: true, messageId };
        } catch (err: any) {
          aiProviderCallsTotal.inc({ provider, outcome: 'failed' });

          // A failure is the most valuable signal the observatory and prompt
          // intelligence receive, so it is recorded on this path too. No text
          // is attached: a failed generation has no output worth capturing.
          recordAiInteraction({
            promptId: 'chat.generate',
            providerId: provider,
            modelId: model,
            success: false,
            latencyMs: Date.now() - startedAt,
            inputTokens: 0,
            outputTokens: 0,
            costCents: 0,
            errorCode: err?.code ?? err?.name ?? 'unknown',
          });

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
    // Same REDIS_URL as the producer (workers/queue.ts) and the
    // pub/sub connection above — the previous REDIS_HOST/REDIS_PORT
    // pair silently split the worker onto a different Redis than the
    // rest of the system whenever only REDIS_URL was configured.
    // maxRetriesPerRequest: null is BullMQ's requirement for worker
    // connections so they ride out Redis restarts by reconnecting.
    connection: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      maxRetriesPerRequest: null,
    },
    concurrency: 5
  });

  worker.on('completed', (job: any) => {
    logger.debug('[Worker] Job completed', { jobId: job.id });
  });

  worker.on('failed', (job: any, err: Error) => {
    logger.error('[Worker] Job failed', { jobId: job?.id, error: err.message });
  });

  return { worker };
}
