/**
 * Benchmark importer tests.
 *
 * The properties under test are the founder's constraints, verbatim:
 * versioned, reproducible, provider-agnostic — plus the two refusals that
 * keep scores meaningful: the same declared version may never mean two
 * different sets of questions, and the holdout split is never touched by
 * routine gate measurement.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  hashRecords,
  importBenchmark,
  listImportedBenchmarks,
  measureBenchmarkGate,
  parseBenchmarkRecords,
  resetBenchmarks,
  type BenchmarkManifest,
  type BenchmarkRecord,
} from '../benchmark-importer';
import { getCases, getDataset, resetDatasets } from '../evaluation-datasets';
import { clearGateMeasurements, getLaunchReadiness } from '../launch-gates';

const manifest: BenchmarkManifest = {
  benchmarkId: 'mini-mmlu',
  name: 'Mini MMLU',
  source: 'huggingface:cais/mmlu',
  sourceVersion: 'rev-abc123',
  license: 'MIT',
};

function records(n: number): BenchmarkRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `q${i}`,
    question: `Question number ${i}?`,
    choices: ['first', 'second', 'third', 'fourth'],
    answer: 'A',
    subject: i % 2 === 0 ? 'history' : 'physics',
  }));
}

describe('benchmark-importer', () => {
  beforeEach(() => {
    resetBenchmarks();
    resetDatasets();
    clearGateMeasurements();
  });

  describe('importing', () => {
    it('creates public and holdout datasets with benchmark-origin cases', () => {
      const result = importBenchmark(manifest, records(50));

      expect(result.publicCases + result.holdoutCases).toBe(50);
      // With a 20% holdout over 50 records both splits must be populated;
      // an empty holdout would mean overfitting is undetectable.
      expect(result.holdoutCases).toBeGreaterThan(0);
      expect(result.publicCases).toBeGreaterThan(result.holdoutCases);

      const publicCases = getCases(result.datasetId);
      expect(publicCases).toHaveLength(result.publicCases);
      expect(publicCases.every((c) => c.origin === 'benchmark')).toBe(true);
      expect(publicCases.every((c) => c.tags.includes('split:public'))).toBe(true);
      expect(getCases(result.holdoutDatasetId).every((c) => c.tags.includes('split:holdout'))).toBe(true);
    });

    it('records provenance on every case and both datasets', () => {
      const result = importBenchmark(manifest, records(10));

      expect(getCases(result.datasetId)[0].note).toContain('huggingface:cais/mmlu@rev-abc123');
      expect(getCases(result.datasetId)[0].note).toContain('license: MIT');
      expect(getDataset(result.datasetId)!.description).toContain(result.contentHash);
      expect(getDataset(result.holdoutDatasetId)!.description).toMatch(/learning the test, not the task/i);
    });

    it('renders multiple-choice questions with lettered options', () => {
      const result = importBenchmark(manifest, [
        { id: 'q0', question: 'Pick one.', choices: ['aa', 'bb'], answer: 'B' },
      ]);

      const all = [...getCases(result.datasetId), ...getCases(result.holdoutDatasetId)];
      expect(all).toHaveLength(1);
      expect(all[0].input).toContain('A. aa');
      expect(all[0].input).toContain('B. bb');
      expect(all[0].input).toMatch(/answer with the letter/i);
      expect(all[0].expected).toBe('B');
    });

    it('assigns the holdout split deterministically, not randomly', () => {
      const first = importBenchmark(manifest, records(50));
      const firstHoldoutIds = getCases(first.holdoutDatasetId).map((c) => c.id).sort();

      resetBenchmarks();
      resetDatasets();

      const second = importBenchmark(manifest, records(50));
      const secondHoldoutIds = getCases(second.holdoutDatasetId).map((c) => c.id).sort();

      // Same content, same split, forever — a reshuffling split would make
      // public-vs-holdout comparisons across imports meaningless.
      expect(secondHoldoutIds).toEqual(firstHoldoutIds);
    });

    it('re-importing identical content is an idempotent no-op', () => {
      const first = importBenchmark(manifest, records(20));
      const versionBefore = getDataset(first.datasetId)!.version;

      const second = importBenchmark(manifest, records(20));

      expect(second.alreadyImported).toBe(true);
      expect(second.contentHash).toBe(first.contentHash);
      expect(getDataset(first.datasetId)!.version).toBe(versionBefore);
    });

    it('refuses the same declared version with different content', () => {
      importBenchmark(manifest, records(20));

      const altered = records(20);
      altered[3].answer = 'B';

      // "v1.2" meaning different questions on different days would make
      // every score comparison across those days meaningless.
      expect(() => importBenchmark(manifest, altered)).toThrow(/already imported with different content/i);
    });

    it('refuses an empty benchmark and an undeclared license', () => {
      expect(() => importBenchmark(manifest, [])).toThrow(/empty benchmark/i);
      expect(() => importBenchmark({ ...manifest, license: '' }, records(5))).toThrow(
        /manifest\.license is required/i,
      );
    });

    it('hashes content, not key order or field presence quirks', () => {
      const a: BenchmarkRecord[] = [{ id: 'x', question: 'Q?', answer: 'A' }];
      const b: BenchmarkRecord[] = [{ answer: 'A', question: 'Q?', id: 'x' }];
      expect(hashRecords(a)).toBe(hashRecords(b));

      const c: BenchmarkRecord[] = [{ id: 'x', question: 'Q?', answer: 'B' }];
      expect(hashRecords(a)).not.toBe(hashRecords(c));
    });
  });

  describe('parsing JSONL', () => {
    it('parses records with answer strings and answerIndex alike', () => {
      const parsed = parseBenchmarkRecords(
        [
          '{"id":"a","question":"Q1?","choices":["x","y"],"answer":"B","subject":"math"}',
          '',
          '{"question":"Q2?","choices":["x","y","z"],"answerIndex":2}',
        ].join('\n'),
      );

      expect(parsed).toHaveLength(2);
      expect(parsed[0].answer).toBe('B');
      expect(parsed[0].subject).toBe('math');
      // answerIndex 2 → letter C: both upstream shapes normalise to one form.
      expect(parsed[1].answer).toBe('C');
    });

    it('fails loudly with the line number rather than skipping bad lines', () => {
      // A silently shortened benchmark is a different benchmark wearing the
      // same name.
      expect(() => parseBenchmarkRecords('{"question":"ok","answer":"A"}\nnot json')).toThrow(/line 2/);
      expect(() => parseBenchmarkRecords('{"answer":"A"}')).toThrow(/line 1.*question/i);
      expect(() =>
        parseBenchmarkRecords('{"question":"Q?","choices":["x"],"answerIndex":5}'),
      ).toThrow(/out of range/);
    });
  });

  describe('the benchmark launch gate', () => {
    const executor = (answer: string) => async () => ({ output: answer });

    it('stays unmeasured when nothing is imported', async () => {
      expect(await measureBenchmarkGate(executor('A'))).toBeNull();
      expect(
        getLaunchReadiness().gates.find((g) => g.id === 'benchmark-pass-rate')!.status,
      ).toBe('unmeasured');
    });

    it('measures the pass rate over public splits and records the gate', async () => {
      importBenchmark(manifest, records(50));

      const result = await measureBenchmarkGate(executor('A'));

      // Every answer in the fixture is A, so a model that always says A
      // passes everything — the point is the arithmetic, not the model.
      expect(result!.passRatePercent).toBe(100);
      expect(result!.totalCases).toBe(result!.perBenchmark[0].cases);

      const gate = getLaunchReadiness().gates.find((g) => g.id === 'benchmark-pass-rate')!;
      expect(gate.status).toBe('passed');
      expect(gate.sampleSize).toBe(result!.totalCases);
      expect(gate.source).toMatch(/public splits only \(holdout preserved\)/);
      expect(gate.source).toContain('mini-mmlu@rev-abc123');
    });

    it('fails the gate honestly when the pass rate misses 98%', async () => {
      importBenchmark(manifest, records(50));

      const result = await measureBenchmarkGate(executor('B'));

      expect(result!.passRatePercent).toBe(0);
      expect(
        getLaunchReadiness().gates.find((g) => g.id === 'benchmark-pass-rate')!.status,
      ).toBe('failed');
    });

    it('never executes holdout cases during gate measurement', async () => {
      const imported = importBenchmark(manifest, records(50));
      let executions = 0;
      await measureBenchmarkGate(async () => {
        executions += 1;
        return { output: 'A' };
      });

      // Exactly the public split, not one case more: the holdout stays
      // unrun so routine measurement cannot overfit to it.
      expect(executions).toBe(imported.publicCases);
      expect(getCases(imported.holdoutDatasetId).length).toBe(imported.holdoutCases);
    });

    it('reports per-benchmark rates so one weak suite cannot hide in the average', async () => {
      importBenchmark(manifest, records(30));
      importBenchmark(
        { ...manifest, benchmarkId: 'mini-gpqa', name: 'Mini GPQA', sourceVersion: 'rev-def456' },
        Array.from({ length: 30 }, (_, i) => ({
          id: `g${i}`,
          question: `Hard question ${i}?`,
          choices: ['p', 'q'],
          answer: 'B',
        })),
      );

      const result = await measureBenchmarkGate(executor('A'));

      expect(result!.perBenchmark).toHaveLength(2);
      const rates = Object.fromEntries(result!.perBenchmark.map((b) => [b.benchmarkId, b.passRatePercent]));
      expect(rates['mini-mmlu']).toBe(100);
      expect(rates['mini-gpqa']).toBe(0);
      expect(listImportedBenchmarks()).toHaveLength(2);
    });
  });
});
