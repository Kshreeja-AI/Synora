import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * One keyed record store, used by every subsystem that needs a map of
 * documents to outlive the process.
 *
 * WHY IT LIVES HERE. This began inside `agents/agent-stores.ts`, extracted
 * when agent definitions and runs became the third and fourth instances of
 * the shape that `gate-store.ts` had flagged. It has since been adopted by
 * workflows, schedules and canvases, and the launch-gate and regression
 * baseline stores now delegate to it too. A module that half the platform
 * depends on should not sit inside one feature's folder, so it moved to a
 * neutral home — `agents/agent-stores.ts` re-exports it, keeping existing
 * imports working.
 *
 * WHY THE CONSOLIDATION MATTERED, concretely. Before it, three files each
 * carried their own copy of "missing file is empty, corrupt file raises,
 * write means read-modify-write with mkdir". Those semantics were argued
 * for once and earned: silently discarding every record while looking
 * healthy is the worst thing a store can do. Three copies meant a fix to
 * one would leave the others wrong, and nothing would fail loudly when
 * they drifted. Now there is one copy and one place to fix.
 *
 * The domain-shaped interfaces on top of it were deliberately NOT
 * collapsed. `GateStore.save` derives its key from the measurement;
 * `BaselineStore` offers `load` and `list`. Forcing those callers onto a
 * generic key/value shape would push the domain's vocabulary into every
 * call site to save a few lines. The plumbing is shared; the vocabulary
 * is not.
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
      // A corrupt file must NOT read as empty. Doing so silently discards
      // every record while looking entirely normal — the single worst
      // failure mode a store can have, and the reason this raises.
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
