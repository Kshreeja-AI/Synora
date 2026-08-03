import { createHash } from 'node:crypto';
import { addCase, createDataset, deleteDataset } from './evaluation-datasets.js';
import { runEvaluation, type CaseExecutor } from './evaluation-runner.js';
import { recordGateMeasurement, persistGateMeasurement } from './launch-gates.js';

/**
 * Imports public benchmark datasets into the evaluation platform —
 * versioned, reproducible, and provider-agnostic.
 *
 * WHAT "REPRODUCIBLE" IS HELD TO MEAN HERE. A benchmark score is a claim
 * about a fixed set of questions. So an import records a content hash of
 * exactly what was imported, and a re-import under the same declared
 * version must carry identical content — same hash, and the import is an
 * idempotent no-op; different hash, and it is refused outright. "MMLU
 * v1.2" is never allowed to quietly mean two different sets of questions
 * on two different days, because every score comparison across those days
 * would be meaningless.
 *
 * THE HOLDOUT SPLIT EXISTS TO CATCH OVERFITTING. A fraction of every
 * import is diverted into a separate holdout dataset that routine
 * evaluation never touches — assignment is deterministic (hashed from the
 * content hash and record id), so the same import always produces the
 * same split. If public-split scores climb while holdout scores do not,
 * the system has learned the test rather than the task, and that gap is
 * the only evidence that can show it. The benchmark launch gate is
 * measured on public splits only and says so in its source string.
 *
 * PROVIDER-AGNOSTIC BY CONSTRUCTION: cases are plain input/expected pairs
 * graded by the pure `exact` grader. Nothing here knows what model or
 * provider will answer; the executor is supplied at run time.
 *
 * WHAT THIS DOES NOT DO, stated plainly: it does not fetch anything. The
 * caller supplies records (typically parsed from a local JSONL file) plus
 * a manifest naming the source, the pinned upstream version, and the
 * license. Licensing is recorded as declared by the importer — this
 * module cannot verify it, only refuse to proceed without a declaration.
 */

export interface BenchmarkManifest {
  /** Short stable identifier, e.g. "mmlu". */
  benchmarkId: string;
  name: string;
  /** Where the data came from, e.g. "huggingface:cais/mmlu". */
  source: string;
  /** The pinned upstream version/revision this content corresponds to. */
  sourceVersion: string;
  /** Declared license of the dataset. Required; never guessed. */
  license: string;
}

export interface BenchmarkRecord {
  /** Stable id within the benchmark. Falls back to the record's position. */
  id?: string;
  question: string;
  /** For multiple-choice tasks. Rendered as lettered options. */
  choices?: string[];
  /** The correct answer: a letter for multiple-choice, text otherwise. */
  answer: string;
  /** Optional grouping, e.g. an MMLU subject. */
  subject?: string;
}

export interface ImportedBenchmark {
  benchmarkId: string;
  name: string;
  source: string;
  sourceVersion: string;
  license: string;
  datasetId: string;
  holdoutDatasetId: string;
  contentHash: string;
  publicCases: number;
  holdoutCases: number;
  importedAt: number;
}

export interface ImportResult extends ImportedBenchmark {
  /** True when this exact content was already imported (no-op re-import). */
  alreadyImported: boolean;
}

const imported = new Map<string, ImportedBenchmark>();

const LETTERS = 'ABCDEFGHIJ';

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Hash of exactly the content that shapes the cases. Field order is fixed
 * here so the hash depends on the data, not on how the caller's JSON
 * happened to order its keys.
 */
export function hashRecords(records: BenchmarkRecord[]): string {
  const canonical = records.map((r, i) => [
    r.id ?? String(i),
    r.question,
    r.choices ?? null,
    r.answer,
    r.subject ?? null,
  ]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Deterministic holdout assignment: same content, same split, forever. */
function isHoldout(contentHash: string, recordId: string, holdoutFraction: number): boolean {
  const h = createHash('sha256').update(`${contentHash}:${recordId}`).digest();
  return h.readUInt32BE(0) / 0xffffffff < holdoutFraction;
}

function renderInput(record: BenchmarkRecord): string {
  if (!record.choices || record.choices.length === 0) return record.question;
  const options = record.choices
    .map((choice, i) => `${LETTERS[i] ?? `#${i}`}. ${choice}`)
    .join('\n');
  return `${record.question}\n\n${options}\n\nAnswer with the letter of the correct option.`;
}

/**
 * Parses one-JSON-object-per-line benchmark files — the shape most public
 * benchmark distributions use. Fails loudly with the line number rather
 * than skipping bad lines, because a silently shortened benchmark is a
 * different benchmark wearing the same name.
 */
export function parseBenchmarkRecords(jsonl: string): BenchmarkRecord[] {
  const records: BenchmarkRecord[] = [];
  const lines = jsonl.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.length === 0) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new Error(`line ${i + 1}: not valid JSON`);
    }

    const question = parsed.question;
    if (typeof question !== 'string' || question.length === 0) {
      throw new Error(`line ${i + 1}: missing "question"`);
    }

    const choices = Array.isArray(parsed.choices)
      ? parsed.choices.map((c) => String(c))
      : undefined;

    // Accept either an explicit answer string or an index into choices —
    // both appear in the wild; both normalise to the same stored form.
    let answer: string;
    if (typeof parsed.answer === 'string' && parsed.answer.length > 0) {
      answer = parsed.answer;
    } else if (typeof parsed.answerIndex === 'number' && choices) {
      const letter = LETTERS[parsed.answerIndex];
      if (!letter || parsed.answerIndex >= choices.length) {
        throw new Error(`line ${i + 1}: answerIndex ${parsed.answerIndex} out of range`);
      }
      answer = letter;
    } else {
      throw new Error(`line ${i + 1}: missing "answer" (or "answerIndex" with choices)`);
    }

    records.push({
      id: typeof parsed.id === 'string' ? parsed.id : undefined,
      question,
      choices,
      answer,
      subject: typeof parsed.subject === 'string' ? parsed.subject : undefined,
    });
  }

  return records;
}

export function importBenchmark(
  manifest: BenchmarkManifest,
  records: BenchmarkRecord[],
  opts: { holdoutFraction?: number } = {},
): ImportResult {
  for (const field of ['benchmarkId', 'name', 'source', 'sourceVersion', 'license'] as const) {
    if (!manifest[field] || manifest[field].trim().length === 0) {
      throw new Error(`manifest.${field} is required — a benchmark without ${field} is not importable`);
    }
  }
  if (records.length === 0) {
    throw new Error('refusing to import an empty benchmark');
  }
  const holdoutFraction = opts.holdoutFraction ?? 0.2;
  if (holdoutFraction < 0 || holdoutFraction >= 1) {
    throw new Error('holdoutFraction must be in [0, 1)');
  }

  const contentHash = hashRecords(records);
  const datasetId = `bench_${slug(manifest.benchmarkId)}_${slug(manifest.sourceVersion)}`;
  const holdoutDatasetId = `${datasetId}_holdout`;

  const existing = imported.get(datasetId);
  if (existing) {
    if (existing.contentHash === contentHash) {
      // Same declared version, same content: importing again changes
      // nothing and should not pretend to.
      return { ...existing, alreadyImported: true };
    }
    throw new Error(
      `benchmark ${manifest.benchmarkId}@${manifest.sourceVersion} is already imported with different ` +
        `content (hash ${existing.contentHash.slice(0, 12)} vs ${contentHash.slice(0, 12)}). The same ` +
        `declared version must always mean the same questions; import the new content under a new version.`,
    );
  }

  const provenance = `imported from ${manifest.source}@${manifest.sourceVersion} (license: ${manifest.license})`;
  createDataset({
    id: datasetId,
    name: `${manifest.name} (public split)`,
    description: `${provenance}. Content hash ${contentHash}.`,
  });
  createDataset({
    id: holdoutDatasetId,
    name: `${manifest.name} (holdout split)`,
    description:
      `${provenance}. Held out from routine evaluation to detect overfitting: if public-split ` +
      `scores rise while this split's do not, the system is learning the test, not the task.`,
  });

  let publicCases = 0;
  let holdoutCases = 0;
  records.forEach((record, i) => {
    const recordId = record.id ?? String(i);
    const holdout = isHoldout(contentHash, recordId, holdoutFraction);
    const targetId = holdout ? holdoutDatasetId : datasetId;

    addCase(targetId, {
      id: `${slug(manifest.benchmarkId)}_${recordId}`,
      input: renderInput(record),
      expected: record.answer,
      graders: [{ grader: 'exact' }],
      origin: 'benchmark',
      tags: [
        `benchmark:${manifest.benchmarkId}`,
        `split:${holdout ? 'holdout' : 'public'}`,
        ...(record.subject ? [`subject:${record.subject}`] : []),
      ],
      note: provenance,
    });
    if (holdout) holdoutCases += 1;
    else publicCases += 1;
  });

  const entry: ImportedBenchmark = {
    benchmarkId: manifest.benchmarkId,
    name: manifest.name,
    source: manifest.source,
    sourceVersion: manifest.sourceVersion,
    license: manifest.license,
    datasetId,
    holdoutDatasetId,
    contentHash,
    publicCases,
    holdoutCases,
    importedAt: Date.now(),
  };
  imported.set(datasetId, entry);
  return { ...entry, alreadyImported: false };
}

export function listImportedBenchmarks(): ImportedBenchmark[] {
  return [...imported.values()].sort((a, b) => a.benchmarkId.localeCompare(b.benchmarkId));
}

/** Removes imported benchmarks and their datasets. Intended for tests. */
export function resetBenchmarks(): void {
  for (const entry of imported.values()) {
    deleteDataset(entry.datasetId);
    deleteDataset(entry.holdoutDatasetId);
  }
  imported.clear();
}

export interface BenchmarkGateResult {
  passRatePercent: number;
  totalCases: number;
  passedCases: number;
  /** Per-benchmark pass rates so one weak suite cannot hide in an average. */
  perBenchmark: { benchmarkId: string; passRatePercent: number; cases: number }[];
}

/**
 * Runs every imported benchmark's PUBLIC split and records the aggregate
 * pass rate against the benchmark launch gate. Holdout splits are never
 * touched here — they exist to be run rarely and deliberately, so routine
 * measurement cannot overfit to them.
 *
 * Returns null when no benchmark is imported: the gate stays unmeasured,
 * because a pass rate over zero questions is not a measurement.
 */
export async function measureBenchmarkGate(executor: CaseExecutor): Promise<BenchmarkGateResult | null> {
  const benchmarks = listImportedBenchmarks();
  if (benchmarks.length === 0) return null;

  let totalCases = 0;
  let passedCases = 0;
  const perBenchmark: BenchmarkGateResult['perBenchmark'] = [];

  for (const bench of benchmarks) {
    const run = await runEvaluation(bench.datasetId, executor, {
      label: `benchmark gate: ${bench.benchmarkId}@${bench.sourceVersion} (public split)`,
    });
    if (!run) continue;
    totalCases += run.totalCases;
    passedCases += run.passedCases;
    perBenchmark.push({
      benchmarkId: bench.benchmarkId,
      passRatePercent: run.passRate * 100,
      cases: run.totalCases,
    });
  }

  if (totalCases === 0) return null;

  const passRatePercent = (passedCases / totalCases) * 100;
  recordGateMeasurement({
    gateId: 'benchmark-pass-rate',
    value: passRatePercent,
    source:
      `${benchmarks.length} imported benchmark(s), public splits only (holdout preserved): ` +
      benchmarks.map((b) => `${b.benchmarkId}@${b.sourceVersion}`).join(', '),
    measuredAt: Date.now(),
    sampleSize: totalCases,
  });
  await persistGateMeasurement('benchmark-pass-rate');

  return { passRatePercent, totalCases, passedCases, perBenchmark };
}
