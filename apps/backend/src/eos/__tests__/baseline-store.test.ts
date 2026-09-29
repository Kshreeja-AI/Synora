/**
 * Baseline store tests.
 *
 * The regression suite was complete and unusable: its baselines lived in
 * memory, so the reference point vanished on every restart — and a
 * comparison whose reference disappears cannot span the time in which
 * regressions actually happen. These tests hold the property that makes it
 * usable: a baseline survives the process that wrote it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileBaselineStore,
  InMemoryBaselineStore,
  getBaselineStore,
  setBaselineStore,
} from '../baseline-store';
import type { RegressionRun } from '../regression-suite';

const baseline: RegressionRun = {
  runId: 'run_1',
  datasetId: 'regression',
  capturedAt: 1_700_000_000_000,
  scores: { case_a: 1, case_b: 0.5 },
  meanScore: 0.75,
  totalCases: 2,
};

describe('baseline-store', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'synora-baseline-'));
  });

  afterEach(async () => {
    setBaselineStore(new InMemoryBaselineStore());
    await rm(dir, { recursive: true, force: true });
  });

  it('defaults to memory, which is why persistence had to be added', async () => {
    expect(getBaselineStore().kind).toBe('memory');
  });

  describe.each([
    ['memory', () => new InMemoryBaselineStore()],
    ['file', () => new FileBaselineStore(join(dir, 'baselines.json'))],
  ])('%s store', (_kind, make) => {
    it('returns null for a dataset with no baseline', async () => {
      // Null, not an empty baseline — "never captured" is not "captured
      // with no cases".
      expect(await make().load('nothing')).toBeNull();
    });

    it('saves and loads a baseline intact', async () => {
      const store = make();
      await store.save(baseline);

      const loaded = await store.load('regression');

      expect(loaded).toEqual(baseline);
      // Per-case scores are the whole point — a later run compares against
      // them individually, not against the mean.
      expect(loaded!.scores.case_b).toBe(0.5);
    });

    it('replaces rather than accumulates, because there is one current reference', async () => {
      const store = make();
      await store.save(baseline);
      await store.save({ ...baseline, runId: 'run_2', meanScore: 0.9 });

      expect((await store.load('regression'))!.runId).toBe('run_2');
      expect(await store.list()).toEqual(['regression']);
    });

    it('keeps datasets separate', async () => {
      const store = make();
      await store.save(baseline);
      await store.save({ ...baseline, datasetId: 'other', runId: 'run_x' });

      expect(await store.list()).toEqual(['other', 'regression']);
      expect((await store.load('other'))!.runId).toBe('run_x');
    });

    it('clears everything', async () => {
      const store = make();
      await store.save(baseline);
      await store.clear();

      expect(await store.list()).toEqual([]);
      expect(await store.load('regression')).toBeNull();
    });
  });

  describe('the file store specifically', () => {
    it('survives the process that wrote it', async () => {
      const path = join(dir, 'baselines.json');
      await new FileBaselineStore(path).save(baseline);

      // A completely separate instance, as a restarted process would have.
      // This is the property the regression gate was missing.
      const afterRestart = await new FileBaselineStore(path).load('regression');

      expect(afterRestart).toEqual(baseline);
    });

    it('treats a missing file as an empty store', async () => {
      expect(await new FileBaselineStore(join(dir, 'nested', 'none.json')).load('x')).toBeNull();
    });

    it('refuses to treat a corrupt file as empty', async () => {
      const path = join(dir, 'corrupt.json');
      await writeFile(path, 'not json at all', 'utf8');

      // Silently returning empty would discard every baseline and reset the
      // regression gate to "no reference" without anyone noticing — the
      // failure mode is worse than the crash.
      await expect(new FileBaselineStore(path).load('regression')).rejects.toThrow();
    });

    it('creates the directory it needs', async () => {
      const store = new FileBaselineStore(join(dir, 'deeply', 'nested', 'baselines.json'));
      await store.save(baseline);
      expect(await store.load('regression')).toEqual(baseline);
    });
  });

  it('is swappable at runtime, so tests and production differ only in wiring', async () => {
    setBaselineStore(new FileBaselineStore(join(dir, 'swapped.json')));
    expect(getBaselineStore().kind).toBe('file');

    await getBaselineStore().save(baseline);
    expect(await getBaselineStore().load('regression')).toEqual(baseline);
  });
});
