import { FileKeyedStore } from '../persistence/keyed-store.js';
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
  private readonly store: FileKeyedStore<RegressionRun>;

  /**
   * The file semantics — missing file is an empty store, a corrupt one
   * raises rather than quietly resetting the regression gate to "no
   * reference" — now live in the shared keyed store, so they are stated
   * and fixed in one place rather than three.
   */
  constructor(filePath: string) {
    this.store = new FileKeyedStore<RegressionRun>(filePath);
  }

  /** Keyed by dataset: one baseline per dataset, replaced not appended. */
  async save(baseline: RegressionRun): Promise<void> {
    await this.store.save(baseline.datasetId, baseline);
  }

  async load(datasetId: string): Promise<RegressionRun | null> {
    return (await this.store.loadAll())[datasetId] ?? null;
  }

  async list(): Promise<string[]> {
    return Object.keys(await this.store.loadAll()).sort();
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }
}

let store: BaselineStore = new InMemoryBaselineStore();

export function setBaselineStore(next: BaselineStore): void {
  store = next;
}

export function getBaselineStore(): BaselineStore {
  return store;
}
