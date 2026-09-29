import { getConfig } from '../../config';
import { CircuitBuilder, circuitDepth } from '../circuit';
import { InvalidQuantumCircuitError } from '../errors';
import { Statevector, simulateStatevector } from '../simulator/statevector';
import type { QuantumCircuit, QuantumProblem } from '../types';
import type {
  QuantumAlgorithmDescriptor,
  QuantumAlgorithmOutcome,
  QuantumAlgorithmRunOptions,
} from './types';

/**
 * Quantum kernel methods — the quantum-enhanced feature space.
 *
 * ── WHAT IT DOES ─────────────────────────────────────────────────────────
 *
 * Encodes each data point x into a quantum state |φ(x)⟩ via a feature map,
 * then uses K(a,b) = |⟨φ(b)|φ(a)⟩|² as the kernel of an ordinary classical
 * kernel method. The quantum computer computes only the kernel matrix; every
 * other part of the model is classical linear algebra.
 *
 * ── WHY THIS IS THE MOST HONEST QML ENTRY ────────────────────────────────
 *
 * Because the classical comparison is exact and unavoidable. A quantum
 * kernel is a kernel; an RBF kernel is a kernel; the SAME ridge solver
 * consumes either. There is no room for the quantum side to be flattered by
 * a different model, a different regulariser, or a different train/test
 * split — this implementation deliberately holds all three fixed and varies
 * only the kernel.
 *
 * The result on ordinary data is consistently that the classical kernel
 * matches or beats it, which is what the literature reports too: quantum
 * kernel advantage has been demonstrated only on data sets ENGINEERED from
 * the hardness assumption itself (Havlíček et al.'s discrete-log construction),
 * not on data anyone had for another reason.
 *
 * ── COST, WHICH IS THE REAL OBJECTION ────────────────────────────────────
 *
 * The kernel matrix needs O(m²) inner products for m samples. On hardware
 * each is a circuit execution with sampling noise, so a 500-row data set is
 * 125,000 billed jobs before any model is fitted. That is why this is
 * simulator-only here and why the descriptor says so in `limitations`
 * instead of leaving it to be discovered.
 *
 * ── STATUS ───────────────────────────────────────────────────────────────
 *
 * SIMULATOR-IMPLEMENTED. Exact amplitudes, no sampling noise, no device
 * noise — which flatters the quantum side, and it still does not win.
 */

interface Dataset {
  readonly trainX: readonly (readonly number[])[];
  readonly trainY: readonly number[];
  readonly testX: readonly (readonly number[])[];
  readonly testY: readonly number[];
  readonly features: number;
}

function parseDataset(problem: QuantumProblem): Dataset {
  const data = problem.data ?? {};
  const features = data.features as number[][] | undefined;
  const labels = data.labels as number[] | undefined;

  if (!Array.isArray(features) || !Array.isArray(labels) || features.length !== labels.length) {
    throw new InvalidQuantumCircuitError(
      'problem.data must contain `features` (number[][]) and `labels` (number[]) of equal length',
      problem.id
    );
  }
  if (features.length < 4) {
    throw new InvalidQuantumCircuitError(
      `at least 4 samples are needed to form a train/test split, got ${features.length}`,
      problem.id
    );
  }

  const dimension = features[0].length;
  for (const row of features) {
    if (row.length !== dimension) {
      throw new InvalidQuantumCircuitError('all feature rows must have the same length', problem.id);
    }
  }
  for (const label of labels) {
    if (label !== 1 && label !== -1) {
      throw new InvalidQuantumCircuitError(
        'labels must be +1 or -1 (this is a binary classifier)',
        problem.id
      );
    }
  }

  const explicitTestX = data.testFeatures as number[][] | undefined;
  const explicitTestY = data.testLabels as number[] | undefined;
  if (Array.isArray(explicitTestX) && Array.isArray(explicitTestY)) {
    return {
      trainX: features,
      trainY: labels,
      testX: explicitTestX,
      testY: explicitTestY,
      features: dimension,
    };
  }

  // Deterministic interleaved split — every 4th row is held out. Not random,
  // because a random split makes two runs of the same comparison disagree
  // and a benchmark you cannot re-run is not a benchmark.
  const trainX: number[][] = [];
  const trainY: number[] = [];
  const testX: number[][] = [];
  const testY: number[] = [];
  features.forEach((row, i) => {
    if (i % 4 === 3) {
      testX.push([...row]);
      testY.push(labels[i]);
    } else {
      trainX.push([...row]);
      trainY.push(labels[i]);
    }
  });

  return { trainX, trainY, testX, testY, features: dimension };
}

/**
 * The ZZ feature map, one repetition.
 *
 * H on every qubit, a phase proportional to each feature, then an entangling
 * phase on every pair proportional to (π − xᵢ)(π − xⱼ). The pairwise term is
 * what makes the map classically hard to simulate in general — WITHOUT it,
 * the map is a product state and the kernel is exactly reproducible by a
 * classical feature map, which would make the whole exercise theatre.
 */
export function buildFeatureMapCircuit(x: readonly number[]): QuantumCircuit {
  const n = x.length;
  const builder = new CircuitBuilder(`zz-feature-map-n${n}`, n, 0);

  for (let q = 0; q < n; q++) {
    builder.h(q);
    builder.p(q, 2 * x[q]);
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      builder.rzz(i, j, 2 * (Math.PI - x[i]) * (Math.PI - x[j]));
    }
  }

  return builder.build();
}

/** K(a,b) = |⟨φ(b)|φ(a)⟩|², from exact amplitudes. */
function kernelEntry(a: Statevector, b: Statevector): number {
  const { re, im } = a.innerProduct(b);
  return re * re + im * im;
}

/** The classical comparator: RBF, with the standard 1/(d·var) width. */
function rbfKernel(a: readonly number[], b: readonly number[], gamma: number): number {
  let squared = 0;
  for (let i = 0; i < a.length; i++) squared += (a[i] - b[i]) ** 2;
  return Math.exp(-gamma * squared);
}

/**
 * Solve (K + λI)α = y by Gaussian elimination with partial pivoting.
 *
 * Kernel ridge regression, used identically for both kernels. Sharing the
 * solver is the point: any difference in the results is a difference in the
 * KERNEL, not in the model, the regulariser or the numerics.
 */
function solveRidge(K: number[][], y: readonly number[], lambda: number): number[] {
  const m = y.length;
  const A = K.map((row, i) => [...row.map((v, j) => (i === j ? v + lambda : v)), y[i]]);

  for (let col = 0; col < m; col++) {
    let pivot = col;
    for (let row = col + 1; row < m; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[pivot][col])) pivot = row;
    }
    if (Math.abs(A[pivot][col]) < 1e-12) continue;
    [A[col], A[pivot]] = [A[pivot], A[col]];

    for (let row = 0; row < m; row++) {
      if (row === col) continue;
      const factor = A[row][col] / A[col][col];
      if (factor === 0) continue;
      for (let k = col; k <= m; k++) A[row][k] -= factor * A[col][k];
    }
  }

  return Array.from({ length: m }, (_, i) => (Math.abs(A[i][i]) < 1e-12 ? 0 : A[i][m] / A[i][i]));
}

function accuracy(alpha: readonly number[], Ktest: number[][], testY: readonly number[]): number {
  let correct = 0;
  for (let t = 0; t < testY.length; t++) {
    let prediction = 0;
    for (let i = 0; i < alpha.length; i++) prediction += alpha[i] * Ktest[t][i];
    if ((prediction >= 0 ? 1 : -1) === testY[t]) correct++;
  }
  return testY.length === 0 ? 0 : correct / testY.length;
}

async function runQuantumKernel(
  problem: QuantumProblem,
  options: QuantumAlgorithmRunOptions
): Promise<QuantumAlgorithmOutcome> {
  const startedAt = Date.now();
  const dataset = parseDataset(problem);
  const maxQubits = getConfig().quantum.localMaxQubits;
  const lambda = options.hyperparameters?.regularisation ?? 1e-3;
  const warnings: string[] = [];

  if (dataset.features > maxQubits) {
    throw new InvalidQuantumCircuitError(
      `the ZZ feature map uses one qubit per feature: ${dataset.features} features exceeds ` +
        `this simulator's ${maxQubits}-qubit limit`,
      problem.id
    );
  }

  // Each state is simulated ONCE and reused across the whole kernel matrix.
  // The naive implementation re-simulates per entry and is O(m²) circuits
  // instead of O(m) — the difference between seconds and minutes, and on
  // hardware between a bill and an unaffordable one.
  const trainStates = dataset.trainX.map((x) => simulateStatevector(buildFeatureMapCircuit(x), maxQubits));
  const testStates = dataset.testX.map((x) => simulateStatevector(buildFeatureMapCircuit(x), maxQubits));

  const m = trainStates.length;
  const Kq: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < m; i++) {
    Kq[i][i] = 1;
    for (let j = i + 1; j < m; j++) {
      const value = kernelEntry(trainStates[i], trainStates[j]);
      Kq[i][j] = value;
      Kq[j][i] = value;
    }
  }
  const KqTest = testStates.map((t) => trainStates.map((s) => kernelEntry(t, s)));

  // Identical model, identical regulariser, identical split — only the
  // kernel differs.
  const variance = featureVariance(dataset.trainX);
  const gamma = 1 / Math.max(1e-9, dataset.features * variance);
  const Kc: number[][] = dataset.trainX.map((a) => dataset.trainX.map((b) => rbfKernel(a, b, gamma)));
  const KcTest = dataset.testX.map((t) => dataset.trainX.map((s) => rbfKernel(t, s, gamma)));

  const alphaQ = solveRidge(Kq, dataset.trainY, lambda);
  const alphaC = solveRidge(Kc, dataset.trainY, lambda);

  const quantumAccuracy = accuracy(alphaQ, KqTest, dataset.testY);
  const classicalAccuracy = accuracy(alphaC, KcTest, dataset.testY);

  if (quantumAccuracy <= classicalAccuracy) {
    warnings.push(
      `the classical RBF kernel matched or beat the quantum kernel on the held-out set ` +
        `(${classicalAccuracy.toFixed(3)} vs ${quantumAccuracy.toFixed(3)}) — the expected outcome on ` +
        'data that was not constructed from a hardness assumption'
    );
  }
  if (dataset.testY.length < 20) {
    warnings.push(
      `the held-out set has only ${dataset.testY.length} samples; a difference in accuracy ` +
        'here is within noise and should not be read as a result either way'
    );
  }

  const sampleCircuit = buildFeatureMapCircuit(dataset.trainX[0]);

  return {
    algorithmId: 'quantum-kernel',
    // Lower is better across the outcome type, so the objective is error rate.
    objectiveValue: 1 - quantumAccuracy,
    solution: {
      quantumTestAccuracy: quantumAccuracy,
      classicalRbfTestAccuracy: classicalAccuracy,
      quantumBeatsClassical: quantumAccuracy > classicalAccuracy,
      trainSamples: m,
      testSamples: dataset.testY.length,
      kernelEvaluations: (m * (m - 1)) / 2 + m * dataset.testY.length,
      featureMap: 'ZZ feature map, 1 repetition, full pairwise entanglement',
      regularisation: lambda,
    },
    qubits: dataset.features,
    circuitDepth: circuitDepth(sampleCircuit),
    // One simulation per data point; the kernel entries are inner products
    // of already-computed states, not additional circuit runs.
    circuitEvaluations: trainStates.length + testStates.length,
    optimiserConverged: true,
    executedOn: 'local-simulator',
    durationMs: Date.now() - startedAt,
    warnings,
  };
}

function featureVariance(rows: readonly (readonly number[])[]): number {
  const values = rows.flatMap((r) => [...r]);
  const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
  return values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length || 1);
}

export const quantumKernelDescriptor: QuantumAlgorithmDescriptor = {
  id: 'quantum-kernel',
  displayName: 'Quantum Kernel Method',
  description:
    'Encodes data into quantum states with a ZZ feature map and uses the state overlap as the ' +
    'kernel of a classical kernel-ridge classifier. The quantum device computes only the kernel matrix.',
  problemClasses: ['classification', 'regression'],
  formulation: 'kernel-matrix',
  assumptions: [
    'the feature map places the data in a space where the classes become separable',
    'features are scaled into a range where the map is not effectively constant',
    'on hardware: that O(m²) sampled overlaps are estimated accurately enough for the kernel matrix to stay positive semi-definite',
  ],
  classicalBaseline:
    'RBF-kernel ridge regression with the same solver, same regulariser and same train/test split',
  simulatorSupported: true,
  qpuSupported: false,
  qubitRequirement: 'one qubit per input feature',
  limitations: [
    'kernel matrix costs O(m²) overlap evaluations — 500 samples is 125,000 circuit executions on hardware',
    'quantum kernel advantage has been demonstrated only on data ENGINEERED from a hardness assumption, not on naturally occurring data',
    'a feature map without entanglement is exactly reproducible classically, so the entangling layer is doing all the work — and it is also what makes the circuit deep',
    'sampling noise on hardware can break the positive semi-definiteness the kernel method assumes',
    'one qubit per feature caps this at ~20 features on this simulator',
  ],
  state: 'ENABLED',
  testCoverage: 'unit-and-baseline-comparison',
  references: [
    'Havlíček et al. (2019), "Supervised learning with quantum-enhanced feature spaces", Nature 567:209',
    'Schuld & Killoran (2019), "Quantum machine learning in feature Hilbert spaces", PRL 122:040504',
  ],
  buildCircuit(problem) {
    const dataset = parseDataset(problem);
    return buildFeatureMapCircuit(dataset.trainX[0]);
  },
  run: runQuantumKernel,
};
