import { createHash } from 'node:crypto';
import { chunkText } from '../embeddings/chunking';
import { logger } from '../utils/logger';
import { getDatasetSource } from './catalog';
import { decidePolicy } from './policy';
import { assessKnowledgeQuality } from './quality';
import {
  KnowledgeSecurityError,
  assertSafeDocumentSize,
  assertSafeIdentifier,
  sanitiseSuppliedMetadata,
  stripMarkup,
} from './security';
import type {
  IngestionResult,
  IngestionStage,
  KnowledgeCatalogStore,
  KnowledgeDocument,
  KnowledgeEmbeddingPort,
  KnowledgeIndexPort,
  KnowledgePolicyDecision,
  KnowledgeProvenance,
  KnowledgeVersion,
} from './types';

/**
 * The ingestion pipeline.
 *
 *   policy gate → security scan → validation → normalisation
 *     → deduplication → quality → chunking → embedding → indexing
 *     → versioning
 *
 * ── THE POLICY GATE IS FIRST, AND THAT IS THE DESIGN ─────────────────────
 *
 * Not first for tidiness — first because every later stage costs something.
 * Embedding a document that turns out to be unusable spends provider tokens,
 * and indexing one puts material into a store that then has to be found again
 * and removed. The cheapest possible refusal is the one that happens before
 * any of that, and it is also the only one that leaves nothing to clean up.
 *
 * ── EVERY STAGE REUSES SOMETHING THAT ALREADY EXISTS ─────────────────────
 *
 * Chunking is `../embeddings/chunking.ts` verbatim — the same splitter the
 * document path uses, so a passage chunked here and one chunked there are the
 * same size and shape. Embedding and indexing go through ports wired to
 * `EmbeddingService` and `VectorDBService` in `./ports.ts`, which means
 * caching, rate limiting, circuit breaking, cost accounting, workspace
 * scoping and tenant isolation are all inherited rather than reimplemented.
 *
 * A second knowledge system would need its own copy of each of those. The one
 * that would have been got wrong is workspace scoping, and the symptom would
 * have been one tenant retrieving another's material.
 *
 * ── PROVENANCE TRAVELS WITH THE VECTOR ───────────────────────────────────
 *
 * Every indexed chunk carries its source, licence, policy decision,
 * attribution requirement, version and checksum in metadata. That is what
 * makes a retrieved passage citable, what makes a licence audit a query
 * rather than an archaeology project, and what makes "withdraw everything
 * from source X" possible at all.
 *
 * ── AND EVERYTHING IT READS IS UNTRUSTED ─────────────────────────────────
 *
 * Markup is stripped before anything else looks at the text; metadata the
 * document supplied is sanitised so it can never impersonate Synora's own
 * provenance fields; identifiers are constrained so they cannot traverse a
 * path or collide across workspaces. See `./security.ts`.
 */

export interface IngestionContext {
  readonly workspaceId: string;
  readonly namespace?: string;
  readonly embeddings: KnowledgeEmbeddingPort;
  readonly index: KnowledgeIndexPort;
  readonly catalog: KnowledgeCatalogStore;
  /** Carried into every log line and onto the result. */
  readonly correlationId: string;
  /** ISO-8601. Supplied, never read from a clock, so runs are reproducible. */
  readonly now: string;
}

/** SHA-256 of the normalised text — identity, integrity and dedup key in one. */
export function checksumOf(text: string): string {
  return createHash('sha256').update(normaliseText(text)).digest('hex');
}

/**
 * Whitespace and encoding normalisation only.
 *
 * Deliberately conservative: it does NOT lowercase, strip punctuation, or
 * remove stop words. Every one of those destroys information the embedding
 * model uses, and they are habits inherited from bag-of-words retrieval that
 * actively hurt a dense index.
 */
export function normaliseText(text: string): string {
  return text
    .normalize('NFC')
    // Zero-width and BOM characters: invisible, and enough to make two
    // identical documents hash differently and both get indexed. Written as
    // escapes rather than literals — a literal zero-width character in
    // source is unreviewable by definition.
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Retained for callers that only want the composite score. */
export function assessQuality(text: string): number {
  return assessKnowledgeQuality(text).score;
}

function reject(
  stage: IngestionStage,
  reason: string,
  document: KnowledgeDocument,
  policy: KnowledgePolicyDecision,
  done: IngestionStage[],
  context: IngestionContext
): IngestionResult {
  logger.info('[Knowledge] document rejected', {
    correlationId: context.correlationId,
    workspaceId: context.workspaceId,
    sourceId: document.sourceId,
    documentId: document.id,
    stage,
    policyState: policy.state,
    reason,
  });
  return {
    documentId: document.id,
    accepted: false,
    rejection: { stage, reason },
    chunksIndexed: 0,
    provenance: null,
    policy,
    quality: null,
    version: null,
    stagesCompleted: done,
    correlationId: context.correlationId,
  };
}

/** A decision object for refusals that happen before any policy is computed. */
function unresolvedPolicy(reason: string, decidedAt: string): KnowledgePolicyDecision {
  return {
    state: 'UNKNOWN',
    licence: 'UNKNOWN',
    attributionRequired: true,
    shareAlike: false,
    permitsIngestion: false,
    reason,
    decidedAt,
    rule: 'source-not-registered',
  };
}

export async function ingestDocument(
  document: KnowledgeDocument,
  context: IngestionContext
): Promise<IngestionResult> {
  const startedAt = Date.now();
  const done: IngestionStage[] = [];

  /* 0 ── Identifiers, before they are used to build a key anywhere. */
  try {
    assertSafeIdentifier(document.id, 'document id');
    assertSafeIdentifier(document.sourceId, 'source id');
    assertSafeIdentifier(document.version, 'version');
  } catch (error) {
    return reject(
      'security-scan',
      error instanceof Error ? error.message : String(error),
      document,
      unresolvedPolicy('refused before a policy could be computed', context.now),
      done,
      context
    );
  }

  /* 1 ── Policy. Before anything is spent. */
  const source = getDatasetSource(document.sourceId);
  if (!source) {
    return reject(
      'policy-gate',
      `source "${document.sourceId}" is not registered. A source must be assessed before ` +
        'anything from it is ingested — that assessment is where the licence is established.',
      document,
      unresolvedPolicy(`source "${document.sourceId}" is not registered`, context.now),
      done,
      context
    );
  }

  const policy = decidePolicy(source, document, context.now);
  if (!policy.permitsIngestion) {
    return reject('policy-gate', policy.reason, document, policy, done, context);
  }
  done.push('policy-gate');

  /* 2 ── Security. Markup is removed BEFORE anything else reads the text. */
  const stripped =
    document.contentType === 'text/html' || /<\/?(script|div|p|span|body|html)\b/i.test(document.text)
      ? stripMarkup(document.text)
      : document.text;

  try {
    assertSafeDocumentSize(stripped);
  } catch (error) {
    const stage: IngestionStage =
      error instanceof KnowledgeSecurityError && error.kind === 'undersized' ? 'validation' : 'security-scan';
    return reject(stage, error instanceof Error ? error.message : String(error), document, policy, done, context);
  }
  done.push('security-scan');

  /* 3 ── Validation. */
  if (!document.language) {
    return reject('validation', 'document declares no language', document, policy, done, context);
  }
  if (!document.title) {
    return reject('validation', 'document declares no title — a citation needs one', document, policy, done, context);
  }
  done.push('validation');

  /* 4 ── Normalisation, then deduplication on the NORMALISED form. */
  const normalised = normaliseText(stripped);
  const checksum = createHash('sha256').update(normalised).digest('hex');
  done.push('normalisation');

  // Ordered this way on purpose: two copies of the same document differing
  // only in line endings or invisible characters must collide, and they only
  // do if the hash is taken after normalisation.
  if (await context.catalog.hasChecksum(checksum, context.workspaceId)) {
    return reject(
      'deduplication',
      `an identical document (checksum ${checksum.slice(0, 12)}…) is already indexed in this workspace`,
      document,
      policy,
      done,
      context
    );
  }
  done.push('deduplication');

  /* 5 ── Quality. Structural faults refuse; everything else is recorded. */
  const quality = assessKnowledgeQuality(normalised);
  if (quality.unusable) {
    return reject(
      'quality',
      `document is structurally unusable: ${quality.detectedIssues.join('; ')}`,
      document,
      policy,
      done,
      context
    );
  }
  done.push('quality');

  /* 6 ── Chunking, via the existing splitter. */
  const chunks = chunkText(normalised);
  if (chunks.length === 0) {
    return reject('chunking', 'the document produced no chunks after normalisation', document, policy, done, context);
  }
  done.push('chunking');

  const provenance: KnowledgeProvenance = {
    sourceId: source.id,
    sourceName: source.name,
    sourceUrl: source.url,
    sourceType: source.type,
    trustLevel: source.trustLevel,
    documentId: document.id,
    version: document.version,
    title: document.title,
    ...(document.originalUrl ? { originalUrl: document.originalUrl } : {}),
    ...(document.publisher ? { publisher: document.publisher } : {}),
    ...(document.author ? { author: document.author } : {}),
    ...(document.publishedAt ? { publishedAt: document.publishedAt } : {}),
    licence: policy.licence,
    ...(policy.licenceUrl ? { licenceUrl: policy.licenceUrl } : {}),
    attributionRequired: policy.attributionRequired,
    policyState: policy.state,
    collectedAt: document.collectedAt,
    ingestedAt: context.now,
    checksum,
    language: document.language,
    domain: source.domain,
    qualityScore: quality.score,
  };

  /* 7 ── Embedding, through the existing service. */
  const vectors = await context.embeddings.embedBatch(
    chunks.map((c) => c.text),
    context.workspaceId
  );
  if (vectors.length !== chunks.length) {
    return reject(
      'embedding',
      `embedded ${vectors.length} vectors for ${chunks.length} chunks`,
      document,
      policy,
      done,
      context
    );
  }
  done.push('embedding');

  /* 8 ── Indexing, with provenance on every record. */
  // Anything the document supplied is stripped of Synora's reserved keys
  // first: without this a document could ship `sourceName: "World Health
  // Organization"` and the citation would render exactly that.
  const supplied = sanitiseSuppliedMetadata(
    (document as unknown as { metadata?: Record<string, unknown> }).metadata
  );
  if (supplied.dropped.length > 0) {
    logger.warn('[Knowledge] dropped document-supplied metadata keys', {
      correlationId: context.correlationId,
      documentId: document.id,
      sourceId: source.id,
      // Names only. A dropped value may itself be the forgery attempt.
      dropped: supplied.dropped,
    });
  }

  const records = chunks.map((chunk, i) => ({
    id: `${document.id}::${document.version}::${i}`,
    values: vectors[i],
    metadata: {
      ...supplied.metadata,
      // Synora's own fields are spread LAST so they always win, whatever the
      // sanitiser missed.
      ...provenance,
      chunkIndex: i,
      chunkOffset: chunk.startOffset,
      text: chunk.text,
      workspaceId: context.workspaceId,
    } satisfies Record<string, unknown>,
  }));

  const { upsertedCount } = await context.index.upsert(records, {
    workspaceId: context.workspaceId,
    ...(context.namespace ? { namespace: context.namespace } : {}),
  });
  done.push('indexing');

  /* 9 ── Versioning. Old versions stay resolvable; they are marked, not erased. */
  const previous = await context.catalog.listVersions(document.id, context.workspaceId);
  for (const old of previous) {
    if (!old.superseded && old.version !== document.version) {
      await context.catalog.markSuperseded(document.id, old.version, context.workspaceId);
    }
  }

  const version: KnowledgeVersion = {
    documentId: document.id,
    version: document.version,
    checksum,
    ingestedAt: context.now,
    chunkCount: upsertedCount,
    superseded: false,
  };
  await context.catalog.recordVersion(version, context.workspaceId);
  done.push('versioning');

  logger.info('[Knowledge] document ingested', {
    correlationId: context.correlationId,
    workspaceId: context.workspaceId,
    sourceId: source.id,
    documentId: document.id,
    version: document.version,
    policyState: policy.state,
    chunks: upsertedCount,
    qualityScore: quality.score,
    latencyMs: Date.now() - startedAt,
  });

  return {
    documentId: document.id,
    accepted: true,
    rejection: null,
    chunksIndexed: upsertedCount,
    provenance,
    policy,
    quality,
    version,
    stagesCompleted: done,
    correlationId: context.correlationId,
  };
}

/**
 * Withdraw a version: remove its vectors and record why.
 *
 * A TOMBSTONE, not a deletion of history. The version record survives with a
 * reason and a timestamp, because "this citation used to resolve and no
 * longer does" is information a reader needs — silently having nothing there
 * looks identical to never having had it, and that is how a withdrawn source
 * becomes invisible instead of accounted for.
 */
export async function tombstoneVersion(
  documentId: string,
  version: string,
  reason: string,
  context: IngestionContext
): Promise<{ removedChunks: number }> {
  assertSafeIdentifier(documentId, 'document id');
  assertSafeIdentifier(version, 'version');

  const versions = await context.catalog.listVersions(documentId, context.workspaceId);
  const target = versions.find((v) => v.version === version);
  if (!target) return { removedChunks: 0 };

  const ids = Array.from({ length: target.chunkCount }, (_, i) => `${documentId}::${version}::${i}`);
  await context.index.deleteByIds(ids, {
    workspaceId: context.workspaceId,
    ...(context.namespace ? { namespace: context.namespace } : {}),
  });

  await context.catalog.recordVersion(
    { ...target, superseded: true, tombstonedAt: context.now, tombstoneReason: reason },
    context.workspaceId
  );

  logger.warn('[Knowledge] version tombstoned', {
    correlationId: context.correlationId,
    workspaceId: context.workspaceId,
    documentId,
    version,
    removedChunks: ids.length,
    reason,
  });

  return { removedChunks: ids.length };
}
