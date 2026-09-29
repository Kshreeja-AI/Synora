import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  InMemoryHistoryStore,
  FileHistoryStore,
  type EngineeringSnapshot,
} from '../history-store';

function snapshot(capturedAt: number): EngineeringSnapshot {
  return {
    capturedAt,
    latency: { count: 1, p50: 10, p95: 20, p99: 30, mean: 15 },
    errorRate: { errorsInWindow: 0, windowMs: 60_000, threshold: 10 },
    memory: { rssMb: 100, heapUsedMb: 50, heapTotalMb: 80 },
    providers: [],
    prompts: [],
    eventBus: { totalEmitted: 0, bufferSize: 1000, listenerCount: 0 },
  };
}

describe('InMemoryHistoryStore', () => {
  it('appends and returns snapshots', async () => {
    const store = new InMemoryHistoryStore();
    await store.append(snapshot(1000));
    await store.append(snapshot(2000));

    expect(await store.count()).toBe(2);
    const all = await store.query();
    expect(all.map((s) => s.capturedAt)).toEqual([1000, 2000]);
  });

  it('discards oldest snapshots beyond the bound', async () => {
    const store = new InMemoryHistoryStore(3);
    for (const t of [1, 2, 3, 4, 5]) await store.append(snapshot(t));

    const all = await store.query();
    expect(all).toHaveLength(3);
    expect(all.map((s) => s.capturedAt)).toEqual([3, 4, 5]);
  });

  it('filters by since and until', async () => {
    const store = new InMemoryHistoryStore();
    for (const t of [100, 200, 300, 400]) await store.append(snapshot(t));

    expect((await store.query({ since: 200 })).map((s) => s.capturedAt)).toEqual([200, 300, 400]);
    expect((await store.query({ until: 300 })).map((s) => s.capturedAt)).toEqual([100, 200, 300]);
    expect((await store.query({ since: 200, until: 300 })).map((s) => s.capturedAt)).toEqual([200, 300]);
  });

  it('limit returns the most recent snapshots', async () => {
    const store = new InMemoryHistoryStore();
    for (const t of [1, 2, 3, 4, 5]) await store.append(snapshot(t));

    expect((await store.query({ limit: 2 })).map((s) => s.capturedAt)).toEqual([4, 5]);
  });

  it('reports its kind', () => {
    expect(new InMemoryHistoryStore().kind).toBe('memory');
  });
});

describe('FileHistoryStore', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eos-history-'));
    file = join(dir, 'nested', 'history.jsonl');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('persists snapshots across store instances', async () => {
    const first = new FileHistoryStore(file);
    await first.append(snapshot(1000));
    await first.append(snapshot(2000));

    // A brand-new instance reads what the previous one wrote — this is the
    // property that makes history survive a process restart.
    const second = new FileHistoryStore(file);
    const all = await second.query();
    expect(all.map((s) => s.capturedAt)).toEqual([1000, 2000]);
  });

  it('creates missing parent directories', async () => {
    const store = new FileHistoryStore(file);
    await store.append(snapshot(1));
    expect(await store.count()).toBe(1);
  });

  it('returns empty for a file that does not exist', async () => {
    const store = new FileHistoryStore(join(dir, 'absent.jsonl'));
    expect(await store.query()).toEqual([]);
    expect(await store.count()).toBe(0);
  });

  it('skips a torn trailing line rather than failing the whole read', async () => {
    const store = new FileHistoryStore(file);
    await store.append(snapshot(1000));
    // Simulate an unclean shutdown mid-write.
    await writeFile(file, `${await readFile(file, 'utf8')}{"capturedAt":200`, 'utf8');

    const all = await store.query();
    expect(all).toHaveLength(1);
    expect(all[0].capturedAt).toBe(1000);
  });

  it('applies the same filters as the in-memory store', async () => {
    const store = new FileHistoryStore(file);
    for (const t of [100, 200, 300]) await store.append(snapshot(t));

    expect((await store.query({ since: 200 })).map((s) => s.capturedAt)).toEqual([200, 300]);
    expect((await store.query({ limit: 1 })).map((s) => s.capturedAt)).toEqual([300]);
  });

  it('reports its kind', () => {
    expect(new FileHistoryStore(file).kind).toBe('file');
  });
});
