import { getIngestionAdapter } from './adapters';
import { getDatasetSource } from './catalog';
import { ingestDocument, type IngestionContext } from './pipeline';
import { logger } from '../utils/logger';
import type {
  IngestionJobState,
  KnowledgeIngestionJob,
  KnowledgeIngestionJobProgress,
  KnowledgeJobStore,
} from './types';

/**
 * Resumable ingestion jobs.
 *
 * ── THE CURSOR IS THE ENTIRE POINT ───────────────────────────────────────
 *
 * A dataset of a million documents WILL fail partway. A network blip, a
 * provider rate limit, a deploy, an out-of-memory kill — it does not matter
 * which. What matters is what happens next: a job that cannot say where it
 * got to forces the whole dataset to be re-fetched, re-chunked and
 * RE-EMBEDDED, and embedding is the expensive step. On a metered provider
 * that is a bill, paid twice, for work already done.
 *
 * So the cursor is persisted after EVERY batch, before the next one starts.
 * A crash costs the batch in flight and nothing else.
 *
 * ── PAUSE AND CANCEL ARE COOPERATIVE ─────────────────────────────────────
 *
 * Checked between batches by re-reading the job from the store rather than
 * from memory, so a pause issued by another process (an operator, an admin
 * route, a shutdown hook) is seen. Killing a batch mid-flight would leave
 * embeddings paid for and not indexed, which is the one outcome worse than
 * finishing the batch.
 *
 * ── RETRY IS BOUNDED AND RECORDED ────────────────────────────────────────
 *
 * `attempts` increments per RUN, not per document, and `maxAttempts` stops a
 * poisoned source from retrying forever. A document that fails is counted and
 * skipped — one malformed record must not stop a million good ones, and the
 * count is what makes "this source is 3% broken" visible instead of invisible.
 *
 * ── WHY THIS IS NOT A BULLMQ WORKER ──────────────────────────────────────
 *
 * It is the LOGIC a worker runs, deliberately separated from the queue. The
 * queue subsystem owns scheduling, concurrency, retries-with-backoff and dead
 * lettering; this owns what one run does and how it resumes. Keeping them
 * apart is what makes the whole thing testable in memory — every test below
 * drives a real job to completion, pauses it, resumes it and crashes it,
 * without Redis.
 */

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_MAX_ATTEMPTS = 3;

export class KnowledgeJobError extends Error {
  constructor(
    message: string,
    readonly jobId: string
  ) {
    super(message);
    this.name = 'KnowledgeJobError';
  }
}

/** Which transitions are legal. An illegal one is a bug, not a no-op. */
const ALLOWED_TRANSITIONS: Readonly<Record<IngestionJobState, readonly IngestionJobState[]>> = {
  created: ['running', 'cancelled'],
  // `running → running` IS LEGAL, and it is the transition that makes crash
  // recovery possible. A process killed mid-run leaves the job marked
  // `running` forever; forbidding the self-transition would make exactly the
  // state a resume exists for the one state a resume cannot reach.
  //
  // It does mean two processes could run one job concurrently. That is the
  // QUEUE's problem and the queue already solves it — BullMQ holds a lock per
  // job — and duplicating a distributed lock here would be a second, worse
  // implementation of something that exists.
  running: ['running', 'paused', 'completed', 'failed', 'cancelled'],
  paused: ['running', 'cancelled'],
  // Terminal-but-retryable: a failed job may be run again, which is what
  // makes "recover from a failed ingestion" a supported operation rather
  // than a matter of creating a new job and losing the cursor.
  failed: ['running', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function canTransition(from: IngestionJobState, to: IngestionJobState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface CreateJobRequest {
  readonly id: string;
  readonly sourceId: string;
  readonly workspaceId: string;
  readonly correlationId: string;
  readonly now: string;
  readonly maxAttempts?: number;
}

export async function createIngestionJob(
  request: CreateJobRequest,
  store: KnowledgeJobStore
): Promise<KnowledgeIngestionJob> {
  const source = getDatasetSource(request.sourceId);
  if (!source) {
    throw new KnowledgeJobError(`source "${request.sourceId}" is not registered`, request.id);
  }
  // Refused at creation rather than at the first batch: a job that can never
  // legally ingest anything should not exist, sit in a queue, and be
  // discovered later by an operator wondering why it produced nothing.
  if (source.status === 'blocked') {
    throw new KnowledgeJobError(
      `source "${source.id}" is blocked: ${source.blockedReason ?? 'no reason recorded'}`,
      request.id
    );
  }
  if (!source.enabled) {
    throw new KnowledgeJobError(`source "${source.id}" is disabled for ingestion`, request.id);
  }
  const adapter = getIngestionAdapter(source.adapterId);
  if (!adapter) {
    throw new KnowledgeJobError(
      `source "${source.id}" names adapter "${source.adapterId}", which does not exist`,
      request.id
    );
  }
  // Availability is checked HERE, not at the first batch. A job whose adapter
  // cannot run would otherwise be created, queued, picked up, and fail
  // minutes later with the operator having no idea it was never going to work.
  if (!(await adapter.isAvailable())) {
    throw new KnowledgeJobError(
      `source "${source.id}" needs adapter "${adapter.id}" (${adapter.displayName}), which is not ` +
        'available in this build. Nothing was queued.',
      request.id
    );
  }

  const job: KnowledgeIngestionJob = {
    id: request.id,
    sourceId: request.sourceId,
    workspaceId: request.workspaceId,
    state: 'created',
    cursor: null,
    totalDocuments: null,
    processedDocuments: 0,
    acceptedDocuments: 0,
    rejectedDocuments: 0,
    failedDocuments: 0,
    attempts: 0,
    maxAttempts: request.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    createdAt: request.now,
    updatedAt: request.now,
    correlationId: request.correlationId,
  };

  await store.create(job);
  logger.info('[Knowledge] ingestion job created', {
    correlationId: job.correlationId,
    jobId: job.id,
    sourceId: job.sourceId,
    workspaceId: job.workspaceId,
  });
  return job;
}

async function transition(
  job: KnowledgeIngestionJob,
  to: IngestionJobState,
  store: KnowledgeJobStore,
  now: string,
  extra: Partial<KnowledgeIngestionJob> = {}
): Promise<KnowledgeIngestionJob> {
  if (!canTransition(job.state, to)) {
    throw new KnowledgeJobError(`cannot move a ${job.state} job to ${to}`, job.id);
  }
  const updated: KnowledgeIngestionJob = { ...job, ...extra, state: to, updatedAt: now };
  await store.update(updated);
  return updated;
}

async function load(jobId: string, store: KnowledgeJobStore): Promise<KnowledgeIngestionJob> {
  const job = await store.get(jobId);
  if (!job) throw new KnowledgeJobError('job not found', jobId);
  return job;
}

export async function pauseIngestionJob(
  jobId: string,
  store: KnowledgeJobStore,
  now: string
): Promise<KnowledgeIngestionJob> {
  return transition(await load(jobId, store), 'paused', store, now);
}

export async function cancelIngestionJob(
  jobId: string,
  store: KnowledgeJobStore,
  now: string
): Promise<KnowledgeIngestionJob> {
  return transition(await load(jobId, store), 'cancelled', store, now, { finishedAt: now });
}

/**
 * Explicitly resume a paused job.
 *
 * SEPARATE FROM `runIngestionJob` ON PURPOSE. "Paused" has to mean paused: if
 * simply running a job un-paused it, then any worker that picked the job up
 * would silently undo an operator's decision to stop it — and the operator
 * would have no way to make a job stay stopped short of cancelling it, which
 * throws away the cursor.
 *
 * So `runIngestionJob` returns immediately for a paused job, and resuming is
 * a deliberate act with its own verb.
 */
export async function resumeIngestionJob(
  jobId: string,
  store: KnowledgeJobStore,
  now: string
): Promise<KnowledgeIngestionJob> {
  return transition(await load(jobId, store), 'running', store, now);
}

export interface RunJobOptions {
  readonly batchSize?: number;
  /** Stop after this many batches. Used by tests and by cooperative shutdown. */
  readonly maxBatches?: number;
  /** ISO-8601. Supplied so a run is reproducible. */
  readonly now: string;
}

export interface RunJobResult {
  readonly job: KnowledgeIngestionJob;
  readonly batchesProcessed: number;
  /** True when the run stopped because the source was exhausted. */
  readonly completed: boolean;
}

/**
 * Run — or resume — a job.
 *
 * Resuming is not a separate function: a job carries its cursor, so `runJob`
 * on a paused or failed job continues from exactly where it stopped. That is
 * what makes "resume" a property of the data rather than a mode of the code,
 * and it is why a crash and a pause recover identically.
 */
export async function runIngestionJob(
  jobId: string,
  store: KnowledgeJobStore,
  context: Omit<IngestionContext, 'now'>,
  options: RunJobOptions
): Promise<RunJobResult> {
  let job = await load(jobId, store);

  if (job.state === 'completed' || job.state === 'cancelled') {
    return { job, batchesProcessed: 0, completed: job.state === 'completed' };
  }
  // A paused job stays paused until somebody resumes it. Running it here
  // would let any worker quietly overrule an operator who stopped it.
  if (job.state === 'paused') {
    return { job, batchesProcessed: 0, completed: false };
  }
  if (job.attempts >= job.maxAttempts && job.state === 'failed') {
    throw new KnowledgeJobError(
      `job has already failed ${job.attempts} times (max ${job.maxAttempts}); it will not retry itself`,
      jobId
    );
  }

  const source = getDatasetSource(job.sourceId);
  if (!source) throw new KnowledgeJobError(`source "${job.sourceId}" is no longer registered`, jobId);
  const adapter = getIngestionAdapter(source.adapterId);
  if (!adapter) throw new KnowledgeJobError(`adapter "${source.adapterId}" is unavailable`, jobId);

  job = await transition(job, 'running', store, options.now, {
    attempts: job.attempts + 1,
    startedAt: job.startedAt ?? options.now,
  });

  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  let batches = 0;

  try {
    for (;;) {
      if (options.maxBatches !== undefined && batches >= options.maxBatches) {
        return { job, batchesProcessed: batches, completed: false };
      }

      // Re-read from the STORE, not from memory: a pause or cancel issued by
      // another process is only visible this way, and a job that ignored one
      // would keep spending an embedding budget after being told to stop.
      const current = await load(jobId, store);
      if (current.state === 'paused' || current.state === 'cancelled') {
        return { job: current, batchesProcessed: batches, completed: false };
      }

      const batch = await adapter.fetchBatch({
        source,
        cursor: job.cursor,
        batchSize,
        correlationId: job.correlationId,
      });

      let accepted = job.acceptedDocuments;
      let rejected = job.rejectedDocuments;
      let failed = job.failedDocuments;

      for (const document of batch.documents) {
        try {
          const result = await ingestDocument(document, { ...context, now: options.now });
          if (result.accepted) accepted++;
          else rejected++;
        } catch (error) {
          // ONE BAD DOCUMENT MUST NOT STOP A MILLION GOOD ONES. Counted and
          // logged, so "this source is 3% broken" is visible rather than
          // invisible — and so a source that is 100% broken fails loudly at
          // the end instead of silently indexing nothing.
          failed++;
          logger.warn('[Knowledge] document failed during ingestion', {
            correlationId: job.correlationId,
            jobId,
            sourceId: source.id,
            documentId: document.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      batches++;
      // PERSISTED BEFORE THE NEXT FETCH. This single ordering is what makes
      // a crash cost one batch instead of the whole dataset.
      job = {
        ...job,
        cursor: batch.nextCursor,
        totalDocuments: batch.total ?? job.totalDocuments,
        processedDocuments: job.processedDocuments + batch.documents.length,
        acceptedDocuments: accepted,
        rejectedDocuments: rejected,
        failedDocuments: failed,
        updatedAt: options.now,
      };
      await store.update(job);

      if (batch.nextCursor === null) {
        job = await transition(job, 'completed', store, options.now, { finishedAt: options.now });
        logger.info('[Knowledge] ingestion job completed', {
          correlationId: job.correlationId,
          jobId,
          sourceId: source.id,
          processed: job.processedDocuments,
          accepted: job.acceptedDocuments,
          rejected: job.rejectedDocuments,
          failed: job.failedDocuments,
        });
        return { job, batchesProcessed: batches, completed: true };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The cursor written by the last successful batch survives, so a retry
    // resumes rather than restarts. That is the whole reason this catch does
    // not reset anything.
    job = await transition(job, 'failed', store, options.now, { lastError: message });
    logger.error('[Knowledge] ingestion job failed', {
      correlationId: job.correlationId,
      jobId,
      sourceId: job.sourceId,
      cursor: job.cursor,
      attempts: job.attempts,
      processed: job.processedDocuments,
      error: message,
    });
    return { job, batchesProcessed: batches, completed: false };
  }
}

export async function getJobProgress(
  jobId: string,
  store: KnowledgeJobStore
): Promise<KnowledgeIngestionJobProgress> {
  const job = await load(jobId, store);
  return {
    job,
    // `null` rather than a comforting 0.5 when the total is genuinely
    // unknown: a progress bar that invents a position is worse than no bar.
    fraction:
      job.totalDocuments && job.totalDocuments > 0
        ? Math.min(1, job.processedDocuments / job.totalDocuments)
        : null,
  };
}
