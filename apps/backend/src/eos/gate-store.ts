import { FileKeyedStore } from '../persistence/keyed-store.js';
import type { GateMeasurement } from './launch-gates.js';

/**
 * Where launch gate measurements live between restarts.
 *
 * WHY THIS EXISTS. The gates held their measurements in memory, so every
 * restart reset the readiness board to "all unmeasured". That is the same
 * defect just fixed for regression baselines, in the component whose entire
 * purpose is to hold the record of what has been proven — and it is worse
 * here, because this is the surface the founder reads. A readiness board
 * that forgets is not a readiness board.
 *
 * THE MARKER THIS FILE CARRIED HAS BEEN RESOLVED. It said that two
 * instances of the keyed-record shape (here and `BaselineStore`) were
 * tolerable duplication, and that a third should trigger extraction into
 * one generic store. Agent definitions and runs became instances three and
 * four, then workflows, schedules and canvases followed. The generic now
 * lives in `persistence/keyed-store.ts`, and the file plumbing below
 * delegates to it.
 *
 * WHAT WAS AND WAS NOT SHARED. The file semantics are shared — missing
 * file is empty, corrupt file raises, a write is read-modify-write. Those
 * were argued for once and are now in one place, so a fix reaches every
 * caller instead of leaving three copies to drift. The INTERFACE below is
 * deliberately not collapsed: `save` takes a measurement and derives its
 * own key, because that is the vocabulary this caller thinks in. Forcing
 * a generic key/value shape on it would push plumbing into every call
 * site to save a handful of lines.
 *
 * `EngineeringHistoryStore` remains outside this, correctly: it is an
 * append-only bounded log with query filters, not a keyed record map, and
 * folding it in would produce an abstraction fitting neither.
 */
export interface GateStore {
  readonly kind: string;
  save(measurement: GateMeasurement): Promise<void>;
  loadAll(): Promise<GateMeasurement[]>;
  clear(): Promise<void>;
}

export class InMemoryGateStore implements GateStore {
  readonly kind = 'memory';
  private readonly measurements = new Map<string, GateMeasurement>();

  async save(measurement: GateMeasurement): Promise<void> {
    this.measurements.set(measurement.gateId, measurement);
  }

  async loadAll(): Promise<GateMeasurement[]> {
    return [...this.measurements.values()];
  }

  async clear(): Promise<void> {
    this.measurements.clear();
  }
}

export class FileGateStore implements GateStore {
  readonly kind = 'file';
  private readonly store: FileKeyedStore<GateMeasurement>;

  constructor(filePath: string) {
    this.store = new FileKeyedStore<GateMeasurement>(filePath);
  }

  /** The key is the gate id — derived here, not asked of the caller. */
  async save(measurement: GateMeasurement): Promise<void> {
    await this.store.save(measurement.gateId, measurement);
  }

  async loadAll(): Promise<GateMeasurement[]> {
    return Object.values(await this.store.loadAll());
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }
}

let store: GateStore = new InMemoryGateStore();

export function setGateStore(next: GateStore): void {
  store = next;
}

export function getGateStore(): GateStore {
  return store;
}
