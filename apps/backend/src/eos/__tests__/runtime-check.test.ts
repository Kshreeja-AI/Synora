/**
 * Runtime check tests.
 *
 * This module exists because of a defect no unit test could see: three
 * components were never started by the server, and every test still passed
 * because tests start what they test. The assertions below are therefore
 * about the check itself being able to see that condition — a check that
 * reports everything healthy regardless would reproduce the original bug
 * with extra steps.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getRuntimeCheck, EXPECTED_SUBSCRIPTIONS } from '../runtime-check';
import { startProviderObservatory, stopProviderObservatory } from '../provider-observatory';
import { startPromptIntelligence, stopPromptIntelligence } from '../prompt-intelligence';
import { startCostMonitor, stopCostMonitor } from '../cost-monitor';
import { startProposalEngine, stopProposalEngine } from '../proposal-engine';

function stopEverything() {
  stopProviderObservatory();
  stopPromptIntelligence();
  stopCostMonitor();
  stopProposalEngine();
}

describe('runtime-check', () => {
  beforeEach(stopEverything);

  it('reports every expected subscription as not running when nothing started', () => {
    const result = getRuntimeCheck();

    expect(result.allRunning).toBe(false);
    expect(result.entries).toHaveLength(EXPECTED_SUBSCRIPTIONS.length);
    expect(result.entries.every((e) => !e.running)).toBe(true);
  });

  it('reports everything running once the full startup sequence has run', () => {
    startProviderObservatory();
    startPromptIntelligence();
    startCostMonitor();
    startProposalEngine();

    const result = getRuntimeCheck();

    expect(result.allRunning).toBe(true);
    expect(result.notRunning).toEqual([]);
  });

  it('catches exactly the defect that prompted it: the observatory up, the rest not', () => {
    // This was the real state of server.ts. It looked fine — one component
    // was running and emitting data to the dashboard.
    startProviderObservatory();

    const result = getRuntimeCheck();

    expect(result.allRunning).toBe(false);
    expect(result.notRunning).toContain('prompt-intelligence');
    expect(result.notRunning).toContain('proposal-engine (prompt regressions)');
    expect(result.notRunning).toContain('proposal-engine (cost anomalies)');
    expect(result.notRunning).not.toContain('provider-observatory');
  });

  it('notices a detector running with nothing consuming its alerts', () => {
    startProviderObservatory();
    startPromptIntelligence();
    startCostMonitor();
    // Proposal engine deliberately not started.

    const result = getRuntimeCheck();

    // The chain is broken at the last link: problems get detected and then
    // nothing turns them into anything a founder would ever see.
    expect(result.notRunning).toEqual([
      'proposal-engine (prompt regressions)',
      'proposal-engine (cost anomalies)',
    ]);
  });

  it('explains what breaks, not merely that something is off', () => {
    const result = getRuntimeCheck();

    for (const entry of result.entries) {
      expect(entry.consequenceIfMissing.length).toBeGreaterThan(20);
    }
    const prompt = result.entries.find((e) => e.component === 'prompt-intelligence')!;
    expect(prompt.consequenceIfMissing).toMatch(/no regression can ever be detected/i);
  });

  it('names the components it structurally cannot verify', () => {
    const result = getRuntimeCheck();

    // Timer-driven components attach no listener, so this check is blind to
    // them. Saying so stops a green result reading as full coverage.
    expect(result.notCoveredByThisCheck).toContain('memory-collector');
    expect(result.notCoveredByThisCheck).toContain('latency-tracker');
    expect(result.notCoveredByThisCheck).toContain('history-recorder');
  });

  it('reads liveness from the bus, not from what a component claims', () => {
    startPromptIntelligence();
    const before = getRuntimeCheck().entries.find((e) => e.eventType === 'ai.prompt.outcome')!;
    expect(before.listeners).toBeGreaterThan(0);

    stopPromptIntelligence();
    const after = getRuntimeCheck().entries.find((e) => e.eventType === 'ai.prompt.outcome')!;

    // Stopping the component changes the answer immediately, because the
    // count comes from the event bus rather than from a flag the component
    // sets about itself.
    expect(after.listeners).toBe(0);
    expect(after.running).toBe(false);
  });
});
