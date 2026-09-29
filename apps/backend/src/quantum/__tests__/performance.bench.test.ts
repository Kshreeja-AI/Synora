import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit';
import { sampleCounts, simulateStatevector, statevectorBytes } from '../simulator/statevector';

/**
 * Timings, not thresholds.
 *
 * This file exists so the cost of a simulation is a MEASURED number in the
 * record rather than an impression, and so the exponential is visible rather
 * than described. It deliberately asserts almost nothing about wall-clock: a
 * performance assertion on shared CI hardware fails for reasons that have
 * nothing to do with the code, and a test that cries wolf is a test people
 * learn to re-run instead of read.
 *
 * The one thing it DOES assert is the shape of the growth, which is a
 * property of the algorithm and not of the machine.
 */

function ghz(qubits: number) {
  const builder = new CircuitBuilder(`ghz-${qubits}`, qubits).h(0);
  for (let q = 1; q < qubits; q++) builder.cx(q - 1, q);
  return builder.measureAll().build();
}

describe('local simulator performance', () => {
  it('records simulation time and memory across a range of sizes', () => {
    const rows: { qubits: number; ms: number; bytes: number }[] = [];

    for (const qubits of [4, 8, 12, 16, 18]) {
      const circuit = ghz(qubits);
      const startedAt = performance.now();
      const state = simulateStatevector(circuit, 20);
      sampleCounts(state, circuit, 1024, 1);
      rows.push({
        qubits,
        ms: Math.round((performance.now() - startedAt) * 100) / 100,
        bytes: statevectorBytes(qubits),
      });
    }

    // Printed so the numbers land in the test log and the release record,
    // where a reader can see them next to the machine they were taken on.
    // eslint-disable-next-line no-console
    console.log(
      '\n  local statevector simulator (GHZ + 1024 shots)\n' +
        rows
          .map(
            (r) =>
              `    ${String(r.qubits).padStart(2)} qubits  ${String(r.ms).padStart(8)} ms  ` +
              `${(r.bytes / 1024).toFixed(0).padStart(7)} KB amplitudes`
          )
          .join('\n')
    );

    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row.ms).toBeGreaterThanOrEqual(0);
  });

  it('memory grows exactly as 2ⁿ — the property that bounds everything', () => {
    // Not a timing claim; an arithmetic one, and the reason the qubit ceiling
    // is enforced before allocation rather than discovered by an OOM kill.
    for (let n = 1; n <= 24; n++) {
      expect(statevectorBytes(n)).toBe(statevectorBytes(n - 1) * 2);
    }
    expect(statevectorBytes(20)).toBe(16 * 1024 * 1024);
    expect(statevectorBytes(30)).toBe(16 * 1024 * 1024 * 1024);
  });

  it('sampling cost is dominated by the state, not by the shot count', () => {
    // The cumulative distribution is built once (O(2ⁿ)) and each shot is a
    // binary search (O(n)). This is why a large shot count is cheap here and
    // never is on hardware — and why the two must not be compared naively.
    const circuit = ghz(14);
    const state = simulateStatevector(circuit, 20);

    const fewStart = performance.now();
    sampleCounts(state, circuit, 100, 1);
    const few = performance.now() - fewStart;

    const manyStart = performance.now();
    sampleCounts(state, circuit, 10_000, 1);
    const many = performance.now() - manyStart;

    // 100× the shots costs far less than 100× the time. A generous bound, so
    // this reports an algorithmic property rather than the machine's mood.
    expect(many).toBeLessThan(Math.max(50, few * 100));
  });
});
