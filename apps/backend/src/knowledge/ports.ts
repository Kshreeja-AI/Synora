import { getEmbeddingService } from '../embeddings/factory';
import { getVectorDBService } from '../vectordb/factory';
import type {
  KnowledgeCatalogStore,
  KnowledgeEmbeddingPort,
  KnowledgeIndexPort,
  KnowledgeIngestionJob,
  KnowledgeJobStore,
  KnowledgeVersion,
} from './types';

/**
 * Wires the knowledge pipeline's ports to Synora's EXISTING embedding and
 * vector subsystems.
 *
 * This file is the proof that there is no second knowledge stack — the
 * adapters are a few dozen lines, and this is the only place the pipeline
 * meets a concrete service.
 *
 * WHAT COMES FOR FREE BY GOING THROUGH THESE. Content-hash caching,
 * per-workspace rate limiting, per-provider circuit breaking, retry with
 * backoff, cost accounting, OpenTelemetry spans, input validation, and — the
 * one that matters most — workspace scoping. `EmbeddingService` and
 * `VectorDBService` both take `workspaceId` as a required field and key their
 * caches, quotas and namespaces on it. A parallel implementation would have
 * had to rebuild every one of those, and the one it would have got wrong is
 * the last.
 *
 * A DEDICATED NAMESPACE, not a dedicated store: knowledge vectors live at
 * `knowledge` within the caller's workspace, so they are separable from
 * conversation and document vectors for querying and deletion while remaining
 * inside the same tenant boundary.
 */
export const KNOWLEDGE_NAMESPACE = 'knowledge';

export function createKnowledgeEmbeddingPort(): KnowledgeEmbeddingPort {
  return {
    async embedBatch(texts, workspaceId) {
      const result = await getEmbeddingService().embedBatch(texts, { workspaceId });
      return result.results.map((r) => r.embedding.values);
    },
  };
}

export function createKnowledgeIndexPort(): KnowledgeIndexPort {
  return {
    async upsert(records, scope) {
      return getVectorDBService().upsert(records, {
        workspaceId: scope.workspaceId,
        namespace: scope.namespace ?? KNOWLEDGE_NAMESPACE,
      });
    },
    async query(request) {
      const result = await getVectorDBService().query({
        workspaceId: request.workspaceId,
        namespace: request.namespace ?? KNOWLEDGE_NAMESPACE,
        vector: request.vector,
        topK: request.topK,
        // Provenance lives in metadata, and a retrieval without it produces a
        // passage that cannot be cited — which the retrieval layer then
        // drops. Asking for it is not optional.
        includeMetadata: true,
      });
      return result.matches.map((m) => ({
        id: m.id,
        score: m.score,
        ...(m.metadata ? { metadata: m.metadata } : {}),
      }));
    },
    async deleteByIds(ids, scope) {
      if (ids.length === 0) return;
      await getVectorDBService().delete({
        workspaceId: scope.workspaceId,
        namespace: scope.namespace ?? KNOWLEDGE_NAMESPACE,
        ids: [...ids],
      });
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════ *
 * CATALOG AND JOB STORES
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * ── STATED PLAINLY: THESE ARE IN-MEMORY, AND THAT IS NOT PRODUCTION ──────
 *
 * The version catalogue and the job store need durable, workspace-scoped
 * persistence to be useful across a restart or across instances. That means
 * two Prisma models and a migration, and adding an empty table nobody writes
 * to yet — in a release that is mid-deployment — buys nothing and costs a
 * schema change on a production database.
 *
 * So the PORTS are real, the pipeline and the job engine are written against
 * them, every test drives them end to end, and the concrete durable
 * implementation is a deliberate, named next step rather than a gap somebody
 * discovers.
 *
 * WHAT THE PRODUCTION IMPLEMENTATION NEEDS, precisely:
 *
 *   model KnowledgeVersion {
 *     workspaceId String; documentId String; version String
 *     checksum String; ingestedAt DateTime; chunkCount Int
 *     superseded Boolean @default(false)
 *     tombstonedAt DateTime?; tombstoneReason String?
 *     @@id([workspaceId, documentId, version])
 *     @@index([workspaceId, checksum])   // the dedup lookup
 *   }
 *
 *   model KnowledgeIngestionJob {
 *     id String @id; sourceId String; workspaceId String; state String
 *     cursor String?; totalDocuments Int?; processedDocuments Int
 *     acceptedDocuments Int; rejectedDocuments Int; failedDocuments Int
 *     attempts Int; maxAttempts Int; correlationId String
 *     createdAt DateTime; updatedAt DateTime
 *     startedAt DateTime?; finishedAt DateTime?; lastError String?
 *     @@index([sourceId, state])
 *   }
 *
 * Until those exist, an ingestion run is a single-process operation whose
 * progress does not survive a restart. That is a real limitation and it is
 * written here rather than left to be found.
 */

export function createInMemoryCatalogStore(): KnowledgeCatalogStore {
  const checksums = new Set<string>();
  const versions = new Map<string, KnowledgeVersion[]>();
  const key = (workspaceId: string, documentId: string): string => `${workspaceId}::${documentId}`;

  return {
    async hasChecksum(checksum, workspaceId) {
      return checksums.has(`${workspaceId}::${checksum}`);
    },
    async recordVersion(version, workspaceId) {
      checksums.add(`${workspaceId}::${version.checksum}`);
      const list = versions.get(key(workspaceId, version.documentId)) ?? [];
      const existing = list.findIndex((v) => v.version === version.version);
      if (existing >= 0) list[existing] = version;
      else list.push(version);
      versions.set(key(workspaceId, version.documentId), list);
    },
    async listVersions(documentId, workspaceId) {
      return versions.get(key(workspaceId, documentId)) ?? [];
    },
    async markSuperseded(documentId, version, workspaceId) {
      const list = versions.get(key(workspaceId, documentId)) ?? [];
      versions.set(
        key(workspaceId, documentId),
        list.map((v) => (v.version === version ? { ...v, superseded: true } : v))
      );
    },
  };
}

export function createInMemoryJobStore(): KnowledgeJobStore {
  const jobs = new Map<string, KnowledgeIngestionJob>();
  return {
    async create(job) {
      if (jobs.has(job.id)) throw new Error(`job "${job.id}" already exists`);
      jobs.set(job.id, job);
    },
    async get(jobId) {
      return jobs.get(jobId) ?? null;
    },
    async update(job) {
      jobs.set(job.id, job);
    },
    async listBySource(sourceId) {
      return [...jobs.values()].filter((j) => j.sourceId === sourceId);
    },
  };
}
