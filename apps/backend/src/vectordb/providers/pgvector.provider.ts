import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@synora/database';
import { getConfig } from '../../config';
import {
  DeleteRequest,
  DeleteResult,
  FilterCondition,
  MetadataFilter,
  QueryRequest,
  QueryResult,
  UpsertRequest,
  UpsertResult,
  VectorDBProvider,
  VectorDBProviderError,
  VectorMatch,
} from '../types';
import type { VectorDBProviderDescriptor } from '../descriptor';
import { buildNamespace } from '../shared';

/** Conservative default; large multi-row INSERTs are otherwise limited only by Postgres's own parameter-count ceiling. */
const PGVECTOR_DEFAULT_MAX_UPSERT_BATCH_SIZE = 500;

const TABLE_NAME = 'vector_embeddings';

/** Only `workspaceId`/`conversationId` are real columns — everything else lives in the `metadata` JSONB column. */
const COLUMN_FIELDS = new Set(['workspaceId', 'conversationId']);

/** Guards against SQL injection through a caller-supplied metadata field name, since field names can't be parameterized like values can. */
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function fieldSql(field: string): Prisma.Sql {
  if (!SAFE_IDENTIFIER.test(field)) {
    throw new VectorDBProviderError(`Invalid metadata filter field name: "${field}"`, 'pgvector');
  }
  return COLUMN_FIELDS.has(field)
    ? Prisma.raw(`"${field === 'workspaceId' ? 'workspace_id' : 'conversation_id'}"`)
    : Prisma.sql`(metadata ->> ${field})`;
}

function conditionSql(field: string, condition: FilterCondition | string | number | boolean): Prisma.Sql {
  const column = fieldSql(field);
  if (condition === null || typeof condition !== 'object') {
    return Prisma.sql`${column} = ${String(condition)}`;
  }
  const [op, value] = Object.entries(condition)[0] as [keyof FilterCondition, unknown];
  switch (op) {
    case 'eq':
      return Prisma.sql`${column} = ${String(value)}`;
    case 'ne':
      return Prisma.sql`${column} != ${String(value)}`;
    case 'gt':
      return Prisma.sql`${column}::numeric > ${value as number}`;
    case 'gte':
      return Prisma.sql`${column}::numeric >= ${value as number}`;
    case 'lt':
      return Prisma.sql`${column}::numeric < ${value as number}`;
    case 'lte':
      return Prisma.sql`${column}::numeric <= ${value as number}`;
    case 'in':
      return Prisma.sql`${column} IN (${Prisma.join((value as (string | number)[]).map(String))})`;
    case 'nin':
      return Prisma.sql`${column} NOT IN (${Prisma.join((value as (string | number)[]).map(String))})`;
    default: {
      const exhaustiveCheck: never = op;
      throw new Error(`Unknown filter operator: ${String(exhaustiveCheck)}`);
    }
  }
}

function buildWhereClause(namespace: string, filter?: MetadataFilter): Prisma.Sql {
  const clauses = [Prisma.sql`namespace = ${namespace}`];
  if (filter) {
    for (const [field, condition] of Object.entries(filter)) {
      clauses.push(conditionSql(field, condition));
    }
  }
  return Prisma.join(clauses, ' AND ');
}

function toVectorLiteral(values: readonly number[]): string {
  return `[${values.join(',')}]`;
}

/**
 * pgvector — the one provider in this module that isn't a separate
 * database at all: it reuses the application's own PostgreSQL instance
 * (via the shared `prisma` singleton from `@synora/database`) and the
 * `vector` extension, managing its own dedicated `vector_embeddings` table
 * through raw SQL rather than a Prisma-modeled table in
 * `packages/database/prisma/schema.prisma` — keeping this phase's changes
 * entirely inside `src/vectordb/` and never touching the shared schema
 * file other in-flight work also depends on.
 */
export class PgVectorProvider implements VectorDBProvider {
  readonly id = 'pgvector';
  readonly supportsHybridSearch = false; // Would require a separate tsvector column + rank fusion, not implemented here.
  readonly maxUpsertBatchSize: number;
  private tableEnsured = false;

  constructor(
    private readonly client: PrismaClient,
    private readonly dimensions: number,
    maxUpsertBatchSize: number
  ) {
    this.maxUpsertBatchSize = maxUpsertBatchSize;
  }

  async upsert(request: UpsertRequest): Promise<UpsertResult> {
    try {
      await this.ensureTable();
      const namespace = buildNamespace(request.workspaceId, request.namespace);

      for (const vector of request.vectors) {
        await this.client.$executeRaw`
          INSERT INTO ${Prisma.raw(TABLE_NAME)} (id, namespace, workspace_id, conversation_id, embedding, metadata)
          VALUES (
            ${vector.id},
            ${namespace},
            ${request.workspaceId},
            ${(vector.metadata?.conversationId as string) ?? null},
            ${toVectorLiteral(vector.values)}::vector,
            ${JSON.stringify(vector.metadata ?? {})}::jsonb
          )
          ON CONFLICT (id) DO UPDATE SET
            namespace = EXCLUDED.namespace,
            workspace_id = EXCLUDED.workspace_id,
            conversation_id = EXCLUDED.conversation_id,
            embedding = EXCLUDED.embedding,
            metadata = EXCLUDED.metadata
        `;
      }

      return { upsertedCount: request.vectors.length };
    } catch (error) {
      throw this.wrapError('upsert', error);
    }
  }

  async query(request: QueryRequest): Promise<QueryResult> {
    try {
      await this.ensureTable();
      const namespace = buildNamespace(request.workspaceId, request.namespace);
      const where = buildWhereClause(namespace, request.filter);
      const vectorLiteral = toVectorLiteral(request.vector);

      const rows = await this.client.$queryRaw<
        Array<{ id: string; score: number; embedding: string | null; metadata: unknown }>
      >(Prisma.sql`
        SELECT
          id,
          1 - (embedding <=> ${vectorLiteral}::vector) AS score,
          ${request.includeValues ? Prisma.sql`embedding::text` : Prisma.sql`NULL`} AS embedding,
          metadata
        FROM ${Prisma.raw(TABLE_NAME)}
        WHERE ${where}
        ORDER BY embedding <=> ${vectorLiteral}::vector
        LIMIT ${request.topK}
      `);

      const matches: VectorMatch[] = rows.map((row) => ({
        id: row.id,
        score: row.score,
        values: row.embedding ? parseVectorLiteral(row.embedding) : undefined,
        metadata: request.includeMetadata === false ? undefined : (row.metadata as Record<string, unknown>),
      }));

      return { matches };
    } catch (error) {
      throw this.wrapError('query', error);
    }
  }

  async delete(request: DeleteRequest): Promise<DeleteResult> {
    try {
      await this.ensureTable();
      const namespace = buildNamespace(request.workspaceId, request.namespace);

      if (request.ids) {
        const result = await this.client.$executeRaw`
          DELETE FROM ${Prisma.raw(TABLE_NAME)}
          WHERE namespace = ${namespace} AND id IN (${Prisma.join([...request.ids])})
        `;
        return { deletedCount: result };
      }

      const where = buildWhereClause(namespace, request.filter);
      const result = await this.client.$executeRaw(Prisma.sql`
        DELETE FROM ${Prisma.raw(TABLE_NAME)} WHERE ${where}
      `);
      return { deletedCount: result };
    } catch (error) {
      throw this.wrapError('delete', error);
    }
  }

  private async ensureTable(): Promise<void> {
    if (this.tableEnsured) return;

    await this.client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
    await this.client.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        conversation_id TEXT,
        embedding VECTOR(${this.dimensions}) NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.client.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_${TABLE_NAME}_namespace ON ${TABLE_NAME} (namespace)`
    );
    await this.client.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_${TABLE_NAME}_workspace_id ON ${TABLE_NAME} (workspace_id)`
    );
    this.tableEnsured = true;
  }

  private wrapError(operation: string, error: unknown): VectorDBProviderError {
    return new VectorDBProviderError(
      `pgvector ${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
      this.id,
      error
    );
  }
}

function parseVectorLiteral(literal: string): number[] {
  return literal
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map(Number);
}

export const pgvectorVectorDBDescriptor: VectorDBProviderDescriptor = {
  id: 'pgvector',
  displayName: 'pgvector (PostgreSQL)',
  async isConfigured() {
    // Reuses the application's own DATABASE_URL — always "configured" in
    // the sense of having a database to talk to, since every other part
    // of this application already requires one. Enabled only when
    // explicitly selected or via VECTORDB_PGVECTOR_ENABLED, so it doesn't
    // silently win auto-detection over a purpose-built vector database in
    // deployments where both happen to be reachable.
    return getConfig().vectordb.pgvectorEnabled;
  },
  async create() {
    const { pgvectorDimensions, pgvectorMaxUpsertBatchSize } = getConfig().vectordb;
    return new PgVectorProvider(
      prisma,
      pgvectorDimensions,
      pgvectorMaxUpsertBatchSize ?? PGVECTOR_DEFAULT_MAX_UPSERT_BATCH_SIZE
    );
  },
};
