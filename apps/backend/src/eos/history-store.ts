import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * A single point-in-time capture of the platform's engineering state.
 * Deliberately a plain serialisable record so any backing store — memory,
 * file, Postgres, or an external time-series service — can persist it
 * without translation.
 */
export interface EngineeringSnapshot {
  capturedAt: number;
  latency: { count: number; p50: number; p95: number; p99: number; mean: number };
  errorRate: { errorsInWindow: number; windowMs: number; threshold: number };
  memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number } | null;
  providers: Array<{
    providerId: string;
    modelId: string;
    requests: number;
    successRate: number;
    p95LatencyMs: number;
    totalCostCents: number;
  }>;
  prompts: Array<{
    promptId: string;
    version: number;
    executions: number;
    successRate: number;
    p95LatencyMs: number;
    totalCostCents: number;
    regressing: boolean;
  }>;
  eventBus: { totalEmitted: number; bufferSize: number; listenerCount: number };
}

export interface HistoryQuery {
  since?: number;
  until?: number;
  limit?: number;
}

/**
 * Storage seam for engineering history. Implementations must never throw
 * into the caller — observability must not be able to break the product.
 */
export interface EngineeringHistoryStore {
  readonly kind: string;
  append(snapshot: EngineeringSnapshot): Promise<void>;
  query(query?: HistoryQuery): Promise<EngineeringSnapshot[]>;
  count(): Promise<number>;
}

function applyQuery(snapshots: EngineeringSnapshot[], query: HistoryQuery = {}): EngineeringSnapshot[] {
  let out = snapshots;
  if (query.since !== undefined) {
    out = out.filter((s) => s.capturedAt >= query.since!);
  }
  if (query.until !== undefined) {
    out = out.filter((s) => s.capturedAt <= query.until!);
  }
  if (query.limit !== undefined && out.length > query.limit) {
    out = out.slice(-query.limit);
  }
  return out;
}

/**
 * Default store. Bounded so a long-running process cannot grow without
 * limit; oldest snapshots are discarded first. Does not survive restart.
 */
export class InMemoryHistoryStore implements EngineeringHistoryStore {
  readonly kind = 'memory';
  private snapshots: EngineeringSnapshot[] = [];

  constructor(private readonly maxSnapshots = 2880) {}

  async append(snapshot: EngineeringSnapshot): Promise<void> {
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.splice(0, this.snapshots.length - this.maxSnapshots);
    }
  }

  async query(query?: HistoryQuery): Promise<EngineeringSnapshot[]> {
    return applyQuery(this.snapshots, query);
  }

  async count(): Promise<number> {
    return this.snapshots.length;
  }

  clear(): void {
    this.snapshots.length = 0;
  }
}

/**
 * Append-only JSONL store. Survives process restart without requiring a
 * database, which keeps engineering history available in environments
 * where no datastore has been provisioned yet.
 *
 * Corrupt or partially-written lines are skipped rather than failing the
 * read: a torn final line from an unclean shutdown must not make the
 * entire history unreadable.
 */
export class FileHistoryStore implements EngineeringHistoryStore {
  readonly kind = 'file';
  private ready: Promise<void> | null = null;

  constructor(private readonly filePath: string) {}

  private ensureDir(): Promise<void> {
    if (!this.ready) {
      this.ready = mkdir(dirname(this.filePath), { recursive: true }).then(() => undefined);
    }
    return this.ready;
  }

  async append(snapshot: EngineeringSnapshot): Promise<void> {
    await this.ensureDir();
    await appendFile(this.filePath, `${JSON.stringify(snapshot)}\n`, 'utf8');
  }

  async query(query?: HistoryQuery): Promise<EngineeringSnapshot[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch {
      return [];
    }

    const snapshots: EngineeringSnapshot[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        snapshots.push(JSON.parse(line) as EngineeringSnapshot);
      } catch {
        continue;
      }
    }
    return applyQuery(snapshots, query);
  }

  async count(): Promise<number> {
    return (await this.query()).length;
  }
}
