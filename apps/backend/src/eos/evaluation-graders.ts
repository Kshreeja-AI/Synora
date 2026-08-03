/**
 * Graders score a single AI output against a case's expectation.
 *
 * A grader is deliberately a pure function: given the same output it must
 * return the same grade, so an evaluation run is reproducible and a score
 * change always means the output changed, never that the ruler moved.
 */

export interface GradeResult {
  passed: boolean;
  /** Normalised 0..1. Binary graders return exactly 0 or 1. */
  score: number;
  detail?: string;
}

export interface GraderSpec {
  grader: string;
  /** Grader-specific options, e.g. { pattern } for regex. */
  config?: Record<string, unknown>;
  /** Relative importance when a case has several graders. Defaults to 1. */
  weight?: number;
}

export type Grader = (
  output: string,
  expected: string | undefined,
  config: Record<string, unknown>,
) => GradeResult;

function normalise(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

const builtinGraders: Record<string, Grader> = {
  /** Output must equal the expectation, ignoring case and whitespace runs. */
  exact: (output, expected) => {
    if (expected === undefined) {
      return { passed: false, score: 0, detail: 'no expected value provided' };
    }
    const passed = normalise(output) === normalise(expected);
    return { passed, score: passed ? 1 : 0, detail: passed ? undefined : 'output did not match expected' };
  },

  /** Output must contain the expectation as a substring. */
  contains: (output, expected) => {
    if (expected === undefined) {
      return { passed: false, score: 0, detail: 'no expected value provided' };
    }
    const passed = normalise(output).includes(normalise(expected));
    return { passed, score: passed ? 1 : 0, detail: passed ? undefined : 'expected substring absent' };
  },

  /** Output must match a regular expression. */
  regex: (output, _expected, config) => {
    const pattern = config.pattern;
    if (typeof pattern !== 'string') {
      return { passed: false, score: 0, detail: 'regex grader requires a string pattern' };
    }
    let re: RegExp;
    try {
      re = new RegExp(pattern, typeof config.flags === 'string' ? config.flags : undefined);
    } catch {
      return { passed: false, score: 0, detail: `invalid pattern: ${pattern}` };
    }
    const passed = re.test(output);
    return { passed, score: passed ? 1 : 0, detail: passed ? undefined : `did not match /${pattern}/` };
  },

  /** Output must parse as JSON — the common failure mode for structured calls. */
  jsonValid: (output) => {
    try {
      JSON.parse(output);
      return { passed: true, score: 1 };
    } catch {
      return { passed: false, score: 0, detail: 'output is not valid JSON' };
    }
  },

  /** Output must not be blank. The cheapest possible sanity check. */
  nonEmpty: (output) => {
    const passed = output.trim().length > 0;
    return { passed, score: passed ? 1 : 0, detail: passed ? undefined : 'output was empty' };
  },

  /**
   * Output length must fall within bounds. Catches truncation and runaway
   * generation, both of which can occur without any error being raised.
   */
  lengthWithin: (output, _expected, config) => {
    const min = typeof config.min === 'number' ? config.min : 0;
    const max = typeof config.max === 'number' ? config.max : Number.POSITIVE_INFINITY;
    const len = output.trim().length;
    const passed = len >= min && len <= max;
    return {
      passed,
      score: passed ? 1 : 0,
      detail: passed ? undefined : `length ${len} outside [${min}, ${max}]`,
    };
  },

  /**
   * Fraction of expected keywords present. Unlike the binary graders this
   * returns partial credit, so gradual quality drift is visible rather
   * than only total failure.
   */
  keywordCoverage: (output, _expected, config) => {
    const keywords = Array.isArray(config.keywords)
      ? config.keywords.filter((k): k is string => typeof k === 'string')
      : [];
    if (keywords.length === 0) {
      return { passed: false, score: 0, detail: 'keywordCoverage requires a keywords array' };
    }
    const haystack = normalise(output);
    const hits = keywords.filter((k) => haystack.includes(normalise(k)));
    const score = hits.length / keywords.length;
    const threshold = typeof config.threshold === 'number' ? config.threshold : 1;
    return {
      passed: score >= threshold,
      score,
      detail: `${hits.length}/${keywords.length} keywords present`,
    };
  },
};

const registry = new Map<string, Grader>(Object.entries(builtinGraders));

export function registerGrader(name: string, grader: Grader): void {
  registry.set(name, grader);
}

export function getGrader(name: string): Grader | undefined {
  return registry.get(name);
}

export function listGraders(): string[] {
  return [...registry.keys()].sort();
}

/** Restores the built-in set, discarding custom graders. Intended for tests. */
export function resetGraders(): void {
  registry.clear();
  for (const [name, grader] of Object.entries(builtinGraders)) {
    registry.set(name, grader);
  }
}

/**
 * Applies every grader on a case and combines them into a weighted score.
 * An unknown grader fails closed — scoring silently skipping a rule would
 * inflate results and make an evaluation actively misleading.
 */
export function applyGraders(
  output: string,
  expected: string | undefined,
  specs: GraderSpec[],
): { passed: boolean; score: number; results: Array<GradeResult & { grader: string }> } {
  if (specs.length === 0) {
    return { passed: false, score: 0, results: [] };
  }

  const results: Array<GradeResult & { grader: string }> = [];
  let weightedScore = 0;
  let totalWeight = 0;
  let allPassed = true;

  for (const spec of specs) {
    const weight = spec.weight ?? 1;
    const grader = registry.get(spec.grader);

    const result: GradeResult = grader
      ? grader(output, expected, spec.config ?? {})
      : { passed: false, score: 0, detail: `unknown grader: ${spec.grader}` };

    results.push({ ...result, grader: spec.grader });
    weightedScore += result.score * weight;
    totalWeight += weight;
    if (!result.passed) allPassed = false;
  }

  return {
    passed: allPassed,
    score: totalWeight > 0 ? weightedScore / totalWeight : 0,
    results,
  };
}
