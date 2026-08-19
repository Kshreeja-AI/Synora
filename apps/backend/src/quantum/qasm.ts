import { InvalidQuantumCircuitError } from './errors';
import type { QuantumCircuit, QuantumGate, QuantumGateName } from './types';

/**
 * OpenQASM emission — Synora's vendor-neutral circuit interchange.
 *
 * THIS FILE IS WHY QISKIT IS NOT A DEPENDENCY. OpenQASM 3 is an open,
 * versioned specification, and it is what `qiskit.qasm3.loads()`, IBM
 * Quantum Runtime and Amazon Braket all accept. Emitting it means a
 * Qiskit-based executor can run a Synora circuit without Synora importing
 * Qiskit, and an IBM adapter can submit a job without Synora learning IBM's
 * object model. Every adapter that needs text asks this module for it;
 * nothing else in the codebase constructs QASM by hand.
 *
 * QASM 2 is emitted as well, and deliberately: a great deal of quantum
 * tooling — including plenty of published research code — still reads only
 * QASM 2, and being unreadable by the ecosystem you intend to compare
 * yourself against is a real cost. Its limitations are enforced rather than
 * papered over: it has no parameter mechanism, so a symbolic circuit is
 * refused instead of silently emitted with zeros substituted.
 */

/**
 * Angles are printed with 17 significant digits — enough that a float64
 * survives the text round-trip exactly. Truncating to something prettier
 * would silently perturb a variational optimum between the value Synora
 * optimised and the value the backend ran.
 */
function angle(value: number): string {
  if (!Number.isFinite(value)) {
    throw new InvalidQuantumCircuitError('cannot emit a non-finite angle', 'qasm');
  }
  return value.toPrecision(17);
}

/** Literal or bound name for parameter slot `i`. */
function slot(gate: QuantumGate, i: number): string {
  const ref = gate.paramRefs?.[i];
  if (typeof ref === 'string') return ref;
  return angle(gate.params?.[i] ?? 0);
}

function args(gate: QuantumGate, count: number): string {
  if (count === 0) return '';
  const parts: string[] = [];
  for (let i = 0; i < count; i++) parts.push(slot(gate, i));
  return `(${parts.join(', ')})`;
}

const QASM3_NAME: Readonly<Record<QuantumGateName, string>> = {
  id: 'id',
  h: 'h',
  x: 'x',
  y: 'y',
  z: 'z',
  s: 's',
  sdg: 'sdg',
  t: 't',
  tdg: 'tdg',
  rx: 'rx',
  ry: 'ry',
  rz: 'rz',
  p: 'p',
  // The three-angle single-qubit gate is a BUILT-IN in OpenQASM 3 and is
  // spelled with a capital U. Lower-case `u` also exists via stdgates.inc,
  // but the built-in is the one guaranteed present with no include at all.
  u: 'U',
  cx: 'cx',
  cy: 'cy',
  cz: 'cz',
  swap: 'swap',
  crz: 'crz',
  cp: 'cp',
  ccx: 'ccx',
};

/**
 * qelib1.inc, QASM 2's standard library, is a smaller vocabulary. Two of
 * Synora's gates have no same-named entry and are mapped to their exact
 * equivalents rather than being dropped:
 *   p(λ)     ≡ u1(λ)
 *   cp(λ)    ≡ cu1(λ)
 *   u(θ,φ,λ) ≡ u3(θ,φ,λ)
 */
const QASM2_NAME: Readonly<Record<QuantumGateName, string>> = {
  ...QASM3_NAME,
  p: 'u1',
  cp: 'cu1',
  u: 'u3',
};

const PARAM_COUNT: Readonly<Record<QuantumGateName, number>> = {
  id: 0,
  h: 0,
  x: 0,
  y: 0,
  z: 0,
  s: 0,
  sdg: 0,
  t: 0,
  tdg: 0,
  rx: 1,
  ry: 1,
  rz: 1,
  p: 1,
  u: 3,
  cx: 0,
  cy: 0,
  cz: 0,
  swap: 0,
  crz: 1,
  cp: 1,
  ccx: 0,
};

/**
 * Emit OpenQASM 3.0.
 *
 * Unbound parameters become `input float[64] name;` declarations, which is
 * the specification's own mechanism for exactly this — a parameterised
 * circuit stays one program instead of becoming N programs, which is what
 * makes a variational loop affordable on a queued backend.
 */
export function toQasm3(circuit: QuantumCircuit): string {
  const lines: string[] = ['OPENQASM 3.0;', 'include "stdgates.inc";', ''];

  for (const name of circuit.parameters) {
    lines.push(`input float[64] ${name};`);
  }
  if (circuit.parameters.length > 0) lines.push('');

  lines.push(`qubit[${circuit.qubits}] q;`);
  if (circuit.clbits > 0) lines.push(`bit[${circuit.clbits}] c;`);
  lines.push('');

  for (const gate of circuit.gates) {
    const operands = gate.qubits.map((q) => `q[${q}]`).join(', ');
    lines.push(`${QASM3_NAME[gate.name]}${args(gate, PARAM_COUNT[gate.name])} ${operands};`);
  }

  if (circuit.measurements.length > 0) lines.push('');
  for (const m of circuit.measurements) {
    lines.push(`c[${m.clbit}] = measure q[${m.qubit}];`);
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Emit OpenQASM 2.0.
 *
 * Refuses a circuit with unbound parameters. QASM 2 has no `input` concept,
 * so the only ways to emit one would be to invent a value or to drop the
 * gate — the first fabricates a computation, the second corrupts one. Bind
 * the parameters first (`bindParameters`) and the refusal goes away.
 */
export function toQasm2(circuit: QuantumCircuit): string {
  if (circuit.parameters.length > 0) {
    throw new InvalidQuantumCircuitError(
      `OpenQASM 2 has no parameter mechanism, and this circuit has unbound parameter(s): ` +
        `${circuit.parameters.join(', ')}. Bind them with bindParameters() before emitting, ` +
        'or emit OpenQASM 3 instead.',
      circuit.name
    );
  }

  const lines: string[] = [
    'OPENQASM 2.0;',
    'include "qelib1.inc";',
    '',
    `qreg q[${circuit.qubits}];`,
  ];
  if (circuit.clbits > 0) lines.push(`creg c[${circuit.clbits}];`);
  lines.push('');

  for (const gate of circuit.gates) {
    const operands = gate.qubits.map((q) => `q[${q}]`).join(',');
    lines.push(`${QASM2_NAME[gate.name]}${args(gate, PARAM_COUNT[gate.name])} ${operands};`);
  }

  if (circuit.measurements.length > 0) lines.push('');
  for (const m of circuit.measurements) {
    lines.push(`measure q[${m.qubit}] -> c[${m.clbit}];`);
  }

  return `${lines.join('\n')}\n`;
}
