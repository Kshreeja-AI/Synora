import { InvalidQuantumCircuitError } from '../errors';
import type { QuantumProblem } from '../types';

/**
 * The Ising model, and the QUBO ⇄ Ising conversion every combinatorial
 * quantum algorithm needs.
 *
 * WHY THIS IS ITS OWN FILE. QAOA, quantum annealing formulations, Quantum
 * Boltzmann Machines and several benchmark suites all speak Ising; QUBO is
 * how operations-research problems are usually written down. One conversion,
 * tested once, beats each algorithm carrying its own — which is where sign
 * errors live, and a sign error here produces a circuit that optimises the
 * NEGATIVE of the intended objective and looks entirely healthy doing it.
 *
 *   E(z) = offset + Σᵢ hᵢ zᵢ + Σᵢ<ⱼ Jᵢⱼ zᵢ zⱼ,   zᵢ ∈ {+1, −1}
 *
 * SPIN CONVENTION: zᵢ = 1 − 2xᵢ, so bit 0 ↦ spin +1 and bit 1 ↦ spin −1.
 * Chosen to match the computational basis directly — basis state index `i`
 * has bit q at `(i >> q) & 1`, so no re-indexing happens anywhere.
 */

export interface IsingModel {
  readonly n: number;
  /** hᵢ, one per spin. */
  readonly linear: readonly number[];
  /** Jᵢⱼ for i < j, sparse. */
  readonly quadratic: readonly { readonly i: number; readonly j: number; readonly w: number }[];
  readonly offset: number;
}

/**
 * QUBO → Ising, with xᵢ = (1 − zᵢ)/2.
 *
 * Diagonal entries are linear (x² = x for a binary variable), off-diagonal
 * entries are symmetrised so an upper-triangular, lower-triangular or full
 * matrix all give the same model.
 */
export function quboToIsing(Q: readonly (readonly number[])[]): IsingModel {
  const n = Q.length;
  const linear = new Array<number>(n).fill(0);
  const quadratic: { i: number; j: number; w: number }[] = [];
  let offset = 0;

  for (let i = 0; i < n; i++) {
    if (Q[i].length !== n) {
      throw new InvalidQuantumCircuitError(`QUBO matrix row ${i} has ${Q[i].length} entries, expected ${n}`, 'qubo');
    }
    // Q_ii · x_i  →  Q_ii(1 − z_i)/2
    offset += Q[i][i] / 2;
    linear[i] -= Q[i][i] / 2;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const q = Q[i][j] + Q[j][i];
      if (q === 0) continue;
      // q · x_i x_j  →  q(1 − z_i − z_j + z_i z_j)/4
      offset += q / 4;
      linear[i] -= q / 4;
      linear[j] -= q / 4;
      quadratic.push({ i, j, w: q / 4 });
    }
  }

  return { n, linear, quadratic, offset };
}

/**
 * Read an Ising model out of a problem's payload.
 *
 * Accepts either an explicit Ising or a QUBO matrix. Anything else is
 * refused rather than guessed at: an optimiser handed a misread objective
 * returns a confident answer to a question nobody asked.
 */
export function parseIsingProblem(problem: QuantumProblem): IsingModel {
  const data = problem.data ?? {};

  const qubo = data.qubo;
  if (Array.isArray(qubo)) {
    return quboToIsing(qubo as number[][]);
  }

  const ising = data.ising as
    | {
        linear?: number[];
        quadratic?: [number, number, number][];
        offset?: number;
      }
    | undefined;

  if (ising && Array.isArray(ising.linear)) {
    const n = ising.linear.length;
    const quadratic = (ising.quadratic ?? []).map(([i, j, w]) => {
      if (i === j) {
        throw new InvalidQuantumCircuitError(`Ising coupling ${i}-${j} is a self-loop`, 'ising');
      }
      if (i < 0 || j < 0 || i >= n || j >= n) {
        throw new InvalidQuantumCircuitError(`Ising coupling ${i}-${j} is out of range 0..${n - 1}`, 'ising');
      }
      return i < j ? { i, j, w } : { i: j, j: i, w };
    });
    return { n, linear: [...ising.linear], quadratic, offset: ising.offset ?? 0 };
  }

  throw new InvalidQuantumCircuitError(
    'problem.data must contain either `qubo` (a square matrix) or `ising` ' +
      '({ linear: number[], quadratic: [i, j, w][], offset?: number })',
    problem.id
  );
}

/** Energy of one basis state, where bit q of `index` is variable q. */
export function isingEnergyOfIndex(model: IsingModel, index: number): number {
  let energy = model.offset;
  for (let q = 0; q < model.n; q++) {
    const spin = 1 - 2 * ((index >> q) & 1);
    energy += model.linear[q] * spin;
  }
  for (const { i, j, w } of model.quadratic) {
    const si = 1 - 2 * ((index >> i) & 1);
    const sj = 1 - 2 * ((index >> j) & 1);
    energy += w * si * sj;
  }
  return energy;
}

/** Energy of a Synora-ordered bitstring (index 0 of the string is variable 0). */
export function isingEnergyOfBitstring(model: IsingModel, bits: string): number {
  let index = 0;
  for (let q = 0; q < bits.length && q < model.n; q++) {
    if (bits[q] === '1') index |= 1 << q;
  }
  return isingEnergyOfIndex(model, index);
}

/**
 * The exact optimum by exhaustive enumeration.
 *
 * THIS IS THE CLASSICAL BASELINE THAT MATTERS, and it is worth being blunt
 * about what it means: for every problem small enough for this repository's
 * simulator to touch, a laptop can enumerate the entire solution space in
 * milliseconds and return the PROVABLY optimal answer. QAOA on the same
 * problem returns an approximation, after hundreds of circuit evaluations.
 *
 * That is not a flaw in the implementation; it is the honest state of the
 * field at simulable scale, and a system that reports QAOA results without
 * this comparison alongside them is manufacturing an impression of
 * capability. `../benchmark/` makes the comparison mandatory.
 */
export function bruteForceIsingMinimum(model: IsingModel): {
  readonly energy: number;
  readonly index: number;
  readonly bitstring: string;
  readonly degeneracy: number;
} {
  if (model.n > 24) {
    throw new InvalidQuantumCircuitError(
      `exhaustive enumeration of ${model.n} variables is 2^${model.n} states — refused`,
      'ising-baseline'
    );
  }

  let best = Number.POSITIVE_INFINITY;
  let bestIndex = 0;
  let degeneracy = 0;

  const total = 2 ** model.n;
  for (let index = 0; index < total; index++) {
    const energy = isingEnergyOfIndex(model, index);
    if (energy < best - 1e-12) {
      best = energy;
      bestIndex = index;
      degeneracy = 1;
    } else if (Math.abs(energy - best) <= 1e-12) {
      degeneracy++;
    }
  }

  let bitstring = '';
  for (let q = 0; q < model.n; q++) bitstring += (bestIndex >> q) & 1 ? '1' : '0';

  return { energy: best, index: bestIndex, bitstring, degeneracy };
}

/**
 * A cheap heuristic baseline: steepest-descent single-bit flips from a
 * deterministic start, restarted a fixed number of times.
 *
 * Included because "brute force wins" is an unfair comparison at scales
 * where brute force is impossible, and the honest question for a founder is
 * whether QAOA beats what an afternoon of ordinary programming produces.
 * Usually it does not.
 */
export function greedyIsingMinimum(model: IsingModel, restarts = 16): {
  readonly energy: number;
  readonly bitstring: string;
} {
  let bestEnergy = Number.POSITIVE_INFINITY;
  let bestIndex = 0;

  // Deterministic restart seeds: all-zeros, all-ones, then alternating
  // patterns. Deterministic so the baseline is reproducible — a baseline
  // that moves between runs cannot be compared against anything.
  for (let r = 0; r < restarts; r++) {
    let index = r === 0 ? 0 : r === 1 ? 2 ** model.n - 1 : (r * 0x9e3779b1) % 2 ** model.n;
    let energy = isingEnergyOfIndex(model, index);

    for (;;) {
      let improved = false;
      for (let q = 0; q < model.n; q++) {
        const candidate = index ^ (1 << q);
        const candidateEnergy = isingEnergyOfIndex(model, candidate);
        if (candidateEnergy < energy - 1e-12) {
          index = candidate;
          energy = candidateEnergy;
          improved = true;
        }
      }
      if (!improved) break;
    }

    if (energy < bestEnergy) {
      bestEnergy = energy;
      bestIndex = index;
    }
  }

  let bitstring = '';
  for (let q = 0; q < model.n; q++) bitstring += (bestIndex >> q) & 1 ? '1' : '0';
  return { energy: bestEnergy, bitstring };
}
