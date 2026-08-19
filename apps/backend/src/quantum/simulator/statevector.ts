import { InvalidQuantumCircuitError } from '../errors';
import type { PauliTerm, QuantumCircuit, QuantumGate, QuantumObservable } from '../types';

/**
 * A dense statevector simulator, written in TypeScript, with no dependencies.
 *
 * WHY WRITE ONE RATHER THAN CALL A LIBRARY. Every mature simulator worth
 * using — Qiskit Aer, Braket's local simulator, PennyLane's — is Python.
 * Reaching any of them from this Node process means a Python runtime inside
 * the production image, a second language toolchain in CI, and a subprocess
 * boundary on the hot path of an optimisation loop that calls it hundreds of
 * times. For circuits small enough to be honest about (≤ ~20 qubits, which
 * is the ceiling RAM imposes anyway), a statevector simulator is roughly two
 * hundred lines of linear algebra. Writing those lines is cheaper and more
 * verifiable than adopting a runtime.
 *
 * WHAT THIS IS NOT. It is noiseless and exact. It does not model decoherence,
 * gate infidelity, crosstalk or readout error, and it says so in the
 * capability list it publishes — `noise-model` is absent, deliberately, and
 * every result it produces is stamped `producedBy: 'simulator'`. A noiseless
 * simulation is the OPTIMISTIC bound on what hardware could do, never a
 * prediction of what hardware will do. Treating one as the other is the
 * single most common way quantum results get overstated.
 *
 * MEMORY IS THE WHOLE CONSTRAINT. n qubits is 2^n complex amplitudes, held
 * here as two Float64Arrays: 16 bytes per amplitude, so 16 MB at 20 qubits,
 * 268 MB at 24, 4 GB at 28. The cap is configuration, checked before
 * allocation, because an OOM inside a worker takes the queue down with it.
 */

/** Bytes of amplitude storage for an n-qubit statevector. */
export function statevectorBytes(qubits: number): number {
  return 2 ** qubits * 16;
}

/**
 * Deterministic PRNG (mulberry32).
 *
 * `Math.random()` would make every sampled result irreproducible, and
 * reproducibility is a stated requirement of the benchmarking layer — a
 * comparison between a classical and a quantum method is not a comparison
 * if the quantum side draws different numbers each run.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 2×2 complex matrix, flattened row-major as [re, im] pairs. */
interface Matrix2 {
  readonly a: readonly [number, number];
  readonly b: readonly [number, number];
  readonly c: readonly [number, number];
  readonly d: readonly [number, number];
}

const SQRT1_2 = Math.SQRT1_2;

function singleQubitMatrix(gate: QuantumGate): Matrix2 {
  const p = gate.params ?? [];
  switch (gate.name) {
    case 'id':
      return { a: [1, 0], b: [0, 0], c: [0, 0], d: [1, 0] };
    case 'h':
      return { a: [SQRT1_2, 0], b: [SQRT1_2, 0], c: [SQRT1_2, 0], d: [-SQRT1_2, 0] };
    case 'x':
      return { a: [0, 0], b: [1, 0], c: [1, 0], d: [0, 0] };
    case 'y':
      return { a: [0, 0], b: [0, -1], c: [0, 1], d: [0, 0] };
    case 'z':
      return { a: [1, 0], b: [0, 0], c: [0, 0], d: [-1, 0] };
    case 's':
      return { a: [1, 0], b: [0, 0], c: [0, 0], d: [0, 1] };
    case 'sdg':
      return { a: [1, 0], b: [0, 0], c: [0, 0], d: [0, -1] };
    case 't':
      return { a: [1, 0], b: [0, 0], c: [0, 0], d: [SQRT1_2, SQRT1_2] };
    case 'tdg':
      return { a: [1, 0], b: [0, 0], c: [0, 0], d: [SQRT1_2, -SQRT1_2] };
    case 'rx': {
      const h = p[0] / 2;
      return { a: [Math.cos(h), 0], b: [0, -Math.sin(h)], c: [0, -Math.sin(h)], d: [Math.cos(h), 0] };
    }
    case 'ry': {
      const h = p[0] / 2;
      return { a: [Math.cos(h), 0], b: [-Math.sin(h), 0], c: [Math.sin(h), 0], d: [Math.cos(h), 0] };
    }
    case 'rz':
    case 'crz': {
      const h = p[0] / 2;
      return {
        a: [Math.cos(h), -Math.sin(h)],
        b: [0, 0],
        c: [0, 0],
        d: [Math.cos(h), Math.sin(h)],
      };
    }
    case 'p':
    case 'cp':
      return { a: [1, 0], b: [0, 0], c: [0, 0], d: [Math.cos(p[0]), Math.sin(p[0])] };
    case 'u': {
      const [theta, phi, lambda] = p;
      const ct = Math.cos(theta / 2);
      const st = Math.sin(theta / 2);
      return {
        a: [ct, 0],
        b: [-Math.cos(lambda) * st, -Math.sin(lambda) * st],
        c: [Math.cos(phi) * st, Math.sin(phi) * st],
        d: [Math.cos(phi + lambda) * ct, Math.sin(phi + lambda) * ct],
      };
    }
    // Controlled gates reuse the single-qubit matrix of the operation they
    // control; `x`/`y`/`z` above cover cx/cy/cz.
    case 'cx':
      return { a: [0, 0], b: [1, 0], c: [1, 0], d: [0, 0] };
    case 'cy':
      return { a: [0, 0], b: [0, -1], c: [0, 1], d: [0, 0] };
    case 'cz':
      return { a: [1, 0], b: [0, 0], c: [0, 0], d: [-1, 0] };
    case 'ccx':
      return { a: [0, 0], b: [1, 0], c: [1, 0], d: [0, 0] };
    default:
      throw new InvalidQuantumCircuitError(
        `gate "${gate.name}" has no simulator implementation`,
        'statevector'
      );
  }
}

/** Which qubits of a gate are controls, and which is the target. */
function controlsAndTarget(gate: QuantumGate): { controls: readonly number[]; target: number } {
  switch (gate.name) {
    case 'cx':
    case 'cy':
    case 'cz':
    case 'crz':
    case 'cp':
      return { controls: [gate.qubits[0]], target: gate.qubits[1] };
    case 'ccx':
      return { controls: [gate.qubits[0], gate.qubits[1]], target: gate.qubits[2] };
    default:
      return { controls: [], target: gate.qubits[0] };
  }
}

export class Statevector {
  readonly re: Float64Array;
  readonly im: Float64Array;

  constructor(readonly qubits: number) {
    const size = 2 ** qubits;
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    // |00…0>
    this.re[0] = 1;
  }

  get size(): number {
    return this.re.length;
  }

  clone(): Statevector {
    const copy = new Statevector(this.qubits);
    copy.re.set(this.re);
    copy.im.set(this.im);
    return copy;
  }

  /**
   * Apply a 2×2 matrix to `target`, conditioned on every control bit being 1.
   *
   * One loop serves every gate in the vocabulary except SWAP. The
   * alternative — a hand-written kernel per gate — is where simulators
   * accumulate their subtle bugs, and it buys nothing at these sizes.
   */
  applyControlled(m: Matrix2, controls: readonly number[], target: number): void {
    const targetBit = 1 << target;
    let controlMask = 0;
    for (const c of controls) controlMask |= 1 << c;

    const { re, im } = this;
    for (let i = 0; i < re.length; i++) {
      // Visit each pair once, from its target-bit-0 member.
      if ((i & targetBit) !== 0) continue;
      if ((i & controlMask) !== controlMask) continue;

      const j = i | targetBit;
      const x0r = re[i];
      const x0i = im[i];
      const x1r = re[j];
      const x1i = im[j];

      re[i] = m.a[0] * x0r - m.a[1] * x0i + (m.b[0] * x1r - m.b[1] * x1i);
      im[i] = m.a[0] * x0i + m.a[1] * x0r + (m.b[0] * x1i + m.b[1] * x1r);
      re[j] = m.c[0] * x0r - m.c[1] * x0i + (m.d[0] * x1r - m.d[1] * x1i);
      im[j] = m.c[0] * x0i + m.c[1] * x0r + (m.d[0] * x1i + m.d[1] * x1r);
    }
  }

  private applySwap(a: number, b: number): void {
    const bitA = 1 << a;
    const bitB = 1 << b;
    const { re, im } = this;
    for (let i = 0; i < re.length; i++) {
      const hasA = (i & bitA) !== 0;
      const hasB = (i & bitB) !== 0;
      if (hasA === hasB) continue;
      const j = i ^ bitA ^ bitB;
      if (j < i) continue;
      const tr = re[i];
      const ti = im[i];
      re[i] = re[j];
      im[i] = im[j];
      re[j] = tr;
      im[j] = ti;
    }
  }

  applyGate(gate: QuantumGate): void {
    if (gate.name === 'swap') {
      this.applySwap(gate.qubits[0], gate.qubits[1]);
      return;
    }
    const { controls, target } = controlsAndTarget(gate);
    this.applyControlled(singleQubitMatrix(gate), controls, target);
  }

  /**
   * Probability of every basis state. Returned as a new array rather than
   * cached: a variational loop mutates the state constantly, and a stale
   * probability cache is a silent wrong answer.
   */
  probabilities(): Float64Array {
    const probs = new Float64Array(this.size);
    for (let i = 0; i < probs.length; i++) {
      probs[i] = this.re[i] * this.re[i] + this.im[i] * this.im[i];
    }
    return probs;
  }

  /** ⟨this|other⟩, as a complex pair. */
  innerProduct(other: Statevector): { re: number; im: number } {
    let re = 0;
    let im = 0;
    for (let i = 0; i < this.re.length; i++) {
      // conj(this) · other
      re += this.re[i] * other.re[i] + this.im[i] * other.im[i];
      im += this.re[i] * other.im[i] - this.im[i] * other.re[i];
    }
    return { re, im };
  }
}

/**
 * Run a circuit to its final state. Measurements are NOT applied here —
 * sampling is a separate step so an expectation value can be computed from
 * the same state without the caller building a second, measurement-free
 * circuit.
 */
export function simulateStatevector(circuit: QuantumCircuit, maxQubits: number): Statevector {
  if (circuit.parameters.length > 0) {
    throw new InvalidQuantumCircuitError(
      `cannot simulate a circuit with unbound parameter(s): ${circuit.parameters.join(', ')}`,
      circuit.name
    );
  }
  if (circuit.qubits > maxQubits) {
    const needed = statevectorBytes(circuit.qubits);
    throw new InvalidQuantumCircuitError(
      `${circuit.qubits} qubits exceeds this simulator's limit of ${maxQubits} ` +
        `(a ${circuit.qubits}-qubit statevector needs ${(needed / 1024 ** 2).toFixed(0)} MB of ` +
        'amplitudes alone). Raise QUANTUM_LOCAL_MAX_QUBITS only if the host genuinely has ' +
        'that memory to spare.',
      circuit.name
    );
  }

  const state = new Statevector(circuit.qubits);
  for (const gate of circuit.gates) state.applyGate(gate);
  return state;
}

/**
 * Sample measured bitstrings.
 *
 * BITSTRING CONVENTION: index 0 of the string is qubit 0. This is Synora's
 * ordering everywhere, chosen because it is the one that does not surprise
 * anybody reading `counts` next to a circuit. IBM's wire format is
 * little-endian and Braket's differs again; both are converted inside their
 * own adapters, which is the only place a vendor's convention is allowed to
 * exist.
 *
 * Only measured qubits appear, in the classical-bit order the circuit
 * declared — an unmeasured qubit contributes no character, rather than a
 * fabricated 0.
 */
export function sampleCounts(
  state: Statevector,
  circuit: QuantumCircuit,
  shots: number,
  seed: number
): Record<string, number> {
  const probs = state.probabilities();

  // Cumulative distribution once, binary search per shot: O(2^n + shots·n)
  // instead of O(shots·2^n), which matters the moment shots exceed a few
  // hundred on a 16-qubit circuit.
  const cumulative = new Float64Array(probs.length);
  let running = 0;
  for (let i = 0; i < probs.length; i++) {
    running += probs[i];
    cumulative[i] = running;
  }
  // Normalise away accumulated float drift so the last bucket is exactly 1
  // and a draw of 0.9999999 cannot fall off the end.
  const total = cumulative[cumulative.length - 1] || 1;

  const measurements =
    circuit.measurements.length > 0
      ? [...circuit.measurements].sort((a, b) => a.clbit - b.clbit)
      : Array.from({ length: circuit.qubits }, (_, q) => ({ qubit: q, clbit: q }));

  const random = mulberry32(seed);
  const counts: Record<string, number> = {};

  for (let shot = 0; shot < shots; shot++) {
    const draw = random() * total;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < draw) lo = mid + 1;
      else hi = mid;
    }
    let key = '';
    for (const m of measurements) key += (lo >> m.qubit) & 1 ? '1' : '0';
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

/**
 * ⟨ψ|P|ψ⟩ for one Pauli string.
 *
 * Applied to a clone: the caller's state is reused across every term of an
 * observable, and mutating it would make term 2 onwards measure a different
 * state than term 1. The imaginary part is discarded because it is exactly
 * zero for a Hermitian operator; retaining it would only invite someone to
 * treat float noise as physics.
 */
export function pauliExpectation(state: Statevector, term: PauliTerm): number {
  const applied = state.clone();
  for (let q = 0; q < term.paulis.length; q++) {
    const p = term.paulis[q].toUpperCase();
    if (p === 'I') continue;
    if (p !== 'X' && p !== 'Y' && p !== 'Z') {
      throw new InvalidQuantumCircuitError(
        `"${p}" is not a Pauli operator (expected I, X, Y or Z)`,
        'observable'
      );
    }
    applied.applyGate({ name: p.toLowerCase() as 'x' | 'y' | 'z', qubits: [q] });
  }
  return state.innerProduct(applied).re;
}

/** ⟨ψ|H|ψ⟩ for a weighted sum of Pauli strings. */
export function observableExpectation(state: Statevector, observable: QuantumObservable): number {
  let total = 0;
  for (const term of observable.terms) {
    total += term.coefficient * pauliExpectation(state, term);
  }
  return total;
}
