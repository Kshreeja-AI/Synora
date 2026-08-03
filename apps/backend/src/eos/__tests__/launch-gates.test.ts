/**
 * Launch gate tests.
 *
 * The property under test is refusal. Every readiness figure given to the
 * founder so far has been an estimate produced by the person whose work it
 * assesses. This module exists to replace estimates with measurements — so
 * what it must never do is manufacture one, and what it must never allow is
 * an unmeasured gate being counted as a pass.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LAUNCH_GATES,
  clearGateMeasurements,
  getLaunchReadiness,
  recordGateMeasurement,
} from '../launch-gates';

const evidence = { source: 'evaluation run r_1', measuredAt: Date.now(), sampleSize: 200 };

describe('launch-gates', () => {
  beforeEach(clearGateMeasurements);

  describe('the honest starting point', () => {
    it('reports every gate as unmeasured, not failed and not passed', () => {
      const readiness = getLaunchReadiness();

      expect(readiness.unmeasured).toBe(LAUNCH_GATES.length);
      expect(readiness.passed).toBe(0);
      expect(readiness.failed).toBe(0);
      // Unmeasured is a third state. Calling it failed would make an absence
      // of testing look like an engineering problem; calling it passed is
      // the failure mode that ends companies.
      expect(readiness.gates.every((g) => g.status === 'unmeasured')).toBe(true);
    });

    it('says so plainly rather than reporting zero percent ready', () => {
      expect(getLaunchReadiness().summary).toMatch(/all of them are waiting on evidence/i);
      expect(getLaunchReadiness().summary).toMatch(/not a failure/i);
    });

    it('reports no value at all for an unmeasured gate', () => {
      const [gate] = getLaunchReadiness().gates;
      // Null, never zero — zero is a measurement.
      expect(gate.value).toBeNull();
      expect(gate.blockedBy).toBeTruthy();
    });

    it('states what each unmeasured gate is waiting for', () => {
      for (const gate of getLaunchReadiness().gates) {
        expect(gate.blockedBy!.length).toBeGreaterThan(20);
      }
      const quality = getLaunchReadiness().gates.find((g) => g.id === 'ai-quality')!;
      expect(quality.blockedBy).toMatch(/No judge is configured yet/i);
    });

    it('is not ready to launch', () => {
      expect(getLaunchReadiness().readyToLaunch).toBe(false);
    });
  });

  describe('recording evidence', () => {
    it('passes a gate whose measurement meets an at-least threshold', () => {
      recordGateMeasurement({ gateId: 'ai-quality', value: 96, ...evidence });

      const gate = getLaunchReadiness().gates.find((g) => g.id === 'ai-quality')!;
      expect(gate.status).toBe('passed');
      expect(gate.value).toBe(96);
      expect(gate.sampleSize).toBe(200);
    });

    it('fails a gate whose measurement misses it', () => {
      recordGateMeasurement({ gateId: 'ai-quality', value: 94.9, ...evidence });
      expect(getLaunchReadiness().gates.find((g) => g.id === 'ai-quality')!.status).toBe('failed');
    });

    it('handles at-most gates the other way round', () => {
      // Hallucination rate must stay BELOW its threshold.
      recordGateMeasurement({ gateId: 'hallucination-rate', value: 1.5, ...evidence });
      expect(
        getLaunchReadiness().gates.find((g) => g.id === 'hallucination-rate')!.status,
      ).toBe('passed');

      recordGateMeasurement({ gateId: 'hallucination-rate', value: 2.5, ...evidence });
      expect(
        getLaunchReadiness().gates.find((g) => g.id === 'hallucination-rate')!.status,
      ).toBe('failed');
    });

    it('records where the number came from, so it can be rechecked', () => {
      recordGateMeasurement({ gateId: 'ai-quality', value: 96, ...evidence });
      expect(getLaunchReadiness().gates.find((g) => g.id === 'ai-quality')!.source).toBe(
        'evaluation run r_1',
      );
    });

    it('refuses a measurement for a gate that does not exist', () => {
      expect(recordGateMeasurement({ gateId: 'invented-gate', value: 100, ...evidence })).toBe(false);
    });

    it('refuses a measurement with no observations behind it', () => {
      // A figure resting on nothing is an assertion wearing a number.
      expect(recordGateMeasurement({ gateId: 'ai-quality', value: 100, ...evidence, sampleSize: 0 })).toBe(
        false,
      );
      expect(getLaunchReadiness().gates.find((g) => g.id === 'ai-quality')!.status).toBe('unmeasured');
    });

    it('refuses a non-finite value', () => {
      expect(
        recordGateMeasurement({ gateId: 'ai-quality', value: Number.NaN, ...evidence }),
      ).toBe(false);
    });
  });

  describe('readiness', () => {
    it('is not ready while any gate remains unmeasured, however many pass', () => {
      for (const gate of LAUNCH_GATES.slice(0, LAUNCH_GATES.length - 1)) {
        recordGateMeasurement({
          gateId: gate.id,
          value: gate.direction === 'at-least' ? gate.threshold : 0,
          ...evidence,
        });
      }

      const readiness = getLaunchReadiness();

      expect(readiness.passed).toBe(LAUNCH_GATES.length - 1);
      expect(readiness.unmeasured).toBe(1);
      // One unknown is enough to withhold a launch decision.
      expect(readiness.readyToLaunch).toBe(false);
      expect(readiness.summary).toMatch(/an unmeasured gate is not a passing one/i);
    });

    it('is ready only when every gate is measured and passing', () => {
      for (const gate of LAUNCH_GATES) {
        recordGateMeasurement({
          gateId: gate.id,
          value: gate.direction === 'at-least' ? gate.threshold : 0,
          ...evidence,
        });
      }

      const readiness = getLaunchReadiness();

      expect(readiness.readyToLaunch).toBe(true);
      expect(readiness.summary).toMatch(/All \d+ gates are measured and passing/);
    });

    it('distinguishes a known problem from an unknown in its summary', () => {
      recordGateMeasurement({ gateId: 'ai-quality', value: 50, ...evidence });

      expect(getLaunchReadiness().summary).toMatch(
        /A failing gate is a known problem; an unmeasured one is an unknown/i,
      );
    });

    it('reports no overall percentage, because averaging unknowns invents knowledge', () => {
      recordGateMeasurement({ gateId: 'ai-quality', value: 96, ...evidence });

      const readiness = getLaunchReadiness();

      // Counts, never a score. A "40% ready" figure derived partly from
      // gates nobody has tested would read as knowledge.
      expect(Object.keys(readiness)).not.toContain('score');
      expect(Object.keys(readiness)).not.toContain('percentage');
      expect(readiness.passed + readiness.failed + readiness.unmeasured).toBe(LAUNCH_GATES.length);
    });
  });

  describe('the gate definitions themselves', () => {
    it('states each gate as a question a founder can act on', () => {
      for (const gate of LAUNCH_GATES) {
        expect(gate.question).toMatch(/\?$/);
        expect(gate.evidenceRequired.length).toBeGreaterThan(20);
      }
    });

    it('covers the categories the founder set', () => {
      const ids = LAUNCH_GATES.map((g) => g.id);
      expect(ids).toContain('ai-quality');
      expect(ids).toContain('benchmark-pass-rate');
      expect(ids).toContain('hallucination-rate');
      expect(ids).toContain('memory-accuracy');
      expect(ids).toContain('security-tests');
      expect(ids).toContain('privacy-tests');
      expect(ids).toContain('regression-failures');
      expect(ids).toContain('integration-tests');
      expect(ids).toContain('recovery-success');
      expect(ids).toContain('critical-bugs');
    });
  });
});
