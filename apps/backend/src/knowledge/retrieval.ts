import { logger } from '../utils/logger';
import { permitsRetrieval } from './policy';
import { detectConflicts } from './quality';
import type {
  KnowledgeCitation,
  KnowledgeEmbeddingPort,
  KnowledgeIndexPort,
  KnowledgePolicyState,
  KnowledgeRetrievalFilter,
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalResult,
  KnowledgeTrustLevel,
  LicenceId,
} from './types';

/**
 * Retrieval, with provenance that cannot be lost.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────
 *
 * A passage whose provenance cannot be reconstructed is DROPPED, not
 * returned. An un-attributable passage is a licence risk and an unciteable
 * claim, and returning it "just this once" is how both become permanent. The
 * count of dropped passages is reported rather than swallowed, because
 * "nothing matched" and "everything matched was unciteable" need different
 * responses from the caller.
 *
 * ── HYBRID SCORING, WITHOUT A SEARCH VENDOR ──────────────────────────────
 *
 * Four signals, combined by an explicit weight:
 *
 *   semantic  — cosine similarity from the vector store. The base.
 *   keyword   — literal term overlap. Catches exact names, identifiers and
 *               numbers, which is precisely where dense embeddings are
 *               weakest: "GPT-4o" and "GPT-4" are near-identical vectors.
 *   recency   — newer material ranked higher, where a date exists.
 *   trust     — an authoritative source outranks an unverified one at equal
 *               relevance.
 *
 * All four are computed HERE from metadata that is already indexed. No
 * Elasticsearch, no external search provider, no new dependency — the
 * abstraction exists so one can be added later behind it, which is the
 * instruction, rather than being added now because it might be wanted.
 *
 * Every citation carries its `signals` breakdown, so a ranking can be
 * explained instead of trusted.
 *
 * ── AND CONFLICTS ARE REPORTED, NEVER RESOLVED ───────────────────────────
 *
 * See `./quality.ts`. Two sources disagreeing is information; a system that
 * silently picked one would be manufacturing confidence.
 */

const TRUST_ORDER: readonly KnowledgeTrustLevel[] = [
  'unverified',
  'community',
  'curated',
  'peer-reviewed',
  'authoritative',
];

function trustScore(level: KnowledgeTrustLevel | undefined): number {
  const index = level ? TRUST_ORDER.indexOf(level) : -1;
  return index < 0 ? 0 : index / (TRUST_ORDER.length - 1);
}

/**
 * Over-fetch before filtering.
 *
 * Filters are applied AFTER the vector query because Synora's metadata
 * filter DSL cannot express all of them (a trust ordering, a quality
 * threshold) across every provider. Asking for exactly `topK` and then
 * filtering would return fewer than requested — quietly, and more often the
 * more selective the filter. Four times is enough for realistic filters and
 * small enough not to make a large query pathological.
 */
const OVERFETCH_FACTOR = 4;
const MAX_OVERFETCH = 200;

export interface RetrievalContext {
  readonly embeddings: KnowledgeEmbeddingPort;
  readonly index: KnowledgeIndexPort;
  /** ISO-8601. Supplied, so recency scoring is reproducible. */
  readonly now: string;
}

export async function retrieveKnowledge(
  request: KnowledgeRetrievalRequest,
  context: RetrievalContext
): Promise<KnowledgeRetrievalResult> {
  const startedAt = Date.now();
  const [vector] = await context.embeddings.embedBatch([request.query], request.workspaceId);

  const matches = await context.index.query({
    vector,
    topK: Math.min(MAX_OVERFETCH, request.topK * OVERFETCH_FACTOR),
    workspaceId: request.workspaceId,
    ...(request.namespace ? { namespace: request.namespace } : {}),
  });

  const queryTerms = tokenise(request.query);
  const alpha = clamp(request.hybridAlpha ?? 1, 0, 1);

  let droppedForMissingProvenance = 0;
  let droppedByFilter = 0;
  const candidates: KnowledgeCitation[] = [];

  for (const match of matches) {
    const citation = toCitation(match, queryTerms, alpha, context.now);
    if (!citation) {
      droppedForMissingProvenance++;
      continue;
    }
    if (!passesFilter(citation, match.metadata, request.filter)) {
      droppedByFilter++;
      continue;
    }
    candidates.push(citation);
  }

  const citations = candidates.sort((a, b) => b.score - a.score).slice(0, request.topK);

  const conflicts = detectConflicts(
    citations.map((c) => ({ chunkId: c.chunkId, sourceId: c.sourceId, text: c.text }))
  );

  const result: KnowledgeRetrievalResult = {
    citations,
    totalMatches: matches.length,
    droppedForMissingProvenance,
    droppedByFilter,
    conflicts,
    correlationId: request.correlationId,
    latencyMs: Date.now() - startedAt,
    // Stated explicitly so a caller cannot mistake an empty list for a
    // confident "there is nothing to say". The orchestrator turns this into
    // "evidence unavailable" rather than answering unsupported.
    evidenceUnavailable: citations.length === 0,
  };

  logger.info('[Knowledge] retrieval', {
    correlationId: request.correlationId,
    workspaceId: request.workspaceId,
    topK: request.topK,
    matches: matches.length,
    returned: citations.length,
    droppedForMissingProvenance,
    droppedByFilter,
    conflicts: conflicts.length,
    latencyMs: result.latencyMs,
  });

  if (droppedForMissingProvenance > 0) {
    // Loud on purpose: a chunk in the index without provenance means
    // something wrote to the store outside the pipeline, which is a bug with
    // legal consequences rather than a data-quality nuisance.
    logger.warn('[Knowledge] passages dropped for missing provenance', {
      correlationId: request.correlationId,
      workspaceId: request.workspaceId,
      count: droppedForMissingProvenance,
    });
  }

  return result;
}

/**
 * Build a citation, or return null if provenance is incomplete.
 *
 * The required set is deliberately strict: without a source name, a source
 * URL, a licence and a document id, the passage cannot be attributed, and
 * attribution is a licence obligation rather than a nicety.
 */
function toCitation(
  match: { id: string; score: number; metadata?: Record<string, unknown> },
  queryTerms: ReadonlySet<string>,
  alpha: number,
  now: string
): KnowledgeCitation | null {
  const meta = match.metadata;
  if (!meta) return null;

  const sourceName = str(meta.sourceName);
  const sourceUrl = str(meta.sourceUrl);
  const licence = str(meta.licence) as LicenceId | undefined;
  const documentId = str(meta.documentId);
  const text = str(meta.text);
  if (!sourceName || !sourceUrl || !licence || !documentId || !text) return null;

  // A policy state that no longer permits serving means the material stays
  // in the index (so a tombstone can find it) and stops coming out of it.
  if (!permitsRetrieval(meta.policyState as KnowledgePolicyState | undefined)) return null;

  const semantic = clamp(match.score, 0, 1);
  const keyword = keywordOverlap(text, queryTerms);
  const recency = recencyScore(str(meta.publishedAt), now);
  const trust = trustScore(meta.trustLevel as KnowledgeTrustLevel | undefined);

  // alpha = 1 is pure semantic — the default, and the behaviour a caller gets
  // if they never think about this. The other three share what is left.
  const score = alpha * semantic + (1 - alpha) * (0.5 * keyword + 0.25 * recency + 0.25 * trust);

  return {
    chunkId: match.id,
    documentId,
    version: str(meta.version) ?? '1',
    chunkIndex: typeof meta.chunkIndex === 'number' ? meta.chunkIndex : 0,
    score,
    signals: { semantic, keyword, recency, trust },
    text,
    title: str(meta.title) ?? '(untitled)',
    sourceId: str(meta.sourceId) ?? 'unknown',
    sourceName,
    sourceUrl,
    ...(str(meta.originalUrl) ? { originalUrl: str(meta.originalUrl)! } : {}),
    ...(str(meta.publisher) ? { publisher: str(meta.publisher)! } : {}),
    ...(str(meta.author) ? { author: str(meta.author)! } : {}),
    ...(str(meta.publishedAt) ? { publishedAt: str(meta.publishedAt)! } : {}),
    ingestedAt: str(meta.ingestedAt) ?? '',
    licence,
    ...(str(meta.licenceUrl) ? { licenceUrl: str(meta.licenceUrl)! } : {}),
    attributionRequired: meta.attributionRequired === true,
    trustLevel: (meta.trustLevel as KnowledgeTrustLevel) ?? 'unverified',
    qualityScore: typeof meta.qualityScore === 'number' ? meta.qualityScore : 0,
    checksum: str(meta.checksum) ?? '',
  };
}

function passesFilter(
  citation: KnowledgeCitation,
  meta: Record<string, unknown> | undefined,
  filter: KnowledgeRetrievalFilter | undefined
): boolean {
  if (!filter) return true;

  if (filter.sourceIds && !filter.sourceIds.includes(citation.sourceId)) return false;
  if (filter.domains) {
    const domain = str(meta?.domain);
    if (!domain || !(filter.domains as readonly string[]).includes(domain)) return false;
  }
  if (filter.languages) {
    const language = str(meta?.language);
    if (!language || !filter.languages.includes(language)) return false;
  }
  if (filter.minQualityScore !== undefined && citation.qualityScore < filter.minQualityScore) return false;
  if (filter.minTrustLevel !== undefined && trustScore(citation.trustLevel) < trustScore(filter.minTrustLevel)) {
    return false;
  }

  // A DATE FILTER EXCLUDES UNDATED MATERIAL. An undated document is not
  // "recent enough"; treating it as passing would let a caller asking for
  // post-2024 sources receive material of unknown age and never know.
  if (filter.publishedAfter !== undefined) {
    if (!citation.publishedAt || citation.publishedAt < filter.publishedAfter) return false;
  }
  if (filter.publishedBefore !== undefined) {
    if (!citation.publishedAt || citation.publishedAt > filter.publishedBefore) return false;
  }

  if (filter.currentVersionsOnly && meta?.superseded === true) return false;

  return true;
}

/* ── Signals ─────────────────────────────────────────────────────────── */

function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s.-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2)
  );
}

/**
 * Share of the query's distinct terms that literally appear.
 *
 * Deliberately unweighted by frequency: this signal exists to catch exact
 * identifiers, model names and numbers that dense embeddings blur together,
 * and a term appearing once is enough evidence of that.
 */
function keywordOverlap(text: string, queryTerms: ReadonlySet<string>): number {
  if (queryTerms.size === 0) return 0;
  const terms = tokenise(text);
  let hits = 0;
  for (const term of queryTerms) if (terms.has(term)) hits++;
  return hits / queryTerms.size;
}

/**
 * Recency on a two-year half-life, and 0 for undated material.
 *
 * Zero rather than a neutral 0.5: an undated document has not demonstrated
 * recency, and giving it the benefit of the doubt would rank unknown-age
 * material above material known to be a year old.
 */
function recencyScore(publishedAt: string | undefined, now: string): number {
  if (!publishedAt) return 0;
  const published = Date.parse(publishedAt);
  const current = Date.parse(now);
  if (Number.isNaN(published) || Number.isNaN(current)) return 0;
  const ageDays = Math.max(0, (current - published) / 86_400_000);
  return Math.exp(-ageDays / 730);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

/**
 * Render citations as attribution lines.
 *
 * One place, so every surface that shows evidence shows the same thing, and
 * so a licence requiring attribution gets it in a form somebody can check.
 */
export function formatCitations(citations: readonly KnowledgeCitation[]): readonly string[] {
  return citations.map((c) => {
    const parts = [c.title, c.sourceName];
    if (c.author) parts.push(c.author);
    if (c.publishedAt) parts.push(c.publishedAt.slice(0, 10));
    parts.push(`licence ${c.licence}`);
    parts.push(`v${c.version} chunk ${c.chunkIndex}`);
    return `${parts.join(' — ')} <${c.originalUrl ?? c.sourceUrl}>`;
  });
}
