import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RegressionRun } from './regression-suite.js';

/**
 * Where regression baselines live.
 *
 * WHY THIS IS NOT OPTIONAL. A baseline held in memory vanishes when the
 * process restarts, and a regression suite whose reference point disappears
 * on every restart can never compare across the span of time in which
 * regressions actually happen. The machinery was complete and unusable.
 *
 * The seam mirrors the engineering history store deliberately — same shape,
 * different payload — so there is one pattern for "state that must outlive
 * the process" rather than two.
 *
 * A baseline is REPLACED rather than appended, unlike history. History is a
 * record of what happened and must never lose an entry; a baseline is the
 * single current reference point, and keeping stale ones would invite
 * comparing against whichever happened to be convenient.
 */
export interface BaselineStore {
  readonly kind: string;
  save(baseline: RegressionRun): Promise<void>;
  load(datasetId: string): Promise<RegressionRun | null>;
  list(): Promise<string[]>;
  clear(): Promise<void>;
}

export class InMemoryBaselineStore implements BaselineStore {
  readonly kind = 'memory';
  private readonly baselines = new Map<string, RegressionRun>();

  async save(baseline: RegressionRun): Promise<void> {
    this.baselines.set(baseline.datasetId, baseline);
  }

  async load(datasetId: string): Promise<RegressionRun | null> {
    return this.baselines.get(datasetId) ?? null;
  }

  async list(): Promise<string[]> {
    return [...this.baselines.keys()].sort();
  }

  async clear(): Promise<void> {
    this.baselines.clear();
  }
}

/**
 * A single JSON document keyed by dataset. Rewritten rather than appended
 * because there is exactly one current baseline per dataset.
 */
export class FileBaselineStore implements BaselineStore {
  readonly kind = 'file';

  constructor(private readonly filePath: string) {}

  private async readAll(): Promise<Record<string, RegressionRun>> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as Record<string, RegressionRun>;
    } catch (err) {
      // A missing file is an empty store. A corrupt one must not be
      // silently treated as empty — that would discard every baseline and
      // quietly reset the regression gate to "no reference".
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
  }

  async save(baseline: RegressionRun): Promise<void> {
    const all = await this.readAll();
    all[baseline.datasetId] = baseline;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(all, null, 2), 'utf8');
  }

  async load(datasetId: string): Promise<RegressionRun | null> {
    return (await this.readAll())[datasetId] ?? null;
  }

  async list(): Promise<string[]> {
    return Object.keys(await this.readAll()).sort();
  }

  async clear(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, '{}', 'utf8');
  }
}

let store: BaselineStore = new InMemoryBaselineStore();

export function setBaselineStore(next: BaselineStore): void {
  store = next;
}

export function getBaselineStore(): BaselineStore {
  return store;
}
