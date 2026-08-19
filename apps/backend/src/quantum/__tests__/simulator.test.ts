import { describe, expect, it } from 'vitest';
import {
  CircuitBuilder,
  bindParameters,
  circuitDepth,
  circuitHash,
  twoQubitGateCount,
} from '../circuit';
import { InvalidQuantumCircuitError } from '../errors';
import { toQasm2, toQasm3 } from '../qasm';
import {
  Statevector,
  observableExpectation,
  pauliExpectation,
  sampleCounts,
  simulateStatevector,
  statevectorBytes,
} from '../simulator/statevector';

/**
 * The simulator is checked against states whose answers are known from the
 * mathematics, not against its own previous output.
 *
 * That distinction is the whole value of this file. A simulator tested with
 * snapshots agrees with itself forever, including about its bugs; every
 * assertion below is a number derivable by hand from the definition of the
 * gate, so a regression contradicts quantum mechanics rather than a stored
 * fixture.
 */

const MAX = 20;

function probabilityOf(state: Statevector, index: number): number {
  return state.re[index] ** 2 + state.im[index] ** 2;
}

describe('single-qubit gates produce the states they are defined to produce', () => {
  it('H|0⟩ is an equal superposition', () => {
    const state = simulateStatevector(new CircuitBuilder('h', 1).h(0).build(), MAX);
    expect(probabilityOf(state, 0)).toBeCloseTo(0.5, 12);
    expect(probabilityOf(state, 1)).toBeCloseTo(0.5, 12);
  });

  it('X|0⟩ is |1⟩ exactly — no probability anywhere else', () => {
    const state = simulateStatevector(new CircuitBuilder('x', 1).x(0).build(), MAX);
    expect(probabilityOf(state, 0)).toBeCloseTo(0, 15);
    expect(probabilityOf(state, 1)).toBeCloseTo(1, 15);
  });

  it('HH = I — the involution that catches a mis-signed Hadamard', () => {
    const state = simulateStatevector(new CircuitBuilder('hh', 1).h(0).h(0).build(), MAX);
    expect(probabilityOf(state, 0)).toBeCloseTo(1, 12);
  });

  it('RZ changes phase and not probability', () => {
    // A common simulator bug is implementing RZ as a rotation in the real
    // plane, which would move probability. This catches exactly that.
    const state = simulateStatevector(
      new CircuitBuilder('rz', 1).h(0).rz(0, Math.PI / 3).build(),
      MAX
    );
    expect(probabilityOf(state, 0)).toBeCloseTo(0.5, 12);
    expect(probabilityOf(state, 1)).toBeCloseTo(0.5, 12);
    expect(state.im[1]).not.toBeCloseTo(0, 6);
  });

  it('RY(π)|0⟩ is |1⟩', () => {
    const state = simulateStatevector(new CircuitBuilder('ry', 1).ry(0, Math.PI).build(), MAX);
    expect(probabilityOf(state, 1)).toBeCloseTo(1, 12);
  });

  it('a random gate sequence preserves the norm — unitarity', () => {
    const circuit = new CircuitBuilder('unitary', 3)
      .h(0)
      .ry(1, 0.7)
      .rz(2, 1.3)
      .cx(0, 1)
      .u(2, 0.4, 1.1, 2.2)
      .cz(1, 2)
      .swap(0, 2)
      .t(0)
      .build();
    const state = simulateStatevector(circuit, MAX);

    let norm = 0;
    for (let i = 0; i < state.size; i++) norm += probabilityOf(state, i);
    expect(norm).toBeCloseTo(1, 12);
  });
});

describe('entanglement', () => {
  it('a Bell state has weight only on |00⟩ and |11⟩', () => {
    const state = simulateStatevector(new CircuitBuilder('bell', 2).h(0).cx(0, 1).build(), MAX);
    expect(probabilityOf(state, 0b00)).toBeCloseTo(0.5, 12);
    expect(probabilityOf(state, 0b11)).toBeCloseTo(0.5, 12);
    expect(probabilityOf(state, 0b01)).toBeCloseTo(0, 14);
    expect(probabilityOf(state, 0b10)).toBeCloseTo(0, 14);
  });

  it('a GHZ state puts all weight on all-zeros and all-ones', () => {
    const state = simulateStatevector(
      new CircuitBuilder('ghz', 3).h(0).cx(0, 1).cx(1, 2).build(),
      MAX
    );
    expect(probabilityOf(state, 0b000)).toBeCloseTo(0.5, 12);
    expect(probabilityOf(state, 0b111)).toBeCloseTo(0.5, 12);
    for (const index of [0b001, 0b010, 0b011, 0b100, 0b101, 0b110]) {
      expect(probabilityOf(state, index)).toBeCloseTo(0, 14);
    }
  });

  it('Toffoli flips the target only when both controls are set', () => {
    const flipped = simulateStatevector(
      new CircuitBuilder('ccx-11', 3).x(0).x(1).ccx(0, 1, 2).build(),
      MAX
    );
    expect(probabilityOf(flipped, 0b111)).toBeCloseTo(1, 12);

    const unflipped = simulateStatevector(
      new CircuitBuilder('ccx-10', 3).x(0).ccx(0, 1, 2).build(),
      MAX
    );
    expect(probabilityOf(unflipped, 0b001)).toBeCloseTo(1, 12);
  });

  it('SWAP exchanges two qubits', () => {
    const state = simulateStatevector(new CircuitBuilder('swap', 2).x(0).swap(0, 1).build(), MAX);
    expect(probabilityOf(state, 0b10)).toBeCloseTo(1, 12);
  });
});

describe('expectation values', () => {
  it('⟨Z⟩ is +1 on |0⟩ and −1 on |1⟩', () => {
    const zero = simulateStatevector(new CircuitBuilder('zero', 1).build(), MAX);
    const one = simulateStatevector(new CircuitBuilder('one', 1).x(0).build(), MAX);

    expect(pauliExpectation(zero, { coefficient: 1, paulis: 'Z' })).toBeCloseTo(1, 12);
    expect(pauliExpectation(one, { coefficient: 1, paulis: 'Z' })).toBeCloseTo(-1, 12);
  });

  it('⟨X⟩ is +1 on |+⟩ and ⟨Z⟩ is 0 there', () => {
    const plus = simulateStatevector(new CircuitBuilder('plus', 1).h(0).build(), MAX);
    expect(pauliExpectation(plus, { coefficient: 1, paulis: 'X' })).toBeCloseTo(1, 12);
    expect(pauliExpectation(plus, { coefficient: 1, paulis: 'Z' })).toBeCloseTo(0, 12);
  });

  it('⟨Y⟩ is +1 on |+i⟩ — the check a mis-signed Y passes nothing else', () => {
    // S·H|0⟩ = (|0⟩ + i|1⟩)/√2
    const plusI = simulateStatevector(new CircuitBuilder('plus-i', 1).h(0).s(0).build(), MAX);
    expect(pauliExpectation(plusI, { coefficient: 1, paulis: 'Y' })).toBeCloseTo(1, 12);
  });

  it('⟨ZZ⟩ is +1 on a Bell state — correlated, though each qubit alone is random', () => {
    const bell = simulateStatevector(new CircuitBuilder('bell', 2).h(0).cx(0, 1).build(), MAX);
    expect(pauliExpectation(bell, { coefficient: 1, paulis: 'ZZ' })).toBeCloseTo(1, 12);
    expect(pauliExpectation(bell, { coefficient: 1, paulis: 'ZI' })).toBeCloseTo(0, 12);
  });

  it('a weighted sum of Pauli terms adds up', () => {
    const zero = simulateStatevector(new CircuitBuilder('zero', 2).build(), MAX);
    const energy = observableExpectation(zero, {
      qubits: 2,
      terms: [
        { coefficient: 2, paulis: 'ZI' },
        { coefficient: 3, paulis: 'IZ' },
        { coefficient: -1, paulis: 'ZZ' },
      ],
    });
    expect(energy).toBeCloseTo(2 + 3 - 1, 12);
  });

  it('a non-Pauli character is refused rather than ignored', () => {
    const zero = simulateStatevector(new CircuitBuilder('zero', 1).build(), MAX);
    expect(() => pauliExpectation(zero, { coefficient: 1, paulis: 'Q' })).toThrow(
      InvalidQuantumCircuitError
    );
  });
});

describe('sampling', () => {
  const bell = new CircuitBuilder('bell', 2).h(0).cx(0, 1).measureAll().build();

  it('accounts for every shot', () => {
    const counts = sampleCounts(simulateStatevector(bell, MAX), bell, 1000, 1);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('never produces an outcome with zero amplitude', () => {
    const counts = sampleCounts(simulateStatevector(bell, MAX), bell, 5000, 2);
    expect(Object.keys(counts).sort()).toEqual(['00', '11']);
  });

  it('is deterministic for a given seed and differs across seeds', () => {
    const state = simulateStatevector(bell, MAX);
    expect(sampleCounts(state, bell, 500, 7)).toEqual(sampleCounts(state, bell, 500, 7));
    expect(sampleCounts(state, bell, 500, 7)).not.toEqual(sampleCounts(state, bell, 500, 8));
  });

  it('approximates the true distribution within sampling error', () => {
    const counts = sampleCounts(simulateStatevector(bell, MAX), bell, 20_000, 3);
    // 3σ on 20,000 samples of p=0.5 is about 1%.
    expect(counts['00'] / 20_000).toBeGreaterThan(0.48);
    expect(counts['00'] / 20_000).toBeLessThan(0.52);
  });

  it('a partial measurement yields only the measured qubits, in classical-bit order', () => {
    const circuit = new CircuitBuilder('partial', 3, 2).x(0).x(2).measure(2, 0).measure(0, 1).build();
    const counts = sampleCounts(simulateStatevector(circuit, MAX), circuit, 10, 1);
    // clbit 0 ← qubit 2 (=1), clbit 1 ← qubit 0 (=1)
    expect(Object.keys(counts)).toEqual(['11']);
  });
});

describe('limits are enforced before allocation', () => {
  it('refuses a circuit above the configured qubit ceiling', () => {
    const big = new CircuitBuilder('big', 12).h(0).build();
    expect(() => simulateStatevector(big, 8)).toThrow(InvalidQuantumCircuitError);
    expect(() => simulateStatevector(big, 8)).toThrow(/QUANTUM_LOCAL_MAX_QUBITS/);
  });

  it('reports memory honestly: 16 bytes per amplitude', () => {
    expect(statevectorBytes(10)).toBe(1024 * 16);
    expect(statevectorBytes(20)).toBe(16 * 1024 * 1024);
  });

  it('refuses to simulate an unbound parameterised circuit', () => {
    const circuit = new CircuitBuilder('param', 1).rz(0, 'theta').build();
    expect(() => simulateStatevector(circuit, MAX)).toThrow(/unbound parameter/);
  });
});

describe('the circuit IR', () => {
  it('rejects an out-of-range qubit at build time, not at execution time', () => {
    expect(() => new CircuitBuilder('bad', 2).h(5)).toThrow(InvalidQuantumCircuitError);
  });

  it('rejects a gate applied to the same qubit twice', () => {
    expect(() => new CircuitBuilder('bad', 2).cx(1, 1)).toThrow(/same qubit twice/);
  });

  it('rejects the wrong number of angles', () => {
    expect(() => new CircuitBuilder('bad', 1).gate('rx', [0], [])).toThrow(/1 parameter/);
    expect(() => new CircuitBuilder('bad', 1).gate('u', [0], [0.1])).toThrow(/3 parameter/);
  });

  it('measures depth as the longest chain sharing a qubit, not the gate count', () => {
    // Four gates, but on independent qubits: depth 1, not 4.
    const parallel = new CircuitBuilder('parallel', 4).h(0).h(1).h(2).h(3).build();
    expect(parallel.gates).toHaveLength(4);
    expect(circuitDepth(parallel)).toBe(1);

    const serial = new CircuitBuilder('serial', 1).h(0).x(0).h(0).build();
    expect(circuitDepth(serial)).toBe(3);
  });

  it('counts two-qubit gates, which are what hardware error scales with', () => {
    const circuit = new CircuitBuilder('mixed', 3).h(0).cx(0, 1).ccx(0, 1, 2).build();
    expect(twoQubitGateCount(circuit)).toBe(2);
  });

  it('hashes by structure, not by name', () => {
    const a = new CircuitBuilder('name-one', 2).h(0).cx(0, 1).build();
    const b = new CircuitBuilder('name-two', 2).h(0).cx(0, 1).build();
    const c = new CircuitBuilder('name-one', 2).h(1).cx(0, 1).build();

    expect(circuitHash(a)).toBe(circuitHash(b));
    expect(circuitHash(a)).not.toBe(circuitHash(c));
  });

  it('binds parameters, and refuses to invent a missing one', () => {
    const circuit = new CircuitBuilder('param', 1).rz(0, 'theta').rx(0, 0.5).build();
    expect(circuit.parameters).toEqual(['theta']);

    const bound = bindParameters(circuit, { theta: 1.25 });
    expect(bound.parameters).toEqual([]);
    expect(bound.gates[0].params).toEqual([1.25]);
    // The untouched literal survives binding.
    expect(bound.gates[1].params).toEqual([0.5]);

    // A zero angle is a legitimate rotation, so a silent default would run
    // and answer a different question than the one asked.
    expect(() => bindParameters(circuit, {})).toThrow(/missing value/);
  });

  it('rzz expands to the CX–RZ–CX identity rather than a gate backends may lack', () => {
    const circuit = new CircuitBuilder('rzz', 2).rzz(0, 1, 0.3).build();
    expect(circuit.gates.map((g) => g.name)).toEqual(['cx', 'rz', 'cx']);
  });
});

describe('OpenQASM emission', () => {
  it('emits a valid-looking OpenQASM 3 program', () => {
    const circuit = new CircuitBuilder('bell', 2).h(0).cx(0, 1).measureAll().build();
    const qasm = toQasm3(circuit);

    expect(qasm).toContain('OPENQASM 3.0;');
    expect(qasm).toContain('include "stdgates.inc";');
    expect(qasm).toContain('qubit[2] q;');
    expect(qasm).toContain('bit[2] c;');
    expect(qasm).toContain('h q[0];');
    expect(qasm).toContain('cx q[0], q[1];');
    expect(qasm).toContain('c[0] = measure q[0];');
  });

  it('declares unbound parameters as OpenQASM 3 inputs', () => {
    const circuit = new CircuitBuilder('vqe', 1).ry(0, 'theta').build();
    const qasm = toQasm3(circuit);

    expect(qasm).toContain('input float[64] theta;');
    expect(qasm).toContain('ry(theta) q[0];');
  });

  it('round-trips angles at full float64 precision', () => {
    const angle = 0.1 + 0.2; // 0.30000000000000004
    const qasm = toQasm3(new CircuitBuilder('a', 1).rz(0, angle).build());
    const emitted = Number(qasm.match(/rz\(([^)]+)\)/)![1]);
    expect(emitted).toBe(angle);
  });

  it('maps p and cp to their QASM 2 equivalents rather than dropping them', () => {
    const circuit = new CircuitBuilder('p', 2).p(0, 0.5).gate('cp', [0, 1], [0.25]).build();
    const qasm = toQasm2(circuit);

    expect(qasm).toContain('OPENQASM 2.0;');
    expect(qasm).toMatch(/u1\(0\.5/);
    expect(qasm).toMatch(/cu1\(0\.25/);
  });

  it('refuses to emit QASM 2 for a parameterised circuit instead of substituting zeros', () => {
    const circuit = new CircuitBuilder('param', 1).ry(0, 'theta').build();
    expect(() => toQasm2(circuit)).toThrow(/no parameter mechanism/);
  });
});
