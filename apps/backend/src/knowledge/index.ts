/**
 * The knowledge-acquisition layer's public surface.
 *
 * Nothing here fetches anything on import. The catalogue is an assessment,
 * the pipeline is a function that takes documents a caller already has, the
 * adapters are what a job uses to go and get them, and the ports are adapters
 * onto Synora's existing embedding and vector services. Ingestion is
 * something an operator starts deliberately, with a licence established
 * first.
 */

export type {
  LicenceId,
  LicenceAssessment,
  KnowledgePolicyState,
  KnowledgePolicyDecision,
  KnowledgeSource,
  KnowledgeSourceType,
  KnowledgeDomain,
  KnowledgeTrustLevel,
  KnowledgeUpdateFrequency,
  DatasetSource,
  KnowledgeDocument,
  KnowledgeVersion,
  KnowledgeChunk,
  KnowledgeProvenance,
  DocumentProvenance,
  KnowledgeQuality,
  KnowledgeFreshness,
  IngestionStage,
  IngestionRejection,
  IngestionResult,
  IngestionJobState,
  KnowledgeIngestionJob,
  KnowledgeIngestionJobProgress,
  KnowledgeRetrievalFilter,
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalResult,
  KnowledgeCitation,
  KnowledgeConflict,
  KnowledgeEmbeddingPort,
  KnowledgeIndexPort,
  KnowledgeCatalogStore,
  KnowledgeJobStore,
  KnowledgeIngestionAdapter,
} from './types';

export { assessLicence, permittedLicences } from './licences';
export { decidePolicy, permitsIngestion, permitsRetrieval } from './policy';
export {
  DATASET_CATALOG,
  InvalidKnowledgeSourceError,
  allKnowledgeSources,
  getDatasetSource,
  ingestibleSources,
  registerKnowledgeSource,
  resetRuntimeSourcesForTests,
} from './catalog';

export {
  fixtureAdapter,
  getIngestionAdapter,
  httpArchiveAdapter,
  httpJsonAdapter,
  listIngestionAdapters,
} from './adapters';
export { FIXTURE_CORPUS } from './fixtures/corpus';

export type { IngestionContext } from './pipeline';
export {
  assessQuality,
  checksumOf,
  ingestDocument,
  normaliseText,
  tombstoneVersion,
} from './pipeline';

export { assessFreshness, assessKnowledgeQuality, detectConflicts } from './quality';

export type { CreateJobRequest, RunJobOptions, RunJobResult } from './jobs';
export {
  KnowledgeJobError,
  cancelIngestionJob,
  canTransition,
  createIngestionJob,
  getJobProgress,
  pauseIngestionJob,
  resumeIngestionJob,
  runIngestionJob,
} from './jobs';

export type { RetrievalContext } from './retrieval';
export { formatCitations, retrieveKnowledge } from './retrieval';

export {
  KnowledgeSecurityError,
  MAX_DOCUMENT_CHARS,
  MAX_FETCH_BYTES,
  assertSafeDecompression,
  assertSafeDocumentSize,
  assertSafeIdentifier,
  assertSafeSourceUrl,
  detectExecutableContent,
  fenceUntrustedContent,
  isReservedMetadataKey,
  redactUrl,
  sanitiseSuppliedMetadata,
  scanForPromptInjection,
  stripMarkup,
} from './security';

export {
  KNOWLEDGE_NAMESPACE,
  createInMemoryCatalogStore,
  createInMemoryJobStore,
  createKnowledgeEmbeddingPort,
  createKnowledgeIndexPort,
} from './ports';
