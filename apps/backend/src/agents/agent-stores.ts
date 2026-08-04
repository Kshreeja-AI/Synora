import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentDefinition, AgentRun } from './types.js';

/**
 * THE THIRD INSTANCE FIRED THE TRIGGER. `gate-store.ts` carries a marker:
 * two instances of the keyed-record shape (gate measurements, regression
 * baselines) were tolerable duplication, and a third should force
 * extraction into one generic keyed store. Agent definitions and runs are
 * instances three and four — so the generic store now exists, here, and
 * the agent stores are built from it rather than copied a third time.
 * Migrating the two older stores onto this generic is deliberate
 * follow-up work, not a same-commit refactor of tested code.
 *
 * Semantics preserved from the originals, because they were earned:
 * a missing file is an empty store; a CORRUPT file raises rather than
 * reading empty, because silently discarding every record while looking
 * normal is the worst failure mode a store can have.
 */

export interface KeyedStore<T> {
  readonly kind: string;
  save(key: string, value: T): Promise<void>;
  loadAll(): Promise<Record<string, T>>;
  clear(): Promise<void>;
}

export class InMemoryKeyedStore<T> implements KeyedStore<T> {
  readonly kind = 'memory';
  private readonly entries = new Map<string, T>();

  async save(key: string, value: T): Promise<void> {
    this.entries.set(key, value);
  }

  async loadAll(): Promise<Record<string, T>> {
    return Object.fromEntries(this.entries);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

export class FileKeyedStore<T> implements KeyedStore<T> {
  readonly kind = 'file';

  constructor(private readonly filePath: string) {}

  private async readAll(): Promise<Record<string, T>> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as Record<string, T>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
  }

  async save(key: string, value: T): Promise<void> {
    const all = await this.readAll();
    all[key] = value;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(all, null, 2), 'utf8');
  }

  async loadAll(): Promise<Record<string, T>> {
    return this.readAll();
  }

  async clear(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, '{}', 'utf8');
  }
}

let definitionStore: KeyedStore<AgentDefinition> = new InMemoryKeyedStore();
let runStore: KeyedStore<AgentRun> = new InMemoryKeyedStore();

export function setAgentDefinitionStore(next: KeyedStore<AgentDefinition>): void {
  definitionStore = next;
}
export function getAgentDefinitionStore(): KeyedStore<AgentDefinition> {
  return definitionStore;
}
export function setAgentRunStore(next: KeyedStore<AgentRun>): void {
  runStore = next;
}
export function getAgentRunStore(): KeyedStore<AgentRun> {
  return runStore;
}
