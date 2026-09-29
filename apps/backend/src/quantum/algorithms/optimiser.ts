/**
 * Gradient-free classical optimisation, for the classical half of every
 * variational quantum algorithm.
 *
 * WHY NELDER–MEAD AND NOT A GRADIENT METHOD. The objective is an expectation
 * value obtained by running a circuit. On hardware it is a SAMPLED quantity,
 * so its gradient is not available analytically and finite differences drown
 * in shot noise; the parameter-shift rule exists but costs two extra circuit
 * evaluations per parameter per step, which is the difference between a
 * demonstration and a bill. Nelder–Mead needs only function values, tolerates
 * noise better than finite differences, and is what a great deal of the VQE
 * literature actually used.
 *
 * WHAT IT IS NOT. It is a local method with no convergence guarantee on a
 * non-convex landscape, and variational quantum landscapes are famously
 * non-convex and prone to barren plateaus. A returned optimum is a LOCAL
 * one. Anything built on this must compare against a classical baseline
 * before claiming anything, which is exactly why `../benchmark/` exists and
 * why no algorithm in this directory reports a result without one.
 */

export interface OptimiserOptions {
  /** Hard ceiling on objective evaluations — each one is a circuit run. */
  readonly maxEvaluations: number;
  /** Stop when the simplex spread falls below this. */
  readonly tolerance: number;
  /** Initial simplex edge length in parameter space. */
  readonly initialStep: number;
}

export const DEFAULT_OPTIMISER_OPTIONS: OptimiserOptions = {
  maxEvaluations: 400,
  tolerance: 1e-6,
  initialStep: 0.35,
};

export interface OptimiserResult {
  readonly parameters: readonly number[];
  readonly value: number;
  readonly evaluations: number;
  /** True when the simplex contracted below tolerance rather than running out. */
  readonly converged: boolean;
}

/**
 * Minimise `objective` from `start`.
 *
 * Standard Nelder–Mead with the textbook coefficients (reflect 1, expand 2,
 * contract 0.5, shrink 0.5). The evaluation budget is enforced at every call
 * site rather than only between iterations, because on a metered backend an
 * evaluation is money and "one more iteration" can be dozens of them.
 */
export function nelderMead(
  objective: (params: readonly number[]) => number,
  start: readonly number[],
  options: OptimiserOptions = DEFAULT_OPTIMISER_OPTIONS
): OptimiserResult {
  const n = start.length;
  if (n === 0) {
    return { parameters: [], value: objective([]), evaluations: 1, converged: true };
  }

  let evaluations = 0;
  const evaluate = (p: readonly number[]): number => {
    evaluations++;
    return objective(p);
  };

  // Simplex of n+1 vertices: the start point plus one step along each axis.
  const simplex: number[][] = [[...start]];
  for (let i = 0; i < n; i++) {
    const vertex = [...start];
    vertex[i] += options.initialStep;
    simplex.push(vertex);
  }
  const values = simplex.map((v) => evaluate(v));

  const order = (): void => {
    const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
    const s = idx.map((i) => simplex[i]);
    const f = idx.map((i) => values[i]);
    for (let i = 0; i <= n; i++) {
      simplex[i] = s[i];
      values[i] = f[i];
    }
  };

  let converged = false;

  while (evaluations < options.maxEvaluations) {
    order();

    if (Math.abs(values[n] - values[0]) < options.tolerance) {
      converged = true;
      break;
    }

    // Centroid of everything except the worst vertex.
    const centroid = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;
    }

    const reflected = centroid.map((c, j) => c + (c - simplex[n][j]));
    const fReflected = evaluate(reflected);

    if (fReflected < values[0]) {
      const expanded = centroid.map((c, j) => c + 2 * (c - simplex[n][j]));
      const fExpanded = evaluations < options.maxEvaluations ? evaluate(expanded) : Number.POSITIVE_INFINITY;
      if (fExpanded < fReflected) {
        simplex[n] = expanded;
        values[n] = fExpanded;
      } else {
        simplex[n] = reflected;
        values[n] = fReflected;
      }
      continue;
    }

    if (fReflected < values[n - 1]) {
      simplex[n] = reflected;
      values[n] = fReflected;
      continue;
    }

    const contracted = centroid.map((c, j) => c + 0.5 * (simplex[n][j] - c));
    const fContracted = evaluations < options.maxEvaluations ? evaluate(contracted) : Number.POSITIVE_INFINITY;
    if (fContracted < values[n]) {
      simplex[n] = contracted;
      values[n] = fContracted;
      continue;
    }

    // Shrink everything toward the best vertex.
    for (let i = 1; i <= n && evaluations < options.maxEvaluations; i++) {
      simplex[i] = simplex[i].map((x, j) => simplex[0][j] + 0.5 * (x - simplex[0][j]));
      values[i] = evaluate(simplex[i]);
    }
  }

  order();
  return { parameters: simplex[0], value: values[0], evaluations, converged };
}
