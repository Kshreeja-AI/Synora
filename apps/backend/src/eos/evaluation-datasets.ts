import type { GraderSpec } from './evaluation-graders.js';

/**
 * Where a case came from. This is required rather than optional and has no
 * default: synthetic cases must never be silently mistaken for observed
 * behaviour, because a benchmark built on invented data that looks real is
 * worse than no benchmark at all.
 *
 * `benchmark` is its own origin, not a flavour of the other two: a case
 * imported from a public benchmark is neither observed customer behaviour
 * nor something we invented, and folding it into either would misstate
 * what a score on it means.
 */
export type CaseOrigin = 'real' | 'synthetic' | 'benchmark';

export interface EvaluationCase {
  id: string;
  /** What gets sent to the system under test. */
  input: string;
  /** Reference answer, where one exists. Some graders do not need it. */
  expected?: string;
  /**
   * What the system actually produced when this case was captured. For a
   * captured failure this is the *bad* output, which is why it must never
   * be stored in `expected` — graders treat `expected` as the correct
   * answer, so a case recorded that way would score reproducing the failure
   * as a pass and a genuine fix as a regression.
   */
  actualOutput?: string;
  graders: GraderSpec[];
  origin: CaseOrigin;
  tags: string[];
  /** Free-form provenance, e.g. "captured from conversation 1a2b". */
  note?: string;
  createdAt: number;
}

export interface EvaluationDataset {
  id: string;
  name: string;
  description?: string;
  /** Incremented on every mutation so a run can name the exact data it used. */
  version: number;
  cases: EvaluationCase[];
  createdAt: number;
  updatedAt: number;
}

export interface DatasetSummary {
  id: string;
  name: string;
  version: number;
  caseCount: number;
  realCases: number;
  syntheticCases: number;
  benchmarkCases: number;
  tags: string[];
  updatedAt: number;
}

const datasets = new Map<string, EvaluationDataset>();

export function createDataset(input: {
  id: string;
  name: string;
  description?: string;
}): EvaluationDataset {
  const existing = datasets.get(input.id);
  if (existing) return existing;

  const now = Date.now();
  const dataset: EvaluationDataset = {
    id: input.id,
    name: input.name,
    description: input.description,
    version: 1,
    cases: [],
    createdAt: now,
    updatedAt: now,
  };
  datasets.set(input.id, dataset);
  return dataset;
}

export function addCase(
  datasetId: string,
  input: {
    id: string;
    input: string;
    expected?: string;
    /** What the system actually produced. Never a reference answer. */
    actualOutput?: string;
    graders: GraderSpec[];
    origin: CaseOrigin;
    tags?: string[];
    note?: string;
  },
): EvaluationCase | null {
  const dataset = datasets.get(datasetId);
  if (!dataset) return null;

  // Replacing a case in place keeps case ids stable across refinements,
  // so a case's history stays traceable rather than fragmenting.
  const evalCase: EvaluationCase = {
    id: input.id,
    input: input.input,
    expected: input.expected,
    actualOutput: input.actualOutput,
    graders: input.graders,
    origin: input.origin,
    tags: input.tags ?? [],
    note: input.note,
    createdAt: Date.now(),
  };

  const idx = dataset.cases.findIndex((c) => c.id === input.id);
  if (idx >= 0) {
    dataset.cases[idx] = evalCase;
  } else {
    dataset.cases.push(evalCase);
  }

  dataset.version += 1;
  dataset.updatedAt = Date.now();
  return evalCase;
}

export function removeCase(datasetId: string, caseId: string): boolean {
  const dataset = datasets.get(datasetId);
  if (!dataset) return false;

  const idx = dataset.cases.findIndex((c) => c.id === caseId);
  if (idx < 0) return false;

  dataset.cases.splice(idx, 1);
  dataset.version += 1;
  dataset.updatedAt = Date.now();
  return true;
}

export function getDataset(datasetId: string): EvaluationDataset | undefined {
  return datasets.get(datasetId);
}

/** Cases filtered by tag, useful for running a focused subset. */
export function getCases(datasetId: string, opts: { tag?: string; origin?: CaseOrigin } = {}): EvaluationCase[] {
  const dataset = datasets.get(datasetId);
  if (!dataset) return [];

  return dataset.cases.filter((c) => {
    if (opts.tag && !c.tags.includes(opts.tag)) return false;
    if (opts.origin && c.origin !== opts.origin) return false;
    return true;
  });
}

export function summarizeDataset(datasetId: string): DatasetSummary | null {
  const dataset = datasets.get(datasetId);
  if (!dataset) return null;

  const tags = new Set<string>();
  let realCases = 0;
  let syntheticCases = 0;
  let benchmarkCases = 0;
  for (const c of dataset.cases) {
    for (const t of c.tags) tags.add(t);
    // Counted explicitly per origin — an else-bucket here once meant a new
    // origin would silently inflate whichever count it fell into.
    if (c.origin === 'real') realCases += 1;
    else if (c.origin === 'synthetic') syntheticCases += 1;
    else benchmarkCases += 1;
  }

  return {
    id: dataset.id,
    name: dataset.name,
    version: dataset.version,
    caseCount: dataset.cases.length,
    realCases,
    syntheticCases,
    benchmarkCases,
    tags: [...tags].sort(),
    updatedAt: dataset.updatedAt,
  };
}

export function listDatasets(): DatasetSummary[] {
  return [...datasets.keys()]
    .map((id) => summarizeDataset(id))
    .filter((s): s is DatasetSummary => s !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteDataset(datasetId: string): boolean {
  return datasets.delete(datasetId);
}

/** Clears every dataset. Intended for tests. */
export function resetDatasets(): void {
  datasets.clear();
}
