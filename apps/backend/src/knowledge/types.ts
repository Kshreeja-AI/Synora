/**
 * Legal, provider-neutral knowledge acquisition.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────
 *
 * It is not a way to acquire another model's knowledge. Model weights and
 * the behaviour they encode are not extractable, not copyable, and not
 * something Synora attempts to obtain — from Claude, GPT, Gemini or anything
 * else. There is no code in this directory that scrapes a model, distils
 * one, or reconstructs one, and there is not meant to be.
 *
 * It is also not a web crawler. Nothing here discovers content; a source has
 * to be assessed and registered before a single byte of it is fetched.
 *
 * ── THE RULE THE WHOLE MODULE ENFORCES ───────────────────────────────────
 *
 * A dataset is ingested because its LICENCE permits it, never because it was
 * downloadable. Those two are constantly confused and they are not related:
 * Common Crawl is trivially downloadable and consists largely of material its
 * publishers still hold copyright in.
 *
 * So `licence` is a required field with no permissive default, `UNKNOWN` is a
 * real member of the licence enum, and the policy gate refuses it. An
 * ingestion that cannot state its licence does not happen.
 *
 * ── AND IT REUSES THE EXISTING STACK ─────────────────────────────────────
 *
 * Chunking is `../embeddings/chunking.ts`. Embedding is `EmbeddingService`.
 * Storage and retrieval are `VectorDBService`. Queuing is `../queue/`. There
 * is no second vector store, no second embedding path, and no second cache.
 * A parallel knowledge system would be a second thing to secure, scope by
 * workspace, and keep consistent — which is how tenant isolation quietly
 * develops a hole.
 *
 * ── AND EVERYTHING IT INGESTS IS UNTRUSTED ───────────────────────────────
 *
 * A retrieved passage is DATA, never instruction. See `./security.ts`.
 */

/* ═══════════════════════════════════════════════════════════════════════ *
 * LICENCES AND POLICY
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Licences Synora recognises. Deliberately a closed set: an open-ended
 * string field would make "MIT-ish" and "free to use" ingestible.
 */
export type LicenceId =
  | 'CC0-1.0'
  | 'CC-BY-4.0'
  | 'CC-BY-SA-4.0'
  | 'CC-BY-NC-4.0'
  | 'CC-BY-ND-4.0'
  | 'MIT'
  | 'Apache-2.0'
  | 'BSD-3-Clause'
  | 'ODbL-1.0'
  | 'PDDL-1.0'
  | 'public-domain'
  | 'government-open-data'
  /** The document says nothing about its licence. Refused. */
  | 'UNKNOWN'
  /** Positively identified as not permitting this use. Refused. */
  | 'proprietary';

export interface LicenceAssessment {
  readonly id: LicenceId;
  readonly name: string;
  readonly url?: string;
  /** Whether Synora may ingest and index material under this licence. */
  readonly ingestionPermitted: boolean;
  /** Whether the source must be credited wherever the content is surfaced. */
  readonly attributionRequired: boolean;
  /** Whether derived works inherit the licence. Affects what may be published. */
  readonly shareAlike: boolean;
  /** Whether commercial use is permitted. */
  readonly commercialUsePermitted: boolean;
  /** Whether derivative works (including chunking and embedding) are permitted. */
  readonly derivativesPermitted: boolean;
  /** True when the terms are source-specific and a human must read them. */
  readonly requiresHumanReview: boolean;
  readonly note: string;
}

/**
 * The gate's verdict.
 *
 * FIVE STATES, and the two that matter most are the ones a simpler design
 * would have collapsed. `REVIEW_REQUIRED` is not `REFUSED` — the material may
 * well be usable and a person has to read the terms. `UNKNOWN` is not
 * `ALLOWED` — and the whole module exists because that particular collapse is
 * the easy, quiet, expensive mistake.
 */
export type KnowledgePolicyState =
  | 'ALLOWED'
  | 'ALLOWED_WITH_ATTRIBUTION'
  | 'REVIEW_REQUIRED'
  | 'REFUSED'
  | 'UNKNOWN';

/**
 * A recorded decision, stored as metadata on everything it admitted.
 *
 * Kept so a licence audit is a query rather than a re-reading of the corpus,
 * and so "why is this in the index?" always has an answer with a date on it.
 */
export interface KnowledgePolicyDecision {
  readonly state: KnowledgePolicyState;
  readonly licence: LicenceId;
  readonly licenceUrl?: string;
  readonly attributionRequired: boolean;
  readonly shareAlike: boolean;
  /** Whether this decision permits INGESTION. Only two states do. */
  readonly permitsIngestion: boolean;
  /** Plain-language justification. Always present, including for ALLOWED. */
  readonly reason: string;
  /** ISO-8601, supplied by the caller — this module never reads a clock. */
  readonly decidedAt: string;
  /** Which rule produced it, so a policy change can be traced to its effects. */
  readonly rule: string;
}

/* ═══════════════════════════════════════════════════════════════════════ *
 * SOURCES
 * ═══════════════════════════════════════════════════════════════════════ */

export type KnowledgeSourceType =
  | 'encyclopaedia'
  | 'scientific-literature'
  | 'government-open-data'
  | 'public-domain-books'
  | 'educational'
  | 'documentation'
  | 'dataset'
  | 'benchmark'
  | 'internal-fixture';

export type KnowledgeDomain =
  | 'scientific'
  | 'government'
  | 'educational'
  | 'encyclopaedic'
  | 'literature'
  | 'machine-learning'
  | 'mathematics'
  | 'quantum-computing'
  | 'software-documentation'
  | 'benchmark'
  | 'test-fixture';

/**
 * How much a source's content is trusted when two sources disagree.
 *
 * NOT a claim that a high-trust source is correct. It orders sources for
 * conflict REPORTING; nothing in this module resolves a conflict silently,
 * because "the more trusted source wins" is how a confident wrong answer gets
 * manufactured out of two honest disagreements.
 */
export type KnowledgeTrustLevel = 'authoritative' | 'peer-reviewed' | 'curated' | 'community' | 'unverified';

export type KnowledgeUpdateFrequency = 'static' | 'yearly' | 'monthly' | 'weekly' | 'daily' | 'continuous';

/**
 * A registered source. Metadata only — registering a source is not fetching
 * it, and nothing in this build fetches any of them automatically.
 */
export interface KnowledgeSource {
  readonly id: string;
  readonly name: string;
  readonly type: KnowledgeSourceType;
  readonly url: string;
  readonly domain: KnowledgeDomain;
  /** Which ingestion adapter reads this source. Never a vendor SDK. */
  readonly adapterId: string;
  readonly licence: LicenceId;
  readonly licenceUrl?: string;
  /** What Synora is permitted to do with it, in words, from the terms. */
  readonly allowedUsage: string;
  readonly attributionRequired: boolean;
  readonly updateFrequency: KnowledgeUpdateFrequency;
  readonly trustLevel: KnowledgeTrustLevel;
  /**
   * True when the collection's licence is per-item rather than uniform —
   * arXiv's metadata is CC0 while individual papers are not. A blanket
   * ingestion of such a source is exactly the mistake this flag prevents.
   */
  readonly perItemLicenceCheckRequired: boolean;
  readonly languages: readonly string[];
  readonly approximateSize: string;
  /** Why this source is worth having, in one line. */
  readonly rationale: string;
  /**
   * Whether ingestion from this source may run at all. Independent of the
   * licence: a perfectly licensed source can be switched off operationally.
   */
  readonly enabled: boolean;
  /** Ingestion status in THIS build. Never aspirational. */
  readonly status: 'planned' | 'blocked' | 'ingested';
  /** Set when `status` is `blocked`. */
  readonly blockedReason?: string;
}

/** Retained name for the source shape; `KnowledgeSource` is the primary one. */
export type DatasetSource = KnowledgeSource;

/* ═══════════════════════════════════════════════════════════════════════ *
 * DOCUMENTS, VERSIONS, CHUNKS
 * ═══════════════════════════════════════════════════════════════════════ */

export interface KnowledgeDocument {
  readonly id: string;
  readonly sourceId: string;
  readonly title: string;
  readonly text: string;
  readonly language: string;
  readonly version: string;
  /** ISO-8601, supplied by the caller. */
  readonly collectedAt: string;
  /** The canonical address of the original, where one exists. */
  readonly originalUrl?: string;
  readonly publisher?: string;
  readonly author?: string;
  /** ISO-8601 date the ORIGINAL was published, not when Synora saw it. */
  readonly publishedAt?: string;
  readonly contentType?: 'text/plain' | 'text/markdown' | 'text/html' | 'application/json';
  /**
   * Per-item licence, for sources whose licence varies by document. Required
   * whenever the source declares `perItemLicenceCheckRequired`.
   */
  readonly itemLicence?: LicenceId;
}

/**
 * One ingested revision of a document.
 *
 * Versions are kept rather than overwritten because a citation must remain
 * resolvable: an answer that cited paragraph 4 of version 2 is not evidenced
 * by version 3, and silently replacing the text would turn a correct citation
 * into a wrong one without touching the answer.
 */
export interface KnowledgeVersion {
  readonly documentId: string;
  readonly version: string;
  /** SHA-256 of the normalised text. Identity, integrity and dedup key. */
  readonly checksum: string;
  readonly ingestedAt: string;
  readonly chunkCount: number;
  /** True once a newer version exists. Old versions stay resolvable. */
  readonly superseded: boolean;
  /** Set when a version is withdrawn — a tombstone, not a deletion. */
  readonly tombstonedAt?: string;
  readonly tombstoneReason?: string;
}

export interface KnowledgeChunk {
  readonly id: string;
  readonly documentId: string;
  readonly version: string;
  readonly index: number;
  readonly text: string;
  /** Character offset in the normalised document. Makes a citation locatable. */
  readonly startOffset: number;
  readonly checksum: string;
}

/**
 * Everything recorded about one ingested document. Required in full — a chunk
 * that reaches the index without this cannot be cited, cannot be
 * licence-audited, and cannot be deleted when a source is withdrawn.
 */
export interface KnowledgeProvenance {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly sourceType: KnowledgeSourceType;
  readonly trustLevel: KnowledgeTrustLevel;
  readonly documentId: string;
  readonly version: string;
  readonly title: string;
  readonly originalUrl?: string;
  readonly publisher?: string;
  readonly author?: string;
  readonly publishedAt?: string;
  readonly licence: LicenceId;
  readonly licenceUrl?: string;
  readonly attributionRequired: boolean;
  readonly policyState: KnowledgePolicyState;
  /** ISO-8601. Supplied by the caller — this module never reads a clock. */
  readonly collectedAt: string;
  readonly ingestedAt: string;
  readonly checksum: string;
  readonly language: string;
  readonly domain: KnowledgeDomain;
  readonly qualityScore: number;
}

/** Retained name. `KnowledgeProvenance` is the primary one. */
export type DocumentProvenance = KnowledgeProvenance;

/* ═══════════════════════════════════════════════════════════════════════ *
 * QUALITY AND FRESHNESS
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Measurable properties of the TEXT. Explicitly not a judgement of whether
 * the content is correct, which this module has no way to assess and does not
 * pretend to — a "quality score" that implied otherwise would be trusted.
 */
export interface KnowledgeQuality {
  /** 0..1, from the signals below only. */
  readonly score: number;
  readonly lengthChars: number;
  /** Share of U+FFFD replacement characters — a decoding fault upstream. */
  readonly replacementCharRatio: number;
  /** Share of lines that repeat verbatim. Boilerplate and scraper artefacts. */
  readonly repetitionRatio: number;
  /** Share of characters inside markup. High values mean HTML leaked through. */
  readonly markupRatio: number;
  readonly detectedIssues: readonly string[];
  /** True when the document is structurally unusable and must be refused. */
  readonly unusable: boolean;
}

/**
 * How old the knowledge is, relative to what its source promises.
 *
 * `staleness` is deliberately `unknown` when the source publishes no date. A
 * document with no publication date is not fresh and is not stale; it is
 * undated, and saying otherwise invents a fact.
 */
export interface KnowledgeFreshness {
  readonly publishedAt?: string;
  readonly ingestedAt: string;
  readonly updateFrequency: KnowledgeUpdateFrequency;
  readonly ageDays: number | null;
  readonly staleness: 'fresh' | 'aging' | 'stale' | 'unknown';
  readonly reason: string;
}

/* ═══════════════════════════════════════════════════════════════════════ *
 * INGESTION
 * ═══════════════════════════════════════════════════════════════════════ */

export type IngestionStage =
  | 'policy-gate'
  | 'security-scan'
  | 'validation'
  | 'normalisation'
  | 'deduplication'
  | 'quality'
  | 'chunking'
  | 'embedding'
  | 'indexing'
  | 'versioning';

export interface IngestionRejection {
  readonly stage: IngestionStage;
  readonly reason: string;
}

export interface IngestionResult {
  readonly documentId: string;
  readonly accepted: boolean;
  readonly rejection: IngestionRejection | null;
  readonly chunksIndexed: number;
  readonly provenance: KnowledgeProvenance | null;
  readonly policy: KnowledgePolicyDecision;
  readonly quality: KnowledgeQuality | null;
  readonly version: KnowledgeVersion | null;
  readonly stagesCompleted: readonly IngestionStage[];
  /** Correlation id, carried from the caller through every log line. */
  readonly correlationId: string;
}

export type IngestionJobState =
  | 'created'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * A resumable ingestion run.
 *
 * `cursor` is the whole point. A dataset of a million documents WILL fail
 * partway — a network blip, a provider rate limit, a restart — and a job that
 * cannot say where it got to forces the entire dataset to be re-embedded,
 * which costs real money on a metered embedding provider. The cursor is
 * persisted after every batch, so a resume costs the batch in flight and
 * nothing more.
 */
export interface KnowledgeIngestionJob {
  readonly id: string;
  readonly sourceId: string;
  readonly workspaceId: string;
  readonly state: IngestionJobState;
  /** Opaque to this module; the adapter defines what it means. */
  readonly cursor: string | null;
  readonly totalDocuments: number | null;
  readonly processedDocuments: number;
  readonly acceptedDocuments: number;
  readonly rejectedDocuments: number;
  readonly failedDocuments: number;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly lastError?: string;
  readonly correlationId: string;
}

export interface KnowledgeIngestionJobProgress {
  readonly job: KnowledgeIngestionJob;
  /** 0..1, or null when the total is genuinely unknown. Never a fake 0.5. */
  readonly fraction: number | null;
}

/* ═══════════════════════════════════════════════════════════════════════ *
 * RETRIEVAL AND CITATION
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Filters a caller may apply. Every one of them narrows; none can widen past
 * the workspace, which is applied by `VectorDBService` itself and is not
 * expressible here on purpose.
 */
export interface KnowledgeRetrievalFilter {
  readonly sourceIds?: readonly string[];
  readonly domains?: readonly KnowledgeDomain[];
  readonly languages?: readonly string[];
  /** ISO-8601 lower bound on the ORIGINAL publication date. */
  readonly publishedAfter?: string;
  readonly publishedBefore?: string;
  readonly minQualityScore?: number;
  readonly minTrustLevel?: KnowledgeTrustLevel;
  /** Exclude versions that have been superseded or tombstoned. */
  readonly currentVersionsOnly?: boolean;
}

export interface KnowledgeRetrievalRequest {
  readonly query: string;
  readonly topK: number;
  readonly workspaceId: string;
  readonly namespace?: string;
  readonly filter?: KnowledgeRetrievalFilter;
  readonly correlationId: string;
  /**
   * Weighting between dense similarity and the non-semantic signals
   * (keyword overlap, recency, trust). 1 = purely semantic, the default.
   * The hybrid signals are computed here; no external search provider is
   * involved and none is required.
   */
  readonly hybridAlpha?: number;
}

/** One retrieved passage, with the attribution its licence requires. */
export interface KnowledgeCitation {
  readonly chunkId: string;
  readonly documentId: string;
  readonly version: string;
  readonly chunkIndex: number;
  readonly score: number;
  /** Contribution breakdown, so a ranking can be explained rather than trusted. */
  readonly signals: {
    readonly semantic: number;
    readonly keyword: number;
    readonly recency: number;
    readonly trust: number;
  };
  readonly text: string;
  readonly title: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly originalUrl?: string;
  readonly publisher?: string;
  readonly author?: string;
  readonly publishedAt?: string;
  readonly ingestedAt: string;
  readonly licence: LicenceId;
  readonly licenceUrl?: string;
  readonly attributionRequired: boolean;
  readonly trustLevel: KnowledgeTrustLevel;
  readonly qualityScore: number;
  readonly checksum: string;
}

/**
 * What retrieval returns. Deliberately more than a list: a caller that only
 * sees passages cannot tell "nothing matched" from "everything matched was
 * dropped for want of provenance", and those need different responses.
 */
export interface KnowledgeRetrievalResult {
  readonly citations: readonly KnowledgeCitation[];
  readonly totalMatches: number;
  /** Dropped because their provenance was missing or unreadable. */
  readonly droppedForMissingProvenance: number;
  /** Dropped by the caller's filters. */
  readonly droppedByFilter: number;
  /** Sources that disagree are REPORTED, never silently resolved. */
  readonly conflicts: readonly KnowledgeConflict[];
  readonly correlationId: string;
  readonly latencyMs: number;
  /** True when nothing survived. The caller must say so rather than invent. */
  readonly evidenceUnavailable: boolean;
}

/**
 * Two sources that appear to disagree.
 *
 * Reported, never resolved. This module cannot know which is right, and a
 * system that picked one would be manufacturing confidence out of a genuine
 * disagreement — the exact failure that makes a citation worse than none.
 */
export interface KnowledgeConflict {
  readonly chunkIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly reason: string;
}

/* ═══════════════════════════════════════════════════════════════════════ *
 * PORTS — the reuse boundary, stated as interfaces
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Deliberately narrow ports rather than direct service imports, so this
 * module is testable without Redis, a vector database or a provider — the
 * same reasoning `EmbeddingService` gives for depending on interfaces.
 * `./ports.ts` wires them to the real services.
 */
export interface KnowledgeEmbeddingPort {
  embedBatch(texts: readonly string[], workspaceId: string): Promise<readonly (readonly number[])[]>;
}

export interface KnowledgeIndexPort {
  upsert(
    records: readonly { id: string; values: readonly number[]; metadata: Record<string, unknown> }[],
    scope: { workspaceId: string; namespace?: string }
  ): Promise<{ upsertedCount: number }>;
  query(request: {
    vector: readonly number[];
    topK: number;
    workspaceId: string;
    namespace?: string;
  }): Promise<readonly { id: string; score: number; metadata?: Record<string, unknown> }[]>;
  /** Used by tombstoning; a withdrawn source must become unretrievable. */
  deleteByIds(ids: readonly string[], scope: { workspaceId: string; namespace?: string }): Promise<void>;
}

/** Dedup and version memory. In production a table; in tests a Map. */
export interface KnowledgeCatalogStore {
  hasChecksum(checksum: string, workspaceId: string): Promise<boolean>;
  recordVersion(version: KnowledgeVersion, workspaceId: string): Promise<void>;
  listVersions(documentId: string, workspaceId: string): Promise<readonly KnowledgeVersion[]>;
  markSuperseded(documentId: string, version: string, workspaceId: string): Promise<void>;
}

/** Job persistence. A job that cannot be reloaded cannot be resumed. */
export interface KnowledgeJobStore {
  create(job: KnowledgeIngestionJob): Promise<void>;
  get(jobId: string): Promise<KnowledgeIngestionJob | null>;
  update(job: KnowledgeIngestionJob): Promise<void>;
  listBySource(sourceId: string): Promise<readonly KnowledgeIngestionJob[]>;
}

/**
 * Reads documents out of a source. The ONLY place a source's wire format is
 * known — the pipeline downstream of it sees `KnowledgeDocument` and nothing
 * else, which is what keeps a new source from touching any other file.
 */
export interface KnowledgeIngestionAdapter {
  readonly id: string;
  readonly displayName: string;
  /** Cheap, no-network check: can this adapter run at all here? */
  isAvailable(): Promise<boolean>;
  /**
   * One batch, starting at `cursor`. Returns the next cursor, or null at the
   * end. Batching (rather than an array of everything) is what makes a
   * million-document source ingestible without holding it in memory.
   */
  fetchBatch(request: {
    source: KnowledgeSource;
    cursor: string | null;
    batchSize: number;
    correlationId: string;
  }): Promise<{ documents: readonly KnowledgeDocument[]; nextCursor: string | null; total: number | null }>;
}
