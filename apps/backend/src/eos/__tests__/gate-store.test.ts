/**
 * Gate store tests.
 *
 * The launch gates held their measurements in memory, so every restart
 * reset the readiness board to "all unmeasured" — the same defect just
 * fixed for regression baselines, in the component whose whole purpose is
 * to hold the record of what has been proven, and on the surface the
 * founder reads. A readiness board that forgets is not a readiness board.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileGateStore, InMemoryGateStore, getGateStore, setGateStore } from '../gate-store';
import {
  clearGateMeasurements,
  getLaunchReadiness,
  hydrateGateMeasurements,
  persistGateMeasurement,
  recordGateMeasurement,
} from '../launch-gates';

const measurement = {
  gateId: 'privacy-tests',
  value: 100,
  source: 'privacy coverage audit across 1 declared egress path(s)',
  measuredAt: 1_700_000_000_000,
  sampleSize: 1,
};

describe('gate-store', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'synora-gates-'));
    clearGateMeasurements();
    setGateStore(new InMemoryGateStore());
  });

  afterEach(async () => {
    setGateStore(new InMemoryGateStore());
    await rm(dir, { recursive: true, force: true });
  });

  describe.each([
    ['memory', () => new InMemoryGateStore()],
    ['file', () => new FileGateStore(join(dir, 'gates.json'))],
  ])('%s store', (_kind, make) => {
    it('starts empty', async () => {
      expect(await make().loadAll()).toEqual([]);
    });

    it('saves and reloads a measurement with its evidence intact', async () => {
      const store = make();
      await store.save(measurement);

      const [loaded] = await store.loadAll();

      // Source and sample size are what make it a measurement rather than
      // an assertion, so they must survive the round trip.
      expect(loaded.source).toBe(measurement.source);
      expect(loaded.sampleSize).toBe(1);
    });

    it('replaces a gate measurement rather than accumulating', async () => {
      const store = make();
      await store.save(measurement);
      await store.save({ ...measurement, value: 80, sampleSize: 5 });

      const all = await store.loadAll();
      expect(all).toHaveLength(1);
      expect(all[0].value).toBe(80);
    });

    it('clears everything', async () => {
      const store = make();
      await store.save(measurement);
      await store.clear();
      expect(await store.loadAll()).toEqual([]);
    });
  });

  describe('the file store specifically', () => {
    it('survives the process that wrote it', async () => {
      const path = join(dir, 'gates.json');
      await new FileGateStore(path).save(measurement);

      const [afterRestart] = await new FileGateStore(path).loadAll();

      expect(afterRestart).toEqual(measurement);
    });

    it('refuses to treat a corrupt file as empty', async () => {
      const path = join(dir, 'corrupt.json');
      await writeFile(path, 'nonsense', 'utf8');

      // Reading as empty would silently discard every recorded measurement
      // and reset the board to "nothing proven", while looking normal.
      await expect(new FileGateStore(path).loadAll()).rejects.toThrow();
    });
  });

  describe('hydrating the gates at startup', () => {
    it('restores a measured gate after a restart', async () => {
      const path = join(dir, 'gates.json');
      setGateStore(new FileGateStore(path));
      recordGateMeasurement(measurement);
      await persistGateMeasurement('privacy-tests');

      // Simulate the restart: memory is wiped, the file is not.
      clearGateMeasurements();
      expect(getLaunchReadiness().gates.find((g) => g.id === 'privacy-tests')!.status).toBe(
        'unmeasured',
      );

      const loaded = await hydrateGateMeasurements();

      expect(loaded).toBe(1);
      const gate = getLaunchReadiness().gates.find((g) => g.id === 'privacy-tests')!;
      expect(gate.status).toBe('passed');
      expect(gate.value).toBe(100);
      expect(gate.source).toBe(measurement.source);
    });

    it('discards a stored measurement for a gate that no longer exists', async () => {
      const store = new InMemoryGateStore();
      // Written by an earlier version whose gate list has since changed.
      await store.save({ ...measurement, gateId: 'retired-gate' });
      setGateStore(store);

      expect(await hydrateGateMeasurements()).toBe(0);
    });

    it('re-validates on the way in rather than trusting the file', async () => {
      const store = new InMemoryGateStore();
      // A zero sample size is refused when recorded, and must be refused
      // when restored — otherwise the file is a way around the check.
      await store.save({ ...measurement, sampleSize: 0 });
      setGateStore(store);

      expect(await hydrateGateMeasurements()).toBe(0);
      expect(getLaunchReadiness().gates.find((g) => g.id === 'privacy-tests')!.status).toBe(
        'unmeasured',
      );
    });

    it('persists nothing for a gate that was never recorded', async () => {
      expect(await persistGateMeasurement('ai-quality')).toBe(false);
    });
  });

  it('defaults to memory, and is swappable at runtime', async () => {
    expect(getGateStore().kind).toBe('memory');
    setGateStore(new FileGateStore(join(dir, 'swapped.json')));
    expect(getGateStore().kind).toBe('file');
  });
});
