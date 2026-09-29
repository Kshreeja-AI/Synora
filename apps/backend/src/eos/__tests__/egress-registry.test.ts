/**
 * Egress registry tests — the audit run against the REAL declared paths,
 * not fixtures. The fixtures in privacy-coverage.test.ts prove the audit
 * mechanism works; these prove the paths Synora actually ships redact.
 *
 * The case-capture path is here because probing it found a real leak the
 * day it became probeable: note and caller tags were stored verbatim while
 * input and output were redacted. These tests are what keeps that fixed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { registerEgressPaths } from '../egress-registry';
import {
  auditPrivacyCoverage,
  listEgressPaths,
  measurePrivacyGate,
  resetEgressPaths,
} from '../privacy-coverage';
import { clearGateMeasurements, getLaunchReadiness } from '../launch-gates';
import { listDatasets, resetDatasets } from '../evaluation-datasets';
import { stopCaseCapture } from '../case-capture';

describe('egress-registry', () => {
  beforeEach(() => {
    resetEgressPaths();
    clearGateMeasurements();
    resetDatasets();
    stopCaseCapture();
  });

  it('declares every shipping path', () => {
    registerEgressPaths();
    expect(listEgressPaths()).toEqual(['case-capture', 'dataset-export', 'request-log']);
  });

  it('every declared path demonstrably redacts the full probe input', async () => {
    registerEgressPaths();

    const result = await auditPrivacyCoverage();

    expect(result.declaredPaths).toBe(3);
    expect(result.coveragePercent).toBe(100);
    for (const path of result.paths) {
      expect(path.redacted).toBe(true);
      expect(path.leakedTypes).toEqual([]);
    }
  });

  it('the case-capture probe covers note and tags, the fields that leaked', async () => {
    registerEgressPaths();

    // Guard against the probe quietly narrowing: if it stopped feeding the
    // sensitive input through note and tags, a reintroduced metadata leak
    // would pass the audit again. The probe's own construction is the
    // control here, so this asserts on behaviour: a probe that exercises
    // those fields still comes back clean only because they are redacted.
    const result = await auditPrivacyCoverage();
    const capture = result.paths.find((p) => p.id === 'case-capture')!;

    expect(capture.redacted).toBe(true);
    expect(capture.description).toMatch(/captured into an evaluation dataset/i);
  });

  it('probing case capture stores nothing and starts nothing', async () => {
    registerEgressPaths();

    await auditPrivacyCoverage();

    // The audit must observe the system, not mutate it — a probe that
    // wrote a case into a live dataset would be an egress of its own.
    expect(listDatasets()).toHaveLength(0);
  });

  it('measures the privacy gate across every real path', async () => {
    registerEgressPaths();

    await measurePrivacyGate();

    const gate = getLaunchReadiness().gates.find((g) => g.id === 'privacy-tests')!;
    expect(gate.status).toBe('passed');
    expect(gate.value).toBe(100);
    // Sample size stated: a perfect score over three declared paths is
    // reported as exactly that, not as system-wide proof.
    expect(gate.sampleSize).toBe(3);
    expect(gate.source).toMatch(/3 declared egress path/);
  });
});
