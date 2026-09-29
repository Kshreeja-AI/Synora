/**
 * Privacy coverage tests.
 *
 * The measurement under test is whether real emission paths redact — not
 * whether the redactor works. That distinction is not academic: the
 * redaction module was thoroughly tested while the export worker carried
 * its own weaker copy of the patterns and leaked seven of eight sensitive
 * types. A probe-based audit is the only kind that would have caught it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SENSITIVE_PROBE_INPUT,
  auditPrivacyCoverage,
  declareEgressPath,
  listEgressPaths,
  measurePrivacyGate,
  resetEgressPaths,
} from '../privacy-coverage';
import { clearGateMeasurements, getLaunchReadiness } from '../launch-gates';
import { redact } from '../redaction';
import { sanitizePII } from '../../workers/export-dataset.worker';

describe('privacy-coverage', () => {
  beforeEach(() => {
    resetEgressPaths();
    clearGateMeasurements();
  });

  it('declares nothing by default, and refuses to score a vacuous audit', async () => {
    const result = await auditPrivacyCoverage();

    expect(result.declaredPaths).toBe(0);
    // 0 of 0 is not 0%. Recording it would read as a failure rather than
    // as an absence of anything to measure.
    expect(await measurePrivacyGate()).toBeNull();
    expect(getLaunchReadiness().gates.find((g) => g.id === 'privacy-tests')!.status).toBe('unmeasured');
  });

  it('passes a path that demonstrably redacts', async () => {
    declareEgressPath({
      id: 'safe',
      description: 'redacts properly',
      probe: (input) => redact(input).text,
    });

    const result = await auditPrivacyCoverage();

    expect(result.coveragePercent).toBe(100);
    expect(result.paths[0].leakedTypes).toEqual([]);
  });

  it('fails a path that leaks, and names what leaked', async () => {
    declareEgressPath({
      id: 'leaky',
      description: 'emits raw input',
      // Exactly the shape of the real defect: a path that never redacts.
      probe: (input) => input,
    });

    const result = await auditPrivacyCoverage();

    expect(result.coveragePercent).toBe(0);
    expect(result.paths[0].redacted).toBe(false);
    expect(result.paths[0].leakedTypes.length).toBeGreaterThan(3);
  });

  it('names leak categories, never the sensitive values themselves', async () => {
    declareEgressPath({ id: 'leaky', description: 'leaks', probe: (input) => input });

    const result = await auditPrivacyCoverage();

    // A privacy report that quoted the leak would itself be a leak.
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('keshav@synora.ai');
    expect(serialised).not.toContain('4111111111111111');
    expect(result.paths[0].leakedTypes).toContain('email');
  });

  it('catches a path with a weaker filter than the shared one', async () => {
    declareEgressPath({
      id: 'partial',
      description: 'only handles emails',
      // The real historical bug: a local pattern set that covers less than
      // the shared redactor does.
      probe: (input) => input.replace(/[\w.]+@[\w.]+/g, '[EMAIL]'),
    });

    const result = await auditPrivacyCoverage();

    expect(result.paths[0].redacted).toBe(false);
    expect(result.paths[0].leakedTypes).not.toContain('email');
    expect(result.paths[0].leakedTypes).toContain('creditCard');
  });

  it('treats a probe that throws as a failure, not a pass', async () => {
    declareEgressPath({
      id: 'broken',
      description: 'probe explodes',
      probe: () => {
        throw new Error('probe unavailable');
      },
    });

    const result = await auditPrivacyCoverage();

    // A probe that proves nothing must never count as evidence of safety.
    expect(result.paths[0].redacted).toBe(false);
    expect(result.paths[0].error).toBe('probe unavailable');
    expect(result.coveragePercent).toBe(0);
  });

  it('states that undeclared paths are outside the audit', async () => {
    declareEgressPath({ id: 'safe', description: 'ok', probe: (i) => redact(i).text });

    const result = await auditPrivacyCoverage();

    // A perfect score on a short registry must not read as a perfect score
    // on the system.
    expect(result.limitation).toMatch(/declared coverage rather than proof/i);
    expect(result.limitation).toContain('1 declared egress path');
  });

  describe('against the real export path', () => {
    it('proves the dataset export redacts every probed type', async () => {
      declareEgressPath({
        id: 'dataset-export',
        description: 'Evaluation dataset exported to a file for download.',
        probe: (input) => sanitizePII(input),
      });

      const result = await auditPrivacyCoverage();

      // Real function, real sensitive input, real output. This is the path
      // that once leaked, and the assertion is that it no longer does.
      expect(result.paths[0].redacted).toBe(true);
      expect(result.coveragePercent).toBe(100);
    });

    it('records the measurement against the privacy gate', async () => {
      declareEgressPath({
        id: 'dataset-export',
        description: 'export',
        probe: (input) => sanitizePII(input),
      });

      await measurePrivacyGate();

      const gate = getLaunchReadiness().gates.find((g) => g.id === 'privacy-tests')!;
      expect(gate.status).toBe('passed');
      expect(gate.value).toBe(100);
      expect(gate.sampleSize).toBe(1);
      // The sample size makes a 100% on one path visible as exactly that.
      expect(gate.source).toMatch(/1 declared egress path/);
    });
  });

  it('probes with regional identifiers a Western-centric fixture would miss', () => {
    // An earlier phone pattern passed US and UK numbers and failed Indian
    // ones, in shipping export code.
    expect(SENSITIVE_PROBE_INPUT).toContain('+91');
    expect(SENSITIVE_PROBE_INPUT).toContain('ABCDE1234F');
    expect(SENSITIVE_PROBE_INPUT).toContain('1234 5678 9012');
  });

  it('lists what it has been told to watch', () => {
    declareEgressPath({ id: 'b', description: 'b', probe: (i) => i });
    declareEgressPath({ id: 'a', description: 'a', probe: (i) => i });
    expect(listEgressPaths()).toEqual(['a', 'b']);
  });
});
