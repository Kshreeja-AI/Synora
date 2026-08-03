import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { engineeringEventBus } from '../event-bus';
import {
  captureInteraction,
  getCaptureStats,
  setSampler,
  shouldCapture,
  startCaseCapture,
  stopCaseCapture,
  type Interaction,
} from '../case-capture';
import { getCases, getDataset, resetDatasets } from '../evaluation-datasets';

function interaction(overrides: Partial<Interaction> = {}): Interaction {
  return {
    promptId: 'summarize',
    input: 'some input',
    output: 'some output',
    success: true,
    consented: true,
    ...overrides,
  };
}

describe('case-capture', () => {
  beforeEach(() => {
    stopCaseCapture();
    resetDatasets();
  });

  afterEach(() => {
    stopCaseCapture();
  });

  it('captures nothing until explicitly started', () => {
    // Deriving cases from customer data must never begin implicitly.
    const result = captureInteraction(interaction({ success: false }));
    expect(result.captured).toBe(false);
    expect(result.reason).toBe('inactive');
  });

  it('captures failures as real-origin cases', () => {
    startCaseCapture({ datasetId: 'ds' });
    const result = captureInteraction(interaction({ success: false }));

    expect(result.captured).toBe(true);
    expect(result.reason).toBe('failure');

    const cases = getCases('ds');
    expect(cases).toHaveLength(1);
    expect(cases[0].origin).toBe('real');
    expect(cases[0].tags).toContain('reason:failure');
    expect(cases[0].tags).toContain('prompt:summarize');
  });

  it('captures low-rated interactions even when they succeeded', () => {
    startCaseCapture({ datasetId: 'ds', lowRatingAtOrBelow: 2 });
    expect(captureInteraction(interaction({ success: true, rating: 1 })).reason).toBe('low-rating');
    expect(captureInteraction(interaction({ success: true, rating: 5 })).captured).toBe(false);
  });

  it('does not capture successful, well-rated interactions by default', () => {
    startCaseCapture({ datasetId: 'ds' });
    const result = captureInteraction(interaction({ success: true, rating: 5 }));
    expect(result.captured).toBe(false);
    expect(result.reason).toBe('not-of-interest');
  });

  it('skips capture without consent when consent is required', () => {
    startCaseCapture({ datasetId: 'ds', requireConsent: true });
    expect(captureInteraction(interaction({ success: false, consented: false })).reason).toBe('no-consent');
    expect(captureInteraction(interaction({ success: false, consented: undefined })).reason).toBe('no-consent');
    expect(getCases('ds')).toHaveLength(0);
  });

  it('captures without consent only when consent is not required', () => {
    startCaseCapture({ datasetId: 'ds', requireConsent: false });
    expect(captureInteraction(interaction({ success: false, consented: false })).captured).toBe(true);
  });

  it('redacts sensitive data before storing a case', () => {
    startCaseCapture({ datasetId: 'ds' });
    captureInteraction(
      interaction({
        success: false,
        input: 'my email is keshav@synora.ai',
        output: 'your card 4111111111111111 was charged',
      }),
    );

    const stored = getCases('ds')[0];
    expect(stored.input).toContain('[REDACTED_EMAIL]');
    expect(stored.input).not.toContain('keshav@synora.ai');
    expect(stored.actualOutput).toContain('[REDACTED_CARD]');
    expect(stored.actualOutput).not.toContain('4111111111111111');
  });

  it('records the failing output as observed, never as the expected answer', () => {
    startCaseCapture({ datasetId: 'ds' });
    captureInteraction(interaction({ success: false, input: 'q', output: 'the wrong answer' }));

    const stored = getCases('ds')[0];

    expect(stored.actualOutput).toBe('the wrong answer');
    // Graders treat `expected` as the correct answer. Storing a captured
    // failure there would score reproducing the bug as a pass and a genuine
    // fix as a regression — the evaluation would run exactly backwards.
    expect(stored.expected).toBeUndefined();
  });

  it('samples successful interactions at the configured rate', () => {
    startCaseCapture({ datasetId: 'ds', successSampleRate: 0.5 });

    setSampler(() => 0.1); // below rate → capture
    expect(captureInteraction(interaction({ success: true })).reason).toBe('success-sample');

    setSampler(() => 0.9); // above rate → skip
    expect(captureInteraction(interaction({ success: true })).captured).toBe(false);
  });

  it('stops capturing once the dataset is full', () => {
    startCaseCapture({ datasetId: 'ds', maxCases: 2 });
    captureInteraction(interaction({ success: false }));
    captureInteraction(interaction({ success: false }));

    const result = captureInteraction(interaction({ success: false }));
    expect(result.captured).toBe(false);
    expect(result.reason).toBe('dataset-full');
    expect(getCases('ds')).toHaveLength(2);
  });

  it('emits evaluation.case.captured reporting what was redacted', () => {
    startCaseCapture({ datasetId: 'ds' });
    const events: unknown[] = [];
    const unsub = engineeringEventBus.on('evaluation.case.captured', (e) => events.push(e));

    captureInteraction(interaction({ success: false, input: 'mail a@b.com' }));

    expect(events).toHaveLength(1);
    const payload = (events[0] as { payload: Record<string, unknown> }).payload;
    expect(payload.reason).toBe('failure');
    expect(payload.redactedInput).toBe(true);
    expect((payload.redactionCounts as Record<string, number>).email).toBe(1);
    unsub();
  });

  it('captures from ai.interaction.completed events', () => {
    startCaseCapture({ datasetId: 'ds' });
    engineeringEventBus.emit({
      type: 'ai.interaction.completed',
      timestamp: Date.now(),
      source: 'test',
      payload: {
        promptId: 'chat',
        input: 'in',
        output: 'out',
        success: false,
        consented: true,
      },
    });

    expect(getCases('ds')).toHaveLength(1);
  });

  it('tracks captured and skipped counts', () => {
    startCaseCapture({ datasetId: 'ds' });
    captureInteraction(interaction({ success: false }));
    captureInteraction(interaction({ success: true, rating: 5 }));

    const stats = getCaptureStats();
    expect(stats.active).toBe(true);
    expect(stats.captured).toBe(1);
    expect(stats.skipped).toBe(1);
  });

  it('stopCaseCapture halts capture and resets state', () => {
    startCaseCapture({ datasetId: 'ds' });
    captureInteraction(interaction({ success: false }));
    stopCaseCapture();

    expect(getCaptureStats().active).toBe(false);
    expect(getCaptureStats().captured).toBe(0);
    expect(captureInteraction(interaction({ success: false })).reason).toBe('inactive');
  });

  it('startCaseCapture is idempotent', () => {
    startCaseCapture({ datasetId: 'ds' });
    startCaseCapture({ datasetId: 'ds' });

    engineeringEventBus.emit({
      type: 'ai.interaction.completed',
      timestamp: Date.now(),
      source: 'test',
      payload: { promptId: 'p', input: 'i', output: 'o', success: false, consented: true },
    });

    // A duplicate subscription would store the same interaction twice.
    expect(getCases('ds')).toHaveLength(1);
  });

  it('creates the target dataset on start', () => {
    startCaseCapture({ datasetId: 'brand-new', datasetName: 'Brand new' });
    expect(getDataset('brand-new')).toBeDefined();
  });

  it('shouldCapture is a pure decision independent of active state', () => {
    const cfg = {
      datasetId: 'x',
      captureFailures: true,
      captureLowRated: false,
      lowRatingAtOrBelow: 2,
      successSampleRate: 0,
      maxCases: 10,
      defaultGraders: [],
      requireConsent: true,
    };
    expect(shouldCapture(interaction({ success: false }), cfg).capture).toBe(true);
    expect(shouldCapture(interaction({ success: true, rating: 1 }), cfg).capture).toBe(false);
  });
});
