import { describe, it, expect, beforeEach } from 'vitest';
import { engineeringEventBus } from '../event-bus';
import {
  buildCostAnomalyProposal,
  buildPromptRegressionProposal,
  decideProposal,
  getProposal,
  listProposals,
  startProposalEngine,
  stopProposalEngine,
} from '../proposal-engine';
import { startCostMonitor, stopCostMonitor, recordCostObservation } from '../cost-monitor';
import { startPromptIntelligence, stopPromptIntelligence, recordPromptOutcome } from '../prompt-intelligence';
import { startCaseCapture, stopCaseCapture, captureInteraction } from '../case-capture';
import { resetDatasets } from '../evaluation-datasets';
import { startProviderObservatory, stopProviderObservatory, recordProviderObservation } from '../provider-observatory';

describe('proposal-engine', () => {
  beforeEach(() => {
    stopProposalEngine();
    stopPromptIntelligence();
    stopCaseCapture();
    stopProviderObservatory();
    stopCostMonitor();
    resetDatasets();
  });

  it('creates a proposal when a prompt regression is detected', () => {
    startPromptIntelligence({ windowSize: 4, dropThreshold: 0.3 });
    startProposalEngine();

    for (let i = 0; i < 16; i++) recordPromptOutcome({ promptId: 'chat.generate', success: true, latencyMs: 10 });
    for (let i = 0; i < 4; i++) recordPromptOutcome({ promptId: 'chat.generate', success: false, latencyMs: 10 });

    const proposals = listProposals();
    expect(proposals).toHaveLength(1);
    expect(proposals[0].trigger).toBe('prompt-regression');
    expect(proposals[0].status).toBe('pending');
    expect(proposals[0].title).toContain('chat.generate');
  });

  it('states the problem with the numbers behind it, not just a claim', () => {
    const proposal = buildPromptRegressionProposal({
      promptId: 'summarize',
      version: 2,
      overallSuccessRate: 0.9,
      recentSuccessRate: 0.4,
      windowSize: 20,
    });

    expect(proposal.problem).toContain('40%');
    expect(proposal.problem).toContain('90%');
    expect(proposal.evidence.metrics.dropPercentagePoints).toBe(50);
    expect(proposal.evidence.metrics.windowSize).toBe(20);
  });

  it('records caveats so the limits of the reasoning travel with it', () => {
    const proposal = buildPromptRegressionProposal({
      promptId: 'summarize',
      version: 1,
      overallSuccessRate: 0.9,
      recentSuccessRate: 0.3,
      windowSize: 10,
    });

    // A success-rate drop is correlation. Saying so alongside the finding
    // stops the proposal reading as a diagnosis it cannot support.
    expect(proposal.caveats.some((c) => /correlation, not diagnosis/i.test(c))).toBe(true);
    expect(proposal.caveats.some((c) => /no captured cases/i.test(c))).toBe(true);
  });

  it('attaches captured failing cases as inspectable evidence', () => {
    startCaseCapture({ datasetId: 'ds' });
    captureInteraction({
      promptId: 'summarize',
      input: 'q',
      output: 'bad',
      success: false,
      consented: true,
    });

    const proposal = buildPromptRegressionProposal({
      promptId: 'summarize',
      version: 1,
      overallSuccessRate: 0.9,
      recentSuccessRate: 0.3,
      windowSize: 10,
      captureDatasetId: 'ds',
    });

    expect(proposal.evidence.affectedCaseIds).toHaveLength(1);
    expect(proposal.caveats.some((c) => /no captured cases/i.test(c))).toBe(false);
  });

  it('warns when a degraded provider may be the real cause', () => {
    startProviderObservatory();
    recordProviderObservation({
      providerId: 'anthropic',
      modelId: 'claude-x',
      latencyMs: 100,
      inputTokens: 10,
      outputTokens: 10,
      costCents: 1,
      success: false,
      errorCode: 'timeout',
    });

    const proposal = buildPromptRegressionProposal({
      promptId: 'summarize',
      version: 1,
      overallSuccessRate: 0.9,
      recentSuccessRate: 0.3,
      windowSize: 10,
    });

    // The prompt may be blameless — the provider may have changed underneath.
    expect(proposal.caveats.some((c) => /may be the underlying cause/i.test(c))).toBe(true);
  });

  it('suggests evaluating a change, never applying one', () => {
    const proposal = buildPromptRegressionProposal({
      promptId: 'summarize',
      version: 1,
      overallSuccessRate: 0.9,
      recentSuccessRate: 0.3,
      windowSize: 10,
    });

    expect(proposal.suggestedAction).toMatch(/evaluate/i);
    expect(proposal.suggestedAction).toMatch(/before changing anything/i);
  });

  it('emits proposal.created', () => {
    startPromptIntelligence({ windowSize: 4, dropThreshold: 0.3 });
    startProposalEngine();

    const events: unknown[] = [];
    const unsub = engineeringEventBus.on('proposal.created', (e) => events.push(e));

    for (let i = 0; i < 16; i++) recordPromptOutcome({ promptId: 'p', success: true, latencyMs: 10 });
    for (let i = 0; i < 4; i++) recordPromptOutcome({ promptId: 'p', success: false, latencyMs: 10 });

    expect(events).toHaveLength(1);
    unsub();
  });

  it('records an approval without executing anything', () => {
    startProposalEngine();
    startPromptIntelligence({ windowSize: 4, dropThreshold: 0.3 });
    for (let i = 0; i < 16; i++) recordPromptOutcome({ promptId: 'p', success: true, latencyMs: 10 });
    for (let i = 0; i < 4; i++) recordPromptOutcome({ promptId: 'p', success: false, latencyMs: 10 });

    const id = listProposals()[0].id;
    const decided = decideProposal(id, 'approved', 'looks right');

    expect(decided!.status).toBe('approved');
    expect(decided!.decisionNote).toBe('looks right');
    expect(decided!.decidedAt).toBeGreaterThan(0);
    // Approval is a recorded decision. The proposal itself is inert —
    // there is no apply() on this module for it to have triggered.
    expect(Object.keys(decided!)).not.toContain('applied');
  });

  it('does not re-decide a proposal that already has a decision', () => {
    startProposalEngine();
    startPromptIntelligence({ windowSize: 4, dropThreshold: 0.3 });
    for (let i = 0; i < 16; i++) recordPromptOutcome({ promptId: 'p', success: true, latencyMs: 10 });
    for (let i = 0; i < 4; i++) recordPromptOutcome({ promptId: 'p', success: false, latencyMs: 10 });

    const id = listProposals()[0].id;
    decideProposal(id, 'approved');
    const second = decideProposal(id, 'rejected');

    expect(second!.status).toBe('approved');
  });

  it('filters by status and returns null for an unknown id', () => {
    startProposalEngine();
    startPromptIntelligence({ windowSize: 4, dropThreshold: 0.3 });
    for (let i = 0; i < 16; i++) recordPromptOutcome({ promptId: 'p', success: true, latencyMs: 10 });
    for (let i = 0; i < 4; i++) recordPromptOutcome({ promptId: 'p', success: false, latencyMs: 10 });

    expect(listProposals('pending')).toHaveLength(1);
    expect(listProposals('approved')).toHaveLength(0);
    expect(decideProposal('nope', 'approved')).toBeNull();
    expect(getProposal('nope')).toBeUndefined();
  });

  describe('cost anomalies', () => {
    it('creates a proposal when the cost monitor raises an anomaly', () => {
      startCostMonitor({ windowSize: 5, minBaselineSamples: 20 });
      startProposalEngine();

      for (let i = 0; i < 25; i++)
        recordCostObservation({ providerId: 'anthropic', modelId: 'claude-x', costCents: 2, tokenPriced: true });
      for (let i = 0; i < 5; i++)
        recordCostObservation({ providerId: 'anthropic', modelId: 'claude-x', costCents: 20, tokenPriced: true });

      const proposals = listProposals();
      expect(proposals).toHaveLength(1);
      expect(proposals[0].trigger).toBe('cost-anomaly');
      expect(proposals[0].title).toContain('claude-x');
    });

    it('states the rise with both figures, not just a multiple', () => {
      const proposal = buildCostAnomalyProposal({
        providerId: 'anthropic',
        modelId: 'claude-x',
        baselineCostCents: 2,
        recentCostCents: 6,
        ratio: 3,
        baselineSamples: 40,
        windowSize: 10,
      });

      expect(proposal.problem).toContain('3.0×');
      expect(proposal.problem).toContain('2.0000');
      expect(proposal.problem).toContain('6.0000');
      expect(proposal.evidence.metrics.baselineSamples).toBe(40);
    });

    it('warns that a cost rise is frequently legitimate', () => {
      const proposal = buildCostAnomalyProposal({
        providerId: 'anthropic',
        modelId: 'claude-x',
        baselineCostCents: 2,
        recentCostCents: 6,
        ratio: 3,
        baselineSamples: 40,
        windowSize: 10,
      });

      // Longer conversations cost more. A proposal that treats every rise as
      // a defect teaches the reader to dismiss all of them.
      expect(proposal.caveats.some((c) => /entirely legitimate/i.test(c))).toBe(true);
      expect(proposal.caveats.some((c) => /Image and audio.*not measured here/i.test(c))).toBe(true);
    });

    it('does not report an uncomputable ratio as a number', () => {
      const proposal = buildCostAnomalyProposal({
        providerId: 'anthropic',
        modelId: 'claude-x',
        baselineCostCents: 0,
        recentCostCents: 3,
        ratio: null,
        baselineSamples: 40,
        windowSize: 10,
      });

      // A null ratio displayed as "0×" would read as cost falling to nothing,
      // the exact opposite of what happened.
      expect(proposal.evidence.metrics.ratio).toBe('not computable (baseline was zero)');
      expect(proposal.problem).toContain('no recorded cost');
      expect(proposal.caveats.some((c) => /nothing to something/i.test(c))).toBe(true);
    });

    it('warns when retries after failures could explain the rise', () => {
      startProviderObservatory();
      recordProviderObservation({
        providerId: 'anthropic',
        modelId: 'claude-x',
        latencyMs: 100,
        inputTokens: 10,
        outputTokens: 10,
        costCents: 1,
        success: false,
        errorCode: 'timeout',
      });

      const proposal = buildCostAnomalyProposal({
        providerId: 'anthropic',
        modelId: 'claude-x',
        baselineCostCents: 2,
        recentCostCents: 6,
        ratio: 3,
        baselineSamples: 40,
        windowSize: 10,
      });

      expect(proposal.caveats.some((c) => /retries after failures/i.test(c))).toBe(true);
    });

    it('claims no case evidence it never recorded', () => {
      const proposal = buildCostAnomalyProposal({
        providerId: 'anthropic',
        modelId: 'claude-x',
        baselineCostCents: 2,
        recentCostCents: 6,
        ratio: 3,
        baselineSamples: 40,
        windowSize: 10,
      });

      // Cost is measured per request, not per captured case. Attaching cases
      // here would imply a link that was never established.
      expect(proposal.evidence.affectedCaseIds).toEqual([]);
    });

    it('suggests confirming the cause, never applying a change', () => {
      const proposal = buildCostAnomalyProposal({
        providerId: 'anthropic',
        modelId: 'claude-x',
        baselineCostCents: 2,
        recentCostCents: 6,
        ratio: 3,
        baselineSamples: 40,
        windowSize: 10,
      });

      expect(proposal.suggestedAction).toMatch(/before changing anything in production/i);
    });

    it('runs both detectors at once without either suppressing the other', () => {
      startPromptIntelligence({ windowSize: 4, dropThreshold: 0.3 });
      startCostMonitor({ windowSize: 5, minBaselineSamples: 20 });
      startProposalEngine();

      for (let i = 0; i < 16; i++) recordPromptOutcome({ promptId: 'p', success: true, latencyMs: 10 });
      for (let i = 0; i < 4; i++) recordPromptOutcome({ promptId: 'p', success: false, latencyMs: 10 });
      for (let i = 0; i < 25; i++)
        recordCostObservation({ providerId: 'openai', modelId: 'gpt-x', costCents: 1, tokenPriced: true });
      for (let i = 0; i < 5; i++)
        recordCostObservation({ providerId: 'openai', modelId: 'gpt-x', costCents: 10, tokenPriced: true });

      const triggers = listProposals().map((p) => p.trigger).sort();
      expect(triggers).toEqual(['cost-anomaly', 'prompt-regression']);
    });
  });

  it('startProposalEngine is idempotent', () => {
    startProposalEngine();
    startProposalEngine();
    startPromptIntelligence({ windowSize: 4, dropThreshold: 0.3 });

    for (let i = 0; i < 16; i++) recordPromptOutcome({ promptId: 'p', success: true, latencyMs: 10 });
    for (let i = 0; i < 4; i++) recordPromptOutcome({ promptId: 'p', success: false, latencyMs: 10 });

    // A duplicate subscription would produce two proposals for one alert.
    expect(listProposals()).toHaveLength(1);
  });
});
