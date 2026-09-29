import { createHash } from 'node:crypto';
import { InvalidQuantumCircuitError } from './errors';
import type {
  QuantumCircuit,
  QuantumGate,
  QuantumGateName,
  QuantumMeasurement,
} from './types';

/**
 * Synora's circuit intermediate representation, and the only thing that
 * builds one.
 *
 * WHY AN IR AT ALL, rather than handing each adapter a vendor object: a
 * circuit built as a Qiskit `QuantumCircuit` is a Qiskit circuit forever,
 * and every consumer of it — the suitability analyzer, the cost estimator,
 * the hash in a result's provenance, the benchmark record — would inherit
 * that dependency. This shape is understood by all three adapters, emits to
 * OpenQASM 3 (`./qasm.ts`), and hashes deterministically, which is what a
 * provenance record needs.
 *
 * VALIDATION IS EAGER, at build time, not at execution time. A malformed
 * circuit discovered by a QPU is a queued job, a wait, and possibly a
 * charge; discovered here it is a synchronous exception with a line number.
 */

/** Arity and parameter count for every gate in the vocabulary. */
const GATE_SHAPE: Readonly<Record<QuantumGateName, { qubits: number; params: number }>> = {
  id: { qubits: 1, params: 0 },
  h: { qubits: 1, params: 0 },
  x: { qubits: 1, params: 0 },
  y: { qubits: 1, params: 0 },
  z: { qubits: 1, params: 0 },
  s: { qubits: 1, params: 0 },
  sdg: { qubits: 1, params: 0 },
  t: { qubits: 1, params: 0 },
  tdg: { qubits: 1, params: 0 },
  rx: { qubits: 1, params: 1 },
  ry: { qubits: 1, params: 1 },
  rz: { qubits: 1, params: 1 },
  p: { qubits: 1, params: 1 },
  u: { qubits: 1, params: 3 },
  cx: { qubits: 2, params: 0 },
  cy: { qubits: 2, params: 0 },
  cz: { qubits: 2, params: 0 },
  swap: { qubits: 2, params: 0 },
  crz: { qubits: 2, params: 1 },
  cp: { qubits: 2, params: 1 },
  ccx: { qubits: 3, params: 0 },
};

export function gateShape(name: QuantumGateName): { qubits: number; params: number } {
  return GATE_SHAPE[name];
}

export const SUPPORTED_GATES: readonly QuantumGateName[] = Object.keys(
  GATE_SHAPE
) as QuantumGateName[];

/**
 * Fluent builder. Every method returns `this`; `build()` freezes the result.
 *
 * Parameter slots: a gate takes EITHER a literal number or a parameter name
 * per slot, expressed by passing a `string` where a number would go. Mixing
 * them within one gate is legal and useful — `rz(theta)` on one qubit and
 * `rz(Math.PI)` on the next is an ordinary variational pattern.
 */
export class CircuitBuilder {
  private readonly gates: QuantumGate[] = [];
  private readonly measurements: QuantumMeasurement[] = [];
  private readonly parameterNames = new Set<string>();

  constructor(
    private readonly name: string,
    private readonly qubits: number,
    private readonly clbits: number = qubits
  ) {
    if (!Number.isInteger(qubits) || qubits < 1) {
      throw new InvalidQuantumCircuitError(`qubit count must be a positive integer, got ${qubits}`, name);
    }
    if (!Number.isInteger(clbits) || clbits < 0) {
      throw new InvalidQuantumCircuitError(`classical bit count must be a non-negative integer, got ${clbits}`, name);
    }
  }

  /** The general one. Everything else is sugar over this. */
  gate(name: QuantumGateName, qubits: readonly number[], args: readonly (number | string)[] = []): this {
    const shape = GATE_SHAPE[name];
    if (!shape) {
      throw new InvalidQuantumCircuitError(`unknown gate "${String(name)}"`, this.name);
    }
    if (qubits.length !== shape.qubits) {
      throw new InvalidQuantumCircuitError(
        `gate "${name}" takes ${shape.qubits} qubit(s), got ${qubits.length}`,
        this.name
      );
    }
    if (args.length !== shape.params) {
      throw new InvalidQuantumCircuitError(
        `gate "${name}" takes ${shape.params} parameter(s), got ${args.length}`,
        this.name
      );
    }
    for (const q of qubits) {
      if (!Number.isInteger(q) || q < 0 || q >= this.qubits) {
        throw new InvalidQuantumCircuitError(
          `qubit index ${q} is outside 0..${this.qubits - 1}`,
          this.name
        );
      }
    }
    if (new Set(qubits).size !== qubits.length) {
      throw new InvalidQuantumCircuitError(
        `gate "${name}" was given the same qubit twice (${qubits.join(', ')})`,
        this.name
      );
    }

    // A slot is a literal or a name; the two arrays are index-aligned so a
    // gate can carry a mix without a second gate type existing.
    const params: number[] = [];
    const paramRefs: (string | null)[] = [];
    let symbolic = false;
    for (const arg of args) {
      if (typeof arg === 'string') {
        if (arg.length === 0) {
          throw new InvalidQuantumCircuitError('parameter name must not be empty', this.name);
        }
        this.parameterNames.add(arg);
        params.push(Number.NaN);
        paramRefs.push(arg);
        symbolic = true;
      } else {
        if (!Number.isFinite(arg)) {
          throw new InvalidQuantumCircuitError(
            `gate "${name}" was given a non-finite angle`,
            this.name
          );
        }
        params.push(arg);
        paramRefs.push(null);
      }
    }

    this.gates.push(
      symbolic
        ? { name, qubits: [...qubits], params, paramRefs }
        : { name, qubits: [...qubits], ...(params.length > 0 ? { params } : {}) }
    );
    return this;
  }

  h(q: number): this {
    return this.gate('h', [q]);
  }
  x(q: number): this {
    return this.gate('x', [q]);
  }
  y(q: number): this {
    return this.gate('y', [q]);
  }
  z(q: number): this {
    return this.gate('z', [q]);
  }
  s(q: number): this {
    return this.gate('s', [q]);
  }
  sdg(q: number): this {
    return this.gate('sdg', [q]);
  }
  t(q: number): this {
    return this.gate('t', [q]);
  }
  rx(q: number, theta: number | string): this {
    return this.gate('rx', [q], [theta]);
  }
  ry(q: number, theta: number | string): this {
    return this.gate('ry', [q], [theta]);
  }
  rz(q: number, theta: number | string): this {
    return this.gate('rz', [q], [theta]);
  }
  p(q: number, lambda: number | string): this {
    return this.gate('p', [q], [lambda]);
  }
  u(q: number, theta: number | string, phi: number | string, lambda: number | string): this {
    return this.gate('u', [q], [theta, phi, lambda]);
  }
  cx(control: number, target: number): this {
    return this.gate('cx', [control, target]);
  }
  cz(control: number, target: number): this {
    return this.gate('cz', [control, target]);
  }
  swap(a: number, b: number): this {
    return this.gate('swap', [a, b]);
  }
  ccx(c1: number, c2: number, target: number): this {
    return this.gate('ccx', [c1, c2, target]);
  }

  /**
   * exp(-i θ/2 · Z⊗Z) between two qubits, the two-body term every Ising
   * cost Hamiltonian is made of. Written as CX–RZ–CX rather than as a
   * primitive gate because that identity holds on every backend, so no
   * adapter has to synthesise it and no transpiler has to be trusted to.
   */
  rzz(a: number, b: number, theta: number | string): this {
    return this.cx(a, b).rz(b, theta).cx(a, b);
  }

  measure(qubit: number, clbit: number): this {
    if (!Number.isInteger(qubit) || qubit < 0 || qubit >= this.qubits) {
      throw new InvalidQuantumCircuitError(`measure: qubit ${qubit} out of range`, this.name);
    }
    if (!Number.isInteger(clbit) || clbit < 0 || clbit >= this.clbits) {
      throw new InvalidQuantumCircuitError(`measure: classical bit ${clbit} out of range`, this.name);
    }
    this.measurements.push({ qubit, clbit });
    return this;
  }

  measureAll(): this {
    if (this.clbits < this.qubits) {
      throw new InvalidQuantumCircuitError(
        `measureAll needs ${this.qubits} classical bits, circuit has ${this.clbits}`,
        this.name
      );
    }
    for (let q = 0; q < this.qubits; q++) this.measure(q, q);
    return this;
  }

  build(): QuantumCircuit {
    return Object.freeze({
      name: this.name,
      qubits: this.qubits,
      clbits: this.clbits,
      gates: Object.freeze([...this.gates]),
      measurements: Object.freeze([...this.measurements]),
      // Sorted so two circuits built in different orders hash identically.
      parameters: Object.freeze([...this.parameterNames].sort()),
    });
  }
}

/**
 * Resolve every symbolic slot against supplied values.
 *
 * Throws on a missing binding rather than substituting a zero. A zero angle
 * is a valid rotation, so a silent default would produce a circuit that
 * runs, returns numbers, and answers a different question than the one
 * asked — the worst available failure mode.
 */
export function bindParameters(
  circuit: QuantumCircuit,
  values: Readonly<Record<string, number>> = {}
): QuantumCircuit {
  if (circuit.parameters.length === 0) return circuit;

  const missing = circuit.parameters.filter((name) => !Number.isFinite(values[name]));
  if (missing.length > 0) {
    throw new InvalidQuantumCircuitError(
      `missing value(s) for parameter(s): ${missing.join(', ')}`,
      circuit.name
    );
  }

  const gates = circuit.gates.map((gate) => {
    if (!gate.paramRefs) return gate;
    const params = gate.paramRefs.map((ref, i) =>
      ref === null ? (gate.params?.[i] ?? 0) : values[ref]
    );
    return { name: gate.name, qubits: gate.qubits, params };
  });

  return Object.freeze({
    ...circuit,
    gates: Object.freeze(gates),
    parameters: Object.freeze([]),
  });
}

/**
 * Circuit depth: the longest chain of gates sharing a qubit.
 *
 * The standard definition, and the one every hardware feasibility estimate
 * assumes. Not gate count — a thousand single-qubit gates on a thousand
 * separate qubits has depth 1 and runs in one cycle.
 */
export function circuitDepth(circuit: QuantumCircuit): number {
  const perQubit = new Array<number>(circuit.qubits).fill(0);
  for (const gate of circuit.gates) {
    const start = Math.max(...gate.qubits.map((q) => perQubit[q]));
    for (const q of gate.qubits) perQubit[q] = start + 1;
  }
  return perQubit.length > 0 ? Math.max(...perQubit) : 0;
}

/** Two-qubit gate count — the dominant error source on real hardware. */
export function twoQubitGateCount(circuit: QuantumCircuit): number {
  return circuit.gates.filter((g) => g.qubits.length >= 2).length;
}

/**
 * A stable content hash of the circuit, for provenance.
 *
 * Deliberately excludes `name`: two identically-structured circuits are the
 * same computation whatever they were called, and a provenance record that
 * says otherwise makes de-duplication and reproduction checks lie.
 */
export function circuitHash(circuit: QuantumCircuit): string {
  const canonical = JSON.stringify({
    qubits: circuit.qubits,
    clbits: circuit.clbits,
    gates: circuit.gates.map((g) => [g.name, g.qubits, g.params ?? [], g.paramRefs ?? []]),
    measurements: circuit.measurements.map((m) => [m.qubit, m.clbit]),
    parameters: circuit.parameters,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

/**
 * Check a circuit against a backend's declared limits BEFORE submission.
 *
 * Gate-set compatibility is reported as a WARNING, not a refusal: every
 * serious backend transpiles, and refusing a circuit a backend would have
 * happily compiled would make Synora less capable than the hardware it
 * targets. Qubit count is a refusal, because no transpiler invents qubits.
 */
export function checkCircuitAgainstBackend(
  circuit: QuantumCircuit,
  backend: { id: string; maxQubits: number; maxShots: number; nativeGates: readonly string[] },
  shots: number
): readonly string[] {
  if (circuit.qubits > backend.maxQubits) {
    throw new InvalidQuantumCircuitError(
      `needs ${circuit.qubits} qubits; backend "${backend.id}" provides ${backend.maxQubits}`,
      circuit.name
    );
  }
  if (shots > backend.maxShots) {
    throw new InvalidQuantumCircuitError(
      `requested ${shots} shots; backend "${backend.id}" allows ${backend.maxShots}`,
      circuit.name
    );
  }

  const warnings: string[] = [];
  const native = new Set(backend.nativeGates.map((g) => g.toLowerCase()));
  if (native.size > 0) {
    const foreign = [...new Set(circuit.gates.map((g) => g.name))].filter((g) => !native.has(g));
    if (foreign.length > 0) {
      warnings.push(
        `gates not native to "${backend.id}" will be transpiled by the provider: ${foreign.join(', ')}`
      );
    }
  }
  return warnings;
}
