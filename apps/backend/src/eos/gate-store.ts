import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
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
 * SECOND INSTANCE OF THIS SHAPE. `BaselineStore` is identical in structure:
 * a keyed record, replaced rather than appended, that must outlive the
 * process. Two instances is where duplication is a note rather than a
 * liability, so it stays duplicated and explicit. A third should trigger
 * extraction into one generic keyed store, and this comment is the marker
 * for whoever adds it.
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

  constructor(private readonly filePath: string) {}

  private async readAll(): Promise<Record<string, GateMeasurement>> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as Record<string, GateMeasurement>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      // A corrupt file must not read as empty. Doing so would silently
      // discard every recorded measurement and reset the board to "nothing
      // proven" while looking entirely normal.
      throw err;
    }
  }

  async save(measurement: GateMeasurement): Promise<void> {
    const all = await this.readAll();
    all[measurement.gateId] = measurement;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(all, null, 2), 'utf8');
  }

  async loadAll(): Promise<GateMeasurement[]> {
    return Object.values(await this.readAll());
  }

  async clear(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, '{}', 'utf8');
  }
}

let store: GateStore = new InMemoryGateStore();

export function setGateStore(next: GateStore): void {
  store = next;
}

export function getGateStore(): GateStore {
  return store;
}
